# Skat – Entwicklungsdokumentation

Stand: 05.08.2026. Reine Vanilla-Web-App ohne Framework, ohne Build-Schritt,
ohne Abhängigkeiten. Alle Dateien sind statisch auslieferbar.

## Projektstruktur

```
claude-skat/
├── index.html            Oberfläche: Sitze, Stich, Fußzeile mit Knöpfen, Menü
├── style.css             Layout, Kartenoptik, Animationen (responsiv)
├── app.js                Einstieg: verdrahtet die Module, startet die Partie
├── js/
│   ├── regeln.js         Karten, Trumpfordnung, Bedienzwang, Stich, Spitzen (pur)
│   ├── zustand.js        Spielzustand, Einstellungen, Statistik, Spielverlauf
│   ├── takt.js           Pausen und Abbruch der laufenden Runden-Kette
│   ├── ki.js             Computergegner (Reizen, Drücken, Spielen, Kartenzählen)
│   ├── wertung.js        Spielwert und Abrechnung (`bewerteSpiel` ist pur)
│   ├── anzeige.js        DOM: Karten, Sitze, Menü, Eingaben des Menschen
│   └── ablauf.js         Rundenablauf: Geben, Reizen, Drücken, Stiche
├── tests/                Testläufer, Regel- und Wertungstests, Selbstspiel-Prüfstand
├── version.js            einzige Stelle für die Versionsnummer
├── sw.js                 Service Worker (Offline-Cache der App-Shell)
├── manifest.webmanifest  PWA-Manifest (Android-Installation)
├── icons/                App-Icon (SVG)
├── README.md             Kurzüberblick aus Nutzersicht
├── CODEREVIEW.md         Befundliste des Code-Reviews mit Erledigungsstand
└── ENTWICKLUNG.md        diese Datei
```

## Aufbau

### Spielregeln (pur, ohne DOM)

- Karte = `{s, r}`, `s` ∈ `E G H S` (Eichel, Grün, Herz, Schellen),
  `r` ∈ `D T K O U 9 8 7` (Daus, Zehn, König, Ober, Unter, …).
  `cardId({s:'E',r:'U'}) === 'EU'`.
- `cardInfo(karte, spiel)` ist die eine Stelle, an der die Trumpfordnung
  festgelegt wird: sie liefert `{trump, suit, str}`. `suit` ist die Farbe zum
  Bedienen (`'T'` für alle Trümpfe), `str` die Stärke innerhalb der Gruppe.
  Die vier Unter liegen bei 200+, die Trumpffarbe bei 100+, Fehlfarben darunter.
- `legalMoves`, `trickWinner`, `countMatadors`, `sortHand` bauen darauf auf und
  sind frei von Seiteneffekten.

### KI

- **Handbewertung** (`evalSuit`, `evalGrand`) liefert je drei Schwellen
  (`strong` < `winnable` < `nearWin`), aus denen der Reiz-Stil auswählt.
- **Kartengedächtnis** (`tracker`): gespielte Karten plus Renonce-Erkennung
  (wer welche Farbe nicht bedient hat). Daraus ergibt sich, welche Karte die
  höchste noch lebende ihrer Gruppe ist.
- Drei Stufen: *leicht* spielt ohne Gedächtnis (`simplePlay`), *mittel* zählt
  Karten, *schwer* zusätzlich mit Positionsspiel.

### Ablauf

Der Rundenablauf ist eine `async`-Kette (`nextRound` → `reizen` →
`declarerPhase` → `playTricks` → Wertung). Menschliche Eingaben werden über
`askAction()` und `humanPlay()` als Promise abgeholt.

**Generationszähler:** Jede Kette merkt sich beim Start `gen`. Ein Neustart
erhöht `gen` und weist alle wartenden Promises mit `ABORT` ab — sonst würde die
alte Kette nach dem nächsten `await` auf dem neuen Zustand weiterspielen
(Befund A2 im Code-Review).

## PWA

- `sw.js` cacht die App-Shell (network-first: online immer aktuell, offline aus
  dem Cache).
