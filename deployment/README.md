# Deployment mit Podman: `podman run` und Quadlet, Schritt für Schritt

Diese Anleitung betreibt Master und Agent als **Rootless-Container** mit den fertigen Images von Docker Hub (`docker.io/petrecalinoiu/podmanmanager-master` und `…-agent`). Es gibt zwei Wege:

| | `podman run` | Quadlet |
|---|---|---|
| Aufwand | gering, ein Befehl pro Container | Dateien + `systemctl`, dafür sauber verwaltet |
| Autostart nach Reboot | nur mit `--restart=always`, Lingering und `podman-restart.service` | ja, über systemd (`WantedBy=default.target`) |
| Empfohlen für | Ausprobieren, Tests | Dauerbetrieb |

Der Agent als Container braucht den gemounteten Rootless-Socket und muss mit der **UID des Podman-Benutzers** laufen (er verweigert Root).

## 0. Voraussetzungen (einmalig, auf jedem Host)

```bash
podman --version                                  # Quadlet braucht Podman >= 4.4 (empfohlen 5.x)
systemctl --user enable --now podman.socket       # Socket des eigenen Benutzers (nur Agent-Host)
sudo loginctl enable-linger $USER                 # Dienste laufen ohne Login weiter
```
Ports: Master `8080` (Browser), Agent `9126` (nur für die IP des Masters freigeben, siehe [Sicherheit](../docs/security.md)). Kein HTTPS: nur in einem abgeschotteten Netz betreiben. In den Beispielen steht `:latest`; für ein festes Image `X.Y.Z` eintragen (dann gehen Updates per Web-UI nicht).

## Der Agent bekommt seinen Hash vom Master

Token und Hash erzeugt der **Master**: unter *Hosts* → *Neuen Agent einrichten* Agent-Adresse (`http://<host-ip>:9126`) und Agent-ID eintragen. Der Master speichert den Token selbst, legt den Host an und zeigt den **Hash** als fertige Quadlet-Datei oder als Zeile `AGENT_TOKEN_HASH=…`. Auf dem Host muss nichts erzeugt und nichts im Master nachgetragen werden. Der Hash lässt sich unter *Hosts* → *Einrichtung* jederzeit erneut anzeigen. Er ist nicht der Token: Aus ihm lässt sich der Token nicht zurückrechnen, und mit dem Hash allein kann man sich nicht beim Agent anmelden. Trotzdem die Datei bzw. den Befehl nicht öffentlich ablegen (Rechte `600`).

Ausführlich: [Agent-Installation](../docs/installation-agent.md).

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
  docker.io/petrecalinoiu/podmanmanager-master:latest

# 3. Prüfen
podman logs podmanmanager-master
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/login    # 200 oder 307
```
Danach `http://<host>:8080` öffnen und das Admin-Passwort sofort setzen. Ohne Secret-Speicher geht es auch mit `-e MASTER_SECRET_KEY="$(openssl rand -base64 32)"`; der Wert muss bei jedem Start identisch sein, sonst sind gespeicherte Agent-Tokens unlesbar (und er steht dann im `podman run`-Befehl und in `podman inspect`).

### A.2 Agent

Zuerst im Master den Agent einrichten (siehe oben). Im Reiter **podman run** steht der fertige Befehl zum Kopieren. Er sieht so aus (Agent-ID und Hash trägt der Master ein):

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
`-p <IP>:9126:9126` veröffentlicht den Port nur auf der Management-Adresse (anpassen; ohne IP lauscht er auf allen Adressen); `--hostname` sorgt dafür, dass der Master den Rechnernamen statt der Container-ID anzeigt; `--user`/`--userns=keep-id` lässt den Agent mit deiner UID laufen (ohne passt die UID nur zufällig, der Socket ist dann nicht lesbar: `socketStatus: unreachable`); `AGENT_ID` muss die ID sein, die du im Master angegeben hast. Auf SELinux-Hosts (Fedora/RHEL) zusätzlich `--security-opt label=disable`.

### A.3 Prüfen

