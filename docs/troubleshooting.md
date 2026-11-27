# Troubleshooting

## Agent
| Symptom | Ursache / Lösung |
|---|---|
| Health: `socketStatus: missing` | Socket fehlt. `systemctl --user enable --now podman.socket`; Pfad: `ls $XDG_RUNTIME_DIR/podman/podman.sock`. Ggf. `PODMAN_SOCKET` als Umgebungsvariable des Agent-Containers setzen. |
| `unreachable` | Socket gehört einem anderen Benutzer/Rechte. Agent muss unter demselben Benutzer wie Podman laufen. |
| `apiStatus: error`, „Podman returned HTTP 404“ | Agent-Version ≤ 0.3.0 nutzt unversionierte libpod-Pfade, die Podman ablehnt → auf eine neuere Agent-Version aktualisieren (Image/Build ≥ der Version mit dem Fix). |
| `apiStatus: error` | Podman antwortet fehlerhaft. `podman info`, `journalctl --user -u podman.socket`, Podman-Version prüfen. |
| Agent startet nicht: „Refusing to run as root" | Als normaler Benutzer starten. |
| „PODMAN_SOCKET not set and XDG_RUNTIME_DIR unavailable" | Außerhalb einer Benutzersitzung gestartet. Als User-Service laufen lassen oder `PODMAN_SOCKET` absolut setzen. |
| Quadlet-Unit scheitert mit Exit-Code 126, Journal: `Error: mkdir /sys/fs/cgroup/pids/user.slice/…/runtime: permission denied` (oder `could not find cgroup mount`) | Der Host nutzt **cgroup v1** (Prüfung: `podman info --format '{{.Host.CgroupsVersion}} {{.Host.CgroupManager}} {{.Host.OCIRuntime.Name}}'` → `v1 cgroupfs runc`). Quadlet startet Container mit `--cgroups=split`; das darf ein Rootless-Benutzer auf cgroup v1 nicht anlegen. Im `[Container]`-Abschnitt der Unit `PodmanArgs=--cgroups=enabled` ergänzen (gilt für Agent und Master; der spätere Wert überschreibt `split`), dann `systemctl --user daemon-reload && systemctl --user reset-failed <unit> && systemctl --user start <unit>`. `--cgroups=disabled` hilft nicht, wenn die Laufzeit `runc` ist ("not compatible with NoCgroups"). Alternative: Host auf cgroup v2 umstellen. `podman run` ohne `--cgroups`-Option ist nicht betroffen. |
| Host-Tabelle, Spalte „Speicher“ zeigt „—“ mit Fehler, z. B. `lstat …/volumes/<id>/_data: no such file or directory` (Agent-Log: `podman error PODMAN_API_ERROR on GET /api/v1/system/storage (Podman HTTP 500): …`) | Podmans `system df` bricht als Ganzes ab, wenn das Datenverzeichnis eines Volumes fehlt. Auf dem Host prüfen: `podman system df` zeigt denselben Fehler. Das Volume suchen (`podman volume ls`, `podman volume inspect <id>`), prüfen, ob ein Container es nutzt (`podman ps -a --filter volume=<id>`), und das kaputte Volume entfernen (`podman volume rm <id>`; das Datenverzeichnis existiert nicht mehr, es gehen keine Daten verloren). Danach zeigt die Spalte wieder Werte. Andere Fehlermeldungen: Text aus der Meldung folgen (z. B. Rechte oder beschädigter Speicher). |
| Agent nach Reboot nicht aktiv | Lingering fehlt: `sudo loginctl enable-linger <benutzer>`. |
| `EADDRINUSE` | Port 9126 belegt → `AGENT_PORT` ändern (und im Master neu registrieren). |
| 401 | Falscher Token, oder `AGENT_TOKEN_HASH` passt nicht zum Token. |
| 429 | Zu viele Fehlversuche von der Master-IP; nach 1 Minute erneut, Token prüfen. |
| Logs | `journalctl --user -u podmanmanager-agent -f` |

