# Deployment mit Podman: `podman run` und Quadlet, Schritt für Schritt

Diese Anleitung betreibt Master und Agent als **Rootless-Container** mit den fertigen Images von Docker Hub (`docker.io/petrecalinoiu/podmanmanager-master` und `…-agent`). Es gibt zwei Wege:

| | `podman run` | Quadlet |
|---|---|---|
| Aufwand | gering, ein Befehl pro Container | Dateien + `systemctl`, dafür sauber verwaltet |
| Autostart nach Reboot | nur mit `--restart=always` und Lingering | ja, über systemd (`WantedBy=default.target`) |
| Empfohlen für | Ausprobieren, Tests | Dauerbetrieb |

Der Agent als Container braucht den gemounteten Rootless-Socket und muss mit der **UID des Podman-Benutzers** laufen (er verweigert Root). Die native Installation (`deployment/agent/install.sh`, siehe [Agent-Installation](../docs/installation-agent.md)) ist einfacher und robuster; die Container-Variante ist die Alternative, wenn auf dem Host nur Container laufen sollen.

## 0. Voraussetzungen (einmalig, auf jedem Host)

```bash
podman --version                                  # Quadlet braucht Podman >= 4.4 (empfohlen 5.x)
systemctl --user enable --now podman.socket       # Socket des eigenen Benutzers (nur Agent-Host)
sudo loginctl enable-linger $USER                 # Dienste laufen ohne Login weiter
VERSION=0.6.0                                     # Image-Tag (Liste: Docker Hub), nicht :latest für Dauerbetrieb
```
Ports: Master `8080` (Browser), Agent `9126` (nur für die IP des Masters freigeben, siehe [Sicherheit](../docs/security.md)). Kein HTTPS: nur in einem abgeschotteten Netz betreiben.

## Token und Hash des Agents

Der Master spricht mit dem Agent über einen **Token**. Der Agent kennt nur dessen **SHA-256-Hash** (`AGENT_TOKEN_HASH`). Beides erzeugt der Agent selbst:

```bash
out=$(podman run --rm docker.io/petrecalinoiu/podmanmanager-agent:$VERSION node dist/index.js --generate-token)
token=$(printf '%s\n' "$out" | awk -F': ' '/^AGENT_TOKEN \(/{print $2}')
hash=$(printf '%s\n' "$out" | awk -F': ' '/^AGENT_TOKEN_HASH/{print $2}')
echo "Token für den Master (wird nur jetzt angezeigt): $token"
```
Den **Token** später im Master unter *Hosts* eintragen, den **Hash** bekommt der Agent (als Secret oder als Environment-Wert, siehe unten). Die Shell-Variablen `token` und `hash` bleiben für die folgenden Schritte erhalten; danach `unset out token hash`.

Hat man schon einen Token: `hash=$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)`.

> **Wichtig:** Den Hash immer mit `printf '%s'` weitergeben, nicht mit `echo`. Ein Zeilenumbruch im Wert lässt den Agent mit „not a SHA-256 hex digest“ abbrechen.

### Secret oder Environment-Wert für den Hash?

| | Podman-Secret (empfohlen) | Environment-Wert |
|---|---|---|
| Wo steht der Hash? | im Secret-Speicher von Podman | in der Unit-Datei bzw. im `podman run`-Befehl |
| In `podman inspect` sichtbar? | nein | ja |
| In Shell-History / Unit-Datei lesbar? | nein | ja (Dateirechte/Backups beachten) |
| Aufwand | ein Befehl mehr | keiner |

Der Hash ist **nicht der Token**: Aus ihm lässt sich der Token nicht zurückrechnen, und mit dem Hash allein kann man sich nicht beim Agent anmelden. Das Secret ist trotzdem sauberer, weil der Wert nicht in Dateien und Prozesslisten landet. Beide Wege sind unten für `podman run` und Quadlet beschrieben.

---

## A. Mit `podman run`

