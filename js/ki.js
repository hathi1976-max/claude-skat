/* Die Computergegner: Handbewertung fürs Reizen, Drücken, Kartenspiel mit
   Kartengedächtnis, Sonderlogik für Null und Ramsch. */

import { state, settings } from './zustand.js';
import {
  SUITS, GRUNDWERT, AUGEN, FARBSTR, LADDER, cardId, FULL_DECK,
  cardInfo, trickWinner, countMatadors
} from './regeln.js';

// Kartengedächtnis der KI: gespielte Karten + Renonce (wer welche Farbe nicht bedient)
let tracker = { played: new Set(), void: [new Set(), new Set(), new Set()] };
function resetTracker() { tracker = { played: new Set(), void: [new Set(), new Set(), new Set()] }; }
function noteCard(p, card, ledSuit) {
  tracker.played.add(cardId(card));
  const g = cardInfo(card, state.game).suit;
  if (ledSuit != null && g !== ledSuit) tracker.void[p].add(ledSuit); // Renonce erkannt
}

// ---------- KI: Handbewertung ----------
// Jede Bewertung liefert drei Schwellen: strong (vorsichtig) < winnable (normal) < nearWin (mutig)
function evalSuit(hand, trump) {
  const trumps = hand.filter(c => c.r === 'U' || c.s === trump);
  const aces = hand.filter(c => c.r === 'D').length;
  const tens = hand.filter(c => c.r === 'T').length;
  const unter = hand.filter(c => c.r === 'U').length;
  const topUnter = hand.some(c => c.r === 'U' && (c.s === 'E' || c.s === 'G')); // hohe Matadore = Kontrolle
  const nt = trumps.length;
  const score = nt * 1.6 + aces * 1.2 + tens * 0.4 + unter * 0.5 + (topUnter ? 0.8 : 0);
  const winnable =
    nt >= 6 ||
    (nt >= 5 && (aces >= 1 || topUnter)) ||
    (nt === 4 && aces >= 2 && topUnter);
  const strong = nt >= 6 || (nt >= 5 && aces >= 2) || (nt >= 5 && topUnter && aces >= 1);
  const nearWin = winnable || (nt >= 5) || (nt === 4 && (aces >= 1 || topUnter));
  const mat = countMatadors([...hand], { type: 'suit', trump });
  const value = GRUNDWERT[trump] * (mat + 1);
  return { type: 'suit', trump, score, winnable, strong, nearWin, value, trumps: nt };
}
function evalGrand(hand) {
  const unters = hand.filter(c => c.r === 'U');
  const unter = unters.length;
  const topU = unters.filter(c => c.s === 'E' || c.s === 'G').length; // sichere Trumpfstiche
  const aces = hand.filter(c => c.r === 'D').length;
  const tensGuarded = hand.filter(c => c.r === 'T' && hand.some(x => x.s === c.s && x.r === 'D')).length;
  const longAce = SUITS.filter(s => hand.some(c => c.s === s && c.r === 'D') && hand.filter(c => c.s === s).length >= 3).length;
  // grobe Schätzung sicherer Stiche (Grand braucht ~ genug für 61)
  const sure = topU + Math.max(0, unter - topU) * 0.6 + aces * 0.9 + tensGuarded * 0.5;
  const score = 6 + unter * 2.2 + topU * 1.0 + aces * 1.6 + tensGuarded * 0.7 + longAce * 0.4;
  const winnable = (unter >= 3 && aces >= 1) || (unter >= 2 && topU >= 1 && aces >= 2) || (topU >= 2 && aces >= 2);
  const strong = (unter >= 3 && aces >= 2 && topU >= 1) || (topU >= 2 && aces >= 3);
  const nearWin = winnable || (unter >= 2 && aces >= 2) || (unter >= 3) || (topU >= 2 && aces >= 1);
  const mat = countMatadors([...hand], { type: 'grand' });
  const value = 24 * (mat + 1);
  return { type: 'grand', trump: null, score, winnable, strong, nearWin, value, sure };
}
function bestGame(hand) {
  const cands = SUITS.map(s => evalSuit(hand, s));
  cands.push(evalGrand(hand));
  // gewinnbare Spiele bevorzugen, dann nach Bewertung
  cands.sort((a, b) => (b.winnable - a.winnable) || (b.score - a.score));
  return cands[0];
}
// Höchstes Reizgebot je nach eingestelltem Reiz-Stil
function reizMax(hand) {
  const A = settings.reiz; // 'vorsichtig' | 'normal' | 'mutig'
  const cands = SUITS.map(s => evalSuit(hand, s)).concat([evalGrand(hand)]);
  let best = 0;
  for (const c of cands) {
    const ok = A === 'vorsichtig' ? c.strong : A === 'mutig' ? c.nearWin : c.winnable;
    if (ok) best = Math.max(best, c.value);
  }
  if (best === 0) return 0;
  // Mutig: eine Stufe höher reizen (der Skat verbessert die Hand oft)
  if (A === 'mutig') best = LADDER.find(v => v > best) || best;
  return best;
}

