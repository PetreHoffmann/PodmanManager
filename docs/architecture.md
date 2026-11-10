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
Der Agent nutzt ausschließlich diese festen Endpunkte (kein Pass-through). `<base>` = `/v<libpod-api-version>/libpod`, z. B. `/v4.9.3/libpod`:

| Zweck | Aufruf |
|---|---|
| Erreichbarkeit + API-Version | `GET /libpod/_ping` (unversioniert; Antwort-Header `Libpod-Api-Version`) |
| Version | `GET <base>/version` |
| Liste | `GET <base>/containers/json?all=true` |
| Details | `GET <base>/containers/{id}/json` |
| Start | `POST <base>/containers/{id}/start` (204, 304 = läuft bereits) |
| Stop | `POST <base>/containers/{id}/stop?timeout=10` (204, 304 = bereits gestoppt) |
| Restart | `POST <base>/containers/{id}/restart?t=10` (204) |
| Pods | `GET <base>/pods/json` (Liste mit Containern); Aktionen `POST <base>/pods/{id}/start|stop?t=10|restart` (200; 304 = Zustand schon erreicht) |
| Pod-Logs (lesend) | keine Podman-Route: Container-Logs jedes Pod-Containers (siehe oben), vom Agent nach Zeitstempel gemischt |
| Logs (lesend) | `GET <base>/containers/{id}/logs?stdout=true&stderr=true&tail=<n>&timestamps=true` (Antwort: Rahmenformat, siehe unten) |

**Logs:** Podman liefert die Logs als gemultiplexten Strom (auch bei Containern mit TTY): Rahmen aus 8-Byte-Kopf (Strom 0/1/2, drei Nullbytes, Länge als Big-Endian-Zahl) und Nutzdaten, jede Zeile mit RFC3339-Zeitstempel. Der Agent liest das aus, trennt stdout/stderr, entfernt ANSI-Steuerzeichen, kürzt Zeilen auf 2000 Zeichen und begrenzt die Antwort auf 4 MB; `tail` ist auf 1–500 begrenzt (Standard 150). Containers mit Log-Treiber `none` liefern einen Podman-Fehler, der unverändert (gekürzt) angezeigt wird. Verifiziert mit Podman 4.9.3.

**Versionierung:** Podman beantwortet die libpod-Routen außer `_ping` nur **mit** Versionspräfix; ohne Präfix kommt `404`. Der Agent liest deshalb bei jedem Ping (jede Health-Prüfung) die Version aus dem Header `Libpod-Api-Version` und verwendet sie für alle Aufrufe. Fehlt der Header, gilt `v4.0.0`.

**Geprüft:**
- gegen den Podman-Quellcode und gegen ein echtes **Podman 4.9.3** (Root-Socket in der Entwicklungsumgebung): `_ping`, Version, Container auflisten/ansehen, Start/Stop/Restart inkl. 304-Fall und unbekannter ID, mit einem echten Container;
- auf einem echten Host mit **Rootless-Podman 5.8.2** (Agent und Master als Quadlet-Container im gemeinsamen Netzwerk): Registrierung im Master, `/api/v1/health` (`socketStatus: ok`, `apiStatus: ok`, Podman-Version), Containerliste und Start/Stop/Restart über die Master-Oberfläche funktionieren. Andere 5.x-Versionen sind nicht gesondert getestet.

## Bewusst nicht enthalten
Container und Pods erstellen/löschen, Images, Volumes, Netzwerke, Exec/Terminal, Statistiken, Compose. (Pods gibt es nur als Liste, Detail, Start/Stop/Restart und schreibgeschützte Logs. Logs gibt es nur als schreibgeschützte Ansicht der letzten 150 Zeilen, kein Live-Stream.)
