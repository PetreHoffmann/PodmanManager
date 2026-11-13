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
| `UPDATE_CHECK` | `on` | `off` schaltet die Update-Prüfung im *About*-Dialog ab (siehe unten) |
| `UPDATE_CHECK_REPO` | `petrecalinoiu/podmanmanager-master` | Docker-Hub-Repository, in dem nach neueren Versionen gesucht wird (nur für eigene Forks nötig) |
| `APP_VERSION` | aus dem Image | wird beim Image-Build aus dem Git-Tag gesetzt; ohne Angabe gilt die Version aus `package.json` |

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

## Als Podman-Quadlet (Container, rootless)
Beispiel-Units und Anleitung (Secret für `MASTER_SECRET_KEY`, Volume, Start ohne Login) liegen in [`deployment/quadlet/`](../deployment/quadlet/README.md).

## Manueller Start
`deployment/master/start.sh [env-datei]` (oder Variablen setzen). Ändere den Port über `MASTER_PORT`.

## Hinter einem Reverse-Proxy
TLS, eigene Domain und Zugriffsschutz lassen sich einem Reverse-Proxy (nginx, Apache, Traefik, Caddy, HAProxy) überlassen; der Master selbst bleibt HTTP. Der Proxy muss den **ursprünglichen Host** weiterreichen, sonst lehnt der CSRF-Schutz von Next.js jede Formular-Aktion (Anmelden, Hosts, Container) ab: die Seite zeigt „Application error“ und das Master-Log meldet `x-forwarded-host header … does not match origin header … Invalid Server Actions request`.

**Richtig konfigurieren** (bevorzugt):
```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;                 # bei Port ≠ 80/443 in der öffentlichen URL: $http_host
    proxy_set_header X-Forwarded-Host $host;     # dito
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```
Apache: `ProxyPreserveHost On` und `RequestHeader set X-Forwarded-Proto "https"`. HAProxy: `http-request set-header X-Forwarded-Host %[req.hdr(Host)]`. Traefik und Caddy reichen den Host standardmäßig durch.

**Wenn sich der Proxy nicht ändern lässt:** die öffentliche Adresse(n) im Master freigeben, zur Laufzeit per Umgebungsvariable (kein neuer Build nötig, auch im Docker-Image):

| Variable | Beispiel | |
|---|---|---|
| `ALLOWED_ORIGINS` | `master.example.com,pm.example.org:8443,*.corp.example.com` | Kommagetrennt: Host (mit Port, wenn nicht 80/443) wie im Browser, `*.domain` für Subdomains; `https://master.example.com` ist ebenfalls erlaubt (das Schema wird ignoriert) |

Nur die gelisteten Hosts werden akzeptiert; für alle anderen bleibt der CSRF-Schutz aktiv. Nach dem Ändern den Master neu starten.

## Hilfe und About
In der Navigationsleiste öffnet **Help** das Git-Repository in einem neuen Tab. **About** zeigt einen Dialog mit Name, Version, Ersteller, Copyright (Apache-2.0) und ob auf Docker Hub eine neuere Version verfügbar ist.

Die Update-Prüfung läuft beim Öffnen des Dialogs (nur angemeldet) und fragt die Tags des Docker-Hub-Repositories auf **zwei Wegen gleichzeitig** ab; der erste Treffer gilt:
- **Registry-API** (dieselben Hosts wie `podman pull docker.io/…`): `auth.docker.io` (anonymes Pull-Token) und `registry-1.docker.io` (Tag-Liste);
- **Docker-Hub-Web-API:** `hub.docker.com`.

