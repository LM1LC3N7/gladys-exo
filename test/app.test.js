// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys, the scripted Chrono API and a
// virtual clock that moves only when the test says so.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, REQUEST_GAP } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { API_KEY, NOW, OTHER_KEY, apim, feed, pb, tripEntity } from './fixtures/exo.js';
import {
  CONFIG,
  DEVICE,
  F,
  MINUTE,
  SECOND,
  TWO,
  createFakeClock,
  settle,
  setup,
} from './helpers/app.js';

const trips = (s, network = 'TRAINS') => s.api.count(`/${network}/tripupdate`);
const alerts = (s, network = 'TRAINS') => s.api.count(`/${network}/alert`);
const text = (message) => message?.en ?? '';
const act = async (s) => (await s.gladys.fake.action(ACTIONS.TEST)).data?.message;
const B = (key) => F(key, 2, 'CITLA', '41492');

test('first round: the train feed and its alerts, six states, the device', async () => {
  const s = await setup();
  await s.run();
  assert.deepEqual(
    s.api.calls.map((c) => c.path),
    ['/TRAINS/tripupdate', '/TRAINS/alert'],
  );
  assert.equal(s.last(F('next')), '14:08 · ligne 11 · dans 6 min · +4 min');
  assert.equal(s.last(F('next_in')), 6);
  assert.equal(s.last(F('delay')), 4);
  assert.equal(s.last(F('cancelled')), 1, 'the line 12 trip is cancelled at the other platform');
  assert.equal(s.last(F('alerts')), 1, 'the ended alert does not count');
  assert.equal(s.last(F('alert')), 'Ligne 11 : retards de 10 à 15 min');
  const [device] = s.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE());
  assert.equal(device.name, 'exo Trains – Centrale');
  assert.ok(device.features.every((f) => f.read_only === true));
  assert.equal(device.features.length, 6);
  assert.deepEqual(s.status(), {
    connected: true,
    message: { en: 'Read at 14:02: 1 stop(s).', fr: 'Lu à 14:02 : 1 arrêt(s).' },
  });
  // The key in its header only; requests one after the other, REQUEST_GAP apart.
  for (const call of s.api.calls) {
    assert.equal(call.headers['Ocp-Apim-Subscription-Key'], API_KEY);
    assert.ok(!call.url.includes(API_KEY));
    assert.match(call.headers['User-Agent'], /^gladys-exo\/\d+\.\d+\.\d+ \(\+https:/);
  }
  const at = s.api.calls.map((c) => c.at);
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i] - at[i - 1] >= REQUEST_GAP - 1);
  await s.app.stop();
});

test('two networks: one feed each, the bus stop early, English texts', async () => {
  const s = await setup({ config: { ...TWO, language: 'en' } });
  await s.run();
  assert.equal(trips(s), 1);
  assert.equal(trips(s, 'CITLA'), 1);
  assert.equal(alerts(s, 'CITLA'), 1);
  assert.equal(s.last(B('next')), '14:05 · line 220 · in 3 min · 1 min early');
  assert.equal(s.last(B('next_in')), 3);
  assert.equal(s.last(B('delay')), -1);
  assert.equal(s.last(B('alerts')), 0);
  assert.equal(s.last(B('alert')), 'No alert');
  const names = s.gladys.fake.discoveredDevices.map((d) => d.name);
  assert.deepEqual(names, ['exo Trains – Centrale', 'exo Laurentides – stop 41492']);
  await s.app.stop();
});

test('a route filter: only line 221, a delay the feed does not give stays unpublished', async () => {
  const s = await setup({ config: { ...TWO, routes_2: '221' } });
  await s.run();
  assert.equal(s.last(B('next')), '14:14 · ligne 221 · dans 12 min');
  assert.equal(s.last(B('next_in')), 12);
  assert.equal(s.states(B('delay')).length, 0, 'never a 0 for an unknown delay');
  assert.equal(s.gladys.fake.discoveredDevices[1].name, 'exo Laurentides – arrêt 41492 (221)');
  await s.app.stop();
});

