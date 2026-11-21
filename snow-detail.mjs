// snow-detail.mjs — contexte de la page détail neige (TRMNL, saison neige), demandé par
// Greg le 21.11.2026 : de quoi choisir une journée de ski depuis l'écran.
//
// Tout est décidé ici, rien en Liquid (docs/contrat-trmnl.md). Deux origines :
//   - au run neige annoncée (snow-forecast-alert.mjs), avec la prévision ICON de l'alerte :
//     detailJours (températures, pluie, isotherme 0 °C, rafales, soleil, jour de poudre)
//     et heuresDetail (60 heures, l'écran masque celles déjà passées) ;
//   - à chaque envoi vers TRMNL (wind-alert.mjs, toutes les 4 h), parce qu'elles vieillissent
//     vite : mesureStation (relevés ILI2 des journaux du dépôt) et avalanche (bulletin SLF).
// Aucune alerte n'en dépend : une panne laisse le bloc vide et rend le run rouge.

import { readFileSync, existsSync } from 'node:fs';

const nb = (x) => typeof x === 'number' && Number.isFinite(x);
const arr = (x, pas = 1) => (nb(x) ? Math.round(x / pas) * pas : null);

// ---- jours à venir --------------------------------------------------------------

// Jour de poudre : la neige de la veille (conversion D-005, celle de l'alerte) atteint
// POUDRE_CM, le jour est ensoleillé (POUDRE_SOLEIL_H), peu venté (rafales sous
// POUDRE_RAFALES_KMH à 2022 m) et pas doux (maximum au plus POUDRE_TMAX_C : neige qui
// reste sèche). Jugé sur les valeurs affichées (arrondies), pour que l'écran ne montre
// jamais « 4 h » de soleil sans POUDRE. Seuils en variables de dépôt.
export const POUDRE = { cm: 10, soleilH: 4, rafalesKmh: 50, tmaxC: 2 };

// Isotherme 0 °C : le plus haut entre 9h et 16h locales (heures de ski ; valeur instantanée).
const ISO_HEURES = [9, 16];

// data = réponse Open-Meteo (daily et hourly, heure locale) ; dates/neige = série de
// l'alerte (jours passés compris) ; jours = [{ d, cm }] de ecranNeige. Renvoie les mêmes
// jours, enrichis. Une valeur absente reste null : l'écran affiche « — ».
export function detailJours(data, dates, neige, jours, poudre = POUDRE) {
  const d = data?.daily ?? {};
  const h = data?.hourly ?? {};
  const iD = (jour) => (d.time ?? []).indexOf(jour);
  const isoMax = new Map();
  (h.time ?? []).forEach((t, i) => {
    const heure = +String(t).slice(11, 13);
    const v = h.freezing_level_height?.[i];
    if (heure < ISO_HEURES[0] || heure > ISO_HEURES[1] || !nb(v)) return;
    const j = String(t).slice(0, 10);
    isoMax.set(j, Math.max(isoMax.get(j) ?? -Infinity, v));
  });
  const veille = (jour) => {
    const i = dates.indexOf(jour);
    return i > 0 && nb(neige[i - 1]) ? neige[i - 1] : null;
  };
  return jours.map((x) => {
    const i = iD(x.d);
    const v = (nom) => (i >= 0 ? d[nom]?.[i] : null);
    const pluie = nb(v('rain_sum')) || nb(v('showers_sum'))
      ? (v('rain_sum') ?? 0) + (v('showers_sum') ?? 0) : null;
    const sol = arr(nb(v('sunshine_duration')) ? v('sunshine_duration') / 3600 : null);
    const raf = arr(v('wind_gusts_10m_max'));
    const tx = arr(v('temperature_2m_max'));
    const nv = veille(x.d);
    const p = nv != null && sol != null && raf != null && tx != null &&
      nv >= poudre.cm && sol >= poudre.soleilH && raf < poudre.rafalesKmh && tx <= poudre.tmaxC;
    return {
      ...x,
      tn: arr(v('temperature_2m_min')), tx,
      pl: arr(pluie), iso: arr(isoMax.get(x.d), 100), raf, sol,
      p: p ? 1 : 0,
    };
  });
}

// ---- heure par heure ---------------------------------------------------------------

