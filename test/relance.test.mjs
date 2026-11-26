// relance.mjs (D-008, Décision 2) : une seule relance après un refus d'Open-Meteo, pas si un
// run planifié tombe dans les 2 h.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prochainRunPrevu, decider, attenteMin, ATTENTE_DEFAUT_MIN } from '../relance.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const d = (iso) => new Date(iso);

test('runs planifiés : 04:23 et 15:23 UTC, réveil 8h03 (jour ouvré) ou 9h03 (repos), heure suisse', () => {
  assert.equal(prochainRunPrevu(d('2026-11-24T03:00:00Z'))?.toISOString(), '2026-11-24T04:23:00.000Z');
  assert.equal(prochainRunPrevu(d('2026-11-24T13:30:00Z'))?.toISOString(), '2026-11-24T15:23:00.000Z');
  // Mardi : réveil à 8h03 locales = 07:03 UTC en hiver.
  assert.equal(prochainRunPrevu(d('2026-11-24T05:30:00Z'))?.toISOString(), '2026-11-24T07:03:00.000Z');
  // Samedi 28.11 : 9h03 = 08:03 UTC.
  assert.equal(prochainRunPrevu(d('2026-11-28T06:30:00Z'))?.toISOString(), '2026-11-28T08:03:00.000Z');
  // Été (UTC+2) : réveil 8h03 = 06:03 UTC.
  assert.equal(prochainRunPrevu(d('2027-04-13T05:00:00Z'))?.toISOString(), '2027-04-13T06:03:00.000Z');
  assert.equal(prochainRunPrevu(d('2026-11-24T09:00:00Z')), null);
  // Fenêtre de 2 h : le run de dans 2 h pile compte, celui de dans 2 h 01 non.
  assert.equal(prochainRunPrevu(d('2026-11-24T02:23:00Z'))?.toISOString(), '2026-11-24T04:23:00.000Z');
  assert.equal(prochainRunPrevu(d('2026-11-24T02:22:00Z')), null);
});

test('décision : relance hors des 2 h, pas de relance d\'une relance', () => {
  const r = decider({ maintenant: d('2026-11-24T09:00:00Z'), attente: 40 });
  assert.equal(r.relancer, true);
  assert.match(r.raison, /relance dans 40 min, vers 10:40 \(heure suisse\)/);
  const p = decider({ maintenant: d('2026-11-24T14:00:00Z') });
  assert.equal(p.relancer, false);
  assert.match(p.raison, /run planifié à 16:23/);
  assert.equal(decider({ maintenant: d('2026-11-24T09:00:00Z'), dejaRelance: true }).relancer, false);
});

test('attente : RELANCE_NEIGE_MIN entre 30 et 60, sinon 40', () => {
  assert.equal(attenteMin(''), ATTENTE_DEFAUT_MIN);
  assert.equal(attenteMin(undefined), 40);
  assert.equal(attenteMin('45'), 45);
  assert.equal(attenteMin('10'), 40);
  assert.equal(attenteMin('abc'), 40);
});

