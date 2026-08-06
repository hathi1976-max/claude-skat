/* Skatregeln: Karten, Trumpfordnung, Bedienzwang, Stich, Spitzen.
   Reiner Regelkern – kein DOM, kein Spielzustand, keine KI. Alles hier ist
   eine Funktion ihrer Argumente und damit direkt testbar. */

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
// Komplettes Blatt (für Kartenzählen)
const FULL_DECK = (() => { const d = []; for (const s of SUITS) for (const r of RANKS) d.push({ s, r }); return d; })();
// ---------- Karten-Logik ----------
// Trumpf, Bedien-Farbe und Stärke einer Karte im jeweiligen Spiel.
// 'T' als suit heißt: gehört zur Trumpf-Gruppe (Unter + ggf. Trumpffarbe).
function cardInfo(c, game) {
  if (!game) return { trump: false, suit: c.s, str: FARBSTR[c.r] ?? 0 };
  // Null: kein Trumpf, eigene Reihenfolge (A,K,O,U,10,9,8,7)
  if (game.type === 'null') return { trump: false, suit: c.s, str: NULLSTR[c.r] };
  // Grand und Ramsch: nur die vier Unter sind Trumpf (Ramsch wird wie Grand gespielt)
  if (game.type === 'grand' || game.type === 'ramsch') {
    return c.r === 'U' ? { trump: true, suit: 'T', str: 200 + UNTER_BONUS[c.s] }
                       : { trump: false, suit: c.s, str: FARBSTR[c.r] };
  }
  // Farbspiel: vier Unter über der kompletten Trumpffarbe
  if (c.r === 'U') return { trump: true, suit: 'T', str: 200 + UNTER_BONUS[c.s] };
  if (c.s === game.trump) return { trump: true, suit: 'T', str: 100 + FARBSTR[c.r] };
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

// "mit" oder "ohne" Spitzen? Hängt allein am Eichel-Unter, dem höchsten Trumpf –
// und zwar bei Farbspiel wie bei Grand gleichermaßen. Deshalb braucht die
// Funktion das Spiel nicht zu kennen (Null-Spiele haben keine Spitzen).
function isMit(cards) {
  return cards.some(c => cardId(c) === 'EU');
}

export {
  SUITS, SUIT_NAME, GRUNDWERT, RANKS, AUGEN, FARBSTR, NULLSTR, UNTER_BONUS,
  RANK_LABEL, LADDER, cardId, FULL_DECK,
  cardInfo, legalMoves, trickWinner, countMatadors, sortHand, isMit
};