test('no departure in the window: said in the text, nothing else invented', async () => {
  const s = await setup();
  s.api.trips.TRAINS = () => [];
  await s.run();
  assert.equal(s.last(F('next')), 'Aucun passage dans les 90 prochaines min');
  assert.equal(s.last(F('cancelled')), 0);
  assert.equal(s.states(F('next_in')).length, 0);
  assert.equal(s.states(F('delay')).length, 0);
  await s.app.stop();
});

test('the pace: an interval start to start, the alerts every 5 min, the minute tick', async () => {
  const s = await setup();
  await s.run();
  assert.equal(trips(s), 1);
  await s.advance(MINUTE - 20 * SECOND - 1);
  assert.equal(trips(s), 1, 'not before the interval');
  await s.advance(20 * SECOND);
  assert.equal(trips(s), 2);
  assert.equal(alerts(s), 1, 'the alerts wait 5 min');
  // 14:03: the train of 14:08 is 5 min away (the tick and the round agree).
  assert.equal(s.last(F('next_in')), 5);
  await s.advance(5 * MINUTE);
  assert.equal(trips(s), 7);
  assert.equal(alerts(s), 2);
  await s.app.stop();
});

test('a reconnection never reads sooner; the status is sent again', async () => {
  const s = await setup();
  await s.run();
  const before = s.statuses().length;
  await s.app.connected();
  await s.advance(10 * SECOND);
  assert.equal(trips(s), 1);
  assert.ok(s.statuses().length > before);
  await s.advance(MINUTE);
  assert.equal(trips(s), 2);
  await s.app.stop();
});

test('a restart reads the time of the last round from /data: no read before the interval', async () => {
  const store = createMemoryStore();
  const first = await setup({ store });
  await first.run();
  await first.app.stop();
  assert.equal(typeof store.data.lastRound, 'number');
  const clock = createFakeClock(first.clock.now);
  const second = await setup({ store, clock });
  await second.run(SECOND);
  assert.equal(trips(second), 0);
  await second.advance(30 * SECOND);
  assert.equal(trips(second), 0, 'still within the interval of the last round');
  await second.advance(10 * SECOND);
  assert.equal(trips(second), 1);
  await second.app.stop();
});

test('a time of /data in the future is invalid: ignored', async () => {
  const store = createMemoryStore({ lastRound: NOW + 3600 * SECOND });
  const s = await setup({ store });
  await s.run();
  assert.equal(trips(s), 1);
  await s.app.stop();
});

test('the form saved unchanged keeps the pace; a new stop is read 20 s after the last round', async () => {
  const s = await setup();
  await s.run(5 * SECOND);
  await s.gladys.fake.configUpdated(CONFIG);
  await s.advance(SECOND);
  assert.equal(trips(s), 1);
  await s.gladys.fake.configUpdated(TWO);
  await s.advance(5 * SECOND);
  assert.equal(trips(s, 'CITLA'), 0);
  await s.advance(11 * SECOND);
  assert.equal(trips(s, 'CITLA'), 1);
  assert.ok(s.last(B('next')));
  await s.app.stop();
});

test('a refused key: checked on the principal route, kept, never retried; a new key is tried', async () => {
  const store = createMemoryStore();
  const s = await setup({ store });
  s.api.key = OTHER_KEY;
  await s.run();
  assert.deepEqual(
    s.api.calls.map((c) => c.path),
    ['/TRAINS/tripupdate', '/TRAINS/alert'],
  );
  assert.equal(s.status().connected, false);
  assert.match(text(s.status().message), /refused the key \(HTTP 401\)/);
  assert.ok(store.data.refused && Number.isInteger(store.data.refused.tag));
  await s.advance(2 * 3600 * SECOND);
  assert.equal(s.api.calls.length, 2, 'no automatic retry');
  // A restart keeps the refusal (8 bits of the same key).
  const again = await setup({ store, api: s.api });
  await again.run(10 * MINUTE);
  assert.equal(s.api.calls.length, 2);
  await again.app.stop();
  // Another key is always tried.
  s.api.key = OTHER_KEY;
  await s.gladys.fake.configUpdated({ ...CONFIG, api_key: OTHER_KEY });
  await s.advance(30 * SECOND);
  assert.equal(trips(s), 2);
  assert.equal(s.status().connected, true);
  await s.app.stop();
});

