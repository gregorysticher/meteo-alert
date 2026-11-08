# TODO — Weather station (meteo-alert + TRMNL)

Dernière mise à jour : 2026-11-08
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
- [ ] **Valider le design spec** [`docs/spec-2026-11-07.md`](docs/spec-2026-11-07.md)
      (partie A à relire, décisions B3 à B7), éventuellement avec la
      session Cowork.
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
- [ ] 2026-11-14 : compter les runs `wind-alert` livrés par jour sur les 6
      créneaux fixes. En dessous de 4, revoir (spec B3).
- [ ] Selon la décision B5 : archiver AROME HD en second avis (QA seule).

### Dette technique

- [ ] Retard de 6 à 7 h des runs planifiés GitHub : l'alerte neige du matin
      arrive vers midi. Proposition : déclencheur externe (spec B3).
      Non prioritaire.

### Améliorations

- [ ] AROME 1,3 km en second avis vent : sonde faite (horizon ~48 h),
      plan en 3 étapes dans le spec B5, en attente de décision.
- [ ] Gradient air-eau : en réalité **pas calculé** (seule la température de
      l'eau est affichée). Usage à décider (spec B6).
- [ ] Neige : le journal prévision/mesure tourne (`data/neige.csv`).
      Trancher l'alignement après 3 ou 4 épisodes ; cumul d'épisode à
      l'écran et anti-spam du cumul à décider (spec B4).

---

## Fait récemment

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
