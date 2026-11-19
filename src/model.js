// -----------------------------------------------------------------------------
// The board of a stop and its alerts, from what the feeds gave (pure).
//
// Departures: the stop time updates of the stop's ids, route filter applied,
// from a trip that runs (not CANCELED), which serves the stop (not SKIPPED,
// not NO_DATA) and carries a time (the predicted departure, else arrival),
// between "just left" and the end of the window. A cancelled trip or a skipped
// stop with a time in the window counts as cancelled. No static timetable is
// read: a stop time without a time (a delay alone) cannot be placed, it is
// left out.
//
// Alerts: active now (an active period holds now, or none is given), and tied
// to the stop: every field the selector gives must match (the GTFS-Realtime
// rule); a selector of the network alone (agency, or the route type of the
// network) matches every stop of it; a route matches when it is in the filter
// of the stop or, without a filter, among the routes seen at the stop.
// -----------------------------------------------------------------------------

import { DEPARTED_GRACE, MAX_COUNT, MAX_SEEN_ROUTES, MINUTE } from './constants.js';
import { STOP_SCHEDULE_RELATIONSHIP, TRIP_SCHEDULE_RELATIONSHIP } from './gtfs.js';
import { lineOf, NETWORKS } from './networks.js';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

/** A text from the feed made safe to publish: no control character, one line, bounded. */
export function clean(value, max) {
  const text = String(value ?? '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The board of a stop at `now` (ms).
 * @param {object[]} stopTimes decoded stop times of the stop's network
 * @param {{ network: string, stopIds: string[], routes: string[] }} stop
 * @returns {{ departures: object[], cancelled: number, predicted: boolean }}
 */
export function boardOf(stopTimes, stop, { now, lookaheadMinutes }) {
  const ids = new Set(stop.stopIds);
  const from = now - DEPARTED_GRACE;
  const to = now + lookaheadMinutes * MINUTE;
  const departures = [];
  const cancelledTrips = new Set();
  // Any prediction for the stop (and its routes), whatever its time: without
  // one, the feed says nothing about the stop (a typo, a bus not tracked), which
  // is not "no departure".
  let predicted = false;
  for (const st of stopTimes) {
    if (!ids.has(st.stopId)) continue;
    const routeId = String(st.routeId ?? '').toUpperCase();
    if (stop.routes.length && !stop.routes.includes(routeId)) continue;
    predicted = true;
    const event = finite(st.departure?.time) ? st.departure : st.arrival;
    const time = finite(event?.time) && event.time > 0 ? event.time * 1000 : undefined;
    if (time === undefined || time < from || time > to) continue;
    const key = `${st.tripId ?? ''}|${st.stopId}|${time}`;
    if (
      st.tripScheduleRelationship === TRIP_SCHEDULE_RELATIONSHIP.CANCELED ||
      st.scheduleRelationship === STOP_SCHEDULE_RELATIONSHIP.SKIPPED
    ) {
      cancelledTrips.add(key);
      continue;
    }
    if (st.scheduleRelationship === STOP_SCHEDULE_RELATIONSHIP.NO_DATA) continue;
    departures.push({
      time,
      line: lineOf(stop.network, st.routeId),
      tripId: st.tripId,
      // Seconds of delay the feed gives (signed: early is negative); none = unknown.
      delay: finite(event.delay) ? event.delay : undefined,
    });
  }
  departures.sort((a, b) => a.time - b.time);
  // One trip at one stop once (a feed repeating an update is not two buses).
  const seen = new Set();
  const unique = departures.filter((d) => {
    const key = `${d.tripId ?? d.time}|${d.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    departures: unique,
    cancelled: Math.min(MAX_COUNT, cancelledTrips.size),
    predicted,
  };
}

/** The routes seen at the stop in a read, merged into `seen` (bounded, most recent kept). */
export function routesSeen(stopTimes, stop, seen = []) {
  const ids = new Set(stop.stopIds);
  const out = [...seen];
  for (const st of stopTimes) {
    if (!ids.has(st.stopId) || !st.routeId) continue;
    const route = String(st.routeId).toUpperCase();
    const at = out.indexOf(route);
    if (at >= 0) out.splice(at, 1);
    out.push(route);
  }
  return out.slice(-MAX_SEEN_ROUTES);
}

/** Whether an alert is active at `now` (ms). */
export function activeAt(alert, now) {
  if (!alert.periods.length) return true;
  const s = now / 1000;
  return alert.periods.some(
    (p) =>
      (!p.start || p.start <= s) &&
      (!p.end || p.end >= s) &&
      (!p.start || !p.end || p.start <= p.end),
  );
}

/** Whether a selector of an alert names the stop. */
export function selects(selector, stop, { routes, trips }) {
  const fields = ['agencyId', 'routeId', 'routeType', 'tripId', 'stopId'].filter(
    (k) => selector[k] !== undefined && selector[k] !== '',
  );
  if (!fields.length) return false;
  if (
    selector.stopId !== undefined &&
    selector.stopId !== '' &&
    !stop.stopIds.includes(selector.stopId)
  )
    return false;
  if (selector.routeId !== undefined && selector.routeId !== '') {
    if (!routes.includes(String(selector.routeId).toUpperCase())) return false;
  }
  if (selector.routeType !== undefined) {
    // GTFS route types: 2 is rail, 3 bus (and the extended 100-117 rail, 700-716 bus).
    const rail =
      selector.routeType === 2 || (selector.routeType >= 100 && selector.routeType < 200);
    const bus = selector.routeType === 3 || (selector.routeType >= 700 && selector.routeType < 800);
    if (NETWORKS[stop.network]?.rail ? !rail : !bus) return false;
  }
  if (selector.tripId !== undefined && selector.tripId !== '' && !trips.has(selector.tripId))
    return false;
  // The agency of a feed is the network of the feed: it never narrows.
  return true;
}

/** The text of a translated string in a language: exact or prefix, else untagged, else first. */
export function pick(translations, language) {
  const usable = translations.filter((t) => t.text && t.text.trim());
  const found =
    usable.find((t) => t.language === language) ??
    usable.find((t) => t.language.startsWith(`${language}-`)) ??
    usable.find((t) => !t.language) ??
    usable[0];
  return found?.text ?? '';
}

/**
 * The alerts of a stop now, the most severe first: `{ count, text }`.
 * @param {object[]} alerts decoded alerts of the stop's network
 */
export function alertsOf(alerts, stop, { now, language, routes, trips = new Set() }) {
  const matching = alerts.filter(
    (a) => activeAt(a, now) && a.entities.some((e) => selects(e, stop, { routes, trips })),
  );
  // SeverityLevel: 4 SEVERE, 3 WARNING, 2 INFO, 1 UNKNOWN (absent: unknown).
  const ranked = matching
    .map((a, i) => ({ a, i, severity: Number.isInteger(a.severity) ? a.severity : 1 }))
    .sort((x, y) => y.severity - x.severity || x.i - y.i);
  const first = ranked[0]?.a;
  const text = first ? pick(first.header, language) || pick(first.description, language) : '';
  return { count: Math.min(MAX_COUNT, matching.length), text };
}
