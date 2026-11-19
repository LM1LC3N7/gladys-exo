// -----------------------------------------------------------------------------
// The decoder, the board and the alerts of a stop, the configuration (pure).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseRoutes, stopInput } from '../src/config.js';
import { MAX_ALERT_TEXT, MAX_STOP_TIMES } from '../src/constants.js';
import { describe as describeDeparture, statesOf } from '../src/devices.js';
import { decodeAlerts, decodeTripUpdates, GtfsRealtimeDecodeError } from '../src/gtfs.js';
import { activeAt, alertsOf, boardOf, clean, pick, routesSeen, selects } from '../src/model.js';
import { lineOf, resolveStop, routeIdOf, TRAIN_STATIONS } from '../src/networks.js';
import { clock } from '../src/time.js';
import {
  NOW,
  alertEntity,
  bytes,
  feed,
  str,
  trainAlerts,
  trainTrips,
  tripEntity,
  vint,
} from './fixtures/exo.js';

const MIN = 60_000;
const station = { network: 'TRAINS', stopIds: ['MTL5D', 'MTL5B'], routes: [] };

test('the decoder keeps the watched stops only, signed delays, any field order', () => {
  const buffer = feed({
    timestamp: NOW / 1000,
    entities: [
      ...trainTrips(NOW),
      tripEntity({
        id: 'late',
        routeId: '5',
        tripLast: true,
        stops: [{ stopId: 'MTL5B', time: NOW + 50 * MIN, delay: -120, arrival: true }],
      }),
      tripEntity({
        id: 'gone',
        routeId: '1',
        deleted: true,
        stops: [{ stopId: 'MTL5D', time: NOW }],
      }),
      // An unknown field of the entity (99) and a fixed64 one are skipped.
      [...str(1, 'x'), ...vint(99, 7), ...[0x09, 1, 2, 3, 4, 5, 6, 7, 8]],
    ],
  });
  const { timestamp, stopTimes, truncated } = decodeTripUpdates(buffer, ['MTL5D', 'MTL5B']);
  assert.equal(timestamp, NOW / 1000);
  assert.equal(truncated, false);
  assert.deepEqual(
    stopTimes.map((s) => [s.tripId, s.stopId, s.routeId]),
    [
      ['t1', 'MTL5D', '1'],
      ['t2', 'MTL5D', '1'],
      ['t3', 'MTL5B', '4'],
      ['late', 'MTL5B', '5'],
    ],
  );
  assert.equal(stopTimes[3].arrival.delay, -120);
  assert.equal(stopTimes[2].tripScheduleRelationship, 3);
});

test('a malformed feed throws; a huge one keeps MAX_STOP_TIMES and says so', () => {
  assert.throws(
    () => decodeTripUpdates(Uint8Array.from([0x12, 0x05, 0x0a]), []),
    GtfsRealtimeDecodeError,
  );
  assert.throws(() => decodeTripUpdates(Uint8Array.from([0x0b]), []), GtfsRealtimeDecodeError);
  const many = [];
  for (let i = 0; i < MAX_STOP_TIMES + 3; i += 1) {
    many.push(tripEntity({ id: `t${i}`, routeId: '1', stops: [{ stopId: 'A', time: NOW }] }));
  }
  const out = decodeTripUpdates(feed({ entities: many }), ['A']);
  assert.equal(out.stopTimes.length, MAX_STOP_TIMES);
  assert.equal(out.truncated, true);
  assert.equal(out.timestamp, undefined);
});

test('the alerts: periods, selectors, texts bounded, a cut character dropped', () => {
  const long = 'é'.repeat(MAX_ALERT_TEXT * 3);
  const { alerts } = decodeAlerts(
    feed({
      entities: [
        ...trainAlerts(NOW),
        alertEntity({ id: 'big', entities: [{ stopId: 'MTL5D' }], header: { '': long } }),
      ],
    }),
  );
  assert.equal(alerts.length, 3);
  assert.deepEqual(alerts[0].entities, [{ routeId: '1' }]);
  assert.equal(alerts[0].severity, 3);
  assert.equal(alerts[2].header[0].text.length, MAX_ALERT_TEXT);
  assert.ok(!alerts[2].header[0].text.includes('�'));
});

