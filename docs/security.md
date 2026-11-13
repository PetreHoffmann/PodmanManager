# Sicherheitskonzept

## Bedrohungsmodell
Die gesamte Kommunikation (Browser ↔ Master ↔ Agent) läuft **unverschlüsselt über HTTP**. Tokens, Passwörter und Session-Cookies sind im Netz mitlesbar. PodmanManager gehört deshalb ausschließlich in ein vertrauenswürdiges, abgeschottetes Netz (Management-VLAN/VPN). **Nie ins Internet stellen.**

## Maßnahmen
**Podman / Host**
- Nur Rootless Podman über den Unix-Socket des eigenen Benutzers. Der Socket wird nicht freigegeben, kein TCP.
- Agent verweigert den Start als root; keine sudo-Aufrufe, keine Shell, kein `child_process`.
- Feste Allowlist aus 6 Routen mit fest verdrahteten Podman-Pfaden; Container-IDs per Regex validiert; Request-Bodys werden ignoriert.
- Kein Docker, kein Compose, kein Fallback auf andere Runtimes.

**Lokaler Host (ohne Agent):** Wird `LOCAL_PODMAN_SOCKET` gesetzt, liegt der Podman-Socket im Master-Container. Wer den Master kompromittiert, steuert dann die Container dieses Benutzers (rootless, nie root-Rechte des Hosts). Bewusster Kompromiss gegenüber dem Ressourcenbedarf eines eigenen Agents; ohne die Variable bleibt der Socket außerhalb des Masters.

**Master ↔ Agent**
- Pro Agent ein zufälliger 256-Bit-Token (`Authorization: Bearer`), Prüfung per SHA-256 + `timingSafeEqual`.
- Der **Agent** speichert nur den Hash. Der **Master** muss den Token im Klartext senden und speichert ihn deshalb **AES-256-GCM-verschlüsselt** (Schlüssel `MASTER_SECRET_KEY` aus der Umgebung, nicht in der DB).
- Rate Limiting im Agent: nach 10 Fehlversuchen/Minute pro IP → 429.
- Tokens erscheinen nie in URLs oder Logs.
- Master akzeptiert nur Adressen der Form `http://host:port` (keine Pfade, Zugangsdaten, Redirects werden nicht gefolgt).

**Master-UI**
- Ein Admin-Account; Passwort mit scrypt gehasht; Session-Cookie `HttpOnly`, `SameSite=Strict`, 8 h; Sessions serverseitig als Hash gespeichert.
- Jede Seite und jede Server Action prüft die Anmeldung; Server Actions prüfen zusätzlich Origin (Next.js).
- Login: globale Begrenzung auf 5 Fehlversuche/Minute.
- Header: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. Das Cookie hat mangels HTTPS kein `Secure`-Flag.
- Setup-Fenster: Bis zum Anlegen des Admin-Passworts kann jeder mit Zugriff es setzen.

