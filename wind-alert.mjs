// wind-alert.mjs — alerte wingfoil multi-spots sur le Leman.
// Source: MeteoSwiss (mesures + previsions locales) / Eawag Alplakes.
//
// SELECTION : le spot le plus PROCHE qui tient le seuil, pas le plus vente.
//
// ALERTES EN 3 ETAGES CONTIGUS (aucune fenetre ne passe entre deux tranches) :
//   pre   34 a 168 h  "Potentiel"   seuil abaisse — signal, pas promesse
//   conf   9 a  34 h  "Confirme"    seuil plein
//   jour   0 a   9 h  "Aujourd'hui" rappel
// Plus une annulation si une pre-alerte tombe a l'eau et qu'aucun autre spot ne
// tient ce jour-la.
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
import { previsions, previsionsArome, mesures, tempLac } from './wind-sources.mjs';
import {
  archiver, apparier, rapport, versDate, versCle,
  journaliserMesures, journaliserAlerte, evaluerAlertes, rapportAlertes,
  biaisParEcheance, journaliserGradient,
} from './wind-qa.mjs';
import {
  local, fenetre, moyenne, choisirReco, choisirAlerte, dejaEnvoye, jourTient,
  ligneEau, finLocale, etatMesure, dansSaison,
} from './wind-select.mjs';

const CONFIG = 'wind/spots.json';
const VUS = 'alerted.json';
const DRY_RUN = process.env.DRY_RUN === '1';
const QA_ONLY = process.env.QA_ONLY === '1';
const SEUIL_TEST = parseFloat(process.env.SEUIL_TEST || '');
const TEST = Number.isFinite(SEUIL_TEST);
const TOPIC = process.env.NTFY_TOPIC_VENT;
const TRMNL = process.env.TRMNL_WEBHOOK_URL;

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
  lignes.push(`${f[0].t.label} → ${finLocale(f)}`);
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
  const lEau = ligneEau(f, eau);
  if (lEau) lignes.push(lEau);

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

// Spot mesure a l'ecran quand aucune fenetre n'est affichee.
function mesureEcran(classement, cfg) {
  const c = classement.find((x) => x.spot.key === cfg.spot_prioritaire);
  if (!c) return null;
  const now = c.mesure?.kn != null ? +c.mesure.kn.toFixed(0) : null;
  const date = c.mesure?.date;
  return {
    n: c.spot.court,
    now,
    h: /^\d{12}$/.test(date ?? '') ? local(versDate(date)).court : null,
    g: etatMesure(c.mesure?.kn ?? null, !!c.f, cfg.seuil_kn, cfg.marge_mesure_kn),
  };
}

