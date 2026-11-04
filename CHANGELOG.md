# Änderungen

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
