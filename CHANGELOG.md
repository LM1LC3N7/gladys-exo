# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-11-19

### Added

- First version: up to four exo stops (trains and buses of the Montréal area)
  read from the GTFS-Realtime feeds of the Chrono developer portal of the ARTM
  (the user's free key), one device per stop (next departure, minutes until
  it, its delay, the cancelled departures, the service alerts and the text of
  the main one), route filter, train stations by code, the "Test the key"
  button. Read-only.
- The store lists it for Canada only (`countries: ["CA"]`, Gladys 5.3.0 or
  later).
- A feed without its header or its time is unreadable (an empty 200 is not
  "no departure"); a stop absent from the feed says "no real-time
  prediction"; a stale feed drops what was held; a new key is not held by
  the pause of the old one.
- One request per network and interval, one at a time; pauses after 429, the
  gateway's quota and 5xx, and the refused key kept across restarts.

[Unreleased]: https://github.com/LM1LC3N7/gladys-exo/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-exo/releases/tag/v0.1.1
