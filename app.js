/* =========================================================================
   Skat – Altenburger Blatt
   Deutsches Bild: Eichel (E), Grün (G), Herz (H), Schellen (S)
   Werte: Daus(A)=11, Zehn(10)=10, König(K)=4, Ober(O)=3, Unter(U)=2, 9/8/7=0
   ========================================================================= */

'use strict';

// ---------- Grunddaten ----------
const SUITS = ['E', 'G', 'H', 'S'];               // Reihenfolge/Wertigkeit beim Reizen absteigend
const SUIT_NAME = { E: 'Eichel', G: 'Grün', H: 'Herz', S: 'Schellen' };
const GRUNDWERT = { E: 12, G: 11, H: 10, S: 9, grand: 24 };
const RANKS = ['D', 'T', 'K', 'O', 'U', '9', '8', '7'];
const AUGEN = { D: 11, T: 10, K: 4, O: 3, U: 2, '9': 0, '8': 0, '7': 0 };

// Stärke einer Nicht-Trumpf-Farbe (hoch->niedrig): D,T,K,O,9,8,7
const FARBSTR = { D: 6, T: 5, K: 4, O: 3, '9': 2, '8': 1, '7': 0 };
// Null-Reihenfolge innerhalb einer Farbe: A,K,O,U,10,9,8,7
const NULLSTR = { D: 7, K: 6, O: 5, U: 4, T: 3, '9': 2, '8': 1, '7': 0 };
// Unter-Rang (Eichel höchster)
const UNTER_BONUS = { E: 3, G: 2, H: 1, S: 0 };

// Anzeige
const RANK_LABEL = { D: 'A', T: '10', K: 'K', O: 'O', U: 'U', '9': '9', '8': '8', '7': '7' };

// Reizleiter (alle möglichen Reizwerte)
const LADDER = (() => {
  const s = new Set([23, 35, 46, 59]); // Null, Null Hand, Null Ouvert, Null Hand Ouvert
  for (const g of [9, 10, 11, 12, 24]) for (let n = 1; n <= 18; n++) s.add(g * n);
  return [...s].filter(v => v >= 18).sort((a, b) => a - b);
})();

const cardId = c => c.s + c.r;
// Verb-Konjugation: Spieler 0 ist "Du" (2. Person)
const vb = i => (i === 0 ? 'spielst' : 'spielt');

// Komplettes Blatt (für Kartenzählen)
const FULL_DECK = (() => { const d = []; for (const s of SUITS) for (const r of RANKS) d.push({ s, r }); return d; })();

// Kartengedächtnis der KI: gespielte Karten + Renonce (wer welche Farbe nicht bedient)
let tracker = { played: new Set(), void: [new Set(), new Set(), new Set()] };
function resetTracker() { tracker = { played: new Set(), void: [new Set(), new Set(), new Set()] }; }
function noteCard(p, card, ledSuit) {
  tracker.played.add(cardId(card));
  const g = cardInfo(card, state.game).suit;
  if (ledSuit != null && g !== ledSuit) tracker.void[p].add(ledSuit); // Renonce erkannt
}

// ---------- Einstellungen (Spielstärke + Reiz-Stil) ----------
let settings = { level: 'schwer', reiz: 'normal' };
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('skat_settings') || '{}');
    if (s.level) settings.level = s.level;
    if (s.reiz) settings.reiz = s.reiz;
  } catch (e) {}
}
function saveSettings() { try { localStorage.setItem('skat_settings', JSON.stringify(settings)); } catch (e) {} }
loadSettings();

// ---------- Statistik (persistiert über Sessions/Matches hinweg) ----------
let stats = null;
function loadStats() {
  try { stats = JSON.parse(localStorage.getItem('skat_stats') || 'null'); } catch (e) { stats = null; }
  if (!stats || !stats.perPlayer) {
    stats = { perPlayer: [0, 1, 2].map(() => ({ declarerGames: 0, declarerWon: 0, schneider: 0, schwarz: 0, ramschRounds: 0, ramschLost: 0 })) };
  }
}
function saveStats() { try { localStorage.setItem('skat_stats', JSON.stringify(stats)); } catch (e) {} }
loadStats();
function recordDeclarerStat(p, won, schneider, schwarz) {
  const s = stats.perPlayer[p];
  s.declarerGames++;
  if (won) s.declarerWon++;
  if (schneider) s.schneider++;
  if (schwarz) s.schwarz++;
  saveStats();
}
function recordRamschStat(p, lost) {
  const s = stats.perPlayer[p];
  s.ramschRounds++;
  if (lost) s.ramschLost++;
  saveStats();
}

// ---------- Spielzustand ----------
const P_NAMES = ['Du', 'Anna', 'Bernd'];
let state = null;

function newState() {
  return {
    players: [0, 1, 2].map(i => ({ name: P_NAMES[i], hand: [], isHuman: i === 0, tricks: 0, won: [] })),
    dealer: 2,           // Startgeber -> Vorhand = Spieler 0 (Du)
    skat: [],
    declarer: null,
    reizwert: 0,
    game: null,          // {type:'suit'|'grand'|'null', trump, hand, ouvert}
    declarerTwelve: [],  // 12 Karten des Alleinspielers (für Spitzen)
    revealed: [],        // Spieler, deren Hand offen liegt (Ouvert)
    scores: [0, 0, 0],
    round: 0,
    trick: [],
    leader: 0,
    logs: [],
    history: []          // Turnierliste: {round, dealer, label, deltas:[d0,d1,d2]} pro Runde
  };
}

