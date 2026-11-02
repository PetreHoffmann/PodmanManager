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

## Restrisiken
- Aktiver Angreifer im Netz kann Token/Cookie abgreifen oder Traffic manipulieren (kein TLS).
- Wer den Agent-Token kennt, kann Container dieses Benutzers starten/stoppen/neustarten (nur das).
- Wer `MASTER_SECRET_KEY` und die DB hat, kann alle Agent-Tokens entschlüsseln.
- Sperrung nach Fehlversuchen im Master ist global (kann für DoS auf den Login missbraucht werden).

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
