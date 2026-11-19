# TODO

## Before announcing

- [ ] Test with a real key of the Chrono developer portal: test button, a
      train station (Gare Centrale), a bus stop of a busy network (Laurentides:
      size of the TripUpdates feed), a route filter, the alerts.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm with the real portal (built without a key)

- [ ] The key in the `Ocp-Apim-Subscription-Key` header: the gateway answers
      "invalid subscription key" (not "missing") to a wrong key sent there,
      so it reads that header (checked 2026-11-15 without a key); the
      registries document a `token` query parameter, avoided because it puts
      the key in URLs. If a real key is refused in the header but accepted as
      `token`, switch (and keep it out of every log line).
- [ ] Whether one subscription covers every exo network (the principal route
      used to tell a refused key from a network not subscribed is the alerts
      of the trains).
- [ ] The quotas of the portal (no public figure found): the integration
      reads one feed per network and interval (60 s by default, 30 s at
      least) and the alerts every 5 min; the gateway's 429 and "Out of call
      volume quota" 403 pause every request.
- [ ] Whether the bus feeds give `delay` or only `time` (the delay feature
      stays unpublished without it), and whether cancelled trips carry their
      stop times (else they are not counted).
- [ ] The size of the biggest TripUpdates feed (Laurentides, 2,181 stops;
      limit 8 MB) and of the alerts (2 MB).
- [ ] The language tags of the alert texts (`fr`, `en`, `fr-CA`…).

## Later

- [ ] Stop names of the bus networks (exo's static GTFS: 150 KB of stops per
      network, a zip to read): kept out of v1, the name of the device can be
      changed in Gladys.
- [ ] A dashboard widget (departure board) and scene triggers (a cancellation,
      a new alert).
- [ ] The train station table follows exo's GTFS of 2026-10-28: refresh it
      when exo adds a station (a new one works meanwhile by its `stop_id`).

## Decisions

- Version 0.1.0 set by hand in package.json, the lock and the manifest
  (`docker_image` `ghcr.io/lm1lc3n7/gladys-exo:0.1.0`); the Release workflow
  owns the next ones.
- SDK `^0.16.0` (latest on npm on 2026-11-15). `gladys_version: ">=5.3.0"`
  for `countries: ["CA"]` (exo serves the Montréal area only). Category
  `transport`. No `keywords` (store rule).
- No GTFS-Realtime library: the decoder of gladys-stm (same author,
  Apache-2.0) walks the wire format and only builds the stop times of the
  watched stops, bounded in count and text size. `gtfs-realtime-bindings`
  (Apache-2.0) would materialise the whole feed of a network in a 256 MB
  container.
- Read-only: no `onSetValue`, only GET. No sensitive action, nothing to
  protect.
- Unknown stays unknown: no 0 for "no departure", no delay without the
  feed's `delay`, nothing after 10 min without a fresh read or from a feed
  older than 15 min against the server's `Date`.
- The model of the pace, the pauses, the refusal and /data is the one of
  gladys-deutsche-bahn (reviewed in three rounds), adapted to one feed per
  network.
