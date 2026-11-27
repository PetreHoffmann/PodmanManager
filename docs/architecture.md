# Architektur

## Komponenten
| | Master | Agent |
|---|---|---|
| Stack | Next.js (App Router), React, Tailwind, `node:sqlite` | Node.js, nur `node:http` |
| Port | 8080 (HTTP) | 9126 (HTTP) |
| Läuft als | unprivilegierter Systemdienst-Benutzer | normaler Benutzer (systemd User-Service) |
| Zustand | SQLite: Agents, Admin, Sessions | keiner |

**Lokaler Host:** Mit `LOCAL_PODMAN_SOCKET` enthält der Master den Agent-Code und spricht ohne Netzwerk im Prozess mit dem Podman-Socket seines Hosts (kein separater Agent nötig).

Der Browser spricht nur mit dem Master. Der Master fragt Agents serverseitig ab; Agents sprechen ausschließlich mit dem Podman-Socket `$XDG_RUNTIME_DIR/podman/podman.sock` ihres eigenen Benutzers.

## Datenfluss
- **Heartbeat:** Der Master ruft alle `HEARTBEAT_INTERVAL` Sekunden (Standard 30) `GET /api/v1/health` jedes aktivierten Agents parallel ab (Timeout 5 s). Nach `HEARTBEAT_FAILURES` (3) Fehlschlägen in Folge: `offline`. Ein erfolgreicher Check setzt den Status sofort zurück.
- **Container:** Werden bei jedem Seitenaufruf live von den Agents geladen. Die DB ist dafür nicht maßgeblich. Nicht abfragbare Hosts werden separat ausgewiesen, nie als „0 Container".
- **Aktionen:** UI → Server Action (Login geprüft) → Agent `POST /containers/:id/{start|stop|restart}` → Podman. Danach liefert der Agent den frischen Containerzustand zurück.

## Anmeldung
Der Master kennt drei Arten, sich anzumelden. Welche verfügbar sind, legt ein Administrator in den Einstellungen fest:

| Art | Zugangsdaten | Wer pflegt Benutzer und Gruppen |
|---|---|---|
| **Lokal** | Konto `admin` (Notzugang, immer vorhanden), Passwort in der Datenbank (gehasht) | Master |
| **LDAP / Active Directory** (optional) | Benutzername und Passwort, gegen das Verzeichnis geprüft | Verzeichnis (Gruppen → Agent-Gruppen) |
| **SSO per SAML 2.0** (optional; ADFS, Entra ID, Okta, Keycloak, …) | Button auf der Anmeldeseite; die Anmeldung erfolgt beim Identitätsanbieter, der Master bekommt eine **signierte Assertion** mit Benutzername und Gruppen | Identitätsanbieter (Gruppen-Claim → Agent-Gruppen) |

Ablauf bei SSO: `/saml/login` legt eine einmalige Anfrage an und leitet zum Identitätsanbieter weiter → der Anbieter authentifiziert den Benutzer (bei Domänen-Rechnern meist ohne Eingabe) → der Browser schickt die Antwort per POST an `/saml/acs` → der Master prüft Signatur, Aussteller, Empfänger und Zeitfenster, verbraucht die Anfrage (keine Wiederverwendung) und liest Benutzername und Gruppen → Sitzung. `/saml/metadata` liefert die Master-Seite für die ADFS-Einrichtung. Einrichtung, Claims und Fehlersuche: [SSO mit SAML 2.0](sso.md).

Optional leitet die **nahtlose Anmeldung** Besucher ohne Sitzung schon von `/login` direkt nach `/saml/login`; nach dem Abmelden, nach einem SSO-Fehler und bei `/login?local=1` bleibt die Anmeldeseite sichtbar.

Die LDAP-Anbindung ist für Active Directory voreingestellt und für andere Verzeichnisserver (OpenLDAP, FreeIPA, 389 DS, …) über Attributnamen, Benutzerfilter und Gruppenprüfung (Attribut am Benutzer oder an der Gruppe) einstellbar; die Registerkarte „LDAP“ bietet Vorlagen. Bei „Angemeldet als“ steht außerdem, über welche Art sich der Benutzer angemeldet hat.

Angezeigt wird der Benutzer bei „Angemeldet als“ als „Anzeigename (Kontoname)“: bei LDAP aus `displayName` und `sAMAccountName`, bei SAML aus einem optionalen Anzeigenamen-Claim und dem Teil des UPN vor dem `@`. Fehlt der Anzeigename, steht der Anmeldename (UPN) dort. Die Anzeige wird mit der Sitzung gespeichert; Rechte, Anmeldename und Logs nutzen weiter den Anmeldenamen.

