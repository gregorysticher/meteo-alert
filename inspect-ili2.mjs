// Prépare l'alerte neige : coordonnées exactes de la station ILI2 (Les Collines),
// paramètres acceptés par les endpoints neige, et forme réelle des données.

const BASE = "https://measurement-api.slf.ch";
const STATION = "ILI2";

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const txt = await res.text();
  if (!res.ok) return { ok: false, status: res.status, txt };
  try {
    return { ok: true, status: res.status, data: JSON.parse(txt) };
  } catch {
    return { ok: false, status: res.status, txt };
  }
}

function apercu(x, n = 3) {
  if (Array.isArray(x)) {
    return `Array(${x.length}) — ${n} premiers :\n` +
      JSON.stringify(x.slice(0, n), null, 2);
  }
  return JSON.stringify(x, null, 2).slice(0, 1500);
}

async function main() {
  console.log("=== 1) Fiche station ILI2 ===\n");
  const st = await getJson(`${BASE}/public/api/imis/stations`);
  if (st.ok) {
    const liste = Array.isArray(st.data) ? st.data : st.data.stations || [];
    const ili2 = liste.find((s) => s.code === STATION);
    console.log(ili2 ? JSON.stringify(ili2, null, 2) : `${STATION} introuvable`);

    // Voisines utiles pour référence
    for (const c of ["ILI1", "FNH2"]) {
      const v = liste.find((s) => s.code === c);
      if (v) console.log(`\n${c} : ${JSON.stringify(v)}`);
    }
  } else {
    console.log(`Echec HTTP ${st.status}`);
  }

  console.log("\n\n=== 2) Paramètres acceptés par les endpoints neige ===\n");
  const spec = await getJson(`${BASE}/openapi.json`);
  if (spec.ok) {
    const cibles = [
      "/public/api/imis/daily-snow",
      `/public/api/imis/station/{station_code}/measurements`,
    ];
    for (const p of cibles) {
      const def = spec.data.paths?.[p]?.get;
      if (!def) {
        console.log(`${p} → non trouvé dans la spec`);
        continue;
      }
      console.log(`--- ${p} ---`);
      console.log(`Résumé : ${def.summary || "(aucun)"}`);
      for (const prm of def.parameters || []) {
        const req = prm.required ? "REQUIS" : "optionnel";
        const sch = JSON.stringify(prm.schema || {});
        console.log(`  • ${prm.name} (${prm.in}, ${req}) ${sch}`);
      }
      console.log("");
    }
  }

  console.log("\n=== 3) daily-snow — données réelles ===\n");
  const ds = await getJson(`${BASE}/public/api/imis/daily-snow`);
  if (ds.ok) {
    console.log(apercu(ds.data));
    // Y a-t-il une entrée pour notre station ?
    const arr = Array.isArray(ds.data) ? ds.data : [];
    const mien = arr.filter((x) => JSON.stringify(x).includes(STATION));
    console.log(`\nEntrées mentionnant ${STATION} : ${mien.length}`);
    if (mien.length) console.log(JSON.stringify(mien.slice(0, 3), null, 2));
  } else {
    console.log(`Echec HTTP ${ds.status} — ${(ds.txt || "").slice(0, 400)}`);
  }

  console.log("\n\n=== 4) Mesures de la station ILI2 ===\n");
  const ms = await getJson(
    `${BASE}/public/api/imis/station/${STATION}/measurements`
  );
  if (ms.ok) {
    console.log(apercu(ms.data));
  } else {
    console.log(`Echec HTTP ${ms.status} — ${(ms.txt || "").slice(0, 400)}`);
  }
}

main().catch((e) => {
  console.error("Erreur :", e);
  process.exit(1);
});
