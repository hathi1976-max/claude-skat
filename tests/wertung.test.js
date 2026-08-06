/* Spielwert-Rechnung (`bewerteSpiel`) — Regressionsnetz für die Befunde
   B2 (Schneider/Schwarz gegen den Alleinspieler), B3 (Überreizen bei Null) und
   B4 (Grand Ouvert). Die Zahlen in den Erwartungen sind genau die aus den
   Gegenproben in CODEREVIEW.md.

   `bewerteSpiel` ist rein: kein DOM, kein Spielzustand. Die Datei importiert
   trotzdem `js/wertung.js` als Ganzes — das zieht die Anzeige-Module mit und
   prüft damit nebenbei, dass die Importkette der Modulaufteilung (D1) hält. */

import { gruppe, test, gleich, wahr, falsch } from './lauf.js';
import { bewerteSpiel } from '../js/wertung.js';

const EICHEL = { type: 'suit', trump: 'E' };          // Grundwert 12
const GRAND  = { type: 'grand' };                     // Grundwert 24

// Alleinspieler-Ergebnis kurz zusammenbauen
const w = (spiel, augen, stiche, matadore, reizwert = 18) =>
  bewerteSpiel({ spiel, augen, stiche, matadore, reizwert });

gruppe('Farbspiel — Grundfälle', () => {
  test('gewonnen mit 2 Spitzen: 12 × (2+1) = 36', () => {
    const r = w(EICHEL, 75, 7, 2);
    wahr(r.gewonnen);
    gleich(r.wert, 36);
    gleich(r.stufen, 3);
  });

  test('61 Augen reichen, 60 nicht', () => {
    wahr(w(EICHEL, 61, 6, 1).gewonnen);
    falsch(w(EICHEL, 60, 6, 1).gewonnen);
  });

  test('Handspiel zählt eine Stufe mehr', () => {
    gleich(w({ ...EICHEL, hand: true }, 75, 7, 2).wert, 48);
  });
});

gruppe('Schneider und Schwarz (Befund B2)', () => {
  // Gegenprobe aus dem Review: Eichel-Spiel, mit 2, Skat aufgenommen.
  // Achtung auf die beiden Größen: `wert` ist der Spielwert, die Punktänderung
  // eines verlorenen Spiels ist −2 × Spielwert. Die Zahlen im Review (−72/−96/
  // −120) sind die Punktänderungen.
  const verlust = r => -2 * r.wert;

  test('verloren mit 25 Augen → Stufe 4, Spielwert 48, Punkte −96', () => {
    const r = w(EICHEL, 25, 2, 2);
    falsch(r.gewonnen);
    wahr(r.schneiderGegen, 'Alleinspieler wurde schneider gespielt');
    gleich(r.stufen, 4);
    gleich(r.wert, 48);
    gleich(verlust(r), -96, 'vor Befund B2 waren es Stufe 3 und −72');
  });

  test('verloren ohne Stich → Stufe 5, Spielwert 60, Punkte −120', () => {
    const r = w(EICHEL, 0, 0, 2);
    gleich(r.stufen, 5);
    gleich(r.wert, 60);
    gleich(verlust(r), -120);
    wahr(r.schwarzGegen);
  });

  test('genau 30 Augen ist noch Schneider, 31 nicht mehr', () => {
    wahr(w(EICHEL, 30, 2, 2).schneiderGegen);
    falsch(w(EICHEL, 31, 2, 2).schneiderGegen);
  });

  test('Schneider für den Alleinspieler: 90 Augen ja, 89 nein', () => {
    wahr(w(EICHEL, 90, 8, 2).schneiderFuer);
    falsch(w(EICHEL, 89, 8, 2).schneiderFuer);
    gleich(w(EICHEL, 90, 8, 2).stufen, 4);
  });

  test('alle zehn Stiche = schwarz, Stufe 5', () => {
    const r = w(EICHEL, 120, 10, 2);
    wahr(r.schwarzFuer);
    gleich(r.stufen, 5);
    gleich(r.wert, 60);
  });

  test('Schneider zählt nicht doppelt in beide Richtungen', () => {
    // 25 Augen können nicht zugleich ≥ 90 sein — die Stufen dürfen sich nicht addieren
    const r = w(EICHEL, 25, 2, 2);
    falsch(r.schneiderFuer);
    wahr(r.schneiderGegen);
  });
});

