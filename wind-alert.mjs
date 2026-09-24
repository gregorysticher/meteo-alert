// wind-alert.mjs — alerte wingfoil multi-spots sur le Leman.
// Source: MeteoSwiss (mesures + previsions locales) / Eawag Alplakes.
//
// SELECTION : le spot le plus PROCHE qui tient le seuil, pas le plus vente.
//
// ALERTES EN 3 ETAGES CONTIGUS (aucune fenetre ne passe entre deux tranches) :
//   pre   34 a 168 h  "Potentiel"   seuil abaisse — signal, pas promesse
//   conf   9 a  34 h  "Confirme"    seuil plein
//   jour 0.5 a   9 h  "Aujourd'hui" rappel
// Plus une annulation si une pre-alerte tombe a l'eau.
//
// CORRECTION DE BIAIS : le QA mesure que la prevision sous-estime le vent,
// d'autant plus que l'echeance est longue (~ -2 kn a J-5). On remonte donc la
// prevision du biais mesure a cette echeance avant de comparer au seuil.
//
// DECLENCHEMENT : a CHAQUE run. Les crons planifies de GitHub derivent de
// plusieurs heures (le 22/09 le run de 05:00 UTC a tourne a 09:34). Les etages
// sont donc bornes par l'echeance, jamais par l'heure du run.
//
// MODE TEST : SEUIL_TEST=<kn> abaisse le seuil, prefixe les titres par [TEST],
// et n'ecrit NI alerted.json NI le journal des alertes — un test ne doit
// polluer ni l'anti-spam ni les statistiques de qualite.

import { readFile, writeFile } from 'node:fs/promises';
import { notifier, sortieSiEchecs } from './notify.mjs';
import { previsions, mesures, tempLac } from './wind-sources.mjs';
import {
  archiver, apparier, rapport, versDate, versCle,
  journaliserMesures, journaliserAlerte, evaluerAlertes, rapportAlertes,
  biaisParEcheance, correction,
} from './wind-qa.mjs';

const CONFIG = 'wind/spots.json';
const VUS = 'alerted.json';
const DRY_RUN = process.env.DRY_RUN === '1';
const QA_ONLY = process.env.QA_ONLY === '1';
const SEUIL_TEST = parseFloat(process.env.SEUIL_TEST || '');
const TEST = Number.isFinite(SEUIL_TEST);
const TOPIC = process.env.NTFY_TOPIC_VENT;
const TRMNL = process.env.TRMNL_WEBHOOK_URL;
const TZ = 'Europe/Zurich';

// ---- temps ---------------------------------------------------------------

function local(d) {
  const p = new Intl.DateTimeFormat('fr-CH', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', hour12: false,
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
  };
}

function dansSaison(d, saison) {
  const p = new Intl.DateTimeFormat('fr-CH', {
    timeZone: TZ, day: '2-digit', month: '2-digit',
  }).formatToParts(d);
  const v = (t) => +p.find((x) => x.type === t).value;
  const mmjj = v('month') * 100 + v('day');
  return mmjj >= saison.debut && mmjj <= saison.fin;
}

// ---- selection ------------------------------------------------------------

const secteurOk = (deg, secteurs) =>
  !secteurs.length || deg === null
    ? !secteurs.length
    : secteurs.some(([a, b]) => deg >= a && deg <= b);

function fenetre(lignes, spot, cfg, seuilEff, biais, maintenant) {
  let best = null;
  let run = [];
  for (const l of lignes) {
    const d = versDate(l.date);
    const lead = (d - maintenant) / 36e5;
    const t = local(d);
    const creneau = cfg.creneaux[String(t.jour)];
    const kn = l.kn + correction(biais, lead);
    const ok =
      lead > 0 &&
      dansSaison(d, cfg.saison) &&
      creneau &&
      t.heure >= creneau[0] && t.heure < creneau[1] &&
      kn >= seuilEff &&
      secteurOk(l.dir, spot.secteurs);
    if (ok) {
      run.push({ ...l, t, d, lead, corrige: kn });
      if (run.length >= cfg.min_heures && (!best || run.length > best.length)) {
        best = [...run];
      }
    } else {
      run = [];
    }
  }
  return best;
}

const moyenne = (f, champ = 'kn') =>
  f.reduce((a, b) => a + b[champ], 0) / f.length;

// ---- message --------------------------------------------------------------

