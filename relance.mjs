// relance.mjs — relance du run « neige annoncée » après un refus d'Open-Meteo (D-008,
// Décision 2, Greg 24.11.2026).
//
// Le run échoue sur Open-Meteo (HTTP 429, 5xx ou injoignable) : snow-forecast-alert.mjs
// écrit relance=true, puis le workflow appelle ce script. Une seule relance par échec,
// RELANCE_NEIGE_MIN minutes plus tard (40 par défaut, entre 30 et 60), dans un nouveau run,
// donc sur un autre runner (le 429 vient de l'adresse partagée du runner). Pas de relance :
//   - d'une relance (au plus une par échec) ;
//   - si un run planifié tombe dans les FENETRE_H heures qui suivent : il fera le travail.
// Runs planifiés (Worker Cloudflare, worker/wrangler.toml ; cron GitHub de secours) :
// 04:23 et 15:23 UTC, et le réveil après le silence à HH:03, HH = fin du silence du jour,
// heure de Genève (silence.mjs, D-006).
//
// Sortie : code 0 = relancer, 3 = ne pas relancer ; la raison va dans le résumé du job.
// Env : RELANCE (1 si ce run est déjà une relance), RELANCE_NEIGE_MIN, GITHUB_STEP_SUMMARY,
//       GITHUB_OUTPUT (attente_min, heure = heure suisse de la relance, « 6h04 »).
//
// `node relance.mjs verdict` (D-009, Greg 25.11.2026) : couleur finale du run quand l'étape
// d'alerte a échoué. Vert avec un avertissement seulement si une relance est programmée et
// que le refus d'Open-Meteo est la seule cause d'échec ; sinon rouge (code 1). La relance
// devient le juge : si elle échoue à son tour, elle est rouge.
// Env : RELANCE_SEULE (true : le refus est la seule cause), PROGRAMMEE (true : la commande
//       de relance a réussi), HEURE, ALERTE (issue de l'étape d'alerte), ORPHELINE (D-010).
//
// Relances orphelines (D-010, Greg 26.11.2026) : toute évaluation perdue produit un mail.
// `node relance.mjs inscrire` (après une commande de relance réussie) écrit
// FICHIER_INSCRIPTION : heure prévue de la relance et run d'origine. `node relance.mjs
// controle` (après l'étape d'alerte de chaque run) l'efface quand une évaluation a eu lieu
// (ce run est la relance inscrite, ou son alerte a réussi). Si l'heure prévue est dépassée de
// plus de MARGE_ORPHELINE_MIN sans évaluation, il l'efface aussi et sort orpheline=<message> :
// le Verdict rend le run rouge. DRY_RUN et seuil forcé (essais) n'écrivent ni n'effacent rien.
// Env inscrire : ORIGINE (run courant), PREVUE (sortie prevue= de relance.mjs), ATTENTE_MIN
//                (si PREVUE manque), DRY_RUN.
// Env controle : ALERTE, DRY_RUN, SEUIL_FORCE, RELANCE, RUN_ORIGINE, GITHUB_OUTPUT,
//                GITHUB_STEP_SUMMARY.

