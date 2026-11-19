# exo for Gladys Assistant

Unofficial [Gladys Assistant](https://gladysassistant.com) external integration:
up to four stops of **exo**, the suburban trains and buses of the Montréal
area (next departure, delay, cancellations, service alerts), read from the
official GTFS-Realtime feeds of the
[Chrono developer portal](https://portail-developpeur.chrono-saeiv.com/) of
the ARTM with the user's free key. Read-only. Not affiliated with exo nor the
ARTM.

- User documentation: [English](docs/en.md), [français](docs/fr.md).
- Built with [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js);
  rules for contributors in [CLAUDE.md](CLAUDE.md), open points in [TODO.md](TODO.md).
- Data: exo. Static GTFS of exo under CC BY 4.0; real-time data of the ARTM's
  Chrono portal under the portal's terms of use, accepted by the user at
  registration (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

```bash
npm install
npm test
npm run lint
npm run format:check
```

Licensed under the Apache License 2.0.
