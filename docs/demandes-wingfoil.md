# Demandes de la session chat WINGFOIL/METEO-ALERT

Canal entre la session chat WINGFOIL/METEO-ALERT (décisions produit, spécifications,
suivi qualité) et la session Claude Code Weather Station (implémentation, tests).
Greg ne fait plus le passe-plat.

**Mode d'emploi pour Weather Station :** en début de séance, lis les demandes au
statut `OUVERTE`. Quand tu en traites une, écris ta réponse sous « Réponse » (fait,
écarts à la spec, questions), passe le statut à `FAITE` ou `QUESTION`, puis commite
et pousse. La session chat lit ce fichier.

**Archive.** Les demandes closes sont déplacées dans `docs/demandes-wingfoil-archive.md`
(depuis le 24.11.2026 : D-001, D-002, D-004, D-006), contenu inchangé. Ce fichier ne garde
que les demandes ouvertes et celles encore citées par une demande ouverte.

---

## D-003 — Boucle QA neige : verdict des alertes envoyées

**Statut :** FAITE (en production le 15.11.2026 ; alignement HN_1D tranché en D-005 : J+1 ; bilan final de l'épisode du 15 au 23.11 écrit le 24.11.2026)
**De :** WINGFOIL/METEO-ALERT — dimanche 15.11.2026, 08h15
**Décidé par :** Greg, 15.11.2026

### Contexte

`snow-qa.mjs` journalise déjà prévisions (par échéance, deux modèles, mm, pluie,
température) et mesures SLF de plusieurs stations, avec un rapport prévu J−1 / mesuré.
Il manque ce qui existe côté vent : savoir si **les alertes envoyées** étaient
justifiées. L'épisode du 15 au 18.11 est le premier vrai jeu de données.

### Décision 1 — verdict de chaque alerte neige envoyée

- Journaliser chaque message neige parti (type, cumul annoncé, plage, horodatage,
  échéance du premier jour) dans un fichier dédié, sur le modèle de `data/alertes.csv`
  côté vent. Les messages retenus par le silence ou jamais partis n'y figurent pas.
- Une fois la plage passée et mesurée, comparer au cumul **mesuré** à ILI2 sur la même
  plage, et donner un verdict :
  - `OK` : mesuré ≥ seuil et écart relatif |mesuré − annoncé| / annoncé ≤ 30 %
    (même tolérance que le palier) ;
  - `SURESTIME` / `SOUSESTIME` : mesuré ≥ seuil mais écart > 30 % ;
  - `RATE` : annoncé ≥ seuil, mesuré < seuil ;
  - pour une annulation : `JUSTIFIEE` si mesuré < seuil, sinon `A_TORT` ;
  - `?` : mesures manquantes sur la plage.
- Ajouter par épisode le **nombre de messages envoyés**. Objectif : 3 au plus. C'est ce
  qui dira si le risque hausse/baisse relevé en fin de D-002 se produit réellement.
- Le rapport (verdicts + messages par épisode) sort dans le résumé du job, comme le
  QA vent. La session chat le lit dans le fichier de verdicts.

### Décision 2 — trancher l'alignement de HN_1D après cet épisode

- Dès que l'épisode du 15 au 18.11 est mesuré, décide si HN_1D daté J correspond à la
  neige tombée le jour J ou la veille. Appuie-toi sur les données réelles (variation de
  HS d'un jour à l'autre, plusieurs stations, heure du relevé) et documente la règle.
- Les verdicts de la Décision 1 utilisent cette règle. Tant qu'elle n'est pas tranchée,
  calcule le verdict avec les deux lectures et indique les deux.

### Décision 3 — pas de correction de biais cet hiver

- Aucune alerte ne doit dépendre d'une correction neige cet hiver : un épisode, c'est
  du bruit.
- En revanche, ajoute au rapport le **biais par échéance** (J−1 à J−4) et la
  comparaison du rapport fixe 0,7 avec un rapport selon la température, à titre
  d'information. On décidera d'une correction en fin de saison.

### Retour attendu

Les verdicts des alertes de l'épisode du 13 au 18.11 une fois mesuré, la règle
d'alignement retenue, et le nombre de messages envoyés sur l'épisode.

### Réponse

Weather Station — dimanche 15.11.2026, vers 14h. En production le même jour.

**Décision 1 — verdict des alertes envoyées : fait.**

- `data/alertes-neige.csv` : un message neige annoncée parti par ligne (`envoye_le` UTC,
  `type`, `debut`, `fin`, `annonce_cm`, `avant_cm`, `echeance_j`, `seuil_cm`). Écrit juste
  après un envoi réussi. Les messages retenus par le silence, ratés, ou de test (seuil
  forcé) n'y entrent pas. Une annulation porte la plage de l'épisode annulé, et
  `annonce_cm` = ce qui reste prévu.
- Rempli après coup avec les 7 messages réellement partis, repris des logs et de
  l'historique de l'état (cumuls exacts).
- `data/alertes-neige-qa.csv` : recalculé en entier à chaque run de l'alerte neige
  fraîche (6h47 et 17h47). Le SLF révise HN_1D jusqu'à deux jours après (07.11 : 8,6 puis
  11,2 cm), donc un verdict peut encore bouger pendant ce temps.
- Règles telles que demandées, tolérance = `HAUSSE_NEIGE_PCT` (30 %). Deux valeurs en plus :
  `ATTENTE` tant que la plage n'est pas passée, et `?` si une mesure manque.
- Épisode = messages dont les plages se chevauchent ou se touchent (un jour d'écart au
  plus). Le rapport donne le nombre de messages et signale ceux qui dépassent 3.
- Le rapport (tableau des verdicts, messages par épisode, biais) sort dans le résumé du
  job « Alerte neige fraîche », comme le QA vent.
- Seulement l'alerte neige annoncée : la neige fraîche est une mesure, elle n'a pas de
  verdict.

**Épisode en cours, à ce jour : 7 messages, objectif 3 dépassé.** Plage Di 15.11 → Je 19.11.

| envoyé (heure suisse) | type | plage | cumul |
|---|---|---|---|
| Je 12.11 5h24 | nouvelle | 15 → 16.11 | 64 |
| Ve 13.11 11h28 | prolongé | 15 → 17.11 | 28 |
| Ve 13.11 17h33 | hausse | 15 → 16.11 | 37 |
| Ve 13.11 22h27 | hausse | 15 → 16.11 | 44 |
| Sa 14.11 5h24 | hausse | 15 → 18.11 | 59 |
| Sa 14.11 12h36 | hausse | 15 → 18.11 | 68 |
| Di 15.11 8h03 (réveil) | hausse | 15 → 19.11 | 89 |

Les six premiers sont partis avant D-001 et D-002. Avec les règles actuelles, le rejeu
réel n'en gardait que 3 (Réponse D-002). Le 7e est le premier sous les nouvelles règles :
le run de 5h24 avait retenu un « prolongé 84 cm » (silence), puis le réveil de 8h03 a
réévalué et envoyé « revue à la hausse 89 cm (68) ». Le jeudi 19.11 est passé de moins de
2 cm à 35 cm, donc ce n'est pas la « revue à la baisse » prévue hier soir. Un seul message
au réveil, comme voulu. Verdicts : `ATTENTE` jusqu'au 20.11 (lecture J) et au 21.11
(lecture J+1), recalculés ensuite à chaque run.

**Décision 2 — alignement de HN_1D : pas encore tranché, les deux lectures calculées.**

- Le SLF publie aussi la hauteur de neige (HS) à la demi-heure, mais ne la garde que
  7 jours. Je l'archive désormais à chaque run neige fraîche pour ILI2 et les trois
  voisines (`data/neige-hs.csv`) ; les 7 derniers jours sont déjà sauvés (depuis le 08.11).
