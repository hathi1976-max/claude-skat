# Skat – Altenburger Blatt

Skat gegen zwei Computergegner als installierbare Web-App (PWA). Deutsches Bild
(Altenburger Blatt): **Eichel, Grün, Herz, Schellen** mit Daus (A), König, Ober,
Unter, 10, 9, 8, 7.

Repo: https://github.com/hathi1976-max/claude-skat

## Starten
Einfach `index.html` im Browser öffnen, oder lokal servieren:

```bash
py -m http.server 8199 --directory .
```

Dann `http://localhost:8199` aufrufen. Über „Zum Startbildschirm hinzufügen"
lässt sich die App installieren und offline nutzen.

## Version und Service Worker
Die Versionsnummer steht **nur** in `version.js`. Von dort holt sie sich sowohl
die Anzeige im Menü (☰, ganz unten) als auch der Service Worker für seinen
Cache-Namen. **Vor jedem Push in `version.js` hochzählen** – sonst liefert der
Service Worker installierten Apps weiter den alten Code. Ob die neue Fassung
wirklich läuft, verrät die Versionszeile im Menü.

## Was ist umgesetzt
- **Reizen** zwischen Vorhand / Mittelhand / Hinterhand mit klickbaren Geboten;
  KI-gegen-KI-Auktionen laufen sichtbar ab (jede Zahl und jedes Ja/Passe wird angezeigt).
- **Skat aufnehmen** und **2 Karten drücken**, oder **Handspiel**.
- **Spielarten:** Farbspiel (Eichel/Grün/Herz/Schellen), **Grand**, **Null / Null Ouvert**.
- **Handspiel** (ohne Skataufnahme, +1 Stufe) und **Grand Ouvert** – sowohl die KI
  als auch du selbst können beides ansagen. Grand Ouvert wählst du im „Hand spielen"-
  Dialog unter Grand; es erfordert alle Stiche. Die KI legt beim Grand Ouvert ihre
  Karten offen.
- Korrekte Trumpf-Ordnung: die vier Unter sind immer die höchsten Trümpfe
  (Eichel-, Grün-, Herz-, Schellen-Unter), dann Trumpffarbe A, 10, K, O, 9, 8, 7.
- **Wertung** mit Spitzen (mit/ohne), Grundwert, Hand, Schneider, Schwarz,
  Überreizt-Erkennung; Verlust zählt doppelt. Laufende Punktetabelle.
- Zwei starke KI-Gegner mit **Kartenzählen** und **Positionsspiel** (siehe unten).
- **Ramsch**: bieten alle drei nichts, gibt's automatisch eine Ramsch-Runde statt
  Zwangsspiel für Vorhand – jeder spielt für sich und will möglichst wenige Augen
  kassieren. Trumpf sind wie beim Grand nur die vier Unter. Der Skat geht an den
  Gewinner des letzten Stichs. Wertung (gängige Wirtshaus-Variante): der Spieler
  mit den meisten Augen verliert genau diese Augenzahl, verdoppelt für jeden
  Mitspieler, der komplett leer ausging ("Jungfrau"); wer alle 10 Stiche macht
  (Durchmarsch), verliert pauschal 120.
- **Turnierliste**: im Menü (☰) zeigt eine Tabelle jede Runde des aktuellen
  Matches mit Spielart und Punkten je Spieler, plus Gesamtsumme.
- **Statistik**: im Menü (☰) werden Alleinspieler-Bilanz, Schneider/Schwarz und
  Ramsch-Verluste je Spieler dauerhaft gespeichert (überlebt "Neues Match").

## KI-Stärke
Die Gegner spielen nicht nur nach Faustregeln, sondern führen ein Kartengedächtnis
und denken sitzabhängig:
- **Kartenzählen:** merken jede gespielte Karte und erkennen *Renonce* (wer eine
  Farbe nicht bedient) → wissen jederzeit, welche Karte die höchste noch lebende ist.
- **Meisterkarten & sicheres Kassieren:** ein Ass wird nur angespielt, wenn kein
  Gegner die Farbe leer hat (sonst droht Abstechen); Trümpfe werden gezogen, solange
  der Alleinspieler die Kontrolle hat.
- **Positionsspiel** („kurz vor, lang hinter dem Alleinspieler"): Verteidiger spielen
  je nach Sitzposition kurze oder lange Farben an.
- **Sitzabhängiges Stechen/Schmieren:** die KI weiß, wer im Stich noch *nach* ihr
  spielt – sie sticht das Ass des Alleinspielers gefahrlos ab, wenn nur der Partner
  folgt, und schmiert Punkte nur auf sichere Stiche.
- **Drücken:** rettet Augen (blanke Zehner) in den Skat und schafft Fehlfarben zum Stechen.

Wichtig: Die KI schummelt nicht – sie sieht nur, was tatsächlich gespielt wurde.

## Einstellungen (Menü ☰)
Zwei Regler steuern die Gegner (werden gespeichert):
- **Spielstärke:** *Leicht* (ohne Kartenzählen) · *Mittel* (Kartenzählen) ·
  *Schwer* (Kartenzählen + Positionsspiel).
- **Reiz-Stil:** *Vorsichtig* (nur sehr sichere Blätter) · *Normal* ·
  *Mutig* (reizt auch grenzwertige Blätter und eine Stufe höher).

## Kartenwerte (Augen)
Daus 11 · Zehn 10 · König 4 · Ober 3 · Unter 2 · 9/8/7 = 0 — zusammen 120 Augen.
Der Alleinspieler braucht **61** zum Sieg (90+ = Schneider, alle Stiche = Schwarz).

## Bedienung
Karten unten sind deine Hand; anklickbare (legale) Karten heben sich hervor.
Trümpfe sind mit goldenem Rand markiert. Über **☰** oben rechts gibt es den
Spielverlauf und „Neues Match". Die Handkarten lassen sich per Ziehen frei
selbst anordnen (Maus oder Finger) – ein normaler Tap spielt weiterhin die
Karte. Zu Rundenbeginn und nach dem Drücken wird die Hand einmal automatisch
sortiert, danach bleibt die eigene Anordnung für den Rest der Runde erhalten.
