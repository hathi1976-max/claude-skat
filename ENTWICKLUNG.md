# Skat – Entwicklungsdokumentation

Stand: 05.08.2026. Reine Vanilla-Web-App ohne Framework, ohne Build-Schritt,
ohne Abhängigkeiten. Alle Dateien sind statisch auslieferbar.

## Projektstruktur

```
claude-skat/
├── index.html            Oberfläche: Sitze, Stich, Fußzeile mit Knöpfen, Menü
├── style.css             Layout, Kartenoptik, Animationen (responsiv)
├── app.js                Spielregeln, KI, Ablaufsteuerung und Anzeige
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
