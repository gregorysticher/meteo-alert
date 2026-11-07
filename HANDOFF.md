# Transmission — Weather station (TRMNL + meteo-alert)

État au **07/11/2026**. À lire en premier dans toute nouvelle session, avec
[`TODO.md`](TODO.md). Démarrage de la session : §0.

---

## 0. Démarrer la session — Claude Code, pilotable depuis le téléphone

Le projet se poursuit dans **Claude Code**, sur le PC de Greg, en session
**Remote Control** : elle tourne en local (dépôts, Node, Chrome connecté à
TRMNL) et se pilote depuis l'app Claude du téléphone (onglet **Code**) ou
claude.ai/code. Une session cloud (claude.ai/code seul) ne conviendrait pas :
elle n'a pas accès au Chrome de Greg, donc pas à l'interface TRMNL.

### Une fois

1. Cloner les deux dépôts côte à côte, par exemple dans `C:\dev\weather-station\` :
   ```powershell
   git clone https://github.com/gregorysticher/meteo-alert.git
   git clone https://github.com/gregorysticher/trmnl-markup.git   # privé, lecture seule
   ```
2. Installer GitHub CLI et `gh auth login` : remplace le connecteur GitHub pour
   les Actions (`gh run list`, `gh run view --log`, `gh workflow run`).
3. Se connecter à Claude Code avec le **compte claude.ai** (`/login`), pas une clé
   API : Remote Control et l'intégration Chrome l'exigent.
4. Chrome ouvert, extension **Claude in Chrome** installée et connectée, session
   TRMNL ouverte.

### À chaque démarrage

```powershell
cd C:\dev\weather-station\meteo-alert
claude --chrome --remote-control --add-dir ..\trmnl-markup
```

(ou `claude --chrome`, puis `/remote-control` dans la session ; `/remote-control`
réaffiche l'URL et un QR code pour le téléphone.) Sur le téléphone : app Claude
→ **Code** → choisir la session.

### Contraintes

- La session n'existe que tant que le PC est allumé et que le processus `claude`
  tourne : fermer le terminal la met hors ligne. Si le PC se met en veille, elle
  se reconnecte au réveil, mais reste injoignable entre-temps (le réveil à
  distance du PC n'est pas encore en place).
- Chrome doit rester ouvert pour tout ce qui touche TRMNL.
- Commandes réservées au terminal (`/plugin`, `/resume`…) : pas depuis l'app.
- Pas de mémoire claude.ai dans Claude Code : `CLAUDE.md`, ce fichier et
  `TODO.md` font foi.

---

## 1. Architecture

### Dépôts

| Dépôt | Visibilité | Rôle |
|---|---|---|
| `gregorysticher/meteo-alert` | public | Alertes vent et neige, boucle QA, producteur du webhook vent TRMNL |
| `gregorysticher/trmnl-markup` | privé | Copie du markup TRMNL. `src/full.liquid` est écrit par `trmnl-sync[bot]` à chaque sauvegarde dans TRMNL |

**Ne jamais éditer `trmnl-markup` directement** : la sauvegarde suivante dans
TRMNL écraserait le commit. Le markup s'édite dans l'interface TRMNL (voir §6).

### Plugins TRMNL

Seul **DASHBOARD** est affiché ; il fusionne (Plugin Merge) les autres.

| Plugin | ID | Stratégie | Variable Liquid | Rôle |
|---|---|---|---|---|
| DASHBOARD | 392375 | Plugin Merge | — | Écran affiché |
| Netatmo Data 2 | 396948 | Polling OAuth | `D` | Intérieur / extérieur |
| Météo Carouge | 394232 | Polling Open-Meteo | `M` | Prévisions, 7 jours, pluie, UV, phénomènes |
| Neige Les Collines | 395305 | Polling Open-Meteo (16 j) | `S` | Chutes, hauteur au sol |
| Vent Wingfoil | 471074 | Webhook (alimenté par `wind-alert`) | `W` | Spots vent |
| Wind Forecast | 392131 | Recette lecture seule | — | Obsolète, « Degraded », à retirer |

E-mails de santé TRMNL activés sur les 5 plugins actifs (07/11/2026).

### Notifications

ntfy, sujets dans les secrets `NTFY_TOPIC_VENT` et `NTFY_TOPIC_NEIGE`. Envoi via
`notify.mjs` (gère les titres non ASCII ; une alerte n'est mémorisée que si
l'envoi a réussi).

---

## 2. Workflows

| Workflow | Cron (UTC) | Ce qu'il fait |
|---|---|---|
| `wind-alert.yml` | `15 */2 * * *` — livré ~3-4×/jour | Prévisions MétéoSuisse 8 spots, alertes 3 étages, QA, webhook TRMNL. Tourne hors saison (QA + webhook), n'alerte que du 15/04 au 15/10 |
| `snow-forecast-alert.yml` | `23 4,15 * * *` | Open-Meteo `meteoswiss_icon_seamless` 5 j, cumul par épisode ≥ `vars.SEUIL_NEIGE_CM` (10) |
| `snow-fresh-alert.yml` | `47 5,16 * * *` | SLF IMIS ILI2 (HN_1D) ≥ `vars.SEUIL_NEIGE_FRAICHE_CM` (10) |
| `probe-windlive.yml` | manuel | Sonde de découverte WindLive (lecture seule) |

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

### Règle d'affichage validée le 24/09/2026 — **non implémentée**

1. Le Reposoir tient le seuil → lui, **inversé**.
2. Sinon, premier spot par distance qui tient → lui, **inversé**.
3. Aucun ne tient → celui qui a la meilleure moyenne sur `min_heures` dans les
   créneaux, **affichage normal, sans avertissement**.

Un mardi qui tient passe devant un week-end mort (les créneaux le permettent
déjà). Le **jour** de la fenêtre doit apparaître à l'écran.

**Défaut actuel** : `versTrmnl` n'envoie que `de`/`a` (heures, sans date) et
`kn` brut (non corrigé du biais, alors que l'éligibilité l'est). Le markup
compare l'heure de fin à l'heure courante : un vendredi à 19 h, la fenêtre du
samedi 9 h est déclarée « passée » et l'écran retombe sur « Reposoir mesuré ».

**Conception prévue** (préparée le 24/09, jamais poussée) :
- `local()` expose `iso` (date locale AAAA-MM-JJ).
- Payload : `j` par spot ; objet `reco` au niveau racine
  `{ n, min, j, de, a, fin, kn, raf, ok }` — `fin` = epoch UTC (s) de fin du
  dernier créneau horaire, `ok` = tient le seuil. `kn` corrigé du biais.
- `choisirReco()` côté producteur (logique en un seul endroit) ; `meilleure()`
  pour le niveau 3, mêmes filtres que `fenetre()` sans condition de seuil.
- Markup : lit `W.reco`, `label--filled` si `ok`, jour via `frd[j|date:"%w"]`
  (« Auj. » si aujourd'hui), actif tant que `now_s < W.reco.fin`.
- Rétrocompatible : l'ancien markup ignore `reco`.

La branche `payload-jour-fenetre` part d'un ancien `main` : obsolète, à supprimer.

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
