# SSO mit SAML 2.0 (ADFS, Microsoft Entra ID, Okta, Keycloak, eigener Anbieter)

Zusätzlich zur Anmeldung per LDAP kann der Master Benutzer per **SAML 2.0** über einen Identitätsanbieter anmelden (Single Sign-on): **Active Directory Federation Services (ADFS)**, **Microsoft Entra ID**, **Okta**, **Keycloak** oder jeden anderen SAML-2.0-konformen Anbieter. Auf der Anmeldeseite erscheint dann ein SSO-Knopf (Standardtext „Mit SSO anmelden“, anpassbar). LDAP und das lokale Konto `admin` bleiben unverändert nutzbar. Es ist **ein** Identitätsanbieter gleichzeitig konfigurierbar.

> **Status:** Die SAML-Prüfung (Signatur, Aussteller, Empfänger, Gültigkeit, Wiederverwendung) ist mit selbst erzeugten Antworten und in einem Browser-Durchlauf mit einem nachgebauten Anbieter getestet, auch mit Antworten im Stil von Entra ID, Okta und Keycloak. **Gegen echte Systeme ist nichts davon geprüft**, auch ADFS 2022 nicht. Die Schritte für die einzelnen Anbieter sind nach deren Dokumentation beschrieben; Menünamen und Voreinstellungen ändern sich, bitte gleichen Sie sie mit der aktuellen Dokumentation Ihres Anbieters ab. Bei Problemen hilft das Master-Log (*Einstellungen → Registerkarte „Logs“*, siehe [Fehlersuche](#fehlersuche)).

## So funktioniert die Anmeldung

1. Der Benutzer klickt auf den SSO-Knopf. Der Master erzeugt eine **einmalig gültige Anmeldeanfrage** und schickt den Browser zum Identitätsanbieter.
2. Der Anbieter meldet den Benutzer an (Formular, Windows-Anmeldung, Mehrfaktor, …) und schickt dem Browser eine **signierte Antwort** (Assertion) zurück an den Master (`/saml/acs`).
3. Der Master prüft Signatur, Aussteller, Empfänger, Gültigkeitszeit und dass die Antwort zu seiner Anfrage gehört und noch nie verwendet wurde. Er liest Benutzername und Gruppen aus den Ansprüchen (Claims, bei manchen Anbietern „Attribute“).
4. Die Rechte folgen den gleichen Regeln wie bei LDAP: Mitglieder der **Administrator-Gruppe** sehen alle Agents, Mitglieder einer **Agent-Gruppe** mit passender *SAML-Gruppe* sehen deren Agents, alle anderen werden abgewiesen. Versteckte Container und alle weiteren Regeln gelten unverändert.

## Voraussetzungen

- **Öffentliche https-Adresse des Masters**, z. B. `https://master.example.com`, in der Regel über Ihren Reverse Proxy (siehe [Master-Installation](installation-master.md#hinter-einem-reverse-proxy)). Die Anbieter erwarten für die Rückleitung normalerweise https. Der Proxy muss `POST /saml/acs` unverändert an den Master weitergeben.
- Der Master muss die Adresse des Anbieters nicht selbst erreichen, aber der **Browser** des Benutzers. Nur der Metadaten-Import läuft vom Master aus (oder Sie fügen die XML-Datei ein).
- **Synchrone Uhren** (NTP) beim Anbieter und im Master. Eine Abweichung bis zu 2 Minuten wird toleriert.
- Ein Administrator-Konto zum Einrichten: das lokale Konto `admin` (oder ein Mitglied der Administratoren-Gruppe von LDAP/SSO). Die Einstellungen sehen nur Administratoren.
- Was der Anbieter können muss: SAML 2.0 mit **HTTP-Redirect** für die Anmeldeanfrage und **HTTP-POST** für die Antwort (der Normalfall), und die **Assertion muss signiert sein**. Der Master sendet **keine signierten Anfragen** (ein Anbieter, der das verlangt, z. B. Keycloak in der Voreinstellung, muss es abschalten) und unterstützt **keine verschlüsselten Assertions** und kein Single Logout.

## Die Werte für den Anbieter

Diese Werte zeigt der Master unter *Einstellungen → Registerkarte „SAML“*, sobald die öffentliche Adresse gespeichert ist; Sie tragen sie beim Anbieter ein (oder der Anbieter importiert die Metadaten-Adresse):

| Wert | Beispiel |
|---|---|
| Bezeichner / Entity-ID / Audience | `https://master.example.com/saml/metadata` |
| Anmelde-Endpunkt (ACS, Reply URL, Binding POST) | `https://master.example.com/saml/acs` |
| Metadaten-Adresse | `https://master.example.com/saml/metadata` |

## Anbieter im Überblick

Die Felder *Claim mit dem Benutzernamen*, *Claim mit den Gruppen* und *Angefordertes NameID-Format* befüllt die **Vorlage für den Anbieter** im Formular mit den üblichen Werten (Sie können sie danach ändern). Was Ihr Anbieter tatsächlich sendet, hängt von seiner Konfiguration ab.

| Anbieter | Benutzername | Gruppen-Claim | Gruppenwerte | NameID-Format |
|---|---|---|---|---|
| **ADFS** | Claim `…/identity/claims/upn` | `http://schemas.xmlsoap.org/claims/Group` | `DOMÄNE\Gruppe` (je nach Regel) | keins (Standard; ADFS lehnt eines bei Windows-Anmeldung ab) |
| **Microsoft Entra ID** | Claim `…/identity/claims/name` (UPN) | `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups` | **Objekt-IDs (GUIDs)** der Gruppen, nicht Namen | keins |
| **Okta** | leer = NameID (Okta-Benutzername) | `groups` (Name Ihrer *Group Attribute Statement*) | Gruppennamen | keins (Unspecified) oder E-Mail |
| **Keycloak** | leer = NameID (Benutzername) | `groups` (Attributname Ihres *Group-list*-Mappers) | Gruppennamen (ohne vollen Pfad) | keins oder E-Mail |
| **Eigener Anbieter** | je nach Anbieter | je nach Anbieter | je nach Anbieter | nur wenn verlangt |

Im Master werden die Gruppenwerte **genau so verglichen, wie der Anbieter sie sendet** (Groß-/Kleinschreibung egal). Bei Entra ID tragen Sie also die **GUID** der Gruppe bei *SAML-Gruppe* und als *Administrator-Gruppe* ein.

## Einrichtung im Master (für alle Anbieter gleich)

Unter *Einstellungen → Registerkarte „SAML“* (als Administrator):

1. **Metadaten importieren:** Adresse oder XML des Anbieters eintragen, dann *Importieren*. Das füllt **Entity-ID**, **Anmeldeadresse** und das **Signaturzertifikat**. Hat der Master das Zertifikat der Anbieter-Webseite nicht im Vertrauensspeicher (Firmen-CA), siehe `NODE_EXTRA_CA_CERTS` in der [Master-Installation](installation-master.md), oder die XML-Datei einfügen. Ohne Import tragen Sie die drei Werte von Hand ein.
2. **Öffentliche Adresse des Masters** eintragen (`https://master.example.com`, ohne Pfad).
3. **Vorlage für den Anbieter** wählen (füllt Claim-Namen und NameID-Format) und anpassen.
4. **Administrator-Gruppe** eintragen (Wert wie in der Tabelle oben; leer lassen, wenn es keine SSO-Administratoren geben soll).
5. Optional die **Beschriftung des SSO-Knopfs** anpassen (bis 60 Zeichen, gilt für alle Sprachen), z. B. „Mit Acme Inc anmelden“. Leer lassen = Standardtext (in der jeweiligen Sprache).
6. **Prüfen** zeigt Zertifikat (Ablaufdatum), die Werte für den Anbieter und Hinweise (z. B. wenn die Adresse http statt https nutzt). Dann **SSO aktivieren** und **Speichern**.
7. Unter *Zugriff* den Agent-Gruppen die **SAML-Gruppe** zuordnen (siehe unten).

## ADFS 2022

### Vertrauensstellung anlegen

Die Werte für ADFS zeigt der Master unter *Einstellungen → Registerkarte „SAML“*, sobald die öffentliche Adresse gespeichert ist:

| Wert | Beispiel |
|---|---|
| Bezeichner / Entity-ID | `https://master.example.com/saml/metadata` |
| Anmelde-Endpunkt (ACS, POST) | `https://master.example.com/saml/acs` |
| Metadaten-Adresse | `https://master.example.com/saml/metadata` |

In der **ADFS-Verwaltung**: *Vertrauensstellungen der vertrauenden Seite → Vertrauensstellung der vertrauenden Seite hinzufügen*:

1. **Ansprüche unterstützend** wählen.
2. **Daten über die vertrauende Seite online importieren** und die Metadaten-Adresse eintragen (kann ADFS den Master nicht erreichen: die Adresse im Browser öffnen, die XML-Datei speichern und **aus einer Datei importieren**).
3. Anzeigename, z. B. *PodmanManager*. Zugriffssteuerung nach Ihrer Richtlinie (z. B. alle zulassen; die Rechte regelt der Master über die Gruppen).
4. Fertig stellen. In den **Eigenschaften** der Vertrauensstellung unter *Erweitert* den sicheren Hashalgorithmus **SHA-256** lassen.

Alternativ per PowerShell (Syntax bitte mit Ihrer ADFS-Version prüfen):
```powershell
Add-AdfsRelyingPartyTrust -Name "PodmanManager" -MetadataUrl "https://master.example.com/saml/metadata"
```

### Ansprüche (Claims) ausgeben

*Anspruchsausgaberichtlinie bearbeiten → Regel hinzufügen*. Der Master braucht einen **Benutzernamen** und die **Gruppen**.

**Regel 1: Benutzername.** Vorlage *LDAP-Attribute als Ansprüche senden*, Attributspeicher *Active Directory*:

| LDAP-Attribut | Ausgehender Anspruchstyp |
|---|---|
| User-Principal-Name | UPN |

(Ohne diesen Anspruch nimmt der Master die NameID. Der Anspruchstyp im Master ist änderbar.)

**Regel 2: Gruppen.** Der Master vergleicht den Wert **genau so, wie ADFS ihn sendet**, z. B. `CORP\Team-A` (Groß-/Kleinschreibung egal). Zwei Wege:

- **Variante A: alle Gruppen des Benutzers.** Vorlage *LDAP-Attribute als Ansprüche senden*, Attribut **Token-Groups – Qualified by Domain Name**, ausgehender Anspruchstyp **Group**. Das liefert `DOMÄNE\Gruppenname` für jede Gruppe. Bei Benutzern in sehr vielen Gruppen wird die Antwort groß.
- **Variante B: nur benötigte Gruppen (empfohlen).** Pro benötigter Gruppe eine Regel mit der Vorlage *Gruppenmitgliedschaft als Anspruch senden*: Benutzergruppe wählen, Ausgehender Anspruchstyp **Group**, Ausgehender Anspruchswert z. B. `CORP\Team-A`. Der Wert, den Sie hier eintippen, muss mit dem Eintrag im Master übereinstimmen.

Der Anspruchstyp **Group** hat die Kennung `http://schemas.xmlsoap.org/claims/Group`, UPN die Kennung `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn`. Das sind die Voreinstellungen im Master.

## Microsoft Entra ID

*Nach der Entra-Dokumentation beschrieben, nicht getestet.* Im Entra-Admin-Center:

1. *Identität → Anwendungen → Unternehmensanwendungen → Neue Anwendung → Eigene Anwendung erstellen*, „Jede andere nicht aufgeführte Anwendung integrieren (Nicht-Katalog)“. Dann *Einmaliges Anmelden → SAML*.
2. **Grundlegende SAML-Konfiguration:** *Bezeichner (Entitäts-ID)* = `https://master.example.com/saml/metadata`, *Antwort-URL (ACS)* = `https://master.example.com/saml/acs`.
3. **Attribute und Ansprüche:** Der Anspruch `…/identity/claims/name` (Benutzer-UPN) ist vorhanden. Für Gruppen *Gruppenanspruch hinzufügen*: am besten **„Der Anwendung zugewiesene Gruppen“** (begrenzt die Menge); Quellattribut **Gruppen-ID**. Der Name des Anspruchs ist dann `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups`, die Werte sind **GUIDs**. Hinweis: Ist ein Benutzer in mehr als 150 Gruppen, sendet Entra bei SAML **keine** Gruppen („Overage“); darum „zugewiesene Gruppen“ verwenden.
4. **SAML-Zertifikate → Signaturoption:** **„SAML-Assertion signieren“** (oder Antwort und Assertion). Wird nur die Antwort signiert, lehnt der Master ab.
5. **Benutzer und Gruppen:** die berechtigten Gruppen der Anwendung zuweisen.
6. **Master:** Metadaten-Adresse (*Verbundmetadaten-URL der App*, `https://login.microsoftonline.com/<Mandant>/federationmetadata/2007-06/federationmetadata.xml?appid=<App-ID>`) importieren, Vorlage **Microsoft Entra ID** wählen, als *Administrator-Gruppe* und bei den Agent-Gruppen die **Objekt-IDs** der Entra-Gruppen eintragen. Die Entity-ID des Anbieters lautet `https://sts.windows.net/<Mandanten-ID>/`; der Import trägt sie ein.

## Okta

*Nach der Okta-Dokumentation beschrieben, nicht getestet.* In der Okta-Admin-Konsole:

1. *Applications → Create App Integration → SAML 2.0*.
2. **SAML-Einstellungen:** *Single sign-on URL* = `https://master.example.com/saml/acs`, *Audience URI (SP Entity ID)* = `https://master.example.com/saml/metadata`, *Name ID format* = Unspecified (oder EmailAddress), *Application username* = Okta-Benutzername oder E-Mail.
3. **Group Attribute Statements:** Name `groups`, Filter nach Ihren Gruppen (z. B. „Starts with“ `podman`). Die Gruppennamen kommen so im Anspruch `groups` an.
4. **Signatur:** Okta signiert die Assertion standardmäßig; in den erweiterten Einstellungen *Assertion Signature = Signed* lassen. Signierte Anfragen werden nicht benötigt.
5. **Zuweisungen:** Personen/Gruppen der Anwendung zuweisen.
6. **Master:** Auf dem Reiter *Sign On* die *Identity Provider metadata*-Adresse importieren, Vorlage **Okta** wählen. Haben Sie bei Okta das NameID-Format E-Mail gewählt, bei *Angefordertes NameID-Format* ebenfalls „emailAddress“ eintragen.

## Keycloak

*Nach der Keycloak-Dokumentation beschrieben, nicht getestet.* In der Keycloak-Admin-Konsole (Realm wählen):

1. *Clients → Client erstellen*: *Client type* **SAML**, *Client ID* = `https://master.example.com/saml/metadata`.
2. **Einstellungen:** *Valid redirect URIs* = `https://master.example.com/saml/acs`, *Master SAML Processing URL* = `https://master.example.com/saml/acs`, *Name ID format* = username (oder email), *Force POST binding* an.
3. **Signaturen (wichtig):** **„Sign assertions“ einschalten** (Voreinstellung ist aus, der Master verlangt eine signierte Assertion). **„Client signature required“ ausschalten**, denn der Master sendet keine signierten Anfragen.
4. **Gruppen:** unter *Client scopes → <Client>-dedicated → Mapper hinzufügen → Group list*: *Name* `groups`, *Group attribute name* `groups`, **Full group path aus**. Der Master liest dann den Anspruch `groups`.
5. **Master:** Realm-Descriptor importieren (`https://keycloak.example.com/realms/<Realm>/protocol/saml/descriptor`), Vorlage **Keycloak** wählen. Die Entity-ID des Anbieters ist die Realm-Adresse (`https://keycloak.example.com/realms/<Realm>`).

## Eigener SAML-Anbieter

Checkliste, wenn Ihr Anbieter nicht oben steht:

1. Anbieter-Anwendung/Vertrauensstellung mit den Werten aus „Die Werte für den Anbieter“ anlegen (Entity-ID, ACS mit Binding **POST**).
2. **Assertion signieren** lassen (RSA-SHA256 oder besser); das Signaturzertifikat dem Master geben (Metadaten-Import).
3. Anfragen unsigniert zulassen; verschlüsselte Assertions ausschalten.
4. Mindestens **Benutzername** (als NameID oder als Attribut) und **Gruppen** (als Attribut mit mehreren Werten) ausgeben. Die Attributnamen im Master bei *Claim mit dem Benutzernamen* und *Claim mit den Gruppen* eintragen. Attributnamen werden **genau** verglichen; ein falscher Name ergibt „keine Gruppen“ und damit eine Abweisung, nie Zugriff.
5. Verlangt der Anbieter ein NameID-Format, bei *Angefordertes NameID-Format* eintragen.
6. *Audience* der Assertion muss die Entity-ID des Masters sein, *Recipient* die ACS-Adresse, der *Issuer* die Entity-ID aus den Anbieter-Metadaten.

## Nahtlose Anmeldung (Seamless Sign-on, optional)

In der Registerkarte „SAML“ lässt sich **Nahtlose Anmeldung** einschalten (Voreinstellung: aus). Dann erscheint die Anmeldeseite für Besucher ohne Sitzung gar nicht erst: der Master leitet sofort zum Identitätsanbieter, und nach der Anmeldung landet der Benutzer direkt im Dashboard (bei Domänen-Rechnern mit Windows-Anmeldung oft ohne jede Eingabe).

- **Nach „Abmelden“** wird die Anmeldeseite gezeigt (kein sofortiges Wiederanmelden). Das gilt, bis man sich per SSO-Knopf neu anmeldet oder den Browser schließt; danach ist wieder alles nahtlos. Der SSO-Knopf nutzt nach dem Abmelden weiterhin [ForceAuthn](#abmelden).
- **Schlägt SSO fehl** (Anbieter nicht erreichbar, Konto in keiner Gruppe, ungültige Antwort), erscheint die Anmeldeseite mit der Fehlermeldung. Es gibt keine Weiterleitungsschleife.
- **Lokales Administratorkonto:** `https://master.example.com/login?local=1` zeigt immer die Anmeldeseite mit dem Formular. Merken Sie sich diese Adresse, bevor Sie die Option einschalten; sie ist der Weg zurück, falls der Anbieter ausfällt.
- Läuft die Sitzung nach 8 Stunden ab, meldet der Master den Benutzer (wenn der Anbieter noch eine Sitzung hat) ohne Eingabe wieder an.

## Agent-Gruppen zuordnen

Unter *Agent-Gruppen* bekommt jede Gruppe das Feld **SAML-Gruppe** (z. B. `CORP\Team-A`). Eine Gruppe braucht eine **AD-Gruppe** (für LDAP) und/oder eine **SAML-Gruppe** (für SSO); beide dürfen gesetzt sein. Wer in mehreren Gruppen ist, sieht die Agents aller Gruppen.

## Zertifikatwechsel beim Anbieter

Anbieter erneuern ihr Signaturzertifikat regelmäßig (ADFS automatisch, Entra ID, Okta und Keycloak nach Einstellung). Der Master prüft Signaturen gegen das gespeicherte Zertifikat. Importieren Sie deshalb **nach einem Zertifikatwechsel die Metadaten erneut** (der Anbieter veröffentlicht das neue Zertifikat in den Metadaten, bevor es aktiv wird; der Master akzeptiert alle importierten). Die Seite *Prüfen* zeigt das Ablaufdatum.

## Fehlersuche

Schlägt eine SSO-Anmeldung fehl, steht der **Grund im Master-Log** (*Einstellungen → Registerkarte „Logs“ → Logs anzeigen*), Zeilen `saml login started: …` (was der Master an ADFS gesendet hat), `saml login failed: …` und `saml login denied: …`. Dem Benutzer zeigt der Master bewusst nur eine kurze Meldung.

| Meldung im Master-Log | Ursache und Lösung |
|---|---|
| `no matching group (received: …)` | Anmeldung gelungen, aber kein Gruppenwert passt. Die ausgegebene Liste zeigt, was ADFS gesendet hat: Schreibweise (`CORP\Team-A`) und Anspruchsregel in ADFS prüfen, Eintrag bei *SAML-Gruppe* anpassen. |
| `The identity provider answered with an error: Responder > RequestDenied` | **ADFS hat die Anfrage abgelehnt und nennt keinen Grund**; der Master kann ihn nicht erfahren. Die Zeile nennt Bezeichner und Anmelde-Endpunkt, die der Master gesendet hat. Prüfen Sie in ADFS: (1) **Zugriffssteuerungsrichtlinie / Ausgabeautorisierungsregeln** der Vertrauensstellung: ist der Benutzer zugelassen (z. B. „Bestimmte Gruppe zulassen“, Mehrstufige Authentifizierung)? (2) Entspricht der **Bezeichner** der Vertrauensstellung genau dem Bezeichner aus der Zeile und der **SAML-Endpunkt** (ACS, POST) der Adresse? Am einfachsten die Vertrauensstellung aus den Metadaten des Masters neu anlegen. (3) Den eigentlichen Grund nennt das ADFS-Ereignisprotokoll (*Ereignisanzeige → Anwendungs- und Dienstprotokolle → AD FS → Admin*), bei aktivierter ADFS-Überwachung auch das Sicherheitsprotokoll. |
| `InvalidNameIDPolicy` (Anbieter lehnt das NameID-Format ab) | Bei ADFS das Feld *Angefordertes NameID-Format* auf „keins“ stellen; bei anderen Anbietern ein Format wählen, das der Anbieter unterstützt. |
| Anmeldung gelungen, aber „keine Gruppe“ bei Entra ID | Entra sendet GUIDs, keine Gruppennamen: bei *SAML-Gruppe* die Objekt-ID eintragen. Bei mehr als 150 Gruppen fehlt der Gruppenanspruch (Overage): „der Anwendung zugewiesene Gruppen“ verwenden. |
| Keycloak: Anmeldung scheitert sofort oder „Invalid requester“ | *Client signature required* ist an (der Master signiert nicht), oder die Client-ID entspricht nicht der Entity-ID des Masters. |
| Anbieter sendet keine signierte Assertion (z. B. Keycloak „Sign assertions“ aus, Entra „SAML-Antwort signieren“) | Der Master lehnt ab (Meldung zur fehlenden Signatur). Beim Anbieter die **Assertion** signieren lassen. |
| `Invalid signature` / `Invalid document signature` | Das gespeicherte Zertifikat passt nicht zur Signatur: Metadaten erneut importieren (Zertifikatwechsel). Sendet ADFS die Assertion unsigniert, in ADFS die Signatur nicht abschalten. |
| `SAML assertion audience mismatch` | Der **Bezeichner** der Vertrauensstellung in ADFS ist nicht die Entity-ID des Masters (`https://…/saml/metadata`). Öffentliche Adresse und ADFS-Bezeichner angleichen. |
| `Unknown SAML issuer` | Die *Entity-ID des Identitätsanbieters* im Master weicht von der in den Metadaten ab (ADFS nutzt oft `http://…/adfs/services/trust`, nicht https). Metadaten importieren statt von Hand eintippen. |
| `SAML assertion not yet valid` / `No valid subject confirmation found …` | Die Uhren von ADFS und Master weichen um mehr als 2 Minuten ab (zu früh/abgelaufen). NTP prüfen. |
| `… not addressed to this sign-in endpoint (Recipient …)` | Der Anmelde-Endpunkt (ACS) in ADFS stimmt nicht mit `…/saml/acs` des Masters überein, etwa durch eine andere öffentliche Adresse. Vertrauensstellung aus den Metadaten neu anlegen. |
| `InResponseTo is not valid` | Die Antwort gehört zu keiner (oder einer schon benutzten oder abgelaufenen) Anfrage: Anmeldeseite länger als 8 Minuten offen, Zurück-Taste benutzt, die Seite erneut gesendet, oder die Datenbank des Masters wurde zwischendurch ausgetauscht. Einfach erneut anmelden. |
| `response does not belong to this browser` | Bei https-Adresse muss die Antwort im selben Browser ankommen, der die Anmeldung gestartet hat. Der Cookie `pm_saml_nonce` wird mit `SameSite=None; Secure` gesetzt; wird er blockiert, oder ist die öffentliche Adresse nicht wirklich https, scheitert die Anmeldung. |
| Der Anbieter zeigt selbst einen Fehler | Das Protokoll des Anbieters nennt die Ursache (ADFS: Ereignisanzeige → AD FS → Admin; Entra ID: Anmeldeprotokolle; Okta: System Log; Keycloak: Ereignisse). Bei ADFS: das ADFS-Ereignisprotokoll (*Anwendungs- und Dienstprotokolle → AD FS → Admin*) nennt die Ursache, z. B. unbekannte vertrauende Seite (Bezeichner stimmt nicht) oder fehlerhafte Anspruchsregeln. |

## Sicherheit

- Anmeldeantworten werden nur akzeptiert, wenn die **Assertion signiert** ist (Anbieter-Zertifikat aus der Konfiguration), Aussteller und Empfänger stimmen und die Gültigkeitszeit passt. Unsignierte oder mit anderem Schlüssel signierte Antworten werden abgewiesen.
- Jede Antwort gehört zu einer **einmaligen Anfrage** des Masters (`InResponseTo`, 8 Minuten gültig) und kann **nicht wiederverwendet** werden, auch nicht mit derselben Assertion-ID. Der Zustand liegt in der Datenbank.
- Bei https-Adresse bindet ein Cookie (`pm_saml_nonce`, `HttpOnly`, `Secure`, `SameSite=None`) die Antwort an den Browser, der die Anmeldung gestartet hat (Schutz vor untergeschobenen Anmeldungen).
- Nach erfolgreicher Anmeldung wird derselbe Sitzungscookie wie bei LDAP gesetzt (`HttpOnly`, `SameSite=Strict`, 8 Stunden). Die Weiterleitung nach der POST-Antwort erfolgt clientseitig, damit der Strict-Cookie mitgeschickt wird; Rücksprungziele sind auf eigene Pfade begrenzt.
- Nicht enthalten: verschlüsselte Assertions, signierte Anfragen, Single Logout (Abmelden beendet nur die Sitzung im Master, nicht die beim Identitätsanbieter; dafür fordert der Master beim nächsten SSO-Login nach dem Abmelden mit **ForceAuthn** eine erneute Anmeldung an, siehe Abschnitt „Abmelden“), mehrere Identitätsanbieter gleichzeitig.

## Abmelden

*Abmelden* im Master beendet nur die **Master-Sitzung**; die Sitzung beim Identitätsanbieter (z. B. ADFS) bleibt bestehen (kein Single Logout). Damit ein Klick auf den SSO-Knopf danach nicht ohne Eingabe wieder anmeldet, merkt sich der Master den Abmelde-Vorgang in einem kurzlebigen Cookie (`pm_saml_reauth`, nur für `/saml`, 30 Tage, ohne Geheimnis). Der **nächste** SSO-Login sendet dann `ForceAuthn="true"` in der Anmeldeanfrage; der Anbieter muss den Benutzer erneut authentifizieren. Nach erfolgreicher Anmeldung wird das Cookie gelöscht. Es gilt nur nach dem Abmelden einer SSO-Sitzung (nicht nach lokaler oder LDAP-Anmeldung) und nur in diesem Browser.

Grenzen: Mit **Windows-integrierter Anmeldung** (Kerberos) kann ADFS die erneute Authentifizierung ohne Eingabe erfüllen, weil der Browser das Ticket automatisch sendet; die Maßnahme schützt vor allem bei Formular-Anmeldung. Meldet sich der Benutzer nicht ab (Browser einfach geschlossen), gilt die Master-Sitzung bis zu 8 Stunden. Eine echte Abmeldung beim Anbieter (Single Logout) gibt es nicht.
