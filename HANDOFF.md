# Transmission — Weather station (TRMNL + meteo-alert)

État au **2026-11-08** (fin de séance). À lire en premier dans toute nouvelle session, avec
[`TODO.md`](TODO.md). **Nouvelle session : commencer par le §0.**

---

## 0. Mise en route — à faire par la session elle-même

Le projet se poursuit dans **Claude Code**, sur le PC Windows de Greg, en session
**Remote Control** : elle tourne en local (dépôts, Node, Chrome connecté à
TRMNL) et Greg la suit depuis l'app Claude du téléphone (onglet **Code**) ou
claude.ai/code. Une session cloud seule ne convient pas : elle n'a pas accès au
Chrome de Greg, donc pas à l'interface TRMNL.

**Greg n'a rien préparé.** Il a lancé Claude Code et collé un message renvoyant
ici. La session fait elle-même les étapes ci-dessous, dans l'ordre, et ne
sollicite Greg que pour ce qu'elle ne peut pas faire (marqué **Greg**), une
chose à la fois, en une phrase.

1. **Dépôts.** Si la session ne tourne pas déjà dans `meteo-alert`, cloner les
   dépôts côte à côte dans `C:\Users\grego\Google Drive\Claude\weather-station\`
   (Greg veut ses dépôts dans Google Drive) :
   `meteo-alert` (public), `trmnl-markup` (privé, lecture seule ; nécessite
   l'étape 2), `trmnl-watch` et `trmnl-watchdog` (privés). Lire ensuite `CLAUDE.md`, ce fichier et `TODO.md` depuis le clone.
2. **GitHub CLI.** Si `gh` manque : `winget install --id GitHub.cli`. Puis
   `gh auth login --web` : **Greg** valide le code affiché dans son navigateur.
   Vérifier avec `gh auth status`. `gh` remplace le connecteur GitHub des
   sessions précédentes (`gh run list`, `gh run view --log`, `gh workflow run`).
3. **Remote Control permanent.** Vérifier que la session est joignable depuis
   le téléphone. Sinon : **Greg** tape `/config` et passe *Enable Remote Control
   for all sessions* à `true` (une fois pour toutes), puis `/remote-control`
   pour la session en cours. Faire renommer la session « Weather station »
   (`/rename`) pour la retrouver dans l'app.
4. **Chrome.** Vérifier que les outils navigateur sont disponibles et que
   trmnl.com est accessible avec la session de Greg. Sinon : **Greg** tape
   `/chrome` et active Chrome par défaut ; l'extension Claude in Chrome doit
   être installée et Chrome ouvert.
5. **Contrôle.** Rendre à Greg un état en 5 lignes : dépôts, `gh`, Remote
   Control, Chrome/TRMNL, derniers runs des workflows neige. Puis proposer le
   plan de la priorité du `TODO.md`.

Prérequis à connaître : Remote Control et Chrome exigent une connexion Claude
Code par **compte claude.ai** (pas une clé API). Docs :
code.claude.com/docs/en/remote-control et code.claude.com/docs/en/chrome.

### Contraintes de la session

- Elle n'existe que tant que le PC est allumé et que le processus `claude`
  tourne : fermer le terminal la met hors ligne. En veille, elle se reconnecte
  au réveil mais reste injoignable entre-temps (le réveil à distance du PC
  n'est pas encore en place).
- Chrome doit rester ouvert pour tout ce qui touche TRMNL.
- Depuis l'app, les commandes réservées au terminal (`/plugin`, `/resume`…) ne
  marchent pas.
- Greg suit souvent depuis le téléphone : réponses courtes, une question à la
  fois, rendus montrés en image.
- Pas de mémoire claude.ai dans Claude Code : `CLAUDE.md`, ce fichier et
  `TODO.md` font foi. Les tenir à jour.

---

## 1. Architecture

### Dépôts

| Dépôt | Visibilité | Rôle |
|---|---|---|
| `gregorysticher/meteo-alert` | public | Alertes vent et neige, boucle QA, producteur du webhook vent TRMNL |
| `gregorysticher/trmnl-markup` | privé | Copie du markup TRMNL, écrite par `trmnl-sync[bot]` à chaque sauvegarde dans TRMNL : `src/` pour le DASHBOARD, `page-detail/src/` pour la page détail (plugin 471074, depuis le 2026-11-10) |
| `gregorysticher/trmnl-watch` | privé | Veille hebdomadaire (lundi) : arrivée des special functions sur le TRMNL X. A sonné le 02/11/2026 à juste titre, coupée le 09/11/2026 |
| `gregorysticher/trmnl-watchdog` | privé | Santé et fraîcheur de Netatmo 396948 seul, via le MCP TRMNL, 3 runs/jour, ntfy sur transition. `degraded` collant depuis le 03/08/2026, données fraîches |

**Ne jamais éditer `trmnl-markup` directement** : la sauvegarde suivante dans
TRMNL écraserait le commit. Le markup s'édite dans l'interface TRMNL (voir §6).

### Plugins TRMNL

Contrat du payload vent : [`docs/contrat-trmnl.md`](docs/contrat-trmnl.md). Le markup
rend, `meteo-alert` décide.

Seul **DASHBOARD** est affiché ; il fusionne (Plugin Merge) les autres.

| Plugin | ID | Stratégie | Variable Liquid | Rôle |
|---|---|---|---|---|
| DASHBOARD | 392375 | Plugin Merge | — | Écran affiché |
| Netatmo Data 2 | 396948 | Polling OAuth | `D` | Intérieur / extérieur |
| Météo Carouge | 394232 | Polling Open-Meteo | `M` | Prévisions, 7 jours, pluie, UV, phénomènes |
| Neige Les Collines | 395305 | Polling Open-Meteo (16 j) | `S` | Chutes, hauteur au sol |
| Détail vent et neige (ex-Vent Wingfoil, renommé le 2026-11-11) | 471074 | Webhook (alimenté par `wind-alert`) | `W` | Données du DASHBOARD ; son propre markup est la page détail vent et neige |

Wind Forecast (392131), recette obsolète, a été désinstallé le 2026-11-08.

E-mails de santé TRMNL activés sur les 5 plugins actifs (07/11/2026).

Appareil : TRMNL X, firmware 1.8.18 (special functions disponibles via le menu de
l'appareil, *Special...*). Depuis le 2026-11-09 : playlist en *Hold screen* sur le
DASHBOARD, Détail vent et neige (page détail) visible juste après, le reste masqué. Milieu deux
fois ou droite → page détail, gauche → retour. Laissé sur la page détail, l'écran y
reste. Guest Mode : Détail vent et neige, 30 min. Le handoff Cowork qui les disait
indisponibles et citait 392131 ou le Col de Cou est périmé.

### Notifications

ntfy, sujets dans les secrets `NTFY_TOPIC_VENT` et `NTFY_TOPIC_NEIGE`. Envoi via
`notify.mjs` (gère les titres non ASCII ; une alerte n'est mémorisée que si
l'envoi a réussi).

---

## 2. Workflows

| Workflow | Cron (UTC) | Ce qu'il fait |
|---|---|---|
| `wind-alert.yml` | `17 1,5,9,13,17,21 * * *` (depuis le 2026-11-07, à suivre) | Prévisions MétéoSuisse 8 spots, alertes 3 étages, QA, webhook TRMNL. Tourne hors saison (QA + webhook), n'alerte que du 15/04 au 15/10 |
| `snow-forecast-alert.yml` | `23 4,15 * * *` | Open-Meteo `meteoswiss_icon_seamless` 5 j, cumul par épisode ≥ `vars.SEUIL_NEIGE_CM` (10) |
| `snow-fresh-alert.yml` | `47 5,16 * * *` | SLF IMIS ILI2 (HN_1D) ≥ `vars.SEUIL_NEIGE_FRAICHE_CM` (10) ; journal et rapport prévision/mesure (`data/neige.csv`) |
| `probe-windlive.yml` | manuel | Sonde de découverte WindLive (lecture seule) |

**Déclencheur Cloudflare** (`worker/`, Worker `meteo-alert-cron`, déployé le 2026-11-09
sur le compte Cloudflare de Greg, secrets `GH_TOKEN` et `NTFY_TOPIC_PANNE`) : appelle
`workflow_dispatch` aux mêmes heures, cron GitHub gardé en secours. Le cron de
`wind-alert` saute si un vrai run a écrit depuis moins de `vars.GARDE_CRON_VENT_H`
heures (`cron-garde.mjs`, 3 h ; 4,5 h une fois le Worker actif).

**Variables neige** : `SEUIL_NEIGE_CM` (10), `HAUSSE_NEIGE_CM` (5),
`MARGE_ANNUL_NEIGE_CM` (2), `PROLONGE_MIN_NEIGE_CM` (2), `AFFICHAGE_NEIGE_CM` (5).
Règles dans `snow-episodes.mjs` ; état dans `snow-forecast-alerted.json`. L'alerte écrit
`data/neige-ecran.json`, que `wind-alert` joint au payload ; si l'épisode change, le
workflow neige relance `wind-alert` aussitôt. Journal `data/neige.csv` : prévision du modèle de l'alerte et
du modèle long, précipitations, température, 4 stations SLF. L'API SLF ne garde que
7 jours : ce journal est irremplaçable.

**Données QA** (`wind-qa.mjs`) : `data/forecasts/AAAA-MM.csv` par mois d'émission,
`data/qa/AAAA-MM.csv` par mois d'échéance, colonne `modele` (`ms`, `arome`) ; le biais
des alertes ne lit que `ms`. `data/gradient.csv` : air mesuré − eau, se joint à
`data/qa/` sur (spot, échéance = ts). Run rouge si un fichier dépasse 45 Mo.

Tous les workflows jouent leurs tests (`test/`) avant le script ; un échec
(test, API, push) rend le run rouge. Lire le **log**, pas seulement le statut.

Runs manuels : `dry_run` vaut vrai par défaut. `wind-alert` accepte aussi
`seuil_test` (envoi marqué `[TEST]`, sans toucher anti-spam ni QA).

---

## 3. Neige (saison 15/10 → 15/04)

### Interventions du 07/11/2026

1. **Alerte neige annoncée aveugle du 15/10 au 07/11.** Open-Meteo renvoyait
   HTTP 400 : `meteoswiss_seamless` n'est plus un nom de modèle valide. Le run
   sortait en vert. Corrigé en `meteoswiss_icon_seamless` ; un refus de l'API
   (4xx, erreur réseau, unité inattendue) fait désormais **échouer le run**.
   Commits `0365f1c`, `aa5f32f`.
2. **Trois plugins TRMNL arrêtés** (Neige, Météo Carouge, Netatmo). Après une
   erreur, TRMNL coupe l'auto-refresh sans prévenir (statut « Stopped »). Neige
   n'avait rien rafraîchi depuis au moins 30 jours. Remède : *Reset Health* puis
   *Refresh now*.
3. **Markup** (commit `trmnl-sync` `11d3631`) :
   - `SEUIL_NEIGE_ALERTE_CM = 10` : la première chute du jour ≥ 10 cm est
     affichée **en inversé** et prime sur une chute 5-9 cm antérieure ; à défaut,
     première chute ≥ `SEUIL_NEIGE_CM` (5) en normal. Jours passés ignorés.
   - Badge `NEIGE PÉRIMÉ · N j` si `S.daily.time[0]` a plus de
     `SEUIL_PERIME_NEIGE_J` (1) jour de retard sur la date locale ;
     `NEIGE HORS LIGNE` si absent. Allume aussi le `!` du bandeau.
4. E-mails de santé TRMNL activés.

### Écart connu

L'alerte porte sur le **cumul d'un épisode** (jours consécutifs), l'écran sur la
**chute d'un jour**. Le 07/11, prévision ≈ 0 cm pour 8,6 cm mesurés — un seul
point, à suivre.

---

## 4. Vent (hors saison jusqu'au 15/04)

### Configuration — `wind/spots.json`

- `seuil_kn` 11, `min_heures` 3, `horizon_jours` 7, `ratio_rafale_max` 1.8.
- Créneaux : samedi 9-18, dimanche 9-18, mardi 8-13 (`creneaux`, clés = jour JS).
- Spots par `route_min` : Reposoir 12, Cologny 15, Vengeron 15, Coppet 20,
  Nyon 25, Préverenges 55, Bouveret 80, Joux 80.
- **Sélection : le plus PROCHE qui tient le seuil, jamais le plus venté.**
- Alertes 3 étages (`pre` J-3/J-5 marge 1,5 kn, `conf` la veille, `jour` le
  matin), correction du biais par échéance mesuré par le QA, annulation si une
  pré-alerte ne tient plus.
- Historique réel : 10/10/2026 Préverenges — pré-alerte, annulation, puis
  « Aujourd'hui » sur une fenêtre de 13 h.

### Règle d'affichage validée le 24/09/2026 — implémentée le 07/11/2026

1. Le Reposoir (`spot_prioritaire`) tient le seuil → lui, **inversé**.
2. Sinon, premier spot par distance qui tient → lui, **inversé**.
3. Aucun ne tient → celui qui a la meilleure moyenne sur `min_heures` dans les
   créneaux, **affichage normal, sans avertissement**.

Un mardi qui tient passe devant un week-end mort. Le **jour** de la fenêtre
apparaît à l'écran : « Reposoir · Dim 10–14 h » (« Auj. » si aujourd'hui).

**Mise en œuvre** :
- `wind-select.mjs` (fonctions pures) : `local()` expose `iso` ;
  `fenetre()` ; `meilleure()` (niveau 3, mêmes filtres sans seuil) ;
  `choisirReco()`.
- Payload : décrit dans [`docs/contrat-trmnl.md`](docs/contrat-trmnl.md), qui fait foi.
- Markup : lit `W.reco`, `label--filled` si `ok`, actif tant que
  `now_s < W.reco.fin` (plus de fenêtre « passée » le vendredi soir).
- « Tenir » = la **prochaine** fenêtre (une fenêtre commencée compte sur
  toute sa longueur jusqu'à sa fin) dans `horizon_jours`. Alertes :
  `choisirAlerte()` par étage, sur la partie à venir ; anti-spam par étage
  et par jour (`dejaEnvoye()`), un jour déjà alerté est sauté.
- Tests : `test/reco.test.mjs` (config figée, règle, étages, constats QA,
  cohérence de `spots.json`), joués par `wind-alert.yml` avant chaque run.
  Webhook TRMNL refusé → run rouge.
- Pas encore vu sur un vrai payload : contrôle à l'ouverture de saison.

### Sonde WindLive (04/10/2026)

`/api/stations` : 789 points, 10 entre Genève et Nyon (Creux de Genthod, SNG,
Pioupiou côté Cologny, GVE, CGI…). `robots.txt` : `Disallow: /api/`. **Non
exploitable sans accord.** L'angle mort Reposoir/Vengeron (adossés à GVE) reste.

---

## 5. Points ouverts

Voir [`TODO.md`](TODO.md).

---

## 6. Méthodes de travail

### Conventions

- Claude exécute lui-même, de bout en bout. Pour un choix d'affichage, il
  applique les variantes et montre les rendus à Greg.
- **Couleur inversée (`label--filled`) = « regarde ça »** : neige qui arrive,
  pluie la nuit quand il fait chaud, fenêtre de vent qui tient. Rien d'autre.
  Pas d'avertissement quand c'est insuffisant.
- Seuils en variables de dépôt ou de config, jamais en dur.
- Crons à heures fixes, minutes décalées, pas de `*/N` (GitHub livre mal les
  crons à intervalle). `wind-alert` déroge encore à la règle.
- Sonde de découverte en lecture seule avant tout code de production, puis
  `DRY_RUN`.
- Un échec doit rendre le run **rouge**, jamais passer en silence.
- Vérifier contre la documentation officielle avant d'affirmer un comportement
  d'API ; tester les paramètres contre l'API réelle.
- Les classes CSS du markup doivent exister dans le framework TRMNL (pas de
  Tailwind) : `label--filled`, `value--large`, `w--[5cqw]`, etc.

### Éditer le markup TRMNL

1. `https://trmnl.com/plugin_settings/392375/markup/edit?size=markup_full`
2. L'éditeur est CodeMirror 6 ; le `<textarea>` caché n'est pas la source.
   `const v = document.querySelector('.cm-content').cmView.view;`
   lire `v.state.doc.toString()`, remplacer en vérifiant que chaque ancre est
   unique, puis `v.dispatch({changes:{from:0,to:v.state.doc.length,insert:s}})`.
