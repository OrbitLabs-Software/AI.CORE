# Änderungen

## 5.1.0 — Token-Guthaben

- **Nutzung in Token statt Monatszähler:** Wort im Chat 0,25 · Wort in Datei 0,5 · analysiertes Wort 0,75 · Bild 45,9 · Sekunde Video 15,9 · Sekunde Musik 10 (Preis hinterlegt, noch keine Musikfunktion).
- **Gratis:** 4 000 Token, Zurücksetzen alle 4 Stunden. **Pro:** 10 000 Token, Zurücksetzen alle 2 Stunden, 16,99 € pro Monat per Stripe.
- Token-Anzeige in der oberen Leiste, Pro-Seite mit Guthaben, Tarifvergleich und Preisliste.
- Fehlgeschlagene Bilder und Videos geben ihre Token zurück; Antworten werden nach den erzeugten Wörtern abgebucht.
- Neu: `POST /api/tokens/analyze`; Upload meldet die abgebuchten Token. `FREE_*_PER_MONTH` und `PRO_*_PER_MONTH` entfallen, die Gesamt-Notbremse `*_MAX_PER_MONTH_TOTAL` bleibt.

## 5.0.0 — Aurora

**Neues Design:** tiefes Tintenblau (dunkel) und helles Papier (hell), Verlauf nur bei Marke, Senden und aktivem Chat, Glas-Seitenleiste, schwebende Eingabe, Kacheln mit Tiefe, Schrift ohne Serifen. Neu gestaltete Anmeldung.

**Neue Funktionen**
- **Bibliothek:** Dokumente einmal hochladen (Einstellungen → Bibliothek), im Werkzeug-Menü einschalten; passende Abschnitte (BM25-Suche, ohne Modell) gehen mit Quellenangabe [B1] in die Antwort. Liegt pro Konto auf dem Server (`data/library`, `LIBRARY=false` schaltet ab).
- **Links lesen:** Ein Link in der Nachricht wird gelesen (Heimnetz-Adressen bleiben gesperrt) und als [L1] zitiert.
- **Mermaid-Diagramme** haben eine Vorschau.
- **Modelle verwalten** (Besitzer): Ollama-Modelle mit Fortschritt laden, abbrechen, löschen; freier Speicherplatz.
- **Server-Meldungen** (Besitzer): letzte Meldungen, Schlüssel unkenntlich gemacht.
- **Titel und Folgefragen von der KI** (optional), **ganzer Chat als Word** (`/wordchat`), **geteilte Chats verwalten** (Einstellungen → Daten).
- Server wird automatisch gefunden (Heimnetz und Tailscale).

**Behoben:** Abgleich verlor gelegentlich zwei Änderungen in derselben Millisekunde.

## 4.1.0 — Anmeldung und Server-Suche

- **Anmeldung neu gestaltet:** E-Mail und Passwort stehen oben, Google/GitHub darunter („oder weiter mit“), Verbindungsanzeige „Verbunden mit …“, klarere Fehlermeldungen.
- **Server wird automatisch gefunden:** Die GitHub-Seite probiert `http://192.168.1.190:3000` (Heimnetz) und die Tailscale-Adresse (unterwegs) gleichzeitig und nimmt die, die antwortet. Im Fenster „Server wählen“ gibt es dafür „Automatisch suchen“.
- **Abgleich:** Zwei Änderungen in derselben Millisekunde gingen manchmal verloren (Zeitstempel sind jetzt streng aufsteigend).

## 4.0.0 — übersichtlicher und nützlicher

**Aufgeräumte Oberfläche**
- **Werkzeug-Menü** unter dem Eingabefeld: Rolle, Suche und Stil sind aus der oberen Leiste umgezogen. Abweichungen vom Normalfall zeigen Chips über dem Eingabefeld, ein Klick setzt sie zurück.
- **Obere Leiste** zeigt nur noch Titel, Modell und Vorschau. Export, Teilen und Design stehen im Menü „⋯“.
- **Neue Startseite** mit sechs Schnellstart-Kacheln (Recherchieren, Schreiben, Programmieren, Daten analysieren, Sprechen, Bild erzeugen), den Vorschlägen als Chips und „Weitermachen“ mit den letzten Chats und Projekten. Bei niedrigen Fenstern wird sie kompakter.
- **Einstellungen mit Seitenleiste** und vier Gruppen (Persönlich, KI, Konto und Daten, Übersicht) statt zehn Reitern.
- **Neu in 4.0:** einmal nach dem Update, danach mit `/neu`.