// ---------- KI: Drücken (Skat) ----------
function aiDiscard(twelve, game) {
  // Ziel: Augen im Skat sichern (v.a. blanke 10) und eine Fehlfarbe zum Stechen schaffen.
  const info = c => cardInfo(c, game);
  const nonTr = twelve.filter(c => !info(c).trump);
  const count = {}; nonTr.forEach(c => count[c.s] = (count[c.s] || 0) + 1);
  const dropScore = c => {
    if (info(c).trump) return -1000;                 // Trümpfe nie drücken
    const hasAce = twelve.some(x => x.s === c.s && x.r === 'D');
    let s;
    if (c.r === 'D') s = -100;                        // Ass fast nie drücken
    else if (c.r === 'T') s = hasAce ? -40 : 70;      // blanke 10: Punkte in den Skat retten
    else if (c.r === 'K') s = 22;
    else if (c.r === 'O') s = 26;
    else s = 34 - info(c).str;                        // 7/8/9 gern weg
    if (count[c.s] <= 2 && c.r !== 'D') s += 16;      // kurze Farbe leeren (Fehlfarbe)
    if (count[c.s] === 1 && AUGEN[c.r] === 0) s += 22;// blanke Lusche = perfekt
    return s;
  };
  const cand = (nonTr.length >= 2 ? nonTr : twelve).slice();
  cand.sort((a, b) => dropScore(b) - dropScore(a));
  return [cand[0], cand[1]];
}

