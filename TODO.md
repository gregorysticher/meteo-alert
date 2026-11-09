# TODO — Weather station (meteo-alert + TRMNL)

Dernière mise à jour : 2026-11-09
Session : Weather Station — https://claude.ai/code/session_01V44DmrGmT76TSq2yZ4XBUY — PC claude://claude.ai/epitaxy/local_0979867e-6d1b-45c0-973d-5fd7476274f3
Contexte complet : [`HANDOFF.md`](HANDOFF.md).

À lire au début de chaque session, à mettre à jour à chaque fin de séance
(Claude Code, clone local). Le briefing quotidien le lit.

---

## À faire par Greg

Ce que Greg seul peut faire ou décider. Échéance quand elle est connue.

- [ ] **Signaler fausses alertes et manques** (vent au printemps, neige cet
      hiver) — seule matière pour calibrer seuils, secteurs et ratio de rafales.
- [ ] **Valider le format d'alerte vent** sur une vraie journée ventée (rendu
      ntfy, lien Maps) — je ne vois pas ton téléphone. Échéance : première
      alerte de la saison 2027 (dès le 2027-04-15).
- [ ] **Foil 1600 cm²** : si tu le prends, me le dire — `seuil_kn` passe à 9,5.
      Échéance : avant le 2027-04-15.
- [ ] **Rappel demandé par Greg pour la prochaine séance : la nouveauté TRMNL attendue
      est arrivée.** Les *special functions* du TRMNL X sont disponibles avec le firmware
      1.8.18 (menu de l'appareil, *Special...*). La veille a sonné le 2026-11-02. Décision
      qui en découle : voir Guest Mode ci-dessous.
- [ ] **Guest Mode du TRMNL X** : disponible (firmware 1.8.18 installé). Recréer
      Wind Forecast (config au spec B1, Open-Meteo) ou faire un écran vent alimenté
      par `meteo-alert` ?
- [ ] **Second écran vide** : le signaler avec l'heure s'il revient (non
      reproduit le 2026-11-07). Spec B2.
- [ ] **WindLive** : leur `robots.txt` interdit `/api/`. Décider si on leur
      demande l'autorisation (balises lacustres du Petit-Lac, seule correction
      possible de l'angle mort Reposoir/Vengeron) ou si on abandonne.

---

## Backlog Claude

### Avant le 15/04/2027 — prioritaire

- [ ] Contrôler le premier vrai `W.reco` à l'écran à l'ouverture de la
      saison (2027-04-15) : jour, heures, inversion.
- [ ] 2026-11-14 : compter les commits `data: wind` par jour (pas les runs : la garde
      en saute). En dessous de 4, revoir (spec B3).
- [ ] Worker Cloudflare : vérifier le premier vrai déclenchement (2026-11-09, 21:17 UTC,
      `wind-alert` en `workflow_dispatch`), puis passer `GARDE_CRON_VENT_H` à 4,5 et
      vérifier un vrai run sauté dans les logs.
- [ ] Redéployer le Worker exige `wrangler login` (déconnecté après le déploiement) :
      `npx --yes wrangler@4.158.0 login --device --scopes account:read user:read
      workers:write workers_scripts:write workers_tail:read`, code valable 5 minutes.
- [ ] Début de saison B5 : après 4 à 6 semaines d'archive AROME, comparer les modèles
      (rapport « Erreur absolue par spot, 12-36 h »).
- [ ] Neige : après 3 ou 4 épisodes, trancher l'alignement (B4.1) et regarder la
      fréquence des révisions du passé (`snowfall_sum`) et des oscillations.
- [ ] Fin de l'hiver 2026-27 : analyser `data/neige.csv` (alignement, dispersion entre
      stations, rapport cm/mm selon la température, annonces à J+9). Aucune correction
      de la neige avant au moins deux hivers (spec B4).
- [ ] Première vraie chute : vérifier que le chiffre de l'écran et celui de l'alerte
      sont identiques, et lire le log.

### Dette technique

- [ ] `trmnl-watch` : une vérification en échec reste verte, et aucune mémoire entre
      deux runs. `trmnl-watch` et `trmnl-watchdog` : actions en v4 (Node 20), push du
      watchdog sans nouvel essai.
- [ ] Vent et Météo sans watchdog : seulement les e-mails de santé TRMNL.
- [ ] Taille du dépôt : ~300 Mo/an estimés une fois compressés ; prévoir de compresser
      ou d'élaguer les vieux mois de `data/forecasts/`.

---

## Fait récemment

- [x] 2026-11-09 — Netatmo 396948 : *Reset Health* fait à la demande de Greg (« Plugin
      health reset successfully », la page affichait « Auto-refresh stopped »). La
      veille `trmnl-watchdog` peut envoyer une notification de transition.
