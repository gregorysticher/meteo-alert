// Horloge forcée pour les tests (D-009) : HORLOGE_TEST = instant ISO. `new Date()` et
// `Date.now()` partent de cet instant et avancent au rythme réel (les attentes et les
// durées restent vraies). Sans HORLOGE_TEST : rien ne change.
//
// Chargé par `node --import`, soit par un test pour un script lancé (env HORLOGE_TEST),
// soit pour toute la suite : NODE_OPTIONS="--import=<url de ce fichier>" HORLOGE_TEST=…
// (les processus enfants héritent des deux variables).
const iso = process.env.HORLOGE_TEST;
if (iso && !globalThis.__horlogeTest) {
  const VraieDate = Date;
  const depart = new VraieDate(iso).getTime();
  if (Number.isNaN(depart)) throw new Error(`HORLOGE_TEST illisible : ${iso}`);
  const origine = VraieDate.now();
  const maintenant = () => depart + (VraieDate.now() - origine);
  globalThis.Date = class extends VraieDate {
    constructor(...a) { if (a.length) super(...a); else super(maintenant()); }
    static now() { return maintenant(); }
  };
  globalThis.__horlogeTest = iso;
}