import { appendFileSync, existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { local, finDu } from './silence.mjs';

export const ATTENTE_DEFAUT_MIN = 40;
export const ATTENTE_BORNES_MIN = [30, 60];
export const FENETRE_H = 2;
export const CRONS_UTC = ['04:23', '15:23'];
export const FICHIER_INSCRIPTION = 'data/relance-neige.json';
// Marge après l'heure prévue : la relance évalue vers l'heure prévue + 2 à 4 min (checkout,
// tests) ; au-delà de 30 min, elle n'a jamais tourné.
export const MARGE_ORPHELINE_MIN = 30;

// « 6h04 », heure suisse ; avec la date (« 6h04 (26.11) ») si demandé.
export function hm(d, avecJour = false) {
  const l = local(d);
  const h = l.hhmm.replace(/^0/, '').replace(':', 'h');
  return avecJour ? `${h} (${l.jour.slice(8, 10)}.${l.jour.slice(5, 7)})` : h;
}

// Premier run planifié dans les `horizonMin` minutes qui suivent `maintenant`, ou null.
export function prochainRunPrevu(maintenant, horizonMin = FENETRE_H * 60) {
  const base = Math.floor(maintenant.getTime() / 6e4) * 6e4;
  for (let m = 1; m <= horizonMin; m++) {
    const d = new Date(base + m * 6e4);
    if (CRONS_UTC.includes(d.toISOString().slice(11, 16))) return d;
    const l = local(d);
    if (l.hhmm === `${finDu(l.jour).slice(0, 2)}:03`) return d;
  }
  return null;
}

// Attente en minutes : la variable si elle est un nombre dans les bornes, sinon le défaut.
export function attenteMin(valeur) {
  const n = Number(String(valeur ?? '').trim());
  const [a, b] = ATTENTE_BORNES_MIN;
  return String(valeur ?? '').trim() !== '' && Number.isFinite(n) && n >= a && n <= b ? n : ATTENTE_DEFAUT_MIN;
}

// { relancer, attente, raison }
export function decider({ maintenant = new Date(), dejaRelance = false, attente = ATTENTE_DEFAUT_MIN } = {}) {
  if (dejaRelance) return { relancer: false, attente, raison: 'ce run est déjà une relance : pas d\'autre relance' };
  const p = prochainRunPrevu(maintenant);
  if (p) {
    const l = local(p);
    return { relancer: false, attente, raison: `run planifié à ${l.hhmm} (heure suisse), dans moins de ${FENETRE_H} h : pas de relance` };
  }
  const prevue = new Date(maintenant.getTime() + attente * 6e4);
  const l = local(prevue);
  return { relancer: true, attente, heure: hm(prevue), prevue,
    raison: `relance dans ${attente} min, vers ${l.hhmm} (heure suisse), sur un autre runner` };
}

// Inscription d'une relance programmée (D-010). `prevue` (ISO, sortie de relance.mjs) garde
// la même heure que l'avertissement ; à défaut, maintenant + attente.
export function inscription({ maintenant = new Date(), origine, attente, prevue = '' }) {
  const p = prevue && !Number.isNaN(new Date(prevue).getTime()) ? new Date(prevue) : new Date(maintenant.getTime() + attente * 6e4);
  return { origine: String(origine ?? ''), prevue: p.toISOString(), depuis: maintenant.toISOString() };
}

// { effacer, orpheline, note } : que faire de l'inscription après l'étape d'alerte (D-010).
// insc = objet lu, null (pas de fichier) ou undefined (fichier illisible).
export function controler({ insc, maintenant = new Date(), alerteOk = false, essai = false,
  estRelance = false, origineRun = '', marge = MARGE_ORPHELINE_MIN } = {}) {
  if (insc === null) return { effacer: false, orpheline: '', note: '' };
  const prevue = insc ? new Date(insc.prevue) : null;
  const lisible = Boolean(insc && insc.origine && prevue && !Number.isNaN(prevue.getTime()));
  const enRetard = lisible && maintenant.getTime() > prevue.getTime() + marge * 6e4;
  if (essai) {
    return { effacer: false, orpheline: '',
      note: !lisible ? `inscription illisible (${FICHIER_INSCRIPTION}), essai : rien effacé`
        : enRetard ? `relance prévue à ${hm(prevue)} jamais terminée (run d'origine ${insc.origine}), essai : rien effacé ni signalé`
          : '' };
  }
  if (!lisible) {
    return { effacer: true, note: '',
      orpheline: `Inscription de relance illisible (${FICHIER_INSCRIPTION}) : impossible de savoir si une évaluation neige a été perdue.` };
  }
  if (estRelance && origineRun === insc.origine) {
    return { effacer: true, orpheline: '', note: 'ce run est la relance inscrite, il rend le verdict' };
  }
  if (enRetard) {
    const depuis = new Date(insc.depuis);
    const debutD = Number.isNaN(depuis.getTime()) ? prevue : depuis;
    const jour = local(maintenant).jour;
    const jours = local(debutD).jour !== jour || local(prevue).jour !== jour;
    return { effacer: true, note: '',
      orpheline: `Relance prévue à ${hm(prevue, jours)} jamais terminée (run d'origine ${insc.origine}) : aucune évaluation neige entre ${hm(debutD, jours)} et ${hm(maintenant, jours)}.` };
  }
  if (alerteOk) return { effacer: true, orpheline: '', note: 'évaluation réussie, la relance n\'est plus nécessaire' };
  return { effacer: false, orpheline: '', note: `relance prévue à ${hm(prevue)} toujours attendue` };
}

// { vert, texte } : couleur finale d'un run dont l'étape d'alerte a échoué (D-009) ou qui a
// trouvé une relance orpheline (D-010 : toujours rouge).
// alerte = issue de l'étape d'alerte (success, failure, skipped).
export function verdict({ seule = false, programmee = false, heure = '', orpheline = '', alerte = 'failure' } = {}) {
  if (orpheline) {
    const suite = alerte === 'success' ? 'Ce run a fait l\'évaluation.'
      : alerte === 'skipped' ? 'L\'étape d\'alerte de ce run n\'a pas tourné (étape précédente en échec).'
        : verdict({ seule, programmee, heure }).texte;
    return { vert: false, texte: `${orpheline} ${suite}` };
  }
  if (programmee && seule) {
    return { vert: true, texte: `Open-Meteo refusé, relance à ${heure || '?'} : la relance dira si l'alerte est rattrapée.` };
  }
  if (programmee) {
    return { vert: false, texte: 'Relance programmée, mais le run a aussi échoué pour une autre raison (voir le journal).' };
  }
  return { vert: false, texte: 'Étape d\'alerte en échec, aucune relance programmée : évaluation neige perdue pour ce run.' };
}

function principalVerdict() {
  const { RELANCE_SEULE, PROGRAMMEE, HEURE, ALERTE, ORPHELINE, GITHUB_STEP_SUMMARY } = process.env;
  const v = verdict({ seule: RELANCE_SEULE === 'true', programmee: PROGRAMMEE === 'true', heure: HEURE,
    orpheline: ORPHELINE || '', alerte: ALERTE || 'failure' });
  console.log(v.vert ? `::warning title=Open-Meteo refusé::${v.texte}` : `::error title=alerte neige::${v.texte}`);
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `**${v.texte}**\n\n`);
  process.exitCode = v.vert ? 0 : 1;
}

