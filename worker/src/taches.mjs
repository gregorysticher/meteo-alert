// Tâches du déclencheur et appel à GitHub, à part du point d'entrée du Worker,
// qui n'exporte que son gestionnaire.

const DEPOT = 'gregorysticher/meteo-alert';

// Les entrées sont explicites : sans elles, workflow_dispatch prend les valeurs
// par défaut des workflows, c'est-à-dire DRY_RUN, et rien ne partirait jamais.
export const TACHES = {
  '17 1,5,9,13,17,21 * * *': { workflow: 'wind-alert.yml', inputs: { dry_run: '0', qa_only: '0' } },
  '23 4,15 * * *': { workflow: 'snow-forecast-alert.yml', inputs: { dry_run: 'false' } },
  '47 5,16 * * *': { workflow: 'snow-fresh-alert.yml', inputs: { dry_run: 'false' } },
};

const ESSAIS = 2;

export async function declencher(cron, env) {
  const tache = TACHES[cron];
  if (!tache) throw new Error(`cron inconnu : ${cron}`);
  if (!env.GH_TOKEN) throw new Error('secret GH_TOKEN absent');

  const url = `https://api.github.com/repos/${DEPOT}/actions/workflows/${tache.workflow}/dispatches`;
  let erreur;
  for (let i = 0; i < ESSAIS; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GH_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'meteo-alert-cron',          // GitHub refuse une requête sans
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main', inputs: tache.inputs }),
    });
    if (res.ok) {
      console.log(`${tache.workflow} déclenché (HTTP ${res.status})`);
      return;
    }
    erreur = `${tache.workflow} : HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`;
    if (res.status < 500) break;                   // jeton ou requête : réessayer est inutile
  }
  throw new Error(erreur);
}
