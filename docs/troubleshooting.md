# Troubleshooting

## Agent
| Symptom | Ursache / Lösung |
|---|---|
| Health: `socketStatus: missing` | Socket fehlt. `systemctl --user enable --now podman.socket`; Pfad: `ls $XDG_RUNTIME_DIR/podman/podman.sock`. Ggf. `PODMAN_SOCKET` in `agent.env` setzen. |
| `unreachable` | Socket gehört einem anderen Benutzer/Rechte. Agent muss unter demselben Benutzer wie Podman laufen. |
| `apiStatus: error` | Podman antwortet fehlerhaft. `podman info`, `journalctl --user -u podman.socket`, Podman-Version prüfen. |
| Agent startet nicht: „Refusing to run as root" | Als normaler Benutzer starten. |
| „PODMAN_SOCKET not set and XDG_RUNTIME_DIR unavailable" | Außerhalb einer Benutzersitzung gestartet. Als User-Service laufen lassen oder `PODMAN_SOCKET` absolut setzen. |
| Agent nach Reboot nicht aktiv | Lingering fehlt: `sudo loginctl enable-linger <benutzer>`. |
| `EADDRINUSE` | Port 9126 belegt → `AGENT_PORT` ändern (und im Master neu registrieren). |
| 401 | Falscher Token, oder `AGENT_TOKEN_HASH` passt nicht zum Token. |
| 429 | Zu viele Fehlversuche von der Master-IP; nach 1 Minute erneut, Token prüfen. |
| Logs | `journalctl --user -u podmanmanager-agent -f` |

## Master
| Symptom | Lösung |
|---|---|
| „MASTER_SECRET_KEY must be 32 bytes" | Schlüssel setzen: `openssl rand -base64 32`. |
| Host `offline` | Agent läuft? Firewall (9126 für Master-IP)? `curl -H "Authorization: Bearer …" http://<ip>:9126/api/v1/health` vom Master aus. Die letzte Fehlermeldung steht in der Hostliste. |
| Host `degraded` | Agent ok, Podman-Problem auf dem Host (siehe oben). |
| Agent nicht hinzufügbar | Adresse muss `http://host:port` sein; Token korrekt; Host darf nicht schon registriert sein (Adresse oder Agent-ID). |
| Nach Schlüsselverlust: Fehler „Cannot read agent credentials" | Hosts entfernen und neu registrieren. |
| Zugriff verweigert nach Stop/Restart | Aktion ist nur bei erreichbarem, aktiviertem Host möglich. |
| Port 8080 belegt | `MASTER_PORT` ändern. |
| Admin-Passwort vergessen | `sudo -u podmanmanager node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/var/lib/podmanmanager/master.db');d.exec('DELETE FROM admin; DELETE FROM sessions')"` – danach sofort `/setup` aufrufen. |
| Warnung „SQLite is an experimental feature" | Harmlos (Node 22). |
| Logs | `journalctl -u podmanmanager-master -f` |

## Diagnose
```bash
curl -s -H "Authorization: Bearer $TOKEN" http://<agent>:9126/api/v1/containers
ss -ltnp | grep -E '8080|9126'
```
