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
// Hors saison : sortie propre. EN saison, une source muette (API en erreur,
// station absente, relevé trop ancien, HN_1D invalide) fait ÉCHOUER le run :
// une alerte aveugle ne doit jamais passer en vert (cf. alerte annoncée,
// aveugle du 15/10 au 07/11/2026 sous des runs verts).
//
// Env requis  : NTFY_TOPIC_NEIGE
// Env optionnel :
//   DRY_RUN=true         → analyse sans notifier ni écrire
//   SEUIL_CM=10          → abaisse le seuil (test) ; 0 est accepté
//   IGNORER_SAISON=true  → force l'analyse hors saison (test en été)

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { notifier, sortieSiEchecs } from "./notify.mjs";
import { fetchEssai } from "./reseau.mjs";
import { initSources, informatif, sourceOk, enPanne, bilanSources } from "./gravite.mjs";
import { journaliserMesures, journaliserHs, lire, rapport } from "./snow-qa.mjs";
import { lireEnvois, mesuresReference, verdicts, ecrireVerdicts, rapport as rapportVerdicts } from "./snow-verdict.mjs";

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
// Voisines journalisées seulement : Loz, L'Ecreuleuse, Col de Bretaye (14 à 24 km).
const VOISINES = ["GRA2", "FNH2", "CHA3"];

const SEUIL_CM = nombreOuDefaut(process.env.SEUIL_CM, 20);   // neige fraîche 24 h

// Âge maximal accepté pour le relevé le plus récent. 2 jours couvre le cas
// d'un run tombant avant la publication du jour ; au-delà, la station est
// probablement muette et on ne notifie pas sur une valeur périmée.
const AGE_MAX_JOURS = 2;

// Saison hivernale : 15 oct → 15 avr (MMDD)
const SAISON_DEBUT = 1015;
const SAISON_FIN = 415;

