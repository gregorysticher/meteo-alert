// snow-episodes.mjs — épisodes de neige et décision d'alerte. Fonctions pures
// (aucun accès réseau ni fichier) : testées dans test/snow-episodes.test.mjs.
//
// RÈGLES (spec B4.3, validées le 08/11/2026, précisées après la revue QA) :
//   nouvelle  cumul >= seuil, jamais alerté, et encore `hausse` cm à venir :
//             de la neige déjà tombée n'est pas « annoncée ». Cumul et « à venir »
//             comptés SANS le dernier jour de l'horizon du modèle (`horizon`, D-002) :
//             le 12/11/2026, 56,6 cm sur 64 tombaient à J+4 et ont oscillé de 9,8 à
//             37,3 cm ensuite. Depuis D-004 (Greg 2026-11-15), hausse, baisse et
//             prolongation d'un épisode alerté aussi ; seule l'annulation garde le cumul
//             complet. Message et écran montrent toujours le cumul complet
//   hausse    cumul >= cumul de la dernière alerte + pas, et `hausse` cm à venir ;
//             pas = max(`hausse`, `hausseRel` × cumul de la dernière alerte)
//             (D-001, Greg 2026-11-14 : 28 → 37 → 44 → 59 cm donnait 3 « hausse »,
//             2 avec un pas de 30 %). Les autres emplois de `hausse` (à venir, neige
//             tombée qui bloque l'annulation) restent absolus
//   baisse    cumul <= cumul de la dernière alerte - pas (même pas que la hausse,
//             D-002), épisode pas fini, au-dessus du seuil d'annulation
//   prolonge  plus de jours que lors de la dernière alerte, et au moins
//             `prolongeMin` cm sur les jours ajoutés à venir : une révision du
//             passé ou une queue de traces n'est pas une prolongation
//   annule    cumul < seuil - `marge`, sauf si au moins `hausse` cm sont déjà
//             tombés (la chute a eu lieu, comme le vent une fois la fenêtre
//             ouverte) ou si le début de l'annonce est sorti de la série (on ne
//             sait plus ce qui est tombé). La marge évite la rafale
//             alerte/annulation autour du seuil
//   decale    annulation et nouvelle dans le même run : un seul message
// Priorité pour un épisode suivi (D-002) : annulation, puis baisse, puis hausse, puis
// prolongation. Une baisse avec changement de plage est une « baisse » : le 13/11,
// 64 → 28 cm sur 3 jours était parti en « prolongé » et taisait la perte.
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

const somme = (jours) => jours.reduce((a, j) => a + j.v, 0);
const arrondi = (x) => Math.round(x * 10) / 10;

// `horizon` et `cmHorizon` (D-004) : dernier jour de la série au moment de l'alerte et
// neige de l'épisode ce jour-là. Un run du même jour retire cette valeur de la référence,
// pour comparer les mêmes jours.
const reference = (e, horizon) => ({
  debut: e.debut,
  fin: e.fin,
  total: arrondi(e.total),
  duree: duree(e),
  annule: false,
  ...(horizon ? { horizon, cmHorizon: arrondi(somme(e.jours.filter((j) => j.d === horizon))) } : {}),
});