function message(etage, spot, f, cfg, eau, autres) {
  const moy = moyenne(f, 'corrige');
  const brut = moyenne(f);
  const raf = Math.max(...f.map((l) => l.rafale));
  const q10 = Math.min(...f.map((l) => l.q10));
  const dir = Math.round(f[0].dir ?? 0);
  const lead = Math.round(f[0].lead);

  const lignes = [];
  if (TEST) {
    lignes.push(`Test d'acheminement — seuil abaisse a ${cfg.seuil_kn} kn.`,
      'Donnees reelles, mais ce n\'est pas une vraie alerte.', '');
  }
  lignes.push(`${f[0].t.label} → ${f[f.length - 1].t.court}`);
  if (etage === 'pre') {
    lignes.push(lead >= 48
      ? `Dans ${Math.round(lead / 24)} j — a confirmer`
      : 'A confirmer');
  }
  // Une decimale des qu'on montre brut et corrige cote a cote : arrondis a
  // l'entier, les deux valeurs se confondaient ("4 kn (brut 4, corrige)").
  const ecart = Math.abs(moy - brut);
  lignes.push(ecart >= 0.5
    ? `${moy.toFixed(1)} kn moy (brut ${brut.toFixed(1)}, ` +
      `corrige du biais), rafales ${raf.toFixed(0)} kn, ${dir}°`
    : `${moy.toFixed(0)} kn moy, rafales ${raf.toFixed(0)} kn, ${dir}°`);
  if (etage !== 'pre') lignes.push(`Scenario bas : ${q10.toFixed(0)} kn`);
  lignes.push(`${spot.route_min} min de route — le plus proche qui tient`);

  const ratio = moy ? raf / moy : 0;
  if (ratio > cfg.ratio_rafale_max) {
    lignes.push(`⚠ rafales ×${ratio.toFixed(1)} — mauvais pour le jibe`);
  }
  if (eau !== null) lignes.push(`Eau ${eau.toFixed(1)}°C`);

  const c = spot.club;
  if (c) {
    const offres = [c.wing && 'wing', c.tracte && 'tracté',
      c.assiste && 'assisté'].filter(Boolean);
    lignes.push(`${c.nom}${c.tel ? ' — ' + c.tel : ''} (${offres.join('/')})`);
    if (c.vent_min_kn && moy < c.vent_min_kn) {
      lignes.push(`  sous leur seuil wing (${c.vent_min_kn} kn)`);
    }
  }
  lignes.push(spot.maps);
  if (autres.length) {
    lignes.push('Plus loin : ' + autres
      .map((a) => `${a.court} ${a.pic} kn (${a.spot.route_min}′)`).join(', '));
  }
  return lignes.join('\n');
}

// ---- sortie TRMNL ---------------------------------------------------------

async function versTrmnl(classement, cfg, emission) {
  if (!TRMNL) return 'pas de TRMNL_WEBHOOK_URL';
  if (TEST) return 'TEST : webhook TRMNL non touche';
  const spots = classement.slice(0, 6).map(({ spot, f, mesure }) => ({
    n: spot.court, min: spot.route_min,
    now: mesure?.kn != null ? +mesure.kn.toFixed(0) : null,
    d: mesure?.dir != null ? Math.round(mesure.dir) : null,
    de: f ? f[0].t.court : null,
    a: f ? f[f.length - 1].t.court : null,
    kn: f ? +moyenne(f).toFixed(0) : null,
    raf: f ? +Math.max(...f.map((l) => l.rafale)).toFixed(0) : null,
    e: f ? 2 : null,
  }));
  const corps = JSON.stringify({
    merge_variables: { maj: emission, seuil: cfg.seuil_kn, spots },
  });
  if (corps.length > 5000) return `payload ${corps.length} o > 5000, non envoye`;
  if (DRY_RUN) return `DRY_RUN — ${corps.length} o prets`;
  const res = await fetch(TRMNL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: corps,
  });
  return `TRMNL HTTP ${res.status} (${corps.length} o)`;
}

// ---- anti-spam ------------------------------------------------------------

async function lireVus() {
  try {
    const j = JSON.parse(await readFile(VUS, 'utf8'));
    return Array.isArray(j) ? { forme: 'array', ids: j }
      : { forme: 'objet', cle: Object.keys(j)[0], ids: Object.values(j)[0] };
  } catch {
    return { forme: 'array', ids: [] };
  }
}

async function ecrireVus(v) {
  const garde = v.ids.slice(-120);
  await writeFile(VUS, JSON.stringify(
    v.forme === 'array' ? garde : { [v.cle]: garde }, null, 2) + '\n');
}

// ---- principal ------------------------------------------------------------

const cfg = JSON.parse(await readFile(CONFIG, 'utf8'));
if (TEST) cfg.seuil_kn = SEUIL_TEST;

