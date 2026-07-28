// Découverte de l'API mesures du SLF — LECTURE SEULE.
//
// 1. Lit la page ReDoc et en extrait l'URL de la spec OpenAPI
// 2. Liste les endpoints disponibles
// 3. Tente de récupérer les stations IMIS et calcule les plus proches
//    du Col de Cou, pour choisir la station de référence.

const BASE = "https://measurement-api.slf.ch";

// Col de Cou — mêmes coordonnées que le plugin neige du dashboard
const CIBLE = { nom: "Col de Cou", lat: 46.1503, lon: 6.7928, alt: 1921 };

async function get(url, accept = "application/json") {
  const res = await fetch(url, { headers: { Accept: accept } });
  const txt = await res.text();
  return { ok: res.ok, status: res.status, ct: res.headers.get("content-type") || "", txt };
}

// Distance approximative en km (formule de Haversine)
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Cherche récursivement des objets qui ressemblent à des stations
function extraireStations(obj, acc = []) {
  if (Array.isArray(obj)) {
    for (const x of obj) extraireStations(x, acc);
    return acc;
  }
  if (obj && typeof obj === "object") {
    const cles = Object.keys(obj);
    const lat = obj.lat ?? obj.latitude ?? obj.y;
    const lon = obj.lon ?? obj.lng ?? obj.longitude ?? obj.x;
    if (typeof lat === "number" && typeof lon === "number" && lat > 45 && lat < 48) {
      acc.push(obj);
    } else {
      for (const c of cles) extraireStations(obj[c], acc);
    }
  }
  return acc;
}

async function main() {
  console.log("=== 1) Page racine (ReDoc) ===\n");
  const racine = await get(BASE + "/", "text/html");
  console.log(`HTTP ${racine.status} · ${racine.ct}`);

  // ReDoc déclare la spec via spec-url="..." ou url="..."
  const candidats = new Set();
  for (const m of racine.txt.matchAll(/(?:spec-url|url)\s*=\s*["']([^"']+)["']/gi)) {
    candidats.add(m[1]);
  }
  for (const m of racine.txt.matchAll(/["']([^"']*(?:openapi|swagger)[^"']*\.(?:json|yaml))["']/gi)) {
    candidats.add(m[1]);
  }

  console.log(`\nURL(s) de spec trouvées dans le HTML : ${[...candidats].join(", ") || "aucune"}`);

  // Repli sur des chemins usuels si le HTML ne dit rien
  const aTester = [...candidats].map((u) => (u.startsWith("http") ? u : BASE + (u.startsWith("/") ? u : "/" + u)));
  for (const p of ["/openapi.json", "/swagger.json", "/api/openapi.json", "/v1/openapi.json"]) {
    if (!aTester.includes(BASE + p)) aTester.push(BASE + p);
  }

  console.log("\n=== 2) Récupération de la spec ===\n");
  let spec = null;
  for (const url of aTester) {
    const r = await get(url);
    console.log(`  ${url} → HTTP ${r.status} (${r.ct.slice(0, 40)})`);
    if (r.ok && r.txt.trim().startsWith("{")) {
      try {
        spec = JSON.parse(r.txt);
        console.log(`  ✓ Spec chargée depuis ${url}\n`);
        break;
      } catch {
        /* pas du JSON exploitable */
      }
    }
  }

  if (!spec) {
    console.log("\nAucune spec JSON récupérée. Extrait du HTML racine :\n");
    console.log(racine.txt.slice(0, 1500));
    return;
  }

  console.log("=== 3) Endpoints disponibles ===\n");
  console.log(`Titre : ${spec.info?.title} · version ${spec.info?.version}`);
  console.log(`Serveur(s) : ${JSON.stringify(spec.servers || [])}\n`);

  const paths = Object.keys(spec.paths || {});
  for (const p of paths) {
    const methodes = Object.keys(spec.paths[p]).join(", ").toUpperCase();
    const resume = spec.paths[p].get?.summary || "";
    console.log(`  ${methodes.padEnd(12)} ${p}  ${resume}`);
  }
  console.log(`\n(${paths.length} endpoints)`);

  console.log("\n=== 4) Tentative : liste des stations ===\n");
  const base = spec.servers?.[0]?.url?.startsWith("http")
    ? spec.servers[0].url.replace(/\/$/, "")
    : BASE;

  // On cible les endpoints sans paramètre de chemin qui parlent de stations
  const candidatsStations = paths.filter(
    (p) => /station/i.test(p) && !p.includes("{")
  );
  console.log(`Endpoints candidats : ${candidatsStations.join(", ") || "aucun"}\n`);

  for (const p of candidatsStations.slice(0, 3)) {
    const url = base + p;
    const r = await get(url);
    console.log(`${url} → HTTP ${r.status}`);
    if (!r.ok) continue;

    let data;
    try {
      data = JSON.parse(r.txt);
    } catch {
      console.log(`  (réponse non-JSON, ${r.txt.slice(0, 200)})`);
      continue;
    }

    const stations = extraireStations(data);
    console.log(`  ${stations.length} station(s) avec coordonnées détectée(s)`);
    if (!stations.length) {
      console.log(`  Extrait brut : ${JSON.stringify(data).slice(0, 600)}`);
      continue;
    }

    console.log(`  Exemple de structure :\n  ${JSON.stringify(stations[0], null, 2).replace(/\n/g, "\n  ")}\n`);

    const proches = stations
      .map((s) => {
        const lat = s.lat ?? s.latitude ?? s.y;
        const lon = s.lon ?? s.lng ?? s.longitude ?? s.x;
        return { s, d: distanceKm(CIBLE.lat, CIBLE.lon, lat, lon) };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);

    console.log(`  Stations les plus proches de ${CIBLE.nom} (${CIBLE.alt} m) :`);
    for (const { s, d } of proches) {
      const code = s.code ?? s.id ?? s.stationCode ?? s.name ?? "?";
      const nom = s.label ?? s.name ?? s.stationName ?? "";
      const alt = s.elevation ?? s.altitude ?? s.alt ?? s.z ?? "?";
      console.log(`    ${String(code).padEnd(12)} ${String(nom).padEnd(28)} ${String(alt).padStart(5)} m   ${d.toFixed(1)} km`);
    }
  }
}

main().catch((e) => {
  console.error("Erreur :", e);
  process.exit(1);
});
