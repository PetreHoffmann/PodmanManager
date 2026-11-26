# Quadlets (Podman + systemd)

Beispiele, um Master und Agent als **rootless Quadlet** zu betreiben. **Bestätigt** auf einem echten Host mit Rootless-Podman 5.8.2: Agent- und Master-Unit starten, im gemeinsamen Netzwerk (`podmanmanager.network`) löst der Master `podmanmanager-agent` auf, die Registrierung (`http://podmanmanager-agent:9126`) gelingt, der Host ist online, und Containerliste sowie Start/Stop/Restart über den Master funktionieren. **Nicht bestätigt:** `NoNewPrivileges`/`DropCapability=ALL` in allen Umgebungen sowie Setups mit Master und Agent auf verschiedenen Hosts. Bei Problemen zuerst `podman-system-generator --user --dryrun` und `journalctl --user -u <unit>` prüfen.

| Datei | Zweck |
|---|---|
| `podmanmanager-master.container` | Master (Web-UI, Port 8080) |
| `podmanmanager-data.volume` | Volume für die Master-Datenbank |
| `podmanmanager-agent.container` | Agent (Port 9126, spricht mit dem Rootless-Podman-Socket) |
| `podmanmanager.network` | optional: gemeinsames Netzwerk, wenn Master und Agent auf demselben Host laufen |

**Schritt für Schritt (`podman run` und Quadlet): [deployment/README.md](../README.md).** Ablegen unter `~/.config/containers/systemd/` (rootless). Der Master braucht nur sein Schlüssel-Secret; die **Agent-Datei liefert der Master** (siehe unten).

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

Token und Hash erzeugt der **Master**, auf dem Host muss nichts erzeugt werden:

1. Im Master unter *Hosts* → *Neuen Agent einrichten* **Agent-Adresse** (`http://<host-ip>:9126`) und **Agent-ID** eintragen. Der Master speichert den Token selbst und legt den Host an.
2. Er zeigt die fertige `podmanmanager-agent.container` (Reiter *Komplette Quadlet-Datei*) mit eingetragenem `AGENT_ID` und `AGENT_TOKEN_HASH`. Diese Datei auf dem Host ablegen:

```bash
systemctl --user enable --now podman.socket      # Socket des eigenen Benutzers (einmalig)
# Datei aus dem Master speichern unter ~/.config/containers/systemd/podmanmanager-agent.container
chmod 600 ~/.config/containers/systemd/podmanmanager-agent.container      # der Hash steht in der Datei
systemctl --user daemon-reload
systemctl --user start podmanmanager-agent
```
3. Der Host wird im Master von selbst *online*. Der Block lässt sich unter *Hosts* → *Einrichtung* jederzeit erneut anzeigen.

Die Vorlage in diesem Ordner (`podmanmanager-agent.container`) hat dieselbe Form, mit Platzhaltern für Hash und Agent-ID und mit auskommentierten Optionen (gemeinsames Netzwerk, `UPDATE_UNIT`, cgroup v1, automatische Updates). Der **Hash** ist nicht der Token: Aus ihm lässt sich der Token nicht zurückrechnen, und mit dem Hash allein kann man sich nicht beim Agent anmelden. Er steht als `Environment=AGENT_TOKEN_HASH=…` in der Datei; mit `chmod 600` ist er für andere Benutzer nicht lesbar (in `podman inspect` ist er sichtbar).

**Token erneuern:** im Master *Hosts* → *Einrichtung* → *Token erneuern*, den neuen Hash in `AGENT_TOKEN_HASH=` der Datei eintragen und `systemctl --user daemon-reload && systemctl --user restart podmanmanager-agent` ausführen (die Umgebung wird nur beim Containerstart gelesen). Bis dahin steht der Host auf *offline*.

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
- **Quadlet kennt nicht jeden Podman-Schalter (der Dienst verschwindet nach `daemon-reload`):** Der Quadlet-Generator hängt an der Podman-Version. Kennt er einen Schlüssel im `[Container]`-Abschnitt nicht, überspringt er die **ganze Datei**: Es entsteht kein Dienst, und `systemctl` zeigt keinen Fehler.
  - **Bekannt:** `Memory=` und `PidsLimit=` kennt Quadlet 5.8 (in 4.9.3 fehlt `Memory=`). `MemoryReservation=` kennt auch 5.8 nicht.
  - **Abhilfe für alles, was fehlt:** Podman-Argumente über `PodmanArgs=` weitergeben, das geht in jeder Version, zum Beispiel `PodmanArgs=--memory=512m --memory-reservation=256m --pids-limit=200`.
  - **Fehler finden:** Der Generator nennt ihn selbst: `/usr/libexec/podman/quadlet -dryrun -user 2>&1 | grep -iE "unsupported|error|invalid"` (typisch: `unsupported key 'MemoryReservation' in group 'Container'`). Ohne Filter besser das Ende ansehen (`tail`), denn `head` zeigt nur die ersten Dateien.
  - **Kommentare** gehören in eine **eigene Zeile**, nicht hinter einen Wert (`Memory=512m # …` ist ungültig).
  - **Kontrolle:** `podman stats --no-stream <name>` zeigt in der Spalte `MEM USAGE / LIMIT`, ob das Limit greift. Bei rootless Podman braucht ein Speicherlimit cgroup v2 mit freigegebenem `memory`-Controller (Rocky/RHEL 9: standardmäßig der Fall).
- **Aktivierung:** Quadlet-Units lassen sich nicht mit `enable` aktivieren; `[Install]` wirkt automatisch nach `daemon-reload`.
- **Secrets** liegen standardmäßig im Dateitreiber (Base64, nur durch Dateirechte geschützt). Das hält sie aus Unit-Dateien und `podman inspect` heraus, ist aber keine Verschlüsselung.
- **Updates:** Mit `:latest` bekommt der Host beim nächsten Pull die neueste Version (der About-Dialog des Masters meldet neue Versionen). Wer die Version festhalten will, trägt `X.Y.Z` ein; dann sind Ein-Klick-Updates nicht möglich. `AutoUpdate=registry` braucht `:latest` und `systemctl --user enable --now podman-auto-update.timer`.
- **Hostname:** `HostName=%H` im Agent-Quadlet sorgt dafür, dass der Master den Rechnernamen statt der Container-ID anzeigt (der Agent meldet den Hostnamen, den er im Container sieht).
- **Agent sieht sich selbst:** Er verwaltet alle Container des Benutzers, auch den eigenen Agent-Container; ein Stopp über die Oberfläche setzt den Host offline (`Restart=always` startet ihn wieder).
- **Agent: `NoNewPrivileges`/`DropCapability=ALL`** sind ungetestet; bei Fehlern diese Zeilen zuerst entfernen. **`SecurityLabelDisable=true`** ist nur auf SELinux-Hosts nötig.
- Systemweit statt rootless (`/etc/containers/systemd/`, `systemctl` ohne `--user`) ginge auch, widerspricht beim Agent aber dem Rootless-Prinzip.
