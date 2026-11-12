# SSO mit SAML 2.0 und ADFS

Zusätzlich zur Anmeldung per LDAP kann der Master Benutzer per **SAML 2.0** über **Active Directory Federation Services (ADFS)** anmelden (Single Sign-on). Auf der Anmeldeseite erscheint dann der Knopf **„Mit SSO anmelden (Firmenkonto)“**. LDAP und das lokale Konto `admin` bleiben unverändert nutzbar.

> **Status:** Die SAML-Prüfung (Signatur, Aussteller, Empfänger, Gültigkeit, Wiederverwendung) ist mit selbst erzeugten, ADFS-förmigen Antworten und in einem Browser-Durchlauf mit einem nachgebauten ADFS getestet. **Gegen ein echtes ADFS 2022 ist es noch nicht geprüft.** Die ADFS-Schritte unten sind nach der ADFS-Dokumentation beschrieben; Abweichungen in Ihrer Umgebung (Anspruchsregeln, Zertifikate) sind möglich. Bei Problemen hilft das Master-Log (*Einstellungen → Master-Logs*, siehe [Fehlersuche](#fehlersuche)).

## So funktioniert die Anmeldung

1. Der Benutzer klickt auf „Mit SSO anmelden“. Der Master erzeugt eine **einmalig gültige Anmeldeanfrage** und schickt den Browser zu ADFS.
2. ADFS meldet den Benutzer an (Formular oder Windows-Anmeldung) und schickt dem Browser eine **signierte Antwort** (Assertion) zurück an den Master (`/saml/acs`).
3. Der Master prüft Signatur, Aussteller, Empfänger, Gültigkeitszeit und dass die Antwort zu seiner Anfrage gehört und noch nie verwendet wurde. Er liest Benutzername und Gruppen aus den Ansprüchen (Claims).
4. Die Rechte folgen den gleichen Regeln wie bei LDAP: Mitglieder der **Administrator-Gruppe** sehen alle Agents, Mitglieder einer **Agent-Gruppe** mit passender *SAML-Gruppe* sehen deren Agents, alle anderen werden abgewiesen. Versteckte Container und alle weiteren Regeln gelten unverändert.

## Voraussetzungen

- **Öffentliche https-Adresse des Masters**, z. B. `https://master.example.com`, in der Regel über Ihren Reverse Proxy (siehe [Master-Installation](installation-master.md#hinter-einem-reverse-proxy)). ADFS erwartet für die Rückleitung normalerweise https. Der Proxy muss `POST /saml/acs` unverändert an den Master weitergeben.
- **ADFS 2022** (SAML 2.0 ist seit ADFS 2012 R2 eingebaut). Der Master muss die Adresse von ADFS im **Browser** erreichen, nicht selbst. Nur der Metadaten-Import läuft vom Master aus (oder Sie fügen die XML-Datei ein).
- **Synchrone Uhren** (NTP) auf ADFS und Master. Eine Abweichung bis zu 2 Minuten wird toleriert.
- Das lokale Konto `admin` zum Einrichten (die Einstellungen sind nur für dieses Konto sichtbar).

## Schritt 1: Vertrauensstellung in ADFS anlegen

Die Werte für ADFS zeigt der Master unter *Einstellungen → SSO (SAML 2.0 / ADFS)*, sobald die öffentliche Adresse gespeichert ist:

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

## Schritt 2: Ansprüche (Claims) ausgeben

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

## Schritt 3: Master einrichten

Unter *Einstellungen → SSO (SAML 2.0 / ADFS)* (als lokaler `admin`):

1. **ADFS-Metadaten importieren:** Adresse eintragen, in ADFS 2022 ist das
   `https://adfs.corp.example.com/FederationMetadata/2007-06/FederationMetadata.xml`
   (oder den XML-Inhalt einfügen), dann *Importieren*. Das füllt **Entity-ID**, **Anmeldeadresse** und das **Tokensignaturzertifikat**. Hat der Master das ADFS-Zertifikat der Webseite nicht im Vertrauensspeicher (Firmen-CA), siehe `NODE_EXTRA_CA_CERTS` in der [Master-Installation](installation-master.md); oder die XML-Datei einfügen.
2. **Öffentliche Adresse des Masters** eintragen (`https://master.example.com`, ohne Pfad).
3. **Administrator-Gruppe** eintragen, z. B. `CORP\PodmanAdmins` (leer lassen, wenn es keine SSO-Administratoren geben soll).
4. Claim-Namen nur ändern, wenn Ihre Regeln andere Typen senden.
5. **Prüfen** zeigt Zertifikat (Ablaufdatum), die Werte für ADFS und Hinweise (z. B. wenn die Adresse http statt https nutzt). Dann **SSO aktivieren** und **Speichern**.

## Schritt 4: Agent-Gruppen zuordnen

Unter *Agent-Gruppen* bekommt jede Gruppe das Feld **SAML-Gruppe** (z. B. `CORP\Team-A`). Eine Gruppe braucht eine **AD-Gruppe** (für LDAP) und/oder eine **SAML-Gruppe** (für SSO); beide dürfen gesetzt sein. Wer in mehreren Gruppen ist, sieht die Agents aller Gruppen.

## Zertifikatwechsel bei ADFS

ADFS erneuert sein Tokensignaturzertifikat in der Regel automatisch (*Automatische Zertifikatsverlängerung*). Der Master prüft Signaturen gegen das gespeicherte Zertifikat. Importieren Sie deshalb **nach einem Zertifikatwechsel die Metadaten erneut** (ADFS veröffentlicht das neue Zertifikat in den Metadaten, bevor es aktiv wird; der Master akzeptiert alle importierten). Die Seite *Prüfen* zeigt das Ablaufdatum.

## Fehlersuche

Schlägt eine SSO-Anmeldung fehl, steht der **Grund im Master-Log** (*Einstellungen → Master-Logs → Logs anzeigen*), Zeilen `saml login started: …` (was der Master an ADFS gesendet hat), `saml login failed: …` und `saml login denied: …`. Dem Benutzer zeigt der Master bewusst nur eine kurze Meldung.

| Meldung im Master-Log | Ursache und Lösung |
|---|---|
| `no matching group (received: …)` | Anmeldung gelungen, aber kein Gruppenwert passt. Die ausgegebene Liste zeigt, was ADFS gesendet hat: Schreibweise (`CORP\Team-A`) und Anspruchsregel in ADFS prüfen, Eintrag bei *SAML-Gruppe* anpassen. |
| `ADFS answered with an error: Responder > RequestDenied` | **ADFS hat die Anfrage abgelehnt und nennt keinen Grund**; der Master kann ihn nicht erfahren. Die Zeile nennt Bezeichner und Anmelde-Endpunkt, die der Master gesendet hat. Prüfen Sie in ADFS: (1) **Zugriffssteuerungsrichtlinie / Ausgabeautorisierungsregeln** der Vertrauensstellung: ist der Benutzer zugelassen (z. B. „Bestimmte Gruppe zulassen“, Mehrstufige Authentifizierung)? (2) Entspricht der **Bezeichner** der Vertrauensstellung genau dem Bezeichner aus der Zeile und der **SAML-Endpunkt** (ACS, POST) der Adresse? Am einfachsten die Vertrauensstellung aus den Metadaten des Masters neu anlegen. (3) Den eigentlichen Grund nennt das ADFS-Ereignisprotokoll (*Ereignisanzeige → Anwendungs- und Dienstprotokolle → AD FS → Admin*), bei aktivierter ADFS-Überwachung auch das Sicherheitsprotokoll. |
| `Invalid signature` / `Invalid document signature` | Das gespeicherte Zertifikat passt nicht zur Signatur: Metadaten erneut importieren (Zertifikatwechsel). Sendet ADFS die Assertion unsigniert, in ADFS die Signatur nicht abschalten. |
| `SAML assertion audience mismatch` | Der **Bezeichner** der Vertrauensstellung in ADFS ist nicht die Entity-ID des Masters (`https://…/saml/metadata`). Öffentliche Adresse und ADFS-Bezeichner angleichen. |
| `Unknown SAML issuer` | Die *ADFS-Entity-ID* im Master weicht von der in den Metadaten ab (ADFS nutzt oft `http://…/adfs/services/trust`, nicht https). Metadaten importieren statt von Hand eintippen. |
| `SAML assertion not yet valid` / `No valid subject confirmation found …` | Die Uhren von ADFS und Master weichen um mehr als 2 Minuten ab (zu früh/abgelaufen). NTP prüfen. |
| `… not addressed to this sign-in endpoint (Recipient …)` | Der Anmelde-Endpunkt (ACS) in ADFS stimmt nicht mit `…/saml/acs` des Masters überein, etwa durch eine andere öffentliche Adresse. Vertrauensstellung aus den Metadaten neu anlegen. |
| `InResponseTo is not valid` | Die Antwort gehört zu keiner (oder einer schon benutzten oder abgelaufenen) Anfrage: Anmeldeseite länger als 8 Minuten offen, Zurück-Taste benutzt, die Seite erneut gesendet, oder die Datenbank des Masters wurde zwischendurch ausgetauscht. Einfach erneut anmelden. |
| `response does not belong to this browser` | Bei https-Adresse muss die Antwort im selben Browser ankommen, der die Anmeldung gestartet hat. Der Cookie `pm_saml_nonce` wird mit `SameSite=None; Secure` gesetzt; wird er blockiert, oder ist die öffentliche Adresse nicht wirklich https, scheitert die Anmeldung. |
| ADFS zeigt selbst einen Fehler | Das ADFS-Ereignisprotokoll (*Anwendungs- und Dienstprotokolle → AD FS → Admin*) nennt die Ursache, z. B. unbekannte vertrauende Seite (Bezeichner stimmt nicht) oder fehlerhafte Anspruchsregeln. |

## Sicherheit

- Anmeldeantworten werden nur akzeptiert, wenn die **Assertion signiert** ist (ADFS-Zertifikat aus der Konfiguration), Aussteller und Empfänger stimmen und die Gültigkeitszeit passt. Unsignierte oder mit anderem Schlüssel signierte Antworten werden abgewiesen.
- Jede Antwort gehört zu einer **einmaligen Anfrage** des Masters (`InResponseTo`, 8 Minuten gültig) und kann **nicht wiederverwendet** werden, auch nicht mit derselben Assertion-ID. Der Zustand liegt in der Datenbank.
- Bei https-Adresse bindet ein Cookie (`pm_saml_nonce`, `HttpOnly`, `Secure`, `SameSite=None`) die Antwort an den Browser, der die Anmeldung gestartet hat (Schutz vor untergeschobenen Anmeldungen).
- Nach erfolgreicher Anmeldung wird derselbe Sitzungscookie wie bei LDAP gesetzt (`HttpOnly`, `SameSite=Strict`, 8 Stunden). Die Weiterleitung nach der POST-Antwort erfolgt clientseitig, damit der Strict-Cookie mitgeschickt wird; Rücksprungziele sind auf eigene Pfade begrenzt.
- Nicht enthalten: verschlüsselte Assertions, signierte Anfragen, Single Logout (Abmelden beendet nur die Sitzung im Master; ein erneuter Klick auf SSO meldet ohne Passwort wieder an, solange die ADFS-Sitzung besteht), mehrere Identitätsanbieter.
