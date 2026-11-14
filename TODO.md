# TODO — Weather station (meteo-alert + TRMNL)

Dernière mise à jour : 2026-11-14
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
- [ ] **Écran resté sur la page détail sans appui** : le signaler avec l'heure s'il se
      reproduit. Le 14/11 à 5h50, un réveil « écran suivant » sans appui l'a mis sur la page
      détail, gardée par le maintien jusqu'à 10h05. Décision de Greg : rien ne change sauf
      récidive ; parade alors : page détail hors rotation, ouverte en Guest Mode (retour seul
      après 30 min). Vérif : TRMNL › appareil › Timeline, chercher un « Delivered » non voulu.
- [ ] **Second écran vide** : le signaler avec l'heure s'il revient (non
      reproduit le 2026-11-07). Spec B2.

---

## Backlog Claude

### Avant le 15/04/2027 — prioritaire

- [ ] Contrôler le premier vrai `W.reco` à l'écran à l'ouverture de la
      saison (2027-04-15) : jour, heures, inversion.
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

- [ ] `trmnl-watch` (coupé le 2026-11-09) : une vérification en échec reste verte, aucune
      mémoire entre deux runs, actions en v4. À traiter seulement si on le relance.
- [ ] Taille du dépôt, à remesurer le 2027-05-01 : 18 Mo compressés (git) et 29 Mo sur
      GitHub le 2026-11-13 ; `data/forecasts/` grossit d'environ 17 Mo bruts par mois
      depuis AROME. Compresser ou élaguer les vieux mois si le dépôt dépasse ~500 Mo.

---

## Fait récemment

- [x] 2026-11-13 — Second essai réseau (demande de Greg) : tout appel raté est réessayé
      une fois après 20 s (`reseau.mjs`), vert si le second passe. Open-Meteo sans réponse :
      second essai par le serveur européen 157.90.83.168 (le serveur US 51.81.167.44 était
      en panne, runners GitHub envoyés dessus 2 fois sur 3 ; revenu vers 20h). Le secours
      n'a pas encore servi en production : regarder « serveur de secours » dans les logs.
- [x] 2026-11-13 — CO₂ intérieur (DASHBOARD) : dès 900 ppm (`SEUIL_CO2_PPM`), libellé
      « CO₂ ppm - ÉLEVÉ » inversé, chiffre normal.
- [x] 2026-11-13 — Message « prolongé » trompeur corrigé (signalé par Greg) : le 12/11,
      « Neige annoncée 64 cm, dim 15 → lun 16 » ; le 13/11, « prolongé, 28 cm (2 j à la
      dernière alerte) » taisait la baisse. Le message dit maintenant « 28 cm cumulés
      (64 cm sur 2 j à la dernière alerte) ». La règle ne change pas : pas de message
      pour une baisse seule.
- [x] 2026-11-13 — Cadence vent vérifiée (spec B3) : 9 commits `data: wind` le 12/11
      (6 par le Worker, à l'heure ; 3 relances après un changement de l'écran neige),
      cron GitHub sauté 2 fois par la garde. Objectif de 4 par jour dépassé.
- [x] 2026-11-13 — Commentaire du markup de la page détail mis au nouveau nom (TRMNL,
      synchronisé `405027d`).
- [x] 2026-11-13 — « Vent et Météo sans watchdog » clos sans nouveau watchdog : Vent est
      couvert par les runs rouges de `meteo-alert`, l'alerte de panne du Worker et le
      badge VENT PÉRIMÉ ; Météo Carouge par les e-mails de santé TRMNL et le badge
      PRÉVISIONS PÉRIMÉ. Un watchdog de plus doublerait ces alertes.
- [x] 2026-11-13 — `trmnl-watchdog` réparé (`19f3371`) : le MCP TRMNL répond désormais en
      JSON, l'ancienne lecture (format Ruby) donnait « unknown ». Les deux formats sont
      lus ; un état illisible rend le run rouge. Run réel vert : « Netatmo Data 2 ·
      degraded · Netatmo 503 », données à 16 min, état poussé avec le nouveau réessai.
      Netatmo repasse « degraded » à chaque 503 passager : le vrai signal est la
      fraîcheur des données (alerte si plus de 2 h), que le watchdog surveille.
- [x] 2026-11-13 — `trmnl-watchdog` en actions v7 vérifié : 4 runs planifiés verts, plus
      d'avertissement Node 20. Run neige de 04:23 UTC rouge (Open-Meteo injoignable,
      « fetch failed ») ; relancé à 10:28 UTC : vert, alerte « prolongé » envoyée
      (28 cm, dim 15 → mar 17.11). Le contrôle prévu à 4 h le 12/11 n'a pas tourné.
- [x] 2026-11-11 — WindLive abandonné (décision de Greg : trop peu de chances d'accès).
      Navigation de la page détail précisée : ouvrir par milieu deux fois (données
      fraîches) ; la droite ne rejoue qu'une image gardée en mémoire.
- [x] 2026-11-11 — Plugin 471074 renommé « Détail vent et neige » (ex-Vent Wingfoil) à la
      demande de Greg. Playlist, Hold screen, Guest Mode et DASHBOARD vérifiés intacts.
- [x] 2026-11-10 — Page détail (plugin Vent Wingfoil 471074) synchronisée sur GitHub à la
      demande de Greg : `trmnl-markup/page-detail/src/`, premier commit `fd9d069`, contenu
      identique au markup enregistré (seules les fins de ligne diffèrent).
- [x] 2026-11-10 — Garde vérifiée en réel : le cron GitHub de 13:33 UTC (en retard) a été
      sauté, le Worker avait lancé le run à 13:17. Worker à l'heure toute la journée.
- [x] 2026-11-10 — Météo Carouge et Neige « degraded » (Open-Meteo 429 Too Many Requests,
      13:37 UTC) et Netatmo « degraded » (Netatmo 503, 09:48 UTC) : erreurs passagères,
      données fraîches ensuite. *Reset Health* sur les trois. Cause hors de notre portée
      (TRMNL interroge Open-Meteo depuis ses serveurs partagés).
- [x] 2026-11-09 — Premier déclenchement du Worker vérifié : `wind-alert` lancé à 21:17:26
      UTC pile (cron 21:17), run vert, TRMNL HTTP 200. `GARDE_CRON_VENT_H` passé à 4,5.
- [x] 2026-11-09 — Accès à la page détail testé par Greg sur le TRMNL X. Playlist : *Hold
      screen* actif sur le DASHBOARD, Vent Wingfoil visible juste après (les autres
      masqués). Milieu deux fois (*Next Screen*) ou droite → page détail ; gauche → retour
      au DASHBOARD, qui reste à l'écran et se met à jour. Guest Mode (Vent Wingfoil, 30 min)
      gardé en secours, 7 à 8 touches. Confirmé par Greg à 22h10 : un clic à droite pour
      afficher, un clic pour revenir, la page détail ne s'affiche jamais seule.
- [x] 2026-11-09 — Page détail pour le Guest Mode (plugin Vent Wingfoil 471074) : vent et
      profil horaire en saison vent, neige seule en saison neige (règle de Greg). Payload :
      `profil`, `tz`, `fin` par spot. Relue par un agent indépendant, constats corrigés.
      Markup enregistré sur TRMNL (empreinte 5ddc1996), pas encore versionné sur GitHub.
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
