// -----------------------------------------------------------------------------
// The exo networks of the Chrono portal of the ARTM, and the few static facts
// the integration needs from exo's GTFS (CC BY 4.0, exo open data, feed of
// 2026-10-28) to make the train feed readable without downloading it:
//   - every network is one path segment of the GTFS-Realtime API
//     (`/api/opendata/v1/<CODE>/tripupdate`, `/alert`);
//   - on the bus networks, the GTFS stop_id IS the number on the stop sign
//     (stop_code) and the route_id IS the route number: nothing to map;
//   - on the trains, a station has a 5-digit code (11010, Gare Centrale) and
//     one stop_id per platform side (MTL5D, MTL5B); the route ids are 1 to 6
//     while people say "line 11" (Vaudreuil-Hudson): both tables are here.
// A train station or line exo adds later is still readable by its stop_id or
// route_id; it only lacks a name.
// -----------------------------------------------------------------------------

/** The exo networks of the Chrono API, in the order of the form. */
export const NETWORKS = Object.freeze({
  TRAINS: { en: 'Trains', fr: 'Trains', rail: true },
  CITLA: { en: 'Laurentides', fr: 'Laurentides' },
  CITPI: { en: 'La Presqu’Île', fr: 'La Presqu’Île' },
  CITSO: { en: 'Sud-Ouest', fr: 'Sud-Ouest' },
  CITSV: { en: 'Sorel-Varennes', fr: 'Sorel-Varennes' },
  CITCRC: { en: 'Chambly-Richelieu-Carignan', fr: 'Chambly-Richelieu-Carignan' },
  CITVR: { en: 'Vallée du Richelieu', fr: 'Vallée du Richelieu' },
  LRRS: { en: 'Le Richelain and Roussillon', fr: 'Le Richelain et Roussillon' },
  OMITSJU: { en: 'Sainte-Julie', fr: 'Sainte-Julie' },
  MRCLM: { en: 'Terrebonne-Mascouche', fr: 'Terrebonne-Mascouche' },
  MRCLASSO: { en: 'L’Assomption', fr: 'L’Assomption' },
});

export const NETWORK_CODES = Object.freeze(Object.keys(NETWORKS));

/** The train lines: route_id -> line number and name (routes.txt of exo's train GTFS). */
export const TRAIN_LINES = Object.freeze({
  1: { line: '11', short: 'VH', name: 'Vaudreuil-Hudson' },
  3: { line: '13', short: 'SH', name: 'Mont-Saint-Hilaire' },
  4: { line: '12', short: 'SJ', name: 'Saint-Jérôme' },
  5: { line: '14', short: 'CA', name: 'Candiac' },
  6: { line: '15', short: 'MA', name: 'Mascouche' },
});

