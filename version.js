/* Einzige Stelle für die Versionsnummer.
   Wird sowohl von der Seite (index.html, Anzeige im Menü) als auch vom Service
   Worker geladen (importScripts in sw.js), der daraus seinen Cache-Namen bildet.
   Deshalb `self` statt `const`: nur so ist der Wert in beiden Welten sichtbar.

   Vor jedem Push hier hochzählen – sonst serviert der Service Worker alten Code.
   Chrome vergleicht bei der Update-Prüfung auch importierte Skripte, eine
   Änderung an dieser Datei löst die Neuinstallation des Service Workers aus. */
self.APP_VERSION = 'v11';
