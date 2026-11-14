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

**Statut :** FAITE (silence en service après redéploiement du Worker, voir Réponse)
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

**Décision 1 — silence nocturne : prêt, en service dès que Greg aura reconnecté
Cloudflare** (une connexion par code, que lui seul peut valider). Fenêtre 22h30 → 7h00
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
