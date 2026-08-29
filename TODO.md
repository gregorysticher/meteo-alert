# TODO — alertes météo & wingfoil

Cette session (WINGFOIL/METEO-ALERT) porte **toutes** les alertes météo, vent et
neige comprises. La session TRMNL 3 ne gère que l'affichage.

Ce fichier ne liste que ce que **Greg** doit faire ou décider. Le code, les
workflows et les hand-offs sont pris en charge via le connecteur GitHub.

Dernière mise à jour : 2026-08-29

---

## À faire par Greg

- [ ] **Préciser à quel spot rattacher le Creux de Genthod.** C'est un point de
      référence météo de Tropical Corner, pas un lieu de navigation. Il faut
      savoir de quel spot ils parlent pour renseigner `spot_rattache` dans
      `wind/spots.json`.
- [ ] **Créer le plugin privé TRMNL** (stratégie webhook), le sauvegarder une
      fois pour que l'UUID existe, puis ajouter le secret `TRMNL_WEBHOOK_URL`
      dans les settings du repo. Les secrets ne sont ni lisibles ni créables
      par l'API.
- [ ] **Trancher la vue TRMNL** : `markup_full` est saturée (constat de la
      session TRMNL 3). Demi-vue, quadrant, ou second écran dans la playlist ?
- [ ] **Valider le format d'alerte** sur une vraie journée ventée. Les notifs
      arrivent sur ton téléphone : je ne vois ni le rendu ni le lien Maps.
- [ ] **Signaler fausses alertes et manques** — seule matière pour calibrer le
      ratio de rafales (1,8, choisi arbitrairement) et les secteurs.
- [ ] **Matériel** : essayer un mid-aspect ~1300 cm² et comparer 105 L / 120 L
      en location avant d'acheter. Me dire si tu prends le foil 1600 — je passe
      alors `seuil_kn` à 9,5.

## Hand-off TRMNL 3 — **pas encore**

- [ ] À transmettre **seulement quand la chaîne sera validée ici** (décision de
      Greg). Le document sera réécrit à ce moment-là : le contrat JSON change
      avec le passage au webhook, et `HANDOFF_TRMNL3_v2.md` décrit encore un
      accès par polling.

---

## Pris en charge par Claude

- [x] Config multi-spots, seuils 12 kn / 3 h, créneaux et saison conservés
- [x] `wind-sources.mjs` : MétéoSuisse (mesures + prévisions locales) + Alplakes
- [x] Le Ponton retiré, tracté et e-foil lourd documentés comme non pertinents
- [ ] Réécrire `wind-alert.mjs` : boucle multi-spots, `alerted.json` conservé,
      club + téléphone + lien Maps dans le message
- [ ] Sortie webhook TRMNL (< 2 kB : 3 spots détaillés + résumé pour les autres)
- [ ] Adapter `wind-alert.yml`, puis validation en `DRY_RUN`
- [ ] **Ajouter AROME 1.3 km en second avis** (`meteofrance_arome_france_hd` via
      Open-Meteo) et laisser la boucle QA arbitrer par spot entre AROME et
      MétéoSuisse, plutôt que de croire l'un ou l'autre sur parole
- [ ] Boucle QA : archive prévision → appariement mesure → biais par spot et
      par échéance, restitué dans la session chat
- [ ] Gradient air-eau intégré au score (aujourd'hui calculé mais non utilisé)
- [ ] Reprendre l'alerte neige sous la même architecture

---

## Notes de terrain (vérifiées par téléphone le 29/08/2026)

- **Le Ponton (Nyon)** a cessé le wingfoil et vend son matériel.
- **Le foil tracté et l'e-foil lourd** n'aident pas à apprendre le wingfoil,
  sauf au tout début — stade dépassé. Seul le **foil assist** reste pertinent.
- **Aucune location de foil assist** trouvée en Suisse romande ni en France
  voisine : les revendeurs vendent et réparent, ils ne louent pas.
- **Un foil assist est motorisé**, donc interdit dans les eaux suisses. Toute
  session se ferait côté français — ce qui annule l'avantage de proximité du
  Reposoir.
- **Tropical Corner** recommande AROME 1.3 km au Creux de Genthod, pour leur
  spot uniquement, et précise que ça ne vaut pas pour les thermiques.
