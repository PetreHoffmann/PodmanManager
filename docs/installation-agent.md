# Agent installieren

Der Agent läuft als **Rootless-Container** auf jedem Podman-Host, als **normaler Benutzer** (nie root, kein sudo). Voraussetzung: rootless Podman (Quadlet ab 4.4, empfohlen 5.x) mit systemd-Benutzerinstanz. Es gibt zwei Wege, ihn zu starten: **Quadlet** (Dauerbetrieb, empfohlen) und **`podman run`** (zum Ausprobieren).

## 1. Token und Hash im Master erzeugen

Im Master unter *Hosts* → *Neuen Agent einrichten* die **Agent-Adresse** (`http://<host-ip>:9126`) und eine eindeutige **Agent-ID** (`A-Z a-z 0-9 . _ -`) eintragen und auf *Erzeugen und Konfiguration anzeigen* klicken.

Der Master erzeugt den Token, speichert ihn verschlüsselt und legt den Host an. Der Agent bekommt nur den **Hash** des Tokens. Der Master zeigt ihn in drei Reitern, jeweils mit Kopieren-Knopf:

- **Komplette Quadlet-Datei** mit eingetragener Agent-ID und eingetragenem Hash (für Weg 3a),
- **podman run**: der fertige Befehl mit Agent-ID, Hash und Port (für Weg 3b),
- **Nur Hash** als Zeile `AGENT_TOKEN_HASH=…` (für eigene Dateien oder Befehle).

Im Master ist danach nichts mehr einzutragen. Der Host erscheint zunächst als *unbekannt* und wird *online*, sobald der Agent läuft. Den Block kannst du jederzeit unter *Hosts* → *Einrichtung* erneut anzeigen lassen; der Token selbst wird nie angezeigt.

## 2. Einmalig auf dem Host vorbereiten

```bash
systemctl --user enable --now podman.socket     # Socket des eigenen Benutzers
sudo loginctl enable-linger $USER               # Dienste laufen ohne Login weiter (einzige Aktion mit erhöhten Rechten)
```

## 3a. Mit Quadlet (Dauerbetrieb)

Die Quadlet-Datei aus dem Master als `~/.config/containers/systemd/podmanmanager-agent.container` speichern. Sie enthält den Hash, deshalb mit `chmod 600` schützen:

```bash
mkdir -p ~/.config/containers/systemd
chmod 600 ~/.config/containers/systemd/podmanmanager-agent.container
systemctl --user daemon-reload
systemctl --user start podmanmanager-agent
```
Quadlet-Units werden nicht mit `enable` aktiviert; `[Install]` wirkt automatisch nach `daemon-reload`. Mehr dazu (gemeinsames Netzwerk, Updates, cgroup v1): [Quadlets](../deployment/quadlet/README.md).

## 3b. Mit `podman run`

Im Master den Reiter *podman run* öffnen, den Befehl kopieren und auf dem Host als Podman-Benutzer ausführen. Er sieht so aus (Agent-ID und Hash trägt der Master ein):

```bash
podman run -d --name podmanmanager-agent --restart=always \
  --hostname "$(hostname)" \
  --user "$(id -u)" --userns=keep-id \
  -p 192.168.1.21:9126:9126 \
  -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" \
  -e AGENT_ID=host-1 \
  -e AGENT_TOKEN_HASH=<hash aus dem Master> \
  docker.io/petrecalinoiu/podmanmanager-agent:latest
```
- `-p <IP>:9126:9126` veröffentlicht den Port nur auf der Management-Adresse (anpassen; ohne IP lauscht er auf allen Adressen).
- `--hostname` zeigt im Master den Rechnernamen statt der Container-ID.
- `--user "$(id -u)" --userns=keep-id` lässt den Agent mit deiner UID laufen; ohne ist der Socket nicht lesbar (`socketStatus: unreachable`). Der Agent verweigert Root.
- Auf SELinux-Hosts (Fedora/RHEL/Rocky) zusätzlich `--security-opt label=disable`.
- Nach einem **Reboot** startet der Container nur mit Lingering und `systemctl --user enable podman-restart.service`. Für verlässlichen Autostart ist Quadlet besser.

## Konfiguration (Umgebungsvariablen des Containers)

| Variable | Standard | |
|---|---|---|
| `AGENT_ID` | Pflicht | eindeutig, `A-Z a-z 0-9 . _ -` |
| `AGENT_TOKEN_HASH` | Pflicht | SHA-256 des Tokens, kommt vom Master |
| `AGENT_HOST` | `0.0.0.0` | Bind-Adresse |
| `AGENT_PORT` | `9126` | |
| `PODMAN_SOCKET` | `/run/podman/podman.sock` | Pfad im Container |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `10` / `60000` | Fehlversuche pro IP und Fenster |

## Prüfen

```bash
podman logs podmanmanager-agent                                    # "agent host-1 vX listening on …"
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.1.21:9126/api/v1/health   # 401 = läuft, Token fehlt
```
Im Master unter *Hosts* auf *Testen* klicken: der Host muss *online* werden. Bei Quadlet zusätzlich `systemctl --user status podmanmanager-agent` und `journalctl --user -u podmanmanager-agent -f`.

## Firewall

Port 9126 nur für die IP des Masters öffnen (Beispiele in [Sicherheit](security.md)). Läuft der Master auf demselben Host, braucht ihr ein gemeinsames Podman-Netzwerk (siehe [Quadlets](../deployment/quadlet/README.md#master-und-agent-auf-demselben-host)).

## Token erneuern

Im Master unter *Hosts* → *Einrichtung* auf *Token erneuern* klicken, den neuen Hash im Agent eintragen (Quadlet-Datei bzw. `-e AGENT_TOKEN_HASH=`) und den Agent neu starten (`systemctl --user restart podmanmanager-agent` bzw. Container neu anlegen). Bis dahin steht der Host auf *offline*.

## Aktualisieren und Entfernen

- **Aktualisieren:** Mit `:latest` neues Image laden und neu starten (`podman pull …:latest` und `systemctl --user restart podmanmanager-agent`), oder als Administrator im Master auf *Aktualisieren* klicken (nur Quadlet mit `Restart=always`).
- **Entfernen:** `systemctl --user stop podmanmanager-agent` und die Datei unter `~/.config/containers/systemd/` löschen, danach `systemctl --user daemon-reload` (bei `podman run`: `podman rm -f podmanmanager-agent`). Danach im Master den Host entfernen.