test('a 401 of one network while the key is accepted: that network waits, the others go on', async () => {
  const s = await setup({ config: TWO });
  s.api.override = (path) =>
    path === '/CITLA/tripupdate'
      ? apim(401, 'Access denied due to invalid subscription key.')
      : undefined;
  await s.run();
  assert.equal(s.app.isRefused(), false);
  assert.equal(s.last(F('next_in')), 6, 'the trains are published');
  assert.match(
    text(s.status().message),
    /Read at 14:02: 1 of 2 stops\. Stop 2: network CITLA refused/,
  );
  await s.advance(MINUTE);
  assert.equal(trips(s, 'CITLA'), 1, 'waits 5 min');
  await s.advance(5 * MINUTE);
  assert.equal(trips(s, 'CITLA'), 2);
  await s.app.stop();
});

test('a 401 on the alerts after the departures were read: never a refusal', async () => {
  const s = await setup();
  s.api.override = (path) => (path === '/TRAINS/alert' ? apim(401, 'Access denied') : undefined);
  await s.run();
  assert.equal(s.app.isRefused(), false);
  assert.equal(s.last(F('next_in')), 6);
  assert.equal(s.states(F('alerts')).length, 0, 'alerts not read stay unpublished');
  assert.match(text(s.status().message), /Alerts of TRAINS not read \(HTTP 401\)/);
  await s.advance(4 * MINUTE);
  assert.equal(alerts(s), 1);
  await s.advance(2 * MINUTE);
  assert.equal(alerts(s), 2, 'tried again after 5 min');
  await s.app.stop();
});

test('a 429: every request waits Retry-After, kept across a restart', async () => {
  const store = createMemoryStore();
  const s = await setup({ store });
  s.api.override = (path) =>
    path === '/TRAINS/tripupdate' ? pb('', 429, { 'retry-after': '600' }) : undefined;
  await s.run();
  assert.equal(s.api.calls.length, 1);
  assert.match(text(s.status().message), /paused until 14:12/);
  assert.equal(store.data.pause.code, 'rate_limited');
  s.api.override = undefined;
  await s.advance(5 * MINUTE);
  assert.equal(s.api.calls.length, 1);
  assert.match(text(await act(s)), /Paused until/);
  await s.app.stop();
  const again = await setup({ store, api: s.api, clock: createFakeClock(s.clock.now) });
  await again.run(4 * MINUTE);
  assert.equal(s.api.calls.length, 1, 'the pause outlives a restart');
  await again.advance(2 * MINUTE);
  assert.equal(trips(again), 3, 'read at the end of the pause, then an interval later');
  await again.app.stop();
});

test('the quota of the gateway (403 "Out of call volume quota"): a pause, never a refusal', async () => {
  const s = await setup();
  s.api.override = (path) =>
    path === '/TRAINS/tripupdate'
      ? apim(403, 'Out of call volume quota. Quota will be replenished in 01:30:00.')
      : undefined;
  await s.run();
  assert.equal(s.app.isRefused(), false);
  assert.match(text(s.status().message), /paused until 15:32/);
  await s.app.stop();
});

test('a 5xx of one network holds it; every network in 5xx pauses all', async () => {
  const s = await setup({ config: TWO });
  s.api.override = (path) => (path === '/CITLA/tripupdate' ? pb('', 503) : undefined);
  await s.run();
  assert.equal(s.last(F('next_in')), 6);
  assert.match(text(s.status().message), /network CITLA unavailable \(HTTP 503\)/);
  assert.equal(s.app.pauseActive(), false);
  s.api.override = (path) => (path.endsWith('/tripupdate') ? pb('', 502) : undefined);
  await s.advance(MINUTE + 5 * SECOND);
  assert.equal(s.app.pauseActive(), true, 'the only network tried was in 5xx');
  assert.match(text(s.status().message), /unavailable \(HTTP 502\): paused until/);
  await s.app.stop();
});

test('a feed older than 15 min against the server Date: nothing published', async () => {
  const s = await setup();
  s.api.timestamp = NOW - 20 * MINUTE;
  await s.run();
  assert.equal(s.states(F('next')).length, 0);
  assert.match(text(s.status().message), /not up to date \(dated 13:42\)/);
  await s.app.stop();
});

