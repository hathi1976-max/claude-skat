/* =========================================================================
   Skat – Altenburger Blatt
   Deutsches Bild: Eichel (E), Grün (G), Herz (H), Schellen (S)
   Werte: Daus(A)=11, Zehn(10)=10, König(K)=4, Ober(O)=3, Unter(U)=2, 9/8/7=0

   Einstieg: verdrahtet die Module und startet die erste Partie.
     js/regeln.js   Karten, Trumpfordnung, Stich, Spitzen (pur)
     js/zustand.js  Spielzustand, Einstellungen, Statistik, Spielverlauf
     js/takt.js     Pausen und Abbruch der laufenden Runden-Kette
     js/ki.js       Computergegner
     js/wertung.js  Spielwert und Abrechnung
     js/anzeige.js  DOM: Karten, Sitze, Menü, Eingaben
     js/ablauf.js   Rundenablauf
   ========================================================================= */

import { state } from './js/zustand.js';
import { tempo } from './js/takt.js';
import { renderMenu, setNeustart } from './js/anzeige.js';
import { startGame } from './js/ablauf.js';

// ---------------- Menü ----------------
setNeustart(startGame);
document.getElementById('menuBtn').onclick = () => {
  renderMenu();
  document.getElementById('log').classList.remove('hidden');
};
document.getElementById('logClose').onclick = () => document.getElementById('log').classList.add('hidden');

// ---------------- Testzugang ----------------
// Der Selbstspiel-Prüfstand (tests/selbstspiel.html) steuert die echte Seite im
// iframe. An Modul-Bindungen kommt er von außen gar nicht heran, deshalb dieser
// schmale, ausdrücklich benannte Zugang.
window.SkatTest = {
  get state() { return state; },
  tempo: f => tempo(f),           // 0 = ohne Pausen durchlaufen
  neustart: () => startGame()
};

// ---------------- Start ----------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
startGame();
