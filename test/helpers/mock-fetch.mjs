// Remplace fetch pour les tests de bout en bout des scripts (node --import).
// MOCK_FETCH = JSON { status, body } | "network-error".
// body est renvoyé tel quel (objet/tableau -> JSON).
// MOCK_RATES = nombre de premiers appels qui échouent (erreur réseau), pour
// vérifier le second essai.
// MOCK_NTFY_STATUS = statut renvoyé par ntfy (200 par défaut), pour simuler une
// panne d'envoi alors que la source météo répond.
import { appendFileSync } from 'node:fs';

// Pas d'attente avant le second essai de reseau.mjs.
process.env.ESSAI_ATTENTE_S ??= '0';
// Pas de serveur de secours : le second essai reste dans la simulation.
process.env.RESEAU_SECOURS ??= '{}';

const spec = process.env.MOCK_FETCH;
if (spec) {
  let rates = Number(process.env.MOCK_RATES || 0);
  globalThis.fetch = async (url) => {
    if (rates > 0) { rates--; throw new Error('fetch failed (raté simulé)'); }
    if (process.env.MOCK_URLS) appendFileSync(process.env.MOCK_URLS, `${url}\n`);
    if (String(url).includes('ntfy.sh') && process.env.MOCK_NTFY_STATUS) {
      return new Response('panne', { status: +process.env.MOCK_NTFY_STATUS });
    }
    // Bulletin d'avalanches SLF (page detail neige) : MOCK_AVALANCHE = { status, body } ;
    // sans lui, un bulletin minimal valide pour la region de Les Collines.
    if (String(url).includes('aws.slf.ch/api/bulletin')) {
      const { status = 200, body = { bulletins: [{ regions: [{ regionID: 'CH-1312' }],
        dangerRatings: [{ mainValue: 'considerable' }], avalancheProblems: [{ problemType: 'wind_slab' }],
        validTime: { endTime: '2026-11-21T16:00:00Z' } }] } } = process.env.MOCK_AVALANCHE
        ? JSON.parse(process.env.MOCK_AVALANCHE) : {};
      return new Response(JSON.stringify(body), { status });
    }
    if (String(url).includes('forecast_days=16') && process.env.MOCK_LONG) {
      const { status = 200, body = null } = JSON.parse(process.env.MOCK_LONG);
      return new Response(JSON.stringify(body), { status });
    }
    // Archive HS par station (snow-fresh-alert, D-003) : MOCK_STATION = { status, body } |
    // "network-error" ; MOCK_STATION_404 = code de station qui répond 404.
    if (String(url).includes('/imis/station/')) {
      if (process.env.MOCK_STATION_404 && String(url).includes(`/station/${process.env.MOCK_STATION_404}/`)) {
        return new Response('{}', { status: 404 });
      }
      if (process.env.MOCK_STATION === 'network-error') throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      if (process.env.MOCK_STATION) {
        const { status = 200, body = null } = JSON.parse(process.env.MOCK_STATION);
        return new Response(JSON.stringify(body), { status });
      }
    }
    // Prévisions locales MeteoSuisse, journal neige en parallèle (snow-msl.mjs, D-008) :
    // MOCK_MSL = "ok" (Planachaux, 1 mm/h à −6 °C pendant 4 jours depuis l'heure pleine
    // qui suit) | "panne" (503). Sans MOCK_MSL : MOCK_FETCH comme avant (l'alerte vent lit
    // aussi cette API).
    if (process.env.MOCK_MSL && String(url).includes('ogd-local-forecasting')) {
      if (process.env.MOCK_MSL === 'panne') return new Response('panne', { status: 503 });
      const u = String(url);
      const base = 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting/20261124-ch/';
      if (u.includes('/api/stac/')) {
        const assets = Object.fromEntries(['rre150h0', 'tre200h0', 'fu3010h0'].map((p) =>
          [`vnut12.lssw.202611240400.${p}.csv`, { href: `${base}vnut12.lssw.202611240400.${p}.csv` }]));
        // Run plus récent incomplet : il ne doit pas être choisi.
        assets['vnut12.lssw.202611240500.rre150h0.csv'] = { href: `${base}incomplet.csv` };
        return new Response(JSON.stringify({ features: [{ assets }] }), { status: 200 });
      }
      if (u.includes('meta_point')) {
        return new Response('point_id;point_type_id;station_abbr;postal_code;point_name;point_height_masl\n' +
          '1;1;ARO;;Arosa;1878.0\n19999;1;WNSPLA;;Champéry / Planachaux;1943.0\n', { status: 200 });
      }
      const param = /\.(rre150h0|tre200h0)\.csv$/.exec(u)?.[1];
      if (!param) return new Response('absent', { status: 404 });
      // Départ à l'heure pleine qui suit : le jour local en cours n'est jamais complet.
      const t0 = new Date(); t0.setUTCMinutes(0, 0, 0);
      const lignes = [`point_id;point_type_id;Date;${param}`];
      for (let i = 1; i <= 96; i++) {
        const d = new Date(t0.getTime() + i * 36e5).toISOString().replace(/[-:T]/g, '').slice(0, 12);
        lignes.push(`19999;1;${d};${param === 'rre150h0' ? 1 : -6}`, `1;1;${d};9`);
      }
      return new Response(lignes.join('\n') + '\n', { status: 200 });
    }
    if (spec === 'network-error') throw new Error('ECONNRESET (simulé)');
    const { status = 200, body = null } = JSON.parse(spec);
    const texte = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(texte, { status, headers: { 'Content-Type': 'application/json' } });
  };
}
