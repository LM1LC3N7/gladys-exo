// -----------------------------------------------------------------------------
// Runtime texts, English and French: feature names, the published texts, the
// status, the answers of the test button.
// -----------------------------------------------------------------------------

const TEXTS = {
  featureNext: { en: 'Next departure', fr: 'Prochain passage' },
  featureNextIn: { en: 'Next departure in', fr: 'Prochain passage dans' },
  featureDelay: { en: 'Delay of the next departure', fr: 'Retard du prochain passage' },
  featureCancelled: { en: 'Cancelled departures', fr: 'Passages annulés' },
  featureAlerts: { en: 'Service alerts', fr: 'Avis de service' },
  featureAlert: { en: 'Main service alert', fr: 'Avis de service principal' },
  stop: { en: 'stop', fr: 'arrêt' },
  line: { en: 'line', fr: 'ligne' },
  inMinutes: { en: 'in {minutes} min', fr: 'dans {minutes} min' },
  onTime: { en: 'on time', fr: 'à l’heure' },
  early: { en: '{minutes} min early', fr: '{minutes} min d’avance' },
  none: {
    en: 'No departure in the next {minutes} min',
    fr: 'Aucun passage dans les {minutes} prochaines min',
  },
  noPrediction: {
    en: 'No real-time prediction for this stop',
    fr: 'Aucune prévision en temps réel pour cet arrêt',
  },
  delayUnknown: { en: 'delay unknown', fr: 'retard inconnu' },
  noAlert: { en: 'No alert', fr: 'Aucun avis' },
  alertNoText: { en: 'Alert without text', fr: 'Avis sans texte' },

  // Status of the configuration screen.
  missing: {
    en: 'Enter the key of your application on the Chrono developer portal of the ARTM.',
    fr: 'Saisissez la clé de votre application du portail développeur Chrono de l’ARTM.',
  },
  malformed: {
    en: 'The key holds a space or a character that is not allowed, or is too short.',
    fr: 'La clé contient une espace ou un caractère non permis, ou elle est trop courte.',
  },
  noStop: {
    en: 'Key entered. Add a stop (network and stop number).',
    fr: 'Clé saisie. Ajoutez un arrêt (réseau et numéro d’arrêt).',
  },
  refused: {
    en: 'The Chrono portal refused the key (HTTP {status}): check it and its subscription, then press Test.',
    fr: 'Le portail Chrono a refusé la clé (HTTP {status}) : vérifiez-la ainsi que son abonnement, puis appuyez sur Tester.',
  },
  rateLimited: {
    en: 'The Chrono portal asks to wait (HTTP {status}, quota): paused until {time}.',
    fr: 'Le portail Chrono demande d’attendre (HTTP {status}, quota) : pause jusqu’à {time}.',
  },
  server: {
    en: 'The Chrono portal is unavailable (HTTP {status}): paused until {time}.',
    fr: 'Le portail Chrono est indisponible (HTTP {status}) : pause jusqu’à {time}.',
  },
  starting: {
    en: 'Starting: the first read comes at {time}.',
    fr: 'Démarrage : première lecture à {time}.',
  },
  readAll: { en: 'Read at {time}: {count} stop(s).', fr: 'Lu à {time} : {count} arrêt(s).' },
  readSome: {
    en: 'Read at {time}: {ok} of {count} stops. {problem}',
    fr: 'Lu à {time} : {ok} arrêts sur {count}. {problem}',
  },
  readNone: { en: 'No stop read. {problem}', fr: 'Aucun arrêt lu. {problem}' },
  storage: { en: ' /data unreadable: nothing kept.', fr: ' /data illisible : rien n’est gardé.' },
  configUnread: {
    en: 'The configuration could not be read from Gladys: trying again.',
    fr: 'La configuration n’a pas pu être lue depuis Gladys : nouvel essai.',
  },

  // Per-stop problems (one is shown in the status).
  problem_no_network: {
    en: 'Stop {slot}: choose its network.',
    fr: 'Arrêt {slot} : choisissez son réseau.',
  },
  problem_secondary: {
    en: 'Stop {slot}: network {network} refused (HTTP {status}), key accepted; tried again at {time}.',
    fr: 'Arrêt {slot} : réseau {network} refusé (HTTP {status}), clé acceptée ; nouvel essai à {time}.',
  },
  problem_timeout: {
    en: 'Stop {slot}: the Chrono portal did not answer in time.',
    fr: 'Arrêt {slot} : le portail Chrono n’a pas répondu à temps.',
  },
  problem_network: {
    en: 'Stop {slot}: the Chrono portal is unreachable (network).',
    fr: 'Arrêt {slot} : le portail Chrono est injoignable (réseau).',
  },
  problem_bad_response: {
    en: 'Stop {slot}: unreadable answer for network {network}.',
    fr: 'Arrêt {slot} : réponse illisible pour le réseau {network}.',
  },
  problem_too_large: {
    en: 'Stop {slot}: answer too large for network {network}, ignored.',
    fr: 'Arrêt {slot} : réponse trop grande pour le réseau {network}, ignorée.',
  },
  problem_not_found: {
    en: 'Stop {slot}: the Chrono portal has no feed for network {network} (HTTP 404).',
    fr: 'Arrêt {slot} : le portail Chrono n’a pas de flux pour le réseau {network} (HTTP 404).',
  },
  problem_http: {
    en: 'Stop {slot}: the Chrono portal answered HTTP {status}.',
    fr: 'Arrêt {slot} : le portail Chrono a répondu HTTP {status}.',
  },
  problem_stale: {
    en: 'Stop {slot}: no recent real-time data, nothing published.',
    fr: 'Arrêt {slot} : pas de données en temps réel récentes, rien publié.',
  },
  problem_stale_feed: {
    en: 'Stop {slot}: the feed of network {network} is not up to date (dated {time}), nothing published.',
    fr: 'Arrêt {slot} : le flux du réseau {network} n’est pas à jour (daté de {time}), rien publié.',
  },
  problem_server_network: {
    en: 'Stop {slot}: network {network} unavailable (HTTP {status}); tried again at {time}.',
    fr: 'Arrêt {slot} : réseau {network} indisponible (HTTP {status}) ; nouvel essai à {time}.',
  },
  alertsUnread: {
    en: 'Alerts of {network} not read ({code}); tried again at {time}.',
    fr: 'Avis de {network} non lus ({code}) ; nouvel essai à {time}.',
  },

  // Button.
  testOk: {
    en: 'Accepted by the Chrono portal: the exo feeds answer.',
    fr: 'Acceptée par le portail Chrono : les flux d’exo répondent.',
  },
  testRefused: {
    en: 'Refused by the Chrono portal (HTTP {status}): check the key and its subscription.',
    fr: 'Refusée par le portail Chrono (HTTP {status}) : vérifiez la clé et son abonnement.',
  },
  testAgain: {
    en: 'Tested {seconds} s ago ({result}): wait a little before testing again.',
    fr: 'Testé il y a {seconds} s ({result}) : patientez un peu avant de tester à nouveau.',
  },
  testFailed: {
    en: 'No usable answer from the Chrono portal ({code}): the key was neither accepted nor refused.',
    fr: 'Pas de réponse utilisable du portail Chrono ({code}) : la clé n’a été ni acceptée ni refusée.',
  },
  paused: {
    en: 'Paused until {time} (the Chrono portal asked to wait): nothing sent.',
    fr: 'En pause jusqu’à {time} (le portail Chrono a demandé d’attendre) : rien envoyé.',
  },
};

export function t(key, language = 'en', values = {}) {
  const entry = TEXTS[key];
  const text = entry?.[language] ?? entry?.en ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) =>
    name in values ? String(values[name]) : `{${name}}`,
  );
}

/** Both languages of a text: { en, fr }. */
export const both = (key, values) => ({ en: t(key, 'en', values), fr: t(key, 'fr', values) });

export const KEYS = Object.keys(TEXTS);
export const ALL_TEXTS = TEXTS;