```bash
podman logs podmanmanager-agent                                                  # "agent host-1 vX listening on …"
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.1.21:9126/api/v1/health   # 401 = läuft, Token fehlt
```
Im Master unter *Hosts* auf *Testen* klicken: der Host wird *online*.

### A.4 Master und Agent auf demselben Host

Mit gemeinsamem Netzwerk erreicht der Master den Agent über dessen Namen (Host-IP/Hostname scheitern bei Rootless-Podman oft mit `ECONNREFUSED`):

```bash
podman network create podmanmanager
# in beiden podman-run-Befehlen zusätzlich:  --network podmanmanager
# Im Master als Agent-Adresse eintragen:     http://podmanmanager-agent:9126
```

### A.5 Autostart, Update, Entfernen

- `--restart=always` startet die Container nach einem Podman-Neustart; nach einem **Reboot** nur mit aktiviertem Lingering und `systemctl --user enable podman-restart.service`. Für einen verlässlichen Autostart ist Quadlet (Teil B) besser.
- **Update:** `podman pull …:latest`, Container entfernen und mit demselben Befehl neu starten (`podman rm -f podmanmanager-agent`). Daten (Volume, Secrets) bleiben erhalten.
- **Token erneuern:** im Master *Hosts* → *Einrichtung* → *Token erneuern*, neuen Hash im `podman run`-Befehl einsetzen, Container neu anlegen.
- **Entfernen:** `podman rm -f podmanmanager-master podmanmanager-agent`; Daten mit `podman volume rm pm-data`, den Schlüssel mit `podman secret rm podmanmanager-key`.

---

## B. Mit Quadlet

Die fertigen Dateien liegen in [`deployment/quadlet/`](quadlet/README.md) (Hintergrund, Netzwerk, Proxy mit TLS-Inspektion). Quadlets liegen rootless unter `~/.config/containers/systemd/`; systemd erzeugt daraus beim `daemon-reload` die Dienste.

### B.1 Master

```bash
cd deployment/quadlet           # im ausgecheckten Repository
mkdir -p ~/.config/containers/systemd
cp podmanmanager-master.container podmanmanager-data.volume ~/.config/containers/systemd/
openssl rand -base64 32 | tr -d '\n' | podman secret create podmanmanager-key -    # einmal, nie ändern, sichern

systemctl --user daemon-reload
systemctl --user start podmanmanager-master
journalctl --user -u podmanmanager-master -f
```
Danach `http://<host>:8080` öffnen und das Admin-Passwort sofort setzen. Quadlet-Units werden nicht mit `enable` aktiviert; `[Install]` wirkt automatisch nach `daemon-reload`.

### B.2 Agent

Zuerst im Master den Agent einrichten (*Hosts* → *Neuen Agent einrichten*). Der Master zeigt dort die **fertige** `podmanmanager-agent.container` mit Agent-ID, Hash und `PublishPort`. Diese Datei speichern, nichts weiter anpassen:

```bash
# Inhalt aus dem Master nach ~/.config/containers/systemd/podmanmanager-agent.container
chmod 600 ~/.config/containers/systemd/podmanmanager-agent.container     # der Hash steht in der Datei

systemctl --user daemon-reload
systemctl --user start podmanmanager-agent
journalctl --user -u podmanmanager-agent -f
```
Die Vorlage im Repository (`deployment/quadlet/podmanmanager-agent.container`) hat dieselbe Form, mit Platzhaltern für Hash und Agent-ID und mit auskommentierten Optionen (gemeinsames Netzwerk, `UPDATE_UNIT`, cgroup v1).

### B.3 Prüfen

