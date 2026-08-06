/* Abrechnung einer Runde. Die eigentliche Rechnung steckt in den reinen
   Funktionen bewerteSpiel() und bewerteRamsch(); scoreRound/scoreRamsch
   setzen nur noch Zustand und Anzeige darum herum. */

import { state, P_NAMES, logge, recordDeclarerStat, recordRamschStat } from './zustand.js';
import { AUGEN, GRUNDWERT, countMatadors, isMit } from './regeln.js';
import { zeigeHinweis, clearActive, renderScore, showResult } from './anzeige.js';
import { wait } from './takt.js';

// ---------------- Wertung ----------------

// Reine Spielwert-Rechnung: kennt weder DOM noch state und ist damit direkt
// testbar (tests/wertung.test.js).
//   spiel     {type:'suit'|'grand'|'null', trump, hand, ouvert}
//   augen     Augen des Alleinspielers (inkl. Skat)
//   stiche    Stiche des Alleinspielers
//   matadore  Spitzen aus seinen 12 Karten
//   reizwert  bis wohin er gereizt hat
//
// Regelentscheidungen (siehe CODEREVIEW.md B2-B4):
//  * Schneider/Schwarz zählen in beide Richtungen: 90+ Augen bzw. alle Stiche
//    für den Alleinspieler, 30- Augen bzw. kein Stich gegen ihn.
//  * Grand Ouvert ist immer Hand und immer Schneider und Schwarz angesagt,
//    der Faktor steht daher fest bei Spitzen + 7.
//  * Überreizt wird an dem Spielwert gemessen, den der Alleinspieler selbst
//    erreicht – Stufen, die ihm die Gegner aufzwingen, heilen kein Gebot.
function bewerteSpiel({ spiel, augen, stiche, matadore, reizwert }) {
  if (spiel.type === 'null') {
    const wert = spiel.hand ? (spiel.ouvert ? 59 : 35) : (spiel.ouvert ? 46 : 23);
    const ueberreizt = wert < reizwert;
    return {
      gewonnen: stiche === 0 && !ueberreizt, wert, grund: wert, stufen: 1, ueberreizt,
      schneiderFuer: false, schwarzFuer: false, schneiderGegen: false, schwarzGegen: false
    };
  }

  const grund = spiel.type === 'grand' ? GRUNDWERT.grand : GRUNDWERT[spiel.trump];
  const grandOuvert = spiel.type === 'grand' && !!spiel.ouvert;
  const schneiderFuer = augen >= 90;      // Alleinspieler macht Schneider
  const schwarzFuer = stiche === 10;      // … und schwarz
  const schneiderGegen = augen <= 30;     // Alleinspieler wird Schneider gespielt
  const schwarzGegen = stiche === 0;      // … und schwarz

  // Stufen, die der Alleinspieler selbst vorweisen kann
  let eigen = matadore + 1 + (spiel.hand ? 1 : 0);
  if (grandOuvert) {
    // Schneider + Schneider angesagt + Schwarz + Schwarz angesagt + Ouvert
    eigen += 5;
  } else {
    if (schneiderFuer) eigen += 1;
    if (schwarzFuer) eigen += 1;
  }
  const ueberreizt = grund * eigen < reizwert;

  // Stufen, die die Gegner erzwungen haben (beim Grand Ouvert schon enthalten)
  let stufen = eigen;
  if (!grandOuvert) {
    if (schneiderGegen) stufen += 1;
    if (schwarzGegen) stufen += 1;
  }
  let wert = grund * stufen;

  // Grand Ouvert verlangt alle Stiche, sonst reichen 61 Augen
  const geschafft = grandOuvert ? schwarzFuer : augen >= 61;
  const gewonnen = geschafft && !ueberreizt;

  // Überreizt: mindestens auf das nächste Vielfache des Grundwerts ≥ Reizwert
  if (ueberreizt) {
    let lv = grund;
    while (lv < reizwert) lv += grund;
    wert = Math.max(wert, lv);
  }
  return { gewonnen, wert, grund, stufen, ueberreizt, schneiderFuer, schwarzFuer, schneiderGegen, schwarzGegen };
}