test('a feed without timestamp is never "out of date"', async () => {
  const s = await setup();
  s.api.override = (path) =>
    path === '/TRAINS/tripupdate'
      ? pb(
          feed({
            entities: [
              tripEntity({
                id: 'x',
                routeId: '1',
                stops: [{ stopId: 'MTL5B', time: NOW + 9 * MINUTE + 30 * SECOND }],
              }),
            ],
          }),
        )
      : undefined;
  await s.run();
  assert.equal(s.last(F('next_in')), 9);
  await s.app.stop();
});

test('unreadable or oversized answers: nothing published, the next round reads again', async () => {
  const s = await setup();
  s.api.override = (path) =>
    path === '/TRAINS/tripupdate' ? pb(Uint8Array.from([0x0a, 0xff, 0x01])) : undefined;
  await s.run();
  assert.equal(s.states(F('next')).length, 0);
  assert.match(text(s.status().message), /unreadable answer/);
  s.api.override = (path) =>
    path === '/TRAINS/tripupdate'
      ? new Response('<html>gateway</html>', { headers: { 'content-type': 'text/html' } })
      : undefined;
  await s.advance(2 * MINUTE + 1);
  assert.equal(s.states(F('next')).length, 0);
  s.api.override = undefined;
  await s.advance(4 * MINUTE);
  assert.equal(s.last(F('cancelled')), 1);
  await s.app.stop();
});

test('held data ages out: no fresh read for 10 min, the tick publishes nothing new', async () => {
  const s = await setup();
  await s.run();
  s.api.override = () => 'network';
  const count = s.gladys.fake.states.length;
  await s.advance(9 * MINUTE);
  assert.ok(s.gladys.fake.states.length > count, 'the countdown moves meanwhile');
  const later = s.gladys.fake.states.length;
  await s.advance(3 * MINUTE);
  assert.equal(s.gladys.fake.states.length, later, 'stale: nothing published');
  await s.app.stop();
});

test('getConfig() failing in `connected`: retried with a status, then the start goes on', async () => {
  let fail = 1;
  const s = await setup();
  const real = s.gladys.getConfig.bind(s.gladys);
  s.gladys.getConfig = async () => {
    if (fail > 0) {
      fail -= 1;
      throw new Error('socket');
    }
    return real();
  };
  await s.app.connected();
  assert.match(text(s.status().message), /could not be read/);
  await s.advance(10 * SECOND);
  assert.equal(trips(s), 1);
  assert.equal(s.status().connected, true);
  await s.app.stop();
});

test('/data unreadable: never written, read again every 10 s; the pace waits an interval', async () => {
  const store = createMemoryStore();
  store.unreadable = true;
  const s = await setup({ store });
  await s.run(10 * SECOND);
  assert.equal(store.saves, 0);
  assert.equal(trips(s), 0, 'its last round is unknown: a whole interval');
  assert.match(text(s.status().message), /\/data unreadable/);
  const loads = store.loads;
  await s.advance(20 * SECOND);
  assert.ok(store.loads >= loads + 2);
  await s.advance(40 * SECOND);
  assert.equal(trips(s), 1, 'read after a whole interval');
  assert.equal(store.saves, 0, 'a round while /data is unreadable writes nothing');
  store.unreadable = false;
  await s.advance(15 * SECOND);
  assert.ok(store.saves > 0, 'saved once read');
  await s.app.stop();
});

test('the test button: once in 30 s, a success lifts a refusal', async () => {
  const s = await setup();
  s.api.key = OTHER_KEY;
  await s.run();
  assert.equal(s.app.isRefused(), true);
  assert.match(text(await act(s)), /Refused/);
  assert.match(text(await act(s)), /Tested \d+ s ago/);
  s.api.key = API_KEY;
  await s.advance(31 * SECOND);
  assert.match(text(await act(s)), /Accepted/);
  assert.equal(s.app.isRefused(), false);
  await s.advance(MINUTE);
  assert.ok(trips(s) >= 2);
  await s.app.stop();
});

test('a stop without its network is not guessed; a missing key says so', async () => {
  const s = await setup({ config: { api_key: API_KEY, stop_1: '41492' } });
  await s.run();
  assert.equal(s.api.calls.length, 0);
  assert.match(text(s.status().message), /Stop 1: choose its network/);
  await s.gladys.fake.configUpdated({ network_1: 'TRAINS', stop_1: '11010' });
  await settle();
  assert.match(text(s.status().message), /Enter the key/);
  await s.app.stop();
});