test('script : code 0 = relancer, 3 = non ; raison au résumé, attente en sortie', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relance-'));
  try {
    const out = join(dir, 'o'), res = join(dir, 'r');
    writeFileSync(out, ''); writeFileSync(res, '');
    const r = spawnSync(process.execPath, [join(RACINE, 'relance.mjs')], { encoding: 'utf8',
      env: { ...process.env, RELANCE: '1', RELANCE_NEIGE_MIN: '50', GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: res } });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(readFileSync(res, 'utf8'), /déjà une relance/);
    assert.match(readFileSync(out, 'utf8'), /^attente_min=50$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verdict (D-009) : vert seulement si relance programmée et refus seule cause', async () => {
  const { verdict } = await import('../relance.mjs');
  assert.deepEqual(verdict({ seule: true, programmee: true, heure: '6h04' }).vert, true);
  assert.match(verdict({ seule: true, programmee: true, heure: '6h04' }).texte, /^Open-Meteo refusé, relance à 6h04/);
  assert.equal(verdict({ seule: false, programmee: true }).vert, false);
  assert.equal(verdict({ seule: true, programmee: false }).vert, false);
  assert.equal(verdict({}).vert, false);
  assert.equal(decider({ maintenant: d('2026-11-25T04:24:31Z') }).heure, '6h04');
  assert.equal(decider({ maintenant: d('2026-11-25T09:00:00Z'), attente: 60 }).heure, '11h00');
});

test('script verdict : code 0 + ::warning, ou code 1 + ::error', () => {
  const lancerV = (env) => spawnSync(process.execPath, [join(RACINE, 'relance.mjs'), 'verdict'],
    { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env } });
  const v = lancerV({ RELANCE_SEULE: 'true', PROGRAMMEE: 'true', HEURE: '6h04' });
  assert.equal(v.status, 0);
  assert.match(v.stdout, /^::warning title=Open-Meteo refusé::Open-Meteo refusé, relance à 6h04/m);
  const r = lancerV({ RELANCE_SEULE: 'true', PROGRAMMEE: '', HEURE: '' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^::error /m);
});

// Le YAML lui-même (D-009) : sans ces lignes, une étape d'alerte en échec finirait verte,
// sans mail (continue-on-error sans Verdict).
test('workflow neige annoncée : continue-on-error, relance et Verdict câblés', () => {
  const y = readFileSync(join(RACINE, '.github', 'workflows', 'snow-forecast-alert.yml'), 'utf8');
  const etape = (nom) => y.slice(y.indexOf(`- name: ${nom}`)).split(/\n      - name: /)[0];
  assert.match(etape('Vérifier les chutes annoncées'), /^\s+id: alerte\n\s+continue-on-error: true$/m);
  const r = etape('Programmer une relance (refus Open-Meteo)');
  assert.match(r, /id: relance\n\s+if: always\(\) && steps\.alerte\.outcome == 'failure' && steps\.alerte\.outputs\.relance == 'true' && inputs\.relance != '1'/);
  assert.match(r, /\^heure=/);
  assert.match(r, /gh workflow run snow-forecast-alert\.yml[^\n]*\n\s+echo "programmee=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(r, /heure_relance=\$H/);
  // D-010 : inscription juste après la commande de relance réussie.
  assert.match(r, /echo "heure_relance=\$H" >> "\$GITHUB_OUTPUT"\n\s+P=\$\(grep '\^prevue=' "\$GITHUB_OUTPUT" \| tail -1 \| cut -d= -f2\)\n\s+ORIGINE=\$\{\{ github\.run_id \}\} ATTENTE_MIN="\$A" PREVUE="\$P" node relance\.mjs inscrire/);
  const c = etape('Contrôler la relance inscrite');
  assert.match(c, /id: controle\n\s+if: always\(\)\n/);
  for (const l of ['ALERTE: ${{ steps.alerte.outcome }}', 'DRY_RUN: ${{ inputs.dry_run }}', 'SEUIL_FORCE: ${{ inputs.seuil_cm }}',
    'RELANCE: ${{ inputs.relance }}', 'RUN_ORIGINE: ${{ inputs.origine }}', 'run: node relance.mjs controle']) assert.ok(c.includes(l), l);
  // Ordre : alerte, contrôle, relance (inscription), commit (qui pousse l'inscription), Verdict.
  const pos = ['Vérifier les chutes annoncées', 'Contrôler la relance inscrite', 'Programmer une relance (refus Open-Meteo)',
    'Commit l\'état si modifié'].map((n) => y.indexOf(`- name: ${n}`));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  assert.ok(pos.every((p) => p > 0));
  assert.match(etape('Commit l\'état si modifié'), /f=data\/relance-neige\.json\n\s+if \[ -f "\$f" \] \|\| git ls-files --error-unmatch "\$f" >\/dev\/null 2>&1; then git add "\$f"; fi/);
  const v = etape('Verdict');
  assert.match(v, /if: always\(\) && \(steps\.alerte\.outcome == 'failure' \|\| steps\.controle\.outputs\.orpheline != ''\)/);
  assert.match(v, /ALERTE: \$\{\{ steps\.alerte\.outcome \}\}/);
  assert.match(v, /ORPHELINE: \$\{\{ steps\.controle\.outputs\.orpheline \}\}/);
  assert.match(v, /RELANCE_SEULE: \$\{\{ steps\.alerte\.outputs\.relance_seule \}\}/);
  assert.match(v, /PROGRAMMEE: \$\{\{ steps\.relance\.outputs\.programmee \}\}/);
  assert.match(v, /HEURE: \$\{\{ steps\.relance\.outputs\.heure_relance \}\}/);
  assert.match(v, /run: node relance\.mjs verdict/);
  // Verdict en dernier, et plus aucun failure() qui dépendrait de la conclusion de l'alerte.
  assert.ok(y.lastIndexOf('- name: ') === y.indexOf('- name: Verdict'));
  assert.doesNotMatch(y, /failure\(\)/);
});

// ---- D-010 : relances orphelines ---------------------------------------------------------
test('contrôle (D-010) : effacer quand une évaluation a eu lieu, rouge au-delà de 30 min', async () => {
  const { controler, inscription, MARGE_ORPHELINE_MIN } = await import('../relance.mjs');
  assert.equal(MARGE_ORPHELINE_MIN, 30);
  const insc = inscription({ maintenant: d('2026-11-25T15:23:30Z'), origine: 111, attente: 40 });
  assert.deepEqual(insc, { origine: '111', prevue: '2026-11-25T16:03:30.000Z', depuis: '2026-11-25T15:23:30.000Z' });
  const c = (o) => controler({ insc, ...o });
  // Pas d'inscription : rien.
  assert.deepEqual(controler({ insc: null, maintenant: d('2026-11-26T04:23:00Z') }), { effacer: false, orpheline: '', note: '' });
  // Encore attendue (30 min pile après l'heure prévue) : gardée si l'alerte échoue, effacée si elle réussit.
  assert.equal(c({ maintenant: d('2026-11-25T16:33:30Z') }).effacer, false);
  assert.equal(c({ maintenant: d('2026-11-25T16:33:30Z'), alerteOk: true }).effacer, true);
  assert.equal(c({ maintenant: d('2026-11-25T16:33:30Z'), alerteOk: true }).orpheline, '');
  // Au-delà : rouge et effacée, que l'alerte de ce run réussisse ou non.
  for (const alerteOk of [true, false]) {
    const o = c({ maintenant: d('2026-11-25T16:34:00Z'), alerteOk });
    assert.equal(o.effacer, true);
    assert.equal(o.orpheline, 'Relance prévue à 17h03 jamais terminée (run d\'origine 111) : aucune évaluation neige entre 16h23 et 17h34.');
  }
  // La relance inscrite elle-même : effacée sans rouge, même très en retard ; une autre relance non.
  assert.deepEqual(c({ maintenant: d('2026-11-25T19:00:00Z'), estRelance: true, origineRun: '111' }).orpheline, '');
  assert.equal(c({ maintenant: d('2026-11-25T19:00:00Z'), estRelance: true, origineRun: '111' }).effacer, true);
  assert.notEqual(c({ maintenant: d('2026-11-25T19:00:00Z'), estRelance: true, origineRun: '222' }).orpheline, '');
  // Essai (DRY_RUN, seuil forcé) : rien effacé, rien signalé.
  const e = c({ maintenant: d('2026-11-26T04:23:00Z'), alerteOk: true, essai: true });
  assert.equal(e.effacer, false); assert.equal(e.orpheline, ''); assert.match(e.note, /essai/);
  // Illisible : rouge et effacée (hors essai).
  for (const mauvais of [undefined, {}, { origine: '1', prevue: 'x' }]) {
    const o = controler({ insc: mauvais, maintenant: d('2026-11-26T04:23:00Z'), alerteOk: true });
    assert.equal(o.effacer, true); assert.match(o.orpheline, /illisible/);
  }
  // Heure prévue donnée par relance.mjs : la même que l'avertissement, même si la minute a tourné.
  assert.equal(inscription({ maintenant: d('2026-11-25T15:24:00Z'), origine: 1, attente: 40, prevue: '2026-11-25T16:03:59.000Z' }).prevue,
    '2026-11-25T16:03:59.000Z');
  assert.equal(decider({ maintenant: d('2026-11-25T15:23:30Z') }).prevue.toISOString(), '2026-11-25T16:03:30.000Z');
  // Run manuel à 23h40, relance à 0h20 le lendemain : les dates figurent dans le message.
  const nuit = inscription({ maintenant: d('2026-11-25T22:40:00Z'), origine: 7, attente: 40 });
  assert.equal(controler({ insc: nuit, maintenant: d('2026-11-26T04:23:00Z') }).orpheline,
    'Relance prévue à 0h20 (26.11) jamais terminée (run d\'origine 7) : aucune évaluation neige entre 23h40 (25.11) et 5h23 (26.11).');
});

test('verdict (D-010) : relance orpheline toujours rouge', async () => {
  const { verdict } = await import('../relance.mjs');
  const v = verdict({ orpheline: 'Relance prévue à 17h03 jamais terminée.', alerte: 'success' });
  assert.equal(v.vert, false);
  assert.equal(v.texte, 'Relance prévue à 17h03 jamais terminée. Ce run a fait l\'évaluation.');
  // Étape d'alerte sautée (tests en échec) : dit qu'elle n'a pas tourné.
  assert.match(verdict({ orpheline: 'X.', alerte: 'skipped' }).texte, /^X\. L'étape d'alerte de ce run n'a pas tourné/);
  const w = verdict({ orpheline: 'X.', seule: true, programmee: true, heure: '6h04' });
  assert.equal(w.vert, false);
  assert.match(w.texte, /^X\. Open-Meteo refusé, relance à 6h04/);
});

test('scripts inscrire / controle (D-010) : fichier écrit, effacé, sortie orpheline ; DRY_RUN n\'écrit rien', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relance-'));
  const HORLOGE = 'file:///' + join(RACINE, 'test', 'helpers', 'horloge.mjs').replace(/\\/g, '/');
  const f = join(dir, 'data', 'relance-neige.json');
  const lancerS = (mode, horloge, env) => spawnSync(process.execPath, ['--import', HORLOGE, join(RACINE, 'relance.mjs'), mode],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, HORLOGE_TEST: horloge, GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: '',
      DRY_RUN: '', SEUIL_FORCE: '', RELANCE: '', RUN_ORIGINE: '', ...env } });
  try {
    assert.equal(lancerS('inscrire', '2026-11-25T15:23:30Z', { ORIGINE: '5', ATTENTE_MIN: '40', DRY_RUN: 'true' }).status, 0);
    assert.equal(existsSync(f), false);
    // Sans ORIGINE : panne visible.
    assert.notEqual(lancerS('inscrire', '2026-11-25T15:23:30Z', { ORIGINE: '', ATTENTE_MIN: '40' }).status, 0);
    const i = lancerS('inscrire', '2026-11-25T15:23:30Z', { ORIGINE: '5', ATTENTE_MIN: '40' });
    assert.equal(i.status, 0, i.stderr);
    assert.match(i.stdout, /prévue à 17h03/);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).origine, '5');
    const out = join(dir, 'o'); writeFileSync(out, '');
    const c = lancerS('controle', '2026-11-26T04:24:00Z', { ALERTE: 'success', GITHUB_OUTPUT: out });
    assert.equal(c.status, 0, c.stderr);
    // Texte simple : l'erreur (une seule) vient de l'étape Verdict.
    assert.match(c.stdout, /^Relance orpheline : Relance prévue à 17h03 \(25\.11\) jamais terminée \(run d'origine 5\)/m);
    assert.doesNotMatch(c.stdout, /::error/);
    assert.match(readFileSync(out, 'utf8'), /^orpheline=Relance prévue à 17h03 \(25\.11\) jamais terminée \(run d'origine 5\) : aucune évaluation neige entre 16h23 \(25\.11\) et 5h24 \(26\.11\)\.$/m);
    assert.equal(existsSync(f), false);
    // Sans inscription : sortie vide.
    writeFileSync(out, '');
    assert.equal(lancerS('controle', '2026-11-26T04:24:00Z', { ALERTE: 'failure', GITHUB_OUTPUT: out }).status, 0);
    assert.equal(readFileSync(out, 'utf8'), 'orpheline=\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