// eps : tous les épisodes de la série, y compris ceux déjà finis.
// opts : { jour, seuil, hausse, hausseRel, marge, prolongeMin, memoire, inconnus, horizon }
//   hausseRel fraction du cumul de la dernière alerte (0,3 = 30 %), 0 = pas absolu
//   horizon   dernier jour de la série du modèle (AAAA-MM-JJ) : exclu des décisions,
//            sauf de l'annulation (D-002, D-004)
//   memoire  jours de passé dans la série : un épisode reste suivi tant que ses
//            jours y figurent, sinon il reviendrait comme une « nouvelle »
//   inconnus Set des dates sans valeur exploitable : pas d'annulation à l'aveugle
// Renvoie une liste de décisions { type, episode, record, apres } :
//   type    'nouvelle' | 'hausse' | 'prolonge' | 'annule' | 'decale' | null
//   record  état actuel (null pour une nouvelle)
//   apres   état une fois la décision appliquée (null = oublier l'épisode)
// Si l'envoi échoue, l'appelant garde `record` : l'alerte repart au run suivant.
export function decider(eps, records, opts) {
  const { jour, seuil, hausse, hausseRel = 0, marge = 0, prolongeMin = 0, memoire = 0,
    inconnus = new Set(), horizon } = opts;
  const minAVenir = Math.min(hausse, seuil);
  // Une nouvelle se juge sans le dernier jour de l'horizon.
  const sansHorizon = (e) => {
    const jours = (e?.jours ?? []).filter((j) => j.d !== horizon);
    return { total: jours.reduce((a, j) => a + j.v, 0), venir: aVenir({ jours }, jour) };
  };
  const nouvelleOk = (e) => {
    const s = sansHorizon(e);
    return s.total >= seuil && s.venir >= minAVenir;
  };
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
    const tombe = (c?.jours ?? []).filter((j) => j.d < jour).reduce((a, j) => a + j.v, 0);
    const effondre = (c?.total ?? 0) < seuil - marge;
    const finDeMemoire = r.fin < reculer(jour, memoire);
    const pas = Math.max(hausse, hausseRel * r.total);
    // Ni annulation ni baisse à l'aveugle : épisode en cours, début encore dans la série,
    // aucune valeur inconnue sur la plage annoncée.
    const jugeable = r.fin >= jour && r.debut >= reculer(jour, memoire) &&
      ![...inconnus].some((d) => d >= r.debut && d <= r.fin);
    // D-004 : hausse, baisse et prolongation se jugent sans le dernier jour de l'horizon,
    // contre la dernière alerte sur les mêmes jours (même horizon, runs du même jour : sa
    // valeur de ce jour-là est retirée). Le changement doit aussi se voir dans le cumul
    // complet, celui du message : jamais « revue à la baisse 85 cm (89 cm…) ». Seule
    // l'annulation garde le cumul complet seul.
    const sJours = (c?.jours ?? []).filter((j) => j.d !== horizon);
    const sTotal = somme(sJours);
    const sVenir = somme(sJours.filter((j) => j.d >= jour));
    const base = r.total - (horizon && r.horizon === horizon ? r.cmHorizon ?? 0 : 0);
    const sDuree = sJours.length ? duree({ debut: sJours[0].d, fin: sJours.at(-1).d }) : 0;
    // Même horizon et plage finissant ce jour-là : la durée de référence l'exclut aussi.
    const rDuree = r.duree - (horizon && r.horizon === horizon && r.fin === horizon ? 1 : 0);

    let type = null;
    if (r.annule) {
      if (c && nouvelleOk(c)) type = 'nouvelle';
    } else if (effondre && tombe < hausse && jugeable) {
      type = 'annule';
    } else if (c && !effondre && jugeable && sTotal <= base - pas && c.total <= r.total - pas) {
      type = 'baisse';
    } else if (c && sTotal >= base + pas && c.total >= r.total + pas && sVenir >= hausse) {
      type = 'hausse';
    } else if (c && !effondre && sTotal > base - pas && c.total > r.total - pas &&
        sDuree > rDuree) {
      // Une forte baisse n'est jamais une « prolongation », même quand une valeur
      // inconnue empêche de la notifier comme baisse.
      const ajoutes = sJours.filter((j) => j.d >= jour && (j.d < r.debut || j.d > r.fin));
      if (somme(ajoutes) >= prolongeMin && ajoutes.length) type = 'prolonge';
    }

    if (type === 'annule') {
      decisions.push({ type, episode: c, record: r, apres: { ...r, annule: true } });
    } else if (type) {
      decisions.push({ type, episode: c, record: r, apres: reference(c, horizon) });
    } else {
      decisions.push({ type: null, episode: c, record: r, apres: finDeMemoire ? null : r });
    }
  }

  for (const e of eps) {
    if (lies.has(e) || !nouvelleOk(e)) continue;
    decisions.push({ type: 'nouvelle', episode: e, record: null, apres: reference(e, horizon) });
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

// Ligne neige de l'écran (spec B4.2), dérivée des décisions de l'alerte : un épisode
// alerté ou encore suivi est montré avec le cumul que voit l'alerte (somme des
// épisodes qui chevauchent l'annonce). Inversé si le cumul atteint le seuil. Entre deux
// alertes, c'est la valeur courante de la prévision, qui peut bouger sans message.
// `episodes` : tous les épisodes ouverts, par ordre de priorité, car l'écran prend le
// premier pas encore fini au moment du rendu : au seuil avec de la neige à venir, puis au
// seuil, puis les autres ; à rang égal, le plus proche. `jours` : la série du run, lue
// selon la date du rendu.
export function ecranNeige(eps, dates, neige, decisions, opts) {
  const { jour, seuil, hausse, minAffichage, retenir = () => true } = opts;
  const minAVenir = Math.min(hausse, seuil);
  const suivis = decisions.filter((d) =>
    d.episode && d.episode.fin >= jour && d.apres && !d.apres.annule);
  const candidats = suivis.map((d) => ({ e: d.episode, ok: d.episode.total >= seuil }));
  const rang = (c) => (c.ok ? (aVenir(c.e, jour) >= minAffichage ? 0 : 1) : 2);
  for (const e of eps) {
    if (e.fin < jour || suivis.some((d) => chevauche(e, d.episode))) continue;
    const venir = aVenir(e, jour);
    if (e.total >= seuil && venir >= minAVenir) candidats.push({ e, ok: true });
    else if (venir >= minAffichage) candidats.push({ e, ok: false });
  }
  candidats.sort((a, b) => rang(a) - rang(b) || a.e.debut.localeCompare(b.e.debut));
  const episodes = candidats.map((c) =>
    ({ cm: Math.round(c.e.total), de: c.e.debut, a: c.e.fin, ok: c.ok }));

  const valeur = (i) => (typeof neige[i] === 'number' && Number.isFinite(neige[i]) ? neige[i] : 0);
  const jours = dates.flatMap((d, i) =>
    (d >= jour && retenir(d) ? [{ d, cm: Math.round(valeur(i) * 10) / 10 }] : []));
  const j5 = jours.reduce((a, x) => a + x.cm, 0);
  return {
    jour,
    min: minAffichage,
    j0: Math.round(valeur(dates.indexOf(jour))),
    j5: Math.round(j5),
    jours,
    episodes,
    episode: episodes[0] ?? null,
  };
}
