# Weather station — consignes Claude Code

Avant toute action, lis `HANDOFF.md` (état, architecture, conventions) puis
`TODO.md` (priorités). Si la mise en route du §0 de `HANDOFF.md` n'est pas
faite, fais-la d'abord.

## Rôles entre sessions (décidé par Greg le 14.11.2026)

- **Session chat WINGFOIL/METEO-ALERT** : décide pour les alertes vent et neige
  (seuils, créneaux, fréquence, contenu des messages, silence nocturne) et suit
  la qualité des prévisions. Elle n'écrit pas de code dans ce dépôt.
- **Session Claude Code Weather Station** (toi) : implémente, teste et met en
  production, ici et dans les dépôts `trmnl-*`.
- **Canal direct** : `docs/demandes-wingfoil.md`. En début de séance, traite
  les demandes au statut `OUVERTE`, réponds dans le fichier, change le statut,
  commite et pousse. Greg ne fait pas le passe-plat.
- **Validation** (règle de Greg, 14.11.2026) : une demande marquée « Décidé par :
  Greg » est validée par lui ; traite-la sans lui redemander. Ce qui reste à lui
  seul (connexion Cloudflare, secrets, matériel) se demande quand même.
- **Réponse toujours dans le fichier** : section « Réponse » remplie et statut
  changé, pas seulement dans le chat.
- **Avant de dire qu'il n'y a plus rien à faire** (règle de Greg, 14.11.2026) :
  `git pull`, puis relis `docs/demandes-wingfoil.md` ; une nouvelle demande
  `OUVERTE` a pu arriver pendant la séance.

## TODO.md (à tenir à jour à chaque fin de séance)

- `TODO.md` à la racine, ligne « Dernière mise à jour : AAAA-MM-JJ » en tête.
- Section « À faire par Greg » : cases à cocher, uniquement ce que Greg seul
  peut faire ou décider, avec l'échéance quand elle est connue.
- Mis à jour, commité et poussé à chaque fin de séance : le briefing
  quotidien le lit.

## Agenda et rappels (règle de Greg du 17.11.2026)

- Ne jamais créer, déplacer ni supprimer d'événement dans les agendas Google de
  Greg sans le lui demander d'abord.
- Pour un rappel ou une action datée : créer une tâche programmée Claude dans la
  session concernée (`send_later`), et noter l'échéance dans `TODO.md`
  (`Échéance : AAAA-MM-JJ`) pour que le briefing quotidien la reprenne.

## Conventions

- Session Remote Control : Greg suit souvent depuis son téléphone. Réponses
  courtes, une question à la fois, rendus montrés en image.
- Tu exécutes tout toi-même ; pas de liste d'actions à faire par Greg, sauf ce
  qui est impossible (secrets du dépôt, matériel).
- Le markup TRMNL s'édite dans l'interface TRMNL via Chrome, jamais dans
  `../trmnl-markup` (copie écrite par `trmnl-sync[bot]`, lecture seule).
- Le payload TRMNL est un contrat public, consommé par DASHBOARD 392375 : ne retirer
  aucun champ sans prévenir. Description : `docs/contrat-trmnl.md`. Pas de calcul ni de
  copie en Liquid : le markup rend, `meteo-alert` décide.
- Couleur inversée (`label--filled`) = uniquement ce que Greg doit regarder.
- Sonde en lecture seule, puis `DRY_RUN`, avant toute mise en production.
  Un échec doit rendre le run rouge.
- Vérifie contre la doc officielle et l'API réelle avant d'affirmer.
- Seuils en variables de dépôt ou de config, jamais en dur. Crons à heures
  fixes, minutes décalées.