test('stop: no timer left, no request after it', async () => {
  const s = await setup();
  await s.run();
  await s.app.stop();
  const calls = s.api.calls.length;
  await s.advance(3600 * SECOND);
  assert.equal(s.api.calls.length, calls);
  assert.equal(s.timers.pending.size, 0);
});

test('the key never reaches the logs, the statuses, /data nor the states', async () => {
  const store = createMemoryStore();
  const s = await setup({ store, config: TWO });
  await s.run();
  s.api.key = 'x';
  await s.advance(2 * MINUTE);
  await act(s);
  const all = JSON.stringify([s.lines, s.statuses(), store.data, s.gladys.fake.states]);
  assert.ok(!all.includes(API_KEY));
  assert.ok(!all.includes(API_KEY.slice(0, 12)));
  await s.app.stop();
});

test('alerts not read for 20 min are not published again (a reconnection, the tick)', async () => {
  const s = await setup();
  await s.run();
  assert.equal(s.states(F('alerts')).length, 1);
  s.api.override = (path) => (path === '/TRAINS/alert' ? pb('', 500) : undefined);
  await s.advance(15 * MINUTE);
  await s.app.connected();
  await s.advance(MINUTE);
  assert.equal(
    s.states(F('alerts')).length,
    2,
    'still fresh: published again after the reconnection',
  );
  await s.advance(6 * MINUTE);
  await s.app.connected();
  await s.advance(MINUTE);
  assert.equal(s.states(F('alerts')).length, 2, 'older than 20 min: not published');
  assert.ok(s.states(F('next')).length >= 3, 'the departures go on');
  await s.app.stop();
});

test('a new key whose 8-bit tag matches the refused one is still tried', async () => {
  const { tagOf } = await import('../src/app.js');
  const store = createMemoryStore();
  const s = await setup({ store });
  s.api.key = 'nobody';
  await s.run();
  assert.equal(s.app.isRefused(), true);
  const { salt, tag } = store.data.refused;
  let twin;
  for (let i = 0; !twin; i += 1) {
    if (`twin-key-${i}` !== API_KEY && tagOf(salt, `twin-key-${i}`) === tag) twin = `twin-key-${i}`;
  }
  s.api.key = twin;
  await s.gladys.fake.configUpdated({ ...CONFIG, api_key: twin });
  await s.advance(30 * SECOND);
  assert.equal(trips(s), 2);
  assert.equal(s.status().connected, true);
  await s.app.stop();
});

test('a request queued behind a 429 is never sent (the pause is decided first)', async () => {
  const s = await setup();
  s.api.hold = true;
  s.api.override = (path) =>
    path === '/TRAINS/tripupdate' ? pb('', 429, { 'retry-after': '600' }) : undefined;
  await s.app.connected();
  await s.advance(SECOND);
  assert.equal(s.api.calls.length, 1, 'the round request is in flight');
  const pending = s.gladys.fake.action(ACTIONS.TEST);
  await settle();
  s.api.hold = false;
  s.api.release();
  await s.advance(5 * SECOND);
  const ack = await pending;
  assert.equal(s.api.calls.length, 1, 'the queued test request was not sent');
  assert.match(text(ack.data?.message), /Paused until/);
  await s.app.stop();
});

test('a request queued behind a refusal is never sent', async () => {
  const store = createMemoryStore({ lastRound: NOW - 30 * SECOND });
  const s = await setup({ store });
  await s.app.connected();
  await s.advance(SECOND);
  assert.equal(s.api.calls.length, 0, 'the round is due in 30 s');
  s.api.hold = true;
  s.api.key = 'nobody';
  const pending = s.gladys.fake.action(ACTIONS.TEST);
  await s.advance(35 * SECOND);
  assert.equal(s.api.calls.length, 1, 'the test request is in flight, the round queued');
  s.api.hold = false;
  s.api.release();
  await s.advance(5 * SECOND);
  const ack = await pending;
  assert.match(text(ack.data?.message), /Refused/);
  assert.equal(s.api.calls.length, 1, 'the queued round request was not sent');
  await s.app.stop();
});