3. L'aperçu se met à jour en direct : le contrôler (`DEBUG_PERIME = true`
   force les badges ; **remettre à `false`** avant d'enregistrer).
   Données simulées : ajouter après `assign W = …` une ligne
   `{%- assign W = '<json>' | parse_json -%}` (filtre TRMNL, fonctionne) et
   `{%- assign saison = "vent" -%}` après le calcul de saison ; les retirer et
   contrôler le texte (hash) avant d'enregistrer.
4. « Save Changes », puis vérifier le commit `trmnl-sync[bot]` dans
   `trmnl-markup`.

### Pièges connus

- Plugin TRMNL en erreur → auto-refresh arrêté sans alerte (e-mails santé
  désormais actifs).
- Liquid : `0` est truthy ; `{% if x %}` distingue zéro et nil.
- Le rendu Liquid TRMNL est en UTC ; `nows = now_s + M.utc_offset_seconds`.
- Open-Meteo : `snowfall_sum` en cm, `snow_depth_max` en m.
- Netatmo : 503 intermittents, connus.

### Accès

- GitHub : clones locaux + `gh` (commits, Actions). Les secrets du dépôt ne
  sont ni lisibles ni modifiables : ce qui en dépend revient à Greg.
- TRMNL : via le Chrome de Greg (session connectée), `claude --chrome`.
- Mise en page, TRMNL ou captures : montrer les rendus dans la session, Greg
  peut les regarder depuis le téléphone.
