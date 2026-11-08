# Contrat du payload TRMNL

Cette description fait foi. Le commentaire du markup renvoie ici, il n'en est pas une
copie.

## Répartition

- **`meteo-alert`** est la seule source de vérité sur les conditions : prévisions
  MétéoSuisse, correction du biais, fenêtres, choix du spot, seuils, saison. Il publie
  deux sorties : l'alerte ntfy et ce payload.
- **Le markup** (DASHBOARD 392375, dépôt `trmnl-markup`) ne fait que rendre. Il ne
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

Webhook : `wind-alert.mjs` pousse à chaque run vers le plugin Vent Wingfoil (471074), via
le secret `TRMNL_WEBHOOK_URL`. Le payload remplace le précédent. Limites TRMNL : 5 Ko et
12 envois par heure. Un refus ou un payload trop gros rend le run rouge.

**Décidé le 2026-11-08 : pas de polling.** Chez TRMNL, c'est le polling qui tombe en panne
(Wind Forecast en « Refresh Paused » après un 503, Neige figée plus d'un mois), et les
données ne changent qu'à chaque run. À revoir si un second consommateur apparaît.

## Champs : `merge_variables`

| Champ | Type | Sens | Écran |
|---|---|---|---|
| `maj` | texte `AAAAMMJJHHMM`, UTC | Émission du run MétéoSuisse. Ni l'heure du run, ni celle de la mesure | Âge des données (badge VENT PÉRIMÉ) |
| `saison` | `vent` ou `neige` | Selon `saison` de `wind/spots.json` | Choix du bloc |
| `seuil` | nœuds | `seuil_kn` de `wind/spots.json` | Non |
| `mesure` | objet ou null | Spot prioritaire mesuré, voir plus bas | Oui |
| `neige` | objet ou null | Ligne neige, voir plus bas. Null en saison vent, ou si l'alerte neige n'a pas encore écrit | Oui, en saison neige |
| `reco` | objet ou null | Spot et fenêtre à afficher, voir plus bas. Null s'il n'y a aucune heure exploitable dans l'horizon. Indépendant de `saison` | Oui, en saison vent |
| `spots` | tableau | Les 6 spots les plus proches, voir plus bas | Non |

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

Triés par temps de route croissant. Non lus par le markup depuis le 2026-11-08. Sans
fenêtre, `j`, `de`, `a`, `kn`, `raf` et `e` sont nuls ensemble : c'est l'état normal.

| Champ | Type | Sens |
|---|---|---|
| `n` | texte | Nom court |
| `min` | minutes | Temps de route |
| `now` | nœuds, entier, ou null | Mesure à la station |
| `d` | degrés, ou null | Direction mesurée |
| `j`, `de`, `a` | comme `reco` | Prochaine fenêtre au seuil plein |
| `kn` | nœuds, entier | Moyenne corrigée du biais |
| `raf` | nœuds, entier | Rafale maximale prévue |
| `e` | 2 ou null | 2 : une fenêtre tient le seuil. Aucune autre valeur n'existe |

### `neige`

Écrit par l'alerte neige annoncée (`data/neige-ecran.json`), joint au payload par
`wind-alert` : un seul envoi vers TRMNL, un seul chiffre. Même modèle
(`meteoswiss_icon_seamless`), même découpage et même horizon de 5 jours que l'alerte.

| Champ | Type | Sens |
|---|---|---|
| `maj` | texte `AAAAMMJJHHMM`, UTC | Heure du run de l'alerte neige. Sert au badge NEIGE PÉRIMÉ |
| `lieu` | texte | Nom du lieu |
| `min` | cm | Cumul à venir minimal pour montrer une chute sans inversion (`AFFICHAGE_NEIGE_CM`) |
| `j0` | cm, entier | Chute prévue aujourd'hui |
| `j5` | cm, entier | Chute prévue sur les 5 jours, aujourd'hui compris |
| `episode` | objet ou null | Null : aucune chute à montrer |
| `episode.cm` | cm, entier | Cumul de l'épisode, jours passés compris : le chiffre de l'alerte |
| `episode.de`, `episode.a` | `AAAA-MM-JJ` local | Premier et dernier jour |
| `episode.ok` | booléen | Vrai : ce cumul mérite une alerte. Libellé inversé |

Choix de l'épisode : le premier qui mérite une alerte, sinon le premier avec au moins
`min` cm à venir. Horizon coupé à 5 jours (décidé le 2026-11-08) : au-delà, on mesure
d'abord (`data/neige.csv`, `modele=long`), on n'affiche pas.

**Reste au plugin Neige (395305) : la hauteur au sol seule.** Il interroge Open-Meteo sans
`models`, sur 16 jours : il ne doit plus fournir aucune chute à l'écran.
