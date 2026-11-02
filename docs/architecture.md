# Architektur

## Komponenten
| | Master | Agent |
|---|---|---|
| Stack | Next.js (App Router), React, Tailwind, `node:sqlite` | Node.js, nur `node:http` |
| Port | 8080 (HTTP) | 9126 (HTTP) |
| Läuft als | unprivilegierter Systemdienst-Benutzer | normaler Benutzer (systemd User-Service) |
| Zustand | SQLite: Agents, Admin, Sessions | keiner |

Der Browser spricht nur mit dem Master. Der Master fragt Agents serverseitig ab; Agents sprechen ausschließlich mit dem Podman-Socket `$XDG_RUNTIME_DIR/podman/podman.sock` ihres eigenen Benutzers.

## Datenfluss
- **Heartbeat:** Der Master ruft alle `HEARTBEAT_INTERVAL` Sekunden (Standard 30) `GET /api/v1/health` jedes aktivierten Agents parallel ab (Timeout 5 s). Nach `HEARTBEAT_FAILURES` (3) Fehlschlägen in Folge: `offline`. Ein erfolgreicher Check setzt den Status sofort zurück.
- **Container:** Werden bei jedem Seitenaufruf live von den Agents geladen. Die DB ist dafür nicht maßgeblich. Nicht abfragbare Hosts werden separat ausgewiesen, nie als „0 Container".
- **Aktionen:** UI → Server Action (Login geprüft) → Agent `POST /containers/:id/{start|stop|restart}` → Podman. Danach liefert der Agent den frischen Containerzustand zurück.

## Host-Status
`unknown` (noch nicht geprüft) · `online` · `degraded` (Agent erreichbar, Podman-Socket/API defekt) · `offline` · `disabled` (kein Zugriff, keine Aktionen).

## Podman-REST-API (libpod)
Der Agent nutzt ausschließlich diese festen Endpunkte (kein Pass-through):

| Zweck | Aufruf |
|---|---|
| Erreichbarkeit | `GET /libpod/_ping` |
| Version | `GET /libpod/version` |
| Liste | `GET /libpod/containers/json?all=true` |
| Details | `GET /libpod/containers/{id}/json` |
| Start | `POST /libpod/containers/{id}/start` (204, 304 = läuft bereits) |
| Stop | `POST /libpod/containers/{id}/stop?timeout=10` (204, 304 = bereits gestoppt) |
| Restart | `POST /libpod/containers/{id}/restart?t=10` (204) |

Geprüft gegen den Podman-Quellcode (`register_containers.go`). **Offen:** Test gegen ein echtes Podman. Die Quellen registrieren libpod-Routen mit Versionspräfix (`/vX.Y.Z/libpod/…`); der Agent verwendet unversionierte Pfade. Falls ein Podman diese ablehnt, muss in `apps/agent/src/podman/service.ts` ein fester Präfix ergänzt werden.

## Bewusst nicht enthalten
Container erstellen/löschen, Images, Volumes, Netzwerke, Pods, Logs, Exec/Terminal, Statistiken, Compose.
