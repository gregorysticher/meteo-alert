// Envoi ntfy — module partagé par les trois alertes du repo.
//
// NE PAS repasser aux en-têtes HTTP (Title:, Priority:, Tags:). Les en-têtes
// HTTP sont limités au latin-1 : un tiret cadratin dans le titre fait échouer
// fetch avec "Cannot convert argument to a ByteString ... value of 8212".
// Les trois scripts avaient ce bug ("Neige fraîche — Les Collines",
// "Neige annoncée — Les Collines", "Vent Reposoir — Sa 08.08"), donc aucune
// alerte n'aurait jamais pu partir. Le corps JSON est en UTF-8 : accents,
// tirets cadratins et emoji passent sans problème.

const PRIORITE = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };

// Échecs d'envoi accumulés — le job doit finir en rouge, jamais en silence.
export const echecs = [];

export async function notifier(topic, titre, corps, opts = {}) {
  const { priorite = "high", tags = [] } = opts;
  try {
    const res = await fetch("https://ntfy.sh", {
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
  if (echecs.length) {
    console.error(
      `\n${echecs.length} notification(s) non délivrée(s) :\n- ` + echecs.join("\n- ")
    );
    process.exitCode = 1;
  }
}
