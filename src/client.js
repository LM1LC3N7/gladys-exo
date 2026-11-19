// -----------------------------------------------------------------------------
// The only network access: GET requests to the GTFS-Realtime API of the Chrono
// portal (`/<NETWORK>/tripupdate`, `/<NETWORK>/alert`), with the user's key in
// the `Ocp-Apim-Subscription-Key` header of the portal's API gateway (a
// private field, never in a URL, a log, an error or /data; the gateway also
// takes it as a `token` query parameter, which would put it in URLs), the
// module's own User-Agent and `Accept: application/x-protobuf`. Every answer
// is bounded in time and in size (the body is cut as soon as it passes its
// limit). Errors carry our own codes only, never a text of the server.
// -----------------------------------------------------------------------------

import { API_BASE, MAX_BYTES, REQUEST_TIMEOUT, USER_AGENT } from './constants.js';
import { NETWORK_CODES } from './networks.js';

export class ChronoError extends Error {
  /**
   * @param {string} code - refused | rate_limited | server | not_found | http |
   *   timeout | network | too_large | bad_response | aborted | paused | final_refused
   * @param {{ status?: number, retryAfter?: number }} [details]
   */
  constructor(code, { status, retryAfter } = {}) {
    super(status ? `Chrono ${code} (HTTP ${status})` : `Chrono ${code}`);
    this.name = 'ChronoError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** The wait a 429/503 asks for, in ms: seconds, or a date read against the `Date` header. */
export function retryAfterOf(headers) {
  const value = headers.get('retry-after');
  if (!value) {
    return undefined;
  }
  if (/^\s*\d{1,7}\s*$/.test(value)) {
    return Number(value) * 1000;
  }
  const at = Date.parse(value);
  const date = Date.parse(headers.get('date') ?? '');
  // A date is only usable against the server's own clock.
  return Number.isFinite(at) && Number.isFinite(date) && at >= date ? at - date : undefined;
}

/**
 * The wait an API gateway quota message gives: "Quota will be replenished in
 * 01:02:03" (hh:mm:ss, days optional) or "Try again in 30 seconds". Only our
 * number comes out of the text, never the text.
 */
export function quotaWaitOf(text) {
  const clock = /replenished in (?:(\d{1,3})\.)?(\d{1,2}):(\d{2}):(\d{2})/i.exec(text);
  if (clock) {
    const [, d = '0', h, m, s] = clock;
    return (((Number(d) * 24 + Number(h)) * 60 + Number(m)) * 60 + Number(s)) * 1000;
  }
  const seconds = /try again in (\d{1,7}) seconds?/i.exec(text);
  return seconds ? Number(seconds[1]) * 1000 : undefined;
}

async function readBounded(response, max) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > max) {
    await response.body?.cancel().catch(() => {});
    throw new ChronoError('too_large');
  }
  if (!response.body) {
    return new Uint8Array(0);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new ChronoError('too_large');
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** The short body of a refusal, for the quota wait only; never more than MAX_BYTES.error. */
async function errorText(response) {
  try {
    return Buffer.from(await readBounded(response, MAX_BYTES.error)).toString('utf8');
  } catch {
    return '';
  }
}

export class ChronoClient {
  #apiKey;

  constructor({
    apiKey,
    fetchImpl = globalThis.fetch,
    base = API_BASE,
    timeout = REQUEST_TIMEOUT,
  }) {
    this.#apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.base = base;
    this.timeout = timeout;
  }

  /**
   * GET one feed of one network: `{ body, date }`, `date` being the server's
   * `Date` header in ms (undefined when missing or unreadable).
   * @param {string} network one of NETWORK_CODES
   * @param {'tripupdate' | 'alert'} feed
   * @param {AbortSignal} [signal]
   */
  async feed(network, feed, signal) {
    if (!NETWORK_CODES.includes(network) || !(feed in MAX_BYTES) || feed === 'error') {
      throw new ChronoError('bad_request');
    }
    // One deadline for the whole exchange, body included.
    const timeout = AbortSignal.timeout(this.timeout);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetchImpl(`${this.base}/${network}/${feed}`, {
        method: 'GET',
        headers: {
          'Ocp-Apim-Subscription-Key': this.#apiKey,
          Accept: 'application/x-protobuf',
          'User-Agent': USER_AGENT,
        },
        redirect: 'error',
        signal: combined,
      });
    } catch (err) {
      throw this.#failure(err, signal, timeout);
    }
    const { status } = response;
    if (status !== 200) {
      if (status === 401 || status === 403 || status === 429) {
        const text = await errorText(response);
        // The gateway's quota answers a 403 (call volume) or a 429 (rate):
        // both are a wait, never a refusal of the key.
        const quota = /quota|rate limit/i.test(text);
        if (status === 429 || quota) {
          throw new ChronoError('rate_limited', {
            status,
            retryAfter: retryAfterOf(response.headers) ?? quotaWaitOf(text),
          });
        }
        throw new ChronoError('refused', { status });
      }
      await response.body?.cancel().catch(() => {});
      if (status >= 500) {
        throw new ChronoError('server', { status, retryAfter: retryAfterOf(response.headers) });
      }
      if (status === 404) throw new ChronoError('not_found', { status });
      throw new ChronoError('http', { status });
    }
    const type = response.headers.get('content-type') ?? '';
    if (/json|html|xml|text\//i.test(type)) {
      // A gateway page in place of the protobuf feed.
      await response.body?.cancel().catch(() => {});
      throw new ChronoError('bad_response', { status });
    }
    let body;
    try {
      body = await readBounded(response, MAX_BYTES[feed]);
    } catch (err) {
      if (err instanceof ChronoError) throw err;
      throw this.#failure(err, signal, timeout);
    }
    const date = Date.parse(response.headers.get('date') ?? '');
    return { body, date: Number.isFinite(date) ? date : undefined };
  }

  #failure(err, signal, timeout) {
    if (signal?.aborted) return new ChronoError('aborted');
    if (timeout.aborted || err?.name === 'TimeoutError') return new ChronoError('timeout');
    return new ChronoError('network');
  }
}
