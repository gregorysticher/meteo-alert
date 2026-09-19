// wind-alert.mjs — alerte wingfoil multi-spots sur le Leman.
// Source: MeteoSwiss (mesures + previsions locales) / Eawag Alplakes.
//
// Remplace la version Open-Meteo mono-spot. Ce qui est CONSERVE de l'original,
// parce que c'etaient de bonnes decisions :
//   - creneaux reels de dispo (sam/dim 9-18, mardi 8-13)
//   - saison 15/04 - 15/10
//   - anti-spam via alerted.json
//   - DRY_RUN pour valider sans notifier
//   - verification explicite des colonnes plutot que confiance aveugle
//
// SELECTION DU SPOT : le plus PROCHE qui a assez de vent, pas le plus vente.
// On parcourt les spots par distance croissante et on retient le premier qui
// tient le seuil pendant min_heures. Un spot plus lointain n'est jamais
// prefere, meme s'il annonce nettement plus de vent — c'est le trajet qui
// decide du nombre de sessions, pas les noeuds.

import { readFile, writeFile } from 'node:fs/promises';
import { notifier, sortieSiEchecs } from './notify.mjs';
import { previsions, mesures, tempLac } from './wind-sources.mjs';
import { archiver, apparier, rapport, versDate } from './wind-qa.mjs';

const CONFIG = 'wind/spots.json';
const VUS = 'alerted.json';
const DRY_RUN = process.env.DRY_RUN === '1';
const QA_ONLY = process.env.QA_ONLY === '1';
const TOPIC = process.env.NTFY_TOPIC_VENT;
const TRMNL = process.env.TRMNL_WEBHOOK_URL;

const TZ = 'Europe/Zurich';

// ---- temps ---------------------------------------------------------------