### A.1 Master

```bash
# 1. Schlüssel für die verschlüsselten Agent-Tokens: einmal anlegen, NIE ändern, sichern
openssl rand -base64 32 | tr -d '\n' | podman secret create podmanmanager-key -

# 2. Master starten (Daten im benannten Volume pm-data)
podman run -d --name podmanmanager-master --restart=always \
  -p 8080:8080 \
  -v pm-data:/data \
  --secret podmanmanager-key,type=env,target=MASTER_SECRET_KEY \
  docker.io/petrecalinoiu/podmanmanager-master:$VERSION

# 3. Prüfen
podman logs podmanmanager-master
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/login    # 200 oder 307
```
Danach `http://<host>:8080` öffnen und das Admin-Passwort sofort setzen. Ohne Secret-Speicher geht es auch mit `-e MASTER_SECRET_KEY="$(openssl rand -base64 32)"`; der Wert muss bei jedem Start identisch sein, sonst sind gespeicherte Agent-Tokens unlesbar (und er steht dann im `podman run`-Befehl und in `podman inspect`).

### A.2 Agent: Hash als Secret (empfohlen)

```bash
# Hash als Secret speichern (hash aus dem Abschnitt „Token und Hash“)
printf '%s' "$hash" | podman secret create podmanmanager-agent-hash -

podman run -d --name podmanmanager-agent --restart=always \
  --hostname "$(hostname)" \
  --user "$(id -u)" --userns=keep-id \
  -p 192.168.1.21:9126:9126 \
  -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" \
  -e AGENT_ID=host-1 \
  --secret podmanmanager-agent-hash,type=env,target=AGENT_TOKEN_HASH \
  docker.io/petrecalinoiu/podmanmanager-agent:$VERSION
```

### A.3 Agent: Hash als Environment-Wert

Wie A.2, nur ohne Secret; der Hash steht direkt im Befehl:

```bash
podman run -d --name podmanmanager-agent --restart=always \
  --hostname "$(hostname)" \
  --user "$(id -u)" --userns=keep-id \
  -p 192.168.1.21:9126:9126 \
  -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" \
  -e AGENT_ID=host-1 \
  -e AGENT_TOKEN_HASH="$hash" \
  docker.io/petrecalinoiu/podmanmanager-agent:$VERSION
```

Erläuterung der Optionen: `-p <IP>:9126:9126` veröffentlicht den Port nur auf der Management-Adresse (anpassen; ohne IP lauscht er auf allen Adressen); `--hostname` sorgt dafür, dass der Master den Rechnernamen statt der Container-ID anzeigt; `--user`/`--userns=keep-id` lässt den Agent mit deiner UID laufen (ohne passt die UID nur zufällig, der Socket ist dann nicht lesbar: `socketStatus: unreachable`); `AGENT_ID` muss pro Agent eindeutig sein (`A-Z a-z 0-9 . _ -`). Auf SELinux-Hosts (Fedora/RHEL) zusätzlich `--security-opt label=disable`.

### A.4 Prüfen und im Master eintragen

```bash
podman logs podmanmanager-agent                                  # "agent host-1 vX listening on …"
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.1.21:9126/api/v1/health      # 401 = läuft, Token fehlt
curl -s -H "Authorization: Bearer $token" http://192.168.1.21:9126/api/v1/health      # socketStatus/apiStatus: ok
unset out token hash
```
Im Master unter *Hosts* `http://<host-ip>:9126` und den Token eintragen.

### A.5 Master und Agent auf demselben Host

Mit gemeinsamem Netzwerk erreicht der Master den Agent über dessen Namen (Host-IP/Hostname scheitern bei Rootless-Podman oft mit `ECONNREFUSED`):

```bash
podman network create podmanmanager
# in beiden podman-run-Befehlen zusätzlich:  --network podmanmanager
# Im Master dann eintragen:                  http://podmanmanager-agent:9126
```

