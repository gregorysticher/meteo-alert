// snow-detail.mjs — contexte de la page détail neige (TRMNL, saison neige), demandé par
// Greg le 21.11.2026 : de quoi choisir une journée de ski depuis l'écran.
//
// Tout est décidé ici, rien en Liquid (docs/contrat-trmnl.md). Trois blocs, joints à
// data/neige-ecran.json par snow-forecast-alert.mjs :
//   detailJours : par jour à venir, températures, pluie, isotherme 0 °C, rafales, soleil
//                 et « jour de poudre » (même prévision ICON que l'alerte, à 2022 m) ;
//   mesureStation : hauteur de neige et neige fraîche mesurées à ILI2 (journaux du dépôt) ;
//   avalanche   : bulletin SLF de la région de Les Collines.
// Aucune alerte n'en dépend : une panne laisse le bloc vide et rend le run rouge.

import { readFileSync, existsSync } from 'node:fs';

// ---- jours à venir --------------------------------------------------------------

// Jour de poudre : la neige de la veille (conversion D-005, celle de l'alerte) atteint
// POUDRE_CM, le jour est ensoleillé (POUDRE_SOLEIL_H), peu venté (rafales sous
// POUDRE_RAFALES_KMH à 2022 m) et pas doux (maximum sous POUDRE_TMAX_C : neige qui
// reste sèche). Seuils en variables de dépôt, valeurs par défaut ci-dessous.
export const POUDRE = { cm: 10, soleilH: 4, rafalesKmh: 50, tmaxC: 2 };

// Isotherme 0 °C : le plus haut entre 9h et 16h locales (heures de ski).
const ISO_HEURES = [9, 16];

const nb = (x) => typeof x === 'number' && Number.isFinite(x);
const arr = (x, pas = 1) => (nb(x) ? Math.round(x / pas) * pas : null);

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
    const sol = nb(v('sunshine_duration')) ? v('sunshine_duration') / 3600 : null;
    const raf = v('wind_gusts_10m_max');
    const tx = v('temperature_2m_max');
    const nv = veille(x.d);
    const p = nv != null && nb(sol) && nb(raf) && nb(tx) &&
      nv >= poudre.cm && sol >= poudre.soleilH && raf < poudre.rafalesKmh && tx <= poudre.tmaxC;
    return {
      ...x,
      tn: arr(v('temperature_2m_min')), tx: arr(tx),
      pl: arr(pluie), iso: arr(isoMax.get(x.d), 100), raf: arr(raf), sol: arr(sol),
      p: p ? 1 : 0,
    };
  });
}

// ---- les 48 prochaines heures ----------------------------------------------------

// À partir de l'heure locale en cours (étiquette Open-Meteo = fin de l'heure) : neige
// convertie (D-005, la même que l'alerte), pluie du modèle (rain + showers) et
// température, heure par heure. { de: 'AAAA-MM-JJTHH:00' local de la première valeur,
// cm: [cm au dixième], pl: [mm au dixième], t: [°C entier] } ; null si les heures
// manquent. Une heure absente vaut null, jamais 0.
export const HEURES_DETAIL = 48;
export function heures48(data, maintenantLocal, neigeHoraire, bornes, n = HEURES_DETAIL) {
  const h = data?.hourly ?? {};
  const time = h.time ?? [];
  const debut = time.findIndex((t) => t > maintenantLocal);
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
  return cm.length ? { de: time[debut], cm, pl, t } : null;
}

// ---- mesures à la station --------------------------------------------------------

// HS à la demi-heure (data/neige-hs.csv, écrit par l'alerte neige fraîche) et HN_1D
// (data/neige.csv). Renvoie { h, hs, d24, ta, hn: [{ d, cm }] } ou null.
//   h   : relevé HS le plus récent, epoch UTC en secondes (l'écran le montre en local) ;
//   d24 : HS maintenant − HS 24 h avant (± 1 h), null sans relevé assez ancien ;
//   hn  : les trois derniers HN_1D publiés, du plus ancien au plus récent. Lecture J+1
//         (B4.1) : le HN daté J est la neige tombée de la veille 7h au jour J 7h.
export function mesureStation({ fichierHs = 'data/neige-hs.csv', lignesNeige = [], station = 'ILI2' } = {}) {
  if (!existsSync(fichierHs)) return null;
  const rel = readFileSync(fichierHs, 'utf8').trim().split('\n').slice(1)
    .map((l) => l.trimEnd().split(','))
    .filter(([, s, hs]) => s === station && hs !== '' && nb(+hs))
    .map(([ts, , hs, ta]) => ({ t: Date.parse(ts.replace('Z', ':00Z')), hs: +hs, ta: ta === '' ? null : +ta }))
    .filter((r) => nb(r.t))
    .sort((a, b) => a.t - b.t);
  if (!rel.length) return null;
  const der = rel.at(-1);
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
const SOUS = { minus: '-', neutral: '=', plus: '+' };
const PROBLEMES = {
  new_snow: 'neige fraîche', wind_slab: 'neige soufflée', persistent_weak_layers: 'neige ancienne',
  wet_snow: 'neige mouillée', gliding_snow: 'avalanches de glissement',
  favourable_situation: 'situation favorable', no_distinct_avalanche_problem: 'pas de problème marqué',
};

// json = bulletin CAAML v6 (bulletins[]). Renvoie { niveau, sous, pb, alt, fin } ou null
// si la région n'y est pas. niveau = le plus haut de la journée ; pb = problèmes, sans
// doublon, dans l'ordre du bulletin ; alt = limite basse de l'altitude du premier
// problème (m) ; fin = fin de validité, epoch UTC en secondes.
export function avalanche(json, region = REGION_AVALANCHE) {
  const b = (json?.bulletins ?? []).find((x) => (x.regions ?? []).some((r) => r.regionID === region));
  if (!b) return null;
  let niveau = 0, sous = '';
  for (const r of b.dangerRatings ?? []) {
    const n = NIVEAUX[r.mainValue] ?? 0;
    const s = SOUS[r.customData?.CH?.subdivision] ?? '';
    if (n > niveau || (n === niveau && s === '+')) { niveau = n; sous = s; }
  }
  if (!niveau) return null;
  const pbs = b.avalancheProblems ?? [];
  const pb = [...new Set(pbs.map((p) => PROBLEMES[p.problemType] ?? p.problemType))].slice(0, 2);
  const lb = pbs[0]?.elevation?.lowerBound;
  const fin = Date.parse(b.validTime?.endTime ?? '');
  return {
    niveau, sous: sous === '=' ? '' : sous, pb,
    alt: lb != null && nb(+lb) ? +lb : null,
    fin: nb(fin) ? Math.round(fin / 1000) : null,
  };
}
