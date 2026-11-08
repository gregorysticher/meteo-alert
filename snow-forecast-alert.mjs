// Alerte chute de neige annoncée — Les Collines (2022 m), Portes du Soleil.
//
// Source : Open-Meteo, modèle meteoswiss_icon_seamless (ICON-CH1 ~1 km puis
// ICON-CH2 ~2 km, 120 h d'horizon). Coordonnées et altitude de la station
// IMIS ILI2, pour rester cohérent avec l'alerte neige fraîche.
// Le nom du modèle est vérifié contre l'API : "meteoswiss_seamless" est refusé
// (HTTP 400, "invalid String value") et a laissé l'alerte aveugle du 15/10 au
// 07/11/2026.
//
// Un "épisode" = jours consécutifs avec de la neige, jours passés compris
// (past_days), sinon le cumul baisserait tout seul à mesure que l'épisode
// avance. L'alerte se déclenche sur le cumul de l'épisode, pas sur une seule
// journée. Règles d'envoi (nouvelle, hausse, prolongation, annulation) :
// snow-episodes.mjs.
//
// Saison : 15 octobre → 15 avril.
//
// Env requis  : NTFY_TOPIC_NEIGE
// Env optionnel :
//   DRY_RUN=true         → analyse sans notifier ni écrire
//   SEUIL_CM=10          → seuil en cm (variable de dépôt SEUIL_NEIGE_CM)
//   SEUIL_FORCE=<cm>     → surcharge manuelle : ni annulation ni état écrit, un
//                          seuil de test ne doit pas toucher aux vrais épisodes
//   HAUSSE_CM=5          → nouvelle alerte si le cumul monte d'autant (variable
//                          de dépôt HAUSSE_NEIGE_CM)
//   IGNORER_SAISON=true  → force l'analyse hors saison (test en été)

import { readFileSync, writeFileSync, existsSync } from "fs";
import { notifier, sortieSiEchecs } from "./notify.mjs";
import { journaliserPrevision } from "./snow-qa.mjs";
import { episodes as decouper, decider } from "./snow-episodes.mjs";

// ══════ PARAMÈTRES ══════
const LAT = 46.1913556421;
const LON = 6.8277969399;
const ALT = 2022;
const LIEU = "Les Collines";

const SEUIL_CM = Number(process.env.SEUIL_CM) || 20;  // cumul sur l'épisode
const HAUSSE_CM = Number(process.env.HAUSSE_CM) || 5;
const SEUIL_FORCE = Boolean(process.env.SEUIL_FORCE);
const MIN_JOUR_CM = 1;                                // ignore les traces
const JOURS_PASSES = 7;                               // épisode en cours

const SAISON_DEBUT = 1015;
const SAISON_FIN = 415;

const TZ = "Europe/Zurich";
const JOURS = ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"];
const ETAT_FILE = "snow-forecast-alerted.json";

const NTFY_TOPIC = process.env.NTFY_TOPIC_NEIGE;
const DRY_RUN = process.env.DRY_RUN === "true";
const IGNORER_SAISON = process.env.IGNORER_SAISON === "true";

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
  if (!existsSync(ETAT_FILE)) return [];
  try {
    const e = JSON.parse(readFileSync(ETAT_FILE, "utf-8"));
    return Array.isArray(e.episodes) ? e.episodes : [];
  } catch (err) {
    // On continue (au pire une alerte en double, jamais une alerte perdue),
    // mais le run est rouge : un état illisible ne doit pas passer inaperçu.
    console.error(`État illisible (${ETAT_FILE}) : ${err.message}`);
    process.exitCode = 1;
    return [];
  }
}

function sauverEtat(episodes) {
  writeFileSync(
    ETAT_FILE,
    JSON.stringify({ episodes, updatedAt: new Date().toISOString() }, null, 2) + "\n"
  );
  console.log(`${ETAT_FILE} mis à jour (${episodes.length} épisode(s) suivi(s)).`);
}

const periode = (e) =>
  e.debut === e.fin ? label(e.debut) : `${label(e.debut)} → ${label(e.fin)}`;

function notification({ type, episode: e, record: r }) {
  if (type === "annule") {
    const reste = e ? `${Math.round(e.total)} cm prévus désormais` : "plus rien de prévu";
    return {
      titre: `Annulé — neige ${LIEU}`,
      corps: `L'épisode annoncé (${periode(r)}, ${Math.round(r.total)} cm) ` +
        `repasse sous le seuil de ${SEUIL_CM} cm : ${reste}.`,
      priorite: "default",
    };
  }
  const detail = e.jours.map((j) => `${label(j.d)} ${Math.round(j.v)} cm`).join("\n");
  const titres = {
    nouvelle: `Neige annoncée — ${LIEU}`,
    hausse: `Neige revue à la hausse — ${LIEU}`,
    prolonge: `Épisode de neige prolongé — ${LIEU}`,
  };
  const avant = {
    nouvelle: "",
    hausse: ` (${Math.round(r?.total)} cm à la dernière alerte)`,
    prolonge: ` (${r?.duree} j à la dernière alerte)`,
  };
  return {
    titre: titres[type],
    corps: `${Math.round(e.total)} cm cumulés${avant[type]} · ${periode(e)}\n${detail}`,
    priorite: "high",
  };
}

