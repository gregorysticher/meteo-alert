// Alerte neige fraîche mesurée — station IMIS ILI2 "Les Collines" (2022 m).
//
// Source : API publique du SLF, endpoint daily-snow.
//   HS     = hauteur de neige totale au sol
//   HN_1D  = neige fraîche des dernières 24 h (modélisée SNOWPACK)
//
// HEURE D'EXÉCUTION : le script ne suppose plus que le relevé du jour existe
// déjà. Le SLF publie une valeur journalière par date (measure_date à 00:00),
// alimentée par des stations qui transmettent toutes les 30 min et un modèle
// SNOWPACK qui tourne toutes les heures ; la mesure de référence suisse est
// celle du matin (7h-7h30). L'heure exacte de publication n'est pas documentée,
// et de toute façon les runs GitHub planifiés partent avec 4 à 7 h de retard :
// caler le cron sur une heure supposée serait fragile. On interroge donc 3
// jours et on prend le relevé le plus récent, quel que soit le moment du run.
// L'anti-spam est indexé sur la date du relevé, donc un relevé déjà notifié
// ne repart pas quand celui du lendemain arrive.
//
// Saison : 15 octobre → 15 avril (inverse de l'alerte vent).
// Hors saison, ou si la station ne renvoie pas de données : sortie propre,
// aucune alerte, aucun échec.
//
// Env requis  : NTFY_TOPIC_NEIGE
// Env optionnel :
//   DRY_RUN=true         → analyse sans notifier ni écrire
//   SEUIL_CM=10          → abaisse le seuil (test) ; 0 est accepté
//   IGNORER_SAISON=true  → force l'analyse hors saison (test en été)

import { readFileSync, writeFileSync, existsSync } from "fs";
import { notifier, sortieSiEchecs } from "./notify.mjs";

// ══════ OUTILS DE CONFIGURATION ══════
// "Number(x) || defaut" rejetterait un seuil de 0, qui est justement la
// valeur utile pour tester la chaîne d'envoi hors saison (HN_1D vaut 0 en
// été). On ne retombe sur le défaut que si la variable est absente, vide
// ou non numérique.
function nombreOuDefaut(valeur, defaut) {
  if (valeur === undefined || valeur === null || String(valeur).trim() === "") {
    return defaut;
  }
  const n = Number(valeur);
  return Number.isFinite(n) ? n : defaut;
}

// ══════ PARAMÈTRES ══════
const STATION = "ILI2";
const STATION_NOM = "Les Collines";
const STATION_ALT = 2022;

const SEUIL_CM = nombreOuDefaut(process.env.SEUIL_CM, 20);   // neige fraîche 24 h

// Âge maximal accepté pour le relevé le plus récent. 2 jours couvre le cas
// d'un run tombant avant la publication du jour ; au-delà, la station est
// probablement muette et on ne notifie pas sur une valeur périmée.
const AGE_MAX_JOURS = 2;

// Saison hivernale : 15 oct → 15 avr (MMDD)
const SAISON_DEBUT = 1015;
const SAISON_FIN = 415;

const API = "https://measurement-api.slf.ch/public/api/imis/daily-snow";
const ETAT_FILE = "snow-fresh-alerted.json";
const TZ = "Europe/Zurich";

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

// Saison à cheval sur le nouvel an : vrai si md >= 1015 OU md <= 415
function enSaison(jourISO) {
  const md =
    parseInt(jourISO.slice(5, 7), 10) * 100 + parseInt(jourISO.slice(8, 10), 10);
  return md >= SAISON_DEBUT || md <= SAISON_FIN;
}

