// snow-verdict.mjs — boucle QA neige : verdict des alertes envoyées (demande D-003,
// décidée par Greg le 15.11.2026). Information seulement : AUCUNE alerte n'en dépend.
//
// data/alertes-neige.csv (écrit par snow-forecast-alert, un message PARTI par ligne ;
// retenu par le silence, raté ou seuil forcé de test : absent)
//   envoye_le   horodatage UTC (AAAA-MM-JJTHH:MMZ)
//   type        nouvelle | hausse | baisse | prolonge | decale | annule
//   debut, fin  plage annoncée par le message ; annulation : celle de l'épisode annulé
//   annonce_cm  cumul annoncé ; annulation : ce qui reste prévu (0 si plus rien)
//   avant_cm    cumul de la dernière alerte (vide pour une nouvelle)
//   echeance_j  jours entre la date locale d'envoi et le premier jour (négatif : en cours)
//   seuil_cm    seuil de l'alerte au moment de l'envoi
//
// data/alertes-neige-qa.csv : recalculé en entier à chaque run de l'alerte neige
// fraîche, à partir des deux journaux. Un verdict peut donc encore bouger deux jours
// après la plage : le SLF révise HN_1D (07.11.2026 : 8,6 cm, puis 11,2 cm le 10.11).
//
// ALIGNEMENT de HN_1D (Décision 2) : tant qu'il n'est pas tranché, chaque verdict est
// calculé selon les deux lectures :
//   J   : la neige tombée le jour J est le HN_1D daté J ;
//   J+1 : la neige tombée le jour J est le HN_1D daté J+1 (HN_1D daté J couvre les
//         24 h qui finissent le matin de J).
// Une fois tranché, ALIGNEMENT vaut 'J' ou 'J+1' et la colonne verdict le reprend.
// Tranché le 21.11.2026 (D-005) : J+1. Aux quatre stations, HN_1D daté J suit la hausse de
// HS de 7h la veille à 7h le jour J (ILI2 20.11 : HN 32,3, HS +29 ; FNH2 13.11 : 12,3 et +13 ;
// GRA2 20.11 : 10,6 et +10). Les deux lectures restent calculées, en information.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { STATION_REFERENCE } from './snow-qa.mjs';

export const ALERTES = 'data/alertes-neige.csv';
export const ALERTES_QA = 'data/alertes-neige-qa.csv';
export const ALIGNEMENT = 'J+1';          // tranché le 21.11.2026 (D-005 ; D-003, Décision 2)
export const OBJECTIF_MESSAGES = 3;       // par épisode, au plus (D-003)

const ENT_ALERTES = 'envoye_le,type,debut,fin,annonce_cm,avant_cm,echeance_j,seuil_cm';
const ENT_QA = 'envoye_le,episode,type,debut,fin,annonce_cm,seuil_cm,' +
  'mesure_j_cm,verdict_j,mesure_j1_cm,verdict_j1,verdict';

const decaler = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const ecartJours = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
const arrondi = (x) => Math.round(x * 10) / 10;

function lireCsv(fichier) {
  if (!existsSync(fichier)) return [];
  const [entete, ...lignes] = readFileSync(fichier, 'utf8').trim().split('\n');
  const cles = entete.trim().split(',');
  return lignes.filter((l) => l.trim()).map((l) => {
    const v = l.trimEnd().split(',');
    return Object.fromEntries(cles.map((c, i) => [c, v[i] ?? '']));
  });
}

// ---- journal des envois ----------------------------------------------------------

// d = décision de snow-episodes.decider() dont le message est parti.
export function ligneEnvoi(d, { jour, seuil, maintenant = new Date() }) {
  const annule = d.type === 'annule';
  const plage = annule ? d.record : d.episode;
  return {
    envoye_le: maintenant.toISOString().slice(0, 16) + 'Z',
    type: d.type,
    debut: plage.debut,
    fin: plage.fin,
    annonce_cm: arrondi(annule ? (d.episode?.total ?? 0) : d.episode.total),
    // Une nouvelle après une annulation a un record (l'épisode annulé) : pas d'« avant ».
    avant_cm: d.record && d.type !== 'nouvelle' ? arrondi(d.record.total) : '',
    echeance_j: ecartJours(plage.debut, jour),
    seuil_cm: seuil,
  };
}

export function journaliserEnvoi(d, opts, fichier = ALERTES) {
  const l = ligneEnvoi(d, opts);
  if (!existsSync(fichier)) {
    mkdirSync('data', { recursive: true });
    appendFileSync(fichier, ENT_ALERTES + '\n');
  }
  appendFileSync(fichier, ENT_ALERTES.split(',').map((c) => l[c]).join(',') + '\n');
  return l;
}

