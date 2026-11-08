// snow-episodes.mjs — épisodes de neige et décision d'alerte. Fonctions pures
// (aucun accès réseau ni fichier) : testées dans test/snow-episodes.test.mjs.
//
// RÈGLES (spec B4.3, validées le 08/11/2026, précisées après la revue QA) :
//   nouvelle  cumul >= seuil, jamais alerté, et encore `hausse` cm à venir :
//             de la neige déjà tombée n'est pas « annoncée »
//   hausse    cumul >= cumul de la dernière alerte + `hausse`, et autant à venir
//   prolonge  plus de jours que lors de la dernière alerte, et au moins
//             `prolongeMin` cm sur les jours ajoutés à venir : une révision du
//             passé ou une queue de traces n'est pas une prolongation
//   annule    cumul < seuil - `marge`, sauf si au moins `hausse` cm sont déjà
//             tombés (la chute a eu lieu, comme le vent une fois la fenêtre
//             ouverte) ou si le début de l'annonce est sorti de la série (on ne
//             sait plus ce qui est tombé). La marge évite la rafale
//             alerte/annulation autour du seuil
//   decale    annulation et nouvelle dans le même run : un seul message
// Un épisode annulé qui repasse au seuil redevient une « nouvelle ».
//
// Un enregistrement d'état = { debut, fin, total, duree, annule } : les valeurs
// de la DERNIÈRE ALERTE. La plage ne bouge qu'à l'envoi d'une alerte. Le cumul
// courant est la somme des épisodes qui chevauchent cette plage : si la prévision
// scinde l'épisode, ou si une seconde chute arrive dans la plage, tout compte.
//
// Les épisodes viennent d'une série qui inclut les jours passés (past_days) :
// sans eux, le cumul baisserait tout seul à mesure que l'épisode avance.

const JOUR_MS = 864e5;

const versJours = (iso) => Date.parse(`${iso}T00:00:00Z`) / JOUR_MS;

export const duree = (e) => versJours(e.fin) - versJours(e.debut) + 1;

const chevauche = (a, b) => a.debut <= b.fin && b.debut <= a.fin;

const reculer = (iso, jours) =>
  new Date((versJours(iso) - jours) * JOUR_MS).toISOString().slice(0, 10);

// Jours consécutifs avec au moins minJour cm, dans l'ordre chronologique.
export function episodes(dates, neige, { minJour, retenir = () => true }) {
  const out = [];
  let cur = null;
  dates.forEach((d, i) => {
    const v = neige[i];
    const valide = typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (valide && v >= minJour && retenir(d)) {
      if (cur) {
        cur.fin = d;
        cur.total += v;
        cur.jours.push({ d, v });
      } else {
        cur = { debut: d, fin: d, total: v, jours: [{ d, v }] };
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}

// Plusieurs épisodes vus comme un seul : plage et cumul d'ensemble.
function agreger(liste) {
  if (!liste.length) return null;
  return {
    debut: liste[0].debut,
    fin: liste.at(-1).fin,
    total: liste.reduce((a, e) => a + e.total, 0),
    jours: liste.flatMap((e) => e.jours),
  };
}

const aVenir = (e, jour) =>
  (e?.jours ?? []).filter((j) => j.d >= jour).reduce((a, j) => a + j.v, 0);

const reference = (e) => ({
  debut: e.debut,
  fin: e.fin,
  total: Math.round(e.total * 10) / 10,
  duree: duree(e),
  annule: false,
});

// eps : tous les épisodes de la série, y compris ceux déjà finis.
// opts : { jour, seuil, hausse, marge, prolongeMin, memoire, inconnus }
//   memoire  jours de passé dans la série : un épisode reste suivi tant que ses
//            jours y figurent, sinon il reviendrait comme une « nouvelle »
//   inconnus Set des dates sans valeur exploitable : pas d'annulation à l'aveugle
// Renvoie une liste de décisions { type, episode, record, apres } :
//   type    'nouvelle' | 'hausse' | 'prolonge' | 'annule' | 'decale' | null
//   record  état actuel (null pour une nouvelle)
//   apres   état une fois la décision appliquée (null = oublier l'épisode)
// Si l'envoi échoue, l'appelant garde `record` : l'alerte repart au run suivant.
export function decider(eps, records, opts) {
  const { jour, seuil, hausse, marge = 0, prolongeMin = 0, memoire = 0, inconnus = new Set() } = opts;
  const minAVenir = Math.min(hausse, seuil);
  const decisions = [];
  const lies = new Set();

  for (const r of [...records].sort((a, b) => a.debut.localeCompare(b.debut))) {
    const touches = eps.filter((e) => chevauche(e, r));
    // Deux épisodes alertés que la prévision a fusionnés : un seul suivi.
    if (touches.some((e) => lies.has(e))) {
      decisions.push({ type: null, episode: null, record: r, apres: null });
      continue;
    }
    touches.forEach((e) => lies.add(e));
    const c = agreger(touches);
    const venir = aVenir(c, jour);
    const tombe = (c?.jours ?? []).filter((j) => j.d < jour).reduce((a, j) => a + j.v, 0);
    const effondre = (c?.total ?? 0) < seuil - marge;
    const finDeMemoire = r.fin < reculer(jour, memoire);

    let type = null;
    if (r.annule) {
      if (c && c.total >= seuil && venir >= minAVenir) type = 'nouvelle';
    } else if (c && c.total >= r.total + hausse && venir >= hausse) {
      type = 'hausse';
    } else if (c && !effondre && duree(c) > r.duree) {
      const ajoutes = c.jours.filter((j) => j.d >= jour && (j.d < r.debut || j.d > r.fin));
      if (ajoutes.reduce((a, j) => a + j.v, 0) >= prolongeMin && ajoutes.length) type = 'prolonge';
    } else if (effondre && tombe < hausse && r.fin >= jour && r.debut >= reculer(jour, memoire)) {
      const plage = [...inconnus].some((d) => d >= r.debut && d <= r.fin);
      if (!plage) type = 'annule';
    }

    if (type === 'annule') {
      decisions.push({ type, episode: c, record: r, apres: { ...r, annule: true } });
    } else if (type) {
      decisions.push({ type, episode: c, record: r, apres: reference(c) });
    } else {
      decisions.push({ type: null, episode: c, record: r, apres: finDeMemoire ? null : r });
    }
  }

  for (const e of eps) {
    if (lies.has(e) || e.total < seuil || aVenir(e, jour) < minAVenir) continue;
    decisions.push({ type: 'nouvelle', episode: e, record: null, apres: reference(e) });
  }

  // Annonce déplacée sans chevauchement : un seul message plutôt que
  // « Annulé » et « Neige annoncée » ensemble.
  const a = decisions.findIndex((d) => d.type === 'annule');
  const n = decisions.findIndex((d) => d.type === 'nouvelle' && !d.record);
  if (a >= 0 && n >= 0) {
    const fusion = { type: 'decale', episode: decisions[n].episode,
      record: decisions[a].record, apres: decisions[n].apres };
    return [...decisions.filter((_, i) => i !== a && i !== n), fusion];
  }
  return decisions;
}