if (QA_ONLY) {
  await journaliserMesures(cfg.spots);
  console.log(`Appariements : ${await apparier(cfg.spots)}`);
  console.log(`Alertes evaluees : ${await evaluerAlertes(cfg)}`);
  console.log('\n' + await rapport());
  console.log('\n' + await rapportAlertes());
  sortieSiEchecs();
} else {
  const maintenant = new Date();
  const { emission, parSpot } = await previsions(cfg.spots);
  const biais = await biaisParEcheance();
  console.log(`Run MeteoSuisse ${emission} — seuil ${cfg.seuil_kn} kn / ` +
    `${cfg.min_heures} h — biais sur ${biais.size} echeances` +
    (TEST ? '  *** MODE TEST ***' : ''));

  const codes = new Set(cfg.spots.map((s) => s.station));
  const m = await mesures(codes).catch(() => new Map());
  const vus = await lireVus();
  let modifie = false;

  const classement = cfg.spots.map((spot) => {
    const lignes = parSpot.get(spot.key) || [];
    return {
      spot, court: spot.court, lignes,
      f: fenetre(lignes, spot, cfg, cfg.seuil_kn, biais, maintenant),
      pic: lignes.length ? +Math.max(...lignes.map((l) => l.kn)).toFixed(0) : 0,
      mesure: m.get(spot.station) || null,
    };
  }).sort((a, b) => a.spot.route_min - b.spot.route_min);

  console.log('\n| Spot | Route | Fenetre | Moy | Pic | Maintenant |');
  console.log('|---|---|---|---|---|---|');
  for (const c of classement) {
    console.log(`| ${c.spot.nom} | ${c.spot.route_min}′ ` +
      `| ${c.f ? c.f[0].t.court + '-' + c.f.at(-1).t.court : '—'} ` +
      `| ${c.f ? moyenne(c.f).toFixed(1) : '—'} | ${c.pic} ` +
      `| ${c.mesure?.kn != null ? c.mesure.kn.toFixed(1) : '—'} |`);
  }

  for (const [etage, e] of Object.entries(cfg.alertes)) {
    const seuilEff = cfg.seuil_kn - (e.marge_kn || 0);
    const b = e.correction_biais ? biais : new Map();

    let gagnant = null;
    for (const c of classement) {
      const f = fenetre(c.lignes, c.spot, cfg, seuilEff, b, maintenant);
      if (!f) continue;
      const lead = f[0].lead;
      if (lead < e.lead_min_h || lead > e.lead_max_h) continue;
      gagnant = { c, f, lead };
      break;
    }
    if (!gagnant) continue;

    const { c, f, lead } = gagnant;
    const id = `${etage}|${c.spot.key}|${f[0].date}`;
    if (!TEST && vus.ids.includes(id)) {
      console.log(`\n[${etage}] deja envoye : ${id}`);
      continue;
    }

    const eau = await tempLac(c.spot.lac, c.spot.lat, c.spot.lon);
    const autres = classement
      .filter((x) => x.spot.route_min > c.spot.route_min && x.pic > 0)
      .slice(0, 3);
    const corps = message(etage, c.spot, f, cfg, eau, autres);
    const titre = `${TEST ? '[TEST] ' : ''}${e.titre} — ${c.court} ` +
      `${f[0].t.jourLabel} ${f[0].t.court}`;
    console.log(`\n[${etage}] ${titre}\n${corps}`);

    if (DRY_RUN) { console.log(`[${etage}] DRY_RUN : rien envoye.`); continue; }
    if (!TOPIC) {
      console.error('NTFY_TOPIC_VENT absent — notification impossible.');
      process.exitCode = 1;
      break;
    }
    await notifier(TOPIC, titre, corps, {
      priorite: etage === 'pre' ? 'default' : 'high',
      tags: ['wind', etage, ...(TEST ? ['test'] : [])],
    });
    if (TEST) {
      console.log(`[${etage}] TEST : ni anti-spam ni journal QA.`);
      break;                        // une seule notification de test suffit
    }
    vus.ids.push(id);
    modifie = true;
    await journaliserAlerte({
      envoyeLe: versCle(maintenant), etage, spot: c.spot.key,
      station: c.spot.station, debut: f[0].date, fin: f.at(-1).date,
      prevu: moyenne(f), corrige: moyenne(f, 'corrige'), lead,
    });
  }

  if (cfg.annulation && !TEST && !DRY_RUN && TOPIC) {
    for (const id of vus.ids.filter((i) => i.startsWith('pre|'))) {
      const [, key, debut] = id.split('|');
      const lead = (versDate(debut) - maintenant) / 36e5;
      if (lead < 9 || lead > 34) continue;
      const annul = `annul|${key}|${debut}`;
      if (vus.ids.includes(annul)) continue;
      if (vus.ids.includes(`conf|${key}|${debut}`)) continue;
      const c = classement.find((x) => x.spot.key === key);
      if (!c) continue;
      const f = fenetre(c.lignes, c.spot, cfg, cfg.seuil_kn, biais, maintenant);
      if (f && f[0].date === debut) continue;
      const t = local(versDate(debut));
      await notifier(TOPIC, `Annule — ${c.court} ${t.label}`,
        `La fenetre annoncee a ${c.court} ne tient plus.\n` +
        `Pic revu a ${c.pic} kn. Inutile de bloquer le creneau.`,
        { priorite: 'default', tags: ['wind', 'annul'] });
      vus.ids.push(annul);
      modifie = true;
    }
  }

  if (modifie) await ecrireVus(vus);

  console.log('\n' + await versTrmnl(classement, cfg, emission));
  if (!TEST) {
    console.log(`Archive QA : ${await archiver(emission, cfg.spots, parSpot)}`);
    console.log(`Mesures : ${await journaliserMesures(cfg.spots)}`);
    console.log(`Appariements : ${await apparier(cfg.spots)}`);
    console.log(`Alertes evaluees : ${await evaluerAlertes(cfg)}`);
    console.log('\n' + await rapport());
    console.log('\n' + await rapportAlertes());
  }
  console.log('\nSource: MeteoSwiss / Eawag Alplakes');
  sortieSiEchecs();
}