// ---------- KI: Kartenspiel (mit Kartenzählen) ----------
function aiPlay(p, legal, trick, game, declarer) {
  if (game.type === 'ramsch') return ramschPlay(p, legal, trick, game);
  const info = c => cardInfo(c, game);
  const str = c => info(c).str;
  const grp = c => info(c).suit;                 // Farbe bzw. 'T' für Trumpf
  const aug = c => AUGEN[c.r];
  const isDecl = p === declarer;

  if (game.type === 'null') return nullPlay(p, legal, trick, declarer, info, str);
  if (settings.level === 'leicht') return simplePlay(p, legal, trick, game, declarer);
  const usePositional = settings.level === 'schwer'; // Positionsspiel nur auf höchster Stufe

  // --- Kartenzählen: was liegt noch bei den anderen? ---
  const myIds = new Set(state.players[p].hand.map(cardId));
  const skatIds = new Set((isDecl ? state.skat : []).map(cardId)); // Alleinspieler kennt den Skat
  const unseen = FULL_DECK.filter(c => {
    const id = cardId(c);
    return !tracker.played.has(id) && !myIds.has(id) && !skatIds.has(id);
  });
  const unseenTrumps = unseen.filter(c => info(c).trump).length;
  const higherUnseen = c => unseen.some(u => grp(u) === grp(c) && str(u) > str(c));
  const isMaster = c => !higherUnseen(c);        // höchste noch lebende Karte ihrer Gruppe
  const opponents = [0, 1, 2].filter(x => x !== p && ((x === declarer) !== isDecl));
  const voidOpp = suit => opponents.some(o => tracker.void[o].has(suit));

  // --- Ouvert: offen liegende Hände muss die KI nicht raten ---
  // Wichtig: die offenen Karten bleiben in `unseen` (sie sind ja weiter im
  // Spiel und können stechen). Der Gewinn liegt darin, für einen konkreten
  // Gegner exakt sagen zu können, ob er eine Karte überhaupt schlagen kann.
  const offeneHand = o => (o !== p && state.revealed.includes(o)) ? state.players[o].hand : null;
  // true/false wenn die Hand offen liegt, sonst null (= unbekannt, Heuristik)
  const kannSchlagen = (o, c, ledSuit) => {
    const h = offeneHand(o);
    if (!h || !h.length) return h ? false : null;
    const bedienen = h.filter(x => grp(x) === ledSuit);
    const moeglich = bedienen.length ? bedienen : h;   // Bedienzwang, sonst freie Wahl
    return moeglich.some(x => (info(x).trump || grp(x) === ledSuit) && str(x) > str(c));
  };
  // Wissen alle in Frage kommenden Gegner offen? Dann exakt entscheiden.
  const exaktSicher = (gegner, c, ledSuit) => {
    if (!gegner.length) return true;
    const urteil = gegner.map(o => kannSchlagen(o, c, ledSuit));
    if (urteil.some(x => x === null)) return null;
    return !urteil.some(Boolean);
  };

  // Ass/Meister gefahrlos anspielen? (nur Trumpf-Stich wäre gefährlich)
  const safeCash = c => {
    const exakt = exaktSicher(opponents, c, grp(c));
    if (exakt !== null) return exakt;
    return isMaster(c) && !(unseenTrumps > 0 && voidOpp(c.s));
  };

  const byLowStr = a => a.slice().sort((x, y) => str(x) - str(y));
  const byHighStr = a => a.slice().sort((x, y) => str(y) - str(x));
  const byLowAug = a => a.slice().sort((x, y) => aug(x) - aug(y) || str(x) - str(y));
  const byHighAug = a => a.slice().sort((x, y) => aug(y) - aug(x) || str(y) - str(x));

  // Nicht-Trümpfe nach Farbe gruppieren (für Positions-Ausspiel)
  const groupBySuit = cards => { const m = {}; cards.forEach(c => (m[c.s] = m[c.s] || []).push(c)); return m; };
  const suitsByLen = m => Object.keys(m).sort((a, b) => m[b].length - m[a].length);

  // ===================== AUSSPIEL =====================
  if (trick.length === 0) {
    const trumps = legal.filter(c => info(c).trump);
    const nonTr = legal.filter(c => !info(c).trump);
    if (isDecl) {
      // 1) Trümpfe ziehen, solange Gegner Trümpfe halten und ich die Kontrolle habe
      if (trumps.length && unseenTrumps > 0) {
        const top = byHighStr(trumps)[0];
        if (isMaster(top) || trumps.length >= unseenTrumps) return top;
      }
      // 2) sichere Meisterkarten kassieren (Asse/Zehner)
      const cash = byHighAug(nonTr.filter(safeCash));
      if (cash.length) return cash[0];
      // 3) sonst niedrig anspielen, keine Punkte verschenken
      return byLowAug(nonTr.length ? nonTr : legal)[0];
    } else {
      // Verteidiger: sichere Meister-Asse/Zehner kassieren
      const cash = byHighAug(nonTr.filter(c => aug(c) > 0 && safeCash(c)));
      if (cash.length) return cash[0];
      // Ausspiel-Farbe wählen
      const bySuit = groupBySuit(nonTr.length ? nonTr : []);
      const order = suitsByLen(bySuit);
      if (order.length) {
        let target;
        if (usePositional) {
          // "kurz vor, lang hinter dem Alleinspieler"
          const declOff = (declarer - p + 3) % 3; // 1 = Alleinspieler direkt nach mir (Partner sitzt hinten)
          target = declOff === 1 ? order[0] : order[order.length - 1];
        } else {
          target = order[order.length - 1]; // Standard: aus kürzester Farbe niedrig
        }
        return byLowStr(bySuit[target])[0];
      }
      return byLowStr(legal)[0]; // nur noch Trumpf
    }
  }

  // ===================== NACHSPIEL =====================
  const leader = trick[0].p;
  const ledSuit = grp(trick[0].card);
  const curWinner = trickWinner(trick, game);
  const winnerIsAlly = (curWinner === declarer) === isDecl;
  const pot = trick.reduce((s, t) => s + aug(t.card), 0);
  const last = trick.length === 2;
  const bestNow = Math.max(...trick.map(t => (info(t.card).trump || grp(t.card) === ledSuit) ? str(t.card) : -1));
  const winners = legal.filter(c => (info(c).trump || grp(c) === ledSuit) && str(c) > bestNow);

  // Wer spielt in diesem Stich noch NACH mir – und ist es ein Gegner?
  const afterMe = [];
  for (let pos = trick.length + 1; pos <= 2; pos++) afterMe.push((leader + pos) % 3);
  const oppAfter = afterMe.filter(x => (x === declarer) !== isDecl);

  // Hält meine Gewinnkarte? Nur Gegner, die NACH mir spielen, sind eine Gefahr.
  const safeWin = c => {
    if (oppAfter.length === 0) return true;                       // niemand vom Gegner kommt noch
    const exakt = exaktSicher(oppAfter, c, ledSuit);
    if (exakt !== null) return exakt;                             // Ouvert: exakt statt geschätzt
    if (info(c).trump) return !unseen.some(u => info(u).trump && str(u) > str(c));
    if (unseen.some(u => grp(u) === ledSuit && str(u) > str(c))) return false; // höhere Farbkarte draußen
    if (unseenTrumps > 0 && oppAfter.some(o => tracker.void[o].has(ledSuit))) return false; // Gegner sticht
    return true;
  };

  if (winnerIsAlly && curWinner !== p) {
    // Partner führt -> schmieren, wenn der Stich sicher ist (kein Gegner mehr hinter mir, oder Meisterkarte)
    const winCard = trick.find(t => t.p === curWinner).card;
    const exaktPartner = exaktSicher(oppAfter, winCard, ledSuit);
    const partnerSafe = exaktPartner !== null ? exaktPartner : isMaster(winCard);
    if (partnerSafe) {
      const pts = byHighAug(legal.filter(c => aug(c) > 0 && !info(c).trump));
      if (pts.length) return pts[0];
      if (oppAfter.length === 0) { const any = byHighAug(legal.filter(c => aug(c) > 0)); if (any.length) return any[0]; }
    }
    return byLowAug(legal)[0]; // unsicher -> keine Punkte verschenken
  }

  if (!winnerIsAlly && winners.length) {
    // Gegner führt -> günstig gewinnen/abstechen, wenn der Stich hält
    const commit = winners.filter(safeWin);
    if (commit.length) {
      const nonTr = commit.filter(c => !info(c).trump);
      const pick = nonTr.length ? nonTr : commit;      // Farbkarte vor Trumpf, dann billigste
      return byLowStr(pick)[0];
    }
    // Stich hält nicht -> nur mitgehen, wenn viel drin ist und ich letzter bin
    if (last && pot >= 10) return byLowStr(winners)[0];
    // sonst abwerfen (unten)
  }

  // nicht (sinnvoll) gewinnbar -> wenig Augen abwerfen, Farbe halten
  return byLowAug(legal)[0];
}

