// -----------------------------------------------------------------------------
// A scripted Chrono API: a small protobuf encoder for GTFS-Realtime, the feeds
// of two networks (trains, Laurentides buses) built around the clock of the
// test, and per-path overrides. Answers are real Response objects.
// -----------------------------------------------------------------------------

/** 2026-11-16 14:02 in Montréal (winter time, UTC-5). */
export const NOW = Date.UTC(2026, 10, 16, 19, 2);
export const API_KEY = 'S3cr3tK3yThatMustNeverLeak0123';
export const OTHER_KEY = 'An0therK3yNeverLeaking4567';

// --- protobuf encoding ---------------------------------------------------------

function varint(value) {
  const out = [];
  let v = BigInt.asUintN(64, BigInt(value));
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return out;
}

const tag = (field, wire) => varint(field * 8 + wire);
export const vint = (field, value) => [...tag(field, 0), ...varint(value)];
export const bytes = (field, payload) => [...tag(field, 2), ...varint(payload.length), ...payload];
export const str = (field, text) => bytes(field, [...Buffer.from(String(text), 'utf8')]);
const msg = (field, ...parts) => bytes(field, parts.flat(Infinity));

/** A FeedMessage: header (timestamp) and entities (already encoded). */
export function feed({ timestamp, entities = [] }) {
  const header = [
    ...str(1, '2.0'),
    ...(timestamp === undefined ? [] : vint(3, Math.floor(timestamp))),
  ];
  return Uint8Array.from([...bytes(1, header), ...entities.flatMap((e) => bytes(2, e))]);
}

/**
 * A TripUpdate entity.
 * @param {{ id: string, tripId?: string, routeId?: string, canceled?: boolean,
 *   stops: { stopId: string, time?: number, delay?: number, arrival?: boolean,
 *   skipped?: boolean, noData?: boolean }[], tripLast?: boolean, deleted?: boolean }} trip
 */
export function tripEntity({ id, tripId = id, routeId, canceled, stops, tripLast, deleted }) {
  const descriptor = msg(
    1,
    str(1, tripId),
    routeId === undefined ? [] : str(5, routeId),
    canceled ? vint(4, 3) : [],
  );
  const updates = stops.map((s, i) => {
    const event = [
      ...(s.delay === undefined ? [] : vint(1, s.delay)),
      ...(s.time === undefined ? [] : vint(2, Math.floor(s.time / 1000))),
    ];
    return msg(
      2,
      vint(1, i + 1),
      s.arrival ? bytes(2, event) : bytes(3, event),
      str(4, s.stopId),
      s.skipped ? vint(5, 1) : s.noData ? vint(5, 2) : [],
    );
  });
  const tu = tripLast ? [...updates.flat(), ...descriptor] : [...descriptor, ...updates.flat()];
  return [...str(1, id), ...(deleted ? vint(2, 1) : []), ...bytes(3, tu)];
}

const translated = (field, texts) =>
  msg(
    field,
    Object.entries(texts).map(([language, text]) =>
      msg(1, str(1, text), language ? str(2, language) : []),
    ),
  );

/**
 * An Alert entity.
 * @param {{ id: string, header?: object, description?: object, severity?: number,
 *   periods?: { start?: number, end?: number }[], entities: object[] }} alert
 */
export function alertEntity({
  id,
  header = {},
  description = {},
  severity,
  periods = [],
  entities,
}) {
  const parts = [
    ...periods.map((p) =>
      msg(
        1,
        p.start === undefined ? [] : vint(1, Math.floor(p.start / 1000)),
        p.end === undefined ? [] : vint(2, Math.floor(p.end / 1000)),
      ),
    ),
    ...entities.map((e) =>
      msg(
        5,
        e.agencyId === undefined ? [] : str(1, e.agencyId),
        e.routeId === undefined ? [] : str(2, e.routeId),
        e.routeType === undefined ? [] : vint(3, e.routeType),
        e.tripId === undefined ? [] : msg(4, str(1, e.tripId)),
        e.stopId === undefined ? [] : str(5, e.stopId),
      ),
    ),
    ...(Object.keys(header).length ? translated(10, header) : []),
    ...(Object.keys(description).length ? translated(11, description) : []),
    ...(severity === undefined ? [] : vint(14, severity)),
  ];
  return [...str(1, id), ...bytes(5, parts.flat(Infinity))];
}

// --- the default world ---------------------------------------------------------

const MIN = 60_000;
/** Departures half a minute past the minute: the countdown does not flip during a round. */
const HALF = 30_000;