### A.6 Autostart, Update, Entfernen

- `--restart=always` startet die Container nach einem Podman-Neustart; nach einem **Reboot** nur mit aktiviertem Lingering und `systemctl --user enable podman-restart.service`. Für einen verlässlichen Autostart ist Quadlet (Teil B) besser.
- **Update:** neuen `VERSION` setzen, Container entfernen und mit demselben Befehl neu starten (`podman rm -f podmanmanager-agent`). Daten (Volume, Secrets) bleiben erhalten.
- **Entfernen:** `podman rm -f podmanmanager-master podmanmanager-agent`; Daten mit `podman volume rm pm-data`, Secrets mit `podman secret rm podmanmanager-key podmanmanager-agent-hash`.

---

## B. Mit Quadlet

Die fertigen Dateien liegen in [`deployment/quadlet/`](quadlet/README.md) (Hintergrund, Netzwerk, Proxy mit TLS-Inspektion). Quadlets liegen rootless unter `~/.config/containers/systemd/`; systemd erzeugt daraus beim `daemon-reload` die Dienste.

### B.1 Dateien bereitstellen

```bash
cd deployment/quadlet           # im ausgecheckten Repository
mkdir -p ~/.config/containers/systemd
sed -i "s#:0\.[0-9.]*\$#:$VERSION#" podmanmanager-master.container podmanmanager-agent.container   # Image-Tag setzen
grep -n '^Image=' podmanmanager-*.container                                                         # kontrollieren
```

### B.2 Master

```bash
cp podmanmanager-master.container podmanmanager-data.volume ~/.config/containers/systemd/
openssl rand -base64 32 | tr -d '\n' | podman secret create podmanmanager-key -    # einmal, nie ändern, sichern

systemctl --user daemon-reload
systemctl --user start podmanmanager-master
systemctl --user status podmanmanager-master
journalctl --user -u podmanmanager-master -f
```
Danach `http://<host>:8080` öffnen und das Admin-Passwort sofort setzen. Quadlet-Units werden nicht mit `enable` aktiviert; `[Install]` wirkt automatisch nach `daemon-reload`.

### B.3 Agent: Hash als Secret (empfohlen)

Die mitgelieferte Datei `podmanmanager-agent.container` nutzt dieses Secret bereits (`Secret=podmanmanager-agent-hash,type=env,target=AGENT_TOKEN_HASH`).

```bash
printf '%s' "$hash" | podman secret create podmanmanager-agent-hash -      # hash aus „Token und Hash“

# Anpassen: AGENT_ID und PublishPort (eigene Management-IP)
cp podmanmanager-agent.container ~/.config/containers/systemd/
sed -i 's/^Environment=AGENT_ID=.*/Environment=AGENT_ID=host-1/; s/^PublishPort=.*/PublishPort=192.168.1.21:9126:9126/' ~/.config/containers/systemd/podmanmanager-agent.container

systemctl --user daemon-reload
systemctl --user start podmanmanager-agent
journalctl --user -u podmanmanager-agent -f
```

### B.4 Agent: Hash als Environment-Wert

Statt des Secrets steht der Hash als `Environment=` in der Unit-Datei. Die Zeile `Secret=…` wird dafür ersetzt:

```bash
cp podmanmanager-agent.container ~/.config/containers/systemd/
f=~/.config/containers/systemd/podmanmanager-agent.container
sed -i 's/^Environment=AGENT_ID=.*/Environment=AGENT_ID=host-1/; s/^PublishPort=.*/PublishPort=192.168.1.21:9126:9126/' "$f"
sed -i "s|^Secret=podmanmanager-agent-hash.*|Environment=AGENT_TOKEN_HASH=$hash|" "$f"
chmod 600 "$f"                                   # der Hash steht jetzt in der Datei
grep -n 'AGENT_TOKEN_HASH' "$f"                  # kontrollieren: genau eine Zeile, 64 Hex-Zeichen, kein Zeilenumbruch

systemctl --user daemon-reload
systemctl --user start podmanmanager-agent
journalctl --user -u podmanmanager-agent -f
```
Ein Secret muss in diesem Fall nicht angelegt werden. Der Hash ist über `podman inspect` und die Unit-Datei lesbar; nimm Backups der Datei entsprechend vertraulich.