Nach der Anmeldung sind alle Arten gleich: Die Sitzung (Cookie, 8 Stunden) hat `access = all` (lokaler `admin`, Mitglieder der Administratoren-Gruppe) oder `access = groups` (nur die Agents der zugeordneten Gruppen; Mitglieder ohne Gruppe werden abgewiesen). Der Zugriffsbereich wird serverseitig bei jeder Seite und jeder Aktion geprüft. Einstellungen, Host-Verwaltung, Logs, Updates und das Löschen von Images sind nur mit `access = all` möglich; die Einstellungen (LDAP, SSO, Gruppen, versteckte Container, Darstellung) können alle Administratoren ändern; das Passwort ändert nur das lokale `admin`-Konto. SSO meldet beim Abmelden nur die Master-Sitzung ab (kein Single Logout); der nächste SSO-Login danach verlangt per `ForceAuthn` eine erneute Authentifizierung beim Anbieter.

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
| Speicher (lesend) | `GET <base>/system/df` (Images, Container, Volumes mit Größen); der Agent summiert und cached 60 s |
| Images | `GET <base>/images/json` (Liste), `DELETE <base>/images/{id oder repo:tag}?force=false` (nie mit Force), `POST <base>/images/prune?filters={"dangling":["true"]}`; Nutzung aus `GET <base>/containers/json?all=true` (`ImageID`) |
| Selbst-Update | `GET <base>/containers/{id}/json` (eigenes Image), `POST <base>/images/pull?reference=<eigenes Image>&quiet=true`; danach beendet sich der Agent bzw. stoppt `POST <base>/containers/{id}/stop` den Master-Container (gefunden per `GET <base>/containers/json?filters={"label":["PODMAN_SYSTEMD_UNIT=<unit>.service"]}`) |
| Container anlegen (nur auf Anforderung des Masters) | `POST <base>/containers/create` (Spezifikation aus den geprüften Feldern, `privileged:false`), danach `POST <base>/containers/{id}/start`; scheitert der Start, `DELETE <base>/containers/{id}?force=true`. Image vorher: `POST <base>/images/pull?reference=<name>&quiet=true` |
| Pod anlegen | `POST <base>/pods/create` (Name, Hostname, `portmappings`, `netns`/`Networks`); 409 = Name vergeben |
| Konfiguration (lesend) | `GET <base>/containers/{id}/json` und `GET <base>/images/{imageId}/json` (um Image-Vorgaben abzuziehen); Pod-Name aus `GET <base>/pods/json`, weil Podman 5 im Inspect nur die Pod-ID liefert |
| Befehl ausführen (nur mit `EXEC_ENABLED`) | `POST <base>/containers/{id}/exec` (`Cmd`, `AttachStdout/Stderr:true`, `AttachStdin:false`, `Tty:false`, `Privileged:false`), `POST <base>/exec/{execId}/start` (`Detach:false`, Antwort als Strom mit Zeit- und Größenlimit), `GET <base>/exec/{execId}/json` (Exit-Code) |
| cgroup-Version und rootless (lesend) | `GET <base>/info` (`host.cgroupVersion`, `host.security.rootless`), 10 Minuten zwischengespeichert; der Master zeigt damit im Erstellen-Formular einen Hinweis, wenn Podman Limits ignoriert |
| Container löschen (nur gestoppt, ohne systemd) | `GET <base>/containers/{id}/json` (Label, Status, Infra), dann `DELETE <base>/containers/{id}?force=false&v=false` |
| Pod löschen (nur gestoppt, ohne systemd) | `GET <base>/pods/json` und `GET <base>/containers/json?all=true` (Labels des Pods und seiner Container), dann `DELETE <base>/pods/{id}?force=false` (entfernt Pod, Infra-Container und alle Container) |
| Pod-Logs (lesend) | keine Podman-Route: Container-Logs jedes Pod-Containers (siehe oben), vom Agent nach Zeitstempel gemischt |
| Logs (lesend) | `GET <base>/containers/{id}/logs?stdout=true&stderr=true&tail=<n>&timestamps=true` (Antwort: Rahmenformat, siehe unten) |

**Logs:** Podman liefert die Logs als gemultiplexten Strom (auch bei Containern mit TTY): Rahmen aus 8-Byte-Kopf (Strom 0/1/2, drei Nullbytes, Länge als Big-Endian-Zahl) und Nutzdaten, jede Zeile mit RFC3339-Zeitstempel. Der Agent liest das aus, trennt stdout/stderr, entfernt ANSI-Steuerzeichen, kürzt Zeilen auf 2000 Zeichen und begrenzt die Antwort auf 4 MB; `tail` ist auf 1–500 begrenzt (Standard 150). Containers mit Log-Treiber `none` liefern einen Podman-Fehler, der unverändert (gekürzt) angezeigt wird. Verifiziert mit Podman 4.9.3.