- **Bei jeder Änderung an ausgelieferten Dateien die Version hochzählen**,
  sonst sehen installierte Apps den alten Stand.

## Entwickeln und Testen

```
py -m http.server 8199 --directory .
```

im Projektordner starten, dann `http://localhost:8199` öffnen.

Zwei Prüfstände, beide ohne Installation im Browser:

| Aufruf | Prüft |
|---|---|
| `tests/test.html` | Regelkern und Spielwert-Rechnung, 46 Fälle, reine Funktionen |
| `tests/selbstspiel.html?runden=30&seed=7` | den kompletten Ablauf: spielt die echte `index.html` im iframe durch und meldet jede Ausnahme, jede `console.error` und jede Runde ohne Wertung |

Der Selbstspiel-Prüfstand setzt `Math.random` im iframe auf einen gesäten
Generator — deshalb bleibt `Math.random` im Spiel selbst stehen (Befund E).

---

# Arbeitsjournal

## 05.08.2026 — Code-Review, Abschnitt A (Vorhand darf spielen)

**Ausgangslage:** Der Commit vom Vortag hatte A2 (Generationszähler), A3
(`splice(-1)`-Guard), C3 und C4 erledigt; A1 lag halbfertig im Arbeitsbaum.

**Geändert:** `reizen()` fragt die Vorhand jetzt, bevor der Ramsch fällt.
Passen Mittel- und Hinterhand sofort, hat die Vorhand noch gar kein Gebot
abgegeben und darf nach der Skatordnung ansagen, dass sie bei 18 spielt. Der
Mensch bekommt zwei Knöpfe, die KI entscheidet über ihre Reizgrenze
(`aiMax[VH] >= 18`) und sagt es sichtbar an. Erst wenn auch die Vorhand
ablehnt, greift der Ramsch-Zweig.

**Geprüft:** Häufigkeit mit einem Python-Nachbau der Reizlogik (`evalSuit`,
`evalGrand`, `reizMax`) über 5.000 zufällige Blätter je Reiz-Stil gemessen:

| Reiz-Stil | MH+HH passen sofort | davon: VH hätte gespielt | betroffene Runden |
|---|---|---|---|
| vorsichtig | 27,6 % | 59,6 % | 16,5 % |
| normal (Voreinstellung) | 12,1 % | 86,1 % | 10,4 % |
| mutig | 0,7 % | 100 % | 0,7 % |

Bei der Voreinstellung ging also **jede zehnte Runde** zu Unrecht in den Ramsch.
Der Pfad selbst ist später durch `tests/ablauf.test.js` abgedeckt.

## 05.08.2026 — Regelabweichungen (Abschnitt B) und KI (C1/C2)

**Geändert:**

1. **Wertung als reine Funktion.** `bewerteSpiel({spiel, augen, stiche,
   matadore, reizwert})` rechnet den Spielwert ohne DOM und ohne `state` und ist
   damit prüfbar. `scoreRound()` ist nur noch Anzeige drumherum. Inhaltlich drei
   Korrekturen:
   - **Schneider und Schwarz zählen in beide Richtungen** (B2). Wird der
     Alleinspieler mit ≤ 30 Augen oder ohne Stich abgefertigt, steigt der
     Spielwert und damit sein Verlust.
   - **Überreizen bei Null** (B3) wird geprüft: Null (23) nach einem Gebot von
     24 ist verloren, nicht gewonnen.
   - **Grand Ouvert** (B4) rechnet mit `Spitzen + 7`, weil Hand, Schneider,
     Schneider angesagt, Schwarz, Schwarz angesagt und Ouvert alle enthalten
     sind.
2. **Ouvert legt jetzt auch beim Menschen offen** (B1): `humanDeclare` setzt
   `state.revealed`, der Sitz zeigt „· offen".
3. **Die KI nutzt offene Karten** (C2) über `kannSchlagen`/`exaktSicher` — sie
   *ergänzen* das Kartenzählen, statt (wie ursprünglich vorgeschlagen) die
   offenen Karten aus der Gefahrenmenge zu streichen; letzteres hätte die KI
   schlechter spielen lassen. Gegen Null Ouvert sucht die Verteidigung eine
   Farbe, in der der Alleinspieler den Stich nehmen muss.