// ---------- Karten-Logik ----------
function cardInfo(c, game) {
  if (!game) return { trump: false, suit: c.s, str: FARBSTR[c.r] ?? 0 };
  if (game.type === 'null') return { trump: false, suit: c.s, str: NULLSTR[c.r] };
  if (c.r === 'U') return { trump: true, suit: 'T', str: 200 + UNTER_BONUS[c.s] };
  if (game.type === 'suit' && c.s === game.trump) return { trump: true, suit: 'T', str: 100 + FARBSTR[c.r] };
  return { trump: false, suit: c.s, str: FARBSTR[c.r] };
}

function legalMoves(hand, trick, game) {
  if (trick.length === 0) return hand.slice();
  const led = cardInfo(trick[0].card, game).suit;
  const follow = hand.filter(c => cardInfo(c, game).suit === led);
  return follow.length ? follow : hand.slice();
}

function trickWinner(trick, game) {
  const led = cardInfo(trick[0].card, game).suit;
  let best = trick[0], bestStr = -1;
  for (const t of trick) {
    const inf = cardInfo(t.card, game);
    if (inf.trump || inf.suit === led) {
      if (inf.str > bestStr) { bestStr = inf.str; best = t; }
    }
  }
  return best.p;
}

// Spitzen (Matadore) aus 12 Karten
function countMatadors(cards, game) {
  const ids = new Set(cards.map(cardId));
  let top;
  if (game.type === 'grand') top = SUITS.map(s => s + 'U');
  else {
    top = SUITS.map(s => s + 'U');
    for (const r of ['D', 'T', 'K', 'O', '9', '8', '7']) top.push(game.trump + r);
  }
  const hasTop = ids.has(top[0]);
  let n = 0;
  for (const id of top) { if (ids.has(id) === hasTop) n++; else break; }
  return n;
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
  // Ass/Meister gefahrlos anspielen? (nur Trumpf-Stich wäre gefährlich)
  const safeCash = c => isMaster(c) && !(unseenTrumps > 0 && voidOpp(c.s));

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
    if (info(c).trump) return !unseen.some(u => info(u).trump && str(u) > str(c));
    if (unseen.some(u => grp(u) === ledSuit && str(u) > str(c))) return false; // höhere Farbkarte draußen
    if (unseenTrumps > 0 && oppAfter.some(o => tracker.void[o].has(ledSuit))) return false; // Gegner sticht
    return true;
  };

  if (winnerIsAlly && curWinner !== p) {
    // Partner führt -> schmieren, wenn der Stich sicher ist (kein Gegner mehr hinter mir, oder Meisterkarte)
    const winCard = trick.find(t => t.p === curWinner).card;
    const partnerSafe = oppAfter.length === 0 || isMaster(winCard);
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
  if (trick.length === 0) return byLow(legal)[0];          // niedrig anspielen
  const led = info(trick[0].card).suit;
  const curBest = Math.max(...trick.filter(t => info(t.card).suit === led).map(t => str(t.card)), -1);
  const under = legal.filter(c => info(c).suit === led && str(c) < curBest);
  if (under.length) return byHigh(under)[0];               // hoch, aber noch drunter -> Stich vermeiden
  return byLow(legal)[0];                                  // sonst niedrigste
}

// ============================ ABLAUF ============================

let cardResolver = null; // löst Kartenklick auf
let cardLegal = null;

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
  cardResolver = null; cardLegal = null;
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

function startGame() {
  abortRun();          // laufende Runden-Kette beenden, bevor state ersetzt wird
  state = newState();
  renderScore();
  runLoop();
}

// Rundenschleife: läuft, bis eine neue Generation startet (statt Rekursion in nextRound)
async function runLoop() {
  const g = gen;
  try {
    while (g === gen) await nextRound();
  } catch (e) {
    if (e !== ABORT) throw e;
  }
}

async function nextRound() {
  state.round++;
  // zurücksetzen
  state.players.forEach(pl => { pl.hand = []; pl.tricks = 0; pl.won = []; });
  state.skat = []; state.declarer = null; state.reizwert = 0; state.game = null;
  state.declarerTwelve = []; state.trick = []; state.revealed = [];
  document.getElementById('skatZone').classList.add('hidden');
  document.getElementById('bubble').textContent = '';

  deal();
  state.leader = vorhand();
  renderAll();
  await wait(300);

  await reizen();

  if (state.declarer === null) {
    await playTricks();
    await scoreRamsch();
  } else {
    await declarerPhase();
    await playTricks();
    await scoreRound();
  }

  state.dealer = (state.dealer + 1) % 3;
  await askAction([{ label: 'Nächstes Spiel', value: 'next', cls: 'primary' }]);
  document.getElementById('center').querySelector('.result')?.remove();
}

function vorhand() { return (state.dealer + 1) % 3; }
function mittelhand() { return (state.dealer + 2) % 3; }
function hinterhand() { return state.dealer; }

