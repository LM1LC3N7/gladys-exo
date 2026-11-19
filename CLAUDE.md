# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads the departures and service alerts of up to four **exo** stops
(suburban trains and buses of the Montréal area) from the GTFS-Realtime feeds
of the **Chrono developer portal** of the ARTM
(`https://exo.chrono-saeiv.com/api/opendata/v1/<NETWORK>/tripupdate|alert`,
protobuf), with the user's free key in the `Ocp-Apim-Subscription-Key` header.
Unofficial: not affiliated with exo nor the ARTM. **Read-only**: never
`onSetValue`, only GET.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png, 800 x 534, plain Node
memcap node scripts/mutants.mjs           # mutation check of the guards (not in CI)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers every handler)
src/app.js                        ExoApp: rounds, pace, request lane, pauses, refusal, button
src/client.js                     the only HTTP access (GET, bounded, key in a header, our error codes)
src/gtfs.js                       a bounded, linear GTFS-Realtime decoder (watched stops, alerts)
src/model.js                      the board and the alerts of a stop (pure)
src/devices.js                    the device of a stop, feature keys, states (pure)
src/networks.js                   exo networks, train stations and lines (from exo's GTFS)
src/time.js                       local time of Montréal
src/config.js                     the form, normalized
src/store.js                      what /data keeps
src/constants.js                  API, pace, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
scripts/cover.mjs                 the cover image
scripts/mutants.mjs, mutants.json mutation check of the guards
test/                             node --test, the SDK's fake Gladys, a scripted API, a virtual clock
```

## Rules

- **The pace**: rounds an interval apart, start to start, whatever asks; the
  time of the last round is in `/data` before the first request. A changed
  stop waits 20 s after the last round. One TripUpdates request per network
  and round, the alerts every 5 min. Never add a request outside
  `ExoApp.request()`: one in flight, REQUEST_GAP apart, pause and refusal
  checked just before sending (and decided before the next request of the
  lane goes).
- **The key**: only in the private field of `ChronoClient` and its header;
  never in a URL, a log, a status, an error or `/data`. A 401/403 of a
  network feed is checked on the principal route (`TRAINS/alert`): refused
  there, it is final (8 bits of a salted hash in `/data`), lifted by another
  key or a success of the test button; accepted there, only that network
  waits (5 min doubling to 1 h). A 401/403 of an alert feed (read right after
  its network with the same key) is never a refusal. A timeout or an
  unreadable answer is never a refusal.
- **Pauses**: 429 and the gateway's quota (403 "quota") pause every request
  (the wait asked, else 1 min doubling, 6 h at most), kept in `/data`, on the
  monotonic clock. A 5xx holds its network only (1 min doubling to 30 min),
  unless every network tried is in 5xx: then all pause.
- **Unknown stays unknown**: no 0 for "no departure"; no delay without the
  feed's `delay`; nothing published from data older than LIVE_STALE (or 2.5
  intervals), from a feed older than FEED_STALE against the server's `Date`,
  nor from alerts older than ALERT_STALE.
- **Bounded**: answers (8 MB / 2 MB, 15 s), stop times (5,000), alerts (500),
  selectors (100), texts (4,096 characters decoded, 200 published).
- **Late answers**: every await of a round is followed by `gone(gen)`.
- **/data**: unreadable is not empty: never written until read, read again
  every 10 s, one read at a time; a start waits for it 5 s at most.
- **External ids are forever**: `stop:<slot>-<NETWORK>-<input>`, the `FEATURE`
  keys of `src/devices.js`, the manifest keys and actions.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }`; the catalog
  `description` holds 10 to 100 characters per language; never a `default`
  on a secret, never a key starting with `gladys_`.
- **User-facing text** is bilingual (English and French): runtime messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Data
  attribution (exo, CC BY 4.0) stays in the docs, the manifest and
  `THIRD_PARTY_NOTICES.md`. Say "numéro", not the French word for
  digits: the manifest test bans its stem (it is also the stem of a banned word).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the real-clock test uses a local
  server).
