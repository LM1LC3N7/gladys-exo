// -----------------------------------------------------------------------------
// The configuration of the form, normalized: the key of the Chrono portal, the
// language, the pace, the alerts, and up to four stops, each with its network
// and its optional route filter. Nothing here talks to the network.
// -----------------------------------------------------------------------------

import { LANGUAGES, LOOKAHEAD_MINUTES, MAX_STOPS, POLL_SECONDS } from './constants.js';
import { NETWORK_CODES, resolveStop, routeIdOf } from './networks.js';

/** The key: printable ASCII without space, 8 to 128 characters (a header value). */
export const isKey = (value) => typeof value === 'string' && /^[\x21-\x7e]{8,128}$/.test(value);

/** A whole number in its bounds, the default when missing or not a whole number. */
export function bounded(value, { default: fallback, min, max }) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

/**
 * A stop as typed: the number of the stop sign (bus), a station code or a
 * platform stop_id (train). Letters, digits, `_` and `-` only: it becomes part
 * of an external id and is compared to the feed; anything else is no stop.
 */
export function stopInput(value) {
  const raw =
    typeof value === 'string' ? value.trim() : typeof value === 'number' ? `${value}` : '';
  return /^[A-Za-z0-9_-]{1,20}$/.test(raw) ? raw : '';
}

/** Routes of a filter: "11, 12" or "220 221" -> route ids of the network (upper case). */
export function parseRoutes(value, network) {
  if (typeof value !== 'string') return [];
  const routes = value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z0-9_-]{1,12}$/.test(part))
    .map((part) => routeIdOf(network, part).toUpperCase());
  return [...new Set(routes)].slice(0, 20);
}

export function normalizeConfig(config = {}) {
  const c = config && typeof config === 'object' ? config : {};
  const apiKey = typeof c.api_key === 'string' ? c.api_key.trim() : '';
  const stops = [];
  for (let slot = 1; slot <= MAX_STOPS; slot += 1) {
    const input = stopInput(c[`stop_${slot}`]);
    const network = NETWORK_CODES.includes(c[`network_${slot}`]) ? c[`network_${slot}`] : '';
    if (!input) continue;
    if (!network) {
      // A stop without its network is not guessed: the same number exists on
      // two networks (71014: Le Richelain and Chambly).
      stops.push({ slot, input, network: '', invalid: 'no_network' });
      continue;
    }
    stops.push({
      slot,
      input,
      network,
      routes: parseRoutes(c[`routes_${slot}`], network),
      ...resolveStop(network, input),
    });
  }
  return {
    apiKey,
    // Only a well-formed key ever reaches a header: anything else is "malformed".
    keyValid: isKey(apiKey),
    language: LANGUAGES.includes(c.language) ? c.language : 'fr',
    pollSeconds: bounded(c.poll_seconds, POLL_SECONDS),
    lookaheadMinutes: bounded(c.lookahead_minutes, LOOKAHEAD_MINUTES),
    alerts: c.alerts !== false && c.alerts !== 'false',
    stops,
  };
}

/** What a key problem is: undefined when it is there and well-formed. */
export function keyProblem(config) {
  if (!config.apiKey) return 'missing';
  return config.keyValid ? undefined : 'malformed';
}

/** The part of the config that changes what is read (not the key, not the language). */
export const readingKey = (config) =>
  JSON.stringify([config.pollSeconds, config.alerts, config.stops]);