function deal() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ s, r });
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[deck[i], deck[j]] = [deck[j], deck[i]]; }
  // 3-Skat(2)-4-3 Verteilung (kosmetisch); Karten an VH,MH,HH
  const order = [vorhand(), mittelhand(), hinterhand()];
  let k = 0;
  const give = n => { for (const p of order) for (let i = 0; i < n; i++) state.players[p].hand.push(deck[k++]); };
  give(3);
  state.skat = [deck[k++], deck[k++]];
  give(4); give(3);
  state.players.forEach(pl => sortHand(pl.hand, null));
}

// ---------------- Reizen ----------------
async function reizen() {
  state.logs.push(`<b>Spiel ${state.round}</b> – Geber: ${P_NAMES[state.dealer]}`);
  const VH = vorhand(), MH = mittelhand(), HH = hinterhand();
  const aiMax = {};
  state.players.forEach((pl, i) => { if (!pl.isHuman) aiMax[i] = reizMax(pl.hand); });

  bubble('Reizen …');
  await wait(450);

  // Duell 1: MH bietet, VH hält
  let d1 = await duel(MH, VH, 18, 0, aiMax);
  // Duell 2: HH bietet gegen Sieger1
  const start2 = LADDER.find(v => v > d1.reizwert) || 999;
  let d2 = await duel(HH, d1.winner, d1.reizwert === 0 ? 18 : start2, d1.reizwert, aiMax);

  let declarer = d2.winner, reiz = d2.reizwert;

  if (reiz === 0) {
    // Haben MH und HH sofort gepasst, hat Vorhand noch gar nichts gesagt:
    // sie darf jetzt ansagen, dass sie bei 18 spielt (sonst Ramsch).
    setActive(VH);
    let willSpielen;
    if (state.players[VH].isHuman) {
      zeigeHinweis('Beide passen. Spielst du für <b>18</b>?');
      willSpielen = await askAction([
        { label: 'Ja, ich spiele (18)', value: 'yes', cls: 'primary' },
        { label: 'Nein – Ramsch', value: 'no', cls: 'danger' }
      ]) === 'yes';
      bubble(willSpielen ? 'Du: 18' : 'Du: Ramsch');
      state.logs.push(willSpielen ? 'Du spielst für 18' : 'Du willst nicht – Ramsch');
      await wait(350);
    } else {
      willSpielen = aiMax[VH] >= 18;
      await aiSay(VH, willSpielen ? '18' : 'Ramsch', willSpielen);
      state.logs.push(`${P_NAMES[VH]} ${willSpielen ? 'spielt für 18' : 'will nicht – Ramsch'}`);
    }
    if (willSpielen) { declarer = VH; reiz = 18; }
    zeigeHinweis('');
  }

  if (reiz === 0) {
    // Auch Vorhand will nicht -> Ramsch
    state.declarer = null;
    state.game = { type: 'ramsch', trump: null, hand: false, ouvert: false, label: 'Ramsch' };
    bubble('Alle passen – Ramsch!');
    state.logs.push('Alle passen – Ramsch');
    renderAll();
    await wait(900);
    return;
  }

  state.declarer = declarer;
  state.reizwert = reiz;
  bubble(`${P_NAMES[declarer]} ${vb(declarer)} (gereizt bis ${reiz}).`);
  state.logs.push(`Alleinspieler: ${P_NAMES[declarer]}, Reizwert ${reiz}`);
  renderAll();
  await wait(900);
}

// Ein Reiz-Duell; gibt {winner, reizwert}
async function duel(bidder, holder, startVal, standing, aiMax) {
  let i = LADDER.findIndex(v => v >= startVal);
  if (i < 0) return { winner: holder, reizwert: standing };
  let lastCalled = standing;

  while (i < LADDER.length) {
    const val = LADDER[i];
    // Bieter: sagt er den Wert?
    const wantBid = state.players[bidder].isHuman
      ? await askReiz(bidder, holder, val, 'bid')
      : await aiBid(bidder, val, aiMax);
    if (!wantBid) return { winner: holder, reizwert: lastCalled };

    // Halter: hält er?
    const wantHold = state.players[holder].isHuman
      ? await askReiz(holder, bidder, val, 'hold')
      : await aiHold(holder, val, aiMax);
    if (!wantHold) return { winner: bidder, reizwert: val };

    lastCalled = val;
    i++;
  }
  return { winner: holder, reizwert: lastCalled };
}

// Sichtbare Reizanzeige: KI sagt ihre Zahl bzw. antwortet
async function aiSay(p, text, strong) {
  setActive(p);
  bubble(`${P_NAMES[p]}: <span class="reizsay">${text}</span>`);
  await wait(strong ? 560 : 440);
}
async function aiBid(p, val, aiMax) {
  const yes = aiMax[p] >= val;
  await aiSay(p, yes ? String(val) : 'Passe', yes);
  return yes;
}
async function aiHold(p, val, aiMax) {
  const yes = aiMax[p] >= val;
  await aiSay(p, yes ? `Ja (${val})` : 'Passe', false);
  return yes;
}

