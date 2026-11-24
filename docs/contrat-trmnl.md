# Contrat du payload TRMNL

Cette description fait foi. Le commentaire du markup renvoie ici, il n'en est pas une
copie.

## Répartition

- **`meteo-alert`** est la seule source de vérité sur les conditions : prévisions
  MétéoSuisse, correction du biais, fenêtres, choix du spot, seuils, saison. Il publie
  deux sorties : l'alerte ntfy et ce payload.
- **Les markups** (DASHBOARD 392375, dépôt `trmnl-markup` ; page détail du plugin « Détail vent et neige »
  471074, dans la playlist de 7h à 22h et en Guest Mode) ne font que rendre. Il ne
  recalcule rien, ne retrie rien, ne convertit aucune unité et ne copie aucune valeur.
  Il garde seulement ce qui dépend de l'heure du rendu (fenêtre finie, âge des données)
  et la mise en forme.

## Règles

1. On peut **ajouter** des champs. On n'en retire aucun et on n'en change ni le sens ni
   l'unité sans prévenir l'autre côté.
2. Si l'affichage a besoin d'une donnée absente, on l'ajoute ici. On ne la calcule pas
   en Liquid.
3. `test/wind-e2e.test.mjs` vérifie la liste des champs : retirer un champ fait échouer
   le run.

## Transport

Webhook : `wind-alert.mjs` pousse à chaque run vers le plugin « Détail vent et neige » (471074, ex-Vent Wingfoil), via
le secret `TRMNL_WEBHOOK_URL`. Le payload remplace le précédent. Limites TRMNL : 5 Ko et
12 envois par heure. Un refus ou un payload trop gros rend le run rouge.