```bash
systemctl --user is-active podmanmanager-agent                                    # active
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.1.21:9126/api/v1/health   # 401 = läuft
```
Im Master unter *Hosts* auf *Testen* klicken: der Host wird *online*. Master und Agent auf demselben Host: gemeinsames Netzwerk wie in der [Quadlet-Anleitung](quadlet/README.md#master-und-agent-auf-demselben-host) (Agent-Adresse dann `http://podmanmanager-agent:9126`).

### B.4 Update, Token erneuern, Entfernen

- **Update:** `podman pull …:latest` und `systemctl --user restart podmanmanager-agent podmanmanager-master`, oder als Administrator per Web-UI: Agents in der Host-Ansicht („veraltet“ → *Aktualisieren* bzw. *Alle veralteten Agents aktualisieren*) und den Master unter *Über* → *Jetzt aktualisieren* (dafür `Restart=always`, `:latest` und beim Master-Host `Environment=UPDATE_UNIT=podmanmanager-master` im Agent-Quadlet). Details: [Quadlets](quadlet/README.md#master-per-web-ui-aktualisieren).
- **Token erneuern:** im Master *Hosts* → *Einrichtung* → *Token erneuern*, den neuen Hash in `AGENT_TOKEN_HASH=` der Unit-Datei eintragen und `systemctl --user daemon-reload && systemctl --user restart podmanmanager-agent` (die Umgebung wird nur beim Containerstart gelesen).
- **Entfernen:** `systemctl --user stop podmanmanager-agent podmanmanager-master`, Dateien aus `~/.config/containers/systemd/` löschen, `systemctl --user daemon-reload`; Daten mit `podman volume rm systemd-podmanmanager-data` (Name mit `podman volume ls` prüfen) und `podman secret rm podmanmanager-key`.

## Fehlersuche (kurz)

| Meldung | Ursache |
|---|---|
| Agent bricht ab: `AGENT_TOKEN_HASH missing or not a SHA-256 hex digest` | Hash fehlt oder falsch kopiert (64 Hex-Zeichen, ohne Leerzeichen oder Zeilenumbruch); im Master unter *Hosts* → *Einrichtung* erneut anzeigen |
| Agent: `Refusing to run as root` | der Container läuft als UID 0 (`--user 0`); mit der UID des Podman-Benutzers starten, siehe A.2 / Quadlet-Datei aus dem Master |
| `socketStatus: unreachable` | Agent läuft mit einer anderen UID als der Socket-Besitzer: `--user "$(id -u)" --userns=keep-id` bzw. `User=%U` + `UserNS=keep-id` |
| Master: `Agent not reachable (ECONNREFUSED)` / `EAI_AGAIN` | Master und Agent auf demselben Host ohne gemeinsames Netzwerk, siehe A.4 / B.3 |
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
Danach `systemctl --user daemon-reload && systemctl --user reset-failed podmanmanager-agent && systemctl --user start podmanmanager-agent`. Der spätere Wert überschreibt das `split` des Generators (im Dry-Run mit Podman 4.9.3 geprüft). `--cgroups=disabled` ist hier keine Alternative: `runc` lehnt es ab, nur `crun` unterstützt es. `podman run` ohne `--cgroups`-Option (Teil A) ist von dem Problem nicht betroffen. Langfristig lässt sich der Host auf cgroup v2 umstellen (`systemd.unified_cgroup_hierarchy=1`).

**Bestätigt** auf einem echten Host mit Podman 4.9.4 (cgroup v1, `cgroupfs`, `runc`): mit `PodmanArgs=--cgroups=enabled` startet der Agent als Quadlet. Nachgestellt (ohne systemd) mit Podman 4.9.3 auf cgroup v1 mit `runc`: `--cgroups=split` scheitert, `enabled` und `no-conmon` starten den Container.

## Was geprüft ist

**Podman 5.8.2, rootless** auf einem echten Host (Rocky Linux 9): Agent und Master als Quadlet (Master-Anbindung, Containerliste, Start/Stopp/Neustart, Update per Web-UI) und der Agent mit der fertigen Quadlet-Datei aus dem Master (Hash als `Environment=`). Außerdem Podman 4.9.4 (Rocky 8, cgroup v1) mit `PodmanArgs=--cgroups=enabled`. **Nicht auf einem echten Host geprüft:** `podman run` mit `-p`-Portveröffentlichung und Rootless-Netzwerk (`pasta`) in der Entwicklungsumgebung (dort ohne `/dev/net/tun`, deshalb getestet mit `--network host`), sowie `NoNewPrivileges`/`DropCapability=ALL` in allen Umgebungen.

Weitere Fälle: [Troubleshooting](../docs/troubleshooting.md).
