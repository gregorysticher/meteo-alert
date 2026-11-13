// Monde simule pour les tests de bout en bout de wind-alert.mjs (node --import) :
// horloge figee et fetch route selon l'URL. Hors saison, aucun vrai run n'exerce
// les alertes : c'est le seul moyen de les voir tourner en entier.
//
// MOCK_WIND = JSON {
//   now        ISO : heure figee
//   vent       { nomDuPoint: { 'AAAA-MM-JJ': kn } }, 3 kn par defaut
//   dir        { nomDuPoint: degres }, 90 par defaut
//   air        degres, temperature de l'air (prevue et mesuree)
//   eau        degres, ou null si Alplakes ne repond pas
//   arome      'ok' | 503 | 'vide' | 'mph' | 'fige'
//   arome_strict  true : URL AROME verifiee (modele, unite) ; sinon erreur HTTP 400
//   emission_age_h  age du dernier run MeteoSuisse (1 par defaut)
//   air_prev   false : la prevision d'air manque
//   ntfy       statut HTTP de ntfy (200 par defaut)
//   mesure_kn  vent mesure aux stations, noeuds (5 par defaut)
// }
// Chaque notification est ajoutee a MOCK_NTFY_LOG (une ligne JSON).
import { appendFileSync } from 'node:fs';

// Pas d'attente avant le second essai de reseau.mjs.
process.env.ESSAI_ATTENTE_S ??= '0';
// Pas de serveur de secours : le second essai reste dans la simulation.
process.env.RESEAU_SECOURS ??= '{}';

const M = JSON.parse(process.env.MOCK_WIND);
const NOW = new Date(M.now).getTime();

const VraieDate = Date;
globalThis.Date = class extends VraieDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};

// Tous les points de spots.json : [id, type, abbr, nom]
const POINTS = [
  [1, 2, '', 'Cologny'], [2, 2, '', 'Bellevue'], [3, 2, '', 'Coppet'],
  [4, 1, 'CGI', 'CGI'], [5, 1, 'PRE', 'PRE'], [6, 1, 'BOU', 'BOU'], [7, 1, 'CHB', 'CHB'],
];
const emission = new VraieDate(NOW - (M.emission_age_h ?? 1) * 36e5).toISOString().slice(0, 13).replace(/[-T]/g, '') + '00';
const PARAMS = ['fu3010h0', 'fu3010h1', 'fu3q10h0', 'dkl010h0', 'tre200h0'];

function serieCsv(param) {
  const lignes = [`point_id;point_type_id;Date;${param}`];
  for (const [id, , , nom] of POINTS) {
    for (let h = -6; h < 216; h++) {
      const d = new VraieDate(NOW - (NOW % 36e5) + h * 36e5);
      const kn = M.vent?.[nom]?.[d.toISOString().slice(0, 10)] ?? 3;
      const v = {
        fu3010h0: kn * 1.852, fu3010h1: kn * 1.3 * 1.852, fu3q10h0: (kn - 1) * 1.852,
        dkl010h0: M.dir?.[nom] ?? 90, tre200h0: M.air ?? 18,
      }[param];
      lignes.push(`${id};2;${d.toISOString().slice(0, 16).replace(/[-:T]/g, '')};${v}`);
    }
  }
  return lignes.join('\n') + '\n';
}

function arome() {
  const debut = NOW - (NOW % 864e5);
  const time = Array.from({ length: 72 }, (_, i) =>
    new VraieDate(debut + i * 36e5).toISOString().slice(0, 16));
  return Array.from({ length: 8 }, () => ({
    hourly_units: { wind_speed_10m: M.arome === 'mph' ? 'mp/h' : 'kn' },
    hourly: {
      time,
      wind_speed_10m: time.map((_, i) => (i < 55 ? 30 : null)),
      wind_gusts_10m: time.map((_, i) => (i < 55 ? 40 : null)),
      wind_direction_10m: time.map((_, i) => (i < 55 ? 90 : null)),
    },
  }));
}

const reponse = (corps, status = 200) =>
  new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), { status });

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('trmnl.test')) {
    appendFileSync(process.env.MOCK_TRMNL_LOG, opts.body + '\n');
    return reponse({}, 200);
  }
  if (u.includes('ntfy.sh')) {
    appendFileSync(process.env.MOCK_NTFY_LOG, opts.body + '\n');
    return reponse({}, M.ntfy ?? 200);
  }
  if (u.includes('/items')) {
    const assets = {};
    for (const p of PARAMS) {
      if (p === 'tre200h0' && M.air_prev === false) continue;
      assets[`vnut12.lssw.${emission}.${p}.csv`] = { href: `https://mock.test/${p}.csv` };
    }
    return reponse({ features: [{ assets }] });
  }
  if (u.includes('meta_point')) {
    return reponse('point_id;point_type_id;station_abbr;point_name\n' +
      POINTS.map((p) => p.join(';')).join('\n') + '\n');
  }
  if (u.startsWith('https://mock.test/')) {
    return reponse(serieCsv(u.split('/').pop().replace('.csv', '')));
  }
  if (u.includes('VQHA80')) {
    if (M.air_mesure === false) {
      return reponse('Station/Location;Date;dkl010z0;fu3010z0;fu3010z1\n' +
        ['GVE', 'CGI', 'BOU', 'CHB', 'PRE'].map((s) => `${s};202705080000;90;9.26;18.5`).join('\n') + '\n');
    }
    return reponse('Station/Location;Date;tre200s0;dkl010z0;fu3010z0;fu3010z1\n' +
      ['GVE', 'CGI', 'BOU', 'CHB'].map((s) => `${s};202705080000;${M.air ?? 18};90;${(M.mesure_kn ?? 5) * 1.852};18.5`).join('\n') +
      '\nPRE;202705080000;-;90;9.26;18.5\n');
  }
  if (u.includes('alplakes')) {
    if (M.eau === null) return reponse({}, 500);
    return reponse({ variables: { temperature: { data: [M.eau ?? 12] } } });
  }
  if (u.includes('meta.json')) {
    if (M.arome === 503) return reponse({}, 503);
    const age = M.arome === 'fige' ? 30 : 3;
    return reponse({ last_run_initialisation_time: Math.floor((NOW - age * 36e5) / 1000) });
  }
  if (u.includes('open-meteo')) {
    if (M.arome === 'vide') return reponse([]);
    if (M.arome_strict && !(u.includes('models=meteofrance_arome_france_hd') &&
        u.includes('wind_speed_unit=kn') && u.includes('timezone=GMT'))) {
      return reponse({ error: true }, 400);
    }
    return reponse(arome());
  }
  throw new Error('URL non simulee : ' + u);
};
