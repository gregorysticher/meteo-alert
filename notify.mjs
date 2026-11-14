// Envoi ntfy — module partagé par les trois alertes du repo.
//
// NE PAS repasser aux en-têtes HTTP (Title:, Priority:, Tags:). Les en-têtes
// HTTP sont limités au latin-1 : un tiret cadratin dans le titre fait échouer
// fetch avec "Cannot convert argument to a ByteString ... value of 8212".
// Les trois scripts avaient ce bug ("Neige fraîche — Les Collines",
// "Neige annoncée — Les Collines", "Vent Reposoir — Sa 08.08"), donc aucune
// alerte n'aurait jamais pu partir. Le corps JSON est en UTF-8 : accents,
// tirets cadratins et emoji passent sans problème.
//
// SILENCE NOCTURNE (14.11.2026). Cinq notifications en 48 h pour un seul
// épisode de neige, dont une à 22h27 et une à 05h24. Une chute annoncée pour
// dans deux jours n'a aucune raison de réveiller qui que ce soit.
// Fenêtre : 22h30 → 07h00 un jour ouvré, 22h30 → 08h00 sinon.
// Ce qui tombe dedans n'est PAS mis en file : l'envoi est simplement refusé,
// l'alerte n'est donc pas mémorisée comme envoyée, et le premier run après la
// fenêtre la réévalue avec les données les plus fraîches. Une seule
// notification au réveil, portant la dernière valeur connue — c'est la fusion
// recherchée, sans état supplémentaire à maintenir.

import { fetchEssai } from "./reseau.mjs";

const PRIORITE = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };

const TZ = "Europe/Zurich";
const DEBUT_SILENCE = 22 * 60 + 30; // 22h30
const FIN_OUVRE = 7 * 60; //  7h00
const FIN_REPOS = 8 * 60; //  8h00

// Échecs d'envoi accumulés — le job doit finir en rouge, jamais en silence.
export const echecs = [];

// Notifications refusées par la fenêtre de calme — informatif, pas un échec.
export const differees = [];

function partsLocales(d) {
  const p = new Intl.DateTimeFormat("fr-CH", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(d);
  const v = (t) => p.find((x) => x.type === t).value;
  const jours = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
  return {
    an: +v("year"),
    mois: +v("month"),
    jour: +v("day"),
    minutes: +v("hour") * 60 + +v("minute"),
    semaine: jours[v("weekday").replace(".", "").slice(0, 3).toLowerCase()],
    hhmm: `${v("hour")}:${v("minute")}`,
  };
}

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher), en UTC. */
function paques(an) {
  const a = an % 19;
  const b = Math.floor(an / 100);
  const c = an % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(an, mois - 1, jour));
}

const cle = (d) =>
  `${d.getUTCMonth() + 1}-${d.getUTCDate()}`;

const decale = (d, n) =>
  new Date(d.getTime() + n * 864e5);

/** Jours fériés genevois d'une année. */
function feriesGeneve(an) {
  const p = paques(an);
  const set = new Set([
    "1-1", // Nouvel An
    "8-1", // Fête nationale
    "12-25", // Noël
    "12-31", // Restauration de la République
    cle(decale(p, -2)), // Vendredi-Saint
    cle(decale(p, 1)), // lundi de Pâques
    cle(decale(p, 39)), // Ascension
    cle(decale(p, 50)), // lundi de Pentecôte
  ]);
  // Jeûne genevois : jeudi suivant le premier dimanche de septembre.
  const sept = new Date(Date.UTC(an, 8, 1));
  const premierDim = 1 + ((7 - sept.getUTCDay()) % 7);
  set.add(`9-${premierDim + 4}`);
  return set;
}

/**
 * Jour ouvré = lundi-vendredi hors férié genevois.
 * LIMITE CONNUE : les vacances de Greg ne sont pas détectables ici. La session
 * BRIEFING les lit dans son calendrier Google ; un runner GitHub n'y a pas
 * accès. Un jour de vacances en semaine est donc traité comme ouvré, et le
 * silence s'arrête à 7h00 au lieu de 8h00. Écart d'une heure, assumé.
 */
export function jourOuvre(d = new Date()) {
  const { an, mois, jour, semaine } = partsLocales(d);
  if (semaine === 0 || semaine === 6) return false;
  return !feriesGeneve(an).has(`${mois}-${jour}`);
}

/** Vrai si l'instant tombe dans la fenêtre de calme. */
export function enSilence(d = new Date()) {
  if (process.env.SILENCE_OFF === "1") return false;
  const { minutes } = partsLocales(d);
  if (minutes >= DEBUT_SILENCE) return true; // soirée
  return minutes < (jourOuvre(d) ? FIN_OUVRE : FIN_REPOS); // petit matin
}

/** Heure de reprise, pour les journaux. */
export function finSilence(d = new Date()) {
  const fin = jourOuvre(d) ? FIN_OUVRE : FIN_REPOS;
  return `${String(Math.floor(fin / 60)).padStart(2, "0")}:00`;
}

export async function notifier(topic, titre, corps, opts = {}) {
  const { priorite = "high", tags = [], ignoreSilence = false } = opts;

  if (!ignoreSilence && enSilence()) {
    const { hhmm } = partsLocales(new Date());
    console.log(
      `SILENCE ${hhmm} → ${titre} non envoyé. ` +
        `Réévalué au premier run après ${finSilence()}.`
    );
    differees.push(titre);
    return false; // non mémorisé comme envoyé : repartira avec les données fraîches
  }

  try {
    // Second essai : un ntfy perdu pèse plus qu'un doublon, rare (envoi reçu mais réponse perdue).
    const res = await fetchEssai("https://ntfy.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        title: titre,
        message: corps,
        priority: PRIORITE[priorite] ?? PRIORITE.high,
        tags,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ntfy HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    console.log(`ntfy → ${titre} (HTTP ${res.status})`);
    return true;
  } catch (err) {
    console.error(`ECHEC envoi ntfy (${titre}) : ${err.message}`);
    echecs.push(`${titre} : ${err.message}`);
    return false;
  }
}

// À appeler en fin de script : rend l'échec visible dans Actions.
export function sortieSiEchecs() {
  if (differees.length) {
    console.log(
      `\n${differees.length} notification(s) différée(s) par la fenêtre de ` +
        `calme (reprise ${finSilence()}) :\n- ` + differees.join("\n- ")
    );
  }
  if (echecs.length) {
    console.error(
      `\n${echecs.length} notification(s) non délivrée(s) :\n- ` + echecs.join("\n- ")
    );
    process.exitCode = 1;
  }
}