const API = "https://measurement-api.slf.ch/public/api/imis/daily-snow";
// Mesures à la demi-heure d'une station (HS, TA...) : les 7 jours que le SLF garde,
// pour qu'un run sauté ou en retard ne laisse pas de trou.
const API_STATION = (code) =>
  `https://measurement-api.slf.ch/public/api/imis/station/${code}/measurements?period_in_days=7`;
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
  // Sources informatives (gravite.mjs, D-007) : journal, rapport, QA et archive HS.
  // L'API SLF du relevé ILI2, dont dépend l'alerte, reste critique.
  initSources("data/sources-neige-fraiche.json", { ecrire: !DRY_RUN, resume: true });
  const jour = aujourdhuiLocal();
  console.log(`${STATION_NOM} (${STATION}, ${STATION_ALT} m) · seuil ${SEUIL_CM} cm`);
  console.log(`Date locale : ${jour}\n`);

  if (!enSaison(jour) && !IGNORER_SAISON) {
    console.log("Hors saison hivernale (15 oct → 15 avr) — aucune vérification.");
    return;
  }
  if (IGNORER_SAISON) console.log("*** IGNORER_SAISON actif ***\n");

  // Toute erreur réseau ou format inattendu : aucune alerte, run rouge.
  // period_in_days n'accepte que 1, 3 ou 7 (vérifié : toute autre valeur
  // renvoie un 422). On prend 3 pour couvrir un run tombant avant la
  // publication du relevé du jour.
  let releves;
  try {
    const res = await fetchEssai(`${API}?period_in_days=3`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`API SLF indisponible (HTTP ${res.status}) — aucune alerte.`);
      process.exitCode = 1;
      return;
    }
    const data = await res.json();
    releves = Array.isArray(data) ? data : [];
  } catch (err) {
    console.log(`Erreur d'accès à l'API SLF : ${err.message} — aucune alerte.`);
    process.exitCode = 1;
    return;
  }

  const mesures = releves
    .filter((r) => r.station_code === STATION)
    .sort((a, b) => String(b.measure_date).localeCompare(String(a.measure_date)));

  console.log(`Relevés pour ${STATION} : ${mesures.length}`);
  for (const m of mesures) {
    console.log(`  ${m.measure_date} · HS=${m.HS} · HN_1D=${m.HN_1D}`);
  }

  // Journal et rapport QA : leur panne n'empêche pas l'alerte (avertissement).
  if (!DRY_RUN) {
    try {
      const n = journaliserMesures(releves
        .filter((m) => m.station_code === STATION || VOISINES.includes(m.station_code))
        .map((m) => ({
          jour: String(m.measure_date).slice(0, 10), cm: m.HN_1D,
          station: m.station_code, hs: m.HS,
        })));
      console.log(`Journal neige : ${n} ligne(s) ajoutée(s).`);
      sourceOk("journal neige");
    } catch (err) {
      informatif("journal neige", err);
    }
  }
  try {
    console.log("\n" + rapport(lire()));
    sourceOk("rapport QA neige");
  } catch (err) {
    informatif("rapport QA neige", err);
  }

  if (mesures.length === 0) {
    console.log("\nAucun relevé pour cette station — aucune alerte.");
    process.exitCode = 1;
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
    process.exitCode = 1;
    return;
  }

  // Station hors service, capteur en panne, valeur aberrante : on ne fait rien
  if (typeof hn !== "number" || !Number.isFinite(hn) || hn < 0) {
    console.log(`Neige fraîche indisponible (HN_1D = ${hn}) — aucune alerte.`);
    process.exitCode = 1;
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

// ══════ QA NEIGE (D-003) ══════
// Après l'alerte, et quel qu'en soit le sort : verdict des alertes neige annoncées
// envoyées (snow-verdict.mjs) et archive des HS à la demi-heure. Information
// seulement (D-007) : une panne donne un avertissement, rouge après 24 h.
async function qaNeige() {
  const jour = aujourdhuiLocal();
  if (!enSaison(jour) && !IGNORER_SAISON) return;
  try {
    const lignes = lire();
    const mesures = mesuresReference(lignes);
    let pct = nombreOuDefaut(process.env.HAUSSE_PCT, 30);
    if (!(pct >= 0 && pct <= 100)) {
      console.error(`Variable invalide : HAUSSE_PCT = ${pct} — défaut 30 utilisé pour le verdict.`);
      process.exitCode = 1;
      pct = 30;
    }
    const tolerance = pct / 100;
    const qa = verdicts(lireEnvois(), mesures, { jour, tolerance });
    if (!DRY_RUN) ecrireVerdicts(qa);
    const texte = rapportVerdicts(qa, lignes, mesures, { jour });
    console.log("\n" + texte);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, texte + "\n");
    sourceOk("QA alertes neige");
  } catch (err) {
    informatif("QA alertes neige", err);
  }
  if (DRY_RUN) return;
  // API SLF injoignable (réseau, 5xx, 429) après son nouvel essai : les stations suivantes
  // sont sautées dans ce run. Une réponse propre à une station (4xx, contenu inattendu)
  // est suivie sous le nom de la station, sans couper les autres.
  let n = 0;
  for (const code of [STATION, ...VOISINES]) {
    if (enPanne("archive HS (SLF)")) {
      console.log(`Archive HS ${code} sautée : SLF en panne dans ce run.`);
      continue;
    }
    let res;
    try {
      res = await fetchEssai(API_STATION(code), { headers: { Accept: "application/json" } });
    } catch (err) {
      informatif("archive HS (SLF)", err, `${code} : `);
      continue;
    }
    if (res.status >= 500 || res.status === 429) {
      informatif("archive HS (SLF)", `${code} : HTTP ${res.status}`);
      continue;
    }
    sourceOk("archive HS (SLF)");
    try {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("réponse inattendue");
      n += journaliserHs(data.filter((r) => r.station_code === code));
      sourceOk(`archive HS ${code}`);
    } catch (err) {
      informatif(`archive HS ${code}`, err);
    }
  }
  console.log(`Archive HS à la demi-heure : ${n} ligne(s) ajoutée(s).`);
}

main()
  .then(qaNeige)
  .then(() => bilanSources())
  .then(sortieSiEchecs)
  .catch((err) => {
    // Filet de sécurité : erreur imprévue = alerte aveugle = run rouge.
    console.error("Erreur inattendue :", err.message);
    console.log("Aucune alerte envoyée.");
    process.exitCode = 1;
  });