async function scoreRound() {
  const d = state.declarer, g = state.game;
  const declPl = state.players[d];
  // Punkte: gewonnene Karten + Skat (Skat gehört dem Alleinspieler)
  let declAugen = declPl.won.reduce((s, c) => s + AUGEN[c.r], 0)
    + state.skat.reduce((s, c) => s + AUGEN[c.r], 0);
  const declTricks = declPl.tricks;

  const mat = g.type === 'null' ? 0 : countMatadors(state.declarerTwelve, g);
  const w = bewerteSpiel({
    spiel: g, augen: declAugen, stiche: declTricks,
    matadore: mat, reizwert: state.reizwert
  });
  const won = w.gewonnen, value = w.wert;
  let title, detail;

  if (g.type === 'null') {
    title = won ? 'Null gewonnen!' : 'Null verloren';
    detail = (declTricks === 0 ? 'Kein Stich kassiert.' : `${declTricks} Stich(e) kassiert.`)
      + ` · Spielwert ${value}`
      + (w.ueberreizt ? ` · überreizt (bis ${state.reizwert})` : '');
  } else {
    const spitz = (mat > 0 ? (mat + ' ' + (isMit(state.declarerTwelve) ? 'mit' : 'ohne')) : 'ohne');
    const grandOuvert = g.type === 'grand' && g.ouvert;
    title = won ? (grandOuvert ? 'Grand Ouvert gewonnen!' : 'Gewonnen!') : 'Verloren';
    detail = `${declAugen} Augen · ${spitz} · Spielwert ${value}`
      + (g.ouvert ? ' · Ouvert' : '')
      + (grandOuvert ? ' · Schneider und Schwarz angesagt'
        : (w.schneiderFuer ? ' · Schneider' : '')
        + (w.schwarzFuer ? ' · Schwarz' : '')
        + (w.schneiderGegen ? ' · Schneider gegen den Alleinspieler' : '')
        + (w.schwarzGegen ? ' · schwarz gegen den Alleinspieler' : ''))
      + (w.ueberreizt ? ` · überreizt (bis ${state.reizwert})` : '');
  }

  const delta = won ? value : -2 * value;
  zeigeHinweis('');
  clearActive();
  state.scores[d] += delta;
  logge(`${title} ${P_NAMES[d]}: ${delta > 0 ? '+' : ''}${delta}`);
  const deltas = [0, 0, 0]; deltas[d] = delta;
  state.history.push({ round: state.round, dealer: state.dealer, label: g.label, deltas });
  // In die Statistik gehört nur, was der Alleinspieler selbst geschafft hat –
  // nicht, wenn er schneider gespielt wurde.
  recordDeclarerStat(d, won, w.schneiderFuer, w.schwarzFuer);
  renderScore();
  showResult(title, won, detail + `<br>${P_NAMES[d]}: <b>${delta > 0 ? '+' : ''}${delta}</b>`);
  await wait(200);
}

// Ramsch-Wertung: Verlierer = meiste Augen, Skat geht an den letzten Stich.
// Durchmarsch (alle 10 Stiche) = fixe -120; sonst -Augen, verdoppelt je "Jungfrau"-Gegner (0 Augen).
async function scoreRamsch() {
  const lastWinner = state.leader;
  state.players[lastWinner].won.push(...state.skat);
  const augen = state.players.map(pl => pl.won.reduce((s, c) => s + AUGEN[c.r], 0));
  const durchmarschIdx = state.players.findIndex(pl => pl.tricks === 10);

  zeigeHinweis(''); clearActive();
  const augenLine = state.players.map((pl, i) => `${pl.name}: ${augen[i]}`).join(' · ');
  const deltas = [0, 0, 0];
  let title, body;

  if (durchmarschIdx >= 0) {
    deltas[durchmarschIdx] = -120;
    state.scores[durchmarschIdx] += -120;
    title = 'Ramsch – Durchmarsch!';
    body = `${P_NAMES[durchmarschIdx]} hat alle Stiche kassiert.<br>${augenLine}<br>${P_NAMES[durchmarschIdx]}: <b>-120</b>`;
    logge(`Ramsch – Durchmarsch ${P_NAMES[durchmarschIdx]}: -120`);
    recordRamschStat(durchmarschIdx, true);
    [0, 1, 2].filter(i => i !== durchmarschIdx).forEach(i => recordRamschStat(i, false));
  } else {
    const maxAugen = Math.max(...augen);
    const losers = [0, 1, 2].filter(i => augen[i] === maxAugen);
    const jungfrauen = [0, 1, 2].filter(i => augen[i] === 0 && !losers.includes(i));
    const mult = Math.pow(2, jungfrauen.length);
    const penalty = -maxAugen * mult;
    losers.forEach(i => { deltas[i] = penalty; state.scores[i] += penalty; });
    const names = losers.map(i => P_NAMES[i]).join(' & ');
    title = 'Ramsch';
    body = `${augenLine}<br>${names}: <b>${penalty}</b>` + (mult > 1 ? ` (×${mult} für Jungfrau)` : '');
    logge(`Ramsch – ${names}: ${penalty}${mult > 1 ? ` (×${mult})` : ''}`);
    [0, 1, 2].forEach(i => recordRamschStat(i, losers.includes(i)));
  }

  state.history.push({ round: state.round, dealer: state.dealer, label: state.game.label, deltas });
  renderScore();
  showResult(title, false, body);
  await wait(200);
}

export { bewerteSpiel, scoreRound, scoreRamsch };