// Ligne neige, ecrite par l'alerte neige annoncee : un seul envoi vers TRMNL, un seul
// chiffre. Hors saison ou pas encore ecrite : null (l'ecran le dit).
async function neigeEcran(saison) {
  if (saison !== 'neige') return null;
  try {
    return JSON.parse(await readFile('data/neige-ecran.json', 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.error(`ECHEC data/neige-ecran.json : ${err.message}`);
    process.exitCode = 1;
    return null;
  }
}

// CONTRAT : docs/contrat-trmnl.md. Ajouter des champs, jamais en retirer ni en
// changer le sens sans prevenir le markup (DASHBOARD 392375).
async function versTrmnl(classement, cfg, emission, reco, maintenant) {
  if (TEST) return 'TEST : webhook TRMNL non touche';
  if (!TRMNL && !DRY_RUN) {
    process.exitCode = 1;          // ecran fige sans le dire
    return 'ECHEC : pas de TRMNL_WEBHOOK_URL';
  }
  // kn = moyenne CORRIGEE du biais, comme l'eligibilite (fenetre()).
  // j = date locale AAAA-MM-JJ du debut de fenetre. reco = spot a afficher
  // (choisirReco).
  const spots = classement.slice(0, 6).map(({ spot, f, mesure }) => ({
    n: spot.court, min: spot.route_min,
    now: mesure?.kn != null ? +mesure.kn.toFixed(0) : null,
    d: mesure?.dir != null ? Math.round(mesure.dir) : null,
    j: f ? f[0].t.iso : null,
    de: f ? f[0].t.court : null,
    a: f ? finLocale(f) : null,
    kn: f ? +moyenne(f, 'corrige').toFixed(0) : null,
    raf: f ? +Math.max(...f.map((l) => l.rafale)).toFixed(0) : null,
    e: f ? 2 : null,
  }));
  const saison = dansSaison(maintenant, cfg.saison) ? 'vent' : 'neige';
  const corps = JSON.stringify({
    merge_variables: {
      maj: emission, seuil: cfg.seuil_kn, saison,
      mesure: mesureEcran(classement, cfg),
      neige: await neigeEcran(saison),
      spots, reco,
    },
  });
  if (corps.length > 5000) {
    // Payload refuse = ecran fige sans le dire : le run doit etre rouge.
    process.exitCode = 1;
    return `payload ${corps.length} o > 5000, non envoye`;
  }
  if (DRY_RUN) return `DRY_RUN — ${corps.length} o prets :
${corps}`;
  const res = await fetch(TRMNL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: corps,
  });
  if (!res.ok) process.exitCode = 1;
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
  try {
    console.log(`Gradient air-eau : ${await journaliserGradient(cfg.spots)}`);
  } catch (err) {
    console.error(`ECHEC journal gradient : ${err.message}`);
    process.exitCode = 1;
  }
  console.log(`Appariements : ${await apparier(cfg.spots)}`);
  console.log(`Alertes evaluees : ${await evaluerAlertes(cfg)}`);
  console.log('\n' + await rapport());
  console.log('\n' + await rapportAlertes());
  sortieSiEchecs();
} else {
  const maintenant = new Date();
  const { emission, parSpot } = await previsions(cfg.spots);
  // Source figee : tout continue, mais sur de vieilles previsions, sans le dire.
  if ((maintenant - versDate(emission)) / 36e5 > 24) {
    console.error(`ECHEC : run MeteoSuisse de plus de 24 h (${emission})`);
    process.exitCode = 1;
  }
  const biais = await biaisParEcheance();
  console.log(`Run MeteoSuisse ${emission} — seuil ${cfg.seuil_kn} kn / ` +
    `${cfg.min_heures} h — biais sur ${biais.size} echeances` +
    (TEST ? '  *** MODE TEST ***' : ''));

  const codes = new Set(cfg.spots.map((s) => s.station));
  // Mesures : affichage et QA seulement, le run continue, mais l'echec doit
  // se voir (run rouge) au lieu d'etre avale.
  const m = await mesures(codes).catch((err) => {
    console.error(`ECHEC mesures MeteoSuisse : ${err.message}`);
    process.exitCode = 1;
    return new Map();
  });
  const vus = await lireVus();
  let modifie = false;

  const sansPrevision = cfg.spots.filter((s) => !(parSpot.get(s.key) || []).length);
  if (sansPrevision.length) {
    // Un spot sans prevision disparait sinon sans bruit de la selection.
    console.error(`ECHEC : aucune prevision pour ${sansPrevision.map((s) => s.key).join(', ')}`);
    process.exitCode = 1;
  }

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
      `| ${c.f ? c.f[0].t.court + '-' + finLocale(c.f) : '—'} ` +
      `| ${c.f ? moyenne(c.f).toFixed(1) : '—'} | ${c.pic} ` +
      `| ${c.mesure?.kn != null ? c.mesure.kn.toFixed(1) : '—'} |`);
  }

  for (const [etage, e] of Object.entries(cfg.alertes)) {
    const b = e.correction_biais ? biais : new Map();

    // Un jour deja alerte a cet etage est saute (en TEST, rien n'est saute).
    const gagnant = choisirAlerte(classement, cfg, e, b, maintenant,
      (iso) => !TEST && dejaEnvoye(vus.ids, etage, null, iso));
    if (!gagnant) continue;

    const { c, f, lead } = gagnant;
    const id = `${etage}|${c.spot.key}|${f[0].date}`;
    if (!TEST && dejaEnvoye(vus.ids, etage, c.spot.key, f[0].t.iso)) {
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
    const envoye = await notifier(TOPIC, titre, corps, {
      priorite: etage === 'pre' ? 'default' : 'high',
      tags: ['wind', etage, ...(TEST ? ['test'] : [])],
    });
    if (TEST) {
      console.log(`[${etage}] TEST : ni anti-spam ni journal QA.`);
      break;                        // une seule notification de test, envoyee ou non
    }
    // Memorise seulement si l'envoi a reussi (sinon : run rouge via
    // sortieSiEchecs, et nouvel essai au run suivant).
    if (!envoye) continue;
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
      const conf = cfg.alertes.conf;
      if (lead < conf.lead_min_h || lead > conf.lead_max_h) continue;
      const annul = `annul|${key}|${debut}`;
      if (vus.ids.includes(annul)) continue;
      if (dejaEnvoye(vus.ids, 'conf', key, local(versDate(debut)).iso)) continue;
      const c = classement.find((x) => x.spot.key === key);
      if (!c) continue;
      // Tient encore = une fenetre au seuil plein le MEME jour, sur N'IMPORTE
      // quel spot (elle peut aussi avoir glisse d'une heure ou deux).
      const t = local(versDate(debut));
      const b = conf.correction_biais ? biais : new Map();
      if (jourTient(classement, cfg, b, maintenant, t.iso)) continue;
      // Pic du jour annule, pas de toute la prevision : dimanche peut souffler.
      const duJour = c.lignes.filter((l) => local(versDate(l.date)).iso === t.iso);
      const pic = duJour.length ? Math.max(...duJour.map((l) => l.kn)).toFixed(0) : '?';
      const envoye = await notifier(TOPIC, `Annule — ${c.court} ${t.label}`,
        `La fenetre annoncee a ${c.court} ne tient plus, et aucun autre spot ` +
        `ne tient ce jour-la.\n` +
        `Pic revu a ${pic} kn ce jour-la. Inutile de bloquer le creneau.`,
        { priorite: 'default', tags: ['wind', 'annul'] });
      if (!envoye) continue;
      vus.ids.push(annul);
      modifie = true;
    }
  }

  if (modifie) await ecrireVus(vus);

  const reco = choisirReco(classement, cfg, biais, maintenant);
  console.log('\nReco TRMNL : ' + (reco
    ? `${reco.n} ${reco.j} ${reco.de}-${reco.a} ${reco.kn} kn ` +
      `(${reco.ok ? 'tient le seuil' : 'meilleure moyenne, sous le seuil'})`
    : 'aucune heure exploitable (hors saison ou hors creneaux)'));
  // Webhook injoignable : run rouge, mais la QA du run ne doit pas etre perdue.
  try {
    console.log(await versTrmnl(classement, cfg, emission, reco, maintenant));
  } catch (err) {
    console.error(`ECHEC webhook TRMNL : ${err.message}`);
    process.exitCode = 1;
  }
  if (!TEST) {
    console.log(`Archive QA : ${await archiver(emission, cfg.spots, parSpot)}`);
    // Second avis, archive seulement : apres les alertes, et sa panne ne les
    // touche pas, mais elle se voit (run rouge).
    try {
      const a = await previsionsArome(cfg.spots);
      console.log(`Archive AROME ${a.emission} : ` +
        await archiver(a.emission, cfg.spots, a.parSpot, 'arome'));
    } catch (err) {
      console.error(`ECHEC archive AROME : ${err.message}`);
      process.exitCode = 1;
    }
    console.log(`Mesures : ${await journaliserMesures(cfg.spots)}`);
    try {
      console.log(`Gradient air-eau : ${await journaliserGradient(cfg.spots)}`);
    } catch (err) {
      console.error(`ECHEC journal gradient : ${err.message}`);
      process.exitCode = 1;
    }
    console.log(`Appariements : ${await apparier(cfg.spots)}`);
    console.log(`Alertes evaluees : ${await evaluerAlertes(cfg)}`);
    console.log('\n' + await rapport());
    console.log('\n' + await rapportAlertes());
  }
  console.log('\nSource: MeteoSwiss / Eawag Alplakes / Open-Meteo (Meteo-France)');
  sortieSiEchecs();
}
