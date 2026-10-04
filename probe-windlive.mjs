#!/usr/bin/env node
// probe-windlive.mjs — sonde de decouverte : WindLive expose-t-il des donnees
// exploitables, et couvre-t-il une balise sur le Petit-Lac ?
//
// Pourquoi : le QA montre que Le Reposoir et Le Vengeron sont adosses a GVE
// (aeroport, ~5 km, derriere une colline). C'est le seul angle mort reel du
// systeme. Une balise lacustre corrigerait ca.
//
// Cette sonde ne modifie rien. Elle lit la page, cherche les endpoints appeles
// par l'application, les interroge, et resume ce qui est couvert entre Geneve
// et Nyon. Elle verifie aussi robots.txt et les CGU avant toute idee d'usage.
//
// Lancer : node probe-windlive.mjs   (workflow probe-windlive.yml)

const BASE = 'https://windlive.ch';
const UA = 'Mozilla/5.0 (compatible; leman-wind-probe/1.0; +meteo-alert)';

// Zone d'interet : Petit-Lac, de Geneve a Nyon.
const ZONE = { latMin: 46.18, latMax: 46.42, lonMin: 6.10, lonMax: 6.30 };

async function get(url, json = false) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const txt = await r.text();
  return { ok: r.ok, status: r.status, ctype: r.headers.get('content-type') || '',
    txt, json: json ? safeJson(txt) : null };
}

function safeJson(t) {
  try { return JSON.parse(t); } catch { return null; }
}

function dansZone(lat, lon) {
  return lat >= ZONE.latMin && lat <= ZONE.latMax
    && lon >= ZONE.lonMin && lon <= ZONE.lonMax;
}

/** Cherche recursivement des objets qui ressemblent a des stations. */
function stations(obj, out = [], prof = 0) {
  if (!obj || prof > 6) return out;
  if (Array.isArray(obj)) {
    for (const o of obj) stations(o, out, prof + 1);
    return out;
  }
  if (typeof obj !== 'object') return out;
  const k = Object.keys(obj);
  const lat = obj.lat ?? obj.latitude ?? obj.y;
  const lon = obj.lon ?? obj.lng ?? obj.longitude ?? obj.x;
  if (typeof lat === 'number' && typeof lon === 'number') {
    out.push({ lat, lon, champs: k.join(','), brut: obj });
  }
  for (const v of Object.values(obj)) stations(v, out, prof + 1);
  return out;
}

console.log('# Sonde WindLive\n');

// --- 1. conditions d'usage ------------------------------------------------
console.log('## robots.txt\n');
for (const p of ['/robots.txt', '/terms', '/cgu', '/about']) {
  try {
    const r = await get(BASE + p);
    console.log(`  ${p} -> ${r.status} (${r.ctype.split(';')[0]})`);
    if (p === '/robots.txt' && r.ok) {
      console.log(r.txt.split('\n').slice(0, 20).map((l) => '    ' + l).join('\n'));
    }
  } catch (e) {
    console.log(`  ${p} -> ${e.name}: ${e.message}`);
  }
}

// --- 2. endpoints appeles par la page -------------------------------------
console.log('\n## Endpoints reperes dans la page et ses scripts\n');
const page = await get(BASE + '/');
const scripts = [...page.txt.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
console.log(`  ${scripts.length} script(s) : ${scripts.slice(0, 10).join(', ')}`);

const candidats = new Set();
const motifs = [
  /["'`](\/(?:api|data|stations?|wind|live|feed)[^"'`\s]*)["'`]/g,
  /["'`](https?:\/\/[^"'`\s]*(?:api|station|wind|data)[^"'`\s]*)["'`]/g,
];
function recolte(txt) {
  for (const re of motifs) {
    for (const m of txt.matchAll(re)) candidats.add(m[1]);
  }
}
recolte(page.txt);

for (const s of scripts.slice(0, 12)) {
  const url = s.startsWith('http') ? s : BASE + (s.startsWith('/') ? s : '/' + s);
  try {
    const r = await get(url);
    recolte(r.txt);
    console.log(`  lu ${url.slice(0, 90)} (${r.txt.length} o)`);
  } catch (e) {
    console.log(`  echec ${url.slice(0, 70)} : ${e.message}`);
  }
}

const liste = [...candidats].filter((c) => !/\.(png|jpe?g|svg|css|woff2?)$/i.test(c));
console.log(`\n  ${liste.length} candidat(s) :`);
for (const c of liste.slice(0, 40)) console.log('    ' + c);

// --- 3. interrogation ------------------------------------------------------
console.log('\n## Interrogation des candidats\n');
const testables = liste
  .filter((c) => /api|data|station|wind|live|feed/i.test(c))
  .slice(0, 15);

for (const c of testables) {
  const url = c.startsWith('http') ? c : BASE + (c.startsWith('/') ? c : '/' + c);
  try {
    const r = await get(url, true);
    const taille = r.txt.length;
    console.log(`  ${r.status} ${url.slice(0, 85)} (${taille} o, ${r.ctype.split(';')[0]})`);
    if (!r.json) continue;

    const st = stations(r.json);
    if (!st.length) {
      console.log(`      JSON sans coordonnees. Cles : ` +
        `${Object.keys(r.json).slice(0, 15).join(',')}`);
      continue;
    }
    const proches = st.filter((s) => dansZone(s.lat, s.lon));
    console.log(`      ${st.length} point(s) geolocalise(s), ` +
      `${proches.length} dans la zone Geneve-Nyon`);
    console.log(`      champs : ${st[0].champs}`);
    for (const p of proches.slice(0, 25)) {
      console.log('      * ' + JSON.stringify(p.brut).slice(0, 220));
    }
  } catch (e) {
    console.log(`  ECHEC ${url.slice(0, 70)} : ${e.name}: ${e.message}`);
  }
}

console.log('\nFin de sonde. Aucune donnee ecrite, aucun systeme modifie.');