**LDAP / Active Directory (optional)**
- Die Einstellungen (LDAP, SSO, Gruppen, versteckte Container, Darstellung) ändern **Administratoren**: das lokale `admin`-Konto und die Mitglieder der Administratoren-Gruppe von LDAP bzw. SSO (`access = all`, serverseitig bei jeder Aktion geprüft). Alle anderen sehen die Einstellungen nicht. Das **Passwort** ändert nur das lokale `admin`-Konto im Master; LDAP- und SSO-Benutzer verwalten es im Verzeichnis bzw. beim Anbieter. Folge: Wer die Administratoren-Gruppe im Verzeichnis oder Identitätsanbieter kontrolliert, kontrolliert auch diese Einstellungen (er könnte z. B. den SSO-Anbieter oder die LDAP-Anbindung umstellen). Das lokale Konto bleibt als Notzugang und lässt sich damit nicht aussperren; schützen Sie die Administratoren-Gruppe entsprechend.
- Anmeldename wird als LDAP-Filterwert **nach RFC 4515 escaped** (kein Filter-Injection); eindeutig 1 Treffer erforderlich; leere Passwörter werden nie an den Server gesendet (sonst anonymer Bind = „Erfolg").
- Gruppenprüfung serverseitig im Verzeichnis (inkl. verschachtelter Gruppen); Passwortprüfung per Bind als Benutzer; die Passwörter der Benutzer werden nicht gespeichert.
- Passwort des Dienstkontos AES-256-GCM-verschlüsselt (wie die Agent-Tokens). Dienstkonto mit minimalen Leserechten verwenden.
- TLS-Zertifikate werden immer geprüft (optional eigene CA hinterlegen); es gibt keine Option, die Prüfung abzuschalten. Klartext-`ldap://` ist möglich, wird aber in den Einstellungen mit Warnung angezeigt.
- Fehlermeldungen bei der Anmeldung sind einheitlich („Invalid username or password"), damit Benutzer/Gruppen nicht erkundet werden können. Drosselung: 5 Fehlversuche pro Anmeldename und Minute, global 60.
- **Zugriffsbereiche:** Jede Sitzung hat `access = all` (lokaler `admin`, Administratoren-Gruppe von LDAP bzw. SSO) oder `access = groups` (nur die Agents der zugeordneten Gruppen). Der Bereich wird serverseitig bei **jeder** Seite und in der Container-Aktion geprüft (Dashboard, Hosts, Container, Detailseite; fremde Container liefern „nicht gefunden“). Host-Verwaltung ist nur mit `access = all`, Gruppen-/LDAP-/Passwort-Einstellungen nur für den lokalen `admin` möglich.
- Gruppen-IDs stehen in der Sitzung; welche Agents dazugehören, wird bei jedem Zugriff aus der Datenbank gelesen (Änderungen und Löschen wirken sofort). Unbekannte oder fehlende Zugriffswerte erweitern nie die Rechte.
- Zusätzliche Laufzeit-Abhängigkeit: `ldapts` (reines TypeScript, nur im Master).

**SSO (SAML 2.0, optional)**
- *Nahtlose Anmeldung* (optional, aus) leitet Besucher ohne Sitzung direkt zum Identitätsanbieter; das ist dieselbe Anmeldung wie über den Knopf (einmalige Anfrage, signierte Antwort, Gruppenprüfung). Nach dem Abmelden und nach einem Fehler wird die Anmeldeseite gezeigt (Cookie `pm_sso_manual`, Sitzungscookie ohne Geheimnis), das lokale Konto bleibt unter `/login?local=1` erreichbar.
- Antworten werden nur mit **gültiger Signatur der Assertion** (konfiguriertes Zertifikat des Identitätsanbieters), passendem Aussteller, Empfänger und Zeitfenster akzeptiert; jede Antwort gehört zu einer **einmaligen Anfrage** (8 Minuten) und lässt sich **nicht wiederverwenden**. Bei https bindet ein `SameSite=None`-Cookie die Antwort an den auslösenden Browser. Rechte wie bei LDAP (Administrator-Gruppe, Agent-Gruppen, sonst abgewiesen). Die SSO-Einstellungen sind nur für das lokale `admin`-Konto sichtbar. Details und Grenzen: [SSO mit SAML 2.0](sso.md#sicherheit).

**Container-Logs**
- Die Detailseite zeigt auf Knopfdruck die letzten 150 Zeilen. Der Abruf folgt denselben Regeln wie Container-Aktionen: Benutzer müssen den Agent sehen dürfen (Agent-Gruppen) und **versteckte Container sind gesperrt** (aktueller Name wird vor dem Abruf geprüft). Wer einen Container bedienen darf, darf also auch seine Logs lesen.
- **Logs können Geheimnisse enthalten** (Passwörter in Debug-Ausgaben, Tokens, interne Adressen). Wer das nicht möchte, sollte den Container mit einem Muster verstecken oder die betroffenen Benutzer nicht in die Agent-Gruppe aufnehmen.
- Die Ausgabe wird als reiner Text dargestellt (kein HTML), ANSI-/Steuerzeichen werden vom Agent entfernt; Länge und Größe sind begrenzt. Die Route ist nur lesend, braucht den Agent-Token und unterliegt dem Rate Limit.

**Agent- und Master-Logs**
- Die Web-UI zeigt auf Knopfdruck die letzten 150 Logzeilen eines Agents (Seite Hosts) und des Masters (Einstellungen). Serverseitig **nur für Administratoren** (`access = all`); Gruppenbenutzer erhalten `forbidden`.
- Quelle sind Ringpuffer im Speicher (max. 500 Zeilen, nichts auf Platte). Vor dem Speichern werden Bearer-Tokens sowie Werte nach `token`/`password`/`secret`/`authorization`/`hash` maskiert, Steuerzeichen entfernt. Anzeige als reiner Text.

**Eigenes Logo / Navbar-Text**
- Nur Administratoren (`access = all`) können beides ändern (Server Action prüft die Sitzung). Das Logo wird anhand des **Inhalts** (Magic Bytes) als PNG/JPEG/GIF/WebP/SVG erkannt, nie anhand von Dateiname oder Browser-Typ; höchstens 512 KB. SVG mit aktiven Inhalten (`<script>`, `on…=`-Attribute, `javascript:`, `foreignObject`, `iframe/embed/object`, Entities) wird abgelehnt. Beim Ausliefern wird der Typ erneut geprüft.
- Das Logo erscheint auch auf der Anmeldeseite und wird deshalb unter `/brand/logo` **ohne Anmeldung** ausgeliefert (es ist öffentlich wie die Anmeldeseite selbst; kein vertrauliches Bild hochladen). Ausgeliefert wird es mit `X-Content-Type-Options: nosniff` und `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, und es wird nur als `<img>` eingebunden – ein SVG kann so keine Skripte ausführen. Der Navbar-Text wird als Text dargestellt (kein HTML). Die Anmeldeseite zeigt außerdem die installierte **Versionsnummer** (auch ohne Anmeldung sichtbar).

**Pods**
- Pods folgen denselben Regeln wie Container: Gruppenbenutzer sehen und bedienen nur Pods ihrer Agents. Ein Pod, der **mindestens einen versteckten Container** enthält, ist für eingeschränkte Benutzer komplett unsichtbar (Liste, Detail) und gesperrt (Aktion prüft den aktuellen Inhalt beim Agent). Nur start/stop/restart, kein Anlegen oder Löschen. Die Pod-Logs (letzte 150 Zeilen aller Container, auf Knopfdruck) folgen denselben Regeln wie Container-Logs: gleicher Zugriff, Pods mit verstecktem Container gesperrt; die Hinweise zu Geheimnissen in Logs gelten ebenso.

**Versteckte Container**
- Namensmuster (nur Administratoren ändern sie) gelten für alle Sitzungen mit `access = groups`. Serverseitig durchgesetzt an jeder Stelle, an der Container ausgegeben werden: die Listen werden schon beim Abruf der Agents gefiltert (damit auch Dashboard und Host-Zahlen sie nicht enthalten), die Detailseite prüft den Namen, und jede Aktion fragt beim Agent den **aktuellen** Namen ab und lehnt versteckte Container ab (schützt auch bei veralteten Seiten und selbst gebauten Aufrufen).
- Der Agent selbst filtert nicht; die Grenze ist der Master. Wer das Host-System verwaltet (Container umbenennen, Agent-API mit dem Token direkt ansprechen), ist von dieser Funktion nicht eingeschränkt.
- Abgleich nur über den Namen: Wird ein Container umbenannt, ändert sich seine Sichtbarkeit.

**Container-Images**
- Basis: `node:24-trixie-slim` (Debian 13), Laufzeit-Stage als Benutzer `node`/UID 1000 (Agent: nie root). Die Images installieren beim Build das aktuelle Debian-Security-Paket für `zlib1g` (CVE-2026-85091); auf Debian 12 (bookworm) gibt es dafür keinen Fix, deshalb wurde auf trixie gewechselt. Die Images enthalten keine Geheimnisse (Schlüssel und Tokens kommen zur Laufzeit).

**Reverse-Proxy / `ALLOWED_ORIGINS`**
- Der CSRF-Schutz für Formular-Aktionen (Origin muss zum Host passen) bleibt immer aktiv. `ALLOWED_ORIGINS` nimmt ausschließlich die dort gelisteten Hosts davon aus (Laufzeit-Variable, kein Wildcard-Standard, nur `*.domain` auf ausdrücklichen Wunsch). Zusätzlich hat das Session-Cookie `SameSite=Strict`. Der Master selbst spricht weiter nur HTTP; TLS endet am Proxy. Das Cookie trägt kein `Secure`-Flag.

**Update-Prüfung (About-Dialog)**
- Ist `https_proxy` gesetzt, geht die Update-Prüfung (und nur sie) über diesen HTTP-Proxy per CONNECT-Tunnel; das Serverzertifikat von Docker wird weiterhin geprüft (bei TLS-Inspektion die Firmen-CA per `NODE_EXTRA_CA_CERTS` hinterlegen). Agent-Verbindungen nutzen nie einen Proxy. Fehlerursachen erscheinen im Dialog nur als kurze Codes (kein Freitext).
- Einzige ausgehende Verbindung des Masters ins Internet: lesende Abfragen der Tag-Liste bei Docker Hub, auf zwei Wegen parallel: `auth.docker.io` + `registry-1.docker.io` (Registry-API, anonymes Pull-Token) und `hub.docker.com/v2/repositories/<repo>/tags/`. 5 s Timeout je Anfrage, keine Redirects, nur nach Anmeldung und beim Öffnen des Dialogs, Cache 5 min. Es werden weder Hostnamen noch Agents noch Benutzer übertragen. Abschaltbar mit `UPDATE_CHECK=off`. Das Repository wird gegen ein festes Muster geprüft (kein frei wählbarer Pfad/Host).

- **Agent-Selbst-Update:** `POST /system/update` (Bearer-Token wie alle Routen) löst nur Pull des *eigenen* Image-Verweises (validiert, nur schwebende Tags, nur systemd-verwaltet) und Neustart aus; es nimmt keine Image-Angaben vom Master entgegen. Im Master nur für Admins.

- **Master-Update über den Agent:** nur wenn der Agent mit `UPDATE_UNIT` konfiguriert ist; er berührt ausschließlich den Container dieser Unit (per Label gefunden), das Image stammt aus diesem Container, nicht vom Aufrufer. Der Master bekommt weiterhin keinen Podman-Zugriff; Auslösen nur durch Admins.

- **Images löschen:** Der Agent löscht nie mit Force, verweigert Images in Benutzung sowie sein eigenes Image und das der `UPDATE_UNIT`, und validiert Id und Tag. Der Master erlaubt Löschen und Aufräumen nur Admins (serverseitig geprüft); Nutzer mit Agent-Gruppen sehen die Images ihrer Agents nur lesend.

## Restrisiken
- Aktiver Angreifer im Netz kann Token/Cookie abgreifen oder Traffic manipulieren (kein TLS).
- Wer den Agent-Token kennt, kann Container dieses Benutzers starten/stoppen/neustarten (nur das).
- Wer `MASTER_SECRET_KEY` und die DB hat, kann alle Agent-Tokens entschlüsseln.
- Die Drosselung pro Anmeldename kann genutzt werden, um das Konto einer bestimmten Person kurz zu sperren (DoS auf den Login); der lokale `admin` ist davon getrennt nicht ausgenommen.
- Wird ein Benutzer aus einer AD-Gruppe entfernt, bleibt seine bestehende Sitzung (mit den damals ermittelten Gruppen) bis zu 8 Stunden gültig.
- Die Trennung der Agents ist eine Zugriffskontrolle in der Anwendung, keine Netzwerktrennung: Alle Agent-Tokens liegen im Master (verschlüsselt); wer den Master oder seine Datenbank samt `MASTER_SECRET_KEY` kompromittiert, erreicht alle Agents.

## Firewall
Agent-Host (nur Master-IP `192.168.1.10`):
```bash
# firewalld
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.10" port port="9126" protocol="tcp" accept'
sudo firewall-cmd --reload
# ufw
sudo ufw allow from 192.168.1.10 to any port 9126 proto tcp
# nftables
nft add rule inet filter input ip saddr 192.168.1.10 tcp dport 9126 accept
```
Master (nur Admin-Netz `192.168.1.0/24`):
```bash
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp
```
Alle anderen Zugriffe auf 9126/8080 blockieren; keine Portweiterleitung aus dem Internet.

## Token rotieren
1. Auf dem Agent-Host: `node ~/.local/share/podmanmanager-agent/dist/index.js --generate-token`.
2. `AGENT_TOKEN_HASH` in `~/.config/podmanmanager/agent.env` ersetzen, `systemctl --user restart podmanmanager-agent`.
3. Im Master den Host entfernen und mit dem neuen Token erneut hinzufügen.
