/* Spielzustand, Einstellungen, Statistik und Spielverlauf.

   `state` wird beim Neustart komplett ersetzt. Damit alle Module dieselbe
   Fassung sehen, wird es als live binding exportiert und ausschließlich hier
   neu gesetzt (`neuerZustand()`) – ein importiertes `let` lässt sich von
   außen nicht zuweisen. */

// Verb-Konjugation: Spieler 0 ist "Du" (2. Person)
const vb = i => (i === 0 ? 'spielst' : 'spielt');

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

// Ersetzt den Zustand durch eine frische Partie (einzige Zuweisung an state).
function neuerZustand() {
  state = newState();
  return state;
}

// Spielverlauf protokollieren. Angezeigt werden nur die letzten 30 Zeilen,
// aufgehoben die letzten LOG_MAX – sonst wächst die Liste über die gesamte
// Match-Dauer unbegrenzt.
const LOG_MAX = 200;
function logge(text) {
  state.logs.push(text);
  if (state.logs.length > LOG_MAX) state.logs.splice(0, state.logs.length - LOG_MAX);
}

function vorhand() { return (state.dealer + 1) % 3; }
function mittelhand() { return (state.dealer + 2) % 3; }
function hinterhand() { return state.dealer; }

export {
  P_NAMES, vb, state, neuerZustand,
  settings, saveSettings, stats, recordDeclarerStat, recordRamschStat,
  LOG_MAX, logge, vorhand, mittelhand, hinterhand
};
