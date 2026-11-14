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

**Statut :** FAITE (palier et silence en service depuis le 14.11.2026, 21h55 ; questions ouvertes en fin de Réponse)
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

**Statut :** FAITE (en production le 14.11.2026 vers 23h ; une question en fin de Réponse)
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