Es genügt, dass **einer** der beiden Wege erreichbar ist (Port 443). Wenn dein Netz `docker.io`-Pulls erlaubt, aber `hub.docker.com` sperrt, funktioniert der Registry-Weg. Verglichen wird die höchste Version `x.y.z` mit der laufenden; das Ergebnis (auch ein Fehler) wird 5 Minuten zwischengespeichert, mehrere Benutzer teilen sich also eine Abfrage. Es gibt keine Prüfung im Hintergrund, nur beim Öffnen des Dialogs. **Proxy:** Ist in der Umgebung des Masters ein HTTP-Proxy gesetzt (`https_proxy`/`HTTPS_PROXY`, optional `no_proxy`/`NO_PROXY`), läuft die Update-Prüfung automatisch darüber (CONNECT-Tunnel; `http://[user:pass@]proxy:port`, gleiche Schreibweise wie üblich). Podman reicht die Proxy-Variablen des Hosts standardmäßig in Container weiter, ein Eintrag im Quadlet ist dann nicht nötig. **Nur** die Update-Prüfung nutzt den Proxy, nie die Verbindungen zu den Agents. **TLS-Inspektion (Firmenzertifikat):** Entschlüsselt der Proxy HTTPS (z. B. Cisco WSA), zeigt der Dialog `SELF_SIGNED_CERT_IN_CHAIN` oder `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Dann muss der Master die Firmen-CA kennen:
1. Die CA-Datei (PEM) bereitstellen, z. B. vom Host kopieren (`/etc/pki/ca-trust/source/anchors/` bei RHEL, `/usr/local/share/ca-certificates/` bei Debian/Ubuntu) oder die Kette vom Proxy auslesen: `openssl s_client -connect auth.docker.io:443 -proxy <proxy>:<port> -showcerts </dev/null` (die Zertifikate bis zur Wurzel in eine Datei).
2. Die Datei dem Master zugänglich machen und `NODE_EXTRA_CA_CERTS=/pfad/zur/corp-ca.pem` setzen. Bei einem Container: Datei per Volume einbinden. Beispiel (Quadlet): `Volume=%h/.config/podmanmanager/corp-ca.pem:/etc/corp-ca.pem:ro,Z` und `Environment=NODE_EXTRA_CA_CERTS=/etc/corp-ca.pem`; bei `docker run`/`podman run`: `-v /pfad/corp-ca.pem:/etc/corp-ca.pem:ro -e NODE_EXTRA_CA_CERTS=/etc/corp-ca.pem`; beim systemd-Dienst: `NODE_EXTRA_CA_CERTS=…` in `master.env`.
3. Master neu starten.

`NODE_EXTRA_CA_CERTS` ergänzt die normalen Zertifikate und gilt für alle ausgehenden TLS-Verbindungen des Masters (auch LDAPS ohne eigene CA). Nur eine CA eintragen, der du vertraust. Auf einem echten Host hinter einem WSA-Proxy mit TLS-Inspektion bestätigt. Ausführliche Schritte im Quadlet-Fall: [`deployment/quadlet/README.md`](../deployment/quadlet/README.md).

Sind beide Wege gesperrt, zeigt der Dialog „Update check unavailable“ mit der Ursache je Weg, z. B. `registry: ECONNREFUSED, hub: ECONNREFUSED` (`ENOTFOUND` = Name nicht auflösbar, `ETIMEDOUT`/`ECONNREFUSED` = gesperrt oder Proxy nötig, `PROXY_403`/`PROXY_407` = Proxy lehnt ab bzw. verlangt Anmeldung, `UNABLE_TO_VERIFY_LEAF_SIGNATURE` = unbekanntes Zertifikat, `HTTP_429` = Docker Hub drosselt); mit `UPDATE_CHECK=off` findet gar keine Anfrage statt. Es werden keine Daten über die Installation übertragen.

## Eigener Navbar-Text oder Logo (optional)

Unter *Einstellungen* → *Darstellung* (nur Administratoren) lässt sich der Name in der Navigationsleiste ändern:

- **Navbar-Text:** bis zu 40 Zeichen; Leerraum wird zusammengefasst, Steuerzeichen werden entfernt.
- **Logo:** PNG, JPEG, GIF, WebP oder SVG bis 512 KB. Ist ein Logo gesetzt, ersetzt es den Text (der Text dient als Alternativtext). Zu große Bilder werden **skaliert**: Rasterbilder über 512 × 128 Pixel verkleinert der Browser vor dem Hochladen (Seitenverhältnis bleibt, nie vergrößert; ein animiertes GIF wird dabei zum Standbild); in der Leiste selbst wird jedes Logo auf höchstens 32 Pixel Höhe und 224 Pixel Breite eingepasst.
- Ohne Text und ohne Logo erscheint **PodmanManager**. *Auf Standard zurücksetzen* entfernt beides, *Logo entfernen* nur das Logo.

Die Einstellung liegt in der Master-Datenbank (Backup wie sonst) und gilt für alle Benutzer. Auf der Login- und der Setup-Seite bleibt der Standardname.

## SSO mit SAML 2.0 (optional)

Zusätzlich zu LDAP kann die Anmeldung per SAML 2.0 über einen Identitätsanbieter erfolgen (ADFS, Microsoft Entra ID, Okta, Keycloak oder eigener Anbieter; Single Sign-on). Einrichtung unter *Einstellungen → Registerkarte „SAML“*, Schritt für Schritt je Anbieter (ADFS 2022, Entra ID, Okta, Keycloak, eigener) in [SSO mit SAML 2.0](sso.md). Voraussetzung ist eine öffentliche https-Adresse des Masters (Reverse Proxy). Agent-Gruppen bekommen ein Feld *SAML-Gruppe* (z. B. `CORP\Team-A`).

## Erster Start
`http://<master>:8080` öffnen → Passwort für das lokale Konto **`admin`** anlegen (mind. 10 Zeichen). Anmeldung danach mit Benutzername `admin`. **Direkt nach dem Start setzen:** solange kein Passwort existiert, kann es jeder mit Netzwerkzugriff anlegen. Danach unter **Hosts** die Agents hinzufügen (Adresse `http://<ip>:9126` + Token des Agents).

