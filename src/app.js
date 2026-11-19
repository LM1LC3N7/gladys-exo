// -----------------------------------------------------------------------------
// The integration: up to four exo stops read from the GTFS-Realtime feeds of
// the Chrono portal of the ARTM, one Gladys device per stop (next departure,
// minutes until it, its delay, the cancelled departures, the service alerts),
// the test button. Read-only: only GET requests, nothing is ever changed.
// index.js wires the SDK handlers to it (src/handlers.js).
//
// One round = for each network of the watched stops (the one tried least
// recently first): its TripUpdates feed (one answer for every stop of the
// network), then, when the alerts are on and due (every 5 min), its Alerts
// feed. Rounds are an interval apart, start to start, whatever asks (a
// reconnection, a save of the form, the test button, a restart: the time of
// the last round is in /data). One request in flight at a time, two requests
// at least REQUEST_GAP apart.
//
// The key: a 401/403 of a network feed is asked again on the principal route
// (the alerts of the trains, which only need the key): refused there, the
// refusal is kept in /data as 8 bits of a salted hash and never retried
// automatically (lifted by another key or a success of the test button);
// accepted there, only that network waits (5 min doubling to 1 h). A 401/403
// of an alert feed right after its network was read with the same key is
// never a refusal: those alerts wait. 429 and the gateway's quota answers
// pause every request (1 min to 6 h, the wait asked is honoured), kept in
// /data; a 5xx holds its network only, unless every network tried is in 5xx.
//
// Two clocks: `now` (wall clock) gives the times of the departures, the age
// of a feed against the server's Date and what /data keeps; `monotonic` paces
// the rounds, the requests, the pauses and the freshness of what is held.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { keyProblem, normalizeConfig, readingKey } from './config.js';
import {
  ALERT_INTERVAL,
  ALERT_RETRY_MAX,
  ALERT_STALE,
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  FEED_STALE,
  LIVE_STALE,
  MAX_STATUS,
  MIN_ROUND_GAP,
  NETWORK_RETRY_MAX,
  NETWORK_RETRY_MIN,
  PAUSE_MAX,
  PAUSE_MIN,
  PRINCIPAL,
  REQUEST_GAP,
  RETRY_MAX,
  SECOND,
  SECONDARY_MAX,
  SECONDARY_MIN,
  STORE_RETRY,
  STORE_WAIT,
  TEST_MIN_GAP,
  TICK,
} from './constants.js';
import { ChronoClient, ChronoError } from './client.js';
import { buildDevice, statesOf } from './devices.js';
import { decodeAlerts, decodeTripUpdates } from './gtfs.js';
import { both, t } from './i18n.js';
import { alertsOf, boardOf, routesSeen } from './model.js';
import { FileStore } from './store.js';
import { clock } from './time.js';

const TIMED_OUT = Symbol('timed out');

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** 8 bits of a salted hash of the key: nothing to find it back from. */
export const tagOf = (salt, apiKey) =>
  createHash('sha256').update(`${salt}\u0000${apiKey}`, 'utf8').digest()[0];