async function askReiz(me, opp, val, role) {
  setActive(me);
  const other = P_NAMES[opp];
  if (role === 'bid') {
    zeigeHinweis(`Reizen gegen <b>${other}</b>. <b>${val}</b> sagen?`);
    const a = await askAction([
      { label: `${val} sagen`, value: 'yes', cls: 'primary' },
      { label: 'Passe', value: 'no', cls: 'danger' }
    ]);
    if (a === 'yes') { bubble(`Du: ${val}`); state.logs.push(`Du sagst ${val}`); }
    else { bubble('Du: Passe'); state.logs.push('Du passt'); }
    await wait(350);
    return a === 'yes';
  } else {
    zeigeHinweis(`<b>${other}</b> sagt <b>${val}</b>. Halten?`);
    const a = await askAction([
      { label: `${val} halten (Ja)`, value: 'yes', cls: 'primary' },
      { label: 'Passe', value: 'no', cls: 'danger' }
    ]);
    if (a === 'yes') { bubble(`Du hältst ${val}`); state.logs.push(`Du hältst ${val}`); }
    else { bubble('Du: Passe'); state.logs.push('Du passt'); }
    await wait(350);
    return a === 'yes';
  }
}
// ---------------- Alleinspieler: Skat / Handspiel / Drücken / Spielansage ----------------
async function declarerPhase() {
  const d = state.declarer;
  if (state.players[d].isHuman) {
    await humanDeclare();
  } else {
    await aiDeclare(d);
  }
  // Trumpf markieren + Hand neu sortieren
  sortHand(state.players[0].hand, state.game);
  renderAll();
  const g = state.game;
  const name = g.type === 'suit' ? SUIT_NAME[g.trump] + '-Spiel'
    : g.type === 'grand' ? ('Grand' + (g.ouvert ? ' Ouvert' : '')) : ('Null' + (g.ouvert ? ' Ouvert' : ''));
  const handTag = g.hand && !g.ouvert ? ' (Hand)' : '';
  g.label = name + handTag;
  bubble(`${P_NAMES[d]} ${vb(d)} ${name}${handTag}.`);
  state.logs.push(`Spielansage: ${name}${handTag}`);
  await wait(1100);
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

async function aiDeclare(d) {
  const pl = state.players[d];
  const hand10 = pl.hand.slice();

  // 1) Grand Ouvert bei unschlagbarer Hand
  if (isGrandOuvertHand(hand10)) {
    state.game = { type: 'grand', trump: null, hand: true, ouvert: true };
    state.declarerTwelve = hand10.concat(state.skat);
    state.revealed = [d];                                            // Karten offen legen
    await wait(700);
    return;
  }

  // 2) Handspiel, wenn die Hand ohne Skat klar gewinnt
  const handGame = shouldPlayHand(hand10, state.reizwert);
  if (handGame) {
    state.game = handGame;
    state.declarerTwelve = hand10.concat(state.skat);               // Skat zählt für Spitzen/Punkte
    await wait(700);
    return;
  }

  // 3) Sonst: Skat aufnehmen, drücken, bestes Spiel
  const twelve = pl.hand.concat(state.skat);
  const plan = bestGame(twelve);
  state.game = { type: plan.type, trump: plan.trump || null, hand: false, ouvert: false };
  const discard = aiDiscard(twelve, state.game);
  const disIds = new Set(discard.map(cardId));
  pl.hand = twelve.filter(c => !disIds.has(cardId(c)));
  state.skat = discard;
  state.declarerTwelve = twelve;
  showSkatTaken();
  await wait(700);
}

async function humanDeclare() {
  const pl = state.players[0];
  zeigeHinweis('Skat aufnehmen oder aus der Hand spielen?');
  const choice = await askAction([
    { label: 'Skat aufnehmen', value: 'take', cls: 'primary' },
    { label: 'Hand spielen', value: 'hand', cls: 'ghostbtn' }
  ]);

  let twelve, isHand;
  if (choice === 'take') {
    isHand = false;
    twelve = pl.hand.concat(state.skat);
    pl.hand = twelve.slice();
    state.skat = [];
    sortHand(pl.hand, null);
    renderAll();
    bubble('Skat aufgenommen – bitte 2 Karten drücken.');
    // Drücken: 2 Karten wählen
    const drueck = await humanDiscard();
    const ids = new Set(drueck.map(cardId));
    state.skat = twelve.filter(c => ids.has(cardId(c)));
    pl.hand = twelve.filter(c => !ids.has(cardId(c)));
    renderMyHand(null);
  } else {
    isHand = true;
    twelve = pl.hand.concat(state.skat); // Skat zählt trotzdem für Spitzen/Punkte
  }
  state.declarerTwelve = twelve;

  // Spielart wählen
  const g = await humanChooseGame(pl.hand, isHand);
  g.hand = isHand;
  state.game = g;
  if (choice === 'take') showSkatTaken();
}

// Schleife statt Rekursion: bei Fehlklicks wächst sonst eine Promise-Kette ohne Ende
async function humanDiscard() {
  const chosen = [];
  const render = () => {
    renderMyHand(null, (c, el) => {
      el.classList.add('playable');
      if (chosen.find(x => cardId(x) === cardId(c))) el.classList.add('sel');
      el.onclick = () => {
        const idx = chosen.findIndex(x => cardId(x) === cardId(c));
        if (idx >= 0) chosen.splice(idx, 1);
        else if (chosen.length < 2) chosen.push(c);
        render();
      };
    });
  };
  zeigeHinweis('Wähle <b>2 Karten</b> zum Drücken (klick zum Aus-/Abwählen).');
  render();
  while (true) {
    await askAction([{ label: 'Drücken bestätigen', value: 'ok', cls: 'primary' }]);
    if (chosen.length === 2) return chosen;
    zeigeHinweis('Bitte genau <b>2 Karten</b> wählen.');
    render();
  }
}

async function humanChooseGame(hand, isHand) {
  zeigeHinweis('Welches Spiel?');
  const top = await askAction([
    { label: 'Farbspiel', value: 'suit', cls: 'primary' },
    { label: 'Grand', value: 'grand' },
    { label: 'Null', value: 'null' }
  ]);
  if (top === 'grand') {
    if (isHand) { // Grand Ouvert nur als Handspiel (offen, alle Stiche nötig)
      zeigeHinweis('Grand – offen (Ouvert) spielen? Ouvert erfordert <b>alle</b> Stiche.');
      const o = await askAction([
        { label: 'Grand', value: 'no', cls: 'primary' },
        { label: 'Grand Ouvert', value: 'yes' }
      ]);
      return { type: 'grand', trump: null, ouvert: o === 'yes' };
    }
    return { type: 'grand', trump: null, ouvert: false };
  }
  if (top === 'null') {
    zeigeHinweis('Null – offen (Ouvert) spielen?');
    const o = await askAction([
      { label: 'Null', value: 'no', cls: 'primary' },
      { label: 'Null Ouvert', value: 'yes' }
    ]);
    return { type: 'null', trump: null, ouvert: o === 'yes' };
  }
  zeigeHinweis('Welche Trumpffarbe?');
  const t = await askAction([
    { label: 'Eichel ' + suitGlyph('E'), value: 'E', cls: 'primary' },
    { label: 'Grün ' + suitGlyph('G'), value: 'G' },
    { label: 'Herz ' + suitGlyph('H'), value: 'H' },
    { label: 'Schellen ' + suitGlyph('S'), value: 'S' }
  ]);
  return { type: 'suit', trump: t, ouvert: false };
}

// ---------------- Stiche spielen ----------------
async function playTricks() {
  clearActive();
  zeigeHinweis('');
  resetTracker();
  for (let t = 0; t < 10; t++) {
    state.trick = [];
    for (let k = 0; k < 3; k++) {
      const p = (state.leader + k) % 3;
      setActive(p);
      const legal = legalMoves(state.players[p].hand, state.trick, state.game);
      let card;
      if (state.players[p].isHuman) {
        card = await humanPlay(legal);
      } else {
        await wait(650);
        card = aiPlay(p, legal, state.trick, state.game, state.declarer);
      }
      // Karte aus Hand entfernen; splice(-1) würde sonst still die letzte Karte löschen
      const h = state.players[p].hand;
      const idx = h.findIndex(c => cardId(c) === cardId(card));
      if (idx < 0) { console.error('Karte nicht in der Hand', card, h); return; }
      h.splice(idx, 1);
      const ledSuit = state.trick.length ? cardInfo(state.trick[0].card, state.game).suit : null;
      state.trick.push({ p, card });
      noteCard(p, card, ledSuit); // Kartengedächtnis aktualisieren
      renderAll();
      await wait(150);
    }
    // Stich auswerten
    const w = trickWinner(state.trick, state.game);
    state.players[w].tricks++;
    state.players[w].won.push(...state.trick.map(t => t.card));
    state.leader = w;
    bubble(`Stich für ${P_NAMES[w]}`);
    renderAll();
    await wait(900);
    clearTrick();
  }
}

function humanPlay(legal) {
  return new Promise((resolve, reject) => {
    zeigeHinweis('Du bist am Zug – spiel eine Karte.');
    cardLegal = new Set(legal.map(cardId));
    const cancel = () => reject(ABORT);
    pendingAborts.add(cancel);
    cardResolver = c => { pendingAborts.delete(cancel); resolve(c); };
    renderMyHand(state.game, (c, el) => {
      if (cardLegal.has(cardId(c))) {
        el.classList.add('playable');
        el.onclick = () => {
          if (!cardResolver) return;
          const r = cardResolver; cardResolver = null; cardLegal = null;
          renderMyHand(state.game); // Klicks entfernen
          r(c);
        };
      } else el.classList.add('disabled');
    });
  });
}

// ---------------- Wertung ----------------
async function scoreRound() {
  const d = state.declarer, g = state.game;
  const declPl = state.players[d];
  // Punkte: gewonnene Karten + Skat (Skat gehört dem Alleinspieler)
  let declAugen = declPl.won.reduce((s, c) => s + AUGEN[c.r], 0)
    + state.skat.reduce((s, c) => s + AUGEN[c.r], 0);
  const declTricks = declPl.tricks;

  let won, value, title, detail = '';
  let schneider = false, schwarz = false;

  if (g.type === 'null') {
    won = declTricks === 0;
    value = g.hand ? (g.ouvert ? 59 : 35) : (g.ouvert ? 46 : 23);
    title = won ? 'Null gewonnen!' : 'Null verloren';
    detail = won ? 'Kein Stich kassiert.' : `${declTricks} Stich(e) kassiert.`;
  } else {
    const mat = countMatadors(state.declarerTwelve, g);
    schneider = declAugen >= 90;
    schwarz = declTricks === 10;
    let factor = mat + 1 + (g.hand ? 1 : 0);
    if (schneider) factor += 1;
    if (schwarz) factor += 1;
    if (g.ouvert) factor += 1;                     // Ouvert (Grand Ouvert)
    const grund = g.type === 'grand' ? 24 : GRUNDWERT[g.trump];
    value = grund * factor;

    // Gewinnbedingung: Grand Ouvert braucht ALLE Stiche (Schwarz), sonst >= 61 Augen
    const madePoints = g.ouvert ? schwarz : declAugen >= 61;
    const overbid = value < state.reizwert;
    won = madePoints && !overbid;

    const spitz = (mat > 0 ? (mat + ' ' + (isMit(state.declarerTwelve, g) ? 'mit' : 'ohne')) : 'ohne');
    title = won ? (g.ouvert ? 'Grand Ouvert gewonnen!' : 'Gewonnen!') : 'Verloren';
    detail = `${declAugen} Augen · ${spitz} · Spielwert ${value}`
      + (g.ouvert ? ' · Ouvert' : '')
      + (schneider && !g.ouvert ? ' · Schneider' : '')
      + (schwarz ? ' · Schwarz' : '')
      + (overbid ? ` · überreizt (bis ${state.reizwert})` : '');
    if (overbid) {
      // Verlustwert auf nächstes Grundwert-Vielfaches ≥ Reizwert anheben
      let lv = grund;
      while (lv < state.reizwert) lv += grund;
      value = lv;
    }
  }

  const delta = won ? value : -2 * value;
  zeigeHinweis('');
  clearActive();
  state.scores[d] += delta;
  state.logs.push(`${title} ${P_NAMES[d]}: ${delta > 0 ? '+' : ''}${delta}`);
  const deltas = [0, 0, 0]; deltas[d] = delta;
  state.history.push({ round: state.round, dealer: state.dealer, label: g.label, deltas });
  recordDeclarerStat(d, won, schneider, schwarz);
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
    state.logs.push(`Ramsch – Durchmarsch ${P_NAMES[durchmarschIdx]}: -120`);
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
    state.logs.push(`Ramsch – ${names}: ${penalty}${mult > 1 ? ` (×${mult})` : ''}`);
    [0, 1, 2].forEach(i => recordRamschStat(i, losers.includes(i)));
  }

  state.history.push({ round: state.round, dealer: state.dealer, label: state.game.label, deltas });
  renderScore();
  showResult(title, false, body);
  await wait(200);
}

