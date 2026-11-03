# Sicherheitskonzept

## Bedrohungsmodell
Die gesamte Kommunikation (Browser ↔ Master ↔ Agent) läuft **unverschlüsselt über HTTP**. Tokens, Passwörter und Session-Cookies sind im Netz mitlesbar. PodmanManager gehört deshalb ausschließlich in ein vertrauenswürdiges, abgeschottetes Netz (Management-VLAN/VPN). **Nie ins Internet stellen.**

## Maßnahmen
**Podman / Host**
- Nur Rootless Podman über den Unix-Socket des eigenen Benutzers. Der Socket wird nicht freigegeben, kein TCP.
- Agent verweigert den Start als root; keine sudo-Aufrufe, keine Shell, kein `child_process`.
- Feste Allowlist aus 6 Routen mit fest verdrahteten Podman-Pfaden; Container-IDs per Regex validiert; Request-Bodys werden ignoriert.
- Kein Docker, kein Compose, kein Fallback auf andere Runtimes.

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
- Konfiguration und Passwortänderung nur durch das lokale `admin`-Konto; LDAP-Benutzer sehen diese Bereiche nicht (serverseitig geprüft).
- Anmeldename wird als LDAP-Filterwert **nach RFC 4515 escaped** (kein Filter-Injection); eindeutig 1 Treffer erforderlich; leere Passwörter werden nie an den Server gesendet (sonst anonymer Bind = „Erfolg").
- Gruppenprüfung serverseitig im Verzeichnis (inkl. verschachtelter Gruppen); Passwortprüfung per Bind als Benutzer; die Passwörter der Benutzer werden nicht gespeichert.
- Passwort des Dienstkontos AES-256-GCM-verschlüsselt (wie die Agent-Tokens). Dienstkonto mit minimalen Leserechten verwenden.
- TLS-Zertifikate werden immer geprüft (optional eigene CA hinterlegen); es gibt keine Option, die Prüfung abzuschalten. Klartext-`ldap://` ist möglich, wird aber in den Einstellungen mit Warnung angezeigt.
- Fehlermeldungen bei der Anmeldung sind einheitlich („Invalid username or password"), damit Benutzer/Gruppen nicht erkundet werden können. Drosselung: 5 Fehlversuche pro Anmeldename und Minute, global 60.
- **Zugriffsbereiche:** Jede Sitzung hat `access = all` (lokaler `admin`, LDAP-Administratoren-Gruppe) oder `access = groups` (nur die Agents der zugeordneten Gruppen). Der Bereich wird serverseitig bei **jeder** Seite und in der Container-Aktion geprüft (Dashboard, Hosts, Container, Detailseite; fremde Container liefern „nicht gefunden“). Host-Verwaltung ist nur mit `access = all`, Gruppen-/LDAP-/Passwort-Einstellungen nur für den lokalen `admin` möglich.
- Gruppen-IDs stehen in der Sitzung; welche Agents dazugehören, wird bei jedem Zugriff aus der Datenbank gelesen (Änderungen und Löschen wirken sofort). Unbekannte oder fehlende Zugriffswerte erweitern nie die Rechte.
- Zusätzliche Laufzeit-Abhängigkeit: `ldapts` (reines TypeScript, nur im Master).

**Update-Prüfung (About-Dialog)**
- Einzige ausgehende Verbindung des Masters ins Internet: `GET https://hub.docker.com/v2/repositories/<repo>/tags/` (nur lesend, 5 s Timeout, keine Redirects, nur nach Anmeldung und beim Öffnen des Dialogs, Cache 6 h). Es werden weder Hostnamen noch Agents noch Benutzer übertragen. Abschaltbar mit `UPDATE_CHECK=off`. Das Repository wird gegen ein festes Muster geprüft (kein frei wählbarer Pfad/Host).

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
