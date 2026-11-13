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
// SECOURS : Open-Meteo oriente chaque client vers un serveur selon sa région. Le
// 13/11/2026, son serveur US 51.81.167.44 ne répondait plus du tout, et les runners
// GitHub (US) y étaient envoyés 2 fois sur 3 : réessayer 20 s plus tard retombait
// dessus. Quand le premier essai échoue sans réponse (connexion impossible, coupure),
// le second passe donc par le serveur européen, même certificat, même API. Si cette
// adresse change un jour, le second essai échoue et le run est rouge comme avant :
// jamais de faux vert. Pour la retrouver : nslookup api.open-meteo.com depuis la Suisse.
//
// fetchEssai  : la réponse ; l'appelant teste res.ok et lit le corps comme avec fetch.
//               Un raté pendant la lecture du corps n'est pas couvert : pour les gros
//               téléchargements, utiliser lireEssai.
// lireEssai   : appel ET lecture du corps dans le même essai (CSV MeteoSuisse ~30 Mo).
//
// ESSAI_ATTENTE_S : attente avant le second essai (20 s par défaut, 0 en test).
// DELAI_MAX_S     : délai d'un essai, lecture du corps comprise, avant abandon.

import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

const DELAI_MAX_S = 60;

export const SECOURS = { 'api.open-meteo.com': '157.90.83.168' };

// RESEAU_SECOURS (JSON) remplace la table : {} dans les mocks pour ne jamais sortir
// sur le vrai réseau, un serveur local dans les tests du secours.
function secours() {
  if (!process.env.RESEAU_SECOURS) return SECOURS;
  try {
    return JSON.parse(process.env.RESEAU_SECOURS);
  } catch {
    throw new Error('RESEAU_SECOURS illisible (JSON attendu)');
  }
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function signalDe(opts) {
  const delai = AbortSignal.timeout(DELAI_MAX_S * 1000);
  return opts.signal ? AbortSignal.any([opts.signal, delai]) : delai;
}

// Requête vers une adresse IP imposée, le nom d'hôte restant celui de l'URL (TLS,
// en-tête Host). Le corps est lu en entier avant de rendre la Response.
export function fetchVia(url, opts, ip) {
  return new Promise((resolve, reject) => {
    const u = new URL(String(url));
    const mod = u.protocol === 'http:' ? http : https;
    const famille = isIP(ip) || 4;
    const lookup = (_h, o, cb) => (o?.all ? cb(null, [{ address: ip, family: famille }]) : cb(null, ip, famille));
    const req = mod.request(u, {
      method: opts.method || 'GET', headers: opts.headers, lookup, signal: opts.signal,
    }, (res) => {
      const morceaux = [];
      res.on('data', (c) => morceaux.push(c));
      res.on('error', reject);
      res.on('end', () => {
        if (!res.complete) return reject(new Error('réponse tronquée'));
        // Dans un try : une exception ici échapperait à la promesse et tuerait le script.
        try {
          const entetes = new Headers();
          for (const [k, v] of Object.entries(res.headers)) entetes.set(k, [].concat(v).join(', '));
          const sansCorps = [204, 205, 304].includes(res.statusCode);
          resolve(new Response(sansCorps ? null : Buffer.concat(morceaux),
            { status: res.statusCode, headers: entetes }));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// via : adresse IP de secours, ou rien pour la résolution normale.
function essai(url, opts, via) {
  const o = { ...opts, signal: signalDe(opts) };
  return via ? fetchVia(url, o, via) : fetch(url, o);
}

function hote(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return '';
  }
}

function domaine(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return '(URL illisible)';
  }
}

function raisonDe(err) {
  const code = err?.cause?.code || err?.cause?.name || err?.code;
  return code && !String(err.message).includes(code) ? `${err.message} : ${code}` : String(err?.message ?? err);
}

// Serveur de secours seulement si le premier essai n'a pas eu de réponse : un 404
// ou un 503 vient d'un serveur joignable, on le réinterroge normalement. Dans
// lireEssai, une erreur de lecture du corps (coupure, JSON illisible) compte comme
// « sans réponse » : le second essai, unique, reste sous contrôle.
async function annoncer(url, raison, sansReponse) {
  const via = sansReponse ? secours()[hote(url)] : undefined;
  const s = Number(process.env.ESSAI_ATTENTE_S ?? 20);
  console.log(`Raté sur ${domaine(url)} (${raison}) — nouvel essai dans ${s} s` +
    `${via ? ` par le serveur de secours ${via}` : ''}.`);
  if (s > 0) await attendre(s * 1000);
  return via;
}

export async function fetchEssai(url, opts = {}) {
  let raison, sansReponse = false;
  try {
    const res = await essai(url, opts);
    if (res.ok) return res;
    raison = `HTTP ${res.status}`;
    await res.body?.cancel().catch(() => {});
  } catch (err) {
    // Interruption voulue par l'appelant : pas de second essai.
    if (opts.signal?.aborted) throw err;
    raison = raisonDe(err);
    sansReponse = true;
  }
  const via = await annoncer(url, raison, sansReponse);
  return essai(url, opts, via);
}

class ErreurHttp extends Error {}

// lire(res) rend le contenu ; une réponse non ok lève `${etiquette} -> HTTP n`.
export async function lireEssai(url, lire, { etiquette = url, opts = {} } = {}) {
  const une = async (via) => {
    const res = await essai(url, opts, via);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new ErreurHttp(`${etiquette} -> HTTP ${res.status}`);
    }
    return lire(res);
  };
  let via;
  try {
    return await une();
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    via = await annoncer(url, raisonDe(err).replace(`${etiquette} -> `, ''), !(err instanceof ErreurHttp));
  }
  return une(via);
}