## LDAP / Active Directory (optional)
Unter **Einstellungen → Registerkarte „LDAP“** (nur für Administratoren sichtbar) können AD-Benutzer zur Anmeldung berechtigt werden. Es gibt zwei Arten von Zugriff:

- **Administratoren-Gruppe** (optional, ein AD-Gruppen-DN): Mitglieder sehen und verwalten **alle** Agents und dürfen Hosts hinzufügen/entfernen/aktivieren/testen – aber **keine** Passwort-, LDAP- oder Gruppen-Einstellungen ändern.
- **Agent-Gruppen** (siehe unten): Mitglieder einer zugeordneten AD-Gruppe sehen und bedienen **nur** die Agents ihrer Gruppen.

**Bestätigt:** Die LDAP-Anmeldung funktioniert mit einem echten Active Directory (vom Betreiber getestet). Für Besonderheiten Ihres Verzeichnisses (verschachtelte Gruppen, interne CA, StartTLS) zuerst *Test connection* nutzen.

Bei „Angemeldet als“ (Einstellungen) zeigt der Master LDAP-Benutzern „Anzeigename (Kontoname)“, z. B. „Max Mustermann (MustermannM)“. Beides liest er in derselben Suche, die den Benutzer findet (`displayName`, `sAMAccountName`), eine Änderung im AD ist dafür nicht nötig; fehlt `displayName`, steht nur der Kontoname dort.

Das lokale Konto `admin` bleibt als Notzugang immer aktiv (ein AD-Benutzer namens `admin` kann sich deshalb nicht per LDAP anmelden). **Administratoren** sind das lokale `admin`-Konto und die Mitglieder der Administratoren-Gruppe (LDAP bzw. SSO): Sie haben dieselben Rechte, auch für die Einstellungen; nur das Passwort des lokalen Kontos ändert allein dieses Konto.

| Feld | Beispiel | | Beispiel |
|---|---|
| Server URL | `ldaps://dc.example.com:636` (empfohlen) oder `ldap://dc.example.com` + *StartTLS* |
| CA-Zertifikat (PEM) | Nur nötig, wenn das Zertifikat des Domain Controllers nicht von einer öffentlich/systemweit vertrauten CA stammt (interne CA). Mehrere Zertifikate hintereinander sind erlaubt. |
| Dienstkonto | `CN=svc-podman,OU=Service,DC=example,DC=com` oder `svc-podman@example.com` – ein normales Domänenkonto mit Leserechten genügt |
| Passwort Dienstkonto | wird mit `MASTER_SECRET_KEY` verschlüsselt gespeichert; leer lassen = bisheriges behalten |
| Suchbasis | `DC=example,DC=com` (oder eine OU) |
| Benutzerfilter | Standard: `(&(objectClass=user)(objectCategory=person)(\|(sAMAccountName={username})(userPrincipalName={username})))` – Anmeldung mit `jdoe` oder `jdoe@example.com`; `{username}` wird ersetzt |
| Administratoren-Gruppe (DN, optional) | `CN=PodmanManager-Admins,OU=Groups,DC=example,DC=com` – leer lassen, wenn es keinen LDAP-Vollzugriff geben soll |

Ablauf der Anmeldung: Dienstkonto bindet → Benutzer per Filter suchen (genau 1 Treffer) → Gruppenmitgliedschaft prüfen (**inkl. verschachtelter Gruppen**, AD-Regel `1.2.840.113556.1.4.1941`): erst die Administratoren-Gruppe, sonst alle zugeordneten Agent-Gruppen → ohne Treffer wird die Anmeldung abgelehnt (ohne das Passwort zu prüfen) → Passwort per Bind als Benutzer prüfen. Leere Passwörter werden abgewiesen.

**Vor dem Aktivieren** mit *Test connection* prüfen (optional mit Testbenutzer): Dienstkonto-Bind, Administratoren-Gruppe und alle zugeordneten Gruppen vorhanden, Benutzer gefunden und **welchen Zugriff er hätte** („alle Agents“ oder die Namen seiner Agent-Gruppen). Der Test prüft kein Benutzerpasswort. Speichern ändert nichts an bestehenden Sitzungen.

