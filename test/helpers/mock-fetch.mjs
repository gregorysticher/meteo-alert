// Remplace fetch pour les tests de bout en bout des scripts (node --import).
// MOCK_FETCH = JSON { status, body } | "network-error".
// body est renvoyé tel quel (objet/tableau -> JSON).
// MOCK_NTFY_STATUS = statut renvoyé par ntfy (200 par défaut), pour simuler une
// panne d'envoi alors que la source météo répond.
const spec = process.env.MOCK_FETCH;
if (spec) {
  globalThis.fetch = async (url) => {
    if (String(url).includes('ntfy.sh') && process.env.MOCK_NTFY_STATUS) {
      return new Response('panne', { status: +process.env.MOCK_NTFY_STATUS });
    }
    if (spec === 'network-error') throw new Error('ECONNRESET (simulé)');
    const { status = 200, body = null } = JSON.parse(spec);
    const texte = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(texte, { status, headers: { 'Content-Type': 'application/json' } });
  };
}
