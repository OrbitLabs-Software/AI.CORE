# AI Core 3.2

## Neu in 5.0

**Bibliothek, Links lesen, Mermaid-Diagramme, Modelle und Meldungen verwalten.** Die Einzelheiten stehen im `CHANGELOG.md`.

- **Bibliothek:** Einstellungen → Bibliothek, dann im Werkzeug-Menü unter dem Eingabefeld „Bibliothek“ einschalten. Mit `LIBRARY=false` in der `.env` ist sie aus. Das Modell sieht nie mehr, als in sein Kontextfenster passt; bei kleinen Modellen sind das wenige Absätze. Deshalb sucht AI Core nach Stichwörtern die besten Abschnitte heraus. Wer in der Frage andere Wörter benutzt als im Dokument, findet weniger. Die Dokumente können vom Betreiber des Servers gelesen werden.
- **Links lesen:** Einstellungen → Allgemein, ein Schalter. Der Server lädt die Seite, die Seite sieht also die Adresse deines Servers.
- **Modelle verwalten:** Nur für Besitzer (`OWNER_UIDS`, sonst `ALLOWED_UIDS`). Der Dienst muss mit Ollama laufen. Modellnamen und Größen ändern sich bei Ollama, die Vorschläge sind Richtwerte.
- **Server-Meldungen:** Der Server merkt sich die letzten 300 Meldungen im Speicher (nicht auf der Platte). Nach einem Neustart sind sie weg; `journalctl -u ai-core` zeigt die ganze Geschichte.

## Neu in 4.0

Aufgeräumter Chat (Werkzeug-Menü, Chips, ruhigere Leiste, neue Startseite), Einstellungen mit Seitenleiste, **Abgleich zwischen Geräten**, **Papierkorb** und **Tabellen-Ansicht** für CSV. Die Einzelheiten stehen im `CHANGELOG.md`.

**Abgleich zwischen Geräten:** Jede Person schaltet ihn selbst unter Einstellungen → Abgleich ein. Auf dem Server liegt dann pro Konto eine Datei in `data/sync`. Der Betreiber des Servers kann diese Chats lesen, das steht auch beim Einschalten. Mit `SYNC=false` in der `.env` ist der Abgleich ganz aus. Grenzen: 2000 Chats, 200 Projekte, 40 MB pro Konto, 1,5 MB pro Chat. Zu große Chats werden nicht abgeglichen und im Status gemeldet. Es gilt die neuere Änderung; gehen zwei Geräte-Uhren stark auseinander, kann bei gleichzeitigem Bearbeiten derselben Chats die falsche Fassung gewinnen.

**Papierkorb:** 30 Tage. Mit eingeschaltetem Abgleich bleibt der Löschmarker 45 Tage auf dem Server, damit auch Geräte, die lange aus waren, den Chat noch entfernen.

Deine eigene AI-Chat-Plattform von OrbitLabs: lokale Modelle über **Ollama** auf dem Tiny, optional ein starkes
Cloud-Modell (**DeepSeek V4.1 Flash**), Erinnerungen, ein Coder-Modus mit Live-Vorschau und Login wie auf der OrbitLabs-Webseite.

## Schnellstart (Lenovo Tiny / Heimserver)

```bash
# 1. Ollama und ein Modell
sudo apt install -y curl
curl -fsSL https://ollama.com/install.sh | sh
ollama pull deepseek-r1:1.5b

# 2. Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. AI Core
unzip ai-core-3.2.zip && cd ai-core
npm install
cp .env.example .env
npm start
```

Dann im Browser `http://<IP-des-Tiny>:3000` öffnen. Der Punkt oben zeigt den Status
(grün = Modell im Speicher, gelb = verbunden, wird bei der ersten Nachricht geladen, rot = Ollama nicht erreichbar).

**Dauerbetrieb:** `deploy/ai-core.service` (Anleitung steht in der Datei).
**Update einer bestehenden Installation:** neue Zip entpacken, `.env` und `data/` übernehmen, `npm install`,
`sudo systemctl restart ai-core`. Deine Chats liegen im Browser und bleiben erhalten.

## Auf GitHub veröffentlichen (merkbare Adresse)

Die Oberfläche liegt auf GitHub Pages (`https://DEIN-NAME.github.io/ai-core/`), die KI läuft weiter auf dem Tiny.
Die Seite ruft `http://192.168.1.190:3000` im Hintergrund ab. Chats bleiben im Browser, Erinnerungen auf dem Server.