// Leicht: einfache Heuristik ohne Kartenzählen (macht Anfängerfehler)
function simplePlay(p, legal, trick, game, declarer) {
  const info = c => cardInfo(c, game);
  const str = c => info(c).str, aug = c => AUGEN[c.r];
  const isDecl = p === declarer;
  const byLowStr = a => a.slice().sort((x, y) => str(x) - str(y));
  const byHighStr = a => a.slice().sort((x, y) => str(y) - str(x));
  const byLowAug = a => a.slice().sort((x, y) => aug(x) - aug(y) || str(x) - str(y));
  const byHighAug = a => a.slice().sort((x, y) => aug(y) - aug(x) || str(y) - str(x));

  if (trick.length === 0) {
    const trumps = legal.filter(c => info(c).trump);
    const nonTr = legal.filter(c => !info(c).trump);
    if (isDecl && trumps.length >= 4) return byHighStr(trumps)[0]; // Trümpfe ziehen
    const aces = nonTr.filter(c => c.r === 'D');
    if (aces.length) return aces[0];                                // Ass raushauen
    return byLowAug(nonTr.length ? nonTr : legal)[0];
  }
  const ledSuit = info(trick[0].card).suit;
  const curWinner = trickWinner(trick, game);
  const winnerIsAlly = (curWinner === declarer) === isDecl;
  const last = trick.length === 2;
  const bestNow = Math.max(...trick.map(t => (info(t.card).trump || info(t.card).suit === ledSuit) ? str(t.card) : -1));
  const winners = legal.filter(c => (info(c).trump || info(c).suit === ledSuit) && str(c) > bestNow);

  if (winnerIsAlly && curWinner !== p && last) {                    // schmieren nur als Letzter
    const pts = byHighAug(legal.filter(c => aug(c) > 0));
    if (pts.length) return pts[0];
  }
  if (!winnerIsAlly && winners.length) {                            // gewinnen (ohne Rücksicht auf Überstechen)
    const nonTr = winners.filter(c => !info(c).trump);
    return byLowStr(nonTr.length ? nonTr : winners)[0];
  }
  return byLowAug(legal)[0];                                        // abwerfen
}

