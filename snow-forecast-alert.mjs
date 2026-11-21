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
// journée. Règles d'envoi (nouvelle, hausse, baisse, prolongation, annulation) :
// snow-episodes.mjs.
//
// Neige en cm : conversion D-005 (snow-conversion.mjs), précipitation horaire × part
// neige × rapport selon la température, et non plus snowfall_sum (0,7 cm/mm fixe), gardé
// au journal pour comparaison.
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
//   HAUSSE_PCT=30        → ... ou de ce pourcentage du cumul de la dernière alerte,
//                          le plus grand des deux (variable HAUSSE_NEIGE_PCT, D-001)
//   MARGE_CM=2           → annulation seulement sous seuil - marge (variable
//                          de dépôt MARGE_ANNUL_NEIGE_CM ; 0 = sous le seuil)
//   PROLONGE_MIN_CM=2    → neige minimale sur les jours ajoutés pour une
//                          prolongation (variable PROLONGE_MIN_NEIGE_CM)
//   TEMP_NEIGE_C=-5      → conversion D-005 : en dessous, toute la précipitation compte
//                          en neige (variable de dépôt TEMP_NEIGE_C)
//   TEMP_PLUIE_C=5       → ... au-dessus, rien (variable TEMP_PLUIE_C)
//   AFFICHAGE_CM=5       → à l'écran, chute montrée sans inversion à partir de ce
//                          cumul à venir (variable AFFICHAGE_NEIGE_CM)
//
// Écrit data/neige-ecran.json, que wind-alert joint au payload TRMNL : l'écran
// montre le chiffre de l'alerte (docs/contrat-trmnl.md).
//   IGNORER_SAISON=true  → force l'analyse hors saison (test en été)

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { notifier, sortieSiEchecs } from "./notify.mjs";
import { fetchEssai } from "./reseau.mjs";
import { journaliserPrevision } from "./snow-qa.mjs";
import { episodes as decouper, decider, ecranNeige } from "./snow-episodes.mjs";
import { journaliserEnvoi } from "./snow-verdict.mjs";
import { neigeJournaliere, TEMP_NEIGE_C, TEMP_PLUIE_C } from "./snow-conversion.mjs";

// ══════ PARAMÈTRES ══════
const LAT = 46.1913556421;
const LON = 6.8277969399;
const ALT = 2022;
const LIEU = "Les Collines";

const SEUIL_CM = Number(process.env.SEUIL_CM) || 20;  // cumul sur l'épisode
const nombreEnv = (nom, defaut) => {
  const v = process.env[nom];
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : defaut;
};
const HAUSSE_CM = nombreEnv("HAUSSE_CM", 5);
const HAUSSE_PCT = nombreEnv("HAUSSE_PCT", 30);
const MARGE_CM = nombreEnv("MARGE_CM", 2);
const PROLONGE_MIN_CM = nombreEnv("PROLONGE_MIN_CM", 2);
const AFFICHAGE_CM = nombreEnv("AFFICHAGE_CM", 5);
const TEMP_NEIGE = nombreEnv("TEMP_NEIGE_C", TEMP_NEIGE_C);
const TEMP_PLUIE = nombreEnv("TEMP_PLUIE_C", TEMP_PLUIE_C);
const FICHIER_ECRAN = "data/neige-ecran.json";
const SEUIL_FORCE = Boolean(process.env.SEUIL_FORCE);