**Neue Funktionen**
- **Abgleich zwischen Geräten** (Einstellungen → Abgleich, ausdrücklich einzuschalten): Chats und Projekte zeigen auf Handy und Computer denselben Stand. Die neuere Änderung gewinnt, Bilder und Dateivorschauen bleiben auf dem Gerät, die Daten liegen auf deinem Server. Alle abgeglichenen Daten lassen sich vom Server löschen.
- **Papierkorb:** Löschen verschiebt Chats für 30 Tage in den Papierkorb (Einstellungen → Papierkorb). Zurückholen geht von dort, auch auf anderen Geräten.
- **Tabellen verstehen:** CSV- und TSV-Dateien bekommen eine Ansicht („Ansehen“) mit Spalten, Typen, Kennzahlen, Diagrammen und den ersten Zeilen. Große Tabellen gehen als kompakte Zusammenfassung ans Modell statt als tausende Zeilen. Deutsche und englische Zahlen, Datumsformate und fehlende Werte werden erkannt.
- Änderungen an einem Chat (Bewertung, Zweig, Zusammenfassung) werden automatisch als neuer Stand erkannt.

**Intern**
- Projekte werden beim Löschen als Marker behalten, damit der Abgleich sie überall entfernen kann.
- Eingangszeit auf dem Server statt Gerätezeit entscheidet, was ein Gerät noch abholen muss. Eine falsch gehende Uhr verliert dadurch keine Änderungen.

## 3.5.0 — professionell

**Neue Funktionen**
- **Gesprächszweige:** Bearbeitest du eine frühere Nachricht, bleibt der alte Verlauf als Zweig erhalten. Mit ‹ 1/2 › wechselst du zwischen den Zweigen. Vorher ging der alte Verlauf beim Bearbeiten verloren, auch wenn man abbrach.
- **OpenAI-kompatible Schnittstelle** (`/v1/chat/completions`, `/v1/models`): Andere Programme (VS Code mit Continue, Skripte, andere Chat-Oberflächen) können dein Modell nutzen. Eigene API-Schlüssel (`API_KEYS`), Mengenbegrenzung pro Schlüssel, Streaming, Bilder, Gedankengänge werden herausgefiltert.
- **Server-Übersicht** (nur Besitzer, Einstellungen → Server): Version, Laufzeit, Speicher, Last, Datenmengen, aktive Funktionen, Nutzung der letzten 14 Tage, Hinweis bei abgeschalteter Anmeldung. Dazu zählt der Server Chats, Tokens, Suchen, Bilder, Videos und API-Aufrufe pro Tag (nur Zahlen, keine Inhalte).
- **Nutzung** (Einstellungen → Nutzung): Chats, Fragen, Tokens, Geschwindigkeit, Fragen pro Tag und Modelle aus deinen Chats.
- **Befehlspalette** (Strg+/): Aktionen, Einstellungen und Chats per Tastatur.
- **Auswahl-Leiste:** Text in einer Antwort markieren, dann Erklären, Kürzer, Englisch oder Zitieren.
- **Als App installieren:** Manifest, Symbole und Offline-Hülle; `/installieren`. Offline-Hinweis oben, wenn die Verbindung fehlt.
- **Darstellung:** Design hell/dunkel/System, Textgröße, Dichte, Breite des Chats.
- **Komplette Sicherung:** Chats, Projekte und Einstellungen in einer Datei (Schlüssel bleiben draußen).
- **Rechtliches:** Links zu Impressum, Datenschutz und AGB (`LEGAL_*_URL`) im Anmeldefenster, bei Pro und unter „Über“.

**Behoben**
- `resolveModel` lief endlos im Kreis, wenn keine Modellquelle eingerichtet war.
- Das Tab-Menü der Einstellungen passt bei vielen Reitern besser.

## 3.4.2

Standard-Serveradresse der GitHub-Seite ist jetzt die Tunnel-Adresse `https://obitlabs.tailc8dd2c.ts.net`. Man muss sie auf den Geräten nicht mehr eintragen.

## 3.4.1