1. Neues GitHub-Repository anlegen, den Inhalt dieses Ordners hochladen (`.env` und `data/` werden durch `.gitignore` nie mitgeschickt).
2. Im Repository: **Settings → Pages → Source: GitHub Actions**. Der Workflow `.github/workflows/pages.yml` veröffentlicht nur `index.html` und `src/`.
3. In der `.env` auf dem Tiny `ALLOWED_ORIGINS=https://DEIN-NAME.github.io` eintragen, dann `sudo systemctl restart ai-core`.
4. Für Google, GitHub und Handy-Login: in Firebase unter *Authentication → Einstellungen → Autorisierte Domains* `DEIN-NAME.github.io` hinzufügen.
5. Ändert sich die Server-Adresse: im Anmeldefenster auf „ändern“ tippen oder `DEFAULT_SERVER` in `src/js/config.js` anpassen.

**Wichtig zum Browser:** Eine HTTPS-Seite darf eine Heimnetz-Adresse nur mit Erlaubnis ansprechen.
Chrome und Edge fragen einmal nach dem Zugriff aufs lokale Netzwerk, bitte *Zulassen*. Safari (iPhone) blockiert das;
dafür dem Tiny eine HTTPS-Adresse geben (zum Beispiel mit Tailscale `tailscale serve`) und diese im Anmeldefenster eintragen.
Die Adresse `http://192.168.1.190:3000` zeigt die Oberfläche weiterhin selbst an und funktioniert immer.

## Dateien erstellen (3.2)