function isMit(cards, game) {
  const ids = new Set(cards.map(cardId));
  return ids.has('EU');
}

// ============================ RENDERING ============================

function suitGlyph(s) {
  return `<span class="cs suit-${s}" style="display:inline-block;width:1em;height:1em;vertical-align:-2px">${SUIT_SVG(s, true)}</span>`;
}

// SVG der 4 Symbole
function SUIT_SVG(s, small) {
  const paths = {
    H: `<path d="M50 86 C22 62 10 44 10 30 C10 16 22 10 32 14 C41 17 47 25 50 32 C53 25 59 17 68 14 C78 10 90 16 90 30 C90 44 78 62 50 86 Z"/>`,
    S: `<path d="M50 8 C42 8 40 14 41 18 C28 24 24 44 24 62 L18 72 L82 72 L76 62 C76 44 72 24 59 18 C60 14 58 8 50 8 Z"/><circle cx="50" cy="80" r="7"/>`,
    E: `<ellipse cx="50" cy="30" rx="24" ry="12"/><path d="M30 30 Q30 78 50 84 Q70 78 70 30 Z"/><rect x="46" y="10" width="8" height="14" rx="3"/>`,
    G: `<path d="M50 6 C74 26 82 52 58 88 C55 74 45 74 42 88 C18 52 26 26 50 6 Z"/><rect x="47" y="60" width="6" height="30"/>`
  };
  return `<svg viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${paths[s]}</svg>`;
}

