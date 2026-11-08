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
| `reco` | objet ou null | Spot et fenêtre à afficher, voir plus bas. Null hors saison | Oui |
| `spots` | tableau | Les 6 spots les plus proches, voir plus bas | Non |

### `mesure`

| Champ | Type | Sens |
|---|---|---|
| `n` | texte | Nom court du spot prioritaire (`spot_prioritaire`) |
| `now` | nœuds, entier, ou null | Vent mesuré à la station. 0 est une vraie mesure |
| `h` | `HH:MM` local, ou null | Heure de cette mesure à la station |
| `g` | `●`, `◐` ou `○` | ● une fenêtre tient à ce spot ; ◐ mesure à moins de `marge_mesure_kn` du seuil ; ○ sinon |

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

## Neige : hors contrat pour l'instant

Le bloc neige lit le plugin Neige Les Collines (395305), qui interroge lui-même
Open-Meteo, sans paramètre `models`, sur 16 jours. L'alerte utilise
`meteoswiss_icon_seamless` sur 5 jours. **Les deux peuvent diverger.** Exemple du
2026-11-08 : l'écran annonce 24 cm le 17/11, hors de l'horizon de l'alerte.

Le cumul d'épisode (spec B4.2) ne sera pas calculé en Liquid : il viendra de
`meteo-alert`, selon le choix de Greg.