function principalInscrire() {
  const { ORIGINE, ATTENTE_MIN, PREVUE, DRY_RUN } = process.env;
  if (DRY_RUN === 'true') { console.log('DRY_RUN : relance non inscrite.'); return; }
  const i = inscription({ origine: ORIGINE, attente: attenteMin(ATTENTE_MIN), prevue: PREVUE });
  if (!i.origine) throw new Error('ORIGINE absente : relance non inscrite');
  mkdirSync(dirname(FICHIER_INSCRIPTION), { recursive: true });
  writeFileSync(FICHIER_INSCRIPTION, JSON.stringify(i, null, 2) + '\n');
  console.log(`Relance inscrite (${FICHIER_INSCRIPTION}) : prévue à ${hm(new Date(i.prevue))}.`);
}

function principalControle() {
  const { ALERTE, DRY_RUN, SEUIL_FORCE, RELANCE, RUN_ORIGINE, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  let insc = null;
  if (existsSync(FICHIER_INSCRIPTION)) {
    try { insc = JSON.parse(readFileSync(FICHIER_INSCRIPTION, 'utf8')); } catch { insc = undefined; }
    if (!insc || typeof insc !== 'object') insc = undefined;
  }
  const c = controler({ insc, alerteOk: ALERTE === 'success', essai: DRY_RUN === 'true' || Boolean(SEUIL_FORCE),
    estRelance: RELANCE === '1', origineRun: RUN_ORIGINE || '' });
  if (c.effacer) unlinkSync(FICHIER_INSCRIPTION);
  const texte = c.orpheline || (c.note ? `Relance inscrite : ${c.note}${c.effacer ? ' (inscription effacée)' : ''}.` : '');
  // Orpheline : texte simple ici ; l'erreur et le résumé viennent de l'étape Verdict.
  if (texte) console.log(c.orpheline ? `Relance orpheline : ${texte} (run rouge à l'étape Verdict)` : texte);
  if (texte && !c.orpheline && GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `**${texte}**\n\n`);
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `orpheline=${c.orpheline.replace(/[\r\n]+/g, ' ')}\n`);
}

async function principal() {
  const { RELANCE, RELANCE_NEIGE_MIN, GITHUB_STEP_SUMMARY, GITHUB_OUTPUT } = process.env;
  const brut = RELANCE_NEIGE_MIN;
  const attente = attenteMin(brut);
  if (brut && String(brut).trim() !== '' && attente !== Number(brut)) {
    console.log(`RELANCE_NEIGE_MIN = « ${brut} » hors de ${ATTENTE_BORNES_MIN.join('-')} min : ${attente} min utilisées.`);
  }
  const d = decider({ dejaRelance: RELANCE === '1', attente });
  const texte = `Refus d'Open-Meteo : ${d.raison}.`;
  console.log(texte);
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `**${texte}**\n\n`);
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `attente_min=${d.attente}\n`
    + (d.heure ? `heure=${d.heure}\nprevue=${d.prevue.toISOString()}\n` : ''));
  process.exitCode = d.relancer ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'verdict') principalVerdict();
  else if (process.argv[2] === 'inscrire') principalInscrire();
  else if (process.argv[2] === 'controle') principalControle();
  else await principal();
}