- [x] 2026-11-09 — Veille TRMNL X (`trmnl-watch`) coupée à la demande de Greg
      (`disabled_manually`). Réactivable par `gh workflow enable`.
- [x] 2026-11-09 — Worker Cloudflare `meteo-alert-cron` déployé (3 crons). Jeton GitHub
      fine-grained `meteo-alert-cron` (Actions en écriture sur `meteo-alert` seul, sans
      expiration) et `NTFY_TOPIC_PANNE` posés par Greg. Wrangler déconnecté du PC.
- [x] 2026-11-08 — B4.2 : l'écran affiche le cumul et la plage de l'alerte, horizon
      5 jours (`W.neige`, variante B validée par Greg). Journal neige complété.
- [x] 2026-11-08 — Contrat TRMNL écrit (`docs/contrat-trmnl.md`), webhook conservé. Le
      markup ne décide plus rien sur le vent : saison, spot mesuré, état et fin de
      fenêtre viennent du payload. Heure de fin corrigée dans l'alerte ntfy, qui
      annonçait une heure de moins.
- [x] 2026-11-08 — Décisions du spec appliquées : `data/forecasts/` et `data/qa/` par
      mois, AROME archivé (B5.1), gradient journalisé et affiché (B6), annulation
      vent seulement si aucun spot ne tient (B7.1), `lead_min_h` 0 (B7.2), alerte
      neige avec hausse, prolongation, annulation (B4.3). QA indépendante et
      contre-vérification ; tests joués par les workflows, runs réels lus.
- [x] 2026-11-08 — `trmnl-markup`, `trmnl-watch` et `trmnl-watchdog` gérés dans cette
      session. Bug Netatmo « à 0 » non reproduit, secret `NTFY_TOPIC` déjà en place.
- [x] 2026-11-08 — Plugin TRMNL « Wind Forecast » (392131) désinstallé ; playlist
      et DASHBOARD intacts (spec B1).
- [x] 2026-11-07 — Revue QA indépendante + contre-vérification : 14 puis 6
      constats ; importants tous corrigés et testés (37 tests), mineurs au
      spec B7. Détail :
      (fenêtre en cours, prochaine fenêtre, horizon, anti-spam par jour,
      notifier() en échec, commit always, échecs MétéoSuisse visibles).
- [x] 2026-11-07 — Un échec rend enfin le run rouge : `pipefail` sur
      wind-alert (le `| tee` masquait tout), alerte neige fraîche rouge si la
      source est muette, pushes avec 3 essais puis rouge.
- [x] 2026-11-07 — Actions checkout et setup-node en v7 ; `wind-alert` sur
      6 créneaux fixes.
- [x] 2026-11-07 — Journal neige prévision/mesure (`snow-qa.mjs`).

- [x] 2026-11-07 — Affichage vent à 3 niveaux : `choisirReco()` côté
      producteur (`wind-select.mjs`), payload `reco` + `j` + `kn` corrigé,
      markup TRMNL lisant `W.reco` (commit `trmnl-sync` `b8e95bb`). Testé sur
      4 cas simulés (`test/reco.test.mjs`, joués par le workflow) et sur
      l'aperçu TRMNL saison forcée.
- [x] 2026-11-07 — Branche obsolète `payload-jour-fenetre` supprimée.
- [x] 2026-11-07 — Premier run planifié neige après correctif vérifié dans le
      log (« Prévisions journalières », 5 jours de données).

- [x] 07/11/2026 — Alerte neige annoncée réparée (modèle
      `meteoswiss_icon_seamless`, aveugle depuis le 15/10) ; tout refus d'API
      fait échouer le run.
- [x] 07/11/2026 — Plugins TRMNL Neige, Météo Carouge, Netatmo relancés ;
      e-mails de santé activés sur les 5 plugins actifs.
- [x] 07/11/2026 — Markup : neige ≥ 10 cm en inversé, badge NEIGE PÉRIMÉ.
- [x] 24/09/2026 — Alertes vent en 3 étages, correction de biais, annulation,
      mode TEST.
- [x] 19/09/2026 — Sélection du spot par proximité.
- [x] 03/09/2026 — Moteur multi-spots MétéoSuisse, QA, webhook TRMNL.

## Décisions prises

- `seuil_kn` = 11, `min_heures` = 3 (deux heures ne justifient pas le
  déplacement).
- Creux de Genthod = point de référence de Tropical Corner (Cologny), pas un
  spot.
- Seuils neige : 10 cm (alerte et inversion à l'écran), affichage dès 5 cm.

## Notes de terrain (29/08/2026)

- Le Ponton (Nyon) a cessé le wingfoil.
- Foil tracté et e-foil lourd : inutiles au-delà du tout début. Foil assist :
  motorisé, donc interdit en eaux suisses ; aucune location trouvée.
- Tropical Corner recommande AROME 1,3 km au Creux de Genthod, pour leur spot
  seulement, pas pour les thermiques.
