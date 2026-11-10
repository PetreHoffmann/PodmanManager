# Quadlets (Podman + systemd)

Beispiele, um Master und Agent als **rootless Quadlet** zu betreiben. **Ungetestet auf echter Hardware** (in der Entwicklungsumgebung lief kein Podman); bei Problemen zuerst `podman-system-generator --user --dryrun` und `journalctl --user -u <unit>` prüfen.

| Datei | Zweck |
|---|---|
| `podmanmanager-master.container` | Master (Web-UI, Port 8080) |
| `podmanmanager-data.volume` | Volume für die Master-Datenbank |
| `podmanmanager-agent.container` | Agent (Port 9126, spricht mit dem Rootless-Podman-Socket) |
| `podmanmanager.network` | optional: gemeinsames Netzwerk, wenn Master und Agent auf demselben Host laufen |

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

## Master und Agent auf demselben Host

Läuft der Master als Rootless-Container auf demselben Host wie der Agent, scheitert die Registrierung über Hostname oder Host-IP oft mit **`Agent not reachable (ECONNREFUSED)`**, obwohl `curl` vom Host aus funktioniert: Bei Rootless-Podman mit `pasta` ist die Host-Adresse im Container häufig die Adresse des Containers selbst, oder der Port ist nur auf `127.0.0.1` veröffentlicht. Zuverlässig ist ein gemeinsames Podman-Netzwerk:

1. `podmanmanager.network` nach `~/.config/containers/systemd/` kopieren.
2. In **beiden** `.container`-Dateien die Zeile `# Network=podmanmanager.network` auskommentieren (also `Network=podmanmanager.network`).
3. `systemctl --user daemon-reload && systemctl --user restart podmanmanager-agent podmanmanager-master`
4. Im Master unter *Hosts* `http://podmanmanager-agent:9126` und den Token eintragen.

`PublishPort` am Agent ist dann nur für Master auf **anderen** Hosts nötig. Alternative ohne Netzwerk: im Master `http://host.containers.internal:9126` eintragen (der Agent-Port muss dazu auf einer erreichbaren Adresse veröffentlicht sein). Diagnose: `podman port podmanmanager-agent`, `ss -ltnp | grep 9126` und vom Master aus
`podman exec podmanmanager-master node -e "fetch('http://<agent>:9126/api/v1/health').then(r=>console.log(r.status)).catch(e=>console.log(e.cause.code))"` (`401` = Verbindung steht).
Das Netzwerk-Beispiel ist **ungetestet**.

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
