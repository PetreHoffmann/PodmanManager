# Quadlets (Podman + systemd)

Beispiele, um Master und Agent als **rootless Quadlet** zu betreiben. **Ungetestet auf echter Hardware** (in der Entwicklungsumgebung lief kein Podman); bei Problemen zuerst `podman-system-generator --user --dryrun` und `journalctl --user -u <unit>` prüfen.

| Datei | Zweck |
|---|---|
| `podmanmanager-master.container` | Master (Web-UI, Port 8080) |
| `podmanmanager-data.volume` | Volume für die Master-Datenbank |
| `podmanmanager-agent.container` | Agent (Port 9126, spricht mit dem Rootless-Podman-Socket) |

Ablegen unter `~/.config/containers/systemd/` (rootless). Anpassen: Image-Tag, `PublishPort` (Agent: eigene Management-IP), `AGENT_ID`.

## Master

```bash
mkdir -p ~/.config/containers/systemd
cp podmanmanager-master.container podmanmanager-data.volume ~/.config/containers/systemd/

# Schlüssel einmalig als Secret anlegen und NIE ändern (sonst sind gespeicherte Agent-Tokens unlesbar).
# Secret oder Volume ins Backup aufnehmen.
openssl rand -base64 32 | tr -d '\n' | podman secret create podmanmanager-key -

systemctl --user daemon-reload
systemctl --user start podmanmanager-master
journalctl --user -u podmanmanager-master -f
```
Danach `http://<host>:8080` öffnen und das Admin-Passwort sofort setzen.

## Agent

```bash
systemctl --user enable --now podman.socket      # Socket des eigenen Benutzers

# Token und Hash erzeugen; Hash als Secret speichern, Token im Master unter "Hosts" eintragen
out=$(podman run --rm docker.io/petrecalinoiu/podmanmanager-agent:0.3.0 node dist/index.js --generate-token)
token=$(printf '%s\n' "$out" | awk -F': ' '/^AGENT_TOKEN \(/{print $2}')
hash=$(printf '%s\n' "$out" | awk -F': ' '/^AGENT_TOKEN_HASH/{print $2}')
printf '%s' "$hash" | podman secret create podmanmanager-agent-hash -
echo "Token für den Master (wird nur jetzt angezeigt): $token"
unset out token hash

cp podmanmanager-agent.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user start podmanmanager-agent
```
Wichtig: `printf '%s'` statt `echo` – ein Zeilenumbruch im Secret lässt den Agent mit „not a SHA-256 hex digest“ abbrechen. Hat man schon einen Token: `printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1 | tr -d '\n' | podman secret create podmanmanager-agent-hash -`.

Token erneuern: `podman secret rm podmanmanager-agent-hash`, Block oben erneut ausführen, `systemctl --user restart podmanmanager-agent`, dann den Host im Master entfernen und mit dem neuen Token neu hinzufügen (Secrets werden nur beim Containerstart gelesen).

Port 9126 nur für die Master-IP freigeben (siehe [Sicherheit](../../docs/security.md)).

## Beide: Start ohne Login

```bash
sudo loginctl enable-linger $USER
```

## Hinweise

- **Aktivierung:** Quadlet-Units lassen sich nicht mit `enable` aktivieren; `[Install]` wirkt automatisch nach `daemon-reload`.
- **Secrets** liegen standardmäßig im Dateitreiber (Base64, nur durch Dateirechte geschützt). Das hält sie aus Unit-Dateien und `podman inspect` heraus, ist aber keine Verschlüsselung.
- **Updates:** Mit festem Tag bleibt die Version stabil (der About-Dialog des Masters meldet neue Versionen). `AutoUpdate=registry` braucht `:latest` und `systemctl --user enable --now podman-auto-update.timer`.
- **Agent sieht sich selbst:** Er verwaltet alle Container des Benutzers, auch den eigenen Agent-Container; ein Stopp über die Oberfläche setzt den Host offline (`Restart=always` startet ihn wieder).
- **Agent: `NoNewPrivileges`/`DropCapability=ALL`** sind ungetestet; bei Fehlern diese Zeilen zuerst entfernen. **`SecurityLabelDisable=true`** ist nur auf SELinux-Hosts nötig.
- Die native Installation des Agents (`deployment/agent/install.sh`) bleibt einfacher und robuster, da sie ohne Socket-Mount und UID-Mapping auskommt.
- Systemweit statt rootless (`/etc/containers/systemd/`, `systemctl` ohne `--user`) ginge auch, widerspricht beim Agent aber dem Rootless-Prinzip.