4. `cardInfo` nennt Ramsch ausdrücklich (B5), `isMit` verliert den ungenutzten
   Parameter (C1).

**Geprüft:**

- **Selbstspiel-Prüfstand** neu gebaut: `tests/selbstspiel.html` lädt die echte
  `index.html` in einem iframe, setzt das Tempo auf 0 und klickt Knöpfe und
  Karten wie ein Mensch. 200 Runden mit festem Zufalls-Seed liefen ohne
  Ausnahme, ohne `console.error` und ohne Runde ohne Wertung; abgedeckt waren
  alle Spielarten inklusive Grand Ouvert, Null Ouvert, Hand und Ramsch. Der
  Prüfstand braucht `window.SkatTest` in `app.js`, weil `let`-Bindungen nicht
  am `window` hängen.
- **Wertung gegengerechnet** (Eichel-Spiel, mit 2, Skat aufgenommen):

  | Fall | vorher | nachher |
  |---|---|---|
  | verloren mit 25 Augen | −72 | **−96** |
  | verloren ohne Stich | −72 | **−120** |
  | Null (23) nach Gebot 24 | **+23** | **−46** |
  | Grand Ouvert mit 4, gewonnen | +216 | **+264** |
  | Grand Ouvert mit 4, verloren | −432 | **−528** |
  | Schellen ohne 1 (18) nach Gebot 20 | −54 | −54 (unverändert) |

## 05.08.2026 — Versionsnummer an einer Stelle (D3) und Kleinigkeiten (E)

**Geändert:**

- Neue Datei `version.js` (`self.APP_VERSION = 'v10';`) ist die einzige Stelle
  für die Version. `sw.js` holt sie sich per `importScripts` und baut daraus
  seinen Cache-Namen, `index.html` bindet sie vor `app.js` ein, das Menü zeigt
  sie ganz unten an. `self.` statt `const`, weil der Wert im Fenster **und** im
  Service Worker sichtbar sein muss.
- Alle 13 `state.logs.push(...)` laufen über `logge(text)`, das den
  Spielverlauf auf 200 Zeilen kappt.
- Bewusst **nicht** umgesetzt: `crypto.getRandomValues` beim Geben (der
  Prüfstand braucht ein überschreibbares `Math.random`, um Läufe zu
  wiederholen), delegierte Zeiger-Listener beim Kartenziehen (Mikro-Optimierung
  mit echtem Risiko, gehört im Browser mit Maus und Finger geprüft) und die
  `innerHTML`-Stellen (es gibt weiterhin keine frei wählbaren Namen).

**Geprüft:** Selbstspiel über 60 Runden mit frischem Chrome-Profil, ohne
Beanstandung. Der Prüfstand kontrolliert jetzt zusätzlich die Kappung des
Spielverlaufs (genau 200 Zeilen bei Grenze 200) und liest die Versionszeile aus
dem Menü (meldet `v10`).

## 06.08.2026 — Aufteilung angeschlossen (D1) und Tests (D2)

### Der Zwischenstand war schlimmer als der Ausgangszustand

Die Aufteilung aus D1 lag als sieben Dateien unter `js/` vor, `app.js` war auf
43 Zeilen Verdrahtung geschrumpft — aber `index.html` band sie weiterhin als
klassisches Skript ein (`<script src="app.js">`). Ein Modul mit `import` läuft
so gar nicht: die App startete nicht. Angeschlossen wurde sie mit
`<script type="module" src="app.js">`, dazu die sieben Module in die
`ASSETS`-Liste von `sw.js` und die Version auf `v11`.

### Zwei Fehler, die die Aufteilung hinterlassen hatte

Beim Verschieben von Code zwischen Dateien geht genau das verloren, was vorher
selbstverständlich im selben Namensraum lag. Gefunden mit einem kleinen
Abgleich „welcher Bezeichner wird benutzt, ist aber weder importiert noch in
der Datei definiert":

