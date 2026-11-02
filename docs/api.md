# Agent-API

Basis: `http://<agent>:9126/api/v1`. **Alle** Endpunkte (auch `health`) verlangen `Authorization: Bearer <token>`. Der Token gehört nie in die URL.

Antwortformat:
```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "CONTAINER_NOT_FOUND", "message": "Container not found" } }
```
Container-IDs: Hex, 12–64 Zeichen (`^[a-f0-9]{12,64}$`), sonst `400 INVALID_ID`. Request-Bodys werden ignoriert (max. 1 KB).

## Endpunkte
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/health` | Agent-/Podman-Status |
| GET | `/containers` | alle Container (laufend und gestoppt) |
| GET | `/containers/:id` | Details |
| POST | `/containers/:id/start` | starten |
| POST | `/containers/:id/stop` | stoppen (Timeout fest 10 s) |
| POST | `/containers/:id/restart` | neustarten (Timeout fest 10 s) |

Andere Pfade → `404`, falsche Methode → `405`.

### `GET /health`
```json
{ "ok": true, "data": {
  "agentId": "host-1", "agentVersion": "0.1.0", "hostname": "srv1",
  "podmanVersion": "5.2.0", "podmanApiVersion": "5.2.0",
  "socketStatus": "ok", "apiStatus": "ok", "agentStatus": "ok" } }
```
`socketStatus`: `ok | missing | unreachable` · `apiStatus`: `ok | error | unknown` · `agentStatus`: `ok | degraded`. Bei Podman-Problemen bleibt der HTTP-Status 200, `agentStatus` ist `degraded` und `error` enthält Code und Meldung.

### Container-Objekt
```json
{ "id": "<64 hex>", "name": "web", "image": "docker.io/library/nginx:latest",
  "state": "running", "status": "Up 2 hours",
  "createdAt": "2025-01-01T10:00:00.000Z", "startedAt": "2025-01-02T10:00:00.000Z" }
```
`startedAt` ist `null`, wenn der Container nie gestartet wurde.

### Aktionen
Antwort: `{ "action": "stop", "changed": true, "container": { … } }`. `changed: false`, wenn Podman 304 liefert (bereits im Zielzustand). `container` ist der Zustand **nach** der Aktion.

## Fehlercodes
| HTTP | Code | Bedeutung |
|---|---|---|
| 400 | `INVALID_ID` | ungültige Container-ID |
| 401 | `UNAUTHORIZED` | Token fehlt/falsch |
| 404 | `CONTAINER_NOT_FOUND`, `NOT_FOUND` | Container bzw. Pfad unbekannt |
| 405 | `METHOD_NOT_ALLOWED` | |
| 409 | `PODMAN_API_ERROR` | Podman meldet Konflikt |
| 413 | `BODY_TOO_LARGE` | |
| 429 | `RATE_LIMITED` | zu viele Fehlversuche von dieser IP |
| 502 | `PODMAN_API_ERROR` | Podman-Fehler (Meldung weitergereicht, max. 300 Zeichen) |
| 503 | `SOCKET_MISSING`, `SOCKET_UNREACHABLE` | Podman-Socket fehlt/nicht erreichbar |
| 504 | `PODMAN_TIMEOUT` | Podman antwortet nicht |
| 500 | `INTERNAL` | |