function ecartJours(jourA, jourB) {
  const a = Date.parse(`${jourA}T00:00:00Z`);
  const b = Date.parse(`${jourB}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
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

function sauverEtat(alerted) {
  // On ne garde que les 30 dernières entrées, largement suffisant
  const propre = alerted.slice(-30);
  writeFileSync(
    ETAT_FILE,
    JSON.stringify({ alerted: propre, updatedAt: new Date().toISOString() }, null, 2) + "\n"
  );
  console.log(`${ETAT_FILE} mis à jour (${propre.length} entrée(s)).`);
}

// ══════ MAIN ══════
async function main() {
  const jour = aujourdhuiLocal();
  console.log(`${STATION_NOM} (${STATION}, ${STATION_ALT} m) · seuil ${SEUIL_CM} cm`);
  console.log(`Date locale : ${jour}\n`);

  if (!enSaison(jour) && !IGNORER_SAISON) {
    console.log("Hors saison hivernale (15 oct → 15 avr) — aucune vérification.");
    return;
  }
  if (IGNORER_SAISON) console.log("*** IGNORER_SAISON actif ***\n");

  // Toute erreur réseau ou format inattendu : on sort proprement, sans alerte.
  // period_in_days n'accepte que 1, 3 ou 7 (vérifié : toute autre valeur
  // renvoie un 422). On prend 3 pour couvrir un run tombant avant la
  // publication du relevé du jour.
  let releves;
  try {
    const res = await fetch(`${API}?period_in_days=3`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`API SLF indisponible (HTTP ${res.status}) — aucune alerte.`);
      return;
    }
    const data = await res.json();
    releves = Array.isArray(data) ? data : [];
  } catch (err) {
    console.log(`Erreur d'accès à l'API SLF : ${err.message} — aucune alerte.`);
    return;
  }

  const mesures = releves
    .filter((r) => r.station_code === STATION)
    .sort((a, b) => String(b.measure_date).localeCompare(String(a.measure_date)));

  console.log(`Relevés pour ${STATION} : ${mesures.length}`);
  for (const m of mesures) {
    console.log(`  ${m.measure_date} · HS=${m.HS} · HN_1D=${m.HN_1D}`);
  }

  if (mesures.length === 0) {
    console.log("\nAucun relevé pour cette station — aucune alerte.");
    return;
  }

  const dernier = mesures[0];
  const hn = dernier.HN_1D;
  const hs = dernier.HS;
  const dateMesure = String(dernier.measure_date).slice(0, 10);
  const age = ecartJours(jour, dateMesure);

  console.log(`\nRelevé le plus récent : ${dateMesure} (${age} j)`);

  // Run tombé avant la publication du jour : on travaille sur la veille,
  // c'est normal. Au-delà, la source est muette et on s'abstient.
  if (age > AGE_MAX_JOURS) {
    console.log(
      `Relevé trop ancien (plus de ${AGE_MAX_JOURS} j) — station probablement muette, aucune alerte.`
    );
    return;
  }

  // Station hors service, capteur en panne, valeur aberrante : on ne fait rien
  if (typeof hn !== "number" || !Number.isFinite(hn) || hn < 0) {
    console.log(`Neige fraîche indisponible (HN_1D = ${hn}) — aucune alerte.`);
    return;
  }

  console.log(`${hn} cm de neige fraîche`);

  if (hn < SEUIL_CM) {
    console.log(`Sous le seuil de ${SEUIL_CM} cm — aucune alerte.`);
    return;
  }

  const id = `${dateMesure}|${hn}`;
  const etat = chargerEtat();

  if (etat.alerted.includes(id)) {
    console.log("Déjà notifié pour ce relevé — aucune nouvelle alerte.");
    return;
  }

  const titre = `Neige fraîche — ${STATION_NOM}`;
  const corps =
    `${hn} cm en 24 h\n` +
    (typeof hs === "number" ? `Manteau total ${hs} cm · ` : "") +
    `${STATION_ALT} m · relevé du ${dateMesure.slice(8, 10)}.${dateMesure.slice(5, 7)}`;

  console.log(`\nÀ notifier : ${titre} — ${corps.replace(/\n/g, " | ")}`);

  if (DRY_RUN) {
    console.log("\n*** DRY_RUN — aucune notif envoyée, aucun état écrit ***");
    return;
  }

  // On ne mémorise que si l'envoi a réussi, sinon le relevé serait considéré
  // comme notifié alors que rien n'est parti.
  if (await notifier(NTFY_TOPIC, titre, corps, { priorite: "high", tags: ["snowflake"] })) {
    etat.alerted.push(id);
    sauverEtat(etat.alerted);
  }
}

main()
  .then(sortieSiEchecs)
  .catch((err) => {
    // Filet de sécurité : on ne veut jamais un job rouge pour une source absente
    console.error("Erreur inattendue :", err.message);
    console.log("Aucune alerte envoyée.");
  });
