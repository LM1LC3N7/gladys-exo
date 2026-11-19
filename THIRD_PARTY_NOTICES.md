# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
embeds no third-party library besides the Gladys SDK (Apache-2.0). The
GTFS-Realtime decoder (`src/gtfs.js`) is written from the official
`gtfs-realtime.proto` field numbers; it comes from the gladys-stm integration
of the same author (Apache-2.0), extended here. No code of
`gtfs-realtime-bindings` nor of protobufjs is used.

## exo data

The departures, delays, cancellations and service alerts the integration
publishes come from the GTFS-Realtime feeds of **exo** (Réseau de transport
métropolitain), served by the Chrono developer portal of the ARTM
(<https://portail-developpeur.chrono-saeiv.com/>). The tables of train
stations and train lines in `src/networks.js` come from exo's train GTFS
(feed of 2026-10-28, <https://exo.quebec/en/about/open-data>).

- exo's static GTFS: Creative Commons Attribution 4.0 International license
  (<https://creativecommons.org/licenses/by/4.0/>).
- Real-time data of the Chrono portal of the ARTM: under the terms of use of
  the portal, accepted by each user when registering for their own key (the
  terms are shown only after registration; no open license is claimed for
  them here).

Changes made to the data: the predictions are filtered by stop and route and
summarised (next departure, delay in whole minutes, count of cancellations,
count of alerts and the text of the main one); only the codes, names and
platform ids of the train stations and the numbers and names of the train
lines are kept from the static GTFS. Each user reads the feeds with their own
free key.

"exo", "ARTM" and "Chrono" are names of their owners, used here only to say
which service the integration reads. This integration is not affiliated with
nor endorsed by exo nor the ARTM.

## References read, not copied

- The Transitland feed registry (transitland-atlas): read only to learn the
  paths of the exo feeds
  (`/api/opendata/v1/<NETWORK>/tripupdate|alert`) and the network codes.
