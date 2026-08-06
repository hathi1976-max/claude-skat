/* Rundenablauf: geben, reizen, Skat/Handspiel, Spielansage, Stiche, Wertung.
   Eine lange async-Kette; jeder Durchlauf merkt sich seine Generation, damit
   ein Neustart die alte Kette sauber abwirft (siehe takt.js). */

import {
  state, neuerZustand, P_NAMES, vb, logge, vorhand, mittelhand, hinterhand
} from './zustand.js';
import {
  SUITS, RANKS, SUIT_NAME, LADDER, cardId, cardInfo, legalMoves, trickWinner, sortHand
} from './regeln.js';
import { ABORT, gen, abortRun, wait } from './takt.js';
import {
  resetTracker, noteCard, reizMax, aiDiscard, aiPlay, bestGame,
  isGrandOuvertHand, shouldPlayHand
} from './ki.js';
import { scoreRound, scoreRamsch } from './wertung.js';
import {
  renderAll, renderMyHand, renderScore, setActive, clearActive, bubble,
  zeigeHinweis, clearTrick, showSkatTaken, askAction, humanPlay, suitGlyph
} from './anzeige.js';

function startGame() {
  abortRun();          // laufende Runden-Kette beenden, bevor state ersetzt wird
  neuerZustand();
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
  logge(`<b>Spiel ${state.round}</b> – Geber: ${P_NAMES[state.dealer]}`);
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
      logge(willSpielen ? 'Du spielst für 18' : 'Du willst nicht – Ramsch');
      await wait(350);
    } else {
      willSpielen = aiMax[VH] >= 18;
      await aiSay(VH, willSpielen ? '18' : 'Ramsch', willSpielen);
      logge(`${P_NAMES[VH]} ${willSpielen ? 'spielt für 18' : 'will nicht – Ramsch'}`);
    }
    if (willSpielen) { declarer = VH; reiz = 18; }
    zeigeHinweis('');
  }

  if (reiz === 0) {
    // Auch Vorhand will nicht -> Ramsch
    state.declarer = null;
    state.game = { type: 'ramsch', trump: null, hand: false, ouvert: false, label: 'Ramsch' };
    bubble('Alle passen – Ramsch!');
    logge('Alle passen – Ramsch');
    renderAll();
    await wait(900);
    return;
  }

  state.declarer = declarer;
  state.reizwert = reiz;
  bubble(`${P_NAMES[declarer]} ${vb(declarer)} (gereizt bis ${reiz}).`);
  logge(`Alleinspieler: ${P_NAMES[declarer]}, Reizwert ${reiz}`);
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
    if (a === 'yes') { bubble(`Du: ${val}`); logge(`Du sagst ${val}`); }
    else { bubble('Du: Passe'); logge('Du passt'); }
    await wait(350);
    return a === 'yes';
  } else {
    zeigeHinweis(`<b>${other}</b> sagt <b>${val}</b>. Halten?`);
    const a = await askAction([
      { label: `${val} halten (Ja)`, value: 'yes', cls: 'primary' },
      { label: 'Passe', value: 'no', cls: 'danger' }
    ]);
    if (a === 'yes') { bubble(`Du hältst ${val}`); logge(`Du hältst ${val}`); }
    else { bubble('Du: Passe'); logge('Du passt'); }
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
  logge(`Spielansage: ${name}${handTag}`);
  await wait(1100);
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
  // Ouvert heißt offen: die Karten des Alleinspielers liegen für alle sichtbar.
  // Das galt bisher nur für die KI – der Mensch bekam den höheren Spielwert,
  // ohne die Karten herzuzeigen.
  if (g.ouvert) state.revealed = [0];
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

export { startGame };
