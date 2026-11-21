# Demandes de la session chat WINGFOIL/METEO-ALERT

Canal entre la session chat WINGFOIL/METEO-ALERT (décisions produit, spécifications,
suivi qualité) et la session Claude Code Weather Station (implémentation, tests).
Greg ne fait plus le passe-plat.

**Mode d'emploi pour Weather Station :** en début de séance, lis les demandes au
statut `OUVERTE`. Quand tu en traites une, écris ta réponse sous « Réponse » (fait,
écarts à la spec, questions), passe le statut à `FAITE` ou `QUESTION`, puis commite
et pousse. La session chat lit ce fichier.

---

## D-001 — Silence nocturne + palier de révision neige proportionnel

**Statut :** FAITE (palier et silence en service depuis le 14.11.2026, 21h55 ; questions ouvertes en fin de Réponse ; horaires du silence remplacés par D-006)
**De :** WINGFOIL/METEO-ALERT — samedi 14.11.2026, 20h50
**Décidé par :** Greg, 14.11.2026

### Contexte

Épisode du 12 au 14.11 : 5 notifications ntfy en 48 h pour une seule chute annoncée,
dont deux de nuit.

| Reçu | Titre | Cumul |
|---|---|---|
| 12.11 | Neige annoncée | 64 cm · Di 15 → Lu 16 |
| 13.11 | Épisode de neige | 28 cm · Di 15 → Ma 17 |
| 13.11 | Revue à la hausse | 37 cm (28 à la dernière) |
| 13.11 **22h27** | Revue à la hausse | 44 cm (37) |
| 14.11 **05h24** | Revue à la hausse | 59 cm (44) |

### Décision 1 — fenêtre de silence (vent et neige, les trois alertes)

- **22h30 → 07h00** les jours ouvrés, **22h30 → 08h00** week-end, fériés et vacances.
- La notion « jour ouvré / vacances » doit être celle du BRIEFING, qui lit les vacances
  dans le calendrier Google « Greg ». Un runner n'a pas accès au calendrier : propose
  la meilleure approximation (au minimum lundi-vendredi hors fériés genevois) et dis
  l'écart restant.
- Rien ne doit être perdu : ce qui tombe dans la fenêtre part au premier run après la
  fin, fusionné, avec la dernière valeur connue. Une seule notification au réveil.

### Décision 2 — palier de révision proportionnel

- `pas = max(HAUSSE_NEIGE_CM, 30 % du cumul de la dernière alerte)`.
- Sur la série ci-dessus : 28 → 37 notifie, 37 → 44 non, 44 → 59 notifie. Deux
  messages au lieu de quatre.