// ══════ MAIN ══════
async function main() {
  const jour = aujourdhuiLocal();
  console.log(`${LIEU} (${ALT} m) · seuil ${SEUIL_CM} cm cumulés · hausse ${HAUSSE_CM} cm`);
  console.log(`Date locale : ${jour}\n`);

  if (!enSaison(jour) && !IGNORER_SAISON) {
    console.log("Hors saison hivernale (15 oct → 15 avr) — aucune vérification.");
    return;
  }
  if (IGNORER_SAISON) console.log("*** IGNORER_SAISON actif ***\n");

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${LAT}&longitude=${LON}&elevation=${ALT}` +
    "&daily=snowfall_sum,temperature_2m_max" +
    "&models=meteoswiss_icon_seamless" +
    `&timezone=${encodeURIComponent(TZ)}` +
    "&forecast_days=5" +  // ICON-CH2 plafonne à 120 h
    `&past_days=${JOURS_PASSES}`;

  console.log(`Requête : ${url}\n`);

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // Un 4xx n'est pas une panne passagère : c'est la requête qui est
      // refusée, et l'alerte reste aveugle tant qu'on ne la corrige pas.
      // On affiche la raison renvoyée par Open-Meteo et on fait échouer le
      // run pour qu'il apparaisse en rouge au lieu de passer pour un succès.
      const corps = await res.text().catch(() => "");
      console.log(`Open-Meteo refuse la requête (HTTP ${res.status}) — aucune alerte.`);
      console.log(`Réponse : ${corps.slice(0, 500)}`);
      process.exitCode = 1;
      return;
    }
    data = await res.json();
  } catch (err) {
    console.log(`Erreur d'accès à Open-Meteo : ${err.message} — aucune alerte.`);
    process.exitCode = 1;
    return;
  }

  // On confirme l'unité au lieu de la supposer
  const unite = data.daily_units?.snowfall_sum;
  console.log(`Unité neige renvoyée : ${unite}`);
  if (unite !== "cm") {
    console.log(`Unité inattendue — le seuil suppose des cm. Aucune alerte.`);
    process.exitCode = 1;
    return;
  }

  const dates = data.daily?.time || [];
  const neige = data.daily?.snowfall_sum || [];
  // À venir seulement : c'est ce qui prouve que l'alerte voit quelque chose.
  // Réponse 200 mais vide, ou sans aucune valeur de neige exploitable :
  // l'alerte serait aveugle, le run doit être rouge.
  const iFutur = dates.flatMap((d, i) => (d >= jour ? [i] : []));
  const datesFutur = iFutur.map((i) => dates[i]);
  const neigeFutur = iFutur.map((i) => neige[i]);
  const valides = neigeFutur.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (datesFutur.length === 0 || neige.length !== dates.length || valides.length === 0) {
    console.log(
      `Données journalières inexploitables (${datesFutur.length} jours à venir, ` +
      `${valides.length} valeurs de neige) — aucune alerte.`
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nPrévisions journalières :");
  for (let i = 0; i < datesFutur.length; i++) {
    console.log(`  ${label(datesFutur[i])} · ${neigeFutur[i]} cm`);
  }
  if (!DRY_RUN) {
    console.log(`Journal neige : ${journaliserPrevision(jour, datesFutur, neigeFutur)} ligne(s) ajoutée(s).`);
  }

  const episodes = decouper(dates, neige, {
    minJour: MIN_JOUR_CM,
    retenir: (d) => enSaison(d) || IGNORER_SAISON,
  });

  console.log(`\nÉpisodes neigeux détectés : ${episodes.length}`);
  for (const e of episodes) {
    const marque = e.total >= SEUIL_CM ? "✓" : "✗";
    const fini = e.fin < jour ? " (fini)" : "";
    console.log(`  ${marque} ${periode(e)} · ${Math.round(e.total)} cm${fini}`);
  }

  const avant = chargerEtat();
  let decisions = decider(episodes, avant, { jour, seuil: SEUIL_CM, hausse: HAUSSE_CM });
  if (SEUIL_FORCE) {
    decisions = decisions.filter((d) => d.type !== "annule");
    console.log("Seuil forcé : ni annulation ni état écrit.");
  }
  const aEnvoyer = decisions.filter((d) => d.type);

  console.log(`\nÀ notifier : ${aEnvoyer.length}`);
  for (const d of aEnvoyer) console.log(`  [${d.type}] ${notification(d).corps.split("\n")[0]}`);

  if (DRY_RUN) {
    console.log("\n*** DRY_RUN — aucune notif envoyée, aucun état écrit ***");
    return;
  }

  // Sans envoi réussi, on garde l'état d'avant : l'alerte repartira au run suivant.
  const apres = [];
  for (const d of decisions) {
    let garde = d.apres;
    if (d.type) {
      const n = notification(d);
      const ok = await notifier(NTFY_TOPIC, n.titre, n.corps, {
        priorite: n.priorite,
        tags: d.type === "annule" ? ["snowflake", "annul"] : ["snowflake"],
      });
      if (!ok) garde = d.record;
    }
    if (garde) apres.push(garde);
  }

  if (!SEUIL_FORCE && JSON.stringify(apres) !== JSON.stringify(avant)) sauverEtat(apres);
}

main()
  .then(sortieSiEchecs)
  .catch((err) => {
    console.error("Erreur inattendue :", err.message);
    console.log("Aucune alerte envoyée.");
    process.exitCode = 1;
  });