test('the board: window, cancelled and skipped, NO_DATA, route filter, sorted, unique', () => {
  const { stopTimes } = decodeTripUpdates(
    feed({
      entities: [
        ...trainTrips(NOW),
        tripEntity({
          id: 'skip',
          routeId: '1',
          stops: [{ stopId: 'MTL5D', time: NOW + 9 * MIN, skipped: true }],
        }),
        tripEntity({
          id: 'nd',
          routeId: '1',
          stops: [{ stopId: 'MTL5D', time: NOW + 8 * MIN, noData: true }],
        }),
        tripEntity({ id: 'left', routeId: '1', stops: [{ stopId: 'MTL5D', time: NOW - 2 * MIN }] }),
        tripEntity({
          id: 'far',
          routeId: '1',
          stops: [{ stopId: 'MTL5D', time: NOW + 200 * MIN }],
        }),
        tripEntity({ id: 'notime', routeId: '1', stops: [{ stopId: 'MTL5D', delay: 60 }] }),
        tripEntity({
          id: 't2',
          routeId: '1',
          stops: [{ stopId: 'MTL5D', time: NOW + 36 * MIN + 30_000 }],
        }),
      ],
    }),
    station.stopIds,
  );
  const board = boardOf(stopTimes, station, { now: NOW, lookaheadMinutes: 90 });
  assert.deepEqual(
    board.departures.map((d) => [d.tripId, d.line, d.delay]),
    [
      ['t1', '11', 240],
      ['t2', '11', undefined],
    ],
  );
  assert.equal(board.cancelled, 2, 'the cancelled trip and the skipped stop');
  const filtered = boardOf(
    stopTimes,
    { ...station, routes: ['4'] },
    { now: NOW, lookaheadMinutes: 90 },
  );
  assert.deepEqual(filtered, { departures: [], cancelled: 1 });
  assert.deepEqual(routesSeen(stopTimes, station, ['220']).slice(0, 1), ['220']);
  assert.ok(routesSeen(stopTimes, station).includes('4'));
});

test('alerts of a stop: active, tied by stop, route, route type or network, most severe first', () => {
  const stop = { network: 'CITLA', stopIds: ['41492'], routes: [] };
  const a = (over) => ({ periods: [], entities: [], header: [], description: [], ...over });
  const list = [
    a({ entities: [{ stopId: '99999' }], header: [{ text: 'other stop', language: '' }] }),
    a({
      entities: [{ routeId: '221' }],
      header: [{ text: 'route 221', language: 'fr' }],
      severity: 2,
    }),
    a({
      entities: [{ agencyId: 'CITLA' }],
      header: [{ text: 'whole network', language: '' }],
      severity: 4,
    }),
    a({ entities: [{ routeType: 2 }], header: [{ text: 'trains only', language: '' }] }),
    a({
      entities: [{ stopId: '41492', routeId: '999' }],
      header: [{ text: 'stop AND other route', language: '' }],
    }),
    a({ periods: [{ start: NOW / 1000 + 3600 }], entities: [{ stopId: '41492' }] }),
    a({ entities: [{}] }),
  ];
  const out = alertsOf(list, stop, { now: NOW, language: 'fr', routes: ['221'] });
  assert.deepEqual(out, { count: 2, text: 'whole network' });
  assert.equal(alertsOf(list, stop, { now: NOW, language: 'fr', routes: [] }).count, 1);
  assert.equal(selects({ routeType: 3 }, stop, { routes: [], trips: new Set() }), true);
  assert.equal(selects({ routeType: 3 }, station, { routes: [], trips: new Set() }), false);
  assert.equal(selects({ tripId: 'b1' }, stop, { routes: [], trips: new Set(['b1']) }), true);
  assert.equal(activeAt(a({ periods: [{ end: NOW / 1000 - 1 }] }), NOW), false);
  assert.equal(activeAt(a({ periods: [{ start: 0, end: 0 }] }), NOW), true);
});

test('the language of a text: exact, regional, untagged, else the first', () => {
  const tr = [
    { text: 'Hello', language: 'en' },
    { text: 'Bonjour', language: 'fr-ca' },
  ];
  assert.equal(pick(tr, 'fr'), 'Bonjour');
  assert.equal(pick(tr, 'en'), 'Hello');
  assert.equal(pick([{ text: 'x', language: 'es' }], 'fr'), 'x');
  assert.equal(pick([], 'fr'), '');
  assert.equal(clean('a\r\nb\u0007c d', 50), 'a b c d');
  assert.equal(clean('x'.repeat(300), 200).length, 200);
});