export const lireEnvois = (fichier = ALERTES) => lireCsv(fichier).map((l) => ({
  ...l, annonce_cm: +l.annonce_cm, seuil_cm: +l.seuil_cm,
  avant_cm: l.avant_cm === '' ? null : +l.avant_cm, echeance_j: +l.echeance_j,
}));

// ---- mesures ---------------------------------------------------------------------

// HN_1D d'ILI2 par date ; à date égale, la ligne du run le plus récent l'emporte
// (le SLF révise). lignes = snow-qa.lire().
export function mesuresReference(lignes) {
  const m = new Map();
  for (const l of lignes) {
    if (l.source !== 'mesure' || l.station !== STATION_REFERENCE) continue;
    const p = m.get(l.jour);
    if (!p || l.run >= p.run) m.set(l.jour, l);
  }
  return new Map([...m].map(([j, l]) => [j, l.cm]));
}

// Neige mesurée sur les jours [debut, fin] selon la lecture ('J' ou 'J+1').
// { attente } tant que la plage n'est pas passée (fin ≥ jour), ou si le relevé du
// jour n'est pas encore publié ; { manque } si un relevé plus ancien manque ;
// { cm } sinon.
export function mesurePlage(mesures, debut, fin, lecture, jour) {
  if (fin >= jour) return { attente: true };
  const d = lecture === 'J+1' ? 1 : 0;
  let cm = 0;
  for (let j = decaler(debut, d); j <= decaler(fin, d); j = decaler(j, 1)) {
    if (!mesures.has(j)) return j >= jour ? { attente: true } : { manque: true };
    cm += mesures.get(j);
  }
  return { cm: arrondi(cm) };
}

// ---- verdicts --------------------------------------------------------------------

export function verdict(envoi, mesure, tolerance = 0.3) {
  if (mesure.attente) return 'ATTENTE';
  if (mesure.manque) return '?';
  const m = mesure.cm, a = envoi.annonce_cm, s = envoi.seuil_cm;
  if (envoi.type === 'annule') return m < s ? 'JUSTIFIEE' : 'A_TORT';
  // RATE : annoncé au-dessus du seuil, mesuré dessous. Une baisse peut annoncer un peu
  // moins que le seuil (marge d'annulation) : elle se juge alors à la tolérance.
  if (m < s && a >= s) return 'RATE';
  if (a === 0) return m === 0 ? 'OK' : 'SOUSESTIME';
  if (Math.abs(m - a) / a <= tolerance) return 'OK';
  return m > a ? 'SOUSESTIME' : 'SURESTIME';
}

// Épisode = messages dont les plages se touchent ou se chevauchent (un jour d'écart
// au plus). Un message qui relie deux épisodes les fusionne. Nom : premier jour.
// Une « décalée » ne porte que sa nouvelle plage : l'ancienne n'a pas de verdict.
export function episodes(envois) {
  let groupes = [];
  for (const e of [...envois].sort((a, b) => a.envoye_le.localeCompare(b.envoye_le))) {
    const touche = (x) => e.debut <= decaler(x.fin, 1) && e.fin >= decaler(x.debut, -1);
    const lies = groupes.filter(touche);
    const g = { debut: e.debut, fin: e.fin, messages: [e] };
    for (const x of lies) {
      g.messages.push(...x.messages);
      if (x.debut < g.debut) g.debut = x.debut;
      if (x.fin > g.fin) g.fin = x.fin;
    }
    g.messages.sort((a, b) => a.envoye_le.localeCompare(b.envoye_le));
    groupes = [...groupes.filter((x) => !lies.includes(x)), g];
  }
  return groupes.sort((a, b) => a.messages[0].envoye_le.localeCompare(b.messages[0].envoye_le));
}

export function verdicts(envois, mesures, { jour, tolerance = 0.3, alignement = ALIGNEMENT } = {}) {
  const nom = new Map();
  for (const g of episodes(envois)) for (const m of g.messages) nom.set(m, g.debut);
  return envois.map((e) => {
    const mj = mesurePlage(mesures, e.debut, e.fin, 'J', jour);
    const mj1 = mesurePlage(mesures, e.debut, e.fin, 'J+1', jour);
    const vj = verdict(e, mj, tolerance), vj1 = verdict(e, mj1, tolerance);
    return {
      ...e, episode: nom.get(e),
      mesure_j_cm: mj.cm ?? '', verdict_j: vj, mesure_j1_cm: mj1.cm ?? '', verdict_j1: vj1,
      verdict: alignement === 'J' ? vj : alignement === 'J+1' ? vj1 : '',
    };
  });
}