function cardEl(card, opts = {}) {
  const el = document.createElement('div');
  el.className = 'card suit-' + card.s;
  const inf = state.game ? cardInfo(card, state.game) : null;
  if (opts.showTrump && inf && inf.trump) el.classList.add('trumpmark');
  el.innerHTML =
    `<div class="corner tl">${RANK_LABEL[card.r]}<span class="cs">${SUIT_SVG(card.s)}</span></div>` +
    `<div class="pip">${SUIT_SVG(card.s)}</div>` +
    `<div class="corner br">${RANK_LABEL[card.r]}<span class="cs">${SUIT_SVG(card.s)}</span></div>`;
  return el;
}
function backEl() { const el = document.createElement('div'); el.className = 'card back'; return el; }

function renderAll() {
  renderMyHand(state.game);
  renderOpps();
  renderTrick();
  renderSeatInfo();
  renderScore();
}

function renderMyHand(game, decorate) {
  const box = document.getElementById('myhand');
  box.innerHTML = '';
  const hand = state.players[0].hand;
  for (const c of hand) {
    const el = cardEl(c, { showTrump: !!game });
    if (decorate) decorate(c, el);
    attachDragReorder(c, el, hand, () => renderMyHand(game, decorate));
    box.appendChild(el);
  }
}

// Handkarten per Ziehen selbst anordnen (Maus & Touch über Pointer Events).
// Ein Tap ohne Bewegung löst weiterhin die von decorate() gesetzte Aktion aus.
function attachDragReorder(c, el, hand, rerender) {
  const tapFn = el.onclick;
  el.onclick = null;
  let sx = 0, sy = 0, dragging = false, elRect = null, boxRect = null;
  el.addEventListener('pointerdown', e => {
    sx = e.clientX; sy = e.clientY; dragging = false;
    elRect = el.getBoundingClientRect();
    boxRect = el.parentElement.getBoundingClientRect();
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
  });
  el.addEventListener('pointermove', e => {
    let dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragging && Math.hypot(dx, dy) > 6) { dragging = true; el.classList.add('dragging'); }
    if (dragging) {
      // Karte darf die Handfläche beim Ziehen nicht verlassen (sonst "verschwindet" sie optisch)
      dx = Math.max(boxRect.left - elRect.left, Math.min(boxRect.right - elRect.right, dx));
      dy = Math.max(boxRect.top - elRect.top, Math.min(boxRect.bottom - elRect.bottom, dy));
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  });
  el.addEventListener('pointerup', e => {
    try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    if (dragging) {
      const box = el.parentElement;
      const others = [...box.children].filter(x => x !== el);
      let targetIdx = others.length;
      if (others.length) {
        // nächstgelegene Nachbarkarte (auch bei mehrzeiliger Hand), davor/danach einsortieren
        let bestI = 0, bestDist = Infinity;
        others.forEach((sib, i) => {
          const r = sib.getBoundingClientRect();
          const d = Math.hypot((r.left + r.width / 2) - e.clientX, (r.top + r.height / 2) - e.clientY);
          if (d < bestDist) { bestDist = d; bestI = i; }
        });
        const r = others[bestI].getBoundingClientRect();
        targetIdx = e.clientX < r.left + r.width / 2 ? bestI : bestI + 1;
      }
      const idx = hand.findIndex(x => cardId(x) === cardId(c));
      if (idx >= 0) { hand.splice(idx, 1); hand.splice(targetIdx, 0, c); }
      rerender();
    } else {
      el.style.transform = '';
      el.classList.remove('dragging');
      if (tapFn) tapFn();
    }
  });
  el.addEventListener('pointercancel', () => { el.style.transform = ''; el.classList.remove('dragging'); });
}

