/* Taktgeber und Abbruchsteuerung des Rundenablaufs.
   Getrennt von ablauf.js, weil auch die Anzeige (askAction, humanPlay)
   wartende Promises anmelden muss, ohne den Ablauf zu kennen. */

// Generationszähler: jede Runden-Kette merkt sich beim Start ihre Generation.
// Startet der Spieler ein neues Match, wird gen erhöht und alle wartenden
// Promises (Timer, Buttons, Kartenklick) brechen mit ABORT ab – sonst würde die
// alte Kette nach dem nächsten await auf dem neuen state weiterspielen.
const ABORT = Symbol('Spielabbruch');
let gen = 0;
let pendingAborts = new Set();   // Abbruchfunktionen der gerade wartenden Promises

function abortRun() {
  gen++;
  const list = [...pendingAborts];
  pendingAborts.clear();
  for (const cancel of list) cancel();
}

// Tempo der Spielpausen (1 = normal). Tests setzen den Faktor auf 0.
let waitFactor = 1;
// Wartet ms Millisekunden; bricht ab, sobald eine neue Generation läuft.
function wait(ms) {
  if (waitFactor === 0) return Promise.resolve();   // Testmodus: ohne Timer durchlaufen
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(t); reject(ABORT); };
    const t = setTimeout(() => { pendingAborts.delete(cancel); resolve(); }, ms * waitFactor);
    pendingAborts.add(cancel);
  });
}

// Setzt das Tempo von außen (Prüfstand: 0 = ohne Pausen durchlaufen).
function tempo(f) { waitFactor = f; }

export { ABORT, gen, pendingAborts, abortRun, wait, tempo };
