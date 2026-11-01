# AI Core 3.1

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
unzip ai-core-3.0.zip && cd ai-core
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

## Bilder, Videos, Teilen

- **Teilen:** Das Teilen-Symbol legt eine Nur-Lesen-Kopie auf dem Server ab (`data/shares`) und kopiert den Link. Wer den Link hat, kann lesen, aber nur, wenn er deinen Server erreicht (Heimnetz oder Tailscale). Dateiinhalte und Bilder werden nicht geteilt. Abschalten mit `SHARING=false`.
- **Bilder (`/bild ...`) und Videos (`/video ...`):** Der Tiny hat keine Grafikkarte. Trage in der `.env` einen Schlüssel eines Anbieters mit OpenAI-kompatibler Schnittstelle ein (`IMAGE_API_KEY`, `VIDEO_API_KEY`, siehe `.env.example`). Die Beschreibung geht dann ins Internet, und Videos dauern Minuten und kosten beim Anbieter Geld. Ohne Schlüssel bleibt beides aus.
- **Projekte:** In der Seitenleiste unter „Projekte“. Dateien eines Projekts werden auf rund 12 000 Zeichen gekürzt, damit das lokale Modell noch Platz zum Antworten hat.

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