// Ramsch: jeder spielt für sich, will möglichst wenig Augen kassieren
function ramschPlay(p, legal, trick, game) {
  const info = c => cardInfo(c, game);
  const str = c => info(c).str, aug = c => AUGEN[c.r];
  const byLowAug = a => a.slice().sort((x, y) => aug(x) - aug(y) || str(x) - str(y));
  const byHighAug = a => a.slice().sort((x, y) => aug(y) - aug(x) || str(y) - str(x));

  if (trick.length === 0) {
    // niedrig anspielen, Buben (Trumpf) meiden
    const nonTr = legal.filter(c => !info(c).trump);
    return byLowAug(nonTr.length ? nonTr : legal)[0];
  }
  const led = info(trick[0].card).suit;
  const bestNow = Math.max(...trick.map(t => (info(t.card).trump || info(t.card).suit === led) ? str(t.card) : -1));
  const winners = legal.filter(c => (info(c).trump || info(c).suit === led) && str(c) > bestNow);
  const safe = legal.filter(c => !winners.includes(c));
  if (safe.length) return byHighAug(safe)[0];   // Stich vermeiden, dabei Punkte loswerden
  return byLowAug(winners)[0];                  // gezwungen zu gewinnen -> möglichst wenig Augen dazu
}

// Null: Alleinspieler will keinen Stich; Gegner drücken ihn hinein
function nullPlay(p, legal, trick, declarer, info, str) {
  const isDecl = p === declarer;
  const byLow = a => a.slice().sort((x, y) => str(x) - str(y));
  const byHigh = a => a.slice().sort((x, y) => str(y) - str(x));
  // Null Ouvert: die offene Hand verrät, womit man den Alleinspieler in einen
  // Stich zwingt – eine Farbe, in der er bedienen muss und nur höhere Karten hat.
  const offen = (!isDecl && state.revealed.includes(declarer)) ? state.players[declarer].hand : null;
  if (trick.length === 0 && offen && offen.length) {
    const zwang = legal.filter(c => {
      const seine = offen.filter(x => x.s === c.s);
      return seine.length > 0 && seine.every(x => str(x) > str(c));
    });
    // die höchste solche Karte: sicher zu hoch für ihn, aber schwer zu überspielen
    if (zwang.length) return byHigh(zwang)[0];
  }
  if (trick.length === 0) return byLow(legal)[0];          // niedrig anspielen
  const led = info(trick[0].card).suit;
  const curBest = Math.max(...trick.filter(t => info(t.card).suit === led).map(t => str(t.card)), -1);
  const under = legal.filter(c => info(c).suit === led && str(c) < curBest);
  if (under.length) return byHigh(under)[0];               // hoch, aber noch drunter -> Stich vermeiden
  return byLow(legal)[0];                                  // sonst niedrigste
}

// Unschlagbare Grand-Hand? (alle 10 Stiche sicher -> Grand Ouvert)
function isGrandOuvertHand(hand) {
  if (hand.filter(c => c.r === 'U').length !== 4) return false;      // alle Trümpfe nötig
  for (const s of SUITS) {
    const mine = hand.filter(c => c.s === s && c.r !== 'U');
    if (!mine.length) continue;
    const minStr = Math.min(...mine.map(c => FARBSTR[c.r]));          // schwächste eigene Karte der Farbe
    // jede stärkere Karte dieser Farbe muss ich selbst halten (sonst Lücke)
    for (const r of ['D', 'T', 'K', 'O', '9', '8', '7']) {
      if (FARBSTR[r] > minStr && !hand.some(c => c.s === s && c.r === r)) return false;
    }
  }
  return true;
}
// Handspiel sinnvoll? Nur wenn die 10er-Hand ohne Skat klar gewinnt.
function shouldPlayHand(hand10, reizwert) {
  const cands = SUITS.map(s => evalSuit(hand10, s)).concat([evalGrand(hand10)]);
  cands.sort((a, b) => (b.strong - a.strong) || (b.score - a.score));
  const plan = cands[0];
  if (!plan.strong) return null;                                     // nicht sicher genug
  const grund = plan.type === 'grand' ? 24 : GRUNDWERT[plan.trump];
  const handValue = plan.value + grund;                             // +1 Stufe (Hand)
  if (handValue < reizwert) return null;                            // deckt das Gebot nicht
  return { type: plan.type, trump: plan.trump || null, hand: true, ouvert: false };
}

export {
  resetTracker, noteCard,
  evalSuit, evalGrand, bestGame, reizMax, aiDiscard, aiPlay,
  isGrandOuvertHand, shouldPlayHand
};