gruppe('Null (Befund B3)', () => {
  test('Null ohne Stich gewonnen: Wert 23', () => {
    const r = w({ type: 'null' }, 0, 0, 0, 18);
    wahr(r.gewonnen);
    gleich(r.wert, 23);
  });

  test('ein Stich verliert das Null', () => {
    falsch(w({ type: 'null' }, 0, 1, 0, 18).gewonnen);
  });

  test('bis 24 gereizt und Null angesagt = überreizt und verloren', () => {
    const r = w({ type: 'null' }, 0, 0, 0, 24);
    falsch(r.gewonnen, 'überreizt trotz null Stichen');
    wahr(r.ueberreizt);
    gleich(r.wert, 23, 'der Verlustwert bleibt der Spielwert selbst');
  });

  test('Null Hand (35) trägt ein Gebot von 24', () => {
    const r = w({ type: 'null', hand: true }, 0, 0, 0, 24);
    wahr(r.gewonnen);
    gleich(r.wert, 35);
  });

  test('Null Ouvert 46, Null Hand Ouvert 59', () => {
    gleich(w({ type: 'null', ouvert: true }, 0, 0, 0).wert, 46);
    gleich(w({ type: 'null', hand: true, ouvert: true }, 0, 0, 0).wert, 59);
  });
});

gruppe('Grand Ouvert (Befund B4)', () => {
  test('mit 4 gewonnen: 24 × (4+7) = 264', () => {
    const r = w({ ...GRAND, hand: true, ouvert: true }, 120, 10, 4);
    wahr(r.gewonnen);
    gleich(r.stufen, 11);
    gleich(r.wert, 264);
  });

  test('Grand Ouvert verlangt alle Stiche — 9 Stiche verlieren', () => {
    const r = w({ ...GRAND, hand: true, ouvert: true }, 110, 9, 4);
    falsch(r.gewonnen, '110 Augen reichen beim Ouvert nicht');
  });

  test('verloren behält den Faktor Spitzen + 7 (bewusste Entscheidung)', () => {
    const r = w({ ...GRAND, hand: true, ouvert: true }, 110, 9, 4);
    gleich(r.wert, 264, 'die Ansage bleibt auch im Verlust gültig');
    gleich(-2 * r.wert, -528, 'so viel kostet ein verlorenes Grand Ouvert mit 4');
  });

  test('schlichter Grand Hand mit 4: 24 × 6 = 144', () => {
    gleich(w({ ...GRAND, hand: true }, 75, 7, 4).wert, 144);
  });
});

gruppe('Überreizen im Farbspiel', () => {
  test('mit 1 bis 36 gereizt: überreizt, verloren, Wert auf 36 aufgerundet', () => {
    const r = w(EICHEL, 75, 7, 1, 36);   // eigener Wert 12 × 2 = 24 < 36
    wahr(r.ueberreizt);
    falsch(r.gewonnen, 'überreizt ist verloren, auch mit 75 Augen');
    gleich(r.wert, 36, 'nächstes Vielfaches von 12 ab dem Reizwert');
  });

  test('erzwungene Stufen heilen kein Gebot', () => {
    // Der Alleinspieler wird schneider gespielt: das hebt den Spielwert, aber
    // gemessen wird das Gebot an dem, was er selbst vorweisen kann.
    const r = w(EICHEL, 25, 2, 1, 36);
    wahr(r.ueberreizt);
    gleich(r.stufen, 3, 'mit 1 + Spiel + Schneider gegen');
  });

  test('genau erreichtes Gebot ist nicht überreizt', () => {
    const r = w(EICHEL, 75, 7, 2, 36);   // eigener Wert 12 × 3 = 36
    falsch(r.ueberreizt);
    wahr(r.gewonnen);
  });
});
