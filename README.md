# PodmanManager

Schlanke zentrale Verwaltung von **rootless Podman**-Containern auf mehreren Linux-Hosts.
Funktionsumfang bewusst begrenzt: Container **anzeigen, starten, stoppen, neustarten**.

- **Master** (`apps/master`): Next.js-Weboberfläche, HTTP `:8080`, SQLite.
- **Agent** (`apps/agent`): eigenständiger Node.js-Prozess pro Host, HTTP `:9126`, spricht ausschließlich mit dem lokalen Podman-Unix-Socket des eigenen Benutzers. Keine Laufzeit-Abhängigkeiten.

```
Browser ── HTTP :8080 ── Master ── HTTP :9126 (Bearer-Token) ── Agent ── Unix-Socket ── Podman (rootless)
```

Kein Docker, kein Compose, kein HTTPS/TLS, kein Root. **Nur in einem abgeschotteten Netz betreiben** (siehe [Sicherheit](docs/security.md)).

## Schnellstart

Voraussetzungen: Linux, Node.js ≥ 22.13, auf Agent-Hosts rootless Podman + systemd.

```bash
# 1. Agent auf jedem Podman-Host (als normaler Benutzer, nicht root)
git clone <repo> && cd podmanmanager
deployment/agent/install.sh host-1        # gibt einmalig den Agent-Token aus

# 2. Master (siehe docs/installation-master.md)
npm ci && npm run build -w apps/master
MASTER_SECRET_KEY=$(openssl rand -base64 32) deployment/master/start.sh

# 3. http://<master>:8080 öffnen → Admin-Passwort setzen → Hosts → Agent hinzufügen
```

## Dokumentation

| | |
|---|---|
| [Architektur](docs/architecture.md) | Komponenten, Datenfluss, Entscheidungen |
| [Master-Installation](docs/installation-master.md) | Build, Konfiguration, systemd, Datenbank |
| [Agent-Installation](docs/installation-agent.md) | install.sh, User-Service, Lingering, Podman-Socket |
| [API](docs/api.md) | Agent-REST-API, Fehlercodes |
| [Sicherheit](docs/security.md) | Bedrohungsmodell, Tokens, Firewall |
| [Troubleshooting](docs/troubleshooting.md) | Häufige Fehler |

## Entwicklung & Tests

```bash
npm install
npm test -w apps/agent -w apps/master                 # Unit-/Komponententests
npm run build -w apps/master && node --import tsx integration/e2e.mts   # E2E (benötigt playwright)
```

Die Integrationstests gegen einen echten Podman-Socket (`apps/agent/test/integration.test.ts`) laufen nur, wenn ein rootless Socket vorhanden ist, und werden sonst übersprungen. Der E2E-Test verwendet nachgebaute Podman-Sockets.
