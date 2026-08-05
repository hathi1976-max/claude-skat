# Code-Review: claude-skat

Stand: 04.08.2026 · Umfang: `app.js` 1.226 Zeilen, `style.css`, PWA-Shell

Die Skat-Logik ist beeindruckend vollständig: Reizleiter, Matadore, Hand-/Ouvert-
Spiele, Ramsch mit Jungfrau-Multiplikator, Null-Reihenfolge, Kartenzählen mit
Renonce-Erkennung, drei Spielstärken, drei Reiz-Stile. Die KI-Heuristiken sind
gut kommentiert und plausibel aufgebaut.

Die Probleme liegen in zwei Bereichen: **Regelabweichungen**, die dem Spieler
Vorteile oder Nachteile verschaffen, und ein **Steuerungsfehler im async-Ablauf**,
der den Spielzustand zerstören kann.

---

## A. Kritisch

### A1. Vorhand wird nie gefragt, ob sie spielen will — ✅ erledigt 05.08.2026

> **Behoben.** `reizen()` fragt die Vorhand jetzt, bevor der Ramsch fällt: der
> Mensch über zwei Knöpfe („Ja, ich spiele (18)" / „Nein – Ramsch"), die KI über
> `aiMax[VH] >= 18`, sichtbar per `aiSay` mit „18" bzw. „Ramsch". Erst wenn auch
> die Vorhand ablehnt, greift der Ramsch-Zweig. **Häufigkeit nachgemessen**
> (5.000 zufällige Blätter je Reiz-Stil, Nachbau der Reizlogik in Python):
>
> | Reiz-Stil | MH+HH passen | davon: VH hätte gespielt | betroffene Runden |
> |---|---|---|---|
> | vorsichtig | 27,6 % | 59,6 % | **16,5 %** |
> | normal | 12,1 % | 86,1 % | **10,4 %** |
> | mutig | 0,7 % | 100 % | 0,7 % |
>
> Bei der Voreinstellung *normal* ging also jede zehnte Runde zu Unrecht in den
> Ramsch. Tests: `tests/ablauf.test.js › Vorhand-Frage (A1)`.

**Wo:** `reizen()` (`app.js:495-529`), `duel()` (`:532-555`)

Nach den beiden Reiz-Duellen gilt: `reiz === 0` → Ramsch. Wenn Mittelhand und
Hinterhand sofort passen, hat Vorhand nie ein Gebot abgegeben — `lastCalled`
bleibt 0 — und wird **sofort in den Ramsch geschickt**. Nach den Regeln darf
Vorhand in dieser Lage aber ansagen, dass sie bei 18 spielt.

Das trifft den Spieler überproportional oft: `state.dealer` startet bei 2, also
ist Spieler 0 ("Du") in der ersten Runde Vorhand, und danach in jeder dritten.
Ein gutes Blatt, das beide Gegner nicht überreizen, führt so zwangsweise zum
Ramsch statt zum eigenen Spiel.

**Anweisung:** In `reizen()` vor der Ramsch-Verzweigung ergänzen:

```js
if (reiz === 0) {
  const vh = vorhand();
  const willSpielen = state.players[vh].isHuman
    ? await askAction([{label:'Ja, ich spiele (18)', value:'yes', cls:'primary'},
                       {label:'Nein – Ramsch',       value:'no',  cls:'danger'}]) === 'yes'
    : aiMax[vh] >= 18;
  if (willSpielen) { declarer = vh; reiz = 18; }
}
```
Bei der KI-Variante zusätzlich über `aiSay` sichtbar machen, damit der Ablauf
nachvollziehbar bleibt. Anschließend fällt der Ramsch-Zweig nur noch, wenn auch
Vorhand ablehnt.

### A2. Kein Generationszähler — alter Spielablauf läuft nach Neustart weiter — ✅ erledigt 04.08.2026