/** The train stations: code -> name and platform stop_ids (stops.txt of exo's train GTFS). */
const STATIONS = [
  ['11010', 'Centrale', ['MTL5D', 'MTL5B']],
  ['11150', "Lucien-L'Allier", ['MTL3A', 'MTL3C']],
  ['11160', 'Vendôme', ['MTL2A', 'MTL2C']],
  ['11170', 'Montréal-Ouest', ['MTL1A', 'MTL1C']],
  ['11180', 'Lachine', ['LCH1D', 'LCH1B']],
  ['11190', 'Dorval', ['DVL2D', 'DVL2B']],
  ['11200', 'Pine Beach', ['DVL1D', 'DVL1B']],
  ['11210', 'Valois', ['PCL3D', 'PCL3B']],
  ['11220', 'Pointe-Claire', ['PCL2D', 'PCL2B']],
  ['11230', 'Cedar Park', ['PCL1D', 'PCL1B']],
  ['11240', 'Beaconsfield', ['BEA2D', 'BEA2B']],
  ['11250', 'Beaurepaire', ['BEA1D', 'BEA1B']],
  ['11260', "Baie-d'Urfé", ['BUR1D', 'BUR1B']],
  ['11270', 'Sainte-Anne-de-Bellevue', ['SAB1D', 'SAB1B']],
  ['11280', 'Île-Perrot', ['LIP1D', 'LIP1B']],
  ['11290', 'Pincourt', ['TVA1D', 'TVA1B']],
  ['11300', 'Dorion', ['VAU1D', 'VAU1B']],
  ['11310', 'Vaudreuil', ['VAU8D', 'VAU8B']],
  ['11320', 'Hudson', ['HUD1D', 'HUD1B']],
  ['11350', 'Parc', ['MTL8D', 'MTL8B']],
  ['11355', 'Chabanel', ['MTL37C', 'MTL37A']],
  ['11360', 'Bois-de-Boulogne', ['MTL7D', 'MTL7B']],
  ['11365', 'De la Concorde', ['LVL24C', 'LVL24A']],
  ['11375', 'Vimont', ['LVL22C', 'LVL22A']],
  ['11380', 'Sainte-Rose', ['LVL4C', 'LVL4A']],
  ['11390', 'Rosemère', ['ROS2C', 'ROS2A']],
  ['11400', 'Sainte-Thérèse', ['STR4D', 'STR4B']],
  ['11410', 'Blainville', ['BLA1C', 'BLA1A']],
  ['11420', 'Mirabel', ['MIR1C', 'MIR1A']],
  ['11430', 'Saint-Jérôme', ['SJM1C', 'SJM1A']],
  ['11440', 'Saint-Lambert', ['STL1B', 'STL1D']],
  ['11450', 'Longueuil-Saint-Hubert', ['STH3B', 'STH3D']],
  ['11460', 'Saint-Bruno', ['STB2B', 'STB2D']],
  ['11470', 'Saint-Basile-le-Grand', ['SBA2B', 'SBA2D']],
  ['11480', 'McMasterville', ['MMS1B', 'MMS1D']],
  ['11490', 'Mont-Saint-Hilaire', ['MSH1C', 'MSH1A']],
  ['11495', 'Du Canal', ['LCH4A', 'LCH4C']],
  ['11500', 'LaSalle', ['LSL1A', 'LSL1C']],
  ['11510', 'Sainte-Catherine', ['SCS2A', 'SCS2C']],
  ['11520', 'Saint-Constant', ['SCS1A', 'SCS1C']],
  ['11530', 'Delson', ['DEL1A', 'DEL1C']],
  ['11540', 'Candiac', ['CAN1A', 'CAN1C']],
  ['11550', 'Ahuntsic', ['MTL59C', 'MTL59A']],
  ['11555', 'Côte-de-Liesse', ['MTL60C', 'MTL60A']],
  ['11560', 'Sauvé', ['MTL58C', 'MTL58A']],
  ['11570', 'Saint-Michel-Montréal-Nord', ['MTL57C', 'MTL57A']],
  ['11580', 'Saint-Léonard-Montréal-Nord', ['MTL56C', 'MTL56A']],
  ['11590', 'Anjou', ['MTL55C', 'MTL55A']],
  ['11600', 'Rivière-des-Prairies', ['MTL54C', 'MTL54A']],
  ['11610', 'Pointe-aux-Trembles', ['MTL53C', 'MTL53A']],
  ['11630', 'Repentigny', ['LEG1C', 'LEG1A']],
  ['11640', 'Terrebonne', ['LCN1C', 'LCN1A']],
  ['11650', 'Mascouche', ['MAS1C', 'MAS1A']],
];

export const TRAIN_STATIONS = Object.freeze(
  new Map(STATIONS.map(([code, name, stopIds]) => [code, Object.freeze({ code, name, stopIds })])),
);

/** stop_id -> its station, for a platform typed alone. */
const BY_STOP_ID = new Map(
  STATIONS.flatMap(([code]) =>
    TRAIN_STATIONS.get(code).stopIds.map((id) => [id, TRAIN_STATIONS.get(code)]),
  ),
);

/**
 * The stop ids and the name a slot of the form means. On the trains, a station
 * code gives every platform of the station, a platform stop_id only that
 * platform; anything else (a new station) is read as a stop_id, unnamed.
 * @returns {{ stopIds: string[], name?: string, platform?: boolean }}
 */
export function resolveStop(network, input) {
  if (network !== 'TRAINS') return { stopIds: [input] };
  const station = TRAIN_STATIONS.get(input);
  if (station) return { stopIds: [...station.stopIds], name: station.name };
  const upper = input.toUpperCase();
  const of = BY_STOP_ID.get(upper);
  if (of) return { stopIds: [upper], name: of.name, platform: true };
  return { stopIds: [input] };
}

/** The line people know for a route_id: "11" for the train route 1, the route id on a bus. */
export function lineOf(network, routeId) {
  const id = String(routeId ?? '');
  if (network === 'TRAINS') return TRAIN_LINES[id]?.line ?? id;
  return id.toUpperCase();
}

/**
 * A line of the route filter as a route_id: on the trains "11", "VH" or "1"
 * give route 1; on a bus network the route number itself.
 */
export function routeIdOf(network, line) {
  const value = String(line).toUpperCase();
  if (network !== 'TRAINS') return value;
  for (const [id, entry] of Object.entries(TRAIN_LINES)) {
    if (value === entry.line || value === entry.short || value === id) return id;
  }
  return value;
}
