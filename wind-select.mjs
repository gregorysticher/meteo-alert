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

// Heures exploitables : dans l'horizon, en saison, dans un creneau, bon
// secteur. Le seuil n'est PAS ici : fenetres() l'ajoute, meilleure() s'en
// passe. Chaque ligne = heure qui commence a sa date.
// passe = true : garde aussi les heures ecoulees des dernieres 24 h, pour
// reconnaitre une fenetre DEJA COMMENCEE sur toute sa longueur (samedi 12:10,
// une fenetre 10-14 h tient toujours, meme s'il ne reste que 2 h).
// passe = false : seulement les heures pas encore finies (lead > -1).
function heures(lignes, spot, cfg, biais, maintenant, passe = false) {
  const horizonH = (cfg.horizon_jours ?? 7) * 24;
  const leadMin = passe ? -24 : -1;
  return lignes.map((l) => {
    const d = versDate(l.date);
    const lead = (d - maintenant) / 36e5;
    const t = local(d);
    const creneau = cfg.creneaux[String(t.jour)];
    const ok =
      lead > leadMin && lead <= horizonH &&
      dansSaison(d, cfg.saison) &&
      !!creneau &&
      t.heure >= creneau[0] && t.heure < creneau[1] &&
      secteurOk(l.dir, spot.secteurs);
    return { ...l, t, d, lead, corrige: l.kn + correction(biais, lead), ok };
  });
}

// Decoupe en suites d'heures qui passent `garde` ET se suivent vraiment
// (une heure absente des donnees coupe la suite).
function suites(hs, garde) {
  const out = [];
  let run = [];
  for (const h of hs) {
    const contigu = run.length && h.d - run.at(-1).d === 36e5;
    if (!garde(h)) { if (run.length) out.push(run); run = []; continue; }
    if (run.length && !contigu) { out.push(run); run = []; }
    run.push(h);
  }
  if (run.length) out.push(run);
  return out;
}

// Toutes les fenetres qui tiennent (suites >= min_heures au-dessus du
// seuil) et ne sont pas FINIES, dans l'ordre chronologique. Une fenetre en
// cours est rendue entiere, heures ecoulees comprises (debut reel).
export function fenetres(lignes, spot, cfg, seuilEff, biais, maintenant) {
  return suites(heures(lignes, spot, cfg, biais, maintenant, true),
    (h) => h.ok && h.corrige >= seuilEff)
    .filter((r) => r.length >= cfg.min_heures && r.at(-1).lead > -1);
}

// La PROCHAINE fenetre qui tient (en cours ou a venir), pas la plus longue :
// un mardi qui tient demain passe devant un dimanche plus long.
export function fenetre(lignes, spot, cfg, seuilEff, biais, maintenant) {
  return fenetres(lignes, spot, cfg, seuilEff, biais, maintenant)[0] ?? null;
}

// Niveau 3 : meilleure moyenne corrigee sur min_heures consecutives
// exploitables, sans condition de seuil. Memes filtres que fenetre(), mais
// sur les heures pas encore finies seulement (passe = false).
export function meilleure(lignes, spot, cfg, biais, maintenant) {
  const n = cfg.min_heures;
  let best = null;
  for (const run of suites(heures(lignes, spot, cfg, biais, maintenant), (h) => h.ok)) {
    for (let i = 0; i + n <= run.length; i++) {
      const f = run.slice(i, i + n);
      if (!best || moyenne(f, 'corrige') > moyenne(best, 'corrige')) best = f;
    }
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

// Etage d'alerte e = { lead_min_h, lead_max_h, marge_kn } : pour chaque spot
// (du plus proche au plus loin), la premiere fenetre dont le debut tombe dans
// la tranche — pas seulement la prochaine : une fenetre demain ne doit pas
// masquer celle de dimanche pour la pre-alerte, ni l'inverse pour la
// confirmation. Fenetre deja commencee (run en retard) : jugee sur sa partie
// A VENIR, qui doit encore faire min_heures ; f garde le debut reel.
// dejaJour(iso) : vrai si cet etage a deja alerte pour ce jour (tous spots
// confondus) — la fenetre est alors sautee et la recherche continue, pour
// qu'une pre-alerte deja partie pour mardi n'empeche pas celle de samedi.
// biais : celui de l'etage (Map vide si correction_biais est faux).
export function choisirAlerte(classement, cfg, e, biais, maintenant, dejaJour = () => false) {
  const seuilEff = cfg.seuil_kn - (e.marge_kn || 0);
  const aVenir = (w) => w.filter((h) => h.lead > 0);
  for (const c of classement) {
    const f = fenetres(c.lignes, c.spot, cfg, seuilEff, biais, maintenant).find((w) => {
      const v = aVenir(w);
      return v.length >= cfg.min_heures &&
        v[0].lead >= e.lead_min_h && v[0].lead <= e.lead_max_h &&
        !dejaJour(w[0].t.iso);
    });
    if (f) return { c, f, lead: aVenir(f)[0].lead };
  }
  return null;
}

// Annulation d'une pre-alerte (spec B7.1) : seulement si AUCUN spot ne tient
// ce jour-la au seuil plein. Sinon la confirmation de l'autre spot suffit :
// recevoir « Annule Reposoir » et « Confirme Cologny » ensemble deroute.
export function jourTient(classement, cfg, biais, maintenant, iso) {
  return classement.some((c) =>
    fenetres(c.lignes, c.spot, cfg, cfg.seuil_kn, biais, maintenant)
      .some((w) => w[0].t.iso === iso));
}

// Ligne « eau » de l'alerte (spec B6, information seule : le gradient ne change
// aucun seuil). Air = moyenne prevue sur la fenetre ; eau = lac maintenant.
export function ligneEau(f, eau) {
  if (eau === null) return null;
  const airs = f.map((h) => h.air).filter(Number.isFinite);
  if (!airs.length) return `Eau ${eau.toFixed(1)}°C`;
  const air = airs.reduce((a, b) => a + b, 0) / airs.length;
  const g = air - eau;
  return `Eau ${eau.toFixed(1)}°C, air ${air.toFixed(1)}°C ` +
    `(air − eau ${g >= 0 ? '+' : ''}${g.toFixed(1)}°C)`;
}

// Anti-spam : une alerte par etage et par JOUR local (key = null : tous
// spots confondus ; key donne : ce spot seulement). Le debut de fenetre
// glisse d'un run a l'autre (heure ecoulee, prevision revue) : un id compare
// a la minute pres renverrait « Aujourd'hui » a chaque run.
// ids : entrees « etage|spot|AAAAMMJJHHMM » (UTC) d'alerted.json.
export function dejaEnvoye(ids, etage, key, iso) {
  return ids.some((i) => {
    const [e, k, debut] = i.split('|');
    return e === etage && (key === null || k === key) && /^\d{12}$/.test(debut ?? '') &&
      local(versDate(debut)).iso === iso;
  });
}