// Réglage absurde : le script tourne avec les défauts, mais le run est rouge.
function reglages() {
  const r = { hausse: HAUSSE_CM, hausseRel: HAUSSE_PCT / 100, marge: MARGE_CM,
    prolongeMin: PROLONGE_MIN_CM, affichage: AFFICHAGE_CM,
    bornes: { neige: TEMP_NEIGE, pluie: TEMP_PLUIE } };
  const refuser = (msg, cle, defaut) => {
    console.error(`Variable invalide : ${msg} — défaut ${defaut} utilisé.`);
    process.exitCode = 1;
    r[cle] = defaut;
  };
  if (r.hausse <= 0) refuser(`HAUSSE_CM = ${r.hausse}`, "hausse", 5);
  if (!(HAUSSE_PCT >= 0 && HAUSSE_PCT <= 100)) refuser(`HAUSSE_PCT = ${HAUSSE_PCT}`, "hausseRel", 0.3);
  if (r.affichage <= 0) refuser(`AFFICHAGE_CM = ${r.affichage}`, "affichage", 5);
  if (r.prolongeMin < 0) refuser(`PROLONGE_MIN_CM = ${r.prolongeMin}`, "prolongeMin", 2);
  if (!(TEMP_NEIGE < TEMP_PLUIE && TEMP_NEIGE >= -20 && TEMP_PLUIE <= 20)) {
    refuser(`TEMP_NEIGE_C = ${TEMP_NEIGE}, TEMP_PLUIE_C = ${TEMP_PLUIE}`, "bornes",
      { neige: TEMP_NEIGE_C, pluie: TEMP_PLUIE_C });
  }
  if (!SEUIL_FORCE && (r.marge < 0 || r.marge >= SEUIL_CM)) {
    refuser(`MARGE_CM = ${r.marge}, seuil ${SEUIL_CM}`, "marge", Math.min(2, SEUIL_CM / 2));
  }
  return r;
}
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
  if (type === "decale") {
    const detail = e.jours.map((j) => `${label(j.d)} ${Math.round(j.v)} cm`).join("\n");
    return {
      titre: `Neige décalée — ${LIEU}`,
      corps: `${Math.round(e.total)} cm cumulés · ${periode(e)}\n` +
        `(annoncé avant : ${periode(r)}, ${Math.round(r.total)} cm)\n${detail}`,
      priorite: "high",
    };
  }
  if (type === "annule") {
    const reste = e ? `${Math.round(e.total)} cm prévus désormais` : "plus rien de prévu";
    return {
      titre: `Annulé — neige ${LIEU}`,
      corps: `L'épisode annoncé (${periode(r)}, ${Math.round(r.total)} cm) ` +
        `ne tient plus (seuil ${SEUIL_CM} cm) : ${reste}.`,
      priorite: "default",
    };
  }
  const detail = e.jours.map((j) => `${label(j.d)} ${Math.round(j.v)} cm`).join("\n");
  const titres = {
    nouvelle: `Neige annoncée — ${LIEU}`,
    hausse: `Neige revue à la hausse — ${LIEU}`,
    baisse: `Neige revue à la baisse — ${LIEU}`,
    prolonge: `Épisode de neige prolongé — ${LIEU}`,
  };
  const avant = {
    nouvelle: "",
    hausse: ` (${Math.round(r?.total)} cm à la dernière alerte)`,
    // Plage d'avant aussi : la baisse peut venir avec un changement de jours (D-002).
    baisse: r ? ` (${Math.round(r.total)} cm à la dernière alerte, ${periode(r)})` : "",
    // Le cumul d'avant aussi : une prolongation peut s'accompagner d'une forte baisse
    // (13/11/2026 : 64 cm sur 2 j annoncés, puis « prolongé » à 28 cm sur 3 j).
    prolonge: ` (${Math.round(r?.total)} cm sur ${r?.duree} j à la dernière alerte)`,
  };
  return {
    titre: titres[type],
    corps: `${Math.round(e.total)} cm cumulés${avant[type]} · ${periode(e)}\n${detail}`,
    priorite: type === "baisse" ? "default" : "high",
  };
}

// Écrit la ligne écran et signale au workflow si l'épisode a changé : wind-alert est
// alors relancé tout de suite, sinon l'écran attendrait le prochain run vent.
function ecrireEcran(ecran) {
  let avant = null;
  try {
    avant = JSON.parse(readFileSync(FICHIER_ECRAN, "utf-8")).episodes ?? null;
  } catch { /* premier run, ou fichier illisible : on réécrit */ }
  mkdirSync("data", { recursive: true });
  writeFileSync(FICHIER_ECRAN, JSON.stringify(ecran, null, 2) + "\n");
  const change = JSON.stringify(avant) !== JSON.stringify(ecran.episodes);
  console.log(`Épisode à l'écran ${change ? "changé" : "inchangé"}.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ecran_change=${change}\n`);
}

// Journal seulement : prévision du modèle par défaut sur 16 jours, celle du plugin
// écran, pour mesurer ce que vaut une annonce à J+9 avant de songer à l'afficher.
// Sa panne ne touche pas l'alerte, mais elle se voit.
async function journaliserLong(url, jour) {
  const long = url.replace("&models=meteoswiss_icon_seamless", "").replace("&hourly=precipitation,temperature_2m", "")
    .replace("&forecast_days=5", "&forecast_days=16").replace(/&past_days=\d+/, "");
  try {
    const res = await fetchEssai(long);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json()).daily;
    if (!d?.time?.length || !d.snowfall_sum?.length) throw new Error("réponse vide");
    const n = journaliserPrevision(jour, d.time, d.snowfall_sum, {
      modele: "long",
      annexes: { mm: d.precipitation_sum, pluie: d.rain_sum, tMoy: d.temperature_2m_mean },
    });
    console.log(`Journal neige, horizon long : ${n} ligne(s) ajoutée(s).`);
  } catch (err) {
    console.error(`ECHEC journal neige horizon long : ${err.message}`);
    process.exitCode = 1;
  }
}