**Versionierung:** Podman beantwortet die libpod-Routen außer `_ping` nur **mit** Versionspräfix; ohne Präfix kommt `404`. Der Agent liest deshalb bei jedem Ping (jede Health-Prüfung) die Version aus dem Header `Libpod-Api-Version` und verwendet sie für alle Aufrufe. Fehlt der Header, gilt `v4.0.0`.

**Geprüft:**
- gegen den Podman-Quellcode und gegen ein echtes **Podman 4.9.3** (Root-Socket in der Entwicklungsumgebung): `_ping`, Version, Container auflisten/ansehen, Start/Stop/Restart inkl. 304-Fall und unbekannter ID, mit einem echten Container;
- auf einem echten Host mit **Rootless-Podman 5.8.2** (Agent und Master als Quadlet-Container im gemeinsamen Netzwerk): Registrierung im Master, `/api/v1/health` (`socketStatus: ok`, `apiStatus: ok`, Podman-Version), Containerliste und Start/Stop/Restart über die Master-Oberfläche funktionieren. Andere 5.x-Versionen sind nicht gesondert getestet.

## Updates per Web-UI
Podman hat keine REST-Route für Auto-Updates; daher: Der **Agent** zieht sein eigenes Image (nur schwebende Tags wie `latest`, `X`, `X.Y`) erneut und beendet sich mit Fehlercode, systemd (`Restart=always`) erstellt den Container aus dem neuen Image. Für den **Master** (ohne Podman-Zugriff) übernimmt das ein Agent auf demselben Host: Mit `UPDATE_UNIT=<Master-Unit>` zieht er das Master-Image und stoppt dessen Container, systemd startet ihn neu. Ohne Quadlet/systemd oder mit festem Tag wird abgelehnt. Admin-Aktion im Master.

## Container und Pods erstellen
Nur Administratoren, nur über den Master. Der Master schickt eine kleine, vom Agent erneut streng geprüfte Beschreibung (`POST /api/v1/containers`, `POST /api/v1/pods`); der Agent baut die Podman-Spezifikation selbst. Privilegierter Modus, Capabilities, Host-Pfade, Host-Namespaces und Host-Netzwerk lassen sich nicht ausdrücken. Das Formular zeigt dazu `podman run`, Quadlet und Kube-YAML (reine Textgenerierung im Master); dieselben Texte erzeugt die Container-Detailseite aus dem laufenden Container (`GET /api/v1/containers/<id>/config`, nur Administratoren, Env-Werte im Klartext).

**Geprüft:** gegen Fake-Podman, in der Entwicklungsumgebung mit Podman 4.9.3 und 5.4.2 und auf echten Hosts mit Podman 4.9.4 (RHEL) sowie 5.8.2 und 5.8.5 (Weboberfläche, Container und Pod erstellen, Vorschauen, Konfiguration, erzeugte Quadlet-Dateien unter systemd, Befehl ausführen mit Abbruch am Zeitlimit; Container und Pods löschen mit Podman 4.9.4 und 5.8.2). In der Entwicklungsumgebung: Image laden, Pod und Container anlegen und starten, Namenskonflikt, Rollback, Konfiguration lesen, `podman kube play` mit dem erzeugten YAML). Auf Podman 5 weichen zwei Dinge ab, die der Agent ausgleicht: der Inspect nennt nur die Pod-ID, und ein vergebener Containername wird mit HTTP 500 statt 409 gemeldet. Speicher-Limits wirken auf Hosts mit cgroup v2 (bestätigt mit Podman 5.8.2 und 5.8.5); auf einem Host mit cgroup v1 und rootless Podman (4.9.4 RHEL) ignoriert Podman sie, das Formular weist darauf hin. In der Entwicklungsumgebung waren Memory-Limits beim Start mit Podman 5 nicht prüfbar (kein cgroup v2 mit Controllern).

## Bewusst nicht enthalten
Pods und Container ändern (löschen können Administratoren nur gestoppte Container und Pods ohne systemd), Images bauen (Images ansehen, löschen; Pull nur als Teil von „Container erstellen“; Pods lassen sich leer anlegen, das nur Administratoren nutzen können: benannte Volumes, kein privilegierter Modus), Volumes, Netzwerke, Terminal- und Shell-Sitzungen (Befehle ausführen gibt es nur einzeln, ohne Eingabe und nur mit `EXEC_ENABLED`), Statistiken, Compose. (Pods gibt es nur als Liste, Detail, Start/Stop/Restart und schreibgeschützte Logs. Logs gibt es nur als schreibgeschützte Ansicht der letzten 150 Zeilen, kein Live-Stream.)