export function ecrireVerdicts(lignes, fichier = ALERTES_QA) {
  mkdirSync('data', { recursive: true });
  writeFileSync(fichier, [ENT_QA, ...lignes.map((l) => ENT_QA.split(',').map((c) => l[c] ?? '').join(','))]
    .join('\n') + '\n');
}

// ---- biais par échéance : alerte (D-005) contre l'ancien 0,7 fixe (information) ----

// La conversion vit dans snow-conversion.mjs ; réexportée pour les appels existants.
export { rapportTemperature, RAPPORT_FIXE } from './snow-conversion.mjs';

// Prévision ICON la plus récente à l'échéance k pour chaque jour. lignes = snow-qa.lire().
function prevParEcheance(lignes, k, modele = 'icon') {
  const p = new Map();
  for (const l of lignes) {
    if (l.source !== 'prev' || l.modele !== modele || l.echeance_j !== k) continue;
    const x = p.get(l.jour);
    if (!x || l.run >= x.run) p.set(l.jour, l);
  }
  return p;
}

const mesureDuJour = (mesures, j, lecture) => mesures.get(lecture === 'J+1' ? decaler(j, 1) : j);

// Jours retenus : prévu ou mesuré ≥ 1 cm (sinon les jours secs noient l'écart).
// champ : 'cm' = chiffre de l'alerte (conversion D-005 depuis le 21.11.2026, 0,7 fixe
// avant) ; 'cmFixe' = 0,7 fixe d'Open-Meteo, toujours (D-005, surveillance continue).
export function biaisParEcheance(lignes, mesures, { echeances = [1, 2, 3, 4], minCm = 1, champ = 'cm' } = {}) {
  const out = [];
  for (const k of echeances) {
    const p = prevParEcheance(lignes, k);
    for (const lecture of ['J', 'J+1']) {
      const ecarts = [];
      for (const [j, l] of p) {
        const m = mesureDuJour(mesures, j, lecture);
        const v = l[champ];
        if (m == null || !Number.isFinite(v) || (v < minCm && m < minCm)) continue;
        ecarts.push(v - m);
      }
      const n = ecarts.length;
      out.push({ echeance: k, lecture, n,
        biais: n ? arrondi(ecarts.reduce((a, b) => a + b, 0) / n) : null,
        mae: n ? arrondi(ecarts.reduce((a, b) => a + Math.abs(b), 0) / n) : null });
    }
  }
  return out;
}

// ---- ICON contre MeteoSuisse (D-008, Décision 1) ----------------------------------
// Information seulement. Modèles du journal : icon et msl (jour civil), icon7 et msl7
// (fenêtre du relevé 7h → 7h, rangée au jour où elle commence). Les deux se comparent au
// HN_1D daté J+1 (lecture J+1) : pour la fenêtre, c'est exactement la même période ; pour
// le jour civil, la neige de la nuit tombe à cheval sur deux jours (22-23.11.2026).
export const MODELES_COMPARES = ['icon', 'icon7', 'msl', 'msl7'];

// Par jour : prévision à J-k de chaque modèle et mesure J+1. Jours où au moins une
// prévision MeteoSuisse existe, les nJours derniers.
export function comparaisonJours(lignes, mesures, { k = 1, nJours = 10 } = {}) {
  const p = Object.fromEntries(MODELES_COMPARES.map((m) => [m, prevParEcheance(lignes, k, m)]));
  const jours = [...new Set([...p.msl.keys(), ...p.msl7.keys()])].sort().slice(-nJours);
  return jours.map((j) => ({ jour: j,
    ...Object.fromEntries(MODELES_COMPARES.map((m) => [m, p[m].get(j)?.cm ?? null])),
    mesure: mesures.get(decaler(j, 1)) ?? null }));
}

// Par épisode (messages d'alerte, comme les verdicts) : total des fenêtres 7h → 7h prévues à
// J-1 et J-2 par ICON et MeteoSuisse, contre le mesuré sur la plage (lecture J+1). Un total
// partiel (jour sans prévision) le dit : n jours couverts sur la plage.
export function comparaisonEpisodes(envois, lignes, mesures, { jour } = {}) {
  const out = [];
  for (const g of episodes(envois)) {
    const plage = [];
    for (let j = g.debut; j <= g.fin; j = decaler(j, 1)) plage.push(j);
    const prev = {};
    for (const k of [1, 2]) {
      for (const m of ['icon7', 'msl7']) {
        const p = prevParEcheance(lignes, k, m);
        const v = plage.filter((j) => p.has(j)).map((j) => p.get(j).cm);
        prev[`${m}_j${k}`] = { cm: v.length ? arrondi(v.reduce((a, b) => a + b, 0)) : null, n: v.length };
      }
    }
    if (!prev.msl7_j1.n && !prev.msl7_j2.n) continue;   // avant le journal MeteoSuisse
    out.push({ debut: g.debut, fin: g.fin, jours: plage.length, ...prev,
      mesure: mesurePlage(mesures, g.debut, g.fin, 'J+1', jour) });
  }
  return out;
}

