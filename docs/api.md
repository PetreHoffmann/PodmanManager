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
| GET | `/containers/:id/logs?tail=<n>` | letzte `n` Log-Zeilen (1–500, Standard 150), nur lesend |
| GET | `/pods` | alle Pods mit ihren Containern |
| GET | `/pods/:id` | ein Pod (ID wie bei Containern, auch Kurzform) |
| POST | `/pods/:id/start` | alle Container des Pods starten |
| POST | `/pods/:id/stop` | Pod stoppen (Timeout fest 10 s) |
| POST | `/pods/:id/restart` | Pod neustarten |
| GET | `/agent/logs?tail=<n>` | letzte `n` eigene Log-Zeilen des Agents (1–500, Standard 150), nur lesend |

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

### `GET /agent/logs?tail=150`
Eigene Logzeilen des Agents aus einem Ringpuffer im Speicher (max. 500 Zeilen, nach Neustart leer). Antwort:
`{"ok":true,"data":{"lines":[{"ts":"2026-11-10T21:13:11.000Z","level":"info|warn|error","text":"…"}]}}`.
Tokens/Secrets werden vor dem Speichern maskiert (`***`), Steuerzeichen entfernt, Zeilen auf 1000 Zeichen begrenzt. `tail` ungültig → 400 `INVALID_PARAM`.

### Pods
`GET /pods` → `[{"id","name","status","createdAt","containers":[{"id","name","state","infra"}]}]`. `status` ist kleingeschrieben (`running`, `degraded`, `exited`, `stopped`, `created`, `paused`), `infra` markiert den Infra-Container. Aktionen liefern `{action, changed, pod}`; `changed=false` bei Podman-`304` (Zustand schon erreicht). Unbekannter Pod → `404 POD_NOT_FOUND`; Fehler beim Start einzelner Container (`Errs`) kommen als Podman-Fehler (409/502) mit den Meldungen. Container-Einträge enthalten zusätzlich `podId`/`podName`.

### `GET /containers/:id/logs?tail=150`
```json
{ "ok": true, "data": { "tail": 150, "lines": [
  { "ts": "2026-11-10T21:13:11Z", "stream": "stdout", "text": "line 300" },
  { "ts": "2026-11-10T21:13:12Z", "stream": "stderr", "text": "to stderr" } ] } }
```
`ts` ist `null`, wenn die Zeile keinen Zeitstempel hat. `stream` ist `stdout` oder `stderr`. Der Text hat keine ANSI-/Steuerzeichen, Zeilen sind auf 2000 Zeichen gekürzt (`…`), die Gesamtantwort auf 4 MB begrenzt (sonst `LOGS_TOO_LARGE`). Ungültiges `tail` (nicht 1–500) → `400 INVALID_PARAM`.

## Fehlercodes
| HTTP | Code | Bedeutung |
|---|---|---|
| 400 | `INVALID_ID` | ungültige Container-ID |
| 401 | `UNAUTHORIZED` | Token fehlt/falsch |
| 404 | `CONTAINER_NOT_FOUND`, `NOT_FOUND` | Container bzw. Pfad unbekannt |
| 405 | `METHOD_NOT_ALLOWED` | |
| 409 | `PODMAN_API_ERROR` | Podman meldet Konflikt |
| 400 | `INVALID_PARAM` | ungültiger Query-Parameter (z. B. `tail`) |
| 413 | `BODY_TOO_LARGE` | |
| 429 | `RATE_LIMITED` | zu viele Fehlversuche von dieser IP |
| 502 | `PODMAN_API_ERROR` | Podman-Fehler (Meldung weitergereicht, max. 300 Zeichen) |
| 502 | `LOGS_TOO_LARGE` | Log-Ausgabe größer als 4 MB |
| 503 | `SOCKET_MISSING`, `SOCKET_UNREACHABLE` | Podman-Socket fehlt/nicht erreichbar |
| 504 | `PODMAN_TIMEOUT` | Podman antwortet nicht |
| 500 | `INTERNAL` | |