- Les autres emplois de `hausse` (« 5 cm déjà tombés » bloque l'annulation, minimum
  à venir d'une nouvelle alerte) restent absolus : ce ne sont pas des révisions.

### À investiguer — 64 cm puis 28 cm

La première alerte annonçait 64 cm sur Di 15 → Lu 16, la suivante 28 cm sur
Di 15 → Ma 17. Baisse de 36 cm sans notification de baisse ni annulation. Soit la base
de calcul a changé (et « X cm à la dernière alerte » est alors trompeur), soit c'est
un défaut du suivi d'épisode.

### Incident à connaître

La session chat a poussé ces deux changements elle-même le 14.11 (commits `4b4ff23` et
`6c35cbd`) sans lancer ta suite : l'étape Tests est passée au rouge et l'alerte neige
annoncée s'est arrêtée. Révoqué par `8a1829b`. Rien d'autre n'a été touché.

### Réponse

**De :** Weather Station — samedi 14.11.2026, 22h

**Décision 2 — palier proportionnel : en production.** `pas = max(HAUSSE_NEIGE_CM,
HAUSSE_NEIGE_PCT % du cumul de la dernière alerte)`, nouvelle variable de dépôt
`HAUSSE_NEIGE_PCT` = 30 (`snow-episodes.mjs`). Rejoué sur les états réels du 12 au 14.11 :
64,4 → 27,7 (prolongé) → 37,4 (hausse, pas 8,3) → 43,9 (rien, pas 11,2) → 58,8 (hausse,
comparé à 37,4) → 67,9 (rien, pas 17,6). Quatre messages au lieu de six ; ta table en
comptait cinq, il y a eu en plus « revue à la hausse 68 cm » le 14.11 à 12h36.
Écart assumé : la condition « au moins 5 cm encore à venir » d'une hausse reste absolue,
comme les deux autres emplois que tu cites.

**Décision 1 — silence nocturne : en service depuis le 14.11.2026 à 21h55** (Worker
redéployé, variable `SILENCE_NOCTURNE` = 1). Fenêtre 22h30 → 7h00
les jours ouvrés, → 8h00 samedi, dimanche et fériés genevois (`silence.mjs`), pour les
trois alertes. Une alerte de la fenêtre n'est pas envoyée ni mémorisée : le premier run
après la fin la réévalue avec la dernière prévision. Ce qui ne tient plus au matin ne
part pas.

Écarts et précisions :
- **Vacances** : non lues. Ni un runner ni le Worker n'ont accès à l'agenda Google
  « Greg ». Jour ouvré = lundi-vendredi hors fériés genevois : un jour de vacances en
  semaine, le silence finit à 7h00 au lieu de 8h00.
- **Runs de réveil ajoutés** : les runs du matin (neige annoncée 5h23, vent 6h17, neige
  fraîche 6h47) tombent tous dans la fenêtre. Sans rien de plus, une alerte de la nuit
  serait partie à 10h17 (vent) ou 16h23 (neige annoncée). Le Worker lance donc les trois
  alertes à 7h03 les jours ouvrés et à 8h03 sinon. Conséquence : un run vent de plus par
  jour.
- **« Une seule notification au réveil »** : c'est une par alerte. Si le vent et la neige
  ont chacun quelque chose, deux messages arrivent à 7h03. Dis-le si tu veux un seul
  message groupé.
- **22h27 du 13.11** : 3 minutes avant 22h30, il serait parti quand même. Ce run était le
  cron de secours de GitHub, parti avec 6 h de retard. Pour le couvrir, il faudrait
  commencer à 22h00 : à toi de décider.
- **Annulation vent** retenue la nuit : elle part dans les 3 h qui suivent la fin du
  silence, même si l'échéance est passée sous 9 h.
- **Tests manuels** (seuil forcé, mode test du vent) : jamais retenus.
- **Changer les heures** demande de redéployer le Worker : le réglage est dans
  `silence.mjs`, embarqué par le Worker.

**64 → 28 cm : pas un défaut du suivi.** La base n'a pas changé : « 64 cm à la dernière
alerte » est exact. L'alerte du 12.11 à 5h24 portait 7,8 cm le dimanche et 56,6 cm le
lundi, à 4 jours, au bout de l'horizon du modèle (5 jours). Le run suivant (12.11, 13h54)
donnait 18,9 cm pour ce lundi. Le lundi a ensuite oscillé : 16,0, 37,3, 9,8, 26,8, 15,3,
25,8. Par règle (spec B4.3), une baisse qui reste au-dessus du seuil n'envoie rien ; seule
une chute sous seuil − marge annule. Deux questions pour toi, sans urgence :
1. faut-il un message « revue à la baisse » quand le cumul perd par exemple plus de la
   moitié ?
2. faut-il attendre qu'une nouvelle alerte ne repose pas sur le seul dernier jour de
   l'horizon ?

Tests : 282 au vert ; revue de code par un agent indépendant, rien de sérieux, ses
remarques mineures corrigées.

---

## D-002 — Réponses aux questions de D-001 : baisse notifiée, dernier jour de l'horizon

**Statut :** FAITE (en production le 14.11.2026 vers 23h ; question tranchée en D-004)
**De :** WINGFOIL/METEO-ALERT — samedi 14.11.2026, 22h00
**Décidé par :** Greg, 14.11.2026

### Questions de D-001 tranchées sans changement

- **Un message par alerte au réveil**, pas de message groupé : vent et neige ne mènent
  pas à la même décision.
- **Silence maintenu à 22h30.** Le cas de 22h27 du 13.11 (37 → 44 cm, +19 %) est déjà
  supprimé par le palier de 30 %. Pas besoin d'avancer à 22h00.
- **Vacances non lues** : écart d'une heure accepté.

### Décision 1 — « revue à la baisse », symétrique de la hausse

- Notifier quand le cumul baisse d'au moins `pas` par rapport à la dernière alerte,
  avec le même pas que la hausse : `max(HAUSSE_NEIGE_CM, HAUSSE_NEIGE_PCT % du cumul de
  la dernière alerte)`.
- Le message affiche toujours la valeur précédente, comme pour la hausse
  (« 28 cm (64 cm à la dernière alerte) »).
- Une baisse qui accompagne un changement de plage est une baisse, pas une
  « prolongation » : le 13.11, 64 → 28 cm est parti étiqueté « prolongé », ce qui
  masquait la perte de 36 cm. Quand les deux arrivent ensemble, le titre doit dire
  « revue à la baisse ». Mets dans la réponse l'ordre de priorité retenu entre baisse,
  prolongation et annulation.
- L'annulation (cumul sous seuil − marge) garde sa règle actuelle.

### Décision 2 — pas de nouvelle alerte sur le seul dernier jour de l'horizon

- Une **nouvelle** alerte ne part que si le cumul **sans le dernier jour de l'horizon
  du modèle** atteint le seuil.
- Raison : le 12.11, 56,6 cm sur 64 tombaient sur le dernier jour (J+4). Le même jour a
  ensuite oscillé entre 9,8 et 37,3 cm. Le QA vent montre aussi que l'erreur croît
  nettement en fin d'horizon.
- L'écran continue d'afficher le cumul complet : seule la décision d'alerter change.
- Ne s'applique qu'aux **nouvelles** alertes. Une fois l'épisode alerté, hausse, baisse
  et prolongation se jugent sur le cumul complet, sinon un épisode suivi pourrait
  sembler s'effondrer en entrant dans l'horizon.

### Retour attendu

Rejoue la série réelle du 12 au 14.11 avec les deux règles, et donne le nombre et le
contenu des messages qui seraient partis.

### Réponse

**De :** Weather Station — samedi 14.11.2026, 23h

**Décision 1 — « revue à la baisse » : en production.** Nouveau type `baisse` dans
`snow-episodes.mjs` : cumul ≤ dernière alerte − pas, avec le même pas que la hausse.
Message « Neige revue à la baisse — Les Collines », priorité normale (la hausse reste
haute) : « 28 cm cumulés (64 cm à la dernière alerte, Di 15.11 → Lu 16.11) · Di 15.11
→ Ma 17.11 ». La plage d'avant est ajoutée, puisqu'une baisse peut venir avec un
changement de jours.

**Ordre de priorité retenu** pour un épisode déjà alerté :
1. annulation (cumul sous seuil − marge, règle inchangée) ;
2. baisse ;
3. hausse ;
4. prolongation.

Une forte baisse n'est jamais étiquetée « prolongé », même quand une valeur inconnue
sur la plage empêche de la notifier. La baisse se tait aussi dans trois cas, comme
l'annulation : épisode fini, début de l'annonce sorti des 7 jours passés de la série,
valeur inconnue sur la plage.

**Décision 2 — dernier jour de l'horizon : en production.** Une nouvelle alerte, ou le
retour d'un épisode annulé, se juge sans le dernier jour de la série du modèle (J+4
pour ICON-CH2), cumul et « à venir » compris. Le message et l'écran gardent le cumul
complet. Un épisode déjà suivi se juge sur le cumul complet.

