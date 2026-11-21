// snow-conversion.mjs — neige (cm) tirée des précipitations et de la température (D-005).
//
// Remplace le 0,7 cm/mm fixe d'Open-Meteo (snowfall_sum). Une seule conversion, pour
// l'alerte et pour l'écran : snow-forecast-alert.mjs l'applique avant de découper les
// épisodes, et l'écran lit le chiffre de l'alerte (docs/contrat-trmnl.md).
//
// Heure par heure, à l'altitude de la station (2022 m, paramètre elevation d'Open-Meteo,
// qui corrige la température) :
//   neige (cm) = précipitation (mm) × part neige(T) × rapport(T)
//   part neige : 1 sous TEMP_NEIGE_C, 0 au-dessus de TEMP_PLUIE_C, linéaire entre les deux ;
//   rapport    : Hedstrom et Pomeroy (1998), masse volumique de la neige fraîche
//                ρ = 67,92 + 51,25·exp(T/2,59) kg/m³ (T plafonnée à 0 °C), 100/ρ cm par mm.
// Jour = somme des heures datées 00:00 à 23:00 locales, comme les cumuls daily d'Open-Meteo.
//
// Bornes calées le 21.11.2026 sur l'épisode du 13 au 21.11 (HN_1D de ILI2, FNH2, GRA2,
// CHA3 contre la prévision ICON horaire à J-1, fenêtre de 24 h finissant à 7h) :
// −5 / +5 °C. Elles absorbent aussi le tassement de la neige mouillée sur 24 h : la part
// neige n'est pas une vraie limite pluie-neige (0,42 cm/mm à 0 °C, 1,33 à −5 °C).
// Détail et chiffres : docs/demandes-wingfoil.md, Réponse D-005.

export const TEMP_NEIGE_C = -5;   // en dessous : toute la précipitation compte en neige
export const TEMP_PLUIE_C = 5;    // au-dessus : rien

// Hedstrom et Pomeroy (1998), cm de neige par mm d'eau.
export const rapportTemperature = (t) => 100 / (67.92 + 51.25 * Math.exp(Math.min(t, 0) / 2.59));
export const RAPPORT_FIXE = 0.7;  // Open-Meteo (snowfall_sum), gardé au journal (D-005)

export function partNeige(t, { neige = TEMP_NEIGE_C, pluie = TEMP_PLUIE_C } = {}) {
  if (t <= neige) return 1;
  if (t >= pluie) return 0;
  return (pluie - t) / (pluie - neige);
}

export const neigeHoraire = (mm, t, bornes) =>
  mm <= 0 ? 0 : mm * partNeige(t, bornes) * rapportTemperature(t);

const nombre = (x) => typeof x === 'number' && Number.isFinite(x);

// hourly = { time: ['AAAA-MM-JJTHH:MM', ...] locales, precipitation: [mm], temperature_2m: [°C] }.
// Renvoie, pour chaque jour de `dates`, la neige en cm (arrondie au centième), ou null si
// une heure du jour manque ou est invalide (précipitation négative, valeur absente) :
// le jour devient inconnu pour l'alerte, jamais 0.
export function neigeJournaliere(hourly, dates, bornes) {
  const parJour = new Map(dates.map((d) => [d, { cm: 0, heures: 0, ok: true }]));
  const { time = [], precipitation: p = [], temperature_2m: t = [] } = hourly ?? {};
  time.forEach((h, i) => {
    const j = parJour.get(String(h).slice(0, 10));
    if (!j) return;
    j.heures++;
    if (!nombre(p[i]) || p[i] < 0 || !nombre(t[i])) { j.ok = false; return; }
    j.cm += neigeHoraire(p[i], t[i], bornes);
  });
  // Open-Meteo applique un décalage fixe à toute la réponse : 24 heures par jour, même
  // aux changements d'heure (vérifié le 21.11.2026). Un jour à 23 heures est tronqué.
  return dates.map((d) => {
    const j = parJour.get(d);
    return j.ok && j.heures === 24 ? Math.round(j.cm * 100) / 100 : null;
  });
}