Hinweise:
- Die **primäre Gruppe** (meist „Domain Users") steht nicht in `memberOf`; als Gruppe daher eine normale Sicherheitsgruppe wählen.
- Änderungen der **AD-Mitgliedschaft** wirken bei der **nächsten Anmeldung**; bereits angemeldete Benutzer behalten ihre Sitzung bis zu 8 Stunden. Änderungen an der **Zuordnung Agent ↔ Gruppe** (und das Löschen einer Gruppe) gelten dagegen **sofort**, auch für laufende Sitzungen.
- Deaktivierte oder gesperrte AD-Konten werden vom Verzeichnis abgewiesen.
- Ohne `ldaps://`/StartTLS gehen Passwörter unverschlüsselt über das Netz (die Oberfläche warnt).
- Ist das Verzeichnis nicht erreichbar, erscheint „Directory login is currently unavailable"; die lokale Anmeldung bleibt möglich.

### Agent-Gruppen
Unter **Einstellungen → Registerkarte „Zugriff“ (Agent-Gruppen)** (nur Administratoren); auf einem echten Active Directory bestätigt:

1. Gruppe anlegen: Name (z. B. „Team A“) und **AD-Gruppen-DN** (z. B. `CN=Team-A,OU=Groups,DC=example,DC=com`).
2. Die Agents ankreuzen, die diese Gruppe verwalten darf. Ein Agent darf in **mehreren** Gruppen sein; ein Benutzer in mehreren Gruppen erhält die **Vereinigung** ihrer Agents.
3. Mit *Test connection* und einem Testbenutzer prüfen, welchen Zugriff er bekäme.

Was Gruppenmitglieder (ohne Administratoren-Gruppe) sehen und dürfen:
- Dashboard, Hosts und Container **nur für ihre Agents** (Zahlen und Listen enthalten keine anderen Hosts).
- Container der eigenen Agents ansehen, starten, stoppen, neustarten. Container anderer Agents sind weder per Liste noch per direkter URL erreichbar.
- **Keine** Host-Verwaltung (hinzufügen, entfernen, aktivieren/deaktivieren, testen) und keine Einstellungen.

Ein Benutzer, der weder in der Administratoren-Gruppe noch in einer zugeordneten Gruppe ist, kann sich nicht anmelden. Eine Gruppe ohne Agents gewährt Anmeldung, aber keine Hosts.

### Container verstecken
Unter **Einstellungen → Registerkarte „Zugriff“ (versteckte Container)** (nur Administratoren) lassen sich Container per Namensmuster vor Benutzern **ohne vollen Zugriff** (Mitglieder von Agent-Gruppen) verbergen, zum Beispiel die Container von PodmanManager selbst. Auf einem echten Active Directory mit eingeschränkten Benutzern bestätigt.

- **Muster:** ein Eintrag pro Zeile, `*` und `?` als Platzhalter, Groß-/Kleinschreibung egal. Erlaubt sind Buchstaben, Ziffern und `. _ - * ?`; Zeilen mit `#` sind Kommentare; höchstens 100 Muster. Beispiel: `podmanmanager*` versteckt `podmanmanager-agent` und `podmanmanager-master`; `*-secret` versteckt alles, was auf `-secret` endet.
- **Wirkung für eingeschränkte Benutzer:** Der Container fehlt in der Container-Liste und **in allen Zahlen** (Dashboard, Spalte „Containers“ in der Hostliste), die Detailseite meldet „nicht gefunden“, und Start/Stopp/Neustart werden abgelehnt (der Master prüft vor jeder Aktion den aktuellen Namen beim Agent). Der lokale `admin` und die LDAP-Administratoren-Gruppe sehen weiterhin alles.
- **Global:** Die Liste gilt für alle eingeschränkten Benutzer, nicht pro Gruppe. Änderungen wirken sofort, auch in laufenden Sitzungen.
- **Test:** Mit dem Feld „Test a container name“ lässt sich prüfen, ob ein Name versteckt würde.

## Firewall
Port 8080 nur für berechtigte Netze freigeben, nie ins Internet (siehe [Sicherheit](security.md)).

## Update / Backup
Container-Betrieb (Quadlet, `:latest`): Update per Web-UI, siehe [Quadlets](../deployment/quadlet/README.md#agent-per-web-ui-aktualisieren). Native Installation: `git pull && npm ci && npm run build -w apps/master && sudo systemctl restart podmanmanager-master`.
Backup: `master.db` (+ `-wal`/`-shm`) und `MASTER_SECRET_KEY`.
