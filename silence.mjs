// silence.mjs — silence nocturne des trois alertes (D-001, Greg 2026-11-14 ; horaires D-006,
// 2026-11-21 : 23h00 → 8h00 avant un jour ouvré, 23h00 → 9h00 avant un jour de repos).
//
// Pendant la fenêtre, notifier() n'envoie rien et répond « pas envoyé » : l'alerte
// n'est donc pas mémorisée et le premier run après la fin la réévalue avec les
// données du moment. Pas de file d'attente : au réveil, un seul message par alerte,
// avec la dernière valeur connue ; ce qui ne tient plus ne part pas.
//
// Réveil : le Worker Cloudflare lance les trois alertes à HH:03, HH étant l'heure de
// fin du jour (worker/src/taches.mjs, REVEIL). Sans lui, le premier run après 7h
// serait 9h17 pour le vent et 16h23 pour la neige annoncée.
//
// Jour de repos = samedi, dimanche, férié genevois. Les vacances de Greg sont dans
// son agenda Google, que ni un runner ni le Worker ne lisent : un jour de vacances en
// semaine finit à 8h00, pas 9h00 (écart signalé à la session chat, D-001).
//
// Réglage ici (partagé par les runs et le Worker, qui l'embarque au déploiement :
// changer ces heures demande de redéployer le Worker). Heures pleines pour FIN_* :
// le réveil part à la minute 3 de l'heure de fin.

export const SILENCE = { debut: '23:00', finOuvre: '08:00', finRepos: '09:00' };

const TZ = 'Europe/Zurich';

const minutesDe = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Date et heure locales à Genève, sans dépendre des noms de jours de la locale.
export function local(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const jour = `${p.year}-${p.month}-${p.day}`;
  return {
    jour,
    hhmm: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    semaine: new Date(`${jour}T00:00:00Z`).getUTCDay(),   // 0 = dimanche
  };
}

// Dimanche de Pâques (grégorien, Meeus/Jones/Butcher), AAAA-MM-JJ.
export function paques(an) {
  const a = an % 19, b = Math.floor(an / 100), c = an % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${an}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

const decaler = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// Fériés officiels du canton de Genève.
export function feriesGeneve(an) {
  const p = paques(an);
  const sept = new Date(Date.UTC(an, 8, 1)).getUTCDay();
  const premierDimanche = 1 + ((7 - sept) % 7);
  return new Set([
    `${an}-01-01`,                       // Nouvel An
    decaler(p, -2),                      // Vendredi saint
    decaler(p, 1),                       // Lundi de Pâques
    decaler(p, 39),                      // Ascension
    decaler(p, 50),                      // Lundi de Pentecôte
    `${an}-08-01`,                       // Fête nationale
    `${an}-09-${String(premierDimanche + 4).padStart(2, '0')}`,  // Jeûne genevois
    `${an}-12-25`,                       // Noël
    `${an}-12-31`,                       // Restauration de la République
  ]);
}

export function jourOuvre(jourIso) {
  const s = new Date(`${jourIso}T00:00:00Z`).getUTCDay();
  return s !== 0 && s !== 6 && !feriesGeneve(Number(jourIso.slice(0, 4))).has(jourIso);
}

// Heure de fin du silence pour le matin du jour donné.
export const finDu = (jourIso) => (jourOuvre(jourIso) ? SILENCE.finOuvre : SILENCE.finRepos);

// { actif, reprise } : reprise = « Lu 16.11 08:00 », pour le journal du run.
export function silence(d = new Date()) {
  const l = local(d);
  const soir = l.minutes >= minutesDe(SILENCE.debut);
  const matin = l.minutes < minutesDe(finDu(l.jour));
  if (!soir && !matin) return { actif: false };
  const jour = soir ? decaler(l.jour, 1) : l.jour;
  const noms = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
  const s = new Date(`${jour}T00:00:00Z`).getUTCDay();
  return { actif: true, reprise: `${noms[s]} ${jour.slice(8, 10)}.${jour.slice(5, 7)} ${finDu(jour)}` };
}

// Vrai pendant les `heures` qui suivent la fin du silence de ce matin : une annulation
// vent retenue la nuit peut encore partir même si le run de réveil a pris du retard.
export function apresSilence(d, heures = 3) {
  const l = local(d);
  const fin = minutesDe(finDu(l.jour));
  return l.minutes >= fin && l.minutes < fin + heures * 60;
}

// Vrai si d tombe dans l'heure de fin du silence de ce matin (réveil du Worker).
export function heureDeReveil(d) {
  const l = local(d);
  return Math.floor(l.minutes / 60) === Math.floor(minutesDe(finDu(l.jour)) / 60);
}