`/datei Excel mit Haushaltsbudget` startet den Dateien-Modus. Die KI gibt die Datei als Code-Block aus
(```` ```xlsx ````, ```` ```pptx ````, ```` ```pdf ````, ```` ```docx ````, ```` ```zip ````); der Knopf im Block-Kopf erzeugt die fertige Datei.
Unter jeder Antwort gibt es außerdem das Menü **Datei**: Word, PDF, PowerPoint (bei mehreren Überschriften), Excel (bei Tabellen), Markdown, Text.
Die Dateien entstehen im Browser (`src/js/xlsx.js`, `pptx.js`, `pdf.js`, `docx.js`, `zip.js`); der Server speichert nichts.

## Bilder, Videos, Teilen

- **Teilen:** Das Teilen-Symbol legt eine Nur-Lesen-Kopie auf dem Server ab (`data/shares`) und kopiert den Link. Wer den Link hat, kann lesen, aber nur, wenn er deinen Server erreicht (Heimnetz oder Tailscale). Dateiinhalte und Bilder werden nicht geteilt. Abschalten mit `SHARING=false`.
- **Bilder (`/bild ...`) und Videos (`/video ...`):** Der Tiny hat keine Grafikkarte. Trage in der `.env` einen Schlüssel eines Anbieters mit OpenAI-kompatibler Schnittstelle ein (`IMAGE_API_KEY`, `VIDEO_API_KEY`, siehe `.env.example`). Die Beschreibung geht dann ins Internet, und Videos dauern Minuten und kosten beim Anbieter Geld. Ohne Schlüssel bleibt beides aus.
- **Projekte:** In der Seitenleiste unter „Projekte“. Dateien eines Projekts werden auf rund 12 000 Zeichen gekürzt, damit das lokale Modell noch Platz zum Antworten hat.

## API für andere Programme (OpenAI-kompatibel)

Mit `API_KEYS` in der `.env` bekommen andere Programme Zugriff auf dein Modell, ohne dass sie sich bei AI Core anmelden müssen.

1. Einen langen Schlüssel erzeugen: `openssl rand -hex 24`
2. In die `.env`: `API_KEYS=vscode:DER_SCHLUESSEL` (mehrere mit Komma), Dienst neu starten.
3. Im Programm als Basisadresse `https://DEINE-ADRESSE/v1` und den Schlüssel eintragen. Der Modellname ist egal, `default` nimmt das Standardmodell. Die Liste der Modelle steht unter `/v1/models`.

Unterstützt: Chat, Streaming, Bilder (als eingebettete Daten). Nicht unterstützt: Werkzeugaufrufe (`tools`); Anfragen damit werden mit einer klaren Meldung abgelehnt. Erinnerungen der Konten werden über die API nie mitgeschickt. Wer den Schlüssel hat, kann dein Modell nutzen, behandle ihn wie ein Passwort.

## Server-Übersicht und Zähler

Besitzer sehen unter Einstellungen → Server den Zustand des Servers. Besitzer ist, wer in `OWNER_UIDS` steht, sonst wer in `ALLOWED_UIDS` steht. Die Zähler (`data/metrics.json`) enthalten nur Zahlen pro Tag und gekürzte Konto-Kennungen, keine Inhalte, und werden nach 60 Tagen gelöscht.

## Von überall erreichbar (Tailscale Funnel)

Im Heimnetz geht alles über `http://192.168.1.190:3000`. Von unterwegs braucht der Tiny eine öffentliche HTTPS-Adresse. Am einfachsten geht das mit Tailscale Funnel: kostenlos, ohne Router-Einstellungen, mit echtem HTTPS-Zertifikat (damit funktionieren auch iPhone/Safari und die GitHub-Seite).

1. Auf dem Tiny: `curl -fsSL https://tailscale.com/install.sh | sh`, danach `sudo tailscale up` und mit dem Link ein Tailscale-Konto anlegen oder anmelden.
2. `sudo tailscale funnel --bg 3000` ausführen. Beim ersten Mal zeigt es einen Link, mit dem du HTTPS-Zertifikate und Funnel für dein Konto freigibst. Danach nennt es die Adresse, zum Beispiel `https://tiny.dein-tailnet.ts.net`. `--bg` hält sie auch nach einem Neustart aufrecht.
3. Diese Adresse öffnest du von überall im Browser. Die Seite kommt dann direkt vom Tiny.
4. Für Google-, GitHub- und Handy-Anmeldung die Adresse (ohne `https://`) in Firebase unter *Authentication → Einstellungen → Autorisierte Domains* eintragen. E-Mail und Passwort gehen ohne.
5. Willst du auch die GitHub-Seite nutzen: In der `.env` `ALLOWED_ORIGINS=https://DEIN-NAME.github.io` setzen, den Dienst neu starten und im Anmeldefenster auf der GitHub-Seite unter „ändern“ die Tunnel-Adresse eintragen (einmal pro Gerät).
6. Abschalten: `sudo tailscale funnel --https=443 3000 off`.

**Sicherheit:** Funnel macht den Server für jeden im Internet erreichbar. Die Adresse ist nicht geheim. Schutz ist die Anmeldung. Prüfe in der `.env`, dass `ALLOW_ANY_FIREBASE_USER=false` steht und nur die gewünschten Konten in `ALLOWED_UIDS`, `ALLOWED_EMAILS` oder `ALLOWED_EMAIL_DOMAINS` eingetragen sind. Ohne Anmeldung (`Anmeldung: AUS` im Start-Log) darf der Server nie öffentlich sein. Halte Node.js und das System aktuell.

## Websuche, Wissenssuche, Code ausführen

- **Websuche:** Ohne Einstellung nutzt der Server DuckDuckGo und Wikipedia. Das geht ohne Konto, ist aber weniger zuverlässig, weil sich DuckDuckGo gegen Programme sperren kann. Besser ist ein Schlüssel von Brave Search (`BRAVE_API_KEY`, hat ein kostenloses Monatskontingent) oder eine eigene SearXNG-Instanz (`SEARXNG_URL`, JSON-Ausgabe muss in SearXNG erlaubt sein). Die Frage geht dabei an den Suchanbieter; die App fragt einmal pro Sitzung nach.
- **Wissenssuche:** Das Modell sieht nie mehr als in sein Kontextfenster passt. Bei kleinen Modellen (4096 Token) sind das nur ein paar Absätze, deshalb sucht AI Core in großen Projektdateien die passenden Abschnitte heraus. Die Suche arbeitet nach Stichwörtern, nicht nach Bedeutung: Wer in der Frage andere Wörter benutzt als im Text, findet weniger.
- **Code ausführen:** Nur JavaScript, in einem abgeschotteten Rahmen. Für Python gibt es das noch nicht.

## Videos, Kontingente und Pro

**Video über Hugging Face:** `HF_TOKEN` in der `.env` eintragen (Token mit Berechtigung „Inference Providers“) und auf dem Server `npm install @huggingface/inference` ausführen. Welche Modelle gerade Videos können, zeigt `https://huggingface.co/api/models?inference_provider=all&pipeline_tag=text-to-video`; das Modell steht in `HF_VIDEO_MODEL`. Ein Video kostet Guthaben beim Anbieter. Das kleine Gratis-Guthaben eines Kontos gilt für den ganzen Server, nicht pro Nutzer, und reicht nur für wenige Clips. Setze deshalb `VIDEO_MAX_PER_MONTH_TOTAL` auf eine Zahl, die dein Budget verträgt.

**Kontingente:** Pro Konto und Kalendermonat. Voreinstellung gratis 1 Video und 10 Bilder, Pro 20 Videos und 200 Bilder. Wer in `OWNER_UIDS` steht, hat keine Grenzen.

**Pro verkaufen mit Stripe:**
1. In Stripe ein Produkt mit einem Abo-Preis anlegen, die Preis-ID (`price_...`) kopieren.
2. In der `.env`: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `PRO_PRICE_LABEL` (zum Beispiel `4,99 € / Monat`) und für den Livebetrieb `PUBLIC_URL` (deine GitHub-Seite).
3. Im Stripe-Dashboard das Kundenportal einschalten, damit „Abo verwalten“ funktioniert.
4. Erst im Testmodus ausprobieren (Testkarte 4242 4242 4242 4242).

Einen Webhook brauchst du nicht: Nach der Zahlung fragt der Server Stripe selbst, und am Ende jeder Abo-Periode prüft er das Abo erneut. Im Livemodus verlangt Stripe eine https-Rückkehradresse, dafür eignet sich die GitHub-Seite. Wer Pro an andere verkauft, braucht dafür ein Gewerbe, Impressum, AGB und die Widerrufsbelehrung; das ist ein Thema für Steuerberatung oder Rechtsberatung, nicht für diese App.

## Funktionen

**Modelle**
- Ollama (lokal) und Cloud gleichzeitig; Auswahl oben im Chat, gruppiert nach Quelle.
- DeepSeek V4.1 Flash über die OpenAI-kompatible Schnittstelle, auch als „Denkmodus“. Der Denkprozess ist einklappbar.
- Hinweis zum Datenschutz, bevor zum ersten Mal ein Cloud-Modell benutzt wird.
- Kontext-Anzeige (Ring oben): wie voll das Gedächtnis des Modells ist; der Verlauf wird automatisch gekürzt.
- Modelle in den Einstellungen ansehen, vorladen und herunterladen.

**Coder-Modus** (Knopf „</> Coder“ oder `/coder`)
- Spezielle Anweisung für vollständige, lauffähige Dateien.
- HTML und SVG erscheinen als **Live-Vorschau** rechts in einer abgeschotteten Sandbox (kein Zugriff auf AI Core, kein Netzwerk).
- Code-Blöcke mit Hervorhebung, Dateiname, Kopieren, Laden; mehrere Dateien als **ZIP**.

**Erinnerungen** (wie bei Claude)
- „Merk dir, dass ich …“ oder `/merken …` speichert einen Fakt; bei Sätzen wie „Ich heiße …“ erscheint „Merken?“.
- Gespeichert auf dem Server (`data/memories.json`), pro Konto, auf allen Geräten gleich. Verwalten unter Einstellungen → Erinnerungen.

**Weiteres**
- Claude-Look (hell/dunkel), Antwortstile, eigene Anweisungen, Diktieren, Daumen-Bewertung.
- Dateien als Kontext: PDF, DOCX, Text, Code, CSV, JSON; Bilder für Modelle mit Bild-Unterstützung.
- Rollen (Coder, Übersetzer, Erklärer, Zusammenfasser, Autor) plus eigene Rollen.
- Befehle mit `/`: `/neu` `/coder` `/rolle` `/merken` `/vergessen` `/export` `/modell` `/hilfe`.
- Chats nach Datum gruppiert, anpinnen, durchsuchen (Strg+K), umbenennen (Doppelklick), als Markdown exportieren, sichern und einlesen.
- Vorlesen, Antwort stoppen (Esc), Nachricht bearbeiten, neu generieren, Tempoanzeige (Tokens/s).
- Hell und Dunkel im Stil der OrbitLabs-Webseite; läuft auch auf dem Handy. Keine externen Schriften, nichts wird nachgeladen.

## Cloud-Modell einrichten (DeepSeek V4.1 Flash)

1. Im DeepSeek-Konto einen API-Schlüssel erzeugen (Doku: api-docs.deepseek.com).
2. In die `.env` eintragen: `CLOUD_API_KEY=sk-…`
3. `sudo systemctl restart ai-core`. Im Chat erscheint „Cloud · DeepSeek“ mit „DeepSeek V4.1 Flash“ und „… · Denkmodus“.

Der Modellname bei DeepSeek ist `deepseek-flash` (`CLOUD_MODELS`). Heißt er bei dir anders, trage ihn dort ein.
Jeder andere OpenAI-kompatible Anbieter geht ebenfalls (`CLOUD_BASE_URL`, `CLOUD_MODELS`).
**Wichtig:** Mit Cloud-Modellen werden deine Nachrichten an den Anbieter gesendet, mit lokalen nicht.
Die Kosten bestimmen `CLOUD_MAX_TOKENS` und `CLOUD_CONTEXT_TOKENS`.

## Anmeldung

Ohne Anmeldung ist AI Core für jeden im Heimnetz offen. Das ist zu Hause in Ordnung, **nicht** fürs Internet.

**Firebase wie auf der OrbitLabs-Webseite** (voreingestellt in `.env.example`): E-Mail und Passwort (Anmelden, Registrieren,
Passwort vergessen), Google, GitHub und Handynummer per SMS. Wer hinein darf, bestimmen `ALLOWED_UIDS` (voreingestellt:
deine Admin-ID), `ALLOWED_EMAILS`, `ALLOWED_EMAIL_DOMAINS` und `ALLOWED_PHONES`. Gäste nie. Ohne Eintrag kommt niemand herein.
Google, GitHub und Handynummer funktionieren nur auf Domains, die in Firebase unter *Autorisierte Domains* stehen;
eine IP-Adresse wie `192.168.1.190` geht dort nicht, im Heimnetz meldest du dich per E-Mail und Passwort an.

**Zugangspasswort:** `ACCESS_PASSWORD` setzen. Beides gleichzeitig ist möglich.

Soll AI Core von außen erreichbar sein (Cloudflare Tunnel, Caddy): immer Anmeldung aktivieren, `TRUST_PROXY=true`
setzen und niemals den Ollama-Port 11434 freigeben.

## Sicherheit im Überblick

- Der Server liefert nur die Oberfläche aus (nicht `server/`, `data/`, `.env`).
- Rate-Limit, Begrenzung gleichzeitiger Antworten, Sperre nach Fehlversuchen beim Login, Origin-Prüfung, strenge Content-Security-Policy.
- Code-Vorschau läuft in einer Sandbox ohne Zugriff auf Sitzung, Cookies und Netzwerk.
- Uploads werden nur im Arbeitsspeicher gelesen; Erinnerungen werden atomar gespeichert.

## Tests

```bash
npm test
```
Startet den Server mit simulierten Modellen (Ollama und Cloud) und prüft Login, Rate-Limit, Dateien, Kontextkürzung,
Cloud-Streaming, Erinnerungen, Vorschau-Sandbox sowie Markdown, Code-Hervorhebung und ZIP.

## Projektstruktur

```
ai-core/
├── index.html               Oberfläche
├── src/css/app.css           Design (OrbitLabs-Farben, hell/dunkel)
├── src/js/                   app, api, chat, ui (Markdown), settings, login, roles, slash, artifacts, zip, hints …
├── src/components/           Seitenleiste, Nachricht, Eingabe, Fenster
├── server/
│   ├── server.js              Einstieg, liefert nur das Frontend aus
│   ├── routes.js              API: Chat, Modelle, Erinnerungen, Vorschau, Upload, Login
│   ├── ai.js                  Quellen: Ollama, Cloud (OpenAI-kompatibel), Anthropic, Demo
│   ├── context.js             Kontext: Anhänge, Kürzung, Bilder
│   ├── memory.js              Erinnerungen pro Konto
│   ├── preview.js             Sandbox-Vorschau für HTML/SVG
│   ├── security.js / firebaseAuth.js   Login, Limits, Header
│   └── fileProcessor.js       Text aus PDF, DOCX, Code
├── test/                     Tests (npm test)
├── deploy/ai-core.service    Autostart (systemd)
└── data/                     Sitzungsschlüssel, Erinnerungen (wird erzeugt)
```