// HEURES_DETAIL heures à partir de l'heure en cours au moment du run. L'écran masque
// celles déjà finies au moment du rendu et en montre 48 : le fichier n'arrive à l'écran
// qu'au run vent suivant (jusqu'à 4 h plus tard), d'où la marge.
// { h0: début de la première heure, epoch UTC en secondes, cm: [neige convertie D-005, au
// dixième], pl: [pluie du modèle rain + showers, mm au dixième], t: [°C entiers] } ;
// null si les heures manquent. Une heure absente vaut null, jamais 0.
// Étiquette Open-Meteo = fin de l'heure, en heure locale à décalage fixe
// (utc_offset_seconds, le même pour toute la réponse).
export const HEURES_DETAIL = 60;
export function heuresDetail(data, maintenantMs, neigeHoraire, bornes, n = HEURES_DETAIL) {
  const h = data?.hourly ?? {};
  const time = h.time ?? [];
  const decal = nb(data?.utc_offset_seconds) ? data.utc_offset_seconds : null;
  if (decal === null) return null;
  const fin = (t) => Date.parse(`${t}:00Z`) - decal * 1000;   // epoch ms de la fin de l'heure
  const debut = time.findIndex((t) => fin(t) > maintenantMs);
  if (debut < 0) return null;
  const cm = [], pl = [], t = [];
  for (let i = debut; i < debut + n && i < time.length; i++) {
    const p = h.precipitation?.[i], T = h.temperature_2m?.[i];
    const r = (h.rain?.[i] ?? null) === null && (h.showers?.[i] ?? null) === null
      ? null : (h.rain?.[i] ?? 0) + (h.showers?.[i] ?? 0);
    cm.push(nb(p) && nb(T) && p >= 0 ? Math.round(neigeHoraire(p, T, bornes) * 10) / 10 : null);
    pl.push(nb(r) ? Math.round(r * 10) / 10 : null);
    t.push(nb(T) ? Math.round(T) : null);
  }
  return cm.length ? { h0: Math.round(fin(time[debut]) / 1000) - 3600, cm, pl, t } : null;
}

// ---- mesures à la station --------------------------------------------------------

// HS à la demi-heure (data/neige-hs.csv, écrit par l'alerte neige fraîche) et HN_1D
// (data/neige.csv). Renvoie { h, hs, d24, ta, hn: [{ d, cm }] } ou null (pas de relevé,
// ou dernier relevé de plus de AGE_MESURE_H : archive d'une autre saison).
//   h   : relevé HS le plus récent, epoch UTC en secondes (l'écran le montre en local) ;
//   d24 : HS maintenant − HS 24 h avant (± 1 h), null sans relevé assez ancien ;
//   hn  : les trois derniers HN_1D publiés, du plus ancien au plus récent. Lecture J+1
//         (B4.1) : le HN daté J est la neige tombée de la veille 7h au jour J 7h.
export const AGE_MESURE_H = 48;
export function mesureStation({ fichierHs = 'data/neige-hs.csv', lignesNeige = [], station = 'ILI2',
  maintenant = new Date() } = {}) {
  if (!existsSync(fichierHs)) return null;
  const rel = readFileSync(fichierHs, 'utf8').trim().split('\n').slice(1)
    .map((l) => l.trimEnd().split(','))
    .filter(([, s, hs]) => s === station && hs !== '' && nb(+hs))
    .map(([ts, , hs, ta]) => ({ t: Date.parse(ts.replace('Z', ':00Z')), hs: +hs, ta: ta === '' ? null : +ta }))
    .filter((r) => nb(r.t))
    .sort((a, b) => a.t - b.t);
  if (!rel.length) return null;
  const der = rel.at(-1);
  if (maintenant - der.t > AGE_MESURE_H * 36e5) return null;
  const cible = der.t - 864e5;
  const avant = rel.filter((r) => Math.abs(r.t - cible) <= 36e5)
    .sort((a, b) => Math.abs(a.t - cible) - Math.abs(b.t - cible))[0];
  const hn = new Map();
  for (const l of lignesNeige) {
    if (l.source !== 'mesure' || l.station !== station || !nb(l.cm)) continue;
    const x = hn.get(l.jour);
    if (!x || l.run >= x.run) hn.set(l.jour, l);
  }
  const derniers = [...hn.keys()].sort().slice(-3).map((j) => ({ d: j, cm: Math.round(hn.get(j).cm) }));
  return {
    h: Math.round(der.t / 1000),
    hs: Math.round(der.hs),
    d24: avant ? Math.round(der.hs - avant.hs) : null,
    ta: der.ta == null ? null : Math.round(der.ta * 10) / 10,
    hn: derniers,
  };
}