// ---- rapport du job (Markdown, comme le QA vent) --------------------------------

const fmt = (x) => (x == null || x === '' ? '—' : String(x));

export function rapport(lignesQa, lignesNeige, mesures, { jour } = {}) {
  const out = ['### QA alertes neige (D-003)', ''];
  if (!lignesQa.length) out.push('Aucune alerte neige envoyée journalisée.');
  else {
    out.push(`Alignement HN_1D : ${ALIGNEMENT ?? 'non tranché, les deux lectures'}.`, '',
      '| envoyé (UTC) | type | plage | annoncé | mesuré J | verdict J | mesuré J+1 | verdict J+1 |',
      '|---|---|---|---|---|---|---|---|');
    for (const l of lignesQa) {
      out.push(`| ${l.envoye_le} | ${l.type} | ${l.debut} → ${l.fin} | ${l.annonce_cm} | ` +
        `${fmt(l.mesure_j_cm)} | ${l.verdict_j} | ${fmt(l.mesure_j1_cm)} | ${l.verdict_j1} |`);
    }
    out.push('', `Messages par épisode (objectif : ${OBJECTIF_MESSAGES} au plus) :`);
    for (const g of episodes(lignesQa)) {
      const n = g.messages.length;
      out.push(`- ${g.debut} → ${g.fin} : ${n} message(s)${n > OBJECTIF_MESSAGES ? ' — au-delà de l\'objectif' : ''}` +
        ` (${g.messages.map((m) => m.type).join(', ')})`);
    }
  }
  out.push('', 'Biais de la prévision ICON par échéance, prévu − mesuré en cm : chiffre de l\'alerte ' +
    '(conversion D-005 depuis le 21.11.2026, 0,7 fixe avant) et 0,7 cm/mm fixe, en information :', '',
    '| échéance | lecture | n | biais alerte | écart alerte | biais 0,7 fixe | écart 0,7 fixe |',
    '|---|---|---|---|---|---|---|');
  const fixe = biaisParEcheance(lignesNeige, mesures, { champ: 'cmFixe' });
  biaisParEcheance(lignesNeige, mesures).forEach((b, i) => {
    out.push(`| J-${b.echeance} | ${b.lecture} | ${b.n} | ${fmt(b.biais)} | ${fmt(b.mae)} | ` +
      `${fmt(fixe[i].biais)} | ${fmt(fixe[i].mae)} |`);
  });
  out.push('', '### ICON contre MeteoSuisse Planachaux (D-008, information)', '',
    'Prévu à J-1 en cm, conversion D-005, par jour civil et par fenêtre du relevé (7h → 7h) ; ' +
    'mesuré = HN_1D d\'ILI2 daté J+1.', '');
  const jours = comparaisonJours(lignesNeige, mesures);
  if (!jours.length) out.push('Pas encore de prévision MeteoSuisse à J-1 au journal.');
  else {
    out.push('| jour | ICON civil | ICON 7h-7h | MeteoSuisse civil | MeteoSuisse 7h-7h | mesuré |',
      '|---|---|---|---|---|---|');
    for (const x of jours) {
      out.push(`| ${x.jour} | ${fmt(x.icon)} | ${fmt(x.icon7)} | ${fmt(x.msl)} | ${fmt(x.msl7)} | ${fmt(x.mesure)} |`);
    }
  }
  const eps = comparaisonEpisodes(lignesQa, lignesNeige, mesures, { jour });
  if (eps.length) {
    const t = (p, n) => (p.cm == null ? '—' : p.n < n ? `${p.cm} (${p.n}/${n} j)` : `${p.cm}`);
    const m = (x) => (x.cm != null ? x.cm : x.attente ? 'attente' : '?');
    out.push('', 'Total par épisode, fenêtres 7h → 7h :', '',
      '| épisode | ICON J-1 | MeteoSuisse J-1 | ICON J-2 | MeteoSuisse J-2 | mesuré |', '|---|---|---|---|---|---|');
    for (const e of eps) {
      out.push(`| ${e.debut} → ${e.fin} | ${t(e.icon7_j1, e.jours)} | ${t(e.msl7_j1, e.jours)} | ` +
        `${t(e.icon7_j2, e.jours)} | ${t(e.msl7_j2, e.jours)} | ${m(e.mesure)} |`);
    }
  }
  return out.join('\n');
}
