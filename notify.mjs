// Envoi ntfy — module partagé par les trois alertes du repo.
//
// NE PAS repasser aux en-têtes HTTP (Title:, Priority:, Tags:). Les en-têtes
// HTTP sont limités au latin-1 : un tiret cadratin dans le titre fait échouer
// fetch avec "Cannot convert argument to a ByteString ... value of 8212".
// Les trois scripts avaient ce bug ("Neige fraîche — Les Collines",
// "Neige annoncée — Les Collines", "Vent Reposoir — Sa 08.08"), donc aucune
// alerte n'aurait jamais pu partir. Le corps JSON est en UTF-8 : accents,
// tirets cadratins et emoji passent sans problème.

//
// SILENCE NOCTURNE (D-001, 2026-11-14) : silence.mjs. Actif si SILENCE_NOCTURNE=1
// (variable de dépôt du même nom) ; une alerte de la fenêtre n'est pas envoyée et
// notifier() rend false SANS échec : l'appelant ne la mémorise pas, le run de réveil
// la réévalue. opts.ignorerSilence : envoi de test demandé à la main.
// SILENCE_HORLOGE (ISO) remplace l'heure courante, pour les tests seulement.

import { fetchEssai } from "./reseau.mjs";
import { silence } from "./silence.mjs";

const PRIORITE = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };

// Échecs d'envoi accumulés — le job doit finir en rouge, jamais en silence.
export const echecs = [];

// Alertes retenues par le silence : informatif, le run reste vert.
export const differees = [];

function horloge() {
  return process.env.SILENCE_HORLOGE ? new Date(process.env.SILENCE_HORLOGE) : new Date();
}

export async function notifier(topic, titre, corps, opts = {}) {
  const { priorite = "high", tags = [], ignorerSilence = false } = opts;
  if (process.env.SILENCE_NOCTURNE === "1" && !ignorerSilence) {
    const s = silence(horloge());
    if (s.actif) {
      console.log(`Silence nocturne : « ${titre} » retenu, réévalué au réveil (${s.reprise}).`);
      differees.push(titre);
      return false;
    }
  }
  try {
    // Second essai : un ntfy perdu pèse plus qu'un doublon, rare (envoi reçu mais réponse perdue).
    const res = await fetchEssai("https://ntfy.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        title: titre,
        message: corps,
        priority: PRIORITE[priorite] ?? PRIORITE.high,
        tags,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ntfy HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    console.log(`ntfy → ${titre} (HTTP ${res.status})`);
    return true;
  } catch (err) {
    console.error(`ECHEC envoi ntfy (${titre}) : ${err.message}`);
    echecs.push(`${titre} : ${err.message}`);
    return false;
  }
}

// À appeler en fin de script : rend l'échec visible dans Actions.
export function sortieSiEchecs() {
  if (differees.length) {
    console.log(`\n${differees.length} alerte(s) retenue(s) par le silence nocturne :\n- ` +
      differees.join("\n- "));
  }
  if (echecs.length) {
    console.error(
      `\n${echecs.length} notification(s) non délivrée(s) :\n- ` + echecs.join("\n- ")
    );
    process.exitCode = 1;
  }
}