function renderOpps() {
  [1, 2].forEach(i => {
    const box = document.querySelector('#seat-' + i + ' .hand');
    box.innerHTML = '';
    if (state.revealed.includes(i)) {                 // Ouvert: Karten offen zeigen
      const hand = state.players[i].hand.slice();
      sortHand(hand, state.game);
      for (const c of hand) box.appendChild(cardEl(c, { showTrump: !!state.game }));
    } else {
      for (let k = 0; k < state.players[i].hand.length; k++) box.appendChild(backEl());
    }
  });
  const skatBox = document.getElementById('skatBack');
  skatBox.innerHTML = '';
  const showBacks = state.declarer === null;
  if (showBacks) { skatBox.appendChild(backEl()); skatBox.appendChild(backEl()); }
}

function renderTrick() {
  const box = document.getElementById('trick');
  box.innerHTML = '';
  for (const t of state.trick) {
    const el = cardEl(t.card, { showTrump: true });
    // Ablageplatz nach Sitz des Spielers
    const posClass = t.p === 0 ? 't0' : t.p === 2 ? 't2' : 't1';
    el.classList.add(posClass);
    box.appendChild(el);
  }
}

function renderSeatInfo() {
  for (let i = 0; i < 3; i++) {
    const seat = document.getElementById('seat-' + i);
    seat.querySelector('.pname').textContent = state.players[i].name;
    const tag = seat.querySelector('.ptag');
    tag.className = 'ptag';
    if (state.declarer === i) { tag.textContent = 'Alleinspieler'; tag.classList.add('decl'); }
    else if (state.declarer === null && vorhand() === i) { tag.textContent = 'Vorhand'; tag.classList.add('vh'); }
    else if (state.declarer !== null) { tag.textContent = 'Gegenspieler'; }
    else tag.textContent = ['Vorhand', 'Mittelhand', 'Hinterhand'][(i - vorhand() + 3) % 3];
  }
}

function renderScore() {
  const box = document.getElementById('scoreboard');
  box.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const c = document.createElement('div');
    c.className = 'scorechip' + (state.declarer === i ? ' decl' : '');
    c.innerHTML = `${state.players[i].name}: <b>${state.scores[i]}</b>`;
    box.appendChild(c);
  }
}

function setActive(i) { clearActive(); document.getElementById('seat-' + i)?.classList.add('active'); }
function clearActive() { document.querySelectorAll('.seat').forEach(s => s.classList.remove('active')); }

function bubble(txt) { document.getElementById('bubble').innerHTML = txt; }
function zeigeHinweis(txt) { document.getElementById('prompt').innerHTML = txt; }
function clearTrick() { state.trick = []; document.getElementById('trick').innerHTML = ''; }
function showSkatTaken() { /* Platzhalter für spätere Animation */ }

function askAction(buttons) {
  return new Promise((resolve, reject) => {
    const box = document.getElementById('actions');
    box.innerHTML = '';
    const cancel = () => { box.innerHTML = ''; reject(ABORT); };
    pendingAborts.add(cancel);
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.innerHTML = b.label;
      el.onclick = () => { pendingAborts.delete(cancel); box.innerHTML = ''; resolve(b.value); };
      box.appendChild(el);
    }
  });
}

function showResult(title, won, bodyHtml) {
  const center = document.getElementById('center');
  center.querySelector('.result')?.remove();
  const div = document.createElement('div');
  div.className = 'result';
  div.innerHTML = `<h2 class="${won ? 'won' : 'lost'}">${title}</h2><div class="detail">${bodyHtml}</div>`;
  center.appendChild(div);
}

