# Master installieren

Voraussetzungen: Linux, Node.js ≥ 22.13 (wegen `node:sqlite`; beim Start erscheint eine harmlose Warnung „SQLite is an experimental feature"), npm, root für systemd.

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
`http://<master>:8080` öffnen → Admin-Passwort anlegen (mind. 10 Zeichen). **Direkt nach dem Start setzen:** solange kein Passwort existiert, kann es jeder mit Netzwerkzugriff anlegen. Danach unter **Hosts** die Agents hinzufügen (Adresse `http://<ip>:9126` + Token des Agents).

## Firewall
Port 8080 nur für berechtigte Netze freigeben, nie ins Internet (siehe [Sicherheit](security.md)).

## Update / Backup
Update: `git pull && npm ci && npm run build -w apps/master && sudo systemctl restart podmanmanager-master`.
Backup: `master.db` (+ `-wal`/`-shm`) und `MASTER_SECRET_KEY`.
