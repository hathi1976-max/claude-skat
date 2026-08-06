/* Regelkern: Trumpfordnung, Bedienzwang, Stich, Spitzen.
   Alles hier sind reine Funktionen über einfachen Objekten – die Tests brauchen
   weder DOM noch Spielzustand (Befund D2). */

import { gruppe, test, gleich, wahr, falsch } from './lauf.js';
import { cardInfo, legalMoves, trickWinner, countMatadors, sortHand, isMit, cardId }
  from '../js/regeln.js';

// Kurzschreibweise: k('EU') = Eichel-Unter
const k = id => ({ s: id[0], r: id.slice(1) });
const hand = (...ids) => ids.map(k);
// Stich aus Karten der Spieler 0,1,2 in Ausspielreihenfolge
const stich = (...ids) => ids.map((id, i) => ({ p: i, card: k(id) }));

const EICHEL = { type: 'suit', trump: 'E', label: 'Eichel-Spiel' };
const HERZ   = { type: 'suit', trump: 'H', label: 'Herz-Spiel' };
const GRAND  = { type: 'grand', label: 'Grand' };
const NULL_  = { type: 'null', label: 'Null' };
const RAMSCH = { type: 'ramsch', label: 'Ramsch' };

gruppe('cardInfo', () => {
  test('Unter sind im Farbspiel Trumpf, nicht ihre Farbe', () => {
    const i = cardInfo(k('SU'), EICHEL);
    wahr(i.trump, 'Schellen-Unter muss Trumpf sein');
    gleich(i.suit, 'T');
  });

  test('Eichel-Unter ist der höchste Trumpf', () => {
    const alle = ['EU', 'GU', 'HU', 'SU', 'ED', 'ET'].map(id => cardInfo(k(id), EICHEL).str);
    gleich(Math.max(...alle), cardInfo(k('EU'), EICHEL).str);
  });

  test('Trumpffarbe steht über den Fehlfarben, unter den Untern', () => {
    const trumpfDaus = cardInfo(k('ED'), EICHEL).str;
    gleich(trumpfDaus > cardInfo(k('GD'), EICHEL).str, true, 'Trumpf-Daus über Fehl-Daus');
    gleich(trumpfDaus < cardInfo(k('SU'), EICHEL).str, true, 'Trumpf-Daus unter dem kleinsten Unter');
  });

  test('Grand: nur die vier Unter sind Trumpf', () => {
    wahr(cardInfo(k('HU'), GRAND).trump, 'Herz-Unter');
    falsch(cardInfo(k('ED'), GRAND).trump, 'Eichel-Daus ist im Grand kein Trumpf');
  });

  test('Ramsch wird wie Grand gespielt (Befund B5)', () => {
    gleich(cardInfo(k('HU'), RAMSCH).suit, cardInfo(k('HU'), GRAND).suit);
    gleich(cardInfo(k('ED'), RAMSCH).str, cardInfo(k('ED'), GRAND).str);
  });

  test('Null: kein Trumpf, eigene Reihenfolge A,K,O,U,10,9,8,7', () => {
    falsch(cardInfo(k('EU'), NULL_).trump, 'im Null ist kein Unter Trumpf');
    const str = id => cardInfo(k(id), NULL_).str;
    gleich(str('ED') > str('EK'), true, 'Daus über König');
    gleich(str('EU') > str('ET'), true, 'Unter über der Zehn');
    gleich(str('ET') > str('E9'), true, 'Zehn über der Neun');
  });
});

gruppe('legalMoves', () => {
  test('ohne angespielte Karte ist alles erlaubt', () => {
    const h = hand('ED', 'G7', 'SU');
    gleich(legalMoves(h, [], EICHEL).length, 3);
  });

  test('Bedienzwang in der Fehlfarbe', () => {
    const h = hand('GD', 'G7', 'HD', 'EU');
    const z = legalMoves(h, stich('GK'), EICHEL).map(cardId);
    gleich(z.join(','), 'GD,G7', 'nur die Grün-Karten sind erlaubt');
  });

  test('angespielter Unter verlangt Trumpf, nicht die Unterfarbe', () => {
    // Herz-Unter angespielt = Trumpf gefordert. Auf der Hand: ein Unter und
    // Karten der Trumpffarbe Eichel – beides ist Trumpf, Herz-Karten nicht.
    const h = hand('SU', 'E9', 'HD', 'G7');
    const z = legalMoves(h, stich('HU'), EICHEL).map(cardId);
    gleich(z.join(','), 'SU,E9', 'Unter und Trumpffarbe, nicht die Herz-Karte');
  });

  test('ohne bedienbare Karte ist alles erlaubt', () => {
    const h = hand('ED', 'EK', 'SU');
    gleich(legalMoves(h, stich('G9'), EICHEL).length, 3);
  });

  test('Grand: angespielter Unter verlangt nur Unter', () => {
    const h = hand('EU', 'ED', 'GD');
    const z = legalMoves(h, stich('HU'), GRAND).map(cardId);
    gleich(z.join(','), 'EU', 'im Grand ist nur der Unter Trumpf');
  });
});

