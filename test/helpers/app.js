// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, the scripted Chrono API and a virtual
// clock that only moves when the test says so (each read of the monotonic
// clock moves 1 µs, so a decision reading it twice is caught).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ExoApp } from '../../src/app.js';
import { registerHandlers } from '../../src/handlers.js';
import { createMemoryStore } from '../../src/store.js';
import { API_KEY, NOW, createApi } from '../fixtures/exo.js';

export const SELECTOR = 'exo';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const DEVICE = (slot = 1, network = 'TRAINS', stop = '11010') =>
  `ext:${SELECTOR}:stop:${slot}-${network}-${stop}`;
export const F = (key, slot = 1, network = 'TRAINS', stop = '11010') =>
  `${DEVICE(slot, network, stop)}:${key}`;
export const CONFIG = { api_key: API_KEY, network_1: 'TRAINS', stop_1: '11010' };
export const TWO = { ...CONFIG, network_2: 'CITLA', stop_2: '41492' };

/** Lets every pending promise run (a few event-loop turns). */
export async function settle(turns = 20) {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r));
}

export function createFakeClock(start) {
  const clock = { now: start };
  let nextId = 1;
  const pending = new Map();
  const timers = {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { fn, at: clock.now + Math.max(0, Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
  };
  async function advance(ms) {
    const target = clock.now + ms;
    await settle();
    for (let i = 0; i < 100_000; i += 1) {
      let next;
      for (const [id, timer] of pending) {
        if (timer.at <= target && (!next || timer.at < next.timer.at)) next = { id, timer };
      }
      if (!next) break;
      pending.delete(next.id);
      clock.now = Math.max(clock.now, next.timer.at);
      next.timer.fn();
      await settle();
    }
    clock.now = Math.max(clock.now, target);
    await settle();
  }
  return { clock, timers, pending, advance };
}

export async function setup({
  config = CONFIG,
  store = createMemoryStore(),
  api = createApi(),
  start = NOW,
  clock: shared,
  devices = [],
  getConfig,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  if (getConfig) gladys.getConfig = getConfig;
  const fake = shared ?? createFakeClock(start);
  let drift = 0;
  api.now = () => fake.clock.now;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  let salt = 0;
  const app = new ExoApp({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    now: () => fake.clock.now,
    monotonic: () => fake.clock.now + (drift += 0.001),
    timers: fake.timers,
    store,
    fetchImpl: api.fetch,
    random: (n) => Buffer.alloc(n, (salt += 1)),
  });
  registerHandlers(gladys, app, { error: log });
  return {
    app,
    gladys,
    api,
    store,
    lines,
    clock: fake.clock,
    timers: fake,
    advance: fake.advance,
    /** Starts as the container does (the `connected` handler), then lets the first round run. */
    async run(ms = 20 * SECOND) {
      await app.connected();
      await fake.advance(ms);
    },
    statuses: () => gladys.fake.connectionStatuses,
    status: () => gladys.fake.connectionStatus,
    last: (id) => gladys.fake.lastState(id),
    states: (id) => gladys.fake.states.filter((s) => s.device_feature_external_id === id),
  };
}
