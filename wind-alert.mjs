// Alerte vent Reposoir — notifie quand une fenêtre exploitable apparaît.
//
// Critères : plage de >3h consécutives à plus de 12 kn (vent soutenu),
// samedi/dimanche en journée ou mardi matin, entre le 15 avril et le 15 octobre,
// pas encore terminée, et à moins de 7 jours.
//
// Source : Open-Meteo directement — JSON propre, pas de clé,
// mêmes coordonnées que le plugin Wind Forecast du dashboard.
//
// Anti-spam : chaque fenêtre détectée est mémorisée dans alerted.json.
// Une même fenêtre n'est notifiée qu'une fois, même si le cron la revoit.
//
// Env requis : NTFY_TOPIC_VENT
// Env optionnel :
//   DRY_RUN=true      → analyse et affiche, sans notifier ni écrire
//   SEUIL_KN=5        → abaisse le seuil (test de la chaîne de détection)
//   MIN_HEURES=2      → abaisse la durée minimale (test)
//   HORIZON_JOURS=14  → élargit l'horizon (test)

import { readFileSync, writeFileSync, existsSync } from "fs";
import { notifier, sortieSiEchecs } from "./notify.mjs";

// ══════ PARAMÈTRES ══════
const LAT = 46.23046;
const LON = 6.150208;
const LIEU = "Reposoir";
const TZ = "Europe/Zurich";

// Valeurs de production, surchargeables uniquement pour les tests
const SEUIL_KN = Number(process.env.SEUIL_KN) || 12;        // strictement supérieur
const MIN_HEURES = Number(process.env.MIN_HEURES) || 4;     // 4 relevés = plus de 3h
const HORIZON_JOURS = Number(process.env.HORIZON_JOURS) || 7;

const SAISON_DEBUT = 415;   // 15 avril  (MMDD)
const SAISON_FIN = 1015;    // 15 octobre

// Créneaux éligibles par jour de semaine (0 = dimanche … 6 = samedi)
// [heure_debut, heure_fin] inclusives
const CRENEAUX = {
  6: [9, 18],   // samedi — journée
  0: [9, 18],   // dimanche — journée
  2: [8, 13],   // mardi — matin
};

const JOURS = ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"];
const ETAT_FILE = "alerted.json";

const NTFY_TOPIC = process.env.NTFY_TOPIC_VENT;
const DRY_RUN = process.env.DRY_RUN === "true";

if (!NTFY_TOPIC && !DRY_RUN) {
  console.error("Erreur : NTFY_TOPIC_VENT manquante.");
  process.exit(1);
}

// ══════ TEMPS LOCAL ══════
// Les horodatages Open-Meteo sont en heure locale suisse, alors que le runner
// GitHub tourne en UTC. On lit donc l'heure courante dans le même fuseau.
// La locale "sv-SE" produit un format ISO-like : "2026-07-28 08:45".
function maintenantLocal() {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return { jour: s.slice(0, 10), heure: parseInt(s.slice(11, 13), 10) };
}

function ajouterJours(jourISO, n) {
  const d = new Date(`${jourISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ══════ RÉCUPÉRATION ══════
async function fetchWind() {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${LAT}&longitude=${LON}` +
    "&hourly=wind_speed_10m,wind_gusts_10m" +
    "&wind_speed_unit=kn" +
    `&timezone=${encodeURIComponent(TZ)}` +
    "&forecast_days=16";

  console.log(`Requête : ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status} — ${await res.text()}`);
  }
  return res.json();
}

// ══════ ANALYSE ══════
// Découpe les relevés en plages consécutives qui satisfont tous les critères.
function trouverFenetres(data) {
  const times = data.hourly?.time || [];
  const speeds = data.hourly?.wind_speed_10m || [];
  const gusts = data.hourly?.wind_gusts_10m || [];

  const fenetres = [];
  let cur = null;

  const cloturer = () => {
    if (cur && cur.heures.length >= MIN_HEURES) fenetres.push(cur);
    cur = null;
  };

  for (let i = 0; i < times.length; i++) {
    const t = times[i];              // "2026-08-01T14:00" (heure locale)
    const jour = t.slice(0, 10);
    const heure = parseInt(t.slice(11, 13), 10);
    const v = speeds[i];
    const g = gusts[i];

    // Jour de semaine sans piège de fuseau : on ancre la date en UTC
    const dow = new Date(`${jour}T00:00:00Z`).getUTCDay();

    // Saison, calculée sur la date de la fenêtre (pas sur aujourd'hui)
    const md = parseInt(jour.slice(5, 7), 10) * 100 + parseInt(jour.slice(8, 10), 10);
    const enSaison = md >= SAISON_DEBUT && md <= SAISON_FIN;

    const creneau = CRENEAUX[dow];
    const eligible =
      enSaison &&
      creneau &&
      heure >= creneau[0] &&
      heure <= creneau[1] &&
      typeof v === "number" &&
      v > SEUIL_KN;

    if (!eligible) {
      cloturer();
      continue;
    }

    const contigu =
      cur && cur.jour === jour && heure === cur.heures[cur.heures.length - 1] + 1;

    if (contigu) {
      cur.heures.push(heure);
      cur.pic = Math.max(cur.pic, v);
      if (typeof g === "number") cur.rafale = Math.max(cur.rafale, g);
    } else {
      cloturer();
      cur = {
        jour,
        dow,
        heures: [heure],
        pic: v,
        rafale: typeof g === "number" ? g : 0,
      };
    }
  }
  cloturer();

  return fenetres;
}