## Master
| Symptom | Lösung |
|---|---|
| „MASTER_SECRET_KEY must be 32 bytes" | Schlüssel setzen: `openssl rand -base64 32`. |
| Hinter Reverse-Proxy: „Application error“ beim Anmelden/Speichern; Master-Log: `Invalid Server Actions request` | Der Proxy reicht den Host nicht durch (Origin ≠ Host). `Host` und `X-Forwarded-Host` im Proxy setzen oder `ALLOWED_ORIGINS=<öffentlicher Host>` im Master setzen, siehe [Master-Installation](installation-master.md). |
| About: `SELF_SIGNED_CERT_IN_CHAIN` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Der Proxy entschlüsselt HTTPS mit einer Firmen-CA, die der Master nicht kennt. CA als PEM bereitstellen und `NODE_EXTRA_CA_CERTS` setzen, siehe [Master-Installation](installation-master.md) und `deployment/quadlet/README.md`. |
| About: „Update check unavailable“ | Die Ursache steht im Dialog (z. B. `registry: ECONNREFUSED, hub: ECONNREFUSED`). Hinter einem Firmen-Proxy: `https_proxy` im Container prüfen (`podman exec podmanmanager-master printenv \| grep -i proxy`); Podman reicht die Host-Variablen weiter. Sonst `auth.docker.io` und `registry-1.docker.io` (oder `hub.docker.com`) auf Port 443 freigeben, siehe [Master-Installation](installation-master.md). `UPDATE_CHECK=off` schaltet die Prüfung ab. |
| SSO-Anmeldung schlägt fehl oder „Ihr Konto gehört zu keiner Gruppe“ | Der Grund steht im Master-Log (`saml login failed: …` / `saml login denied: …`). Tabelle mit Ursachen und Lösungen in [SSO mit SAML 2.0](sso.md#fehlersuche). |
| Host `offline` | Agent läuft? Firewall (9126 für Master-IP)? `curl -H "Authorization: Bearer …" http://<ip>:9126/api/v1/health` vom Master aus. Die letzte Fehlermeldung steht in der Hostliste. |
| Host `degraded` | Agent ok, Podman-Problem auf dem Host (siehe oben). |
| „Agent not reachable (ECONNREFUSED)“ | Der Master erreicht die Adresse, aber dort lauscht nichts: falscher Port, Agent läuft nicht, oder der Port ist nur an `127.0.0.1` veröffentlicht (`PublishPort=`). |
| „Agent not reachable (EAI_AGAIN)“ | Die Namensauflösung bekommt keine Antwort. Bei Quadlets mit Adresse `http://podmanmanager-agent:9126`: das gemeinsame Netzwerk fehlt oder ist nicht aktiv (`podman network ls` muss `systemd-podmanmanager` zeigen), siehe `deployment/quadlet/README.md`. Sonst: DNS des Masters prüfen. |
| „Agent not reachable (ENOTFOUND)“ | Der Hostname ist vom Master aus nicht auflösbar (bei einem Master im Container: DNS im Container). IP-Adresse verwenden. |
| „Agent not reachable (EHOSTUNREACH / ETIMEDOUT)“ | Firewall oder Routing: Port 9126 auf dem Agent-Host für die Master-IP freigeben (`firewall-cmd`/`ufw`). Test vom Master aus: `podman exec podmanmanager-master node -e "fetch('http://<agent>:9126/api/v1/health').then(r=>console.log(r.status)).catch(e=>console.log(e.cause))"` (Status 401 heißt: Verbindung steht, Token fehlt). |
| Agent nicht hinzufügbar | Adresse muss `http://host:port` sein; Token korrekt; Host darf nicht schon registriert sein (Adresse oder Agent-ID). |
| Nach Schlüsselverlust: Fehler „Cannot read agent credentials" | Hosts entfernen und neu registrieren. |
| Zugriff verweigert nach Stop/Restart | Aktion ist nur bei erreichbarem, aktiviertem Host möglich. |
| Port 8080 belegt | `MASTER_PORT` ändern. |
| Admin-Passwort vergessen | `sudo -u podmanmanager node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/var/lib/podmanmanager/master.db');d.exec('DELETE FROM admin; DELETE FROM sessions')"` – danach sofort `/setup` aufrufen. |
| LDAP-Test: „Cannot connect to the LDAP server" | Host/Port/Firewall prüfen (389 bzw. 636 vom Master aus: `nc -vz dc.example.com 636`), DNS auflösbar? |
| LDAP-Test: „TLS error (certificate not trusted?)" | Zertifikat des DC nicht vertraut → CA-Zertifikat (PEM) im Feld eintragen; Hostname in der URL muss zum Zertifikat passen (kein IP-Adresse, falls nur DNS-Name im Zertifikat). |
| „Service account bind failed" | Dienstkonto-DN/UPN oder Passwort falsch, Konto gesperrt/abgelaufen. |
| LDAP-Benutzer wird abgewiesen („Invalid username or password") | Mit *Test connection* + Testbenutzer prüfen: Benutzer gefunden? Mitglied der Gruppe (nicht nur primäre Gruppe)? Filter/Suchbasis passend? Passwort korrekt, Konto aktiv? |
| Anmeldung mit dem lokalen Konto schlägt fehl | Der Master-Log (*Einstellungen → Logs*) nennt es: `local login denied: wrong password for "admin"` (falsches Passwort), `login denied: unknown user (only the local account exists, LDAP login is not enabled)` (anderer Name, LDAP nicht eingeschaltet; der eingetippte Name wird nie geloggt), `login blocked for 60 s after 5 failed attempts` (fünf Fehlversuche mit demselben Namen sperren ihn eine Minute, auch mit richtigem Passwort; die Meldung erscheint einmal pro Sperre). |
| LDAP-Anmeldung im Master-Log (*Einstellungen → Logs*) | `ldap login denied: Max Mustermann (MustermannM): not in the administrators group or in a group assigned to an agent group (no access)`: Der Benutzer wurde im Verzeichnis gefunden (Name aus dem Verzeichnis), ist aber in keiner Gruppe der Administratoren oder einer Agent-Gruppe → Gruppenzuordnung bzw. Gruppenprüfung prüfen. `ldap login denied: unknown user or wrong password`: Benutzer unbekannt oder Passwort falsch (der eingetippte Name wird dabei bewusst nicht geloggt, weil dort manchmal ein Passwort steht). `ldap login failed: directory unavailable (LDAP_CONNECT)`: Verzeichnis nicht erreichbar, Code siehe LDAP-Test. |
| AD-Benutzer meldet sich an, sieht aber keine Hosts | Die AD-Gruppe ist keiner Agent-Gruppe mit Agents zugeordnet oder die Gruppe enthält keine Agents. Mit *Test connection* + Testbenutzer prüfen („Access: …“); Zuordnung unter *Settings → Agent groups*. |
| Benutzer sollte Zugriff haben, hat aber keinen | Die AD-Mitgliedschaft wird bei der Anmeldung geprüft: einmal abmelden und neu anmelden. Verschachtelte Gruppen zählen, die primäre Gruppe („Domain Users“) nicht. |
| „Directory login is currently unavailable" | Verzeichnis nicht erreichbar oder Dienstkonto defekt; Anmeldung als lokaler `admin` bleibt möglich. |
| Warnung „SQLite is an experimental feature" | Harmlos (Node 24). |
| Logs | `journalctl -u podmanmanager-master -f` |

## Container und Pods erstellen

| Symptom | Ursache und Lösung |
|---|---|
| „Ein Container mit diesem Namen existiert auf dem Host bereits“ | Der Name ist auf dem Host vergeben (Podman 5 meldet das mit HTTP 500, der Agent übersetzt es). Anderen Namen wählen oder den vorhandenen Container entfernen. Dazu muss der Agent mindestens v0.31.1 sein. |
| Die Pod-Spalte oder Kube-YAML fehlt in der Konfiguration eines Containers im Pod | Podman 5 liefert im Inspect nur die Pod-ID. Agent auf v0.31.1 oder neuer aktualisieren (löst den Namen aus der Pod-Liste auf). |
| „Container erstellen“ oder die Konfiguration funktioniert nicht, der Master meldet 404 | Der Agent ist älter als v0.31.0 und kennt die Routen nicht. Agent aktualisieren (Hosts → *Agent aktualisieren*). |
| Das Speicherlimit eines erstellten Containers wirkt nicht (`podman inspect <name> --format '{{.HostConfig.Memory}}'` zeigt `0`) | Der Host nutzt **cgroup v1** (Prüfung: `podman info --format '{{.Host.CgroupsVersion}}'` → `v1`) mit rootless Podman: Dort darf ein Benutzer keine Limits setzen, Podman ignoriert sie (Hinweis im Journal bzw. „Hinweise von Podman“). Der Master zeigt das im Formular an. Abhilfe: Host auf cgroup v2 umstellen (RHEL/Rocky 8: Kernel-Parameter `systemd.unified_cgroup_hierarchy=1`, danach Neustart) und Memory-Delegation für den Benutzer prüfen (`cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.controllers`). Das gilt ebenso für `PodmanArgs=--memory` in Quadlet-Dateien und `resources.limits` im Kube-YAML. |
| Fehler beim Laden des Images | Der Host erreicht die Registry nicht (Proxy, Anmeldung, Name). Das Laden läuft auf dem Host mit dessen Podman; `podman pull <image>` dort probieren. |
| Ein erstellter Container startet nach einem Neustart des Hosts nicht von selbst | Er wird nicht von systemd verwaltet. `podman-restart.service` für den Benutzer aktivieren (`systemctl --user enable --now podman-restart.service`) oder die angezeigte Quadlet-Datei verwenden. |

## Container löschen

| Symptom | Ursache und Lösung |
|---|---|
| Der Knopf „Löschen“ fehlt | Er erscheint nur für Administratoren, bei gestoppten Containern ohne systemd-Label und bei Agents ab dieser Version (ältere liefern das Label nicht). Laufende Container zuerst stoppen. |
| „Der Container wird von systemd/Quadlet verwaltet“ | Der Container trägt das Label `PODMAN_SYSTEMD_UNIT`. Löschen Sie die Quadlet-Datei (oder stoppen und deaktivieren Sie die Unit) und führen Sie `systemctl --user daemon-reload` aus; systemd entfernt den Container dann selbst. |
| „Der Container muss zuerst gestoppt werden“ | Es gibt kein Löschen mit `force`. Erst stoppen, dann löschen. |
| Der Infra-Container eines Pods lässt sich nicht löschen | Er gehört zum Pod. Pods lassen sich in PodmanManager nicht löschen (auf dem Host `podman pod rm`). |

## Pod löschen

| Symptom | Ursache und Lösung |
|---|---|
| Der Knopf „Löschen“ fehlt beim Pod | Er erscheint nur für Administratoren, bei gestoppten Pods (keiner der Container läuft), ohne systemd-Label am Pod und an seinen Containern und bei Agents ab dieser Version. |
| „Der Pod wird von systemd/Quadlet verwaltet“ | Der Pod oder einer seiner Container trägt das Label `PODMAN_SYSTEMD_UNIT`. Entfernen Sie die zugehörigen Quadlet-Dateien (`.pod` und `.container`), danach `systemctl --user daemon-reload`. |
| „Der Pod muss zuerst gestoppt werden“ | Es gibt kein Löschen mit `force`. Den Pod zuerst stoppen. |
| Container sind nach dem Löschen des Pods weg | Gewollt: `podman pod rm` entfernt den Pod mit allen Containern. Die Rückfrage nennt sie vorher. Volumes bleiben erhalten. |

## Befehle in Containern ausführen

| Symptom | Ursache und Lösung |
|---|---|
| Der Bereich „Befehl ausführen“ fehlt | Er erscheint nur für Administratoren, bei laufenden Containern und auf Hosts, deren Agent `EXEC_ENABLED=true` hat (Quadlet oder `-e`, danach Agent neu starten). Für den lokalen Host des Masters gilt `EXEC_ENABLED` in der Umgebung des Masters. |
| „Befehle ausführen ist auf diesem Host ausgeschaltet“ | Der Agent wurde ohne `EXEC_ENABLED` gestartet oder neu gestartet. |
| „Dieses Programm steht nicht in der Liste der erlaubten Programme“ | `EXEC_ALLOW` am Agent erlaubt nur die genannten Programme (genauer Vergleich mit dem ersten Argument, also `ls`, nicht `/bin/ls`). |
| „The container is not running“ | Befehle laufen nur in laufenden Containern. |
| Der Befehl endet mit „am Zeitlimit abgebrochen“ | Zeitlimit höher stellen (höchstens 60 s). Langlaufende oder interaktive Programme (`top`, `vim`, Shells) sind nicht vorgesehen. |
| „executable file not found“ (Exit-Code 127) | Das Programm gibt es im Image nicht; viele schlanke Images haben keine Shell. Den Befehl als Argumente ohne Shell-Funktionen schreiben (keine Pipes, keine Variablen). |

## Update per Web-UI

| Meldung / Symptom | Ursache und Abhilfe |
|---|---|
| Kein „Aktualisieren“-Button bei einem Agent | Agent ist nicht älter als der Master, oder Sie sind kein Admin. |
| „zu alt für Remote-Updates“ | Agent ≤ 0.9.2: einmalig manuell `podman pull …:latest && systemctl --user restart podmanmanager-agent`. |
| „fest gepinnter Image-Tag“ | Im Quadlet `Image=…:latest` (oder `X` / `X.Y`) statt `X.Y.Z` verwenden. |
| „nicht von systemd/Quadlet verwaltet“ | Agent per Quadlet mit `Restart=always` starten; mit `podman run` kann er sich nicht selbst neu starten. |
| „Jetzt aktualisieren“ fehlt in „Über“ | Auf dem Master-Host muss ein Agent ≥ 0.11.0 mit `Environment=UPDATE_UNIT=podmanmanager-master` laufen (`daemon-reload`, Agent neu starten). |
| Update startet, nichts ändert sich | Der Pull fand kein neues Image („Already up to date“) oder der Host-Podman erreicht Docker Hub nicht; Agent-Log in der Host-Ansicht prüfen. |

## Container neu starten

| Meldung / Symptom | Ursache und Abhilfe |
|---|---|
| „Failed to bind port … (Address already in use)“ beim Neustart eines Containers, der per Quadlet läuft | Quadlet startet Container mit `--rm`; systemd erzeugt sie sofort neu und belegt den Port, während Podman denselben Container noch neu starten will. Ab v0.24.1 stoppt der Agent solche Container nur und wartet, bis systemd sie wieder gestartet hat. |
| „Gestoppt, aber systemd hat die Unit nicht neu gestartet (Restart= fehlt?)“ | Die Unit hat kein `Restart=always` (oder `on-failure` greift bei einem sauberen Stopp nicht). Im Quadlet unter `[Service]` `Restart=always` ergänzen. Bis dahin: `systemctl --user start <unit>.service` als Container-Benutzer. |

## Diagnose
```bash
curl -s -H "Authorization: Bearer $TOKEN" http://<agent>:9126/api/v1/containers
ss -ltnp | grep -E '8080|9126'
```
