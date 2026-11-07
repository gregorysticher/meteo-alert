// Remplace fetch pour les tests de bout en bout des scripts (node --import).
// MOCK_FETCH = JSON { status, body } | "network-error".
// body est renvoyé tel quel (objet/tableau -> JSON).
const spec = process.env.MOCK_FETCH;
if (spec) {
  globalThis.fetch = async () => {
    if (spec === 'network-error') throw new Error('ECONNRESET (simulé)');
    const { status = 200, body = null } = JSON.parse(spec);
    const texte = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(texte, { status, headers: { 'Content-Type': 'application/json' } });
  };
}
