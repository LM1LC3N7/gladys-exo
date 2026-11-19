// -----------------------------------------------------------------------------
// Fixed values: the API, the manifest keys, the pace, the limits. Every time is
// in milliseconds unless the name says otherwise.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** The GTFS-Realtime API of the Chrono portal of the ARTM (exo's networks). */
export const API_BASE = 'https://exo.chrono-saeiv.com/api/opendata/v1';
export const USER_AGENT = `gladys-exo/${pkg.version} (+https://github.com/LM1LC3N7/gladys-exo)`;
/** The route that only needs the key: the alerts of the trains (a small feed). */
export const PRINCIPAL = Object.freeze({ network: 'TRAINS', feed: 'alert' });

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** Manifest keys (forever: users store them). */
export const ACTIONS = Object.freeze({ TEST: 'test_connection' });
export const LANGUAGES = Object.freeze(['fr', 'en']);

/** Stop slots of the configuration form. */
export const MAX_STOPS = 4;

/** Bounds of the number fields: [default, min, max]. */
export const POLL_SECONDS = Object.freeze({ default: 60, min: 30, max: 600 });
export const LOOKAHEAD_MINUTES = Object.freeze({ default: 90, min: 15, max: 240 });

/** Two requests never closer than this, whatever asks. One request in flight at a time. */
export const REQUEST_GAP = SECOND;
export const REQUEST_TIMEOUT = 15 * SECOND;
/** A changed configuration still waits this long after the last round. */
export const MIN_ROUND_GAP = 20 * SECOND;
/** Network errors on every network: the next round waits up to this long. */
export const RETRY_MAX = 30 * MINUTE;

/** The alerts change seldom: read at most this often per network. */
export const ALERT_INTERVAL = 5 * MINUTE;
/** An alert feed failing: that feed waits 5 min doubling to 1 h; the departures go on. */
export const ALERT_RETRY_MAX = HOUR;
/** The alerts held are not used any more past this age. */
export const ALERT_STALE = 20 * MINUTE;

/** The departures held are not used any more past this age (or 2.5 intervals). */
export const LIVE_STALE = 10 * MINUTE;
/** A feed whose header is older than this (against the server's Date) is not real time. */
export const FEED_STALE = 15 * MINUTE;
/** A departure this far in the past has left (the feed keeps it a short while). */
export const DEPARTED_GRACE = 30 * SECOND;
/** The boards are published again every minute from what is held (no request). */
export const TICK = MINUTE;

/** 429 and 5xx: the pause of every request, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** A 401/403 on a network while the key is accepted on the principal route: that feed waits. */
export const SECONDARY_MIN = 5 * MINUTE;
export const SECONDARY_MAX = HOUR;
/** A 5xx on the feed of one network: that network waits 1 min doubling to 30 min. */
export const NETWORK_RETRY_MIN = MINUTE;
export const NETWORK_RETRY_MAX = 30 * MINUTE;

/** /data: a slow or unreadable file is read again on this timer, one read at a time. */
export const STORE_RETRY = 10 * SECOND;
/** How long a start waits for /data before going on without it (and without saving). */
export const STORE_WAIT = 5 * SECOND;
/** getConfig() failing: retried for ever, spaced from 5 s to 60 s. */
export const CONFIG_RETRY_MIN = 5 * SECOND;
export const CONFIG_RETRY_MAX = 60 * SECOND;

/** The test button: at most once in this time. */
export const TEST_MIN_GAP = 30 * SECOND;

/** Answer sizes (read bounded, cut beyond); the body of a refusal, read for its reason. */
export const MAX_BYTES = Object.freeze({
  tripupdate: 8 * 1024 * 1024,
  alert: 2 * 1024 * 1024,
  error: 4 * 1024,
});
/** Decoded elements kept per answer (the rest is skipped, never held). */
export const MAX_STOP_TIMES = 5000;
export const MAX_ALERTS = 500;
export const MAX_ENTITIES = 100;
export const MAX_ALERT_TEXT = 4096;

/** Published values. */
export const MIN_DELAY_MINUTES = -60;
export const MAX_DELAY_MINUTES = 1440;
export const MAX_COUNT = 99;
export const MAX_TEXT = 200;
export const MAX_STATUS = 200;
/** Routes seen at a stop, kept to tie a route alert to it (no static timetable here). */
export const MAX_SEEN_ROUTES = 50;
