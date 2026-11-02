# Agent installieren

Auf **jedem** Podman-Host, als **normaler Benutzer** (nie root, kein sudo). Voraussetzungen: Node.js ≥ 22, rootless Podman, systemd (User-Instanz).

## Automatisch
```bash
git clone <repo> && cd podmanmanager
deployment/agent/install.sh [agent-id]       # Standard: Kurzer Hostname
```
Das Skript baut den Agent, installiert ihn nach `~/.local/share/podmanmanager-agent`, schreibt `~/.config/podmanmanager/agent.env` (Modus 600), legt die User-Unit nach `~/.config/systemd/user/` und führt aus:
```bash
systemctl --user enable --now podman.socket
systemctl --user enable --now podmanmanager-agent
```
**Der Token wird nur einmal ausgegeben** (in der Datei steht nur sein SHA-256-Hash). Im Master unter *Hosts → Add agent* zusammen mit `http://<host-ip>:9126` eintragen.

## Konfiguration (`agent.env`)
| Variable | Standard | |
|---|---|---|
| `AGENT_ID` | Pflicht | eindeutig, `A-Z a-z 0-9 . _ -` |
| `AGENT_HOST` | `0.0.0.0` | Bind-Adresse |
| `AGENT_PORT` | `9126` | |
| `AGENT_TOKEN_HASH` | Pflicht | SHA-256 des Tokens |
| `PODMAN_SOCKET` | `$XDG_RUNTIME_DIR/podman/podman.sock` | absoluter Pfad |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `10` / `60000` | Fehlversuche pro IP und Fenster |

Neuen Token erzeugen: `node ~/.local/share/podmanmanager-agent/dist/index.js --generate-token`.

## Betrieb ohne Login (Lingering)
User-Services laufen standardmäßig nur während einer Anmeldung. Damit der Agent nach einem Neustart ohne Login startet:
```bash
sudo loginctl enable-linger <benutzer>
```
Das ist die einzige Aktion mit erhöhten Rechten und betrifft nur systemd, nicht den Agent.

## Prüfen
```bash
systemctl --user status podmanmanager-agent podman.socket
journalctl --user -u podmanmanager-agent -f
ls -l "$XDG_RUNTIME_DIR/podman/podman.sock"
curl -H "Authorization: Bearer <TOKEN>" http://127.0.0.1:9126/api/v1/health
```

## Firewall
Port 9126 nur für die IP des Masters öffnen (Beispiele in [Sicherheit](security.md)).

## Deinstallation
```bash
systemctl --user disable --now podmanmanager-agent
rm -rf ~/.local/share/podmanmanager-agent ~/.config/podmanmanager ~/.config/systemd/user/podmanmanager-agent.service
```
Danach im Master den Host entfernen.