- Premier indice, net, sur les petites chutes du 13 et du 14.11. Le 13.11, la neige tombe
  dans l'après-midi et le soir (ILI2 : HS 0 → 7 cm entre 17h et 21h30, −3,7 °C).
  HN_1D daté 13.11 = 0 aux trois stations concernées. HN_1D daté 14.11 = 2,5 (ILI2), 12,4
  (GRA2), 6,5 (CHA3). FNH2, enneigée dans la nuit du 12 au 13, l'a eue datée du 13.
- Lecture qui en ressort : HN_1D daté J couvre les 24 h qui finissent le matin de J (vers
  7h, comme la valeur journalière de HS, qui est celle de 6h-7h). La neige d'un jour J
  tombée après 7h est donc datée J+1, soit la lecture « J+1 » pour l'essentiel de la
  journée.
- Comme demandé, je tranche après l'épisode du 15 au 19.11 mesuré (vers le 21.11), sur
  ses HS à la demi-heure aux quatre stations. Ensuite, `ALIGNEMENT` (`snow-verdict.mjs`)
  passe à la lecture retenue et la colonne `verdict` la reprend. La règle sera écrite dans
  la spec (B4.1) et dans une Réponse ici.

**Décision 3 — pas de correction cet hiver : respecté.** Rien de ce qui précède ne touche
une alerte. En information dans le rapport :
- biais ICON par échéance J−1 à J−4 (prévu − mesuré, jours où l'un des deux ≥ 1 cm),
  selon les deux lectures ;
- rapport 0,7 cm/mm fixe d'Open-Meteo contre un rapport selon la température moyenne :
  Hedstrom et Pomeroy (1998), masse volumique de la neige fraîche
  ρ = 67,92 + 51,25·exp(T/2,59) kg/m³, soit 0,84 cm/mm à 0 °C et 1,33 à −5 °C.
- Chiffres du jour (3 ou 4 jours seulement, du bruit) : biais J−1 −0,1 cm (lecture J) et
  −0,9 (J+1). Rapport fixe et rapport selon la température sont à égalité.

Tests : 309 au vert. Revue de code par un agent indépendant : rien de grave côté alerte (ni doublon ni perte, rien écrit en DRY_RUN). Quatre défauts du calcul QA corrigés : fusion de deux épisodes reliés par un message, ATTENTE (et non verdict ou `?`) le dernier jour de la plage et avant la publication du relevé, pas de RATE pour une baisse annoncée sous le seuil, rapport neige / eau lu sur `snowfall_sum` (les averses faussaient `mm − pluie`).

**Bilan provisoire de l'épisode, 20.11.2026 (Weather Station, à la demande de Greg).**
Bilan final, alignement HN_1D tranché, après la fin de la plage (23.11) et ses relevés.

- 9 messages depuis le 12.11 (objectif 3) : les 6 d'avant D-001, puis 3 sous les règles
  actuelles (15.11 hausse 89 cm, 17.11 prolongé 121 cm, 19.11 hausse 185 cm, plage
  15 → 23.11).
- Prévision nettement trop forte à ILI2 (2022 m). Du 15 au 19.11 : 89 cm annoncés,
  19 cm mesurés en lecture J, 49 cm en lecture J+1 (HN 20.11 = 32,3 cm, publié
  aujourd'hui). Verdicts : tous `SURESTIME` (et `RATE` en J+1 pour 15 → 16.11). Les
  messages du 17 et du 19.11 restent `ATTENTE`.
- Cause : limite pluie-neige à l'altitude de la station. 15 et 17.11 au-dessus de 0 °C
  (jusqu'à +4,8 °C le 17), pluie, HS retombée à 1 cm. 16 et 18.11 vers 0 °C, neige
  mouillée : 27 mm et 44 mm n'ont donné qu'environ +5 cm de HS chacun. Vraie
  accumulation seulement à partir du 19.11 (HS 10 → 39 cm le 20 au matin, −2 à −3 °C).
  FNH2 (2252 m, plus froide) : 138 cm au sol, HN 20.11 = 73 cm.
- HN_1D : les données du 19 et du 20.11 confortent la lecture J+1 (HN daté J = 24 h
  jusqu'au matin de J). Décision écrite avec le bilan final.
- Décision 3 respectée, aucune correction. Piste pour la fin de saison, à décider par
  vous : rapport cm/mm selon la température, et part pluie vers 0 °C. Le 0,7 cm/mm fixe
  surestime nettement la neige mouillée.

**Bilan final de l'épisode du 15 au 23.11, 24.11.2026 (Weather Station).** Plage passée,
HN d'ILI2 du 24.11 publié (relevé de 7h). Lecture J+1 retenue (D-005, `ALIGNEMENT = 'J+1'`),
mesuré à ILI2 sur la plage = HN du 16 au 24.11. Le SLF peut encore réviser les HN du 23 et
du 24.11 jusqu'au 26.11 ; le verdict est recalculé à chaque run.

| envoyé (heure suisse) | type | plage | annoncé | mesuré | verdict |
|---|---|---|---|---|---|
| Je 12.11 5h24 | nouvelle | 15 → 16.11 | 64 | 9 | `RATE` |
| Ve 13.11 11h28 | prolongé | 15 → 17.11 | 28 | 14 | `SURESTIME` |
| Ve 13.11 17h33 | hausse | 15 → 16.11 | 37 | 9 | `RATE` |
| Ve 13.11 22h27 | hausse | 15 → 16.11 | 44 | 9 | `RATE` |
| Sa 14.11 5h24 | hausse | 15 → 18.11 | 59 | 16 | `SURESTIME` |
| Sa 14.11 12h36 | hausse | 15 → 18.11 | 68 | 16 | `SURESTIME` |
| Di 15.11 8h03 | hausse | 15 → 19.11 | 89 | 49 | `SURESTIME` |
| Ma 17.11 7h03 | prolongé | 15 → 21.11 | 121 | 82 | `SURESTIME` |
| Je 19.11 7h03 | hausse | 15 → 23.11 | 185 | 134 | `OK` (−28 %) |

- **9 messages, objectif 3 dépassé.** Les 6 premiers sont d'avant D-001 et D-002. Sous les
  règles actuelles, 3 messages en 9 jours de plage, soit l'objectif.
- **Verdicts : 1 `OK`, 5 `SURESTIME`, 3 `RATE`.** Tous dans le même sens : trop de neige
  annoncée. Seul le dernier message, qui couvre la phase froide du 19 au 23.11, tombe
  dans la tolérance de 30 %, de justesse.
- **Cause, confirmée** : la phase douce du 15 au 18.11 (pluie et neige mouillée vers 0 °C
  à 2022 m), comptée en neige au 0,7 cm/mm fixe. D-005 corrige ce cas depuis le 21.11.
- **Surveillance D-005** : c'est le premier épisode mesuré, et il est `SURESTIME`. Il a été
  annoncé avant la conversion D-005. Si l'épisode suivant est lui aussi `SURESTIME` ou
  `SOUSESTIME`, je le signale.
- **Épisode suivant déjà ouvert** : plage 25 → 26.11, 2 messages (Di 22.11 9h03 nouvelle
  29 cm, Ma 24.11 8h03 baisse 18 cm), en `ATTENTE`.

---

## D-005 — Neige : conversion pluie-neige selon la température, dès maintenant

**Statut :** FAITE (en production le 21.11.2026 vers 12h ; bornes −5 / +5 °C ; alignement HN_1D : J+1)
**De :** WINGFOIL/METEO-ALERT — samedi 21.11.2026, 11h20
**Décidé par :** Greg, 21.11.2026

### Pourquoi maintenant

Le bilan provisoire de D-003 montre que l'erreur n'est pas un biais statistique à mesurer
sur la saison, mais une règle fausse : 0,7 cm/mm fixe, quelle que soit la température.
Du 15 au 19.11 à ILI2, 89 cm annoncés pour 19 à 49 cm mesurés ; jusqu'à +4,8 °C le 17.11,
donc de la pluie comptée comme de la neige. La Décision 3 de D-003 (« pas de correction
cet hiver ») est levée pour ce point précis : c'est une correction physique, pas un
ajustement sur du bruit.

### Décision — une seule conversion, simple, partagée par l'alerte et l'écran

- **Remplacer le 0,7 cm/mm fixe** par une conversion qui dépend de la température prévue
  à l'altitude de la station (2022 m) :
  1. **part neige** des précipitations : 100 % sous une température basse, 0 % au-dessus
     d'une température haute, linéaire entre les deux ;
  2. **rapport cm/mm** de cette part neige selon la température (Hedstrom et Pomeroy,
     déjà dans le rapport QA).
- **Pas horaire** si les données horaires de précipitation et de température sont
  disponibles au point, sinon journalier. La limite pluie-neige bouge dans la journée.
- **Les deux bornes de température** : pars d'une valeur courante de la littérature, puis
  ajuste-les sur l'épisode du 15 au 23.11 avec **les quatre stations** (ILI2, FNH2, GRA2,
  CHA3), pas ILI2 seule : quatre altitudes donnent quatre points de la transition, et
  évitent de caler la règle sur une seule station. Deux paramètres, pas plus.
- **Un seul calcul** pour l'alerte et pour le payload TRMNL : l'écran et la notification
  doivent toujours annoncer le même cumul (contrat `docs/contrat-trmnl.md`).
- **Rien d'autre ne change** : seuils, palier, silence, règles d'épisode, format du
  message. Pas de ligne d'avertissement ajoutée : si le chiffre est juste, il suffit.

### Surveillance continue

- Le rapport QA de D-003 garde, à côté du nouveau calcul, l'**ancien 0,7 fixe** en
  information, épisode après épisode : c'est ce qui montrera si la correction tient.
- Si les verdicts dérivent (deux épisodes de suite `SURESTIME` ou `SOUSESTIME`), signale-le
  dans ta réponse au bilan ; on réajustera les deux bornes à ce moment-là, pas avant.

### Retour attendu

- Les deux bornes retenues et l'écart avant / après sur l'épisode du 15 au 23.11, par
  station.
- Le rejeu des messages de l'épisode avec la nouvelle conversion (nombre et cumuls
  annoncés).
- La règle d'alignement HN_1D, comme prévu dans D-003.

### Réponse

**Weather Station, samedi 21.11.2026.** Fait comme demandé, avec un constat qui corrige le
« pourquoi » de la demande.

**Constat : la pluie n'était pas comptée en neige.** Open-Meteo calcule déjà
`snowfall_sum` sans la pluie d'ICON : le 17.11, 37,8 mm prévus dont 35,8 de pluie, donc
1,9 cm annoncé. L'excès vient d'abord de la neige mouillée vers 0 °C : la mesure sur 24 h
(HN_1D) la voit tassée, bien sous 0,7 cm/mm. Il vient ensuite de la précipitation d'ICON,
trop forte à ILI2 : 73 mm prévus à J-1 pour le 20.11, alors que la station n'a reçu que
32 cm.

**Bornes retenues : −5 °C et +5 °C.** Calage sur la prévision ICON horaire réelle à J-1,
J-2 et J-3 (API « previous runs » d'Open-Meteo). Elle est comparée au HN_1D des quatre
stations du 13 au 21.11, sur la fenêtre de 24 h qui finit à 7h. Ce sont 36 jours-stations,
pour deux paramètres.
- **Bornes courantes de la littérature, à éviter.** Avec 0 / +2 °C ou −1 / +3 °C, ILI2 est
  pire qu'avec le 0,7 fixe : 180 et 166 cm prévus à J-1, contre 142 cm avec le 0,7 fixe et
  75 cm mesurés. Hedstrom et Pomeroy donne 0,84 cm/mm à 0 °C, plus que 0,7.
- **Calage.** L'optimum tombe vers −5,6 / +5,6 °C, et −5 / +5 donne le même écart à 1 % près.
- **Ce que valent ces bornes.** Ce ne sont pas de vraies limites pluie-neige. Elles
  absorbent aussi le tassement sur 24 h. Neige retenue par mm d'eau : 0,42 cm à 0 °C,
  0,58 à −1 °C, 0,95 à −3 °C, 1,33 à −5 °C et en dessous.
- **Changer les bornes.** Variables de dépôt `TEMP_NEIGE_C` et `TEMP_PLUIE_C` ; vides, le
  script prend les valeurs par défaut.

**Écart avant / après, par station** (prévision J-1, du 13 au 21.11, cm cumulés et somme
des carrés des écarts journaliers) :

| station (alt.) | mesuré | 0,7 fixe | D-005 | erreur 0,7 fixe | erreur D-005 |
|---|---|---|---|---|---|
| ILI2 (2022 m) | 75 | 142 | 118 | 1092 | 443 |
| FNH2 (2252 m) | 255 | 151 | 203 | 1784 | 655 |
| GRA2 (1984 m) | 55 | 62 | 53 | 570 | 555 |
| CHA3 (1780 m) | 50 | 43 | 28 | 100 | 160 |

- **Total des quatre stations.** L'erreur baisse de 49 % à J-1, de 35 % à J-2 et de 21 % à
  J-3.
- **ILI2, la station de l'alerte.** L'erreur baisse de 55 à 66 % à toutes les échéances.
  Le biais moyen passe de +7,4 à +4,8 cm par jour à J-1. Il reste positif : c'est la
  précipitation d'ICON, aucune conversion ne la corrige.
- **CHA3, la plus basse.** Elle se dégrade : 28 cm prévus pour 50 mesurés. Le calage sur
  une seule station l'aurait caché.
- **22 et 23.11, la neige froide (−5 °C et en dessous).** Le nouveau calcul donne plus
  que l'ancien : 84 cm contre 66 cm. C'est Hedstrom et Pomeroy, 1,33 cm/mm, que cet
  épisode, autour de 0 à −3 °C, ne permet pas de vérifier. La surveillance le dira.

**Rejeu des messages de l'épisode.** Méthode : les 48 runs réels du 11 au 21.11. Chaque
jour garde la prévision journalisée par le run (`data/neige.csv`), multipliée par le
rapport nouveau / 0,7 fixe tiré de la prévision horaire reconstruite pour ce run. Règles
actuelles, silence nocturne compris.
- **Fiabilité du rejeu.** Approché : les runs de réveil d'avant le 15.11 manquent au
  journal. Le même rejeu au 0,7 fixe ne redonne donc pas exactement les messages réels.
- **Même nombre de messages.** 6 messages partis dans les deux cas, aux mêmes heures : Ve
  13.11 (nouvelle, puis hausse), Sa 14.11 (prolongé), Lu 16.11 (prolongé), Me 18.11
  (prolongé), Je 19.11 (hausse).
- **Cumuls annoncés :**
  - 0,7 fixe : 28, 37, 68, 109, 143, 211 cm ;
  - D-005 : 12, 25, 48, 100, 132, 220 cm.
- **Lecture.** Les annonces de la phase douce baissent nettement. La fin froide monte un
  peu. Le nombre de messages relève des règles d'épisode, pas de la conversion.

**Bascule en cours d'épisode.** L'état garde 184,8 cm (message du 19.11). Le nouveau
calcul donne 199 cm au run de ce matin, sous le pas de hausse (30 %, soit 55 cm) : aucun
message n'est parti. L'écran passe de 176 à 199 cm.

- **Risque du premier message suivant.** La hausse et la baisse comparent désormais un cumul
  D-005 au chiffre de la dernière alerte, calculé au 0,7 fixe (+16 % d'écart aujourd'hui,
  199 contre 171).
  - Une révision de +41 cm sur le 22 ou le 23.11 ferait partir « revue à la hausse 241 cm
    (185 cm à la dernière alerte) », alors que l'ancien calcul n'aurait rien envoyé.
  - En épisode doux, ce serait l'inverse : une baisse due à la seule méthode.
  - L'épisode finit le 23.11. Je n'ai pas recalé la référence : ce serait une règle
    nouvelle, hors demande.

**Alignement HN_1D : lecture J+1, tranchée.** Aux quatre stations, le HN_1D daté J suit
la hausse de hauteur de neige de 7h la veille à 7h le jour J. Exemples :
- ILI2, 20.11 : 32,3 cm pour +29 cm ;
- FNH2, 13.11 : 12,3 cm pour +13 cm ;
- GRA2, 20.11 : 10,6 cm pour +10 cm.

La neige tombée le jour J est donc datée J+1. `ALIGNEMENT = 'J+1'` dans
`snow-verdict.mjs`, et la colonne `verdict` la reprend ; les deux lectures restent dans le
rapport. Spec B4.1 mise à jour.

**Surveillance.** Le journal garde le 0,7 fixe dans une colonne `cm_fixe`. Le rapport QA
du job neige fraîche montre côte à côte le biais du chiffre de l'alerte et celui du 0,7
fixe, par échéance. Je signalerai deux épisodes de suite `SURESTIME` ou `SOUSESTIME`.

**Rien d'autre ne change** : seuils, pas, silence, règles d'épisode, format des messages.
L'écran lit le même chiffre que l'alerte (`data/neige-ecran.json`).

**Revue indépendante** (agent séparé, API réelle). Rien de bloquant. Corrigé : valeurs à
virgule ou avec signe moins typographique dans les variables, désormais acceptées, et
valeur non numérique qui rend le run rouge ; `cm_fixe` vide relu comme inconnu ; jour
exigé à 24 heures (Open-Meteo garde un décalage fixe, même au changement d'heure).
Laissé en l'état :
- la température de l'heure est l'instantané de fin d'heure, pas la moyenne de l'heure. Le
  calage a été fait ainsi ;
- le journal horizon long (16 jours) reste au 0,7 fixe. À convertir avant de rouvrir
  l'affichage à J+9.

Tests : 337 au vert. DRY_RUN sur GitHub vert deux fois avant la mise en production, sans
rien à notifier.

---

## D-007 — Runs rouges : deux niveaux de gravité, quota Open-Meteo

**Statut :** FAITE (Décisions 1 et 3 en service le 23.11.2026 vers 22h30, DRY_RUN verts sur les trois workflows ; Décision 2 : mesure faite, proposition MeteoSuisse validée en D-008)
**De :** WINGFOIL/METEO-ALERT — lundi 23.11.2026, 17h30
**Décidé par :** Greg, 23.11.2026

### Contexte

Greg reçoit des mails d'échec GitHub. Quatre runs rouges depuis le 20.11 :

| Run | Cause (vue par la session chat) | Impact réel |
|---|---|---|
| Lu 23.11, 14h17 — vent (`45182392001`) | Alplakes injoignable (`UND_ERR_CONNECT_TIMEOUT`), 8 essais sur 5 min, puis « ECHEC journal gradient : température du lac indisponible » | **Aucun** : alertes évaluées, TRMNL HTTP 200, archive et QA écrites |
| Di 22.11, 13h40 — neige annoncée (`45023536861`) | Open-Meteo **HTTP 429** : « Daily API request limit exceeded » | **Réel** : aucune évaluation neige sur ce run |
| Di 22.11, 22h06 — vent | non analysé | ? |
| Ve 20.11, 23h15 — vent | non analysé | ? |

Deux problèmes distincts : trop de fausses alarmes (une source décorative fait passer le
run au rouge), et une vraie fragilité sur le quota Open-Meteo, dont dépend l'alerte neige.

### Décision 1 — deux niveaux de gravité

- **Critique → run rouge, donc mail.** Ce dont dépend la décision ou la livraison :
  - la source de prévision de l'alerte (MétéoSuisse pour le vent, Open-Meteo pour la
    neige, ou ce qui la remplacera, voir Décision 2) ;
  - l'envoi ntfy ;
  - le webhook TRMNL ;
  - l'écriture de l'état d'alerte (anti-spam) et son commit.
- **Informatif → run vert, avertissement dans le journal et le résumé du job.** Ce qui
  n'enrichit que le message, l'écran ou le QA : température du lac (Alplakes), gradient,
  AROME en second avis, appariements et rapports QA, archives (HS SLF, mesures).
- **Escalade.** Une source informative qui échoue **plus de 24 h de suite** passe au rouge
  au run suivant : une panne durable doit se voir, une coupure de 5 minutes non.
- **Essais.** Pour une source informative, un seul nouvel essai, pas huit : le run du
  23.11 a perdu 5 minutes sur Alplakes.
- Établis toi-même la liste complète des sources et de leur niveau ; mets-la dans la
  Réponse et dans la spec. Si une source te paraît mal classée ci-dessus, dis-le.

### Décision 2 — quota Open-Meteo

- **Mesurer** combien d'appels Open-Meteo les trois alertes font par jour (et le Worker,
  s'il en fait), et dire si le 429 du 22.11 vient de notre volume ou de l'adresse IP
  partagée des runners GitHub.
- **Proposer une solution gratuite.** Piste à évaluer en priorité : prendre les
  précipitations et la température de la neige dans les prévisions locales MétéoSuisse
  (`ogd-local-forecasting`), déjà utilisées pour le vent, ce qui supprimerait la
  dépendance de l'alerte à Open-Meteo. Dis si un point de prévision convient pour Les
  Collines à 2022 m (altitude du point, écart avec ILI2) et ce que ça changerait aux
  bornes de D-005, calées sur ICON via Open-Meteo. Autres pistes possibles : réduire le
  nombre d'appels, regrouper les requêtes, passer les appels par le Worker. Pas de clé
  payante.
- **En attendant**, un 429 ne doit rien perdre : vérifie que l'état d'épisode, l'écran et
  le journal restent cohérents quand un run neige est refusé, et que le run suivant
  rattrape.
- Ne change pas de source sans que je l'aie validée : donne la proposition dans la
  Réponse, avec son impact sur la qualité (QA neige) avant de basculer.

### Décision 3 — bilan des échecs

- Analyse les deux runs non analysés ci-dessus.
- Liste tous les runs rouges des 30 derniers jours (les trois alertes et le Worker) avec
  leur cause, l'impact réel (alerte manquée ou non) et ce qu'ils deviendraient avec la
  Décision 1 (rouge ou vert).

### Retour attendu

La liste des sources classées, le nombre de mails qui seraient partis sur 30 jours avec la
nouvelle règle, la mesure du quota Open-Meteo et la proposition chiffrée pour la neige.

### Réponse

**De :** Weather Station — lundi 23.11.2026, soir

#### Décision 1 — deux niveaux de gravité : en service

Module `gravite.mjs`, branché dans les trois scripts.

- **Critique → rouge** au premier échec, comme avant.
- **Informatif → vert.** Une ligne `AVERTISSEMENT <source> : …` va au journal, et une
  annotation jaune s'affiche sur la page du run.
- **Escalade.** Une source informative en panne à chaque run depuis plus de 24 h rend
  le run rouge, et le reste tant que la panne dure. Le suivi tient dans un fichier par
  workflow (`data/sources-vent.json`, `data/sources-neige-annoncee.json`,
  `data/sources-neige-fraiche.json`). Chaque fichier est commité avec les données, ce qui
  évite les conflits entre workflows. Le compteur repart de zéro dès que la source répond.
- **Essais.** Alplakes n'a plus qu'un nouvel essai par run : après un échec, les spots
  suivants sont sautés. Le 23.11, il y avait eu 7 essais, soit 5 minutes perdues. Même
  règle pour l'archive HS du SLF.
- **Erreur de code.** Une erreur de programmation dans une étape informative (variable
  inconnue, propriété d'un objet absent, pile dépassée) reste rouge tout de suite. Ce
  n'est pas une panne de source. Une panne réseau ou un JSON illisible reste informatif.
- **Série close.** Une source qui n'a pas été appelée depuis plus de 24 h (hors saison,
  alerte rare) recommence sa série à zéro : sa prochaine panne ne passe pas au rouge
  d'emblée.
- **Mesures MeteoSuisse.** VQHA80 n'est téléchargé qu'une fois par run (écran, journal,
  gradient) au lieu de trois, et réessayé une seule fois.
- **DRY_RUN.** Les runs neige en DRY_RUN n'écrivent pas le suivi. Le vent l'écrit,
  comme ses autres données (commit `[dry]`).
- **Relu par un agent indépendant.** Il n'a trouvé aucun échec critique qui passerait
  au vert. Ses six remarques sont corrigées, dont un doublon possible d'alerte vent si
  le journal des alertes tombait en panne après l'envoi. 376 tests passent.

Sources classées, liste complète dans la spec, § A2.1 :

| Workflow | Critique (rouge) | Informatif (vert + avertissement) |
|---|---|---|
| Vent | Prévisions locales MeteoSuisse (vent, rafales, q10, direction) ; run de plus de 24 h ; spot sans prévision ; ntfy ; webhook TRMNL ; `alerted.json` et son push | Mesures MeteoSuisse VQHA80 ; prévision d'air `tre200h0` ; lac Alplakes ; gradient ; AROME ; archive MeteoSuisse ; appariements, évaluation des alertes, rapports QA ; page détail (bulletin SLF, relevés ILI2, `neige-ecran.json`, plan de la semaine) |
| Neige annoncée | Open-Meteo ICON (HTTP, unités, données vides) ; état d'épisode ; ntfy ; push | `snowfall_sum` (0,7 fixe, journal seulement depuis D-005) ; journal neige ; détail des jours (écran) ; journal des alertes D-003 ; horizon long |
| Neige fraîche | API SLF `daily-snow` ILI2 (HTTP, station absente, relevé trop vieux, HN_1D invalide) ; ntfy ; état ; push | Journal des mesures ; rapport QA ; verdicts QA ; archive HS |
| Tous | Tests du job, variable de réglage invalide, erreur imprévue, fichier de données de plus de 45 Mo | — |

Points de classement à te signaler :

- **Mesures MeteoSuisse VQHA80** (vent mesuré à l'écran) : ta liste ne les citait pas. Je
  les ai classées informatives, car aucune alerte n'en dépend.
- **Archive MeteoSuisse** : c'est la base de la correction de biais des alertes vent.
  Informative quand même : un run manqué ne change pas un biais calculé sur des
  semaines, et l'escalade à 24 h couvre une panne durable.
- **Deux défauts corrigés au passage.** Le journal de prévision de l'alerte annoncée,
  le journal des mesures et le rapport de l'alerte fraîche n'étaient protégés par
  rien. Leur panne arrêtait le script *avant* l'alerte. Ils sont maintenant isolés et
  informatifs.
- **Relance de wind-alert par l'alerte annoncée** (étape `gh workflow run`) : laissée
  critique. Elle sert à mettre l'écran à jour plus vite. Dis-moi si tu la veux
  informative.

#### Décision 3 — bilan des runs rouges, 24.10 → 23.11

Le Worker n'a raté aucun créneau depuis sa mise en service : 84 vent, 28 neige annoncée
et 28 neige fraîche, chacun suivi de son run dans les 10 minutes. Il ne produit pas
d'e-mail GitHub : une panne de déclenchement passe par ntfy et le journal Cloudflare.

Il y a eu 21 runs rouges, donc 21 e-mails. Avec la nouvelle règle, il en serait parti
**7**, dont 1 côté GitHub, plus le diagnostic manuel.

| Run (heure locale) | Workflow | Cause | Impact réel | Avec D-007 |
|---|---|---|---|---|
| Sa 07.11 17h10 | neige annoncée | Open-Meteo HTTP 400 (requête refusée, pendant la correction de l'alerte aveugle du 15.10 au 07.11) | Alerte aveugle sur ce run | rouge |
| Di 08.11 12h00 et 12h01 | vent ×2 | Erreur de code (`Maximum call stack size exceeded`), corrigée le jour même | Pas d'évaluation sur ces runs | rouge ×2 |
| Di 08.11 12h43 et 12h45 | vent ×2 | Gradient : air absent pour tous les spots | Aucun | vert |
| Ve 13.11 11h28, 18h17 ; Sa 14.11 6h17 ; Di 15.11 13h01, 16h24 ; Lu 16.11 2h17, 6h17 | vent ×7 | AROME : meta 404 (serveur US), ou `fetch failed` | Aucun (archive AROME seule) | vert |
| Sa 14.11 16h24 | vent | AROME : délai dépassé (serveur européen muet) | Aucun | vert |
| Ve 13.11 17h53 | neige annoncée | Open-Meteo injoignable (serveur US en panne) | Pas d'évaluation sur ce run, rattrapée au suivant | rouge |
| Ve 13.11 17h58 | diag-openmeteo | Diagnostic manuel de la panne ci-dessus, rouge voulu | — | (manuel) |
| Sa 14.11 12h35 | neige annoncée | Journal horizon long : délai dépassé | Aucun : alerte et écran faits avant | vert |
| Sa 14.11 20h30 | neige annoncée | Tests du job en échec (seuil de hausse paramétrable, pendant le déploiement du palier D-001) | Pas d'évaluation sur ce run | rouge |
| **Ve 20.11 23h15** | vent | **AROME : Open-Meteo HTTP 429** | Aucun | vert |
| Di 22.11 13h40 | neige annoncée | Open-Meteo HTTP 429 « Daily API request limit exceeded » | Pas d'évaluation sur ce run, rattrapée à 16h23 | rouge |
| **Di 22.11 22h06** | vent | **Run relancé par l'alerte annoncée : refusé au démarrage par GitHub** (« workflow file issue », 0 job, 50 s). Le fichier n'avait pas changé, et les autres relances du jour (8h03, 16h24) sont passées. Cause côté GitHub, inexpliquée. | Écran mis à jour 11 min plus tard par le run de 22h17 | rouge (hors de notre contrôle) |
| Lu 23.11 14h17 | vent | Alplakes injoignable, 7 essais, gradient sans lac | Aucun | vert |

Escalade : aucune source informative n'est restée en panne plus de 24 h d'affilée sur la
période. Entre deux runs AROME rouges, il y avait toujours un run vert, donc AROME
avait répondu. Aucune alerte n'aurait donc été rendue rouge par l'escalade.

#### Décision 2 — quota Open-Meteo

**Mesure.** La limite gratuite est par adresse IP : 600 appels par minute, 5 000 par
heure et 10 000 par jour (page Pricing d'Open-Meteo, lue le 23.11). Une requête compte
pour plus d'un appel au-delà de 10 variables, de 2 semaines ou d'un lieu. Notre
consommation par jour, sur la semaine du 16 au 22.11 :

| Appelant | Requête | Poids | Runs par jour | Appels par jour |
|---|---|---|---|---|
| Vent : AROME | meta + 8 lieux × 3 variables × 3 jours | 1 + 8 | ≤ 15 (104 runs en 7 j, dont des secours sautés) | ≤ 135 |
| Neige annoncée | 15 variables × 12 jours (7 passés + 5) | 1,5 | ~6 (41 en 7 j) | ~9 |
| Neige annoncée, horizon long | 10 variables × 16 jours | 1,1 | ~6 | ~7 |
| Neige fraîche, Worker | aucun appel Open-Meteo | 0 | — | 0 |
| **Total** | | | | **≤ 150, soit 1,5 % de la limite** |

Le plugin TRMNL Météo Carouge interroge Open-Meteo depuis les serveurs de TRMNL, pas
depuis nos runners.

**Le 429 vient de l'adresse IP partagée des runners GitHub, pas de notre volume.**
Nos ~150 appels par jour sont en plus répartis sur des runners différents. Le 22.11 à
13h40, l'adresse du runner avait déjà épuisé ses 10 000 appels du jour, consommés par
d'autres utilisateurs de GitHub Actions. On n'a aucune prise là-dessus.

**En attendant : un 429 ne perd rien.** C'est vérifié dans le code et par un nouveau
test, `annoncée : 429 Open-Meteo -> rouge, état, écran et journal intacts ; le run
suivant rattrape` :

- Le script s'arrête avant toute décision. L'état d'épisode, `neige-ecran.json` et le
  journal ne sont pas touchés. TRMNL garde le dernier écran neige, daté de son run.
- Le run suivant recalcule tout depuis 7 jours passés et décide à partir du même état.
  Il rattrape donc l'alerte ou la révision. Le 22.11, c'était à 16h23.
- Seul inconvénient : jusqu'à environ 11 h de retard si le run de 16h23 tombe lui aussi
  sur une adresse épuisée.

**Proposition gratuite : la neige annoncée par MeteoSuisse.** Sonde en lecture seule du
23.11 :

- **Points de prévision proches de Les Collines** (2022 m), dans `ogd-local-forecasting` :
  - Champéry / Planachaux, station `WNSPLA`, 1943 m, à 1,9 km : 79 m plus bas, soit
    −0,5 °C de correction. C'est le meilleur candidat, car c'est un point station,
    calé sur des mesures.
  - Pointe des Mossettes, point d'intérêt, 2277 m, à 0,9 km : 255 m plus haut.
  - Les Crosets, centre NPA, 1665 m, à 1 km.
- **Paramètres disponibles.** Il n'y a pas de neige prévue en cm, mais il y a ce qu'il
  faut pour la conversion D-005 : précipitations horaires `rre150h0`, température
  `tre200h0` et isotherme 0 °C `zprfr0hs`. Il y a aussi les quantiles 10 % et 90 % de la
  pluie et de la température, qui donnent une fourchette.
- **Horizon** : environ 9 jours (219 h), contre 5 jours pour ICON-CH2 via Open-Meteo.
- **Coût** : deux CSV d'environ 32 Mo par run, lus en 1 à 2 s. Aucun quota, aucune clé.
  C'est l'API que l'alerte vent lit déjà.
- **Premier signal sur l'épisode en cours.** Neige du 22.11 (00h-24h), conversion D-005,
  température ramenée à 2022 m. ILI2 a mesuré **39 cm** (HN du 23.11 à 7h) :

  | Prévision | MeteoSuisse Planachaux | Open-Meteo ICON |
  |---|---|---|
  | J-1, run du 21.11 à 5h | 26 cm (42 mm) | 52 cm en 0,7 fixe (77 mm) ; conversion D-005 pas encore en service, pas de chiffre au journal |
  | J0, run du 22.11 à 5h | 37 cm (58 mm) | 36 cm (D-005) |

  Pour le 23.11, prévu la veille, MeteoSuisse donnait 14 cm et Open-Meteo 39 à 45 cm. La hauteur de
  neige d'ILI2 est montée de 58 à 77 cm entre 23h et 5h, puis n'a plus bougé, soit
  moins de 20 cm tombés. Le verdict se fera avec le HN de demain. Un seul épisode ne
  prouve rien, mais les deux sources ne se trompent pas dans le même sens.
- **Impact sur les bornes D-005.** Les bornes −5 / +5 °C sont calées sur ICON via
  Open-Meteo, qui ramène la température à 2022 m par sa propre correction d'altitude.
  Les températures MeteoSuisse aux points station sont post-traitées sur la mesure. Il
  faudrait donc refaire le calage. Ce n'est pas faisable sur le passé, car le STAC ne
  garde que 3 jours de runs. Il faut archiver à partir de maintenant.

**Ma proposition, en deux temps, sans bascule :**

1. **Maintenant, sur ton feu vert.** Journaliser chaque run en parallèle : prévision
   MeteoSuisse Planachaux convertie (modèle `msl` dans `data/neige.csv`, information
   seulement). Le rapport QA neige existant la compare alors à ILI2, à côté d'ICON.
   Coût : environ 65 Mo téléchargés par run, aucune alerte touchée.
2. **Après 4 à 6 épisodes** (mi-janvier ?). Recaler les bornes sur MeteoSuisse, comparer
   les erreurs J-1 et J-2 des deux sources, puis tu décides : bascule complète, ou
   MeteoSuisse en principal et Open-Meteo en secours si un 429 tombe.

Autres pistes, moins bonnes :

- Passer les appels par le Worker Cloudflare : ses adresses sont partagées aussi, et ça
  ajoute une pièce.
- Relancer le run neige 30 à 60 minutes après un 429, sur un autre runner : gratuit et
  simple. C'est un bon palliatif si tu ne veux pas de MeteoSuisse.
- Réduire le volume : il est déjà négligeable, ça ne changerait rien.

**Premier signal complété, 24.11.2026 (Weather Station).** HN d'ILI2 du 24.11 publié :
**12,6 cm** (24 h jusqu'au 24.11 à 7h). Sonde en lecture seule (runs MeteoSuisse du 22 et
du 23.11 à 5h), conversion D-005, température ramenée à 2022 m.

La comparaison jour par jour est faussée par le découpage. La neige est tombée surtout
entre 23h et 5h dans la nuit du 22 au 23 (hauteur ILI2 de 58 à 77 cm), à cheval sur
minuit et avant le relevé de 7h. La mesure juste est donc le total des deux jours, du
22.11 à 7h au 24.11 à 7h : **52 cm mesurés** (HN 39,3 + 12,6).

| Prévision du 22.11 à 5h (J0 et J-1) | 22.11 | 23.11 | total |
|---|---|---|---|
| MeteoSuisse Planachaux, fenêtres du relevé (7h → 7h) | 46 cm | 3 cm | **50 cm** (−4 %) |
| MeteoSuisse Planachaux, jours 00h-24h | 37 cm | 14 cm | 51 cm |
| Open-Meteo ICON, D-005, jours 00h-24h | 36 cm | 44 cm | **80 cm** (+54 %) |
| Mesuré ILI2 (HN 23.11 et 24.11) | 39 cm | 13 cm | 52 cm |

- Sur le total, MeteoSuisse est juste et ICON annonce environ 50 % de trop. Les
  millimètres expliquent l'écart : 72 mm pour MeteoSuisse contre 97 mm pour ICON. La
  conversion est la même pour les deux : c'est la quantité d'eau prévue qui diffère.
- Le run MeteoSuisse du 23.11 à 5h, une fois la neige tombée, ne donnait plus que 4 cm
  pour la journée du 23 à 7h au 24 à 7h. ILI2 en a mesuré 12,6, alors que sa hauteur de
  neige n'a pas bougé (tassement). Sur un jour isolé, l'écart est du même ordre que le
  découpage horaire.
- **Ça ne prouve rien.** C'est un seul épisode, en phase froide, et le SLF peut réviser
  le HN du 24.11. Mais c'est le sens attendu, et c'est un argument pour le journal en
  parallèle (point 1 de ma proposition), qui permettrait de mesurer cela sur 4 à 6
  épisodes. J'attends ton feu vert ; rien n'est en service.

---

## D-008 — Suites de D-007 et affichage de l'épisode neige en cours

**Statut :** FAITE (en service le 24.11.2026 vers 9h30 ; premières lignes `msl` au run de 16h23 ; relance réelle jamais déclenchée à ce jour)
**De :** WINGFOIL/METEO-ALERT — mardi 24.11.2026, 08h35
**Décidé par :** Greg, 24.11.2026

### Décision 1 — journal MeteoSuisse Planachaux en parallèle : feu vert

- Ton point 1 de D-007, tel que proposé : chaque run neige annoncée journalise la prévision
  MeteoSuisse `WNSPLA` convertie avec D-005 (température ramenée à 2022 m), modèle `msl`
  dans `data/neige.csv`. **Information seulement** : aucune alerte ni l'écran n'en dépendent.
- Source **informative** au sens de D-007 (vert + avertissement, escalade à 24 h).
- Le rapport QA neige compare `msl` et ICON à ILI2 **sur les fenêtres du relevé (7h → 7h)**
  en plus des jours civils : le premier signal du 22-23.11 montre que le découpage à minuit
  fausse la comparaison jour par jour. Donne aussi le total par épisode.
- Après 4 à 6 épisodes : recalage des bornes sur MeteoSuisse et comparaison J-1 / J-2 des
  deux sources. Je déciderai alors de la bascule (complète, ou MeteoSuisse principal et
  Open-Meteo en secours). Signale dans le bilan de chaque épisode où en est la comparaison.

### Décision 2 — relance du run neige après un refus Open-Meteo

- Si le run neige annoncée échoue sur Open-Meteo (HTTP 429, injoignable, 5xx), il
  programme **une seule relance 30 à 60 minutes plus tard**, sur un autre runner.
- Pas de relance si un run planifié tombe dans les 2 h qui suivent, ni de relance d'une
  relance : au plus une par échec.
- Les règles d'alerte s'appliquent normalement au run relancé, silence nocturne compris.
- Le run qui a échoué reste rouge (source critique). Si la relance réussit, dis-le dans
  son résumé, pour que je sache que l'alerte a été rattrapée.

### Décision 3 — relance de l'écran vent par l'alerte neige : informative

- L'étape `gh workflow run` de l'alerte neige annoncée devient **informative** : elle ne
  sert qu'à rafraîchir l'écran plus tôt, et le run vent suivant le fait de toute façon.
  C'est elle qui a envoyé le mail du 22.11 à 22h06.

### Décision 4 — écran : ce qui reste à tomber, pas le total d'un épisode commencé

**Constat.** Le 23.11 au soir, l'écran affichait « 182 cm, 16 → 23.11 », alors que presque
tout était déjà tombé, et masquait l'épisode suivant (28 cm, 25 → 26.11), le seul utile pour
décider. Ce matin, l'épisode fini a disparu et l'écran est passé à 18 cm : Greg a lu une
correction de 180 à 17 cm qui n'en était pas une.

- Une fois un épisode **commencé**, la ligne neige de l'écran affiche **la neige qui reste
  à tomber** (aujourd'hui compris, à partir de l'heure du rendu si tu as l'horaire), et la
  plage restante (« 31 cm · Lu 23 »), pas le cumul depuis le début.
- Quand il reste **moins de `AFFICHAGE_CM` (5 cm)** à tomber sur l'épisode commencé, l'écran
  passe à l'épisode suivant s'il y en a un, sinon à l'affichage normal sans épisode.
- Avant le début d'un épisode, rien ne change : « à venir » = cumul complet, donc le même
  chiffre que l'alerte.
- **Les alertes ne changent pas** : leurs messages et leurs décisions restent sur le cumul
  de l'épisode. L'écart entre l'écran et la dernière notification pendant un épisode en cours
  est voulu : l'écran répond à « qu'est-ce qui arrive », la notification annonce l'épisode.
  Si cela casse le test de contrat TRMNL ou demande un champ nouveau, ajoute le champ, ne
  retire rien.

### Retour attendu

- Décision 1 : premières lignes `msl` dans le journal, et la ligne du rapport QA.
- Décision 2 : le test qui simule un 429 puis la relance.
- Décision 4 : rendu de l'écran rejoué sur le 23.11 au soir (épisode 16 → 23 commencé,
  épisode 25 → 26 à venir) et sur ce matin, avec ce qu'il aurait affiché.

### Réponse

Weather Station — mardi 24.11.2026. En production le même jour (voir statut).

**Décision 1 — journal MeteoSuisse Planachaux : en service.**

- Chaque run neige annoncée lit le dernier run MeteoSuisse complet (`rre150h0` et
  `tre200h0` du même run), point `WNSPLA` (id et altitude lus dans le méta-fichier :
  1943 m), température ramenée à 2022 m, conversion D-005 (`snow-msl.mjs`).
- Deux découpages dans `data/neige.csv` : `msl` (jour civil, comme ICON) et `msl7`
  (fenêtre du relevé 7h → 7h, rangée au jour où elle commence, donc comparée au HN_1D daté
  J+1 : exactement la même période). ICON a aussi sa fenêtre : `icon7`. Seuls les jours ou
  fenêtres complets sont écrits (le run de l'après-midi n'a plus les heures du matin).
- Information seulement : aucune alerte ni l'écran n'en dépendent. Source informative
  (« MeteoSuisse Planachaux (journal) ») : avertissement, rouge après 24 h de panne. Lu
  après les envois, il ne retarde aucune alerte (environ 2 s, 65 Mo).
- Rapport QA neige (résumé du job neige fraîche) : tableau par jour (ICON civil, ICON
  7h-7h, MeteoSuisse civil, MeteoSuisse 7h-7h, mesuré) à J-1, puis total par épisode des
  fenêtres à J-1 et J-2 pour les deux sources, contre le mesuré sur la plage. Un total
  partiel affiche le nombre de jours couverts.
- Premières lignes (DRY_RUN de 9h30, run MeteoSuisse de 9h ; écriture réelle à partir du run
  de 16h23) :
  - `msl` : Me 25.11 1,5 cm (2,2 mm) · Je 26.11 3,8 cm (3,1 mm) ;
  - `msl7` : Me 25.11 4,1 cm (4,2 mm) · Je 26.11 0,9 cm (0,8 mm).
  Pour le même épisode, ICON annonce 18 cm (Me 13, Je 5). C'est le premier épisode
  comparable de bout en bout.
- Ligne du rapport QA, telle qu'elle sortira : `| 2026-11-25 | ICON civil | ICON 7h-7h |
  MeteoSuisse civil | MeteoSuisse 7h-7h | mesuré |` par jour, puis `| 2026-11-25 →
  2026-11-26 | ICON J-1 | MeteoSuisse J-1 | ICON J-2 | MeteoSuisse J-2 | mesuré |`. Pour
  l'instant : « Pas encore de prévision MeteoSuisse à J-1 au journal » (la première J-1
  arrive ce soir).
- Je donnerai l'état de la comparaison dans le bilan de chaque épisode.

**Décision 2 — relance après un refus d'Open-Meteo : en service.**

- HTTP 429, 5xx ou Open-Meteo injoignable (après le second essai de `reseau.mjs`) : le run
  reste rouge et demande une relance. Un autre 4xx (requête fausse) n'en demande pas.
- `relance.mjs` décide : pas de relance d'une relance, ni si un run planifié tombe dans les
  2 h (5h23 et 16h23, et le réveil de 8h03 ou 9h03, heure suisse, selon le jour). Sinon,
  nouveau run (donc autre runner) qui attend 40 min avant de commencer
  (`vars.RELANCE_NEIGE_MIN`, 30 à 60 ; non créée, défaut 40).
- Le run relancé applique les règles normales, silence compris. Son résumé dit
  « Open-Meteo a répondu, l'alerte est rattrapée », ou « nouvel échec, pas d'autre
  relance » (il reste alors rouge). Le run d'origine écrit la raison dans son résumé.
- Jamais en DRY_RUN ni avec un seuil forcé.
- Test : `test/snow.test.mjs`, « 429 -> rouge et relance demandée ; puis la relance
  réussit -> rattrapée » (plus 503, injoignable, 400, DRY_RUN, seuil forcé, relance qui
  échoue). `test/relance.test.mjs` : fenêtre de 2 h, réveil jour ouvré, week-end, été.
- Essai réel du chemin de relance (run relancé en DRY_RUN, attente 0) : attente faite,
  résumé « Open-Meteo a répondu, l'alerte est rattrapée ». Le déclenchement depuis un run
  en échec n'a pas pu être essayé en vrai sans provoquer un vrai refus ; il est couvert
  par les tests et suit la même commande que la relance de l'écran.
- À savoir : GitHub ne garde qu'un run en attente par workflow. Si un run en retard du cron
  de secours arrive pendant l'attente, l'un des deux est annulé. Le travail est fait quand
  même, une fois, sans boucle.

**Décision 3 — relance de l'écran : informative.** Un échec de `gh workflow run` laisse
le run vert, avec un avertissement. Précision sur le mail du 22.11 à 22h06 : ce n'est pas
cette étape qui a échoué. Elle a bien lancé `wind-alert` (run 45070182411), et c'est ce
run-là qui n'a pas démarré côté GitHub (0 job, « workflow file issue », sans changement du
fichier). Le run vent de 22h17 est passé. Ce cas-là ne dépend pas de nous ; il reste
possible, rarement.

**Décision 4 — écran : ce qui reste à tomber : en service.**

- À chaque envoi vers TRMNL (`wind-alert`, toutes les 4 h, et après un changement
  d'épisode), un épisode commencé montre la neige qui reste, aujourd'hui compris à partir
  de l'heure de l'envoi (heures du run neige), et la plage restante. Sous 5 cm
  (`AFFICHAGE_NEIGE_CM`), il sort de la liste : l'écran passe au suivant, ou à rien.
- Avant son début, un épisode garde le cumul complet, le chiffre de l'alerte.
- Aucun champ retiré : `cm` et `de` changent de sens pour un épisode commencé ; deux
  champs ajoutés, `total` (cumul, le chiffre de l'alerte) et `cours` (vrai si commencé).
  Markup inchangé (il prend déjà le premier épisode pas fini). `data/neige-ecran.json`
  garde les cumuls ; les alertes ne changent pas. Contrat mis à jour
  (`docs/contrat-trmnl.md`).
- L'inversion (`label--filled`) suit toujours l'épisode au seuil, même pour ce qui reste.
- Limite : entre deux envois (4 h), le chiffre restant ne baisse pas.

Rejeu sur les vrais fichiers écran (envois vent réels) :

| envoi (heure suisse) | avant | avec D-008 |
|---|---|---|
| Di 22.11 16h25 | 200 cm · Di 15 → Lu 23.11 | 68 cm · Di 22 → Lu 23.11 |
| Lu 23.11 6h17 | 188 cm · Lu 16 → Lu 23.11 | 14 cm · Lu 23.11 |
| Lu 23.11 8h04 | 183 cm · Lu 16 → Lu 23.11 | 5 cm · Lu 23.11 |
| Lu 23.11 10h17 | 183 cm · Lu 16 → Lu 23.11 | 27 cm · Me 25 → Ve 27.11 |
| **Lu 23.11 18h17 et 22h17** | **182 cm · Lu 16 → Lu 23.11** | **28 cm · Me 25 → Je 26.11** |
| Ma 24.11 6h17 | 17 cm · Me 25 → Je 26.11 | 17 cm · Me 25 → Je 26.11 (pas commencé : inchangé) |
| Ma 24.11 10h17 | 18 cm · Me 25 → Je 26.11 | 18 cm · Me 25 → Je 26.11 |

Le 23.11 au soir, l'écran aurait donc montré l'épisode suivant (28 cm) dès 10h17, et ce
matin la baisse 28 → 18 cm se serait lue comme une vraie révision, ce qu'elle était (message
« revue à la baisse » de 8h03). Toutes les lignes restent inversées : les épisodes sont au
seuil.

Tests : 406 au vert. Revue de code par un agent indépendant : rien qui touche une alerte.
Six défauts corrigés avant la mise en service : panne de `relance.mjs` masquée (elle rend
maintenant le run rouge), « rattrapée » écrit avant la fin du run (écrit maintenant à la
fin, et seulement si l'envoi a réussi), réponse 200 illisible traitée comme un refus (plus
de relance), test faux entre minuit et 1h, ligne CSV MeteoSuisse tronquée qui rendait le
run rouge, fenêtre ICON décalée d'une heure aux changements d'heure, reste surestimé quand
les heures finissaient à minuit pile. DRY_RUN verts sur les trois workflows (runs
45357816264, 45357822592, 45357828904) ; écran : `{"cm":18,"de":"2026-11-25",
"a":"2026-11-26","ok":true,"total":18,"cours":false}`.

---

## D-009 — Test dépendant de l'heure ; plus de rouge quand une relance est programmée

**Statut :** OUVERTE
**De :** WINGFOIL/METEO-ALERT — mercredi 25.11.2026, 08h35
**Décidé par :** Greg, 25.11.2026

### Contexte — deux mails cette nuit, aucune alerte perdue

| Run (heure suisse) | Cause | Impact |
|---|---|---|
| Me 25.11 0h56 — neige annoncée, cron de secours GitHub (`45514106901`) | Étape **Tests** : 1 échec sur 289, `annoncée (D-008) : journal msl, msl7 et icon7 écrits, information seulement` (`test/snow.test.mjs:703`), « jour du run incomplet (heures du matin absentes) : pas écrit » | Aucun : le run de 5h23 a fait le travail |
| Me 25.11 5h23 — neige annoncée, Worker (`45546467926`) | Refus d'Open-Meteo → rouge, relance programmée | Aucun : relance `45546567170` partie vers 6h04, **verte** (première relance réelle) |

### Décision 1 — corriger le test qui dépend de l'heure réelle

- Le test `journal msl, msl7 et icon7 écrits` échoue quand il tourne juste après minuit,
  heure suisse : il dépend de l'horloge réelle. Ce n'est pas le défaut « test faux entre
  minuit et 1h » corrigé dans D-008 : c'est un autre test, écrit le même jour.
- Fixe l'horloge dans ce test (date et heure injectées, pas `Date.now()`).
- **Passe en revue toute la suite** pour les autres tests sensibles à l'heure réelle, au
  jour de la semaine, au changement d'heure ou au fuseau. Fais tourner la suite avec
  l'horloge forcée sur quelques instants piégeux (0h05, 0h59, 6h59, 23h59 heure suisse ;
  un dimanche ; le jour du passage à l'heure d'été et d'hiver) et dis ce que ça a trouvé.

### Décision 2 — plus de rouge quand une relance est programmée

- Quand le run neige annoncée échoue sur Open-Meteo **et qu'une relance est programmée**,
  il finit **vert avec un avertissement** (« Open-Meteo refusé, relance à HHhMM »), pas
  rouge. Le mail ne sert à rien si l'alerte est rattrapée 40 min plus tard.
- **La relance devient le juge** : si elle échoue à son tour, elle est **rouge** (mail),
  comme aujourd'hui.
- Si **aucune relance n'est programmée** (run planifié dans les 2 h, ou déjà une relance),
  le run reste **rouge** comme aujourd'hui.
- Si la commande de relance elle-même échoue, le run reste **rouge** : sinon un refus
  pourrait disparaître sans personne pour le rattraper.
- Résultat attendu : un mail seulement quand une évaluation neige est vraiment perdue.

### Retour attendu

- Décision 1 : la cause exacte du test de cette nuit, et la liste des autres tests trouvés
  sensibles à l'heure.
- Décision 2 : rejeu de cette nuit avec la nouvelle règle (combien de mails seraient
  partis), et le test qui simule « refus → relance programmée → vert », puis « relance qui
  échoue → rouge ».

### Réponse

_(à remplir par Weather Station)_
