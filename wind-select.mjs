// wind-select.mjs — selection des fenetres et du spot recommande.
// Fonctions pures (aucun acces reseau ni fichier) : testees dans test/.
//
// REGLE D'AFFICHAGE (validee le 24/09/2026), appliquee par choisirReco() :
//   1. le spot prioritaire (cfg.spot_prioritaire, le Reposoir) tient le seuil
//      -> lui, ok = true (affiche en inverse) ;
//   2. sinon le premier spot par distance qui tient -> lui, ok = true ;
//   3. aucun ne tient -> la meilleure moyenne sur min_heures dans les
//      creneaux, tous spots confondus, ok = false (affichage normal).
// "Tenir" = fenetre() non nulle : seuil plein, biais corrige, creneaux,
// saison, secteurs, au moins min_heures consecutives.

import { versDate, correction } from './wind-qa.mjs';

export const TZ = 'Europe/Zurich';

// ---- temps ---------------------------------------------------------------

export function local(d) {
  const p = new Intl.DateTimeFormat('fr-CH', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric', hour12: false,
  }).formatToParts(d);
  const v = (t) => p.find((x) => x.type === t).value;
  const jours = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
  const cle = v('weekday').replace('.', '').slice(0, 3).toLowerCase();
  // jourLabel : date seule, pour les titres. Ne jamais la tronquer a la main —
  // "sam. 26.09" fait 10 caracteres, un slice(0,9) coupait le mois.
  const jourLabel = `${v('weekday')} ${v('day')}.${v('month')}`;
  const court = `${v('hour')}:${v('minute')}`;
  return {
    heure: +v('hour'),
    jour: jours[cle],
    jourLabel,
    label: `${jourLabel} ${court}`,
    court,
    iso: `${v('year')}-${v('month')}-${v('day')}`,   // date locale AAAA-MM-JJ
  };
}

export function dansSaison(d, saison) {
  const p = new Intl.DateTimeFormat('fr-CH', {
    timeZone: TZ, day: '2-digit', month: '2-digit',
  }).formatToParts(d);
  const v = (t) => +p.find((x) => x.type === t).value;
  const mmjj = v('month') * 100 + v('day');
  return mmjj >= saison.debut && mmjj <= saison.fin;
}

// ---- selection ------------------------------------------------------------

export const secteurOk = (deg, secteurs) =>
  !secteurs.length || deg === null
    ? !secteurs.length
    : secteurs.some(([a, b]) => deg >= a && deg <= b);

export const moyenne = (f, champ = 'kn') =>
  f.reduce((a, b) => a + b[champ], 0) / f.length;

// Heures exploitables : a venir, en saison, dans un creneau, bon secteur.
// Le seuil n'est PAS ici : fenetre() l'ajoute, meilleure() s'en passe.
function heures(lignes, spot, cfg, biais, maintenant) {
  return lignes.map((l) => {
    const d = versDate(l.date);
    const lead = (d - maintenant) / 36e5;
    const t = local(d);
    const creneau = cfg.creneaux[String(t.jour)];
    const ok =
      lead > 0 &&
      dansSaison(d, cfg.saison) &&
      !!creneau &&
      t.heure >= creneau[0] && t.heure < creneau[1] &&
      secteurOk(l.dir, spot.secteurs);
    return { ...l, t, d, lead, corrige: l.kn + correction(biais, lead), ok };
  });
}

// Plus longue suite d'heures consecutives au-dessus du seuil (>= min_heures).
export function fenetre(lignes, spot, cfg, seuilEff, biais, maintenant) {
  let best = null;
  let run = [];
  for (const h of heures(lignes, spot, cfg, biais, maintenant)) {
    if (h.ok && h.corrige >= seuilEff) {
      run.push(h);
      if (run.length >= cfg.min_heures && (!best || run.length > best.length)) {
        best = [...run];
      }
    } else {
      run = [];
    }
  }
  return best;
}

// Niveau 3 : meilleure moyenne corrigee sur min_heures consecutives
// exploitables, sans condition de seuil. Memes filtres que fenetre().
export function meilleure(lignes, spot, cfg, biais, maintenant) {
  const n = cfg.min_heures;
  let best = null;
  let run = [];
  for (const h of heures(lignes, spot, cfg, biais, maintenant)) {
    if (!h.ok) { run = []; continue; }
    run.push(h);
    if (run.length < n) continue;
    const f = run.slice(-n);
    if (!best || moyenne(f, 'corrige') > moyenne(best, 'corrige')) best = f;
  }
  return best;
}

// classement : [{ spot, lignes, f }] trie par route_min croissante,
// f = fenetre() au seuil plein, biais corrige.
export function choisirReco(classement, cfg, biais, maintenant) {
  const prio = classement.find((c) => c.spot.key === cfg.spot_prioritaire);
  let gagnant = prio?.f ? { c: prio, f: prio.f, ok: true } : null;
  if (!gagnant) {
    const c = classement.find((x) => x.f);
    if (c) gagnant = { c, f: c.f, ok: true };
  }
  if (!gagnant) {
    for (const c of classement) {
      const f = meilleure(c.lignes, c.spot, cfg, biais, maintenant);
      if (f && (!gagnant || moyenne(f, 'corrige') > moyenne(gagnant.f, 'corrige'))) {
        gagnant = { c, f, ok: false };
      }
    }
  }
  if (!gagnant) return null;            // aucune heure exploitable (hors saison)
  const { c, f, ok } = gagnant;
  return {
    n: c.spot.court,
    min: c.spot.route_min,
    j: f[0].t.iso,
    de: f[0].t.court,
    a: f.at(-1).t.court,
    // fin du dernier creneau horaire, epoch UTC en secondes
    fin: Math.round(f.at(-1).d.getTime() / 1000) + 3600,
    kn: +moyenne(f, 'corrige').toFixed(0),
    raf: +Math.max(...f.map((l) => l.rafale)).toFixed(0),
    ok,
  };
}