gruppe('trickWinner', () => {
  test('höchste Karte der angespielten Farbe gewinnt', () => {
    gleich(trickWinner(stich('GK', 'GD', 'G9'), EICHEL), 1);
  });

  test('Trumpf sticht die Fehlfarbe', () => {
    gleich(trickWinner(stich('GD', 'E7', 'GT'), EICHEL), 1, 'die kleine Eichel-7 sticht');
  });

  test('Unter sticht die Trumpffarbe', () => {
    gleich(trickWinner(stich('ED', 'SU', 'E9'), EICHEL), 1, 'Schellen-Unter über dem Eichel-Daus');
  });

  test('Eichel-Unter schlägt jeden anderen Unter', () => {
    gleich(trickWinner(stich('SU', 'HU', 'EU'), EICHEL), 2);
    gleich(trickWinner(stich('EU', 'GU', 'HU'), GRAND), 0);
  });

  test('Abwerfen gewinnt nie – auch nicht mit dem Daus', () => {
    // Grün angespielt, Spieler 1 wirft das Eichel-Daus ab (Fehlfarbe, kein Trumpf
    // im Grand), Spieler 2 bedient klein: der Anspieler behält den Stich.
    gleich(trickWinner(stich('GD', 'ED', 'G7'), GRAND), 0);
  });

  test('Null: der höchste der angespielten Farbe gewinnt, Unter zählt niedrig', () => {
    gleich(trickWinner(stich('EU', 'ED', 'E7'), NULL_), 1, 'Daus schlägt den Unter');
  });
});

gruppe('countMatadors', () => {
  // Die Spitzen zählen aus den 12 Karten des Alleinspielers (10 + Skat).
  const auffuellen = (ids, fuellIds) => hand(...ids, ...fuellIds).slice(0, 12);

  test('mit 4 im Farbspiel', () => {
    const karten = auffuellen(
      ['EU', 'GU', 'HU', 'SU'],
      ['G7', 'G8', 'G9', 'GO', 'GK', 'GT', 'GD', 'H7']);
    gleich(countMatadors(karten, EICHEL), 4);
  });

  test('ohne 2 im Farbspiel', () => {
    // Eichel-Unter und Grün-Unter fehlen, Herz-Unter ist da → "ohne 2"
    const karten = auffuellen(
      ['HU', 'SU', 'ED'],
      ['ET', 'EK', 'EO', 'E9', 'E8', 'E7', 'G7', 'G8', 'G9']);
    gleich(countMatadors(karten, EICHEL), 2);
  });

  test('mit 5 zählt über die Unter hinaus in die Trumpffarbe', () => {
    const karten = auffuellen(
      ['EU', 'GU', 'HU', 'SU', 'ED'],
      ['G7', 'G8', 'G9', 'GO', 'GK', 'GT', 'H7']);
    gleich(countMatadors(karten, EICHEL), 5, 'vier Unter plus Trumpf-Daus');
  });

  test('Grand mit allen vier Untern', () => {
    const karten = auffuellen(
      ['EU', 'GU', 'HU', 'SU'],
      ['ED', 'ET', 'EK', 'EO', 'E9', 'E8', 'E7', 'G7']);
    gleich(countMatadors(karten, GRAND), 4, 'im Grand ist bei 4 Schluss');
  });

  test('Grand ohne 1', () => {
    const karten = auffuellen(
      ['GU', 'HU', 'SU'],
      ['ED', 'ET', 'EK', 'EO', 'E9', 'E8', 'E7', 'G7', 'G8']);
    gleich(countMatadors(karten, GRAND), 1, 'nur der Eichel-Unter fehlt');
  });
});

gruppe('isMit', () => {
  test('mit = Eichel-Unter auf der Hand', () => {
    wahr(isMit(hand('EU', 'G7')));
    falsch(isMit(hand('GU', 'HU', 'SU')));
  });
});

gruppe('sortHand', () => {
  test('Trümpfe stehen vorn, absteigend nach Stärke', () => {
    const h = hand('G7', 'ED', 'SU', 'EU', 'H9');
    sortHand(h, EICHEL);
    gleich(h.slice(0, 3).map(cardId).join(','), 'EU,SU,ED');
  });

  test('ohne Spiel wird nur nach Farbe und Rang sortiert', () => {
    const h = hand('S7', 'ED', 'G9');
    sortHand(h, null);
    gleich(h.map(cardId).join(','), 'ED,G9,S7');
  });
});
