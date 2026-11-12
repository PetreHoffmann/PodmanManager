# Quadlets (Podman + systemd)

Beispiele, um Master und Agent als **rootless Quadlet** zu betreiben. **Bestätigt** auf einem echten Host mit Rootless-Podman 5.8.2: Agent- und Master-Unit starten, im gemeinsamen Netzwerk (`podmanmanager.network`) löst der Master `podmanmanager-agent` auf, die Registrierung (`http://podmanmanager-agent:9126`) gelingt, der Host ist online, und Containerliste sowie Start/Stop/Restart über den Master funktionieren. **Nicht bestätigt:** `NoNewPrivileges`/`DropCapability=ALL` in allen Umgebungen sowie Setups mit Master und Agent auf verschiedenen Hosts. Bei Problemen zuerst `podman-system-generator --user --dryrun` und `journalctl --user -u <unit>` prüfen.

| Datei | Zweck |
|---|---|
| `podmanmanager-master.container` | Master (Web-UI, Port 8080) |
| `podmanmanager-data.volume` | Volume für die Master-Datenbank |
| `podmanmanager-agent.container` | Agent (Port 9126, spricht mit dem Rootless-Podman-Socket) |
| `podmanmanager.network` | optional: gemeinsames Netzwerk, wenn Master und Agent auf demselben Host laufen |

**Schritt für Schritt (`podman run` und Quadlet, Hash als Secret oder Environment-Wert): [deployment/README.md](../README.md).** Ablegen unter `~/.config/containers/systemd/` (rootless). Anpassen: Image-Tag, `PublishPort` (Agent: eigene Management-IP), `AGENT_ID`.

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