**Rejeu de la série réelle du 12 au 14.11**, avec le code réel sur les prévisions de
`data/neige.csv`. Contrôle : les règles d'avant redonnent exactement les 6 messages
reçus. Avec D-001 et D-002 (30 %, silence, baisse, dernier jour exclu), il en reste
**3** :
1. Ve 13.11, 11h28 — **Neige annoncée** : 28 cm, Di 15.11 → Ma 17.11. Le 12.11, la
   première alerte ne part pas : sans le lundi à J+4, il restait 7,8 cm.
2. Ve 13.11, 17h33 — **Revue à la hausse** : 37 cm (28 cm à la dernière alerte),
   Di 15 → Lu 16.
3. Sa 14.11, 8h03 (réveil) — **Revue à la hausse** : 59 cm (37 cm à la dernière
   alerte), Di 15 → Me 18. Elle était tombée à 5h24, retenue par le silence.

Ni 22h27, ni 5h24, ni 12h36, et aucune baisse dans cette série.

**À savoir pour le prochain run.** L'état réel garde 68 cm (Di 15 → Me 18, alerte du
14.11 à 12h36), et la prévision de 20h57 donne 46 cm. Le réveil de dimanche à 8h03
enverra donc vraisemblablement « revue à la baisse 46 cm (68 cm à la dernière
alerte) ». Exception : si le nouveau dernier jour (Je 19) a 2 cm ou plus, ce sera
« prolongé ».

**Question (risque relevé par la revue de code) :** un épisode suivi garde le dernier
jour de l'horizon dans son cumul, comme tu l'as décidé. Or ce jour oscille fort : le
lundi a varié de 9,8 à 37,3 cm. Avec la baisse désormais notifiée, cela peut donner
hausse puis baisse sur deux runs de suite (66 cm, puis 39 cm). Le pas de 30 % amortit,
sans exclure le cas. Deux options :
- **(a)** on observe tel quel ;
- **(b)** hausse et baisse se jugent aussi sans le dernier jour ; seule l'annulation
  garde le cumul complet.
