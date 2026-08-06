/* Alles, was das DOM anfasst: Karten zeichnen, Sitze, Stich, Menü, und die
   beiden Eingaben des Menschen (Knopf und Kartenklick).

   Kennt den Rundenablauf bewusst nicht: der Neustart-Knopf ruft eine von
   außen gesetzte Funktion (`setNeustart`), sonst würden sich Anzeige und
   Ablauf gegenseitig importieren. */

import { state, P_NAMES, settings, saveSettings, stats, vorhand } from './zustand.js';
import { cardId, RANK_LABEL, cardInfo, sortHand } from './regeln.js';
import { ABORT, pendingAborts } from './takt.js';

let cardResolver = null; // löst Kartenklick auf
let cardLegal = null;

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
    // Ouvert sichtbar machen – auch beim Menschen, dessen Karten ohnehin offen liegen
    const offen = state.revealed.includes(i) ? ' · offen' : '';
    if (state.declarer === i) { tag.textContent = 'Alleinspieler' + offen; tag.classList.add('decl'); }
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
    '<div class="row"><button class="btn danger" id="restartBtn">Neues Match (Punkte 0)</button></div>' +
    // Sichtbare Version: zeigt sofort, ob der Service Worker noch alten Code ausliefert
    `<div class="sethint" style="margin-top:16px">Version ${self.APP_VERSION || '?'}</div>`;

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
    // neustarten(), nicht startGame(): die Anzeige kennt den Ablauf nicht,
    // der Einstieg hängt die Funktion über setNeustart ein.
    document.getElementById('log').classList.add('hidden'); neustarten();
  };
}

// Wird vom Einstieg gesetzt; der Neustart-Knopf im Menü ruft sie auf.
let neustarten = () => {};
function setNeustart(fn) { neustarten = fn; }

export {
  suitGlyph, cardEl, renderAll, renderMyHand, renderOpps, renderTrick,
  renderSeatInfo, renderScore, setActive, clearActive, bubble, zeigeHinweis,
  clearTrick, showSkatTaken, askAction, showResult, humanPlay,
  renderMenu, setNeustart
};