/** A pause read back from /data, its rest capped to PAUSE_MAX; undefined when invalid. */
export function validPause(pause, now, mono) {
  if (
    !pause ||
    !finite(pause.until) ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  const left = Math.min(Math.max(0, pause.until - now), PAUSE_MAX);
  return {
    until: now + left,
    due: mono + left,
    count: Math.min(pause.count, 16),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

export function validRefused(refused) {
  return refused &&
    typeof refused.salt === 'string' &&
    /^[0-9a-f]{32}$/.test(refused.salt) &&
    Number.isInteger(refused.tag) &&
    refused.tag >= 0 &&
    refused.tag < 256
    ? {
        salt: refused.salt,
        tag: refused.tag,
        status: refused.status === 401 || refused.status === 403 ? refused.status : 401,
      }
    : undefined;
}

const bound = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function newNetwork(code) {
  return {
    code,
    live: undefined,
    alerts: undefined,
    alertsDue: -Infinity,
    alertWait: undefined,
    alertProblem: undefined,
    problem: undefined,
    lastTried: -Infinity,
    okRound: 0,
    wait: undefined,
  };
}

export class ExoApp {
  constructor({
    gladys,
    logger = console,
    now = () => Date.now(),
    monotonic = () => performance.now(),
    timers = { setTimeout, clearTimeout },
    store = new FileStore(),
    fetchImpl = globalThis.fetch,
    random = (n) => randomBytes(n),
    requestTimeout,
    apiBase,
  }) {
    this.gladys = gladys;
    this.log = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.random = random;
    this.requestTimeout = requestTimeout;
    this.apiBase = apiBase;

    this.gen = 0;
    this.stopped = false;
    this.config = normalizeConfig({});
    this.readingKey = undefined;
    this.client = undefined;
    this.slots = [];
    this.invalid = [];
    this.nets = new Map();

    this.data = { lastRound: null, pause: null, refused: null };
    this.storeState = 'pending';
    this.loading = null;
    this.storeTimer = null;

    this.pause = undefined;
    this.refused = undefined;
    this.lastRoundMono = undefined;
    this.round_ = 0;
    this.failures = 0;
    this.stopEpoch = 0;
    this.tickTimer = null;

    this.lane = Promise.resolve();
    this.lastRequestMono = -Infinity;
    this.sleeps = new Set();
    this.abort = new AbortController();
    this.roundTimer = null;
    this.configTimer = null;
    this.configDelay = 0;
    this.running = Promise.resolve();
    this.lastStatus = undefined;
    this.lastTest = undefined;
  }

  gone(gen) {
    return this.stopped || gen !== this.gen;
  }

  // --- Lifecycle -------------------------------------------------------------------

  /** Every (re)connection to Gladys: read the config (retried for ever), then start. */
  async connected() {
    // A stop while getConfig() waits wins: nothing starts again after it.
    const epoch = this.stopEpoch;
    this.stopped = false;
    this.lastStatus = undefined;
    // What Gladys holds may be older than this process knows: everything is
    // published again by the next round or tick (never now: nothing stale as new).
    this.gladys.forgetPublishedStates?.();
    if (this.configTimer) {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = null;
    }
    let config;
    try {
      config = await this.gladys.getConfig();
    } catch (err) {
      if (this.stopped || epoch !== this.stopEpoch) return;
      this.configDelay = Math.min(
        CONFIG_RETRY_MAX,
        Math.max(CONFIG_RETRY_MIN, this.configDelay * 2),
      );
      this.log.warn(
        `Configuration not read (${err?.name ?? 'Error'}): again in ${this.configDelay / 1000} s`,
      );
      await this.setStatus(false, both('configUnread'));
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = null;
        this.connected().catch((e) => this.log.error(`Start failed (${e?.name ?? 'Error'})`));
      }, this.configDelay);
      return;
    }
    if (epoch !== this.stopEpoch) return;
    this.configDelay = 0;
    await this.start(config);
  }

  async start(rawConfig) {
    this.stopped = false;
    const gen = ++this.gen;
    const config = normalizeConfig(rawConfig);
    const keyChanged = config.apiKey !== this.config.apiKey;
    const key = readingKey(config);
    const changed = keyChanged || key !== this.readingKey;
    // A key changed in this process: always tried, even when its 8-bit tag
    // matches the refused one (a restart keeps the tag only).
    if (keyChanged && this.config.apiKey && this.refused) {
      this.refused = undefined;
      this.data.refused = null;
    }
    this.config = config;
    this.readingKey = key;
    // After a stop, the requests of the new start need a live signal.
    if (this.abort.signal.aborted) this.abort = new AbortController();
    if (keyChanged || !this.client) {
      this.abort.abort();
      this.abort = new AbortController();
      this.client = config.keyValid
        ? new ChronoClient({
            apiKey: config.apiKey,
            fetchImpl: this.fetchImpl,
            ...(this.requestTimeout ? { timeout: this.requestTimeout } : {}),
            ...(this.apiBase ? { base: this.apiBase } : {}),
          })
        : undefined;
      for (const net of this.nets.values()) {
        net.wait = undefined;
        net.alertWait = undefined;
        net.alertsDue = -Infinity;
      }
      this.failures = 0;
    }
    const old = this.slots;
    this.slots = config.stops
      .filter((s) => !s.invalid)
      .map((stop) => {
        const kept = old.find(
          (s) => s.slot === stop.slot && s.network === stop.network && s.input === stop.input,
        );
        return { ...stop, seenRoutes: kept?.seenRoutes ?? [] };
      });
    this.invalid = config.stops.filter((s) => s.invalid);
    const nets = new Map();
    for (const slot of this.slots) {
      nets.set(slot.network, this.nets.get(slot.network) ?? newNetwork(slot.network));
    }
    this.nets = nets;
    this.clearRound();
    await this.ready();
    if (this.gone(gen)) return;
    await this.publishDiscovery(gen);
    if (this.gone(gen)) return;
    this.schedule(gen, changed);
    this.armTick(gen);
    await this.report(gen);
  }

  /** Every minute, the boards again from what is held (no request): `next_in` moves. */
  armTick(gen) {
    if (this.tickTimer) this.timers.clearTimeout(this.tickTimer);
    this.tickTimer = this.timers.setTimeout(() => {
      this.tickTimer = null;
      if (this.gone(gen)) return;
      this.publishBoards(gen)
        .catch(() => {})
        .then(() => {
          if (!this.gone(gen)) this.armTick(gen);
        });
    }, TICK);
  }

  async stop() {
    this.stopped = true;
    this.stopEpoch += 1;
    this.gen += 1;
    this.clearRound();
    if (this.tickTimer) this.timers.clearTimeout(this.tickTimer);
    this.tickTimer = null;
    for (const timer of [this.configTimer, this.storeTimer]) {
      if (timer) this.timers.clearTimeout(timer);
    }
    this.configTimer = null;
    this.storeTimer = null;
    this.abort.abort();
    for (const wake of this.sleeps) wake();
    this.sleeps.clear();
    await this.running.catch(() => {});
    await this.bounded(Promise.resolve(this.store.flush?.()), STORE_WAIT).catch(() => {});
  }

  /** `promise`, or TIMED_OUT after `ms` (the timer is cleared either way). */
  bounded(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => resolve(TIMED_OUT), ms);
      promise.then(
        (value) => {
          this.timers.clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          this.timers.clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /** Resolves after `ms` (injected timers), or at once when the app stops. */
  sleep(ms) {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const wake = () => {
        this.timers.clearTimeout(timer);
        this.sleeps.delete(wake);
        resolve();
      };
      timer = this.timers.setTimeout(wake, Math.max(0, ms));
      this.sleeps.add(wake);
    });
  }

  // --- /data ----------------------------------------------------------------------

  /** Waits for /data at most STORE_WAIT; without it, nothing is ever saved. */
  async ready() {
    if (this.storeState === 'ok') return;
    const result = await this.bounded(this.loadStore(), STORE_WAIT);
    // A read that hangs is "unreadable" until it answers (one read at a time).
    if (result === TIMED_OUT && this.storeState === 'pending') this.storeState = 'unreadable';
  }

  /** One read of /data at a time; an unreadable one is read again every STORE_RETRY. */
  loadStore() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await this.store.load();
        const late = this.storeState === 'unreadable';
        this.merge(raw);
        this.storeState = 'ok';
        if (late) await this.afterLateLoad();
      } catch (err) {
        this.storeState = 'unreadable';
        this.log.warn(
          `/data unreadable (${err?.name ?? 'Error'}): read again in ${STORE_RETRY / 1000} s`,
        );
      } finally {
        this.loading = null;
      }
      if (this.storeState !== 'ok' && !this.stopped && !this.storeTimer) {
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = null;
          this.loadStore();
        }, STORE_RETRY);
      }
    })();
    return this.loading;
  }

  async afterLateLoad() {
    if (this.storeState !== 'ok' || this.stopped) return;
    const gen = this.gen;
    // What happened while /data was unreadable is saved now.
    await this.save();
    if (this.isRefused()) this.clearRound();
    // The round waiting for /data is placed again from what it holds (its
    // last round, its pause).
    else if (this.roundTimer) this.schedule(gen);
    await this.report(gen);
  }

  /** /data read back, merged with what this process learnt meanwhile (the stricter wins). */
  merge(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const now = this.now();
    const mono = this.monotonic();
    if (
      finite(data.lastRound) &&
      !(finite(this.data.lastRound) && this.data.lastRound > data.lastRound)
    ) {
      this.data.lastRound = data.lastRound;
    }
    const pause = validPause(data.pause, now, mono);
    if (pause && !(this.pause && this.pause.until >= pause.until)) {
      this.pause = pause;
      this.data.pause = {
        until: pause.until,
        count: pause.count,
        code: pause.code,
        status: pause.status,
      };
    }
    const refused = validRefused(data.refused);
    if (refused && !this.refused) {
      this.refused = refused;
      this.data.refused = refused;
    }
  }

  async save() {
    if (this.storeState !== 'ok') return false;
    const snapshot = {
      version: 1,
      lastRound: this.data.lastRound,
      pause: this.data.pause,
      refused: this.data.refused,
    };
    try {
      // A slow volume never holds a round: the write goes on in the background.
      const done = this.store.save(snapshot);
      done.catch((err) => this.log.warn(`/data not saved (${err?.name ?? 'Error'})`));
      return (
        (await this.bounded(
          done.then(() => true),
          STORE_WAIT,
        )) === true
      );
    } catch (err) {
      this.log.warn(`/data not saved (${err?.name ?? 'Error'})`);
      return false;
    }
  }

  // --- Pace ------------------------------------------------------------------------

  intervalMs() {
    return this.config.pollSeconds * SECOND;
  }

  clearRound() {
    if (this.roundTimer) {
      this.timers.clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
  }

  /** The next round: an interval after the last one (whatever asks), never during a pause. */
  schedule(gen, changed = false) {
    if (this.gone(gen)) return;
    const mono = this.monotonic();
    const interval = this.intervalMs();
    let due;
    if (this.lastRoundMono !== undefined) {
      const wait = changed
        ? Math.min(MIN_ROUND_GAP, interval)
        : Math.min(Math.max(RETRY_MAX, interval), interval * 2 ** Math.min(this.failures, 6));
      due = this.lastRoundMono + wait;
    } else {
      const last = this.data.lastRound;
      const now = this.now();
      if (this.storeState !== 'ok') {
        // /data not read: its last round is unknown, a whole interval is waited.
        due = mono + interval;
      } else {
        // A time of /data in the future is invalid: ignored.
        due = finite(last) && last <= now ? mono + Math.max(0, interval - (now - last)) : mono;
      }
    }
    if (this.pause) due = Math.max(due, this.pause.due);
    this.clearRound();
    this.dueMono = Math.max(due, mono);
    this.roundTimer = this.timers.setTimeout(() => {
      this.roundTimer = null;
      this.running = this.round(gen).catch((err) =>
        this.log.error(`Round failed (${err?.name ?? 'Error'})`),
      );
    }, this.dueMono - mono);
  }

  pauseActive(mono = this.monotonic()) {
    return Boolean(this.pause && this.pause.due > mono);
  }

  isRefused() {
    return Boolean(
      this.refused && this.refused.tag === tagOf(this.refused.salt, this.config.apiKey),
    );
  }

  liveStale() {
    return Math.max(LIVE_STALE, 2.5 * this.intervalMs());
  }

  // --- Requests --------------------------------------------------------------------

  /**
   * One request at a time, REQUEST_GAP apart. A pause or a refusal set while
   * waiting stops it before it is sent; so does a new configuration.
   */
  request(gen, call, { ignoreRefusal = false, principal = false } = {}) {
    const run = async () => {
      const wait = this.lastRequestMono + REQUEST_GAP - this.monotonic();
      if (wait > 0) await this.sleep(wait);
      if (this.gone(gen) || !this.client) throw new ChronoError('aborted');
      if (this.pauseActive()) throw new ChronoError('paused');
      if (!ignoreRefusal && this.isRefused()) throw new ChronoError('final_refused');
      this.lastRequestMono = this.monotonic();
      try {
        return await call(this.client, this.abort.signal);
      } catch (err) {
        // Decided before the next request of the lane may go: a 429 or a quota
        // pauses it, so does a 5xx of the principal route; a refusal of the
        // principal route stops it (saved by the caller).
        if (!this.gone(gen)) {
          if (err?.code === 'rate_limited' || (err?.code === 'server' && principal)) {
            this.notePause(err);
          }
          if (err?.code === 'refused' && principal) this.noteRefused(err.status);
        }
        throw err;
      }
    };
    const job = this.lane.then(run, run);
    this.lane = job.catch(() => {});
    return job;
  }

  /** The pause of a 429/quota/5xx, in memory at once (setPause saves it). */
  notePause(err) {
    if (err.pauseNoted) return;
    err.pauseNoted = true;
    const count = (this.pause?.count ?? 0) + 1;
    const asked = finite(err.retryAfter) ? err.retryAfter : PAUSE_MIN * 2 ** (count - 1);
    const wait = Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, asked));
    const until = this.now() + wait;
    this.pause = {
      until,
      due: this.monotonic() + wait,
      count,
      code: err.code,
      status: err.status ?? null,
    };
    this.data.pause = { until, count, code: err.code, status: err.status ?? null };
    this.log.warn(
      `The Chrono portal asked to wait (${err.code}, HTTP ${err.status}): paused ${Math.round(wait / 1000)} s`,
    );
  }

  async setPause(err) {
    this.notePause(err);
    await this.save();
  }

  /** A refusal of the current key, in memory at once (refuse saves it). */
  noteRefused(status) {
    if (this.isRefused()) return;
    const salt = this.random(16).toString('hex');
    this.refused = { salt, tag: tagOf(salt, this.config.apiKey), status };
    this.data.refused = this.refused;
    this.clearRound();
    this.log.warn(`The Chrono portal refused the key (HTTP ${status}): no automatic retry`);
  }

  async refuse(status) {
    this.noteRefused(status);
    await this.save();
  }

  // --- Rounds ----------------------------------------------------------------------

  async round(gen) {
    if (this.gone(gen)) return;
    const mono = this.monotonic();
    if (keyProblem(this.config) || !this.slots.length || this.isRefused()) {
      await this.report(gen);
      return;
    }
    if (this.pauseActive(mono)) {
      this.schedule(gen);
      return;
    }
    this.lastRoundMono = mono;
    this.round_ += 1;
    const round = this.round_;
    // The time of the attempt is kept before the first request.
    this.data.lastRound = this.now();
    await this.save();
    if (this.gone(gen)) return;
    let stop;
    let tried = 0;
    let serverFailed = 0;
    let lastServer;
    const order = [...this.nets.values()].sort((a, b) => a.lastTried - b.lastTried);
    for (const net of order) {
      if (net.wait && net.wait.due > this.monotonic()) continue;
      net.lastTried = this.monotonic();
      tried += 1;
      try {
        await this.readNetwork(gen, net, round);
        if (net.problem?.code === 'server_network') {
          serverFailed += 1;
          lastServer = net.lastServer;
        }
      } catch (err) {
        if (this.gone(gen) || err?.code === 'aborted') return;
        const code = err instanceof ChronoError ? err.code : 'bad_response';
        if (code === 'rate_limited' || code === 'server') {
          await this.setPause(err);
          stop = 'pause';
          break;
        }
        if (code === 'paused') {
          stop = 'pause';
          break;
        }
        if (code === 'final_refused') {
          stop = 'refused';
          break;
        }
        net.problem = { code, status: err.status };
      }
      if (this.gone(gen)) return;
    }
    if (this.gone(gen)) return;
    const ok = [...this.nets.values()].some((n) => n.okRound === round);
    if (!stop) {
      this.failures = ok ? 0 : this.failures + 1;
      if (!ok && tried > 0 && serverFailed === tried && lastServer) {
        // Every network tried answered 5xx: the portal itself is down, all wait.
        await this.setPause(lastServer);
      }
    }
    if (ok && this.pause && !this.pauseActive()) {
      // A network read: the pause count starts again from 1 min.
      this.pause = undefined;
      this.data.pause = null;
      await this.save();
    }
    await this.publishBoards(gen);
    if (this.gone(gen)) return;
    if (stop !== 'refused') this.schedule(gen);
    await this.report(gen);
  }

  /** The stop ids watched on a network (every slot of it). */
  watchedIds(code) {
    return [...new Set(this.slots.filter((s) => s.network === code).flatMap((s) => s.stopIds))];
  }

  async readNetwork(gen, net, round) {
    let answer;
    try {
      answer = await this.request(gen, (c, signal) => c.feed(net.code, 'tripupdate', signal));
    } catch (err) {
      if (err?.code === 'refused') return this.secondary(gen, net, err);
      if (err?.code === 'server' && !this.gone(gen)) return this.holdNetwork(net, err);
      throw err;
    }
    if (this.gone(gen)) return;
    const ids = this.watchedIds(net.code);
    let decoded;
    try {
      decoded = decodeTripUpdates(answer.body, ids);
    } catch {
      throw new ChronoError('bad_response');
    }
    const now = this.now();
    // The age of the feed against the server's own clock (ours when it gives
    // none); without a readable timestamp, never "out of date".
    const reference = answer.date ?? now;
    if (finite(decoded.timestamp) && decoded.timestamp > 0) {
      const age = reference - decoded.timestamp * 1000;
      if (age > FEED_STALE) {
        net.problem = { code: 'stale_feed', at: decoded.timestamp * 1000 };
        return;
      }
    }
    if (decoded.truncated) {
      this.log.warn(`Network ${net.code}: more stop times than kept, the latest ones dropped`);
    }
    net.live = {
      stopTimes: decoded.stopTimes,
      ids: new Set(ids),
      at: now,
      mono: this.monotonic(),
    };
    for (const slot of this.slots) {
      if (slot.network === net.code)
        slot.seenRoutes = routesSeen(decoded.stopTimes, slot, slot.seenRoutes);
    }
    net.wait = undefined;
    net.problem = undefined;
    net.okRound = round;
    this.log.debug?.(
      `Network ${net.code}: ${answer.body.length} bytes, ${decoded.stopTimes.length} stop time(s)`,
    );
    if (this.config.alerts) await this.readAlerts(gen, net);
  }

  /**
   * The alerts of a network, after its departures were read with the same key:
   * optional. A 429 or a quota pauses all (a quota is the key's); anything
   * else holds these alerts only (5 min doubling to 1 h), the departures go on.
   */
  async readAlerts(gen, net) {
    if (this.monotonic() < net.alertsDue) return;
    let answer;
    try {
      answer = await this.request(gen, (c, signal) => c.feed(net.code, 'alert', signal));
      if (this.gone(gen)) return;
      const decoded = decodeAlerts(answer.body);
      net.alerts = { list: decoded.alerts, at: this.now(), mono: this.monotonic() };
      net.alertsDue = this.monotonic() + ALERT_INTERVAL;
      net.alertWait = undefined;
      net.alertProblem = undefined;
    } catch (err) {
      const code = err instanceof ChronoError ? err.code : 'bad_response';
      if (this.gone(gen) || code === 'aborted') return;
      if (code === 'rate_limited' || code === 'paused' || code === 'final_refused') throw err;
      const delay = net.alertWait ? Math.min(ALERT_RETRY_MAX, net.alertWait * 2) : ALERT_INTERVAL;
      net.alertWait = delay;
      net.alertsDue = this.monotonic() + delay;
      net.alertProblem = {
        code: err?.status ? `HTTP ${err.status}` : code,
        until: this.now() + delay,
      };
      this.log.warn(`Alerts of ${net.code} not read (${code}): again in ${delay / 1000} s`);
    }
  }

  /** A 401/403 on a network feed: the key is asked again on the principal route. */
  async secondary(gen, net, err) {
    try {
      const answer = await this.request(
        gen,
        (c, signal) => c.feed(PRINCIPAL.network, PRINCIPAL.feed, signal),
        { principal: true },
      );
      decodeAlerts(answer.body);
    } catch (check) {
      if (check?.code === 'refused' && !this.gone(gen)) {
        await this.refuse(check.status);
        throw new ChronoError('final_refused');
      }
      if (check instanceof ChronoError) throw check;
      throw new ChronoError('bad_response');
    }
    if (this.gone(gen)) return;
    const delay =
      net.wait?.kind === 'secondary' ? Math.min(SECONDARY_MAX, net.wait.delay * 2) : SECONDARY_MIN;
    net.wait = { kind: 'secondary', due: this.monotonic() + delay, delay };
    net.problem = { code: 'secondary', status: err.status, until: this.now() + delay };
  }

  /** A 5xx on the feed of one network: that network waits, the others go on. */
  holdNetwork(net, err) {
    const doubled =
      net.wait?.kind === 'server'
        ? Math.min(NETWORK_RETRY_MAX, net.wait.delay * 2)
        : NETWORK_RETRY_MIN;
    // What the portal asks for is honoured, up to the longest pause (6 h).
    const delay = Math.min(
      PAUSE_MAX,
      Math.max(doubled, finite(err.retryAfter) ? err.retryAfter : 0),
    );
    net.wait = { kind: 'server', due: this.monotonic() + delay, delay };
    net.lastServer = err;
    net.problem = { code: 'server_network', status: err.status, until: this.now() + delay };
  }

  // --- Boards and Gladys --------------------------------------------------------------

  /** The board of a stop now from what is held; undefined when nothing fresh is held for it. */
  boardFor(slot, now = this.now(), mono = this.monotonic()) {
    const live = this.nets.get(slot.network)?.live;
    if (!live || mono - live.mono > this.liveStale()) return undefined;
    // Read before this stop was added: its stop times were not kept.
    if (!slot.stopIds.every((id) => live.ids.has(id))) return undefined;
    return boardOf(live.stopTimes, slot, { now, lookaheadMinutes: this.config.lookaheadMinutes });
  }

  /** The alerts of a stop now from what is held; undefined when off or not fresh. */
  alertsFor(slot, now = this.now(), mono = this.monotonic()) {
    if (!this.config.alerts) return undefined;
    const net = this.nets.get(slot.network);
    const held = net?.alerts;
    if (!held || mono - held.mono > ALERT_STALE) return undefined;
    const routes = slot.routes.length ? slot.routes : slot.seenRoutes;
    const trips = new Set(
      (net.live?.stopTimes ?? [])
        .filter((st) => slot.stopIds.includes(st.stopId) && st.tripId)
        .map((st) => st.tripId),
    );
    return alertsOf(held.list, slot, { now, language: this.config.language, routes, trips });
  }

  async publishBoards(gen) {
    const states = [];
    const now = this.now();
    const mono = this.monotonic();
    for (const slot of this.slots) {
      states.push(
        ...statesOf(this.gladys, slot, this.boardFor(slot, now, mono), {
          now,
          language: this.config.language,
          lookaheadMinutes: this.config.lookaheadMinutes,
          alerts: this.alertsFor(slot, now, mono),
        }),
      );
    }
    if (this.gone(gen) || !states.length) return;
    try {
      await this.gladys.publishChangedStates(states);
    } catch (err) {
      this.log.warn(`States not published (${err?.name ?? 'Error'}): sent again next round`);
    }
  }

  async publishDiscovery(gen) {
    const devices = this.slots.map((s) =>
      buildDevice(this.gladys, s, { language: this.config.language, alerts: this.config.alerts }),
    );
    if (this.gone(gen)) return;
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.log.warn(`Discovery not published (${err?.name ?? 'Error'})`);
    }
  }

  scan() {
    return this.publishDiscovery(this.gen);
  }

  /** The status of the configuration screen, sent only when it changes. */
  async report(gen = this.gen) {
    if (this.gone(gen)) return;
    const [connected, message] = this.statusNow();
    if (this.storeState !== 'ok' && this.storeState !== 'pending') {
      for (const lang of ['en', 'fr']) message[lang] += t('storage', lang);
    }
    for (const lang of ['en', 'fr']) message[lang] = bound(message[lang].trim(), MAX_STATUS);
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    await this.setStatus(connected, message, key);
  }

  async setStatus(connected, message, key = JSON.stringify([connected, message])) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
      this.lastStatus = key;
    } catch (err) {
      this.log.warn(`Status not sent (${err?.name ?? 'Error'})`);
    }
  }

  /** The problem of a stop now: its own (no network) or its network's; undefined when read. */
  problemOf(slot) {
    if (slot.invalid) return { code: slot.invalid };
    const net = this.nets.get(slot.network);
    if (net?.okRound === this.round_ && !net.problem) {
      return this.boardFor(slot) ? undefined : { code: 'stale' };
    }
    return net?.problem ?? { code: 'stale' };
  }

  statusNow() {
    const problem = keyProblem(this.config);
    if (problem) return [false, both(problem)];
    if (this.isRefused()) return [false, both('refused', { status: this.refused.status })];
    if (!this.slots.length) {
      return this.invalid.length
        ? [false, both('problem_no_network', { slot: this.invalid[0].slot })]
        : [false, both('noStop')];
    }
    if (this.pauseActive()) {
      const key = this.pause.code === 'rate_limited' ? 'rateLimited' : 'server';
      return [false, both(key, { time: clock(this.pause.until), status: this.pause.status })];
    }
    if (!this.round_) {
      const wait = Math.max(0, (this.dueMono ?? this.monotonic()) - this.monotonic());
      return [false, both('starting', { time: clock(this.now() + wait) })];
    }
    const all = [...this.invalid, ...this.slots].sort((a, b) => a.slot - b.slot);
    const count = all.length;
    const problems = all.map((s) => [s, this.problemOf(s)]);
    const read = problems.filter(([, p]) => !p).length;
    const first = problems.find(([, p]) => p);
    const problemText = (lang) => {
      if (!first) return '';
      const [slot, p] = first;
      return t(`problem_${p.code}`, lang, {
        slot: slot.slot,
        network: slot.network,
        status: p.status ?? '',
        time: p.until ? clock(p.until) : p.at ? clock(p.at) : '',
      });
    };
    const alertNet = this.config.alerts
      ? [...this.nets.values()].find((n) => n.alertProblem)
      : undefined;
    const alertText = (lang) =>
      alertNet
        ? ` ${t('alertsUnread', lang, {
            network: alertNet.code,
            code: alertNet.alertProblem.code,
            time: clock(alertNet.alertProblem.until),
          })}`
        : '';
    const time = clock(this.data.lastRound ?? this.now());
    const message = {};
    for (const lang of ['en', 'fr']) {
      message[lang] =
        read === count
          ? t('readAll', lang, { time, count })
          : read > 0
            ? t('readSome', lang, { time, ok: read, count, problem: problemText(lang) })
            : t('readNone', lang, { problem: problemText(lang) });
      message[lang] += alertText(lang);
    }
    return [read > 0, message];
  }

  // --- Button ------------------------------------------------------------------------

  /** Test: one request on the principal route (at most every TEST_MIN_GAP); a success lifts a refusal. */
  async testConnection() {
    const problem = keyProblem(this.config);
    if (problem) return both(problem);
    const mono = this.monotonic();
    if (this.lastTest && mono - this.lastTest.mono < TEST_MIN_GAP) {
      const seconds = Math.max(1, Math.round((mono - this.lastTest.mono) / 1000));
      const last = this.lastTest.message ?? { en: '…', fr: '…' };
      return {
        en: t('testAgain', 'en', { seconds, result: last.en }),
        fr: t('testAgain', 'fr', { seconds, result: last.fr }),
      };
    }
    if (this.pauseActive(mono)) return both('paused', { time: clock(this.pause.until) });
    const gen = this.gen;
    this.lastTest = { mono };
    let message;
    try {
      const answer = await this.request(
        gen,
        (c, signal) => c.feed(PRINCIPAL.network, PRINCIPAL.feed, signal),
        { ignoreRefusal: true, principal: true },
      );
      try {
        decodeAlerts(answer.body);
      } catch {
        throw new ChronoError('bad_response');
      }
      if (this.gone(gen)) return both('testFailed', { code: 'restarted' });
      message = both('testOk');
      if (this.refused) {
        this.refused = undefined;
        this.data.refused = null;
        await this.save();
        this.schedule(gen);
      }
    } catch (err) {
      if (this.gone(gen)) return both('testFailed', { code: 'restarted' });
      const code = err instanceof ChronoError ? err.code : 'bad_response';
      if (code === 'refused') {
        await this.refuse(err.status);
        message = both('testRefused', { status: err.status });
      } else if (code === 'rate_limited' || code === 'server') {
        await this.setPause(err);
        message = both('paused', { time: clock(this.pause.until) });
      } else if (code === 'paused') {
        message = both('paused', { time: clock(this.pause.until) });
      } else {
        message = both('testFailed', { code });
      }
    }
    this.lastTest.message = message;
    await this.report(gen);
    return message;
  }
}
