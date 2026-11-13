// reseau.mjs — un appel réseau qui réessaie une fois.
//
// Open-Meteo, MeteoSuisse ou le SLF ont des ratés de quelques secondes (« fetch
// failed », 404 ou 503 isolés). Sans second essai, chacun rendait le run rouge
// et envoyait un e-mail d'échec alors que le run suivant passait. Règle (Greg,
// 2026-11-13) : un seul nouvel essai après ESSAI_ATTENTE_S secondes, pour toute
// erreur ; si le second essai échoue aussi, la réponse ou l'erreur remonte telle
// quelle et le run reste rouge comme avant. Le premier raté est écrit dans le
// journal du run (domaine seulement : le chemin du webhook TRMNL est un secret).
//
// fetchEssai  : la réponse ; l'appelant teste res.ok et lit le corps comme avec fetch.
//               Un raté pendant la lecture du corps n'est pas couvert : pour les gros
//               téléchargements, utiliser lireEssai.
// lireEssai   : appel ET lecture du corps dans le même essai (CSV MeteoSuisse ~30 Mo).
//
// ESSAI_ATTENTE_S : attente avant le second essai (20 s par défaut, 0 en test).
// DELAI_MAX_S     : délai d'un essai, lecture du corps comprise, avant abandon.

const DELAI_MAX_S = 60;

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function essai(url, opts) {
  const delai = AbortSignal.timeout(DELAI_MAX_S * 1000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, delai]) : delai;
  return fetch(url, { ...opts, signal });
}

function domaine(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return '(URL illisible)';
  }
}

function raisonDe(err) {
  const code = err?.cause?.code || err?.cause?.name;
  return code ? `${err.message} : ${code}` : String(err?.message ?? err);
}

async function annoncer(url, raison) {
  const s = Number(process.env.ESSAI_ATTENTE_S ?? 20);
  console.log(`Raté sur ${domaine(url)} (${raison}) — nouvel essai dans ${s} s.`);
  if (s > 0) await attendre(s * 1000);
}

export async function fetchEssai(url, opts = {}) {
  let raison;
  try {
    const res = await essai(url, opts);
    if (res.ok) return res;
    raison = `HTTP ${res.status}`;
    await res.body?.cancel().catch(() => {});
  } catch (err) {
    // Interruption voulue par l'appelant : pas de second essai.
    if (opts.signal?.aborted) throw err;
    raison = raisonDe(err);
  }
  await annoncer(url, raison);
  return essai(url, opts);
}

// lire(res) rend le contenu ; une réponse non ok lève `${etiquette} -> HTTP n`.
export async function lireEssai(url, lire, { etiquette = url, opts = {} } = {}) {
  const une = async () => {
    const res = await essai(url, opts);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`${etiquette} -> HTTP ${res.status}`);
    }
    return lire(res);
  };
  try {
    return await une();
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    await annoncer(url, raisonDe(err).replace(`${etiquette} -> `, ''));
  }
  return une();
}