// ---------------- Sortierung ----------------
function sortHand(hand, game) {
  const suitOrder = { E: 0, G: 1, H: 2, S: 3 };
  hand.sort((a, b) => {
    if (game) {
      const ia = cardInfo(a, game), ib = cardInfo(b, game);
      if (ia.trump !== ib.trump) return ia.trump ? -1 : 1;
      if (ia.trump && ib.trump) return ib.str - ia.str;
    }
    if (a.s !== b.s) return suitOrder[a.s] - suitOrder[b.s];
    const ord = { D: 0, T: 1, K: 2, O: 3, U: 4, '9': 5, '8': 6, '7': 7 };
    return ord[a.r] - ord[b.r];
  });
}

// ---------------- Menü / Einstellungen / Log ----------------
const LEVEL_INFO = {
  leicht: 'Anfänger: ohne Kartenzählen',
  mittel: 'Kartenzählen, ohne Positionsspiel',
  schwer: 'Kartenzählen + Positionsspiel'
};
const REIZ_INFO = {
  vorsichtig: 'reizt nur sehr sichere Blätter',
  normal: 'reizt solide gewinnbare Blätter',
  mutig: 'reizt auch grenzwertige Blätter, eine Stufe höher'
};

function optionRow(group, current, labels, infos) {
  const btns = Object.keys(labels).map(key =>
    `<button class="btn ${key === current ? 'primary' : 'ghostbtn'}" data-group="${group}" data-val="${key}">${labels[key]}</button>`
  ).join(' ');
  return `<div class="setrow">${btns}</div><div class="sethint">${infos[current]}</div>`;
}

function renderSkatliste() {
  if (!state || !state.history.length) return '<div class="sethint">Noch keine Runde gespielt.</div>';
  const rows = state.history.map(h =>
    `<tr><td>${h.round}</td><td>${h.label}</td>` +
    h.deltas.map(d => `<td class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d ? (d > 0 ? '+' : '') + d : ''}</td>`).join('') +
    `</tr>`
  ).join('');
  const totals = state.scores.map(s => `<td><b>${s}</b></td>`).join('');
  return `<div style="overflow-x:auto"><table class="skattable"><thead><tr><th>#</th><th>Spiel</th>` +
    `<th>${P_NAMES[0]}</th><th>${P_NAMES[1]}</th><th>${P_NAMES[2]}</th></tr></thead>` +
    `<tbody>${rows}</tbody><tfoot><tr><td colspan="2">Gesamt</td>${totals}</tr></tfoot></table></div>`;
}

function renderStatistik() {
  const rows = [0, 1, 2].map(i => {
    const s = stats.perPlayer[i];
    const quote = s.declarerGames ? Math.round(100 * s.declarerWon / s.declarerGames) : 0;
    return `<tr><td>${P_NAMES[i]}</td><td>${s.declarerWon}/${s.declarerGames} (${quote}%)</td>` +
      `<td>${s.schneider}</td><td>${s.schwarz}</td><td>${s.ramschLost}/${s.ramschRounds}</td></tr>`;
  }).join('');
  return `<div style="overflow-x:auto"><table class="skattable"><thead><tr><th>Spieler</th><th>Alleinspieler-Siege</th>` +
    `<th>Schneider</th><th>Schwarz</th><th>Ramsch verloren</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderMenu() {
  const box = document.getElementById('logInner');
  box.innerHTML =
    '<h3>Turnierliste (aktuelles Match)</h3>' +
    renderSkatliste() +
    '<h3 style="margin-top:16px">Statistik (gesamt)</h3>' +
    renderStatistik() +
    '<h3 style="margin-top:16px">Spielstärke der Gegner</h3>' +
    optionRow('level', settings.level, { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Schwer' }, LEVEL_INFO) +
    '<h3 style="margin-top:16px">Reiz-Stil der Gegner</h3>' +
    optionRow('reiz', settings.reiz, { vorsichtig: 'Vorsichtig', normal: 'Normal', mutig: 'Mutig' }, REIZ_INFO) +
    '<h3 style="margin-top:16px">Spielverlauf</h3>' +
    (state ? state.logs.slice(-30).map(l => `<div class="row">${l}</div>`).join('') : '') +
    '<h3 style="margin-top:16px">Neu starten</h3>' +
    '<div class="row"><button class="btn danger" id="restartBtn">Neues Match (Punkte 0)</button></div>';

  box.querySelectorAll('button[data-group]').forEach(b => {
    b.onclick = () => {
      settings[b.dataset.group] = b.dataset.val;
      saveSettings();
      renderMenu(); // Auswahl sofort hervorheben
    };
  });
  document.getElementById('restartBtn').onclick = () => {
    // Rückfrage nur, wenn wirklich eine Runde läuft (sonst gibt es nichts zu verwerfen)
    const laeuft = state && (state.round > 1 || state.players.some(pl => pl.hand.length));
    if (laeuft && !confirm('Laufendes Spiel verwerfen und neues Match starten?')) return;
    document.getElementById('log').classList.add('hidden'); startGame();
  };
}

document.getElementById('menuBtn').onclick = () => {
  renderMenu();
  document.getElementById('log').classList.remove('hidden');
};
document.getElementById('logClose').onclick = () => document.getElementById('log').classList.add('hidden');

// ---------------- Start ----------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
startGame();
