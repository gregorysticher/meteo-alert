# TODO — Weather station (meteo-alert + TRMNL)

Dernière mise à jour : 2026-11-07
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
- [ ] **WindLive** : leur `robots.txt` interdit `/api/`. Décider si on leur
      demande l'autorisation (balises lacustres du Petit-Lac, seule correction
      possible de l'angle mort Reposoir/Vengeron) ou si on abandonne.

---

## Backlog Claude

### Avant le 15/04/2027 — prioritaire

- [ ] Contrôler le premier vrai `W.reco` à l'écran à l'ouverture de la
      saison (2027-04-15) : jour, heures, inversion.
- [ ] Supprimer la branche obsolète `payload-jour-fenetre` (aucun commit
      propre ; suppression du 07/11 bloquée par le classifieur auto mode).

### Dette technique

- [ ] `wind-alert.yml` : remplacer `15 */2 * * *` par des heures fixes
      (convention ; ~3-4 runs livrés par jour sur 12 attendus).
- [ ] Passer `actions/checkout` et `actions/setup-node` en v5 (avertissement
      de dépréciation Node 20 sur tous les workflows).
- [ ] Retirer le plugin TRMNL « Wind Forecast » (392131), obsolète et en erreur.
- [ ] Runs planifiés GitHub livrés avec 6 à 7 h de retard (07/11 : cron
      4h23 UTC parti à 11h09) — l'alerte neige du matin arrive vers midi.
      Pistes : déclenchement externe (`workflow_dispatch` via API), autre
      ordonnanceur. Non prioritaire.
- [ ] Second écran vide : cause non identifiée côté serveur.

### Améliorations

- [ ] AROME 1,3 km (`meteofrance_arome_france_hd`) en second avis vent, la
      boucle QA arbitrant par spot.
- [ ] Gradient air-eau dans le score (calculé, pas utilisé).
- [ ] Neige : suivre l'écart prévision / mesure (07/11 : ~0 cm prévu, 8,6 cm
      mesurés) et l'écart cumul d'épisode (alerte) / chute du jour (écran).

---

## Fait récemment

- [x] 2026-11-07 — Affichage vent à 3 niveaux : `choisirReco()` côté
      producteur (`wind-select.mjs`), payload `reco` + `j` + `kn` corrigé,
      markup TRMNL lisant `W.reco` (commit `trmnl-sync` `b8e95bb`). Testé sur
      4 cas simulés (`test/reco.test.mjs`, joués par le workflow) et sur
      l'aperçu TRMNL saison forcée.
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
