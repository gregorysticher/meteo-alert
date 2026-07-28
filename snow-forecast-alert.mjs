// Alerte chute de neige annoncée — Les Collines (2022 m), Portes du Soleil.
//
// Source : Open-Meteo, modèle meteoswiss_seamless (ICON-CH1 ~1 km puis
// ICON-CH2 ~2 km, 120 h d'horizon). Coordonnées et altitude de la station
// IMIS ILI2, pour rester cohérent avec l'alerte neige fraîche.
//
// Un "épisode" = jours consécutifs avec de la neige prévue. L'alerte se
// déclenche sur le cumul de l'épisode, pas sur une seule journée.
//
// Saison : 15 octobre → 15 avril.
//
// Env requis  : NTFY_TOPIC_NEIGE
// Env optionnel :
//   DRY_RUN=true   → analyse sans notifier ni écrire
//   SEUIL_CM=10    → abaisse le seuil (test)

import { readFileSync, writeFileSync, existsSync } from "fs";

// ══════ PARAMÈTRES ══════
const LAT = 46.1913556421;
const LON = 6.8277969399;
const ALT = 2022;
const LIEU = "Les Collines";

const SEUIL_CM = Number(process.env.SEUIL_CM) || 20;  // cumul sur l'épisode
const MIN_JOUR_CM = 1;                                // ignore les traces

const SAISON_DEBUT = 1015;
const SAISON_FIN = 415;

const TZ = "Europe/Zurich";
const JOURS = ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"];
const ETAT_FILE = "snow-forecast-alerted.json";

const NTFY_TOPIC = process.env.NTFY_TOPIC_NEIGE;
const DRY_RUN = process.env.DRY_RUN === "true";

if (!NTFY_TOPIC && !DRY_RUN) {
  console.error("Erreur : NTFY_TOPIC_NEIGE manquante.");
  process.exit(1);
}

// ══════ OUTILS ══════
function aujourdhuiLocal() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function enSaison(jourISO) {
  const md =
    parseInt(jourISO.slice(5, 7), 10) * 100 + parseInt(jourISO.slice(8, 10), 10);
  return md >= SAISON_DEBUT || md <= SAISON_FIN;
}

function label(jourISO) {
  const dow = new Date(`${jourISO}T00:00:00Z`).getUTCDay();
  return `${JOURS[dow]} ${jourISO.slice(8, 10)}.${jourISO.slice(5, 7)}`;
}

function chargerEtat() {
  if (!existsSync(ETAT_FILE)) return { alerted: [] };
  try {
    const e = JSON.parse(readFileSync(ETAT_FILE, "utf-8"));
    return { alerted: Array.isArray(e.alerted) ? e.alerted : [] };
  } catch {
    return { alerted: [] };
  }
}

function sauverEtat(alerted, jour) {
  const propre = alerted.filter((id) => id.slice(0, 10) >= jour).slice(-30);
  writeFileSync(
    ETAT_FILE,
    JSON.stringify({ alerted: propre, updatedAt: new Date().toISOString() }, null, 2) + "\n"
  );
  console.log(`${ETAT_FILE} mis à jour (${propre.length} entrée(s)).`);
}

async function notifier(titre, corps) {
  const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    headers: { Title: titre, Priority: "high", Tags: "snowflake" },
    body: corps,
  });
  console.log(`ntfy → ${titre} (HTTP ${res.status})`);
}

// ══════ MAIN ══════
async function main() {
  const jour = aujourdhuiLocal();
  console.log(`${LIEU} (${ALT} m) · seuil ${SEUIL_CM} cm cumulés`);
  console.log(`Date locale : ${jour}\n`);

  if (!enSaison(jour)) {
    console.log("Hors saison hivernale (15 oct → 15 avr) — aucune vérification.");
    return;
  }

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${LAT}&longitude=${LON}&elevation=${ALT}` +
    "&daily=snowfall_sum,temperature_2m_max" +
    "&models=meteoswiss_seamless" +
    `&timezone=${encodeURIComponent(TZ)}` +
    "&forecast_days=5";   // ICON-CH2 plafonne à 120 h

  console.log(`Requête : ${url}\n`);

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`Open-Meteo indisponible (HTTP ${res.status}) — aucune alerte.`);
      return;
    }
    data = await res.json();
  } catch (err) {
    console.log(`Erreur d'accès à Open-Meteo : ${err.message} — aucune alerte.`);
    return;
  }

  // On confirme l'unité au lieu de la supposer
  const unite = data.daily_units?.snowfall_sum;
  console.log(`Unité neige renvoyée : ${unite}`);
  if (unite !== "cm") {
    console.log(`Unité inattendue — le seuil suppose des cm. Aucune alerte.`);
    return;
  }

  const dates = data.daily?.time || [];
  const neige = data.daily?.snowfall_sum || [];
  if (dates.length === 0) {
    console.log("Aucune donnée journalière — aucune alerte.");
    return;
  }

  console.log("\nPrévisions journalières :");
  for (let i = 0; i < dates.length; i++) {
    console.log(`  ${label(dates[i])} · ${neige[i]} cm`);
  }

  // Regroupement en épisodes de jours consécutifs enneigés
  const episodes = [];
  let cur = null;
  for (let i = 0; i < dates.length; i++) {
    const v = neige[i];
    // Valeur absente ou aberrante (cf. remarque Open-Meteo sur le niveau sol)
    const valide = typeof v === "number" && Number.isFinite(v) && v >= 0;
    if (valide && v >= MIN_JOUR_CM && enSaison(dates[i])) {
      if (cur) {
        cur.fin = dates[i];
        cur.total += v;
        cur.jours.push({ d: dates[i], v });
      } else {
        cur = { debut: dates[i], fin: dates[i], total: v, jours: [{ d: dates[i], v }] };
      }
    } else if (cur) {
      episodes.push(cur);
      cur = null;
    }
  }
  if (cur) episodes.push(cur);

  console.log(`\nÉpisodes neigeux détectés : ${episodes.length}`);

  const retenus = episodes.filter((e) => e.total >= SEUIL_CM);
  for (const e of episodes) {
    const marque = e.total >= SEUIL_CM ? "✓" : "✗";
    console.log(
      `  ${marque} ${label(e.debut)}${e.debut !== e.fin ? " → " + label(e.fin) : ""} · ${Math.round(e.total)} cm`
    );
  }

  const etat = chargerEtat();
  const nouveaux = retenus.filter(
    (e) => !etat.alerted.includes(`${e.debut}|${e.fin}|${Math.round(e.total)}`)
  );

  console.log(`\nÀ notifier : ${nouveaux.length}`);

  if (DRY_RUN) {
    console.log("\n*** DRY_RUN — aucune notif envoyée, aucun état écrit ***");
    return;
  }

  for (const e of nouveaux) {
    const periode =
      e.debut === e.fin ? label(e.debut) : `${label(e.debut)} → ${label(e.fin)}`;
    const detail = e.jours
      .map((j) => `${label(j.d)} ${Math.round(j.v)} cm`)
      .join("\n");

    await notifier(
      `Neige annoncée — ${LIEU}`,
      `${Math.round(e.total)} cm cumulés · ${periode}\n${detail}`
    );
    etat.alerted.push(`${e.debut}|${e.fin}|${Math.round(e.total)}`);
  }

  sauverEtat(etat.alerted, jour);
}

main().catch((err) => {
  console.error("Erreur inattendue :", err.message);
  console.log("Aucune alerte envoyée.");
});
