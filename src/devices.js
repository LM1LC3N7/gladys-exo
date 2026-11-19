// -----------------------------------------------------------------------------
// The device of a watched stop (pure). Read-only features:
//   next       text: "14:05 · 11 · in 4 min · +3 min"
//   next_in    minutes until the next departure that runs
//   delay      minutes of delay of that departure (when the feed gives it)
//   cancelled  cancelled departures (or skipped stop) in the window
//   alerts     active alerts for the stop (when the alerts are on)
//   alert      text of the most severe of them (when the alerts are on)
// External id: `ext:<selector>:stop:<slot>-<NETWORK>-<input>` (the slot of the
// form, the network and the stop as typed): another stop or network in a
// slot makes a new device.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  LOOKAHEAD_MINUTES,
  MAX_COUNT,
  MAX_DELAY_MINUTES,
  MAX_TEXT,
  MIN_DELAY_MINUTES,
} from './constants.js';
import { t } from './i18n.js';
import { clean } from './model.js';
import { NETWORKS, TRAIN_LINES } from './networks.js';
import { clock } from './time.js';

export const DEVICE_TYPE = 'stop';
export const FEATURE = Object.freeze({
  NEXT: 'next',
  NEXT_IN: 'next_in',
  DELAY: 'delay',
  CANCELLED: 'cancelled',
  ALERTS: 'alerts',
  ALERT: 'alert',
});

export const platformId = (stop) => `${stop.slot}-${stop.network}-${stop.input}`;
export const idsOf = (gladys, stop) => gladys.externalIds(DEVICE_TYPE, platformId(stop));

const sensor = (feature) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...feature,
});

/** The lines of a filter as people say them ("11" for the train route 1). */
function filterText(stop) {
  return stop.routes
    .map((id) => (stop.network === 'TRAINS' ? (TRAIN_LINES[id]?.line ?? id) : id))
    .join(', ');
}

/** "exo Trains – Centrale (11)", "exo Laurentides – stop 41492". */
export function deviceName(stop, language = 'fr') {
  const network = NETWORKS[stop.network]?.[language] ?? stop.network;
  const place = stop.name
    ? `${stop.name}${stop.platform ? ` ${stop.input.toUpperCase()}` : ''}`
    : `${t('stop', language)} ${stop.input}`;
  const filter = filterText(stop);
  return clean(`exo ${network} – ${place}${filter ? ` (${filter})` : ''}`, 80);
}

export function buildDevice(gladys, stop, { language = 'fr', alerts = true } = {}) {
  const ids = idsOf(gladys, stop);
  const features = [
    sensor({
      name: t('featureNext', language),
      external_id: ids.feature(FEATURE.NEXT),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      keep_history: false,
      min: 0,
      max: 0,
    }),
    sensor({
      name: t('featureNextIn', language),
      external_id: ids.feature(FEATURE.NEXT_IN),
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: DEVICE_FEATURE_UNITS.MINUTES,
      keep_history: false,
      min: 0,
      max: LOOKAHEAD_MINUTES.max,
    }),
    sensor({
      name: t('featureDelay', language),
      external_id: ids.feature(FEATURE.DELAY),
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: DEVICE_FEATURE_UNITS.MINUTES,
      min: MIN_DELAY_MINUTES,
      max: MAX_DELAY_MINUTES,
    }),
    sensor({
      name: t('featureCancelled', language),
      external_id: ids.feature(FEATURE.CANCELLED),
      category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
      min: 0,
      max: MAX_COUNT,
    }),
  ];
  if (alerts) {
    features.push(
      sensor({
        name: t('featureAlerts', language),
        external_id: ids.feature(FEATURE.ALERTS),
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        min: 0,
        max: MAX_COUNT,
      }),
      sensor({
        name: t('featureAlert', language),
        external_id: ids.feature(FEATURE.ALERT),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        keep_history: false,
        min: 0,
        max: 0,
      }),
    );
  }
  return {
    name: deviceName(stop, language),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'EXO_NETWORK', value: stop.network },
      { name: 'EXO_STOP', value: stop.input },
      { name: 'EXO_SLOT', value: String(stop.slot) },
    ],
    features,
  };
}

/** Whole minutes of a delay in seconds, within the feature bounds. */
export const delayMinutes = (seconds) =>
  Math.min(MAX_DELAY_MINUTES, Math.max(MIN_DELAY_MINUTES, Math.round(seconds / 60)));

/** "14:05 · 11 · in 4 min · +3 min" (the time shown is the predicted one). */
export function describe(departure, { now, language }) {
  const minutes = Math.max(0, Math.floor((departure.time - now) / 60000));
  const parts = [
    clock(departure.time),
    `${t('line', language)} ${departure.line}`,
    t('inMinutes', language, { minutes }),
  ];
  if (departure.delay !== undefined) {
    const delay = delayMinutes(departure.delay);
    parts.push(
      delay > 0
        ? `+${delay} min`
        : delay < 0
          ? t('early', language, { minutes: -delay })
          : t('onTime', language),
    );
  } else {
    // The Delay feature keeps its last value (Gladys has no "unknown"): the
    // text says this departure's delay is not known.
    parts.push(t('delayUnknown', language));
  }
  return clean(parts.join(' · '), MAX_TEXT);
}

/**
 * The states of a board (undefined: nothing fresh held). Only what is known: no next departure leaves
 * `next_in` and `delay` unpublished (never a 0 for "none"), a delay the feed
 * does not give stays unpublished, alerts not held stay unpublished.
 */
export function statesOf(gladys, stop, board, { now, language, lookaheadMinutes, alerts }) {
  const ids = idsOf(gladys, stop);
  const states = [];
  if (board && !board.predicted) {
    // The feed has nothing for the stop: said in the text, nothing counted.
    states.push({
      device_feature_external_id: ids.feature(FEATURE.NEXT),
      text: t('noPrediction', language),
    });
  } else if (board) {
    const next = board.departures[0];
    states.push(
      {
        device_feature_external_id: ids.feature(FEATURE.NEXT),
        text: next
          ? describe(next, { now, language })
          : t('none', language, { minutes: lookaheadMinutes }),
      },
      { device_feature_external_id: ids.feature(FEATURE.CANCELLED), state: board.cancelled },
    );
    if (next) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE.NEXT_IN),
        state: Math.min(LOOKAHEAD_MINUTES.max, Math.max(0, Math.floor((next.time - now) / 60000))),
      });
      if (next.delay !== undefined) {
        states.push({
          device_feature_external_id: ids.feature(FEATURE.DELAY),
          state: delayMinutes(next.delay),
        });
      }
    }
  }
  if (alerts) {
    states.push(
      { device_feature_external_id: ids.feature(FEATURE.ALERTS), state: alerts.count },
      {
        device_feature_external_id: ids.feature(FEATURE.ALERT),
        text: alerts.count
          ? clean(alerts.text, MAX_TEXT) || t('alertNoText', language)
          : t('noAlert', language),
      },
    );
  }
  return states;
}