**Von überall erreichbar**
- Der Server erkennt jetzt die echte Adresse der Besucher hinter einem Tunnel auf demselben Rechner (`TRUST_PROXY=loopback` ist Standard). Ohne das hätten alle Besucher dieselbe Adresse und die Mengenbegrenzungen würden alle gemeinsam treffen.
- Öffnet man die Seite über die Tunnel-Adresse, spricht sie den Server unter derselben Adresse an. Nur GitHub Pages braucht eine eigene Server-Adresse.
- README: Anleitung für Tailscale Funnel (kostenlos, HTTPS, ohne Router-Einstellungen).

## 3.4.0

**Mehr KI-Funktionen**
- **Websuche mit Quellen:** Schalter „Suche“ oben im Chat (Aus / Websuche / Tiefe Recherche). Die Antwort nennt Quellen als [1], [2], darunter stehen die Links. Bei „Tiefer Recherche“ werden die ersten drei Seiten gelesen. Seiten aus dem Heimnetz werden nie geladen (Schutz vor Zugriffen auf eigene Geräte).
- **Wissenssuche in Projekten:** Große Projektdateien werden in Abschnitte geteilt, und nur die Abschnitte zur Frage gehen ans Modell. Kleine Projekte kommen weiter komplett mit.
- **Code ausführen:** JavaScript-Blöcke haben „▶ Ausführen“. Der Code läuft abgeschottet (kein Zugriff auf AI Core, kein Netz, 8 Sekunden Zeitlimit) und zeigt console.log und Fehler.
- **Sprachmodus** (`/sprache` oder Wellen-Symbol): sprechen, die KI antwortet laut, dann hört sie wieder zu. Beenden mit Esc.
- **Verlauf komprimieren** (`/komprimieren`): fasst den Anfang eines langen Chats zusammen, damit das kleine Modell nicht den Faden verliert.
- **Vorlagen** (`/vorlage`): 13 Aufgaben-Vorlagen mit Platzhaltern und eigene Vorlagen.
- Die obere Leiste läuft bei vielen Auswahlfeldern nicht mehr über.

## 3.3.0

**Videos über Hugging Face, Monats-Kontingente und AI Core Pro**
- `/video` läuft jetzt auch über Hugging Face (`HF_TOKEN`, Modell und Anbieter in der `.env` einstellbar). Das Video entsteht im Hintergrund und liegt danach auf dem Server.
- **Kontingente pro Konto und Monat:** gratis 1 Video und 10 Bilder, Pro 20 Videos und 200 Bilder (alles in der `.env` änderbar). Scheitert ein Auftrag, wird das Kontingent zurückgegeben. Eine Gesamt-Notbremse (`VIDEO_MAX_PER_MONTH_TOTAL`) schützt vor Überraschungen bei den Kosten.
- **AI Core Pro kaufen** (Einstellungen → Pro oder `/pro`): Stripe-Abo mit Rückkehr auf die Seite. Kein Webhook nötig, der Server fragt Stripe selbst; der Tiny muss nicht aus dem Internet erreichbar sein. Abo verwalten und kündigen über das Stripe-Portal.
- **Einlösecodes** (`PRO_CODES`) für Geschenke und Tests, jeder Code nur einmal.
- **Besitzer** (`OWNER_UIDS`) und Server ohne Anmeldung haben keine Grenzen.

## 3.2.0

**Dateien erstellen:** Die KI schreibt den Inhalt, ein Knopf macht daraus die fertige Datei. Alles läuft im Browser,
ohne Server-Bibliothek und ohne `npm install` — auch auf GitHub Pages.

- **Excel (.xlsx):** CSV (`;` `,` Tab), Markdown-Tabelle oder JSON. Zahlen, Prozent und Euro werden erkannt, Formeln auch mit
  deutschen Namen (`=SUMME(B2:B9)`), mehrere Blätter (`=== Blatt: Name ===`), Kopfzeile fixiert.
- **PowerPoint (.pptx):** `# Titel` = Titelfolie, `## Folie` + Stichpunkte; lange Folien werden geteilt, Schriftgröße passt sich an.
- **PDF:** Markdown mit Überschriften, Listen, Tabellen, Code, Zitaten; Umlaute und €, Seitenzahlen.
- **Word (.docx):** jetzt mit echten Tabellen, Kursiv, Zitaten und Trennlinien; der Denkprozess (`<think>`) bleibt draußen.
- **ZIP:** ein Block mit `=== ordner/datei.ext ===` vor jeder Datei wird zum Archiv (Pfade werden bereinigt).
- **PNG/JPG** aus SVG-Blöcken, **CSV mit Umlauten** für Excel, weitere Endungen (ics, vcf, toml …).
- **Datei-Menü** unter jeder Antwort: Word, PDF, PowerPoint, Excel (bei Tabellen), Markdown, Text.
- Befehl **/datei** und Rolle **Dateien** mit passenden Anweisungen für die Modelle.
- **Coder mit mehreren Dateien:** `index.html` + `style.css` + `app.js` in einer Antwort werden für die Vorschau gebündelt.

