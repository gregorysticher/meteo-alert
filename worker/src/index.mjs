// Déclencheur externe des alertes (spec B3). Les crons planifiés de GitHub
// partent avec 4 à 7 h de retard ; Cloudflare tient l'heure à la minute. Le cron
// GitHub reste en secours. S'il passe après ce Worker, l'anti-spam évite les
// doublons d'alertes ; wind-alert saute en plus le run si des données récentes
// existent (cron-garde.mjs), car MétéoSuisse publie une émission par heure et
// chaque run de plus grossit la QA.
//
// Secrets du Worker (jamais dans le dépôt) :
//   GH_TOKEN          jeton GitHub fine-grained, Actions: write sur meteo-alert
//   NTFY_TOPIC_PANNE  facultatif : topic ntfy prévenu si le déclenchement échoue
//                     (un jeton expiré ne doit pas passer inaperçu)

import { declencher } from './taches.mjs';

async function signaler(env, message) {
  if (!env.NTFY_TOPIC_PANNE) return;
  await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: env.NTFY_TOPIC_PANNE,
      title: 'Déclencheur météo en panne',
      message: `${message}\nLe cron GitHub reste actif, avec son retard.`,
      priority: 3,
      tags: ['warning'],
    }),
  });
}

export default {
  async scheduled(event, env) {
    try {
      await declencher(event.cron, env);
    } catch (err) {
      console.error(err.message);
      await signaler(env, err.message).catch((e) => console.error(`ntfy : ${e.message}`));
      throw err;                                   // visible en échec dans Cloudflare
    }
  },
};