// ---- bulletin d'avalanches -------------------------------------------------------

// Région SLF de Les Collines (ILI2, val d'Illiez), vérifiée le 21.11.2026 dans le
// bulletin CAAML : « CH-1312 Monthey - Val d'Illiez ».
export const REGION_AVALANCHE = 'CH-1312';
export const URL_AVALANCHE = 'https://aws.slf.ch/api/bulletin/caaml/fr/json';
const NIVEAUX = { low: 1, moderate: 2, considerable: 3, high: 4, very_high: 5 };
const NOMS = ['', 'faible', 'limité', 'marqué', 'fort', 'très fort'];
const SOUS = { minus: ['-', 0], neutral: ['', 1], plus: ['+', 2] };
const PROBLEMES = {
  new_snow: 'neige fraîche', wind_slab: 'neige soufflée', persistent_weak_layers: 'neige ancienne',
  wet_snow: 'neige mouillée', gliding_snow: 'avalanches de glissement',
  favourable_situation: 'situation favorable', no_distinct_avalanche_problem: 'pas de problème marqué',
};

// json = bulletin CAAML v6 (bulletins[]). Renvoie :
//   { niveau, sous, nom, pb, debut, fin } : niveau = le plus haut de la journée (sous-degré
//     − < = < +), nom en français, pb = deux problèmes au plus, « dès X m » collé à celui qui
//     a une limite basse d'altitude ; debut / fin = validité, epoch UTC en secondes ;
//   'vide' si le bulletin ne contient aucune région (hors saison, pas de publication) ;
//   null si des bulletins existent mais pas cette région (région renommée : à corriger).
export function avalanche(json, region = REGION_AVALANCHE) {
  const tous = json?.bulletins ?? [];
  if (!tous.length) return 'vide';
  const b = tous.find((x) => (x.regions ?? []).some((r) => r.regionID === region));
  if (!b) return null;
  let niveau = 0, rang = -1, sous = '';
  for (const r of b.dangerRatings ?? []) {
    const n = NIVEAUX[r.mainValue] ?? 0;
    const [s, k] = SOUS[r.customData?.CH?.subdivision] ?? ['', 1];
    if (n > niveau || (n === niveau && k > rang)) { niveau = n; rang = k; sous = s; }
  }
  if (!niveau) return null;
  const pb = [];
  for (const p of b.avalancheProblems ?? []) {
    const nom = PROBLEMES[p.problemType] ?? p.problemType;
    if (pb.some((x) => x.startsWith(nom))) continue;
    const lb = p.elevation?.lowerBound;
    pb.push(lb != null && nb(+lb) ? `${nom} dès ${+lb} m` : nom);
    if (pb.length === 2) break;
  }
  const t = (x) => { const v = Date.parse(x ?? ''); return nb(v) ? Math.round(v / 1000) : null; };
  return { niveau, sous, nom: NOMS[niveau], pb, debut: t(b.validTime?.startTime), fin: t(b.validTime?.endTime) };
}

// Lu à chaque envoi vers TRMNL (wind-alert.mjs). Renvoie { avalanche, erreur } : erreur
// (texte) rend le run rouge ; bulletin vide (hors saison) : avalanche null, sans erreur.
export async function lireAvalanche(fetchEssai) {
  try {
    const res = await fetchEssai(URL_AVALANCHE);
    if (res.status === 404) return { avalanche: null };
    if (!res.ok) return { avalanche: null, erreur: `HTTP ${res.status}` };
    const a = avalanche(await res.json());
    if (a === 'vide') return { avalanche: null };
    if (!a) return { avalanche: null, erreur: `région ${REGION_AVALANCHE} absente du bulletin` };
    return { avalanche: a };
  } catch (err) {
    return { avalanche: null, erreur: err.message };
  }
}