**Décidé le 2026-11-08 : pas de polling.** Chez TRMNL, c'est le polling qui tombe en panne
(Wind Forecast en « Refresh Paused » après un 503, Neige figée plus d'un mois), et les
données ne changent qu'à chaque run. À revoir si un second consommateur apparaît.

## Champs : `merge_variables`

| Champ | Type | Sens | Écran |
|---|---|---|---|
| `maj` | texte `AAAAMMJJHHMM`, UTC | Émission du run MétéoSuisse. Ni l'heure du run, ni celle de la mesure | Âge des données (badge VENT PÉRIMÉ) |
| `saison` | `vent` ou `neige` | Selon `saison` de `wind/spots.json` | Choix du bloc. Page détail : le vent seul en saison vent, la neige seule en saison neige (règle de Greg, 2026-11-09) |
| `seuil` | nœuds | `seuil_kn` de `wind/spots.json` | Non |
| `tz` | secondes | Décalage de l'heure suisse sur UTC au moment du run (3600 ou 7200). Depuis le 2026-11-09 : `trmnl.user.utc_offset` pourrait ne pas suivre l'heure d'été | Heure locale de la page détail |
| `mesure` | objet ou null | Spot prioritaire mesuré, voir plus bas | Oui |
| `neige` | objet ou null | Ligne neige, voir plus bas. Null en saison vent, ou si l'alerte neige n'a pas encore écrit | Oui, en saison neige |
| `reco` | objet ou null | Spot et fenêtre à afficher, voir plus bas. Null s'il n'y a aucune heure exploitable dans l'horizon. Indépendant de `saison` | Oui, en saison vent |
| `spots` | tableau | Les 6 spots les plus proches, voir plus bas | Page détail, en saison vent |
| `profil` | objet ou null | Profil horaire du spot et du jour de `reco`, voir plus bas. Null si `reco` est null | Page détail, en saison vent |
| `plan` | objet ou null | Plan de la semaine par spot, voir plus bas. Depuis le 2026-11-21. Null sans aucune heure exploitable sur la semaine (hors saison vent en pratique ; il peut exister du 8 au 14 avril, saison encore « neige ») | Page détail, en saison vent |

### `mesure`

| Champ | Type | Sens |
|---|---|---|
| `n` | texte | Nom court du spot prioritaire (`spot_prioritaire`) |
| `now` | nœuds, entier, ou null | Vent mesuré à la station. 0 est une vraie mesure |
| `h` | `HH:MM` local, ou null | Heure de cette mesure à la station |
| `g` | `●`, `◐` ou `○` | ● une fenêtre tient à ce spot ; ◐ mesure brute ≥ seuil − `marge_mesure_kn`, sans fenêtre ; ○ sinon |

### `reco`

Règle : le spot prioritaire s'il tient le seuil, sinon le plus proche qui tient, sinon la
meilleure moyenne sur `min_heures` dans les créneaux (`ok` faux).

| Champ | Type | Sens |
|---|---|---|
| `n` | texte | Nom court du spot |
| `min` | minutes | Temps de route depuis Carouge. Non affiché, mais il porte la règle de sélection : sujet de maquette, à ne pas retirer |
| `j` | `AAAA-MM-JJ` local | Jour du début de fenêtre |
| `de` | `HH:MM` local | Début de fenêtre |
| `a` | `HH:MM` local | **Fin réelle** de fenêtre. Depuis le 2026-11-08 ; avant, début de la dernière heure |
| `fin` | epoch UTC, secondes | Fin de fenêtre. Sert à masquer une fenêtre finie au moment du rendu |
| `kn` | nœuds, entier | Moyenne corrigée du biais |
| `raf` | nœuds, entier | Rafale maximale prévue. Non affichée |
| `ok` | booléen | La fenêtre tient le seuil. Vrai : libellé inversé |
| `g` | `●` ou `○` | Glyphe de la fenêtre |

### `spots[]`

Triés par temps de route croissant. Lus par la page détail seulement (le DASHBOARD ne
les lit plus depuis le 2026-11-08). Sans fenêtre, `j`, `de`, `a`, `fin`, `kn`, `raf` et
`e` sont nuls ensemble : c'est l'état normal.

| Champ | Type | Sens |
|---|---|---|
| `n` | texte | Nom court |
| `min` | minutes | Temps de route |
| `now` | nœuds, entier, ou null | Mesure à la station |
| `d` | degrés, ou null | Direction mesurée |
| `j`, `de`, `a` | comme `reco` | Prochaine fenêtre au seuil plein |
| `fin` | epoch UTC, secondes | Fin de cette fenêtre, comme `reco.fin`. Depuis le 2026-11-09 |
| `kn` | nœuds, entier | Moyenne corrigée du biais |
| `raf` | nœuds, entier | Rafale maximale prévue |
| `e` | 2 ou null | 2 : une fenêtre tient le seuil. Aucune autre valeur n'existe |

### `profil`

Depuis le 2026-11-09. Pour la page détail : le spot et le jour de `reco`, heure par heure.

| Champ | Type | Sens |
|---|---|---|
| `n` | texte | Nom court, celui de `reco.n` |
| `j` | `AAAA-MM-JJ` local | Jour, celui de `reco.j` |
| `de` | heure locale, entier | Heure de la première valeur (7). Les valeurs suivent d'heure en heure jusqu'à 21 h |
| `kn` | tableau de nœuds au dixième, ou null | Prévision corrigée du biais. Au dixième, pour qu'une barre grise ne touche pas la ligne du seuil (10,6 arrondi à 11). Null : heure absente des données |
| `ok` | tableau de 0 ou 1 | 1 : l'heure est exploitable (créneau, saison, secteur, horizon de 7 jours) et au seuil plein. C'est la règle des fenêtres sans la durée minimale : une heure isolée peut valoir 1. Au-delà de l'horizon, une heure au-dessus du seuil vaut 0 |

### `plan`

Depuis le 2026-11-21 (`planSemaine`, `wind-select.mjs`). Pour les 6 spots de `spots[]`, dans le
même ordre, et les 7 jours de l'horizon à partir du jour du run.

| Champ | Type | Sens |
|---|---|---|
| `jours` | tableau de `AAAA-MM-JJ` local | Les 7 jours, du jour du run à J+6 |
| `s[i].n` | texte | Nom court, celui de `spots[i].n` |
| `s[i].kn` | tableau de nœuds entiers, ou null | Meilleure moyenne corrigée du biais sur `min_heures` heures exploitables consécutives du jour (créneau, saison, secteur, horizon, heures pas finies). Null : aucune suite assez longue ce jour-là |
| `s[i].ok` | tableau de 0 ou 1 | 1 : une fenêtre au seuil plein commence ce jour-là (règle de `fenetres()`). Libellé inversé |

L'écran grise les jours déjà passés au moment du rendu.

### `neige`

Écrit par l'alerte neige annoncée (`data/neige-ecran.json`), joint au payload par
`wind-alert` : un seul envoi vers TRMNL, un seul chiffre. Même modèle
(`meteoswiss_icon_seamless`), même découpage et même horizon de 5 jours que l'alerte.

| Champ | Type | Sens |
|---|---|---|
| `maj` | texte `AAAAMMJJHHMM`, UTC | Heure du run de l'alerte neige. Sert au badge NEIGE PÉRIMÉ |
| `lieu` | texte | Nom du lieu |
| `min` | cm | Cumul à venir minimal pour montrer une chute sans inversion (`AFFICHAGE_NEIGE_CM`) |
| `jour` | `AAAA-MM-JJ` local | Date du run |
| `jours` | tableau de `{ d, cm }` | Série prévue depuis le jour du run, en cm de neige selon la conversion D-005 (`snow-conversion.mjs`), la même que l'alerte. L'écran en tire « 24 h » et « 5 j » selon la date du rendu |
| `episodes` | tableau | Épisodes ouverts par ordre de priorité, mêmes champs que `episode`. L'écran prend le premier qui n'est pas fini au moment du rendu |
| `j0` | cm, entier | Chute prévue le jour du run |
| `j5` | cm, entier | Chute prévue sur les 5 jours, jour du run compris |
| `episode` | objet ou null | Premier de `episodes`. Null : aucune chute à montrer |
| `episode.cm` | cm, entier | Épisode pas commencé : cumul, somme des épisodes qui chevauchent l'annonce, comme l'alerte. Au moment d'une alerte, c'est son chiffre ; ensuite, c'est la valeur courante de la prévision, qui peut monter de moins que `HAUSSE_NEIGE_CM` ou baisser sans message. **Épisode commencé (D-008, depuis le 24.11.2026)** : neige qui reste à tomber à l'heure de l'envoi (`wind-alert`, toutes les 4 h), aujourd'hui compris ; sous `min` cm, l'épisode quitte la liste et le suivant prend sa place. `data/neige-ecran.json` garde le cumul |
| `episode.total` | cm, entier | Depuis le 24.11.2026 (D-008). Cumul complet de l'épisode, le chiffre de l'alerte, commencé ou non |
| `episode.cours` | booléen | Depuis le 24.11.2026 (D-008). Vrai : épisode commencé, `cm` et `de` sont ce qui reste (`de` = premier jour restant avec au moins 1 cm) |
| `episode.de`, `episode.a` | `AAAA-MM-JJ` local | Premier et dernier jour ; épisode commencé : premier jour restant et dernier jour |
| `episode.ok` | booléen | Vrai : le cumul atteint le seuil. Libellé inversé. Dans la marge d'annulation : faux, sans message |
| `jours[].tn`, `jours[].tx` | °C entiers, ou null | Depuis le 2026-11-21 (`snow-detail.mjs`, page détail). Minimum et maximum à 2022 m |
| `jours[].pl` | mm entiers, ou null | Pluie du modèle (`rain_sum` + `showers_sum`) |
| `jours[].iso` | m, à 100 m, ou null | Isotherme 0 °C le plus haut entre 9h et 16h locales |
| `jours[].raf` | km/h entiers, ou null | Rafale maximale à 2022 m |
| `jours[].sol` | h entières, ou null | Ensoleillement |
| `jours[].p` | 0 ou 1 | Jour de poudre : neige de la veille (conversion D-005) ≥ `POUDRE_CM`, soleil ≥ `POUDRE_SOLEIL_H`, rafales < `POUDRE_RAFALES_KMH`, maximum ≤ `POUDRE_TMAX_C` (10 cm, 4 h, 50 km/h, 2 °C par défaut). Libellé inversé |
| `alt` | m | Altitude du lieu (2022), pour le titre |
| `h` | objet ou null | Heure par heure, 60 heures à partir de l'heure en cours au run neige : `h0` (début de la première heure, epoch UTC s), `cm` (neige convertie D-005, au dixième), `pl` (pluie du modèle `rain` + `showers`, mm au dixième, sur la même eau que la neige : affichée à part, jamais empilée), `t` (°C entiers). Null dans un tableau : heure absente. L'écran masque les heures finies au moment du rendu et en montre 48 |
| `mesure` | objet ou null | Ajouté par `wind-alert` à chaque envoi (relevés du dépôt). Station ILI2 : `h` (dernier relevé HS, epoch UTC s), `hs` (cm), `d24` (HS − HS 24 h avant, ou null), `ta` (°C au dixième, ou null), `hn` (trois derniers HN_1D publiés, `{ d, cm }`, lecture J+1 : 24 h jusqu'à 7h le jour `d`). Null sans archive HS ou si le dernier relevé a plus de 48 h |
| `avalanche` | objet ou null | Ajouté par `wind-alert` à chaque envoi (bulletin SLF du moment, région CH-1312 Monthey - Val d'Illiez) : `niveau` (1 à 5, le plus haut de la journée), `sous` (`-`, `+` ou vide ; − < = < +), `nom` (« fort »…), `pb` (deux problèmes au plus, en français, « dès X m » collé au problème concerné), `debut`, `fin` (validité, epoch UTC s). Null : pas de bulletin publié (vert) ou panne / région absente (run rouge, l'envoi part quand même) |

Priorité : au seuil avec au moins `min` cm à venir, puis au seuil, puis les autres ; à rang
égal, le plus proche. Le fichier s'écrit à chaque run, y compris si un envoi ntfy a échoué :
l'écran peut alors précéder l'alerte, qui repart au run suivant (run rouge). Quand la liste
change, l'alerte neige relance `wind-alert`. Horizon coupé à 5 jours (décidé le 2026-11-08) : au-delà, on mesure
d'abord (`data/neige.csv`, `modele=long`), on n'affiche pas.

**Reste au plugin Neige (395305) : la hauteur au sol seule.** Il interroge Open-Meteo sans
`models`, sur 16 jours : il ne doit plus fournir aucune chute à l'écran.