test('the published states: only what is known, never a 0 for "none"', () => {
  const gladys = { externalIds: (type, id) => ({ device: id, feature: (k) => `${id}:${k}` }) };
  const stop = { slot: 1, network: 'TRAINS', input: '11010', stopIds: ['MTL5D'], routes: [] };
  const none = statesOf(
    gladys,
    stop,
    { departures: [], cancelled: 0 },
    {
      now: NOW,
      language: 'en',
      lookaheadMinutes: 90,
    },
  );
  assert.deepEqual(
    none.map((s) => s.device_feature_external_id.split(':').pop()),
    ['next', 'cancelled'],
  );
  assert.deepEqual(
    statesOf(gladys, stop, undefined, { now: NOW, language: 'en', lookaheadMinutes: 90 }),
    [],
  );
  const text = describeDeparture(
    { time: NOW + 4 * MIN, line: '11', delay: 9000000 },
    { now: NOW, language: 'en' },
  );
  assert.equal(text, `${clock(NOW + 4 * MIN)} · line 11 · in 4 min · +1440 min`);
});

test('the time of Montréal, summer and winter', () => {
  assert.equal(clock(NOW), '14:02');
  assert.equal(clock(Date.UTC(2026, 6, 1, 4, 30)), '00:30', 'UTC-4 in summer');
  // The autumn change (2026-11-01 02:00 EDT -> 01:00 EST).
  assert.equal(clock(Date.UTC(2026, 10, 1, 5, 30)), '01:30');
  assert.equal(clock(Date.UTC(2026, 10, 1, 6, 30)), '01:30');
});

test('the configuration: stops, routes, bounds, nothing unsafe kept', () => {
  assert.equal(stopInput(' 41492 '), '41492');
  assert.equal(stopInput(41492), '41492');
  for (const bad of ['', '../x', 'a:b', 'a.b', 'a b', 'x'.repeat(21), '4149\n2', null]) {
    assert.equal(stopInput(bad), '', JSON.stringify(bad));
  }
  assert.deepEqual(parseRoutes('11, VH 1;12 ;;bad*', 'TRAINS'), ['1', '4']);
  assert.deepEqual(parseRoutes('220,221 t100', 'CITLA'), ['220', '221', 'T100']);
  const c = normalizeConfig({
    api_key: ' key-12345678 ',
    network_1: 'TRAINS',
    stop_1: 'mtl5d',
    network_2: 'NOPE',
    stop_2: '41492',
    network_3: 'CITLA',
    stop_3: '',
    poll_seconds: '5',
    lookahead_minutes: 1.5,
    alerts: 'false',
    language: 'xx',
  });
  assert.equal(c.apiKey, 'key-12345678');
  assert.equal(c.keyValid, true);
  assert.equal(c.pollSeconds, 30);
  assert.equal(c.lookaheadMinutes, 90);
  assert.equal(c.alerts, false);
  assert.equal(c.language, 'fr');
  assert.deepEqual(c.stops[0].stopIds, ['MTL5D']);
  assert.equal(c.stops[0].platform, true);
  assert.equal(c.stops[1].invalid, 'no_network');
  assert.equal(c.stops.length, 2);
  assert.equal(normalizeConfig({ api_key: 'has space inside' }).keyValid, false);
  assert.equal(normalizeConfig({ api_key: 'k\r\nX-Evil: 1' }).keyValid, false);
});

test('the train tables: stations, platforms, lines', () => {
  assert.deepEqual(resolveStop('TRAINS', '11010'), {
    stopIds: ['MTL5D', 'MTL5B'],
    name: 'Centrale',
  });
  assert.deepEqual(resolveStop('TRAINS', 'NEW1A'), { stopIds: ['NEW1A'] });
  assert.deepEqual(resolveStop('CITLA', '41492'), { stopIds: ['41492'] });
  assert.equal(lineOf('TRAINS', '4'), '12');
  assert.equal(lineOf('TRAINS', '9'), '9');
  assert.equal(routeIdOf('TRAINS', 'ma'), '6');
  assert.equal(TRAIN_STATIONS.size, 53);
  for (const s of TRAIN_STATIONS.values()) assert.match(s.code, /^\d{5}$/);
  assert.equal(bytes(1, []).length, 2);
});