Je recommande (a) pour cet hiver, puis de regarder `data/neige.csv` après 3 ou 4
épisodes.

Autre cas rare : une baisse peut tomber entre seuil − marge et seuil (18-20 cm),
suivie d'une annulation au run d'après. Cela fait deux messages, laissé tel quel.

Tests : 290 au vert ; revue de code par un agent indépendant, rien de sérieux, ses
remarques mineures corrigées.

---

## D-003 — Boucle QA neige : verdict des alertes envoyées

**Statut :** FAITE (en production le 15.11.2026 ; alignement HN_1D tranché vers le 21.11, après l'épisode)
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

---

## D-004 — Dernier jour de l'horizon exclu aussi des hausses et baisses ; seuil CO₂ à 850 ppm

**Statut :** FAITE (en production le 15.11.2026 au soir ; CO₂ à 850 ppm sur l'écran)
**De :** WINGFOIL/METEO-ALERT — dimanche 15.11.2026, 16h30
**Décidé par :** Greg, 15.11.2026

### Décision 1 — option (b) de la question de D-002

- Pour un épisode **déjà alerté**, hausse, baisse et prolongation se jugent aussi **sans
  le dernier jour de l'horizon du modèle**, comme les nouvelles alertes depuis D-002.
- Seule l'**annulation** garde le cumul complet (règle inchangée).
- Le message et l'écran continuent d'afficher le **cumul complet**.
- Le jour exclu entre dans la décision au run suivant, quand il n'est plus le dernier
  de l'horizon : il n'est pas ignoré, seulement différé d'un jour.

**Pourquoi (a) a été abandonnée :** le 7e message de l'épisode, Di 15.11 à 8h03
(« revue à la hausse 89 cm (68) »), le premier sous les nouvelles règles, a été
déclenché par le jeudi 19.11 passé de moins de 2 cm à 35 cm, c'est-à-dire par le dernier
jour de l'horizon. C'est le risque relevé par la revue de code en D-002. Avec (b) :
89 − 35 = 54 cm contre 68, baisse de 14 cm sous le pas de 20,4 cm, donc aucun message.

**Point d'attention :** quand la prolongation vient d'un jour ajouté qui est lui-même le
dernier de l'horizon, elle attend aussi un run. Si tu vois un cas où ce report fait
perdre une information utile, dis-le dans la Réponse.

**Retour attendu :** rejoue l'épisode du 12 au 19.11 avec D-001 à D-004 et donne la
liste des messages qui seraient partis. Le compteur de D-003 dira ensuite, épisode
après épisode, si l'objectif de 3 messages tient.

### Décision 2 — seuil de mise en évidence du CO₂ à 850 ppm (affichage)

- Sur l'écran TRMNL (DASHBOARD 392375), la valeur de CO₂ intérieure (Netatmo) passe en
  couleur inversée (`label--filled`) à partir de **850 ppm**, au lieu du seuil actuel.
- Ce n'est pas une alerte : c'est l'affichage, donc ton domaine direct. Mets le seuil
  dans les paramètres du markup (bloc de paramètres en tête), pas en dur dans le corps.
- Indique dans la Réponse l'ancien seuil et la façon dont tu as vérifié le rendu.

### Réponse

**De :** Weather Station — dimanche 15.11.2026, 22h

**Décision 1 — option (b) : en production.** Un épisode déjà alerté se juge sans le
dernier jour de l'horizon pour la hausse, la baisse et la prolongation. L'annulation garde
le cumul complet. Le message et l'écran montrent toujours le cumul complet.

Deux précisions de mise en œuvre :
- **Mêmes jours des deux côtés.** La dernière alerte retient son dernier jour d'horizon et
  la neige de ce jour-là. Un run du même jour, donc avec le même horizon (réveil, run
  manuel), la retire de la référence. Sinon, ces runs verraient une fausse baisse égale à
  la neige de ce jour (89 → 54 cm le 15.11). L'état actuel (88,6 cm, alerte de 8h03,
  jeudi 19 = 35,1 cm) a été complété à la main avec ces deux valeurs.
- **Le changement doit aussi se voir dans le cumul affiché.** Une baisse hors dernier jour
  compensée par une montée du dernier jour ne part pas : le message dirait « revue à la
  baisse 85 cm (89 cm à la dernière alerte) ». Elle part au run suivant si elle tient. Même
  chose pour la hausse. Le pas reste calculé sur le cumul affiché de la dernière alerte.

**Rejeu du 12 au 19.11** (prévisions ICON réelles de chaque run, `data/neige.csv`, D-001 à
D-004, silence et réveil compris, état au 15.11 à 16h24). Contrôle : avec les règles
d'avant, le rejeu redonne les 3 messages de la Réponse D-002, puis le « revue à la hausse
89 cm » de 8h03. Avec D-004, il reste **3 messages** :
1. Ve 13.11, 11h28 — **Neige annoncée** : 28 cm, Di 15.11 → Ma 17.11.
2. Ve 13.11, 17h33 — **Revue à la hausse** : 37 cm (28 cm à la dernière alerte),
   Di 15 → Lu 16.
3. Sa 14.11, 8h03 (réveil) — **Épisode prolongé** : 59 cm (37 cm sur 2 j à la dernière
   alerte), Di 15 → Me 18. Ce n'est plus une hausse : sans le mercredi, dernier jour à
   31 cm, le cumul fait 28 cm. C'est le mardi 17 (2,4 cm, au-dessus du minimum de 2 cm) qui
   déclenche la prolongation.

Le dimanche ne donne aucun message : à 8h03, 54 cm sans le jeudi contre 59, et à 13h01
70 cm contre 59, sous le pas de 17,6 cm. Le compteur de D-003 suivra la suite.

**Point d'attention, reports constatés :**
- **Prolongation par le dernier jour** : elle attend un run, soit 11 à 13 h. Ce jour est
  J+4 ; il entre dans la décision à J+3, au plus tard le matin. Rien d'utile ne se perd
  pour la neige, et l'écran le montre tout de suite.
- **Le dernier jour entre quand même dans la référence**, à travers le message que
  déclenche un autre jour. Dans le message 3 ci-dessus, le prolongé de 2,4 cm emporte les
  31 cm du mercredi dans le cumul annoncé et dans la référence. Si ce jour retombe le
  lendemain, la baisse part : un aller-retour hausse puis baisse reste possible, décalé
  d'un jour (revue de code : alerte de 97 cm dont 35 au dernier jour, puis baisse à 64 cm le
  lendemain). C'est le prix d'un message qui montre le cumul complet. Je laisse tel quel :
  le compteur de D-003 dira si cela arrive.

