# exo

Unofficial integration, not affiliated with exo nor the ARTM. It follows up
to four stops of exo, the suburban trains and buses of the Montréal area,
and gives for each one the next departure, minutes until it, its delay, the
cancelled departures and the service alerts. Read-only: nothing is ever
changed on exo's side.

The data comes from the official **GTFS-Realtime** feeds of exo, served by
the **Chrono developer portal** of the ARTM (Autorité régionale de transport
métropolitain), with your own free key.

> This integration was built from the public description of the feeds and
> tested with a fake Gladys and a fake portal only: it has never been tested
> with a real key. The first users' feedback is welcome on the forum.

## 1. Get your free key

1. Create an account on the
   [Chrono developer portal](https://portail-developpeur.chrono-saeiv.com/).
2. Subscribe to the open data of exo (GTFS-Realtime) and copy the key of the
   subscription.

## 2. Configure

- **Key of the Chrono portal**: kept by Gladys in its database, never shown
  again, sent only to the Chrono portal of the ARTM (in the
  `Ocp-Apim-Subscription-Key` header of the portal's gateway, never in a URL).
- **Stop 1 to 4**: the **network**, then the **stop**:
  - bus: the number written on the stop sign (`41492`), which is also the
    stop number of exo's open data. The same number can exist on two
    networks: the network is always asked;
  - train: the code of the station (`11010` for Gare Centrale, table
    below) for every platform of the station, or the `stop_id` of one
    platform (`MTL5D`) for one direction only.
- **Routes** (optional): route numbers separated by commas or spaces
  (`220, 221`); on the trains, the line number (`11`), its letters (`VH`)
  or the route id (`1`).
- **Read interval**: 60 seconds by default (30 to 600).
- **Departures shown up to**: the next 90 minutes by default (15 to 240).
- **Read the service alerts**: on by default.
- **Language of the values**: French or English (feature names, texts, and
  the alert text when exo gives both languages).

**Test the key** sends one request to the portal (at most every 30 seconds)
and says whether the key is accepted.

## 3. The devices

Each stop appears in the **Discovery** tab as soon as it is configured
(device name `exo <network> – <station>` or `exo <network> – stop <number>`,
with the route filter in brackets). Features, all read-only:

| Feature                     | Value                                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| Next departure              | text, e.g. `14:08 · line 11 · in 6 min · +4 min`                       |
| Next departure in           | minutes until the next departure that runs                             |
| Delay of the next departure | minutes, negative when early (only when the feed gives it)             |
| Cancelled departures        | departures of the window cancelled, or skipping the stop               |
| Service alerts              | active alerts of the stop, its routes or its whole network (alerts on) |
| Main service alert          | text of the most severe of them, `No alert` when none (alerts on)      |

The time shown is the time the feed predicts, local time of Montréal. A
cancelled trip is not "the next departure": the next one that runs is. A
departure stays on the board 30 seconds after its time, then leaves it.

The values are published again every minute from what was read (no request):
**Next departure in** counts down between two reads.

What is not known is not published (the last value stays; Gladys has no
"unknown"):

- no departure in the window: the text says so, **Next departure in** and
  **Delay** are not updated (never a 0 for "none");
- a delay the feed does not give (only a time): the text says `delay unknown`
  and **Delay** keeps the delay of an earlier departure: read it with the text;
- the stop absent from the feed (a mistyped number, a bus without real-time
  tracking): the text says `No real-time prediction for this stop`, nothing
  is counted;
- nothing read for 10 minutes (2.5 intervals when longer): nothing is
  published until the next good read;
- a feed without its header or its own time: unreadable, nothing published;
- a feed whose own time is more than 15 minutes older than the portal's
  clock (`Date` header): not real time any more, nothing published (not even
  what was read before), the status says so;
- alerts not read for 20 minutes: the two alert features are not updated.

Without exo's full timetable (not read: too large for a container), a stop
time that carries only a delay and no time cannot be placed and is left out,
and a trip cancelled without any time for the stop is not counted. A route
alert counts for a stop when the route is in its filter, or, without a filter,
among the routes seen at the stop since the start.

## 4. How it reads the portal, and its limits

- Every interval, one request per **network** of the configured stops (the
  feed of a network covers all its stops: four stops of the same network cost
  one request), and the alerts of the network every 5 minutes.
- At most one request at a time, 1 s apart. A restart, a reconnection, a
  save of the form or the test button does not make the reads come sooner
  than the interval (a changed stop waits 20 s after the last read). When
  /data cannot be read at start, the first read waits a whole interval.
- **HTTP 429** or a quota answer of the portal's gateway (HTTP 403 "quota"):
  every request waits (the wait the portal gives, otherwise 1 minute
  doubling up to 6 hours), kept across restarts. The quota is the key's:
  entering another key lifts the wait.
- **5xx** on the feed of one network: that network waits (1 minute doubling
  up to 30 minutes, or the wait the portal gives, up to 6 hours), the others
  are read as usual; every network tried in 5xx: every request waits as for
  a 429.
- **HTTP 401/403 on a network feed**: the key is checked once on the alerts
  of the trains. Refused there too: the integration stops and does not try
  this key again by itself, even after a restart; enter another key or press
  **Test the key** (a success lifts the stop). After a restart, a new key has
  1 chance in 256 to look like the refused one (only 8 bits of it are kept):
  press **Test the key** then. Accepted there: only that
  network waits (5 minutes, doubling up to 1 hour).
- An error on the alerts of a network other than a 429 or a quota answer
  (401/403 included, the departures of the network having just been read
  with the same key) does not stop the departures: those alerts wait
  5 minutes, doubling up to 1 hour. A 429 or a quota answer there pauses
  every request, as above (the quota is the key's).
- Answers are bounded: 8 MB for a departures feed, 2 MB for an alerts feed,
  15 seconds per request; an unreadable answer publishes nothing.

## 5. What is kept in /data

`/data/exo.json`: the time of the last round, a pause, a refusal (8 bits of a
salted hash of the key, nothing more). No key. When the file cannot be read,
it is not overwritten and is read again every 10 seconds; a file that does not
parse is moved aside to `exo.json.bad` first.

## 6. Train stations

Code to type, name, platform `stop_id`s (exo's train GTFS of 2026-10-28; a
newer station can be typed by its `stop_id`).

| Code  | Station                     | Platforms      |
| ----- | --------------------------- | -------------- |
| 11010 | Centrale                    | MTL5D, MTL5B   |
| 11150 | Lucien-L'Allier             | MTL3A, MTL3C   |
| 11160 | Vendôme                     | MTL2A, MTL2C   |
| 11170 | Montréal-Ouest              | MTL1A, MTL1C   |
| 11180 | Lachine                     | LCH1D, LCH1B   |
| 11190 | Dorval                      | DVL2D, DVL2B   |
| 11200 | Pine Beach                  | DVL1D, DVL1B   |
| 11210 | Valois                      | PCL3D, PCL3B   |
| 11220 | Pointe-Claire               | PCL2D, PCL2B   |
| 11230 | Cedar Park                  | PCL1D, PCL1B   |
| 11240 | Beaconsfield                | BEA2D, BEA2B   |
| 11250 | Beaurepaire                 | BEA1D, BEA1B   |
| 11260 | Baie-d'Urfé                 | BUR1D, BUR1B   |
| 11270 | Sainte-Anne-de-Bellevue     | SAB1D, SAB1B   |
| 11280 | Île-Perrot                  | LIP1D, LIP1B   |
| 11290 | Pincourt                    | TVA1D, TVA1B   |
| 11300 | Dorion                      | VAU1D, VAU1B   |
| 11310 | Vaudreuil                   | VAU8D, VAU8B   |
| 11320 | Hudson                      | HUD1D, HUD1B   |
| 11350 | Parc                        | MTL8D, MTL8B   |
| 11355 | Chabanel                    | MTL37C, MTL37A |
| 11360 | Bois-de-Boulogne            | MTL7D, MTL7B   |
| 11365 | De la Concorde              | LVL24C, LVL24A |
| 11375 | Vimont                      | LVL22C, LVL22A |
| 11380 | Sainte-Rose                 | LVL4C, LVL4A   |
| 11390 | Rosemère                    | ROS2C, ROS2A   |
| 11400 | Sainte-Thérèse              | STR4D, STR4B   |
| 11410 | Blainville                  | BLA1C, BLA1A   |
| 11420 | Mirabel                     | MIR1C, MIR1A   |
| 11430 | Saint-Jérôme                | SJM1C, SJM1A   |
| 11440 | Saint-Lambert               | STL1B, STL1D   |
| 11450 | Longueuil-Saint-Hubert      | STH3B, STH3D   |
| 11460 | Saint-Bruno                 | STB2B, STB2D   |
| 11470 | Saint-Basile-le-Grand       | SBA2B, SBA2D   |
| 11480 | McMasterville               | MMS1B, MMS1D   |
| 11490 | Mont-Saint-Hilaire          | MSH1C, MSH1A   |
| 11495 | Du Canal                    | LCH4A, LCH4C   |
| 11500 | LaSalle                     | LSL1A, LSL1C   |
| 11510 | Sainte-Catherine            | SCS2A, SCS2C   |
| 11520 | Saint-Constant              | SCS1A, SCS1C   |
| 11530 | Delson                      | DEL1A, DEL1C   |
| 11540 | Candiac                     | CAN1A, CAN1C   |
| 11550 | Ahuntsic                    | MTL59C, MTL59A |
| 11555 | Côte-de-Liesse              | MTL60C, MTL60A |
| 11560 | Sauvé                       | MTL58C, MTL58A |
| 11570 | Saint-Michel-Montréal-Nord  | MTL57C, MTL57A |
| 11580 | Saint-Léonard-Montréal-Nord | MTL56C, MTL56A |
| 11590 | Anjou                       | MTL55C, MTL55A |
| 11600 | Rivière-des-Prairies        | MTL54C, MTL54A |
| 11610 | Pointe-aux-Trembles         | MTL53C, MTL53A |
| 11630 | Repentigny                  | LEG1C, LEG1A   |
| 11640 | Terrebonne                  | LCN1C, LCN1A   |
| 11650 | Mascouche                   | MAS1C, MAS1A   |

Train lines: 11 Vaudreuil-Hudson (VH), 12 Saint-Jérôme (SJ), 13
Mont-Saint-Hilaire (SH), 14 Candiac (CA), 15 Mascouche (MA).

## Data and license

Data: exo (Réseau de transport métropolitain). exo's static GTFS
([exo's open data](https://exo.quebec/en/about/open-data)), from which the
station and line tables come, is under the
[Creative Commons Attribution 4.0 license (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
The real-time data comes from the
[Chrono developer portal](https://portail-developpeur.chrono-saeiv.com/) of
the ARTM, under the terms of use of the portal, which you accept when you
register there.
The data is modified: the predictions are filtered by stop and route and
summarised (next departure, delay in whole minutes, count of cancellations,
count of alerts and the text of the main one). The station and line tables
come from exo's train GTFS.