// ══════ MAIN ══════
async function main() {
  const jour = aujourdhuiLocal();
  console.log(`${LIEU} (${ALT} m) · seuil ${SEUIL_CM} cm cumulés · hausse ${HAUSSE_CM} cm ou ${HAUSSE_PCT} %`);
  console.log(`Date locale : ${jour}\n`);

  if (!enSaison(jour) && !IGNORER_SAISON) {
    console.log("Hors saison hivernale (15 oct → 15 avr) — aucune vérification.");
    return;
  }
  if (IGNORER_SAISON) console.log("*** IGNORER_SAISON actif ***\n");

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${LAT}&longitude=${LON}&elevation=${ALT}` +
    "&daily=snowfall_sum,precipitation_sum,rain_sum,temperature_2m_mean" +
    "&hourly=precipitation,temperature_2m" +
    "&models=meteoswiss_icon_seamless" +
    `&timezone=${encodeURIComponent(TZ)}` +
    "&forecast_days=5" +  // ICON-CH2 plafonne à 120 h
    `&past_days=${JOURS_PASSES}`;

  console.log(`Requête : ${url}\n`);

  let data;
  try {
    const res = await fetchEssai(url);
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

  // On confirme les unités au lieu de les supposer
  const uP = data.hourly_units?.precipitation, uT = data.hourly_units?.temperature_2m;
  const uF = data.daily_units?.snowfall_sum;
  console.log(`Unités renvoyées : précipitation ${uP}, température ${uT}, neige 0,7 fixe ${uF}`);
  if (uP !== "mm" || uT !== "°C") {
    console.log(`Unité inattendue — la conversion suppose mm et °C. Aucune alerte.`);
    process.exitCode = 1;
    return;
  }

  const regl = reglages();
  const dates = data.daily?.time || [];
  // Neige de l'alerte et de l'écran : conversion D-005. snowfall_sum (0,7 fixe) reste au
  // journal, en information : s'il manque, l'alerte part quand même, mais le run est rouge.
  let neigeFixe = data.daily?.snowfall_sum;
  if (uF !== "cm" || !Array.isArray(neigeFixe) || neigeFixe.length !== dates.length) {
    console.error(`snowfall_sum inexploitable (unité ${uF}) : 0,7 fixe absent du journal.`);
    process.exitCode = 1;
    neigeFixe = dates.map(() => null);
  }
  const neige = neigeJournaliere(data.hourly, dates, regl.bornes);
  console.log(`Conversion D-005 : neige sous ${regl.bornes.neige} °C, rien au-dessus de ${regl.bornes.pluie} °C.`);
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
    console.log(`  ${label(datesFutur[i])} · ${neigeFutur[i]} cm (0,7 fixe : ${neigeFixe[iFutur[i]]} cm)`);
  }
  if (!DRY_RUN) {
    const serie = (nom) => iFutur.map((i) => data.daily?.[nom]?.[i] ?? null);
    console.log(`Journal neige : ${journaliserPrevision(jour, datesFutur, neigeFutur, {
      annexes: { mm: serie("precipitation_sum"), pluie: serie("rain_sum"), tMoy: serie("temperature_2m_mean"),
        cmFixe: iFutur.map((i) => neigeFixe[i]) },
    })} ligne(s) ajoutée(s).`);
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
  const retenir = (d) => enSaison(d) || IGNORER_SAISON;
  const inconnus = new Set(dates.filter((_, i) => typeof neige[i] !== "number" || !Number.isFinite(neige[i])));
  let decisions = decider(episodes, avant, {
    jour, seuil: SEUIL_CM, ...regl, memoire: JOURS_PASSES, inconnus,
    // Dernier jour de l'horizon du modèle : exclu pour une nouvelle alerte (D-002).
    horizon: dates.at(-1),
  });
  if (SEUIL_FORCE) {
    decisions = decisions.filter((d) => d.type !== "annule" && d.type !== "decale");
    console.log("Seuil forcé : ni annulation ni état écrit.");
  }
  const aEnvoyer = decisions.filter((d) => d.type);

  console.log(`\nÀ notifier : ${aEnvoyer.length}`);
  for (const d of aEnvoyer) console.log(`  [${d.type}] ${notification(d).corps.split("\n")[0]}`);

  const ecran = {
    maj: new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ""),
    lieu: LIEU,
    ...ecranNeige(episodes, dates, neige, decisions, {
      jour, seuil: SEUIL_CM, hausse: regl.hausse, minAffichage: regl.affichage, retenir,
    }),
  };
  console.log(`\nÉcran : ${JSON.stringify(ecran)}`);

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
        ignorerSilence: SEUIL_FORCE,
      });
      if (!ok) garde = d.record;
      // Message parti : journalisé pour le verdict QA (D-003). Un seuil forcé est un
      // test, il n'y entre pas. Une panne du journal rend le run rouge sans toucher à
      // l'état : l'alerte ne repart pas.
      else if (!SEUIL_FORCE) {
        try {
          journaliserEnvoi(d, { jour, seuil: SEUIL_CM });
        } catch (err) {
          console.error(`ECHEC journal des alertes neige : ${err.message}`);
          process.exitCode = 1;
        }
      }
    }
    if (garde) apres.push(garde);
  }

  if (!SEUIL_FORCE && JSON.stringify(apres) !== JSON.stringify(avant)) sauverEtat(apres);
  // Un seuil forcé de test ne doit pas s'afficher.
  if (!SEUIL_FORCE) ecrireEcran(ecran);
  // Après les envois : une panne ou une lenteur de ce journal ne retarde aucune alerte.
  await journaliserLong(url, jour);
}

main()
  .then(sortieSiEchecs)
  .catch((err) => {
    console.error("Erreur inattendue :", err.message);
    console.log("Aucune alerte envoyée.");
    process.exitCode = 1;
  });