## 3.1.0

**GitHub-Pages-Betrieb:** Die Oberfläche kann auf GitHub liegen und den Server im Heimnetz ansprechen
(Server-Adresse einstellbar, CORS mit `ALLOWED_ORIGINS`, Anmeldung per Token statt Cookie, Vorschau ohne Server, Workflow für Pages).

**Claude-Look und neue Funktionen**
- Warmes Papier-Design mit Terrakotta-Akzent, Serifenschrift für Antworten, flach statt Verlauf; hell ist jetzt Standard, dunkel bleibt möglich.
- **Stile** (Normal, Prägnant, Erklärend, Formell, Locker) oben im Chat.
- **Eigene Anweisungen** in den Einstellungen, gelten in jedem Chat.
- **Diktieren** per Mikrofon-Knopf (Chrome, Edge, Safari).
- **Daumen hoch/runter** unter jeder Antwort.
- **Projekte** (Seitenleiste): eigene Anweisungen und Dateien, die in jedem Chat des Projekts gelten.
- **Antwort-Versionen**: „Neu“ behält die alte Antwort, mit ‹ 1/2 › blätterst du zwischen den Versionen. Bricht das Neu-Generieren ab, bleibt die alte Antwort.
- **Chats per Link teilen** (Teilen-Symbol oder `/teilen`): Nur-Lesen-Kopie auf dem Server; `/teilenaus` beendet das Teilen.
- **Word-Export** unter jeder Antwort.
- **`/bild`** und **`/video`**: über einen Anbieter (`IMAGE_API_KEY`, `VIDEO_API_KEY` in der .env), ohne Schlüssel erklärt die App, was fehlt.

**Anmeldung neu gestaltet und repariert**
- Die Knöpfe hatten keine Gestaltung (die Klasse fehlte im Stylesheet); jetzt einheitliches Design mit Google-/GitHub-Symbolen, Passwort-Anzeige, Ladeanzeige und Meldungen im Fenster.
- Enter schickt jetzt auch bei Handynummer und SMS-Code ab; Felder bleiben beim Laden bedienbar.
- Google, GitHub und SMS erscheinen nur auf Adressen, die Firebase zulässt (nicht auf Heimnetz-IPs).
- Die Bestätigungs-Mail wird nur noch beim Registrieren verschickt, nicht bei jeder Anmeldung.
- Ist der Server nicht erreichbar, erscheint ein Verbindungsfenster mit Adressfeld statt eines stillen Demo-Modus.

## 3.0.0

**Neues Design** im Stil der OrbitLabs-Webseite (Indigo, Cyan, Violett auf Nachtblau), hell und dunkel, ohne externe Schriften.
Seitenleiste nach Datum gruppiert, Begrüßung mit Namen, Chat ohne Blasen für die KI, Kopfzeile mit Modell, Rolle und Kontext-Ring,
Handy-Ansicht mit Menü, Vorschau-Panel rechts.

**Modelle**
- Cloud-Quelle (OpenAI-kompatibel) mit **DeepSeek V4.1 Flash** (`deepseek-flash`), auch als Denkmodus mit einklappbarem Denkprozess.
- Ollama und Cloud gleichzeitig; Modell-Menü nach Quellen gruppiert; Datenschutz-Hinweis vor dem ersten Cloud-Einsatz.
- Kontext-Anzeige, bei Cloud-Modellen größeres Budget.

**Coder-Modus** mit Live-Vorschau für HTML und SVG in einer Sandbox, Code-Hervorhebung, Dateinamen, Laden, ZIP für mehrere Dateien.

**Erinnerungen** pro Konto auf dem Server, „Merk dir …“, `/merken`, Vorschlag „Merken?“, Verwaltung in den Einstellungen.

**Weiteres:** Befehle mit `/`, Vorlesen, Chats anpinnen/umbenennen/gruppieren, Tastenkürzel `?`, Hilfe in den Einstellungen.