/** Heure locale et jour de la semaine (0 = dimanche) pour une Date UTC. */
function local(d) {
  const p = new Intl.DateTimeFormat('fr-CH', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', hour12: false,
  }).formatToParts(d);
  const v = (t) => p.find((x) => x.type === t).value;
  const jours = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
  const cle = v('weekday').replace('.', '').slice(0, 3).toLowerCase();
  return {
    heure: +v('hour'),
    jour: jours[cle],
    label: `${v('weekday')} ${v('day')}.${v('month')} ${v('hour')}:${v('minute')}`,
    court: `${v('hour')}:${v('minute')}`,
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

/** Plus longue plage consecutive au-dessus du seuil, dans un creneau valide. */
function fenetre(lignes, spot, cfg) {
  let best = null;
  let run = [];
  for (const l of lignes) {
    const d = versDate(l.date);
    const t = local(d);
    const creneau = cfg.creneaux[String(t.jour)];
    const ok =
      dansSaison(d, cfg.saison) &&
      creneau &&
      t.heure >= creneau[0] &&
      t.heure < creneau[1] &&
      l.kn >= cfg.seuil_kn &&
      secteurOk(l.dir, spot.secteurs);
    if (ok) {
      run.push({ ...l, t });
      if (run.length >= cfg.min_heures && (!best || run.length > best.length)) {
        best = [...run];
      }
    } else {
      run = [];
    }
  }
  return best;
}

const moyenne = (f) => f.reduce((a, b) => a + b.kn, 0) / f.length;

// ---- message --------------------------------------------------------------

function message(best, f, cfg, eau, autres) {
  const moy = moyenne(f);
  const raf = Math.max(...f.map((l) => l.rafale));
  const q10 = Math.min(...f.map((l) => l.q10));
  const dir = Math.round(f[0].dir ?? 0);
  const lignes = [
    `${f[0].t.label} → ${f[f.length - 1].t.court}`,
    `${moy.toFixed(0)} kn moy (min ${q10.toFixed(0)}), rafales ${raf.toFixed(0)} kn, ${dir}°`,
    `${best.route_min} min de route — le plus proche qui tient le seuil`,
  ];
  const ratio = moy ? raf / moy : 0;
  if (ratio > cfg.ratio_rafale_max) {
    lignes.push(`⚠ rafales ×${ratio.toFixed(1)} — mauvais pour travailler le jibe`);
  }
  if (eau !== null) lignes.push(`Eau ${eau.toFixed(1)}°C`);
  const c = best.club;
  if (c) {
    const offres = [
      c.wing && 'wing',
      c.tracte && 'tracté',
      c.assiste && 'assisté',
    ].filter(Boolean);
    lignes.push(`${c.nom}${c.tel ? ' — ' + c.tel : ''} (${offres.join('/')})`);
    if (c.vent_min_kn && moy < c.vent_min_kn) {
      lignes.push(`  sous leur seuil wing (${c.vent_min_kn} kn)`);
    }
  }
  lignes.push(best.maps);
  if (autres.length) {
    lignes.push(
      'Plus loin : ' +
      autres.map((a) => `${a.court} ${a.pic} kn (${a.spot.route_min}′)`).join(', ')
    );
  }
  return lignes.join('\n');
}

// ---- sortie TRMNL (webhook, 5 kB max) ------------------------------------

async function versTrmnl(classement, cfg, emission) {
  if (!TRMNL) return 'pas de TRMNL_WEBHOOK_URL';
  // Ordre = distance croissante, comme la logique de selection.
  const spots = classement.slice(0, 6).map(({ spot, f, mesure }) => ({
    n: spot.court,
    min: spot.route_min,
    now: mesure?.kn != null ? +mesure.kn.toFixed(0) : null,
    d: mesure?.dir != null ? Math.round(mesure.dir) : null,
    de: f ? f[0].t.court : null,
    a: f ? f[f.length - 1].t.court : null,
    kn: f ? +moyenne(f).toFixed(0) : null,
    raf: f ? +Math.max(...f.map((l) => l.rafale)).toFixed(0) : null,
    e: f ? 2 : null,
  }));
  const payload = {
    merge_variables: { maj: emission, seuil: cfg.seuil_kn, spots },
  };
  const corps = JSON.stringify(payload);
  if (corps.length > 5000) return `payload ${corps.length} o > 5000, non envoye`;
  if (DRY_RUN) return `DRY_RUN — ${corps.length} o prets`;
  const res = await fetch(TRMNL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function ecrireVus(v, ids) {
  const garde = ids.slice(-40);
  await writeFile(
    VUS,
    JSON.stringify(v.forme === 'array' ? garde : { [v.cle]: garde }, null, 2) + '\n'
  );
}

// ---- principal ------------------------------------------------------------

const cfg = JSON.parse(await readFile(CONFIG, 'utf8'));

if (QA_ONLY) {
  const n = await apparier(cfg.spots);
  console.log(`Appariements ajoutes : ${n}`);
  console.log(await rapport());
  sortieSiEchecs();
} else {
  const { emission, parSpot } = await previsions(cfg.spots);
  console.log(`Run MeteoSuisse ${emission} — seuil ${cfg.seuil_kn} kn / ${cfg.min_heures} h`);

  const codes = new Set(cfg.spots.map((s) => s.station));
  const m = await mesures(codes).catch(() => new Map());

  const classement = [];
  for (const spot of cfg.spots) {
    const lignes = parSpot.get(spot.key) || [];
    const f = fenetre(lignes, spot, cfg);
    const pic = lignes.length ? Math.max(...lignes.map((l) => l.kn)) : 0;
    classement.push({
      spot, f, pic: +pic.toFixed(0), court: spot.court,
      mesure: m.get(spot.station) || null,
    });
  }
  // Le plus proche d'abord : c'est la distance qui tranche, pas la force du vent.
  classement.sort((a, b) => a.spot.route_min - b.spot.route_min);

  console.log('\n| Spot | Route | Fenetre | Moy | Pic | Maintenant |');
  console.log('|---|---|---|---|---|---|');
  for (const c of classement) {
    console.log(
      `| ${c.spot.nom} | ${c.spot.route_min}′ `
      + `| ${c.f ? c.f[0].t.court + '-' + c.f.at(-1).t.court : '—'} `
      + `| ${c.f ? moyenne(c.f).toFixed(1) : '—'} | ${c.pic} `
      + `| ${c.mesure?.kn != null ? c.mesure.kn.toFixed(1) : '—'} |`
    );
  }

  // Premier de la liste (donc le plus proche) qui tient le seuil.
  const gagnant = classement.find((c) => c.f);
  if (!gagnant) {
    console.log('\nAucune fenetre exploitable sur l\'horizon et les creneaux.');
  } else {
    const { spot, f } = gagnant;
    const id = `${spot.key}|${f[0].date}`;
    const vus = await lireVus();
    if (vus.ids.includes(id)) {
      console.log(`\nDeja alerte : ${id}`);
    } else {
      const eau = await tempLac(spot.lac, spot.lat, spot.lon);
      // Uniquement les spots PLUS LOIN, pour signaler s'il y a nettement mieux.
      const autres = classement
        .filter((c) => c.spot.route_min > spot.route_min && c.pic > 0)
        .slice(0, 3);
      const corps = message(spot, f, cfg, eau, autres);
      const titre = `Wingfoil — ${spot.court} ${f[0].t.court}`;
      console.log('\n' + titre + '\n' + corps);
      if (DRY_RUN) {
        console.log('\nDRY_RUN : aucune notification envoyee.');
      } else if (!TOPIC) {
        console.error('NTFY_TOPIC_VENT absent — notification impossible.');
        process.exitCode = 1;
      } else {
        await notifier(TOPIC, titre, corps, { priorite: 'high', tags: ['wind'] });
        vus.ids.push(id);
        await ecrireVus(vus, vus.ids);
      }
    }
  }

  console.log('\n' + (await versTrmnl(classement, cfg, emission)));
  console.log(`Archive QA : ${await archiver(emission, cfg.spots, parSpot)} lignes`);
  console.log(`Appariements : ${await apparier(cfg.spots)}`);
  console.log('\n' + (await rapport()));
  console.log('\nSource: MeteoSwiss / Eawag Alplakes');
  sortieSiEchecs();
}
