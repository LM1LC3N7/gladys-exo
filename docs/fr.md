# exo

Intégration non officielle, sans lien avec exo ni l’ARTM. Elle suit jusqu’à
quatre arrêts d’exo, les trains et autobus de banlieue de la région de
Montréal, et donne pour chacun le prochain passage, le temps d’attente, son
retard, les passages annulés et les avis de service. Lecture seule : rien
n’est jamais modifié chez exo.

Les données viennent des flux **GTFS-Realtime** officiels d’exo, servis par
le **portail développeur Chrono** de l’ARTM (Autorité régionale de transport
métropolitain), avec votre propre clé gratuite.

> Cette intégration a été construite d’après la description publique des flux
> et testée avec un faux Gladys et un faux portail seulement : elle n’a jamais
> été testée avec une vraie clé. Les retours des premiers utilisateurs sont
> les bienvenus sur le forum.

## 1. Obtenir votre clé gratuite

1. Créez un compte sur le
   [portail développeur Chrono](https://portail-developpeur.chrono-saeiv.com/).
2. Abonnez-vous aux données ouvertes d’exo (GTFS-Realtime) et copiez la clé
   de l’abonnement.

## 2. Configurer

- **Clé du portail Chrono** : gardée par Gladys dans sa base, jamais
  réaffichée, envoyée seulement au portail Chrono de l’ARTM (dans l’en-tête
  `Ocp-Apim-Subscription-Key` de la passerelle du portail, jamais dans une URL).
- **Arrêt 1 à 4** : le **réseau**, puis l’**arrêt** :
  - autobus : le numéro inscrit sur le panneau de l’arrêt (`41492`), qui est
    aussi le numéro d’arrêt des données ouvertes d’exo. Le même numéro peut
    exister sur deux réseaux : le réseau est toujours demandé ;
  - train : le code de la gare (`11010` pour la Gare Centrale, tableau
    plus bas) pour tous les quais de la gare, ou le `stop_id` d’un quai
    (`MTL5D`) pour une seule direction.
- **Lignes** (facultatif) : numéros de ligne séparés par des virgules ou des
  espaces (`220, 221`) ; pour les trains, le numéro de ligne (`11`), ses
  lettres (`VH`) ou l’identifiant de route (`1`).
- **Intervalle de lecture** : 60 secondes par défaut (30 à 600).
- **Passages pris en compte jusqu’à** : les 90 prochaines minutes par défaut
  (15 à 240).
- **Lire les avis de service** : activé par défaut.
- **Langue des valeurs** : français ou anglais (noms des fonctionnalités,
  textes, et texte de l’avis quand exo donne les deux langues).

**Tester la clé** envoie une requête au portail (au plus toutes les
30 secondes) et dit si la clé est acceptée.

## 3. Les appareils

Chaque arrêt apparaît dans l’onglet **Découverte** dès qu’il est configuré
(nom `exo <réseau> – <gare>` ou `exo <réseau> – arrêt <numéro>`, avec le
filtre de lignes entre parenthèses). Fonctionnalités, toutes en lecture seule :

| Fonctionnalité             | Valeur                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| Prochain passage           | texte, par ex. `14:08 · ligne 11 · dans 6 min · +4 min`                   |
| Prochain passage dans      | minutes avant le prochain passage maintenu                                |
| Retard du prochain passage | minutes, négatif en cas d’avance (seulement quand le flux le donne)       |
| Passages annulés           | passages de la fenêtre annulés, ou qui ne desservent pas l’arrêt          |
| Avis de service            | avis actifs de l’arrêt, de ses lignes ou de tout le réseau (avis activés) |
| Avis de service principal  | texte du plus grave d’entre eux, `Aucun avis` sinon (avis activés)        |

L’heure affichée est celle que prévoit le flux, heure de Montréal. Un
passage annulé n’est pas « le prochain passage » : c’est le suivant maintenu.
Un passage reste affiché 30 secondes après son heure, puis disparaît.

Les valeurs sont republiées chaque minute à partir de ce qui a été lu (sans
requête) : **Prochain passage dans** décompte entre deux lectures.

Ce qui n’est pas connu n’est pas publié (la dernière valeur reste ; Gladys
n’a pas de valeur « inconnue ») :

- aucun passage dans la fenêtre : le texte le dit, **Prochain passage dans**
  et **Retard** ne sont pas mis à jour (jamais un 0 pour « aucun ») ;
- un retard que le flux ne donne pas (seulement une heure) : le texte dit
  `retard inconnu` et **Retard** garde le retard d’un passage précédent : lisez-le
  avec le texte ;
- l’arrêt absent du flux (numéro mal saisi, autobus sans suivi en temps réel) :
  le texte dit `Aucune prévision en temps réel pour cet arrêt`, rien n’est
  compté ;
- rien lu depuis 10 minutes (2,5 intervalles s’ils sont plus longs) : rien
  n’est publié jusqu’à la prochaine bonne lecture ;
- un flux sans en-tête ou sans heure propre : illisible, rien publié ;
- un flux dont l’heure propre a plus de 15 minutes de retard sur l’horloge du
  portail (en-tête `Date`) : plus du temps réel, rien publié (pas même ce qui a
  été lu avant), le statut le dit ;
- avis non lus depuis 20 minutes : les deux fonctionnalités d’avis ne sont pas
  mises à jour.

Sans l’horaire complet d’exo (non lu : trop gros pour un conteneur), un
passage qui ne porte qu’un retard sans heure ne peut pas être placé et il est
laissé de côté, et un voyage annulé sans aucune heure pour l’arrêt n’est pas
compté. Un avis de ligne compte pour un arrêt quand la ligne est dans son
filtre ou, sans filtre, parmi les lignes vues à l’arrêt depuis le démarrage.

## 4. Comment elle lit le portail, et ses limites

- À chaque intervalle, une requête par **réseau** des arrêts configurés (le
  flux d’un réseau couvre tous ses arrêts : quatre arrêts du même réseau
  coûtent une requête), et les avis du réseau toutes les 5 minutes.
- Une seule requête à la fois, à 1 s d’écart au moins. Un redémarrage, une
  reconnexion, un enregistrement du formulaire ou le bouton de test n’avancent
  pas les lectures avant l’intervalle (un arrêt modifié attend 20 s après la
  dernière lecture). Quand /data ne peut pas être lu au démarrage, la première
  lecture attend un intervalle entier.
- **HTTP 429** ou réponse de quota de la passerelle du portail (HTTP 403
  « quota ») : toutes les requêtes attendent (le délai donné par le portail,
  sinon 1 minute doublée jusqu’à 6 heures), gardé au redémarrage. Le quota est
  celui de la clé : saisir une autre clé lève l’attente.
- **5xx** sur le flux d’un réseau : ce réseau attend (1 minute doublée jusqu’à
  30 minutes, ou le délai donné par le portail, jusqu’à 6 heures), les autres
  sont lus normalement ; tous les réseaux essayés en 5xx : toutes les requêtes
  attendent comme pour un 429.
- **HTTP 401/403 sur le flux d’un réseau** : la clé est vérifiée une fois sur
  les avis des trains. Refusée là aussi : l’intégration s’arrête et ne réessaie
  pas cette clé d’elle-même, même après un redémarrage ; saisissez une autre
  clé ou appuyez sur **Tester la clé** (un succès lève l’arrêt). Après un
  redémarrage, une nouvelle clé a 1 chance sur 256 de ressembler à la clé
  refusée (seuls 8 bits en sont gardés) : appuyez alors sur **Tester la clé**. Acceptée là :
  seul ce réseau attend (5 minutes, doublées jusqu’à 1 heure).
- Une erreur sur les avis d’un réseau autre qu’un 429 ou une réponse de quota
  (401/403 compris, les passages du réseau venant d’être lus avec la même clé)
  n’arrête pas les passages : ces avis attendent 5 minutes, doublées jusqu’à
  1 heure. Un 429 ou une réponse de quota sur les avis met toutes les requêtes
  en pause, comme plus haut (le quota est celui de la clé).
- Réponses bornées : 8 Mo pour un flux de passages, 2 Mo pour un flux d’avis,
  15 secondes par requête ; une réponse illisible ne publie rien.

## 5. Ce qui est gardé dans /data

`/data/exo.json` : l’heure du dernier tour, une pause, un refus (8 bits d’une
empreinte salée de la clé, rien de plus). Aucune clé. Quand le fichier ne peut
pas être lu, il n’est pas écrasé et il est relu toutes les 10 secondes ; un
fichier illisible comme JSON est d’abord mis de côté sous `exo.json.bad`.

## 6. Gares de train

Code à saisir, nom, `stop_id` des quais (GTFS des trains d’exo du 2026-10-28 ;
une gare plus récente peut être saisie par son `stop_id`).

| Code  | Gare                        | Quais          |
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

Lignes de train : 11 Vaudreuil-Hudson (VH), 12 Saint-Jérôme (SJ), 13
Mont-Saint-Hilaire (SH), 14 Candiac (CA), 15 Mascouche (MA).

## Données et licence

Données : exo (Réseau de transport métropolitain), par le
[portail développeur Chrono](https://portail-developpeur.chrono-saeiv.com/)
de l’ARTM et les [données ouvertes d’exo](https://exo.quebec/fr/a-propos/donnees-ouvertes),
sous [licence Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/deed.fr).
Les données sont modifiées : les prévisions sont filtrées par arrêt et par
ligne puis résumées (prochain passage, retard en minutes entières, nombre
d’annulations, nombre d’avis et texte du principal). Les tableaux des gares et
des lignes viennent du GTFS des trains d’exo.