| Datei | Fehler | Wirkung |
|---|---|---|
| `js/wertung.js` | `GRUNDWERT` benutzt, nicht importiert | **jede** Abrechnung außer Null bricht mit `ReferenceError` ab |
| `js/anzeige.js` | Neustart-Knopf rief `startGame()` statt `neustarten()` | „Neues Match" im Menü wirft `ReferenceError` |

Der zweite ist die Kehrseite der Entkopplung: die Anzeige darf den Ablauf
bewusst nicht importieren (sonst importieren sich beide gegenseitig), deshalb
gibt es `setNeustart`. Die Aufrufstelle war beim Verschieben nicht mitgezogen
worden.

**Gegenprobe zum ersten Fehler:** dieselbe Funktion einmal mit und einmal ohne
den Import geladen — mit Import ergibt ein gewonnenes Eichel-Spiel mit 2 Spitzen
den Wert 36, ohne Import bricht sie mit „GRUNDWERT is not defined" ab.

### Tests (D2)

`tests/test.html` mit demselben abhängigkeitsfreien Läufer wie in den
Schwesterprojekten (`lauf.js`), **46 Fälle**:

| Datei | Fälle | Inhalt |
|---|---:|---|
| `regeln.test.js` | 26 | `cardInfo` (Farbspiel, Grand, Ramsch, Null), `legalMoves` (Bedienzwang, Trumpfzwang bei angespieltem Unter), `trickWinner` (Trumpf sticht Farbe, Unter sticht Trumpffarbe, Eichel-Unter höchster, Abwerfen gewinnt nie), `countMatadors` (mit 4, ohne 2, mit 5, Grand), `isMit`, `sortHand` |
| `wertung.test.js` | 20 | `bewerteSpiel` als Regressionsnetz für B2 (Schneider/Schwarz gegen den Alleinspieler), B3 (Überreizen bei Null), B4 (Grand Ouvert) sowie Überreizen im Farbspiel |

**Beim Schreiben aufgefallen:** Die Gegenproben in `CODEREVIEW.md` nennen
−96/−120/−528 — das sind die **Punktänderungen**, nicht die Spielwerte (ein
verlorenes Spiel kostet den doppelten Spielwert). Die ersten beiden Tests waren
entsprechend falsch angesetzt und schlugen fehl, obwohl der Code stimmte. Sie
prüfen jetzt beide Größen und benennen den Zusammenhang.

**Gegenprobe der Regressionstests** — jeder Befund testweise wieder eingebaut:

| Wieder eingebaut | Ergebnis | Test erwartet |
|---|---|---|
| B2: Schneider/Schwarz gegen den Alleinspieler nicht zählen | Wert 36 statt 48 | 48 → schlägt fehl |
| B3: Überreiz-Prüfung im Null-Zweig entfernt | Null bei Gebot 24 „gewonnen" | verloren → schlägt fehl |
| B4: Ansagestufen weglassen (`+3` statt `+5`) | Grand Ouvert 216 statt 264 | 264 → schlägt fehl |

### Nachweis am laufenden Spiel

`tests/selbstspiel.html?runden=30&seed=7`: **30 Runden ohne Beanstandung** —
keine Ausnahme, keine `console.error`, jede Runde mit Punktveränderung. Die
Verteilung zeigt, dass wirklich alle Zweige liefen: 8× Eichel-Spiel (Hand),
5× Schellen (Hand), 3× Grün (Hand), 2× Herz (Hand), 3× Eichel, 2× Schellen,
1× Grün, 1× Grand, 1× Grand (Hand), 1× Null Ouvert, 3× Ramsch. Spielverlauf bei
188 Zeilen (Grenze 200 aus Befund E), Menü meldet `v11`. Ohne den
`GRUNDWERT`-Fehler wäre dieser Lauf in der ersten gewerteten Runde gescheitert.

Zusätzlich von Hand: „Neues Match" im Menü — neu gegeben, 10/10/10 Karten,
keine Konsolenmeldung.
