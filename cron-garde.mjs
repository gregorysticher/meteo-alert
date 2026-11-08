// cron-garde.mjs — le cron GitHub de wind-alert n'est que le secours du déclencheur
// Cloudflare. MétéoSuisse publie une émission par heure : un cron en retard
// archiverait et apparierait donc une émission de plus, et la QA grossit avec le
// CARRÉ du nombre de runs par jour. Il saute si un run récent a déjà écrit.
//
// Échec de lecture : on lance le run. Un run de trop vaut mieux qu'une alerte
// manquée.
//
// Env : EVENT, GH_TOKEN, DEPOT, GARDE_H (heures, défaut 3), GITHUB_OUTPUT.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const GARDE_DEFAUT_H = 3;

export function aSauter(evenement, dernierCommit, maintenant, gardeH = GARDE_DEFAUT_H) {
  if (evenement !== 'schedule' || !dernierCommit) return false;
  const age = (maintenant - new Date(dernierCommit)) / 36e5;
  return Number.isFinite(age) && age >= 0 && age < gardeH;
}

export async function dernierCommitDonnees(depot, jeton) {
  // data/forecasts seul : les alertes neige commitent aussi dans data/.
  const res = await fetch(
    `https://api.github.com/repos/${depot}/commits?path=data/forecasts&per_page=1`,
    { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${jeton}`,
      'User-Agent': 'meteo-alert-garde' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json())[0]?.commit?.committer?.date ?? null;
}

async function principal() {
  const { EVENT, GH_TOKEN, DEPOT, GARDE_H, GITHUB_OUTPUT } = process.env;
  let passer = false;
  if (EVENT === 'schedule') {
    try {
      const date = await dernierCommitDonnees(DEPOT, GH_TOKEN);
      passer = aSauter(EVENT, date, new Date(), Number(GARDE_H) || GARDE_DEFAUT_H);
      console.log(`Dernières données : ${date} — ${passer ? 'run sauté' : 'run lancé'}`);
    } catch (err) {
      console.log(`Garde illisible (${err.message}) : run lancé.`);
    }
  }
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `passer=${passer}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
