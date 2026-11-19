// -----------------------------------------------------------------------------
// The client against a real local HTTP server: the key in its header only,
// bounded answers (announced or streamed), timeouts, redirects refused, the
// gateway's answers turned into our codes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ChronoClient, quotaWaitOf, retryAfterOf } from '../src/client.js';
import { MAX_BYTES } from '../src/constants.js';
import { API_KEY, feed } from './fixtures/exo.js';

async function serve(t, handler) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  const client = new ChronoClient({
    apiKey: API_KEY,
    base: `http://127.0.0.1:${server.address().port}/api/opendata/v1`,
    timeout: 500,
  });
  return { client, requests };
}

const code = async (promise) => {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return `${err.code}${err.status ? ` ${err.status}` : ''}`;
  }
};

test('a feed: the path, the key in its header only, the Date of the server', async (t) => {
  const body = feed({ timestamp: 1 });
  const { client, requests } = await serve(t, (req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      date: 'Mon, 16 Nov 2026 19:02:00 GMT',
    });
    res.end(body);
  });
  const answer = await client.feed('CITLA', 'tripupdate');
  assert.deepEqual([...answer.body], [...body]);
  assert.equal(answer.date, Date.UTC(2026, 10, 16, 19, 2));
  assert.equal(requests[0].url, '/api/opendata/v1/CITLA/tripupdate');
  assert.equal(requests[0].headers['ocp-apim-subscription-key'], API_KEY);
  assert.equal(requests[0].headers.accept, 'application/x-protobuf');
  assert.equal(await code(client.feed('../x', 'alert')), 'bad_request');
  assert.equal(await code(client.feed('TRAINS', 'error')), 'bad_request');
});

test('answers too large: announced or streamed, cut before the end', async (t) => {
  let streamed = 0;
  const { client } = await serve(t, (req, res) => {
    if (req.url.endsWith('/alert')) {
      res.writeHead(200, { 'content-length': String(MAX_BYTES.alert + 1) });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/x-protobuf' });
    const chunk = Buffer.alloc(256 * 1024);
    const push = () => {
      while (streamed < 64 * 1024 * 1024) {
        streamed += chunk.length;
        if (!res.write(chunk)) return res.once('drain', push);
      }
      res.end();
    };
    push();
    res.on('close', () => {});
  });
  assert.equal(await code(client.feed('TRAINS', 'alert')), 'too_large');
  assert.equal(await code(client.feed('TRAINS', 'tripupdate')), 'too_large');
  assert.ok(streamed < 32 * 1024 * 1024, `${streamed} bytes sent before the cut`);
});

test('the gateway: 401 refused, 403 quota and 429 are waits, 5xx, 404, a page, a redirect', async (t) => {
  const answers = {
    a: [
      401,
      { 'content-type': 'application/json' },
      '{"message":"Access denied due to invalid subscription key."}',
    ],
    b: [403, {}, '{"message":"Out of call volume quota. Quota will be replenished in 00:10:00."}'],
    c: [
      429,
      { 'retry-after': '30' },
      '{"message":"Rate limit is exceeded. Try again in 30 seconds."}',
    ],
    d: [503, { 'retry-after': '120' }, ''],
    e: [404, {}, ''],
    f: [200, { 'content-type': 'text/html' }, '<html>maintenance</html>'],
    g: [302, { location: 'http://127.0.0.1:1/' }, ''],
    h: [403, {}, 'Forbidden'],
  };
  let next = 'a';
  const { client } = await serve(t, (req, res) => {
    const [status, headers, body] = answers[next];
    res.writeHead(status, headers);
    res.end(body);
  });
  const run = async (key) => {
    next = key;
    try {
      await client.feed('TRAINS', 'tripupdate');
      return 'ok';
    } catch (err) {
      return [err.code, err.status, err.retryAfter];
    }
  };
  assert.deepEqual(await run('a'), ['refused', 401, undefined]);
  assert.deepEqual(await run('b'), ['rate_limited', 403, 600_000]);
  assert.deepEqual(await run('c'), ['rate_limited', 429, 30_000]);
  assert.deepEqual(await run('d'), ['server', 503, 120_000]);
  assert.deepEqual(await run('e'), ['not_found', 404, undefined]);
  assert.deepEqual(await run('f'), ['bad_response', 200, undefined]);
  assert.deepEqual(await run('g'), ['network', undefined, undefined]);
  assert.deepEqual(await run('h'), ['refused', 403, undefined]);
});

test('a server that never answers, or stops mid-body: a timeout, bounded', async (t) => {
  const { client } = await serve(t, (req, res) => {
    if (req.url.endsWith('/alert')) {
      res.writeHead(200, { 'content-type': 'application/x-protobuf' });
      res.write(Buffer.alloc(10));
      return;
    }
  });
  const started = performance.now();
  assert.equal(await code(client.feed('TRAINS', 'tripupdate')), 'timeout');
  assert.equal(await code(client.feed('TRAINS', 'alert')), 'timeout');
  assert.ok(performance.now() - started < 3000);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await code(client.feed('TRAINS', 'tripupdate', aborted.signal)), 'aborted');
});

test('the waits asked: Retry-After in seconds or as a date, the quota texts', () => {
  const h = (o) => new Headers(o);
  assert.equal(retryAfterOf(h({ 'retry-after': '7' })), 7000);
  assert.equal(
    retryAfterOf(
      h({ 'retry-after': 'Mon, 16 Nov 2026 19:12:00 GMT', date: 'Mon, 16 Nov 2026 19:02:00 GMT' }),
    ),
    600_000,
  );
  assert.equal(retryAfterOf(h({ 'retry-after': 'Mon, 16 Nov 2026 19:12:00 GMT' })), undefined);
  assert.equal(retryAfterOf(h({})), undefined);
  assert.equal(quotaWaitOf('Quota will be replenished in 1.02:00:30.'), (26 * 3600 + 30) * 1000);
  assert.equal(quotaWaitOf('Try again in 5 seconds.'), 5000);
  assert.equal(quotaWaitOf('nothing'), undefined);
});

test('a redirect is never followed: the key never reaches another host', async (t) => {
  const other = [];
  const elsewhere = createServer((req, res) => {
    other.push(req.headers);
    res.writeHead(200, { 'content-type': 'application/x-protobuf' });
    res.end(feed({ timestamp: 1 }));
  });
  await new Promise((resolve) => elsewhere.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    elsewhere.closeAllConnections?.();
    await new Promise((resolve) => elsewhere.close(resolve));
  });
  const { client } = await serve(t, (req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${elsewhere.address().port}/x` });
    res.end();
  });
  assert.equal(await code(client.feed('TRAINS', 'alert')), 'network');
  assert.equal(other.length, 0);
});
