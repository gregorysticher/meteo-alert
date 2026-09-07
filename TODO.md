# TODO — alertes météo & wingfoil

Cette session (WINGFOIL/METEO-ALERT) porte **toutes** les alertes météo, vent et
neige comprises. La session TRMNL 3 ne gère que l'affichage.

Ce fichier ne liste que ce que **Greg** doit faire ou décider. Le code, les
workflows et les hand-offs sont pris en charge via le connecteur GitHub.

Dernière mise à jour : 2026-09-07

---

## À faire par Greg

- [ ] **Coller l'URL webhook dans le secret `TRMNL_WEBHOOK_URL`** du repo
      `meteo-alert`. Le plugin TRMNL est créé (« Vent Wingfoil », webhook,
      `plugin_setting_id` 471074) ; son UUID est affiché dans ses réglages,
      champ « Plugin UUID ». L'URL à coller est
      `https://trmnl.com/api/custom_plugins/<UUID>`. Les secrets ne sont ni
      lisibles ni créables par l'API : cette étape reste manuelle.
- [ ] **Choisir la mise en page TRMNL** parmi les trois variantes rendues le
      07/09/2026 (captures dans le chat) :
      - **A2** — 4ᵉ colonne VENT, 6 spots, 7 jours conservés. Impose de
        descendre les grandes valeurs de `value--xxlarge` à `value--large` et
        d'arrondir l'extérieur à l'entier, sinon « 27.1° » est rogné.
      - **B** — bandeau vent 6 spots à la place des 7 jours. La plus lisible,
        grandes valeurs conservées ; **perd la tendance à 7 jours**.
      - **C** — 3 spots glissés dans la colonne PRÉVISIONS. Ne touche à rien
        d'autre, mais plafonne à 3 spots et charge la colonne.
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

## Décisions prises

- **Creux de Genthod = le spot de Tropical Corner**, donc Cologny.
  `spot_rattache: "cologny"` est confirmé, ce n'est plus une déduction.
- **`seuil_kn` = 11**, aligné sur les stats MétéoSuisse 6 saisons qui ont servi
  à classer les spots.
- **`min_heures` = 3**, et pas 2. Deux heures ne justifient pas le déplacement.
  Conséquence assumée : les stats de classement (PRE 52 j, MAH 47 j, GVE 42 j…)
  comptaient des créneaux de 2 h, le nombre réel d'alertes sera donc plus bas.
  Ne pas relire ce tableau comme une promesse de fréquence.

## Pris en charge par Claude

- [x] Config multi-spots, créneaux et saison conservés
- [x] `wind-sources.mjs` : MétéoSuisse (mesures + prévisions locales) + Alplakes
- [x] Le Ponton retiré, tracté et e-foil lourd documentés comme non pertinents
- [x] Plugin TRMNL « Vent Wingfoil » créé en stratégie Webhook (id 471074)
- [x] Badge phénomène : recalculé sur les **heures restantes** du jour au lieu
      de `daily.weather_code[0]`, qui est le pire code des 24 h et affichait
      encore ORAGE à 21 h pour un orage de 5 h du matin. Rang de gravité
      explicite (les codes ne sont pas ordonnés), repli sur le code journalier
      si `hourly.weather_code` manque ou après 23 h.
- [x] `hourly=weather_code` ajouté au polling du plugin « Météo Carouge », sans
      quoi le calcul ci-dessus n'a pas de données
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

## Points de vigilance côté TRMNL

- Le plugin **« Météo Carouge » était en état dégradé** (Open-Meteo a répondu
  503, 4 tentatives). Santé réinitialisée et rafraîchissement forcé le
  07/09/2026, données revenues. À resurveiller : si ça se répète, le badge
  PÉRIMÉ des prévisions est le témoin à regarder.
- Le plugin **« Wind Forecast » (392131) est en lecture seule** : c'est une
  recette installée, son URL de polling n'est pas modifiable. C'est pourquoi
  l'écran n'affiche qu'un seul spot aujourd'hui. Le webhook « Vent Wingfoil »
  le remplacera.
- « Vent Wingfoil » a été **ajouté à la playlist** à la création. Sans markup il
  ne s'affiche pas, donc sans effet visible ; à retirer de la playlist si la
  variante retenue le fait passer par la fusion du DASHBOARD.