> **Behoben.** `gen`, `abortRun()` und `wait()` eingeführt: wartende Timer,
> `askAction` und `humanPlay` werden beim Neustart mit `ABORT` abgewiesen, die
> alte Kette bricht ab (Variante „Exception" aus der Anweisung, dadurch keine
> vergessenen Prüfungen nach einzelnen `await`s). `nextRound()` ruft sich nicht
> mehr selbst auf, stattdessen Schleife in `runLoop()`. Der Neustart-Knopf fragt
> nach. Nachgemessen im Browser: alter Stand erzeugt beim Neustart während einer
> Pause zwei parallele Ketten (Log-Eintrag „Spiel 1 – Geber" doppelt), neuer
> Stand genau eine.

**Wo:** `nextRound()` (`:445-474`), Neustart-Knopf in `renderMenu` (`:1210-1212`)

Der gesamte Rundenablauf ist eine einzige, lange `async`-Kette mit `await sleep()`
und `await askAction()`. Drückt der Spieler mitten in einer Runde
"Neues Match (Punkte 0)", ruft `startGame()` ein frisches `newState()` auf — die
**alte Kette läuft aber weiter**. Steckt sie gerade in `await sleep(900)`
(`playTricks:811`), setzt sie danach ihre Arbeit auf dem **neuen** globalen
`state` fort: sie spielt Karten aus fremden Händen aus, wertet Stiche für die
neue Runde aus und ruft am Ende ein zweites `nextRound()` auf. Ab dann laufen
zwei Ketten parallel gegen denselben Zustand.

Reversi im Nachbarprojekt löst das bereits vorbildlich mit `state.session`
(`claude-reversi/app.js:218, 383, 389`) — dasselbe Muster hier nachziehen.

**Anweisung:**
1. `newState()` um `session: (state?.session ?? 0) + 1` ergänzen — oder besser
   einen modul-globalen Zähler `let gen = 0;` außerhalb von `state` führen, da
   `state` komplett ersetzt wird.
2. Eine Hilfsfunktion einführen und **nach jedem `await`** prüfen:
   ```js
   const sleep = ms => new Promise(r => setTimeout(r, ms));
   async function step(g, ms) { await sleep(ms); if (g !== gen) throw ABORT; }
   ```
   Alternativ, weniger invasiv: in `nextRound`, `reizen`, `declarerPhase`,
   `playTricks` und den Wertungsfunktionen jeweils zu Beginn `const g = gen;`
   merken und nach jedem `await` `if (g !== gen) return;`.
3. `askAction` und `humanPlay` beim Generationswechsel aktiv auflösen (oder ihre
   Resolver verwerfen), damit keine hängenden Promises zurückbleiben.
4. Zusätzlich: den Neustart-Knopf hinter eine Rückfrage legen ("Laufendes Spiel
   verwerfen?").

### A3. `splice(-1)` bei nicht gefundener Karte — ✅ erledigt 04.08.2026

> **Behoben.** Guard eingebaut. Diagnose nachgemessen: `splice(-1, 1)` entfernt
> tatsächlich die letzte Handkarte. Gegenprobe mit einer KI, die absichtlich eine
> Fremdkarte liefert: Hand bleibt jetzt unverändert, `console.error` meldet.

**Wo:** `playTricks()` (`:797`)

```js
h.splice(h.findIndex(c => cardId(c) === cardId(card)), 1);
```

Liefert `findIndex` −1, entfernt `splice(-1, 1)` **die letzte Karte der Hand** —
eine stille Zustandskorruption statt eines erkennbaren Fehlers. Genau dieser Pfad
wird durch A2 erreichbar.

**Anweisung:**
```js
const k = h.findIndex(c => cardId(c) === cardId(card));
if (k < 0) { console.error('Karte nicht in der Hand', card, h); return; }
h.splice(k, 1);
```

---

## B. Regelabweichungen

### B1. Ouvert des Spielers legt die Karten nicht offen — ✅ erledigt 05.08.2026

> **Behoben.** `humanDeclare()` setzt nach der Spielansage `state.revealed = [0]`,
> wenn Ouvert gewählt wurde — genau wie `aiDeclare` es beim Grand Ouvert längst
> tat. `renderSeatInfo` hängt an den Sitz des Alleinspielers ein „· offen", damit
> der Zustand sichtbar ist. Damit ist der Vorteil weg: bisher bekam der Mensch
> beim Null Ouvert den Spielwert 46 statt 23 (und beim Grand Ouvert den Faktor
> Ouvert), ohne die Karten herzuzeigen. Die KI nutzt die Information jetzt
> tatsächlich, siehe C2.

**Wo:** `humanChooseGame` (`:741-775`) setzt `ouvert: true`, aber
`state.revealed` wird nur in `aiDeclare` (`:654`) befüllt.

Spielt der Mensch Null Ouvert oder Grand Ouvert, bleiben seine Karten für die
Gegner verdeckt. Da Ouvert bereits den erhöhten Spielwert bringt, ist das ein
einseitiger Vorteil.

**Anweisung:** In `humanDeclare()` nach der Spielwahl ergänzen:
```js
if (g.ouvert) state.revealed = [0];
```
Und in `renderMyHand`/`renderOpps` sicherstellen, dass ein Hinweis erscheint
("Deine Karten liegen offen"). Ob die KI die Information tatsächlich nutzt, ist
eine zweite Frage — siehe C2.

### B2. Schneider gegen den Alleinspieler wird nicht gewertet — ✅ erledigt 05.08.2026

> **Behoben.** Die Wertung steckt jetzt in der reinen Funktion `bewerteSpiel()`
> (kein DOM, kein `state`), die Schneider und Schwarz **in beide Richtungen**
> zählt: `augen >= 90` bzw. alle Stiche für den Alleinspieler, `augen <= 30`
> bzw. kein Stich gegen ihn. `recordDeclarerStat` bekommt nur noch die selbst
> erzielten Stufen, die Statistik meldet also kein „Schneider" mehr, wenn der
> Alleinspieler schneider **wurde**; der Ergebnistext unterscheidet beides.
> **Gegenprobe** (Eichel-Spiel, mit 2, Skat aufgenommen):
>
> | Fall | vorher | nachher |
> |---|---|---|
> | verloren mit 25 Augen | Stufe 3 → −72 | Stufe 4 → **−96** |
> | verloren ohne Stich | Stufe 3 → −72 | Stufe 5 → **−120** |
>
> Tests: `tests/wertung.test.js › Schneider und Schwarz`.

**Wo:** `scoreRound()` (`:854-856`)

```js
schneider = declAugen >= 90;
schwarz   = declTricks === 10;
```

Beides wird nur aus Sicht des Alleinspielers geprüft. Verliert er mit ≤ 30 Augen,
haben die Gegner ihn schneider gespielt — der Spielwert (und damit sein Verlust)
müsste um eine Stufe steigen. Aktuell fällt der Verlust zu niedrig aus.

**Anweisung:**
```js
const schneiderFuer  = declAugen >= 90;   // Alleinspieler macht Schneider
const schneiderGegen = declAugen <= 30;   // Alleinspieler wird schneider
const schwarzGegen   = declTricks === 0;
let factor = mat + 1 + (g.hand ? 1 : 0);
if (schneiderFuer || schneiderGegen) factor += 1;
if (schwarz || schwarzGegen) factor += 1;
```
`recordDeclarerStat` entsprechend anpassen, damit die Statistik nicht "Schneider"
meldet, wenn der Alleinspieler schneider **wurde**. Im Ergebnistext
(`detail`, `:870-874`) sauber unterscheiden.

### B3. Überreizen bei Null nicht geprüft — ✅ erledigt 05.08.2026

> **Behoben.** Der Null-Zweig in `bewerteSpiel()` prüft `wert < reizwert`; ist
> das der Fall, ist das Spiel verloren, auch ohne einen einzigen Stich. Der
> Verlustwert bleibt bei Null der Spielwert selbst (23/35/46/59), verdoppelt.
> **Gegenprobe:** Null angesagt nach Reizen bis 24 — vorher **+23** (Sieg),
> jetzt **−46**; eine Differenz von 69 Punkten pro Fall.
> Tests: `tests/wertung.test.js › Null`.

**Wo:** `scoreRound()` (`:847-851`)

Der Null-Zweig kennt keine Überreiz-Prüfung. Wer bis 24 reizt und dann Null (23)
ansagt, hat überreizt und verloren — die App wertet es als Sieg.

**Anweisung:** Im Null-Zweig ergänzen:
```js
const overbid = value < state.reizwert;
won = (declTricks === 0) && !overbid;
```
Der Verlustwert bleibt bei Null der Spielwert selbst (23/35/46/59), verdoppelt.
Im `detail`-Text den Überreiz kenntlich machen, wie im Farbspiel-Zweig.

### B4. Grand Ouvert: Faktor zu niedrig — ✅ erledigt 05.08.2026

> **Behoben, und zwar korrekt gerechnet statt als Hausregel erklärt.** Grand
> Ouvert ist zwingend Handspiel und schließt Schneider und Schwarz **angesagt**
> ein; der Faktor steht damit fest bei `Spitzen + 7` (mit/ohne + Spiel + Hand +
> Schneider + Schneider angesagt + Schwarz + Schwarz angesagt + Ouvert).
> **Gegenprobe:** Grand Ouvert „mit 4" — vorher 24 × 9 = **216**, jetzt
> 24 × 11 = **264**.
>
> **Entscheidung bei einer mehrdeutigen Stelle:** Die angesagten Stufen zählen
> auch im **verlorenen** Spiel mit, der Faktor bleibt also bei `Spitzen + 7`,
> obwohl Schneider und Schwarz dann tatsächlich nicht erreicht wurden. Sonst
> wäre ein verlorenes Grand Ouvert billiger als ein verlorener schlichter Grand
> Hand mit gleichen Spitzen — und die Ansage bliebe folgenlos. Ein verlorenes
> Grand Ouvert „mit 4" kostet damit −528.
> Tests: `tests/wertung.test.js › Grand Ouvert`.

**Wo:** `scoreRound()` (`:856-861`)

Beim Grand Ouvert sind Schneider und Schwarz zwangsläufig **angesagt**. Der
Standardfaktor ist `mit/ohne + 1 + Hand + Schneider + Schneider angesagt +
Schwarz + Schwarz angesagt + Ouvert` = `mat + 7`. Die App kommt auf `mat + 5`,
weil die beiden Ansagestufen fehlen.

**Anweisung:** Entweder korrekt rechnen (`if (g.ouvert) factor += 3;` statt `+1`,
sofern Schneider und Schwarz bereits gezählt sind) oder — falls die Vereinfachung
gewollt ist — sie in der Ergebnisanzeige und im README ausdrücklich als
Hausregel benennen. Beides ist vertretbar, der aktuelle Zustand (stillschweigend
falsch) nicht.

### B5. `cardInfo` kennt den Ramsch-Typ nicht — ✅ erledigt 05.08.2026

> **Behoben.** `cardInfo` behandelt `grand` und `ramsch` jetzt in einem eigenen,
> ausdrücklichen Zweig (nur die vier Unter sind Trumpf); das Farbspiel steht
> darunter für sich. Verhalten unverändert — das war der Punkt: bisher ergab es
> sich nur zufällig daraus, dass `game.trump === null` den Farbvergleich
> scheitern ließ. Tests: `tests/regeln.test.js › Ramsch wird wie Grand gespielt`.

**Wo:** `cardInfo` (`:110-116`)

Für `game.type === 'ramsch'` greift keiner der expliziten Zweige; dass Ramsch
korrekt wie Grand gespielt wird (nur Unter sind Trumpf), ergibt sich zufällig
daraus, dass `game.trump === null` den Farbvergleich scheitern lässt.

**Anweisung:** Explizit machen:
```js
if (game.type === 'grand' || game.type === 'ramsch') {
  return c.r === 'U' ? {trump:true, suit:'T', str:200+UNTER_BONUS[c.s]}
                     : {trump:false, suit:c.s, str:FARBSTR[c.r]};
}
```
Kostet nichts und verhindert, dass eine spätere Änderung am Farbspiel-Zweig den
Ramsch stillschweigend kaputt macht.

---

## C. KI und Spielgefühl

### C1. `isMit` ignoriert das übergebene Spiel — ✅ erledigt 05.08.2026

> **Behoben.** Parameter entfernt (`isMit(cards)`) und im Kommentar begründet:
> „mit" oder „ohne" hängt bei Farbspiel wie bei Grand allein am Eichel-Unter,
> Null-Spiele haben keine Spitzen. Beide Aufrufstellen angepasst.

**Wo:** `:937-940`

```js
function isMit(cards, game) {
  const ids = new Set(cards.map(cardId));
  return ids.has('EU');
}
```

Für Farbspiel und Grand ist "mit" tatsächlich am Eichel-Unter festzumachen — das
Ergebnis stimmt also. Der ungenutzte Parameter suggeriert aber eine Prüfung, die
nicht stattfindet.

**Anweisung:** Parameter entfernen oder einen Kommentar setzen, warum er nicht
gebraucht wird.

### C2. Ouvert-Karten fließen nicht ins Kartenzählen der KI — ✅ erledigt 05.08.2026

> **Behoben — aber anders als in der Anweisung vorgeschlagen.** Die offenen
> Karten **aus `unseen` zu entfernen** wäre falsch gewesen: `unseen` ist die
> Gefahrenmenge, aus der `isMaster`/`higherUnseen` ablesen, ob eine Karte noch
> geschlagen werden kann. Läge der Eichel-Unter offen beim Alleinspieler und
> würde aus `unseen` gestrichen, hielte die KI ihren Grün-Unter für die höchste
> lebende Karte — die Ouvert-Information hätte sie schlechter spielen lassen.
>
> Stattdessen bleibt `unseen` unverändert und es kommt Wissen **hinzu**:
> `kannSchlagen(gegner, karte, farbe)` liest die offene Hand direkt aus und
> beantwortet unter Bedienzwang exakt, ob ein bestimmter Gegner schlagen kann;
> `exaktSicher(...)` liefert `null`, sobald auch nur eine beteiligte Hand
> verdeckt ist, und dann greift wie bisher die Heuristik. Genutzt in `safeCash`
> (Ass gefahrlos anspielen), `safeWin` (hält mein Stich?) und beim Schmieren auf
> den Partner. Bei verdeckten Händen ist das Verhalten damit **unverändert**;
> nur in Ouvert-Runden ändert sich etwas.
>
> Zusätzlich für **Null Ouvert**, wo die Information am meisten wert ist:
> `nullPlay` sucht als Verteidiger beim Ausspiel eine Farbe, in der der
> Alleinspieler bedienen muss und ausschließlich höhere Karten hält — und spielt
> davon die höchste, damit der Partner nicht versehentlich überspielt. Vorher
> spielte die Verteidigung gegen ein offenes Null blind die niedrigste Karte.

**Wo:** `aiPlay` (`:249-254`) baut `unseen` aus `tracker.played`, eigener Hand
und (beim Alleinspieler) dem Skat.

Liegt eine Hand per Ouvert offen, müsste sie für alle aus `unseen` verschwinden.
Aktuell spielt die KI gegen einen Ouvert-Spieler so, als wüsste sie nichts.

**Anweisung:** `state.revealed` in die `unseen`-Berechnung einbeziehen:
```js
const offenIds = new Set(
  state.revealed.filter(r => r !== p).flatMap(r => state.players[r].hand.map(cardId))
);
```
und diese IDs zusätzlich ausfiltern. Hängt an B1 — beides zusammen umsetzen.

### C3. `humanDiscard` rekursiert über Promises — ✅ erledigt 04.08.2026

> **Behoben.** Als `async`-Schleife neu geschrieben (zusammen mit A2, weil die
> Promise-Kette sonst auch den Abbruch überlebt hätte).

**Wo:** `:717-739`

Bestätigt der Spieler mit ≠ 2 gewählten Karten, ruft die Funktion sich selbst auf
und verkettet ein weiteres Promise. Bei hartnäckigem Fehlklicken wächst die Kette
unbegrenzt, und es bleibt ungenutzter `render()`-Zustand liegen.

**Anweisung:** In eine Schleife umbauen:
```js
async function humanDiscard() {
  const chosen = [];
  render();
  while (true) {
    await askAction([{label:'Drücken bestätigen', value:'ok', cls:'primary'}]);
    if (chosen.length === 2) return chosen;
    prompt('Bitte genau <b>2 Karten</b> wählen.');
  }
}
```
Sauberer wäre, den Bestätigungsknopf zu deaktivieren, solange `chosen.length !== 2`.

### C4. Tote Variable — ✅ erledigt 04.08.2026

> **Behoben.** `rel` entfernt, ebenso die nie benutzte Variable `uiResolver`.

**Wo:** `renderTrick()` (`:1067`) — `const rel = (t.p - state.leader + 3) % 3;`
wird berechnet und nie benutzt. Entfernen.

---

## D. Struktur

### D1. `app.js` mit 1.226 Zeilen ohne Modulgrenzen

Regelwerk, KI, Ablaufsteuerung, Rendering und Menü liegen in einer Datei, alles
im globalen Namensraum.

**Anweisung:** In ES-Module aufteilen (`<script type="module">` in `index.html`):

| Datei | Inhalt |
|---|---|
| `rules.js` | `SUITS`…`LADDER`, `cardInfo`, `legalMoves`, `trickWinner`, `countMatadors`, `sortHand` |
| `ai.js` | `evalSuit`/`evalGrand`/`bestGame`/`reizMax`, `aiDiscard`, `aiPlay`, `simplePlay`, `ramschPlay`, `nullPlay`, `tracker` |
| `scoring.js` | `scoreRound`, `scoreRamsch`, `isMit`, Statistik |
| `ui.js` | Rendering, `cardEl`, `attachDragReorder`, `askAction`, Menü |
| `game.js` | Ablauf: `nextRound`, `reizen`, `declarerPhase`, `playTricks` |

Vorher A2 erledigen — der Generationszähler wird sonst über fünf Dateien verteilt
nachträglich eingezogen.

### D2. Keine Tests, obwohl der Kern perfekt testbar ist

`cardInfo`, `legalMoves`, `trickWinner`, `countMatadors`, `scoreRound` sind reine
Funktionen über einfachen Datenstrukturen.

**Anweisung:** Nach D1 ein minimales Test-Setup (Vitest oder ein handgeschriebener
Runner in `tests.html` — kein Build-Schritt nötig). Mindestabdeckung:
- `trickWinner`: Trumpf sticht Farbe, Unter sticht Trumpffarbe, Eichel-Unter ist
  höchster, Abwerfen gewinnt nie
- `countMatadors`: "mit 4", "ohne 2", Grand mit allen vier Untern
- `legalMoves`: Bedienzwang, Trumpf-Bedienzwang bei Unter
- `scoreRound`: alle Fälle aus B2/B3/B4 als Regressionstests

### D3. Versionsnummer doppelt gepflegt — ✅ erledigt 05.08.2026

> **Behoben.** Neue Datei `version.js` mit einer einzigen Zeile
> (`self.APP_VERSION = 'v10';`) ist jetzt die einzige Stelle. `sw.js` lädt sie
> per `importScripts('./version.js')` und bildet daraus
> `CACHE = 'skat-' + self.APP_VERSION`; `index.html` bindet sie vor `app.js`
> ein, und das Menü zeigt die Version unten an. `self.` statt `const`, weil der
> Wert im Fenster **und** im Service Worker sichtbar sein muss — eine `const` auf
> oberster Ebene eines klassischen Skripts hängt an keinem der beiden globalen
> Objekte (dieselbe Falle wie bei `window.SkatTest`).
>
> **Nebeneffekt, der hier gerade recht kommt:** Chrome vergleicht bei der
> Update-Prüfung des Service Workers auch importierte Skripte. Eine Änderung an
> `version.js` löst die Neuinstallation also aus, obwohl `sw.js` selbst
> unverändert bleibt. Version für diese Sitzung von `v9` auf **`v10`** gezogen,
> README-Absatz ergänzt. Das Node-Skript aus `package.json` (Alternative in der
> Anweisung) scheidet aus: kein Node auf dem Rechner, und die App soll ohne
> Build-Schritt auslieferbar bleiben.

`sw.js:1` (`skat-v9`) und die Anzeige in `index.html`. Bei jedem Release müssen
beide angefasst werden; wird eins vergessen, serviert der Service Worker alten
Code (bekannte Falle aus den bisherigen Sitzungen).

**Anweisung:** Eine Konstante `APP_VERSION` in `app.js`, die in die Fußzeile
geschrieben wird, plus einen kurzen Absatz in `README.md`: "Vor jedem Push
`CACHE` in `sw.js` **und** `APP_VERSION` erhöhen." Alternativ ein winziges
Node-Skript, das beide aus `package.json` generiert.

---

## E. Kleinigkeiten

- `deal()` (`:483`) benutzt `Math.random`. Für ein Kartenspiel völlig in Ordnung;
  falls später Statistik-Auswertungen ernst genommen werden sollen, ist
  `crypto.getRandomValues` die bessere Quelle. Niedrige Priorität.
  ⏭️ **bewusst nicht umgesetzt 05.08.2026** — `Math.random` bleibt, und zwar aus
  einem konkreten Grund: der Selbstspiel-Prüfstand (`tests/selbstspiel.html`)
  ersetzt `Math.random` im iframe durch einen gesäten Generator und kann so
  jeden Lauf exakt wiederholen. Mit `crypto.getRandomValues` wäre das Geben
  nicht mehr reproduzierbar, und dem Kartenspiel selbst bringt die bessere
  Quelle nichts. Falls doch einmal Statistik über echte Partien geführt wird:
  hier wieder aufmachen.
- `state.logs` (`:496` u. a.) wächst über die gesamte Match-Dauer unbegrenzt;
  angezeigt werden nur die letzten 30 (`:1199`). Auf die letzten 200 kappen.
  ✅ **erledigt 05.08.2026** — alle 13 `state.logs.push(...)` gehen jetzt durch
  `logge(text)`, das auf `LOG_MAX = 200` kappt.
- `bubble()`/`prompt()` (`:1101-1102`) schreiben per `innerHTML`. Alle Inhalte
  sind heute projekteigene Konstanten, also ungefährlich — aber sobald ein frei
  wählbarer Spielername dazukommt, wird das zur Lücke. Beim Einbau von Namen
  daran denken.
  ⏭️ **bewusst offen** — es gibt weiterhin keine frei wählbaren Namen; `P_NAMES`
  ist eine Konstante. Der Hinweis bleibt als Merkposten für den Tag, an dem
  Namen eingebaut werden.
- `attachDragReorder` (`:994`) registriert vier Pointer-Listener pro Karte bei
  jedem `renderMyHand`. Da die Elemente jedes Mal neu erzeugt werden, entsteht
  kein Leck — bei 10 Karten × häufigem Rendern trotzdem unnötige Arbeit. Optional
  auf einen delegierten Listener am `#myhand`-Container umstellen.
  ⏭️ **bewusst offen** — reine Mikro-Optimierung ohne messbaren Nutzen (10 Karten),
  aber mit echtem Risiko: Ziehen und Tippen hängen an `setPointerCapture` je
  Element, ein delegierter Listener müsste die Zuordnung selbst führen. Das
  gehört im Browser mit Maus **und** Finger nachgeprüft; in dieser Sitzung waren
  die Browser-Werkzeuge nicht verfügbar.
- `prompt` als Funktionsname überschattet das globale `window.prompt`. Funktioniert,
  ist aber verwirrend — in `zeigeHinweis` umbenennen.
  ✅ **erledigt 04.08.2026** — durchgängig in `zeigeHinweis` umbenannt.

---

## Reihenfolge der Umsetzung

1. **A2** (Generationszähler) + **A3** — verhindert Zustandskorruption
2. **A1** (Vorhand darf spielen) — die spürbarste Regellücke
3. **B2/B3/B4** (Wertung) mit Tests aus D2 abgesichert
4. **B1 + C2** (Ouvert vollständig)
5. **D3** (Versions-Disziplin)
6. **D1/D2** (Aufteilung + Tests)
7. Rest nach Gelegenheit
