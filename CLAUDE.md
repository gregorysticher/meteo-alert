# Weather station — consignes Claude Code

Avant toute action, lis `HANDOFF.md` (état, architecture, conventions) puis
`TODO.md` (priorités). Si la mise en route du §0 de `HANDOFF.md` n'est pas
faite, fais-la d'abord. Tiens `TODO.md` à jour en fin de session.

- Session Remote Control : Greg suit souvent depuis son téléphone. Réponses
  courtes, une question à la fois, rendus montrés en image.
- Tu exécutes tout toi-même ; pas de liste d'actions à faire par Greg, sauf ce
  qui est impossible (secrets du dépôt, matériel).
- Le markup TRMNL s'édite dans l'interface TRMNL via Chrome, jamais dans
  `../trmnl-markup` (copie écrite par `trmnl-sync[bot]`, lecture seule).
- Couleur inversée (`label--filled`) = uniquement ce que Greg doit regarder.
- Sonde en lecture seule, puis `DRY_RUN`, avant toute mise en production.
  Un échec doit rendre le run rouge.
- Vérifie contre la doc officielle et l'API réelle avant d'affirmer.
- Seuils en variables de dépôt ou de config, jamais en dur. Crons à heures
  fixes, minutes décalées.
