// snow-qa.mjs — journal neige prévision / mesure (Les Collines).
//
// But : suivre l'écart entre la chute PRÉVUE (Open-Meteo, alerte annoncée) et
// la neige fraîche MESURÉE (SLF HN_1D, alerte neige fraîche). Données brutes
// seulement : aucune alerte n'en dépend.
//
// data/neige.csv : run,source,jour,cm,echeance_j,modele,mm,pluie_mm,t_moy,station,hs
//   run        horodatage UTC du run (AAAA-MM-JJTHH:MMZ)
//   source     prev (snowfall_sum du jour) | mesure (HN_1D du relevé)
//   jour       date locale AAAA-MM-JJ
//   cm         valeur en cm
//   echeance_j prev : jours entre la date du run et le jour prévu (0 = jour
//              même) ; mesure : vide
//   modele     prev : icon (celui de l'alerte) | long (plugin écran, 16 jours)
//   mm, pluie_mm, t_moy  prev : précipitations, part de pluie, température moyenne.
//              Open-Meteo calcule snowfall = (mm - pluie) x 0,7 : rapport FIXE, vérifié
//              le 08/11/2026. Ces colonnes permettront de tester un rapport selon la
//              température.
//   station, hs  mesure : station IMIS et hauteur au sol. Plusieurs stations voisines,
//              pour séparer l'erreur du modèle de la dispersion spatiale.
// AUCUNE alerte n'en dépend (spec : ne pas corriger avant d'avoir de quoi le faire).
//
// ALIGNEMENT (non tranché, voir docs/spec) : HN_1D daté J couvre a priori les
// 24 h qui finissent le matin de J, soit surtout la neige tombée la veille.
// Le rapport montre donc la mesure datée J ET celle datée J+1 en face de la
// prévision du jour J, sans choisir.

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';

export const FICHIER = 'data/neige.csv';
const ENTETE = 'run,source,jour,cm,echeance_j,modele,mm,pluie_mm,t_moy,station,hs';
export const STATION_REFERENCE = 'ILI2';

const runId = (d = new Date()) => d.toISOString().slice(0, 16) + 'Z';
const ecartJours = (a, b) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);

export function lire(fichier = FICHIER) {
  if (!existsSync(fichier)) return [];
  return readFileSync(fichier, 'utf8').trim().split('\n').slice(1)
    .filter(Boolean)
    .map((l) => {
      const [run, source, jour, cm, ech, modele, , , , station] = l.trimEnd().split(',');
      return { run, source, jour, cm: +cm, echeance_j: ech === '' ? null : +ech,
        modele: modele || (source === 'prev' ? 'icon' : ''),
        station: station || (source === 'mesure' ? STATION_REFERENCE : '') };
    });
}

function ajouter(lignes, fichier) {
  if (!lignes.length) return 0;
  if (!existsSync(fichier)) {
    mkdirSync('data', { recursive: true });
    appendFileSync(fichier, ENTETE + '\n');
  }
  appendFileSync(fichier, lignes.map((l) => l.join(',')).join('\n') + '\n');
  return lignes.length;
}

// jourRun = date locale du run ; dates/neige = séries daily d'Open-Meteo.
// annexes : séries facultatives { mm, pluie, tMoy }, de même longueur que dates.
export function journaliserPrevision(jourRun, dates, neige, {
  fichier = FICHIER, maintenant = new Date(), modele = 'icon', annexes = {},
} = {}) {
  const run = runId(maintenant);
  const lignes = [];
  dates.forEach((d, i) => {
    const v = neige[i];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      const a = (serie) => serie?.[i] ?? '';
      lignes.push([run, 'prev', d, v, ecartJours(d, jourRun), modele,
        a(annexes.mm), a(annexes.pluie), a(annexes.tMoy), '', '']);
    }
  });
  return ajouter(lignes, fichier);
}

// mesures = [{ jour, cm, station, hs }]. Une mesure déjà journalisée avec la même
// valeur n'est pas réécrite (le SLF renvoie 3 jours à chaque run).
export function journaliserMesures(mesures, { fichier = FICHIER, maintenant = new Date() } = {}) {
  const deja = new Map();
  for (const l of lire(fichier)) if (l.source === 'mesure') deja.set(`${l.station}|${l.jour}`, l.cm);
  const run = runId(maintenant);
  const lignes = mesures
    .filter((m) => typeof m.cm === 'number' && Number.isFinite(m.cm) && m.cm >= 0)
    .filter((m) => deja.get(`${m.station ?? STATION_REFERENCE}|${m.jour}`) !== m.cm)
    .map((m) => [run, 'mesure', m.jour, m.cm, '', '', '', '', '',
      m.station ?? STATION_REFERENCE, m.hs ?? '']);
  return ajouter(lignes, fichier);
}

// Pour chaque jour J ayant une prévision émise la veille (echeance_j = 1, la
// plus récente) : prévu J, mesuré daté J, mesuré daté J+1. À run égal, la
// dernière ligne du fichier (écrite en dernier) l'emporte.
export function rapport(lignes, nJours = 10) {
  const prevVeille = new Map();
  const mesure = new Map();
  for (const l of lignes) {
    if (l.source === 'prev' && l.modele === 'icon' && l.echeance_j === 1) {
      const p = prevVeille.get(l.jour);
      if (!p || l.run >= p.run) prevVeille.set(l.jour, l);
    }
    if (l.source === 'mesure' && l.station === STATION_REFERENCE) {
      const m = mesure.get(l.jour);
      if (!m || l.run >= m.run) mesure.set(l.jour, l);
    }
  }
  const jours = [...prevVeille.keys()].sort().slice(-nJours);
  if (!jours.length) return 'Journal neige : pas encore de prévision à J-1.';
  const lendemain = (j) => new Date(Date.parse(`${j}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const f = (x) => (x == null ? '—' : x.cm.toFixed(1));
  const out = ['Journal neige (cm) — prévu à J-1 | mesuré daté J | mesuré daté J+1'];
  for (const j of jours) {
    out.push(`  ${j}  ${f(prevVeille.get(j))} | ${f(mesure.get(j))} | ${f(mesure.get(lendemain(j)))}`);
  }
  return out.join('\n');
}