function finFenetre(f) {
  return f.heures[f.heures.length - 1];
}

function idFenetre(f) {
  return `${f.jour}|${f.heures[0]}-${finFenetre(f)}`;
}

function decrire(f) {
  const h1 = f.heures[0];
  const h2 = finFenetre(f);
  const [, m, d] = f.jour.split("-");
  return {
    titre: `Vent ${LIEU} — ${JOURS[f.dow]} ${d}.${m}`,
    corps:
      `${h1}h-${h2}h · ${f.heures.length}h à plus de ${SEUIL_KN} kn\n` +
      `Pic ${Math.round(f.pic)} kn` +
      (f.rafale ? ` · rafales ${Math.round(f.rafale)} kn` : ""),
  };
}

// ══════ ÉTAT ══════
function chargerEtat() {
  if (!existsSync(ETAT_FILE)) return { alerted: [] };
  try {
    const e = JSON.parse(readFileSync(ETAT_FILE, "utf-8"));
    return { alerted: Array.isArray(e.alerted) ? e.alerted : [] };
  } catch {
    return { alerted: [] };
  }
}

function sauverEtat(alerted, aujourdhui) {
  // On purge les entrées dont la date est passée, pour ne pas gonfler le fichier
  const propre = alerted.filter((id) => id.slice(0, 10) >= aujourdhui);
  writeFileSync(
    ETAT_FILE,
    JSON.stringify({ alerted: propre, updatedAt: new Date().toISOString() }, null, 2) + "\n"
  );
  console.log(`alerted.json mis à jour (${propre.length} fenêtre(s) mémorisée(s)).`);
}

// ══════ MAIN ══════
async function main() {
  const now = maintenantLocal();
  const limite = ajouterJours(now.jour, HORIZON_JOURS);

  console.log(
    `Seuil : plus de ${SEUIL_KN} kn · Durée min : ${MIN_HEURES} relevés · ` +
      `Horizon : ${HORIZON_JOURS} j`
  );
  console.log(`Maintenant (${TZ}) : ${now.jour} ${now.heure}h · limite ${limite}\n`);

  const data = await fetchWind();

  // Vérification de l'unité renvoyée — on ne suppose pas, on confirme
  const unite = data.hourly_units?.wind_speed_10m;
  console.log(`Unité vent renvoyée par Open-Meteo : ${unite}`);
  if (unite !== "kn") {
    throw new Error(
      `Unité inattendue "${unite}" — le seuil de ${SEUIL_KN} suppose des nœuds. Arrêt.`
    );
  }
  console.log(`Relevés horaires : ${data.hourly.time.length}\n`);

  const brutes = trouverFenetres(data);
  console.log(`Fenêtres brutes (météo + jour + créneau) : ${brutes.length}`);

  const retenues = [];
  for (const f of brutes) {
    const { titre } = decrire(f);
    const plage = `${f.heures[0]}h-${finFenetre(f)}h`;

    // Écartée si déjà terminée
    const passee =
      f.jour < now.jour || (f.jour === now.jour && finFenetre(f) < now.heure);
    if (passee) {
      console.log(`  ✗ ${titre} ${plage} — déjà passée`);
      continue;
    }

    // Écartée si trop lointaine (prévision peu fiable au-delà de l'horizon)
    if (f.jour > limite) {
      console.log(`  ✗ ${titre} ${plage} — au-delà de ${HORIZON_JOURS} j`);
      continue;
    }

    console.log(`  ✓ ${titre} ${plage}`);
    retenues.push(f);
  }

  console.log(`\nFenêtres retenues : ${retenues.length}`);

  const etat = chargerEtat();
  const nouvelles = retenues.filter((f) => !etat.alerted.includes(idFenetre(f)));

  console.log(`Déjà notifiées : ${retenues.length - nouvelles.length}`);
  console.log(`Nouvelles à notifier : ${nouvelles.length}`);

  if (DRY_RUN) {
    console.log("\n*** DRY_RUN — aucune notif envoyée, aucun état écrit ***");
    return;
  }

  let envoyees = 0;
  for (const f of nouvelles) {
    const { titre, corps } = decrire(f);
    // Mémorisée seulement si l'envoi a réussi, sinon la fenêtre serait
    // considérée comme notifiée sans que rien ne soit parti.
    if (await notifier(NTFY_TOPIC, titre, corps, { priorite: "high", tags: ["wind_face"] })) {
      etat.alerted.push(idFenetre(f));
      envoyees++;
    }
  }

  if (envoyees > 0) sauverEtat(etat.alerted, now.jour);
}

main()
  .then(sortieSiEchecs)
  .catch((err) => {
    console.error("Erreur :", err.message);
    process.exit(1);
  });
