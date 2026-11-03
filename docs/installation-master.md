# Master installieren

Voraussetzungen: Linux, Node.js ≥ 24 (wegen `node:sqlite`; beim Start erscheint eine harmlose Warnung „SQLite is an experimental feature"), npm, root für systemd.

## Build
```bash
sudo mkdir -p /opt/podmanmanager && sudo chown "$USER" /opt/podmanmanager
git clone <repo> /opt/podmanmanager && cd /opt/podmanmanager
npm ci
MASTER_SECRET_KEY=build-only npm run build -w apps/master
```

## Konfiguration
Vorlage: `deployment/master/master.env.example`.

| Variable | Standard | Bedeutung |
|---|---|---|
| `MASTER_HOST` | `0.0.0.0` | Bind-Adresse |
| `MASTER_PORT` | `8080` | HTTP-Port |
| `DATABASE_URL` | `file:./data/master.db` | SQLite-Datei (PostgreSQL wird nicht unterstützt) |
| `MASTER_SECRET_KEY` | **Pflicht** | 32 Byte (base64 oder 64 Hex), verschlüsselt die Agent-Tokens. `openssl rand -base64 32` |
| `HEARTBEAT_INTERVAL` | `30` | Sekunden (5–3600) |
| `AGENT_TIMEOUT` | `5` | Sekunden (1–60) |
| `HEARTBEAT_FAILURES` | `3` | Fehlschläge bis `offline` |

**`MASTER_SECRET_KEY` sichern.** Geht er verloren, sind die gespeicherten Agent-Tokens unlesbar und Agents müssen neu registriert werden. Er darf nicht ins Git.

## Als systemd-Dienst
```bash
sudo useradd --system --home /var/lib/podmanmanager --shell /usr/sbin/nologin podmanmanager
sudo install -d -m 750 -o root -g podmanmanager /etc/podmanmanager
sudo install -m 640 -g podmanmanager deployment/master/master.env.example /etc/podmanmanager/master.env
sudoedit /etc/podmanmanager/master.env        # MASTER_SECRET_KEY setzen
sudo chown -R root:podmanmanager /opt/podmanmanager && sudo chmod -R g+rX /opt/podmanmanager
sudo cp deployment/master/podmanmanager-master.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now podmanmanager-master
journalctl -u podmanmanager-master -f
```
Der Dienst benötigt keinen Podman-Zugriff. Die Datenbank (`/var/lib/podmanmanager/master.db`) wird beim ersten Start automatisch angelegt (Schema wird per `CREATE TABLE IF NOT EXISTS` initialisiert).

## Manueller Start
`deployment/master/start.sh [env-datei]` (oder Variablen setzen). Ändere den Port über `MASTER_PORT`.

## Erster Start
`http://<master>:8080` öffnen → Passwort für das lokale Konto **`admin`** anlegen (mind. 10 Zeichen). Anmeldung danach mit Benutzername `admin`. **Direkt nach dem Start setzen:** solange kein Passwort existiert, kann es jeder mit Netzwerkzugriff anlegen. Danach unter **Hosts** die Agents hinzufügen (Adresse `http://<ip>:9126` + Token des Agents).

## LDAP / Active Directory (optional)
Unter **Settings → LDAP / Active Directory login** (nur als lokaler `admin` sichtbar) können Mitglieder einer AD-Gruppe zur Anmeldung berechtigt werden. Berechtigte Benutzer haben dieselben Rechte wie `admin`, **außer** Passwort- und LDAP-Einstellungen zu ändern. Das lokale Konto `admin` bleibt als Notzugang immer aktiv (ein AD-Benutzer namens `admin` kann sich deshalb nicht per LDAP anmelden).

| Feld | Beispiel |
|---|---|
| Server URL | `ldaps://dc.example.com:636` (empfohlen) oder `ldap://dc.example.com` + *StartTLS* |
| CA-Zertifikat (PEM) | Nur nötig, wenn das Zertifikat des Domain Controllers nicht von einer öffentlich/systemweit vertrauten CA stammt (interne CA). Mehrere Zertifikate hintereinander sind erlaubt. |
| Dienstkonto | `CN=svc-podman,OU=Service,DC=example,DC=com` oder `svc-podman@example.com` – ein normales Domänenkonto mit Leserechten genügt |
| Passwort Dienstkonto | wird mit `MASTER_SECRET_KEY` verschlüsselt gespeichert; leer lassen = bisheriges behalten |
| Suchbasis | `DC=example,DC=com` (oder eine OU) |
| Benutzerfilter | Standard: `(&(objectClass=user)(objectCategory=person)(\|(sAMAccountName={username})(userPrincipalName={username})))` – Anmeldung mit `jdoe` oder `jdoe@example.com`; `{username}` wird ersetzt |
| Erforderliche Gruppe (DN) | `CN=PodmanManager,OU=Groups,DC=example,DC=com` |

Ablauf der Anmeldung: Dienstkonto bindet → Benutzer per Filter suchen (genau 1 Treffer) → Gruppenmitgliedschaft prüfen (**inkl. verschachtelter Gruppen**, AD-Regel `1.2.840.113556.1.4.1941`) → Passwort per Bind als Benutzer prüfen. Leere Passwörter werden abgewiesen.

**Vor dem Aktivieren** mit *Test connection* prüfen (optional mit Testbenutzer): Dienstkonto-Bind, Gruppe vorhanden, Benutzer gefunden und Mitglied. Der Test prüft kein Benutzerpasswort. Speichern ändert nichts an bestehenden Sitzungen.

Hinweise:
- Die **primäre Gruppe** (meist „Domain Users") steht nicht in `memberOf`; als Gruppe daher eine normale Sicherheitsgruppe wählen.
- Gruppenänderungen wirken bei der **nächsten Anmeldung**; bereits angemeldete Benutzer behalten ihre Sitzung bis zu 8 Stunden.
- Deaktivierte oder gesperrte AD-Konten werden vom Verzeichnis abgewiesen.
- Ohne `ldaps://`/StartTLS gehen Passwörter unverschlüsselt über das Netz (die Oberfläche warnt).
- Ist das Verzeichnis nicht erreichbar, erscheint „Directory login is currently unavailable"; die lokale Anmeldung bleibt möglich.

## Firewall
Port 8080 nur für berechtigte Netze freigeben, nie ins Internet (siehe [Sicherheit](security.md)).

## Update / Backup
Update: `git pull && npm ci && npm run build -w apps/master && sudo systemctl restart podmanmanager-master`.
Backup: `master.db` (+ `-wal`/`-shm`) und `MASTER_SECRET_KEY`.
