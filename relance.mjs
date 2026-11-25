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
//       de relance a réussi), HEURE.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { local, finDu } from './silence.mjs';

export const ATTENTE_DEFAUT_MIN = 40;
export const ATTENTE_BORNES_MIN = [30, 60];
export const FENETRE_H = 2;
export const CRONS_UTC = ['04:23', '15:23'];

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
  const l = local(new Date(maintenant.getTime() + attente * 6e4));
  const heure = l.hhmm.replace(/^0/, '').replace(':', 'h');
  return { relancer: true, attente, heure,
    raison: `relance dans ${attente} min, vers ${l.hhmm} (heure suisse), sur un autre runner` };
}

// { vert, texte } : couleur finale d'un run dont l'étape d'alerte a échoué (D-009).
export function verdict({ seule = false, programmee = false, heure = '' } = {}) {
  if (programmee && seule) {
    return { vert: true, texte: `Open-Meteo refusé, relance à ${heure || '?'} : la relance dira si l'alerte est rattrapée.` };
  }
  if (programmee) {
    return { vert: false, texte: 'Relance programmée, mais le run a aussi échoué pour une autre raison (voir le journal).' };
  }
  return { vert: false, texte: 'Étape d\'alerte en échec, aucune relance programmée : évaluation neige perdue pour ce run.' };
}

function principalVerdict() {
  const { RELANCE_SEULE, PROGRAMMEE, HEURE, GITHUB_STEP_SUMMARY } = process.env;
  const v = verdict({ seule: RELANCE_SEULE === 'true', programmee: PROGRAMMEE === 'true', heure: HEURE });
  console.log(v.vert ? `::warning title=Open-Meteo refusé::${v.texte}` : `::error title=alerte neige::${v.texte}`);
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `**${v.texte}**\n\n`);
  process.exitCode = v.vert ? 0 : 1;
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
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `attente_min=${d.attente}\n` + (d.heure ? `heure=${d.heure}\n` : ''));
  process.exitCode = d.relancer ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'verdict') principalVerdict();
  else await principal();
}
