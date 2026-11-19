# Linux-Testlabor (Docker)

Coder Ultimate führt Programme **nie auf dem Server selbst** aus, sondern in einem Docker-Container (Ubuntu 24.04):
ohne Netz, mit 512 MB Speicher, 1 CPU, 256 Prozessen, ohne Rechte und mit 30 Sekunden Zeitlimit.

## Einrichten auf dem Tiny (Linux)

```bash
sudo apt install docker.io            # Docker installieren
sudo usermod -aG docker $USER         # den Benutzer, unter dem AI Core läuft, zur Gruppe hinzufügen (danach neu anmelden)
cd deploy/sandbox && docker build -t aicore-sandbox:latest .
```

Dann den Server neu starten. Unter Einstellungen → Pro (oder `/linux` im Chat) zeigt das Testlabor „bereit“.

## Einstellungen (.env)

`SANDBOX=false` schaltet es ab · `SANDBOX_IMAGE` · `SANDBOX_TIMEOUT_SEC=30` (höchstens 120) · `SANDBOX_MEMORY=512m` · `SANDBOX_CPUS=1` · `SANDBOX_PIDS=256` · `SANDBOX_NETWORK=true` erlaubt Programmen Netz (Standard: kein Netz).
