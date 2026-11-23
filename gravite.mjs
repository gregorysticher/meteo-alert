// gravite.mjs — deux niveaux de gravité pour les runs (D-007, décidé par Greg le 23.11.2026).
//
// critique   : ce dont dépend la décision ou la livraison : la source de prévision ou de
//              mesure de l'alerte, l'envoi ntfy, le webhook TRMNL, l'état anti-spam et son
//              commit. S'y ajoutent les réglages invalides et les erreurs de code. Run rouge,
//              donc e-mail. Les scripts gardent leur propre « process.exitCode = 1 » pour ces
//              cas ; critique() sert à l'escalade ci-dessous.
// informatif : ce qui n'enrichit que le message, l'écran ou la QA (lac, gradient, AROME,
//              journaux et rapports QA, archives, bulletin d'avalanches, relevés de l'écran).
//              Run vert ; l'avertissement est écrit dans le journal du run (AVERTISSEMENT …)
//              et en annotation GitHub (::warning::), visible sur la page du run.
// Escalade   : une source informative en échec à chaque run où elle est appelée, depuis plus
//              de ESCALADE_H heures, passe au rouge : une panne durable doit se voir, une
//              coupure de 5 minutes non. Le suivi tient dans un fichier par workflow
//              (data/sources-<workflow>.json, commité avec les données : deux workflows
//              n'écrivent jamais le même fichier, donc pas de conflit de rebase). La source
//              repart de zéro dès qu'elle répond.
// Essais     : une source informative n'a qu'un nouvel essai par run (celui de fetchEssai).
//              Si elle est appelée plusieurs fois (lac pour chaque spot, HS pour chaque
//              station), enPanne(source) dit de sauter les appels suivants du même run.
//
// Format du fichier : { "<source>": { "depuis": ISO, "dernier": ISO, "message": "…" } }.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ESCALADE_H = 24;

let fichier = null;
let ecrire = false;
let resume = false;
const echecs = new Map();      // source -> premier message du run
const reussites = new Set();

// fichier : chemin du suivi ; ecrire : false en DRY_RUN (rien n'est écrit) ;
// resume : true si la sortie du script ne va pas déjà dans le résumé du job (tee).
export function initSources(chemin, { ecrire: e = true, resume: r = false } = {}) {
  fichier = chemin;
  ecrire = e;
  resume = r;
  echecs.clear();
  reussites.clear();
}

// Commande GitHub sur une ligne : %, retours à la ligne et « :: » échappés (doc des
// workflow commands). Sur stderr, pour ne pas finir en texte brut dans le résumé (tee).
const echapper = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

// Erreur de programmation, pas panne de source : elle reste critique (rouge tout de
// suite), même dans une étape informative. Une panne réseau de fetch est un TypeError
// AVEC une cause (« fetch failed » + cause.code) : elle reste informative. Un JSON
// illisible (SyntaxError) vient des données, pas du code.
export function erreurDeCode(err) {
  if (!(err instanceof Error)) return false;
  if (err instanceof ReferenceError || err instanceof RangeError) return true;
  return err instanceof TypeError && !err.cause;
}

// probleme : message, ou l'Error attrapée. prefixe : contexte ajouté au message.
export function informatif(source, probleme, prefixe = '') {
  const code = probleme?.cause?.code;
  const brut = probleme instanceof Error
    ? (code && !probleme.message.includes(code) ? `${probleme.message} : ${code}` : probleme.message)
    : probleme;
  const msg = `${prefixe}${String(brut ?? '').trim() || 'échec'}`;
  if (erreurDeCode(probleme)) {
    critique(`${source} : erreur de code (${probleme.name}) : ${msg}`);
    return;
  }
  // Une seule ligne par source et par run : les appels suivants (sautés) ne répètent rien.
  if (echecs.has(source)) return;
  echecs.set(source, msg);
  console.log(`AVERTISSEMENT ${source} : ${msg}`);
  console.error(`::warning title=${echapper(source).replace(/[:,]/g, ' ')}::${echapper(msg)}`);
}

export function sourceOk(source) {
  reussites.add(source);
}

export const enPanne = (source) => echecs.has(source);

export function critique(message) {
  console.error(`ECHEC ${message}`);
  process.exitCode = 1;
}

function lireSuivi() {
  try {
    const j = JSON.parse(readFileSync(fichier, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch (err) {
    if (err.code !== 'ENOENT') console.log(`Suivi des sources illisible (${fichier}) : repart de zéro.`);
    return {};
  }
}

const heure = (d) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// En fin de script. Rend la liste des sources passées au rouge (escalade).
export function bilanSources(maintenant = new Date()) {
  if (!fichier) return [];
  const suivi = lireSuivi();
  const avant = JSON.stringify(suivi);
  const rouges = [];
  for (const [source, message] of echecs) {
    // Panne « de suite » : si la source n'a pas été appelée depuis plus de ESCALADE_H
    // (hors saison, alerte rare), l'ancienne série est close et une nouvelle commence.
    const e = suivi[source];
    const dernier = e?.dernier ? Date.parse(e.dernier) : NaN;
    const continue_ = Number.isFinite(dernier) && (maintenant - dernier) / 36e5 <= ESCALADE_H;
    const depuis = continue_ && e?.depuis ? new Date(e.depuis) : maintenant;
    const d = Number.isFinite(depuis.getTime()) ? depuis : maintenant;
    suivi[source] = { depuis: d.toISOString(), dernier: maintenant.toISOString(), message };
    if ((maintenant - d) / 36e5 > ESCALADE_H) {
      critique(`${source} en panne depuis plus de ${ESCALADE_H} h (depuis ${heure(d)}) : ${message}`);
      rouges.push(source);
    }
  }
  for (const source of reussites) {
    if (!echecs.has(source)) delete suivi[source];
  }
  if (echecs.size) {
    const lignes = [...echecs].map(([s, m]) => `- ${s} : ${m}`);
    console.log(`\n${echecs.size} source(s) informative(s) en échec (run vert sauf escalade) :\n${lignes.join('\n')}`);
    if (resume && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `\n**Sources informatives en échec**\n\n${lignes.join('\n')}\n`);
    }
  }
  if (ecrire && JSON.stringify(suivi) !== avant) {
    mkdirSync(dirname(fichier), { recursive: true });
    writeFileSync(fichier, JSON.stringify(suivi, null, 2) + '\n');
  }
  return rouges;
}