**Fehler behoben**
- Markdown: `*` in Inline-Code wurde kursiv; offene Code-Blöcke beim Streamen; verschachtelte Listen; Code-Block in Absatz.
- Fenster: der Esc-Handler blieb nach dem Schließen hängen.
- Befehlsmenü schloss sich nach einem Klick selbst (Fokus-Wettlauf), nur im echten Browser sichtbar.
- Modell-Menü zeigte im Demo-Modus dauerhaft „Server nicht erreichbar“.
- Kopfzeile lief bei offener Vorschau und auf dem Handy über; Kontext-Knopf war weiß.
- Vorschau gehörte nach einem Chatwechsel noch zum alten Chat.
- Mehrere gleichzeitige Datei-Uploads konnten den Tiny auslasten (jetzt begrenzt).

## 2.2.0

- Firebase-Projekt und Anmeldearten der OrbitLabs-Webseite sind voreingestellt: E-Mail/Passwort mit Reitern Anmelden/Registrieren
  (Name, mind. 8 Zeichen), Passwort vergessen, Google, GitHub und Handynummer per SMS (weitere: X, Apple, Yahoo, Facebook).
- Freigabe über Benutzer-ID (`ALLOWED_UIDS`, voreingestellt mit deiner Admin-ID), Handynummer und E-Mail. Gäste nie.
- reCAPTCHA wird nur freigegeben, wenn die Handy-Anmeldung aktiv ist.

## 2.1.0

- **Firebase-Login** wie auf der OrbitLabs-Webseite: E-Mail/Passwort (mit Konto erstellen, Passwort vergessen), Google, GitHub, Facebook, Apple.
  Der Server prüft die Tokens selbst, die Zugangsliste (`ALLOWED_EMAILS`) bestimmt, wer hinein darf, nur bestätigte E-Mail-Adressen zählen.
- Name und Anfangsbuchstabe der angemeldeten Person erscheinen in der Seitenleiste.
- Die Sitzung merkt sich die Identität; gefälschte Cookies werden abgelehnt.
- Googles Domains werden nur freigegeben, wenn Firebase aktiv ist.
- Behoben: Beim Zugangspasswort wurde das Feld erst nach dem Sperren gelesen und blieb leer.

## 2.0.0

**Sicherheit**
- Der Server lieferte bisher den ganzen Projektordner aus (Quellcode, package.json). Jetzt nur noch die Oberfläche.
- Optionaler Passwortschutz (`ACCESS_PASSWORD`) mit sicherem Cookie, Sperre nach zu vielen Fehlversuchen.
- Rate-Limit pro Person und Begrenzung gleichzeitiger Antworten (schützt den Tiny vor Überlastung).
- Schutz vor fremden Webseiten (Origin-Prüfung), Sicherheits-Header und Content-Security-Policy.
- Uploads werden nur im Arbeitsspeicher gelesen, nichts bleibt auf der Festplatte.

**Funktionen**
- Dateien als Kontext: PDF, DOCX, Text, Code, CSV/JSON. Der Inhalt wird wirklich an das Modell gegeben (bisher nicht).
- Bilder für Vision-Modelle (z. B. llava), automatisch verkleinert; andere Modelle bekommen einen Hinweis.
- Rollen (Programmierer, Übersetzer, Erklärer, Zusammenfasser, Autor) plus eigene Rollen, pro Chat wählbar.
- Stopp-Knopf (auch mit Esc), Nachricht bearbeiten, Antwort neu generieren (ersetzt jetzt die Antwort).
- Tempoanzeige pro Antwort (Tokens/s), DeepSeek-R1-Denkprozess einklappbar.
- Modell wird beim Start und beim Wechsel vorgeladen; Statuspunkt zeigt, ob es bereit ist.
- Modelle in den Einstellungen herunterladen, mit Fortschrittsbalken.
- Chats umbenennen (Doppelklick auf den Titel), als Markdown exportieren, alle sichern und wieder einlesen.
- Verlauf wird automatisch auf die Kontextgröße gekürzt, mit Hinweis.
- Markdown: Tabellen, Zitate, Trennlinien, `*`-Listen.
- Tastenkürzel: Esc, Strg+K, Strg+Shift+O.

**Behoben**
- Kopieren- und Neu-generieren-Knopf fehlten bei frisch gestreamten Antworten.
- Wechsel des Chats während einer Antwort schrieb den Text in den falschen Chat.
- Platzhalter „Projekte“ ohne Funktion entfernt, Beispielname „Anna Berger“ ersetzt.
