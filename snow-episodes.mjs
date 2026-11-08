// snow-episodes.mjs — épisodes de neige et décision d'alerte. Fonctions pures
// (aucun accès réseau ni fichier) : testées dans test/snow-episodes.test.mjs.
//
// RÈGLES (spec B4.3, validées le 08/11/2026) :
//   nouvelle  épisode >= seuil jamais alerté, pas encore fini
//   hausse    cumul >= cumul de la dernière alerte + `hausse` cm
//   prolonge  épisode plus long (en jours) que lors de la dernière alerte
//   annule    un épisode alerté repasse sous le seuil avant sa fin
// Un épisode annulé qui repasse au-dessus du seuil redevient une « nouvelle ».
//
// Un enregistrement d'état = { debut, fin, total, duree, annule } :
//   debut/fin    plage suivie, élargie à chaque run : elle ne rétrécit jamais,
//                pour reconnaître l'épisode si la prévision le scinde ou le décale ;
//   total/duree  valeurs de la DERNIÈRE ALERTE, référence des règles ci-dessus.
//
// Les épisodes viennent d'une série qui inclut les jours passés (past_days) :
// sans eux, le cumul baisserait tout seul à mesure que l'épisode avance et
// déclencherait de fausses annulations.

const JOUR_MS = 864e5;

export const duree = (e) =>
  Math.round((Date.parse(`${e.fin}T00:00:00Z`) - Date.parse(`${e.debut}T00:00:00Z`)) / JOUR_MS) + 1;

const chevauche = (a, b) => a.debut <= b.fin && b.debut <= a.fin;

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

const reference = (e, base = {}) => ({
  debut: base.debut && base.debut < e.debut ? base.debut : e.debut,
  fin: base.fin && base.fin > e.fin ? base.fin : e.fin,
  total: Math.round(e.total * 10) / 10,
  duree: duree(e),
  annule: false,
});

// eps : tous les épisodes de la série, y compris ceux déjà finis.
// Renvoie une liste de décisions { type, episode, record, apres } :
//   type    'nouvelle' | 'hausse' | 'prolonge' | 'annule' | null (rien à envoyer)
//   record  état actuel (null pour une nouvelle)
//   apres   état une fois la décision appliquée (null = oublier l'épisode)
// Si l'envoi échoue, l'appelant garde `record` : l'alerte repart au run suivant.
export function decider(eps, records, { jour, seuil, hausse }) {
  const decisions = [];
  const lies = new Set();
  const principaux = new Set();

  for (const r of [...records].sort((a, b) => a.debut.localeCompare(b.debut))) {
    const candidats = eps.filter((e) => chevauche(e, r));
    candidats.forEach((e) => lies.add(e));
    const c = candidats.reduce((m, e) => (!m || e.total > m.total ? e : m), null);

    if (!c || c.total < seuil) {
      if (r.fin < jour) decisions.push({ type: null, episode: c, record: r, apres: null });
      else if (r.annule) decisions.push({ type: null, episode: c, record: r, apres: r });
      else decisions.push({ type: 'annule', episode: c, record: r, apres: { ...r, annule: true } });
      continue;
    }

    // Deux épisodes alertés que la prévision a fusionnés : un seul suivi.
    if (principaux.has(c)) {
      decisions.push({ type: null, episode: c, record: r, apres: null });
      continue;
    }
    principaux.add(c);

    const elargi = {
      ...r,
      debut: c.debut < r.debut ? c.debut : r.debut,
      fin: c.fin > r.fin ? c.fin : r.fin,
    };
    if (c.fin < jour) {
      // Épisode tombé et fini : plus rien à annoncer, jamais d'annulation.
      decisions.push({ type: null, episode: c, record: r, apres: elargi.fin < jour ? null : elargi });
    } else if (r.annule) {
      decisions.push({ type: 'nouvelle', episode: c, record: r, apres: reference(c, r) });
    } else if (c.total >= r.total + hausse) {
      decisions.push({ type: 'hausse', episode: c, record: r, apres: reference(c, r) });
    } else if (duree(c) > r.duree) {
      decisions.push({ type: 'prolonge', episode: c, record: r, apres: reference(c, r) });
    } else {
      decisions.push({ type: null, episode: c, record: r, apres: elargi });
    }
  }

  for (const e of eps) {
    if (lies.has(e) || e.total < seuil || e.fin < jour) continue;
    decisions.push({ type: 'nouvelle', episode: e, record: null, apres: reference(e) });
  }
  return decisions;
}