/** Trains: line 11 (route 1) at Gare Centrale in 6 min (+4) and 36 min; a cancelled line 12. */
export const trainTrips = (now) => [
  tripEntity({
    id: 't1',
    routeId: '1',
    stops: [
      { stopId: 'MTL5D', time: now + 6 * MIN + HALF, delay: 240 },
      { stopId: 'MTL3A', time: now + 20 * MIN + HALF },
    ],
  }),
  tripEntity({ id: 't2', routeId: '1', stops: [{ stopId: 'MTL5D', time: now + 36 * MIN + HALF }] }),
  tripEntity({
    id: 't3',
    routeId: '4',
    canceled: true,
    stops: [{ stopId: 'MTL5B', time: now + 20 * MIN + HALF }],
  }),
  tripEntity({ id: 't4', routeId: '3', stops: [{ stopId: 'STL1B', time: now + 4 * MIN + HALF }] }),
];

/** Laurentides: route 220 at stop 41492 in 3 min (1 min early), route 221 in 12 min. */
export const busTrips = (now) => [
  tripEntity({
    id: 'b1',
    routeId: '220',
    stops: [{ stopId: '41492', time: now + 3 * MIN + HALF, delay: -60 }],
  }),
  tripEntity({
    id: 'b2',
    routeId: '221',
    stops: [{ stopId: '41492', time: now + 12 * MIN + HALF }],
  }),
  tripEntity({
    id: 'b3',
    routeId: '222',
    stops: [{ stopId: '42714', time: now + 2 * MIN + HALF }],
  }),
];

export const trainAlerts = (now) => [
  alertEntity({
    id: 'a1',
    severity: 3,
    periods: [{ start: now - 60 * MIN, end: now + 120 * MIN }],
    entities: [{ routeId: '1' }],
    header: { fr: 'Ligne 11 : retards de 10 à 15 min', en: 'Line 11: delays of 10 to 15 min' },
  }),
  alertEntity({
    id: 'a2',
    periods: [{ start: now - 120 * MIN, end: now - 60 * MIN }],
    entities: [{ agencyId: 'TRAINS' }],
    header: { fr: 'Avis terminé', en: 'Ended notice' },
  }),
];

export const pb = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/x-protobuf', ...headers },
  });

export const apim = (status, message, headers = {}) =>
  new Response(JSON.stringify({ statusCode: status, message }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * The fake API. `world.override(path, call)` may answer anything first
 * (a Response, 'timeout', 'network', a promise); `world.trips[network]` and
 * `world.alerts[network]` (now -> entities) shape the normal answers;
 * `world.key` is the key it accepts (any other: the gateway's 401).
 */
export function createApi() {
  const world = {
    calls: [],
    key: API_KEY,
    trips: { TRAINS: trainTrips, CITLA: busTrips },
    alerts: { TRAINS: trainAlerts, CITLA: () => [] },
    timestamp: undefined,
    override: undefined,
    hold: false,
    held: [],
    release() {
      const held = world.held;
      world.held = [];
      for (const r of held) r();
    },
    count: (part) => world.calls.filter((c) => c.path.includes(part)).length,
  };
  world.fetch = async (url, init = {}) => {
    const { pathname } = new URL(url);
    const path = pathname.replace(/^\/api\/opendata\/v1/, '');
    const call = { path, url, headers: init.headers, at: world.now?.() };
    world.calls.push(call);
    if (world.hold) await new Promise((r) => world.held.push(r));
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const special = await world.override?.(path, call);
    if (special === 'timeout') throw new DOMException('The operation timed out.', 'TimeoutError');
    if (special === 'network') throw new TypeError('fetch failed');
    if (special) return special;
    if (init.headers?.['Ocp-Apim-Subscription-Key'] !== world.key) {
      return apim(
        401,
        'Access denied due to invalid subscription key. Make sure to provide a valid key for an active subscription.',
      );
    }
    const now = world.now?.() ?? NOW;
    const date = new Date(now).toUTCString();
    const m = /^\/([A-Z]+)\/(tripupdate|alert)$/.exec(path);
    if (m) {
      const source = m[2] === 'tripupdate' ? world.trips[m[1]] : world.alerts[m[1]];
      // The departures stay where they are while the clock of the test moves.
      return pb(
        feed({ timestamp: (world.timestamp ?? now) / 1000, entities: source ? source(NOW) : [] }),
        200,
        { date },
      );
    }
    return new Response('', { status: 404 });
  };
  return world;
}