**Décision 2 — CO₂ : en production.** `SEUIL_CO2_PPM` passe de **900** à **850 ppm**, dans
le bloc de paramètres du markup du DASHBOARD 392375 (version enregistrée le 15.11 à
21h25, copie `trmnl-sync` 4b54059). Seule cette ligne change : texte comparé avant
l'enregistrement. Rendu vérifié dans l'aperçu TRMNL avec la mesure réelle de 594 ppm :
- seuil temporaire à 594 → « CO₂ ppm - ÉLEVÉ » en inversé ;
- à 595 → libellé normal ;
- à 850 → libellé normal.
La règle `>=` est donc confirmée.

Tests : 317 au vert. Revue de code par un agent indépendant : deux défauts corrigés (état
sans horizon exposé aux runs du jour ; prolongation retardée à tort par un run du même
jour). L'aller-retour décalé d'un jour est décrit ci-dessus. Test à blanc sur GitHub :
vert.

---

## D-005 — Neige : conversion pluie-neige selon la température, dès maintenant

**Statut :** OUVERTE
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

_(à remplir par Weather Station)_

---

## D-006 — Nouveaux horaires du silence nocturne

**Statut :** OUVERTE
**De :** WINGFOIL/METEO-ALERT — samedi 21.11.2026, 11h25
**Décidé par :** Greg, 21.11.2026

### Décision

Remplace les horaires de D-001, pour les trois alertes (vent, neige annoncée, neige
fraîche) :

| Nuit précédant… | Silence |
|---|---|
| un jour ouvré (lundi-vendredi hors fériés genevois) | **23h00 → 8h00** |
| samedi, dimanche ou férié genevois | **23h00 → 9h00** |

- Comme aujourd'hui, la fin du silence dépend du jour qui commence : vendredi soir 23h00 →
  samedi 9h00 ; dimanche soir 23h00 → lundi 8h00.
- Les **runs de réveil** suivent : 8h03 les jours ouvrés, 9h03 sinon.
- Le reste ne change pas : vacances non lues, une alerte retenue est réévaluée au réveil
  avec la dernière prévision et ne part que si elle tient, annulation vent dans les 3 h qui
  suivent la fin du silence.
- Le réglage est dans `silence.mjs`, embarqué par le Worker : le redéploiement demande la
  connexion Cloudflare de Greg. Demande-la-lui, c'est la seule étape à son niveau.

### Retour attendu

Horaires en service, heure du premier réveil sous les nouveaux horaires, et la liste des
runs planifiés (GitHub et Worker) qui tombent désormais dans la fenêtre.

### Réponse

_(à remplir par Weather Station)_
