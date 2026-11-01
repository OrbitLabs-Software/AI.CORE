# Änderungen

## 3.1.0

**GitHub-Pages-Betrieb:** Die Oberfläche kann auf GitHub liegen und den Server im Heimnetz ansprechen
(Server-Adresse einstellbar, CORS mit `ALLOWED_ORIGINS`, Anmeldung per Token statt Cookie, Vorschau ohne Server, Workflow für Pages).

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