**Hash als Environment-Wert statt Secret** (ohne `podman secret`): in `podmanmanager-agent.container` die Zeile `Secret=podmanmanager-agent-hash,…` durch `Environment=AGENT_TOKEN_HASH=<hash>` ersetzen und die Datei mit `chmod 600` schützen; Details in [deployment/README.md](../README.md#b4-agent-hash-als-environment-wert).

Token erneuern: `podman secret rm podmanmanager-agent-hash`, Block oben erneut ausführen, `systemctl --user restart podmanmanager-agent`, dann den Host im Master entfernen und mit dem neuen Token neu hinzufügen (Secrets werden nur beim Containerstart gelesen).

Port 9126 nur für die Master-IP freigeben (siehe [Sicherheit](../../docs/security.md)).

## Master und Agent auf demselben Host

Läuft der Master als Rootless-Container auf demselben Host wie der Agent, scheitert die Registrierung über Hostname oder Host-IP oft mit **`Agent not reachable (ECONNREFUSED)`**, obwohl `curl` vom Host aus funktioniert: Bei Rootless-Podman mit `pasta` ist die Host-Adresse im Container häufig die Adresse des Containers selbst, oder der Port ist nur auf `127.0.0.1` veröffentlicht. Zuverlässig ist ein gemeinsames Podman-Netzwerk:

1. `podmanmanager.network` nach `~/.config/containers/systemd/` kopieren.
2. In **beiden** `.container`-Dateien die Zeile `# Network=podmanmanager.network` auskommentieren (also `Network=podmanmanager.network`).
3. `systemctl --user daemon-reload && systemctl --user restart podmanmanager-agent podmanmanager-master`
4. Im Master unter *Hosts* `http://podmanmanager-agent:9126` und den Token eintragen.

**Kurzfassung für schon vorhandene Quadlets (ohne Netzwerk-Zeilen):**
```bash
cd ~/.config/containers/systemd/
printf '[Network]\n' > podmanmanager.network
sed -i '/^\[Container\]/a Network=podmanmanager.network' podmanmanager-master.container podmanmanager-agent.container
systemctl --user daemon-reload
systemctl --user restart podmanmanager-agent podmanmanager-master
```

**Kontrolle** (alle drei müssen stimmen):
```bash
grep -n Network ~/.config/containers/systemd/podmanmanager-*.container   # beide: Network=podmanmanager.network (ohne #)
podman network ls                                                         # zeigt systemd-podmanmanager
podman exec podmanmanager-master getent hosts podmanmanager-agent         # liefert eine IP, meist 10.89.x.x
```
Zeigt `podman network ls` nur `podman`, ist das Netzwerk nie angelegt worden: die Datei `podmanmanager.network` fehlt oder die `Network=`-Zeilen sind nicht aktiv. Ohne gemeinsames Netzwerk endet die Registrierung mit `Agent not reachable (EAI_AGAIN)` (der Name ist nicht auflösbar).

`PublishPort` am Agent ist dann nur für Master auf **anderen** Hosts nötig. Alternative ohne Netzwerk: im Master `http://host.containers.internal:9126` eintragen (der Agent-Port muss dazu auf einer erreichbaren Adresse veröffentlicht sein). Diagnose: `podman port podmanmanager-agent`, `ss -ltnp | grep 9126` und vom Master aus
`podman exec podmanmanager-master node -e "fetch('http://<agent>:9126/api/v1/health').then(r=>console.log(r.status)).catch(e=>console.log(e.cause.code))"` (`401` = Verbindung steht).
Das Netzwerk-Beispiel ist auf einem Host mit Master und Agent bestätigt.

## Master hinter einem Firmen-Proxy mit TLS-Inspektion

Der Update-Check im About-Dialog des Masters (und nur er) nutzt `https_proxy`, das Podman vom Host in den Container weiterreicht. Entschlüsselt der Proxy HTTPS (z. B. Cisco WSA), zeigt der Dialog unter der Meldung `SELF_SIGNED_CERT_IN_CHAIN` (oder `UNABLE_TO_VERIFY_LEAF_SIGNATURE`): der Container kennt die Firmen-CA nicht. So gibst du sie ihm:

1. CA-Datei auf dem Host finden (dem Host wird sie schon vertraut) und in dein Verzeichnis kopieren:
   ```bash
   ls /etc/pki/ca-trust/source/anchors/       # RHEL, Rocky, Fedora
   ls /usr/local/share/ca-certificates/       # Debian, Ubuntu
   mkdir -p ~/.config/podmanmanager
   cp /etc/pki/ca-trust/source/anchors/<DATEI>.crt ~/.config/podmanmanager/corp-ca.pem
   head -1 ~/.config/podmanmanager/corp-ca.pem     # muss -----BEGIN CERTIFICATE----- sein
   ```
   Liegt die Datei im DER-Format vor: `openssl x509 -inform der -in <DATEI>.crt -out ~/.config/podmanmanager/corp-ca.pem`.
   Liegt dort nichts, lässt sich die Kette vom Proxy auslesen (sie muss die Wurzel enthalten):
   ```bash
   openssl s_client -connect auth.docker.io:443 -proxy <proxy-host>:<port> -showcerts </dev/null 2>/dev/null \
     | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' > ~/.config/podmanmanager/corp-ca.pem
   ```
2. Im Master-Quadlet die beiden Zeilen unter `[Container]` aktivieren (in `podmanmanager-master.container` stehen sie auskommentiert):
   ```ini
   Volume=%h/.config/podmanmanager/corp-ca.pem:/etc/corp-ca.pem:ro,Z
   Environment=NODE_EXTRA_CA_CERTS=/etc/corp-ca.pem
   ```
3. `systemctl --user daemon-reload && systemctl --user restart podmanmanager-master`, danach den About-Dialog öffnen.

`NODE_EXTRA_CA_CERTS` **ergänzt** die normalen Zertifikate. Die CA gilt für alle ausgehenden TLS-Verbindungen des Masters (auch LDAPS ohne eigene CA). Nur eine CA eintragen, der du vertraust: sie erlaubt dem Proxy, den HTTPS-Verkehr des Masters zu lesen. Kontrolle der Proxy-Variablen: `podman exec podmanmanager-master printenv | grep -i proxy`. **Bestätigt** auf einem echten Host hinter einem WSA-Proxy mit TLS-Inspektion: Nach dem Einbinden der Firmen-CA funktioniert der Update-Check. Auf anderen Systemen (anderes Betriebssystem, anderer Proxy) können Pfade und Dateiformat der CA abweichen.

## Beide: Start ohne Login

```bash
sudo loginctl enable-linger $USER
```

## Agent per Web-UI aktualisieren

In der Host-Ansicht erscheint bei Agenten, die älter als der Master sind, das Label „veraltet“ und (nur für Admins) ein Button „Aktualisieren“. Der Agent zieht dann sein eigenes Image neu und beendet sich; systemd (`Restart=always`) erstellt den Container aus dem neuen Image.

Voraussetzungen: Agent per Quadlet mit `Restart=always`, Image-Tag `:latest` (oder `X` / `X.Y`), nicht fest auf `X.Y.Z` gepinnt. Der Host-Podman muss Docker Hub erreichen (ggf. Proxy). Agenten bis 0.9.2 haben diese Funktion noch nicht und müssen einmalig manuell aktualisiert werden (`podman pull …:latest && systemctl --user restart podmanmanager-agent`).

## Master per Web-UI aktualisieren

Läuft auf dem Master-Host ein Agent, kann der Master über „Über“ → „Jetzt aktualisieren“ (nur Admins, nur wenn eine neuere Version existiert) aktualisiert werden. Der Master selbst hat keinen Podman-Zugriff: der Agent zieht das Master-Image neu und stoppt den Master-Container, systemd (`Restart=always`) erstellt ihn aus dem neuen Image. Die Seite lädt nach dem Neustart selbst neu (Master ca. 30–60 s nicht erreichbar).

Einrichtung im Agent-Quadlet: `Environment=UPDATE_UNIT=podmanmanager-master` (Name der Master-Unit ohne `.service`). Der Master muss per Quadlet mit `:latest` (oder `X` / `X.Y`) laufen. Der Agent muss selbst mindestens v0.11.0 sein (Update vorher per Host-Ansicht).

## Hinweise

- **cgroup v1** (`podman info --format '{{.Host.CgroupsVersion}}'` zeigt `v1`): Die Units scheitern mit Exit-Code 126 und `mkdir /sys/fs/cgroup/…: permission denied`. Abhilfe: `PodmanArgs=--cgroups=enabled` im `[Container]`-Abschnitt (siehe [deployment/README.md](../README.md#hosts-mit-cgroup-v1-quadlet)). Bestätigt auf einem echten Host mit Podman 4.9.4.
- **Aktivierung:** Quadlet-Units lassen sich nicht mit `enable` aktivieren; `[Install]` wirkt automatisch nach `daemon-reload`.
- **Secrets** liegen standardmäßig im Dateitreiber (Base64, nur durch Dateirechte geschützt). Das hält sie aus Unit-Dateien und `podman inspect` heraus, ist aber keine Verschlüsselung.
- **Updates:** Mit festem Tag bleibt die Version stabil (der About-Dialog des Masters meldet neue Versionen). `AutoUpdate=registry` braucht `:latest` und `systemctl --user enable --now podman-auto-update.timer`.
- **Hostname:** `HostName=%H` im Agent-Quadlet sorgt dafür, dass der Master den Rechnernamen statt der Container-ID anzeigt (der Agent meldet den Hostnamen, den er im Container sieht).
- **Agent sieht sich selbst:** Er verwaltet alle Container des Benutzers, auch den eigenen Agent-Container; ein Stopp über die Oberfläche setzt den Host offline (`Restart=always` startet ihn wieder).
- **Agent: `NoNewPrivileges`/`DropCapability=ALL`** sind ungetestet; bei Fehlern diese Zeilen zuerst entfernen. **`SecurityLabelDisable=true`** ist nur auf SELinux-Hosts nötig.
- Die native Installation des Agents (`deployment/agent/install.sh`) bleibt einfacher und robuster, da sie ohne Socket-Mount und UID-Mapping auskommt.
- Systemweit statt rootless (`/etc/containers/systemd/`, `systemctl` ohne `--user`) ginge auch, widerspricht beim Agent aber dem Rootless-Prinzip.