### B.5 Prüfen und im Master eintragen

```bash
systemctl --user is-active podmanmanager-agent                                          # active
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.1.21:9126/api/v1/health         # 401 = läuft
curl -s -H "Authorization: Bearer $token" http://192.168.1.21:9126/api/v1/health        # socketStatus/apiStatus: ok
unset out token hash
```
Im Master unter *Hosts* `http://<host-ip>:9126` und den Token eintragen. Master und Agent auf demselben Host: gemeinsames Netzwerk wie in der [Quadlet-Anleitung](quadlet/README.md#master-und-agent-auf-demselben-host) (Eintrag dann `http://podmanmanager-agent:9126`).

### B.6 Update, Token erneuern, Entfernen

- **Update:** In den `.container`-Dateien den `Image=`-Tag ändern, `systemctl --user daemon-reload && systemctl --user restart podmanmanager-agent podmanmanager-master`. Der About-Dialog des Masters zeigt, wenn eine neuere Version vorliegt.
- **Update per Web-UI (ab v0.10.0 / v0.11.0):** Mit `Image=…:latest` und `Restart=always` aktualisiert der Admin Agents in der Host-Ansicht („veraltet“ → *Aktualisieren*) und den Master unter *Über* → *Jetzt aktualisieren*. Für den Master braucht der Agent auf demselben Host `Environment=UPDATE_UNIT=podmanmanager-master`. Details: [Quadlets](quadlet/README.md#master-per-web-ui-aktualisieren).
- **Token erneuern:** Abschnitt „Token und Hash“ erneut ausführen, dann
  - Secret-Variante: `podman secret rm podmanmanager-agent-hash`, neues Secret anlegen (B.3);
  - Environment-Variante: `AGENT_TOKEN_HASH=` in der Unit-Datei ersetzen (B.4);

  danach `systemctl --user restart podmanmanager-agent` (Secrets und Umgebung werden nur beim Containerstart gelesen) und den Host im Master mit dem neuen Token neu eintragen.
- **Entfernen:** `systemctl --user stop podmanmanager-agent podmanmanager-master`, Dateien aus `~/.config/containers/systemd/` löschen, `systemctl --user daemon-reload`; Daten mit `podman volume rm systemd-podmanmanager-data` (Name mit `podman volume ls` prüfen) und `podman secret rm …`.

## Fehlersuche (kurz)

| Meldung | Ursache |
|---|---|
| Agent bricht ab: `AGENT_TOKEN_HASH missing or not a SHA-256 hex digest` | Hash fehlt, falsch kopiert oder mit Zeilenumbruch (`printf '%s'` statt `echo`) |
| Agent: `Refusing to run as root` | der Container läuft als UID 0 (`--user 0`); mit der UID des Podman-Benutzers starten, siehe A.2 / Quadlet-Datei |
| `socketStatus: unreachable` | Agent läuft mit einer anderen UID als der Socket-Besitzer: `--user "$(id -u)" --userns=keep-id` bzw. `User=%U` + `UserNS=keep-id` |
| Master: `Agent not reachable (ECONNREFUSED)` / `EAI_AGAIN` | Master und Agent auf demselben Host ohne gemeinsames Netzwerk, siehe A.5 / B.5 |
| Quadlet: Exit-Code 126, `mkdir /sys/fs/cgroup/…: permission denied` | Host mit cgroup v1: in der Unit unter `[Container]` `PodmanArgs=--cgroups=enabled` ergänzen (siehe unten) |
| `socketStatus: missing` im Health-Check | `systemctl --user enable --now podman.socket` fehlt oder falscher Socket-Pfad |
| Master startet nicht: `MASTER_SECRET_KEY` | Secret `podmanmanager-key` fehlt oder hat keine 32 Byte (base64) |

### Hosts mit cgroup v1 (Quadlet)

Auf Hosts mit **cgroup v1** (z. B. RHEL 8 und ähnliche; Prüfung: `podman info --format '{{.Host.CgroupsVersion}} {{.Host.CgroupManager}} {{.Host.OCIRuntime.Name}}'` zeigt `v1 cgroupfs runc`) startet ein Rootless-Quadlet nicht. Quadlet übergibt `--cgroups=split`, und Podman scheitert dann mit Exit-Code 126 und im Journal (`journalctl --user -u podmanmanager-agent`):

```
Error: mkdir /sys/fs/cgroup/pids/user.slice/user-1002.slice/user@1002.service/runtime: permission denied
```

Abhilfe: in `podmanmanager-agent.container` (und bei Bedarf `podmanmanager-master.container`) unter `[Container]` ergänzen:

```ini
PodmanArgs=--cgroups=enabled
```
Danach `systemctl --user daemon-reload && systemctl --user reset-failed podmanmanager-agent && systemctl --user start podmanmanager-agent`. Der spätere Wert überschreibt das `split` des Generators (im Dry-Run mit Podman 4.9.3 geprüft). `--cgroups=disabled` ist hier keine Alternative: `runc` lehnt es ab, nur `crun` unterstützt es. `podman run` ohne `--cgroups`-Option (Teil A) ist von dem Problem nicht betroffen. Langfristig lässt sich der Host auf cgroup v2 umstellen (`systemd.unified_cgroup_hierarchy=1`); die native Agent-Installation braucht keine Container-cgroups.

**Bestätigt** auf einem echten Host mit Podman 4.9.4 (cgroup v1, `cgroupfs`, `runc`): mit `PodmanArgs=--cgroups=enabled` startet der Agent als Quadlet. Nachgestellt (ohne systemd) mit Podman 4.9.3 auf cgroup v1 mit `runc`: `--cgroups=split` scheitert, `enabled` und `no-conmon` starten den Container.

## Was geprüft ist

**Podman 5.8.2, rootless** (aus dem Quellcode gebauter Rootless-Podman in der Entwicklungsumgebung, die veröffentlichten Images `0.6.0` von Docker Hub): Token-/Hash-Erzeugung (`sha256(token) == hash`); Master per `podman run` mit Schlüssel als Secret (Login-Seite antwortet); Agent per `podman run` mit `--user`/`--userns=keep-id` und gemountetem Rootless-Socket, **mit Hash als Secret und mit Hash als Environment-Wert** (ohne Token 401, mit Token `socketStatus: ok`, Podman 5.8.2); Registrierung im Master, Container-/Pod-Liste, Pod stoppen/starten, Container-Logs und Agent-Logs über die Oberfläche; `podman inspect` zeigt den Hash nur bei der Environment-Variante; Quadlet-Generator (`quadlet -dryrun`) für die Secret- und die Environment-Variante inklusive der `sed`-Schritte. Außerdem mit Podman 4.9.3: Abbruch bei Zeilenumbruch im Hash und bei UID 0.

**Einschränkungen der Prüfumgebung:** kein systemd (Quadlet-Units wurden nur erzeugt, nicht gestartet) und kein `/dev/net/tun` (Rootless-Netzwerk mit `pasta`), deshalb liefen die Tests mit `--network host` statt `-p` und mit `seccomp=unconfined`. `-p`-Portveröffentlichung und der Start der Quadlet-Units sind dort nicht geprüft; auf einem echten Rootless-Host mit Podman 5.8.2 sind die Quadlets (Secret-Variante) bestätigt, siehe [Quadlet-Anleitung](quadlet/README.md).

Weitere Fälle: [Troubleshooting](../docs/troubleshooting.md).
