// Remplace fetch pour les tests de bout en bout des scripts (node --import).
// MOCK_FETCH = JSON { status, body } | "network-error".
// body est renvoyé tel quel (objet/tableau -> JSON).
// MOCK_RATES = nombre de premiers appels qui échouent (erreur réseau), pour
// vérifier le second essai.
// MOCK_NTFY_STATUS = statut renvoyé par ntfy (200 par défaut), pour simuler une
// panne d'envoi alors que la source météo répond.
import { appendFileSync } from 'node:fs';

// Pas d'attente avant le second essai de reseau.mjs.
process.env.ESSAI_ATTENTE_S ??= '0';
// Pas de serveur de secours : le second essai reste dans la simulation.
process.env.RESEAU_SECOURS ??= '{}';

const spec = process.env.MOCK_FETCH;
if (spec) {
  let rates = Number(process.env.MOCK_RATES || 0);
  globalThis.fetch = async (url) => {
    if (rates > 0) { rates--; throw new Error('fetch failed (raté simulé)'); }
    if (process.env.MOCK_URLS) appendFileSync(process.env.MOCK_URLS, `${url}\n`);
    if (String(url).includes('ntfy.sh') && process.env.MOCK_NTFY_STATUS) {
      return new Response('panne', { status: +process.env.MOCK_NTFY_STATUS });
    }
    if (String(url).includes('forecast_days=16') && process.env.MOCK_LONG) {
      const { status = 200, body = null } = JSON.parse(process.env.MOCK_LONG);
      return new Response(JSON.stringify(body), { status });
    }
    if (spec === 'network-error') throw new Error('ECONNRESET (simulé)');
    const { status = 200, body = null } = JSON.parse(spec);
    const texte = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(texte, { status, headers: { 'Content-Type': 'application/json' } });
  };
}
