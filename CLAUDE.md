# Weather station — consignes Claude Code

Avant toute action, lis `HANDOFF.md` (état, architecture, conventions) puis
`TODO.md` (priorités). Si la mise en route du §0 de `HANDOFF.md` n'est pas
faite, fais-la d'abord.

## TODO.md (à tenir à jour à chaque fin de séance)

- `TODO.md` à la racine, ligne « Dernière mise à jour : AAAA-MM-JJ » en tête.
- Section « À faire par Greg » : cases à cocher, uniquement ce que Greg seul
  peut faire ou décider, avec l'échéance quand elle est connue.
- Mis à jour, commité et poussé à chaque fin de séance : le briefing
  quotidien le lit.

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
