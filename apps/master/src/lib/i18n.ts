export const LANGS = ["en", "de", "ro", "es"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAMES: Record<Lang, string> = { en: "English", de: "Deutsch", ro: "Română", es: "Español" };
export const LANG_COOKIE = "pm_lang";
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

const en = {
  "nav.dashboard": "Dashboard", "nav.hosts": "Hosts", "nav.containers": "Containers", "nav.settings": "Settings",
  "common.confirm": "Confirm", "common.cancel": "Cancel", "common.na": "n/a",
  "lang.label": "Language",
  "status.online": "online", "status.offline": "offline", "status.degraded": "degraded", "status.running": "running",
  "status.exited": "exited", "status.stopped": "stopped", "status.disabled": "disabled", "status.unknown": "unknown",
  "status.created": "created", "status.paused": "paused",
  "dash.title": "Dashboard", "dash.hosts": "Hosts", "dash.reachable": "Reachable", "dash.unreachable": "Unreachable",
  "dash.other": "Disabled / pending", "dash.containers": "Containers", "dash.running": "Running", "dash.stopped": "Stopped",
  "dash.excluded": "Container counts exclude {n} host(s) that could not be queried: {names}.",
  "dash.empty": "No hosts registered yet. Add an agent under Hosts.",
  "hosts.title": "Hosts", "hosts.hostname": "Hostname", "hosts.agentId": "Agent ID", "hosts.address": "Address",
  "hosts.status": "Status", "hosts.heartbeat": "Last heartbeat", "hosts.podman": "Podman", "hosts.containers": "Containers",
  "hosts.none": "No agents registered.", "hosts.add": "Add agent", "hosts.addrLabel": "Agent address",
  "hosts.tokenLabel": "Agent token", "hosts.register": "Test connection & register", "hosts.test": "Test",
  "hosts.disable": "Disable", "hosts.enable": "Enable", "hosts.remove": "Remove", "hosts.removeQ": "Remove {name}?",
  "hosts.cardMeta": "Heartbeat: {hb} · Podman {pv} · {n} containers",
  "cont.title": "Containers", "cont.allHosts": "All hosts", "cont.anyStatus": "Any status", "cont.running": "Running",
  "cont.notRunning": "Not running", "cont.namePh": "Container name", "cont.filter": "Filter", "cont.name": "Name",
  "cont.id": "ID", "cont.host": "Host", "cont.image": "Image", "cont.status": "Status", "cont.created": "Created",
  "cont.started": "Started", "cont.actions": "Actions", "cont.none": "No containers found.",
  "cont.unavailable": "{host}: containers unavailable — {msg}",
  "act.start": "Start", "act.stop": "Stop", "act.restart": "Restart", "act.stopQ": "Stop “{name}”?",
  "act.restartQ": "Restart “{name}”?", "act.working": "working…",
  "detail.back": "← Containers", "detail.notFound": "Container not found.", "detail.disabled": "Host {host} is disabled.",
  "detail.noCreds": "Credentials missing", "detail.cid": "Container ID",
  "set.title": "Settings", "set.monitoring": "Monitoring (set via environment)", "set.interval": "Heartbeat interval",
  "set.timeout": "Agent timeout", "set.failures": "Offline after failed checks", "set.changePw": "Change password",
  "set.current": "Current password", "set.new": "New password (min. 10)", "set.repeat": "Repeat new password",
  "set.changeBtn": "Change password", "set.logout": "Log out",
  "auth.signIn": "Sign in", "auth.createAdmin": "Create admin password", "auth.password": "Password", "auth.repeat": "Repeat password",
  "msg.pwShort": "Password must be at least {n} characters", "msg.pwMismatch": "Passwords do not match",
  "msg.tooMany": "Too many failed attempts. Try again in a minute.", "msg.pwInvalid": "Invalid password",
  "msg.curWrong": "Current password is wrong", "msg.pwChanged": "Password changed", "msg.agentAdded": "Agent registered",
  "msg.agentRemoved": "Agent removed", "msg.updated": "Updated", "msg.invalidAgent": "Invalid agent",
  "msg.agentDisabled": "Agent is disabled", "msg.connOk": "Connection and authentication OK",
  "msg.connDegraded": "Agent reachable, Podman problem: {err}", "msg.checkFailed": "Check failed",
  "msg.opNotAllowed": "Action not allowed", "msg.invalidId": "Invalid container id", "msg.unknownHost": "Unknown host",
  "msg.hostDisabled": "Host is disabled", "msg.noCreds": "Host credentials missing",
  "msg.opOk": "{action} succeeded: now {state}", "msg.opNoChange": "No change needed ({state})",
  "msg.opFailed": "{action} failed: {msg} ({code})",
  "err.invalidAddress": "Invalid address. Expected http://host:port", "err.invalidToken": "Invalid token format",
  "err.alreadyRegistered": "Agent already registered", "err.authFailed": "Authentication failed: token rejected by agent",
  "err.connFailed": "Connection test failed: {msg}", "err.agentIdTaken": "Agent ID \"{id}\" already registered",
  "errc.TIMEOUT": "Agent did not respond in time", "errc.UNREACHABLE": "Agent not reachable",
  "errc.BAD_RESPONSE": "Unexpected response from agent", "errc.INVALID_ID": "Invalid container id",
  "errc.UNAUTHORIZED": "Token missing or invalid", "errc.RATE_LIMITED": "Too many failed attempts",
  "errc.SOCKET_MISSING": "Podman socket not found", "errc.SOCKET_UNREACHABLE": "Podman socket not reachable",
  "errc.PODMAN_API_ERROR": "Podman API error", "errc.PODMAN_TIMEOUT": "Podman does not respond",
  "errc.CONTAINER_NOT_FOUND": "Container not found", "errc.INTERNAL": "Internal error", "errc.NOT_FOUND": "Not found",
  "errc.SKIPPED": "Not queried (disabled or credentials unreadable)",
} as const;

export type Key = keyof typeof en;
type Dict = Record<Key, string>;

const de: Dict = {
  "nav.dashboard": "Dashboard", "nav.hosts": "Hosts", "nav.containers": "Container", "nav.settings": "Einstellungen",
  "common.confirm": "Bestätigen", "common.cancel": "Abbrechen", "common.na": "k. A.",
  "lang.label": "Sprache",
  "status.online": "online", "status.offline": "offline", "status.degraded": "eingeschränkt", "status.running": "läuft",
  "status.exited": "beendet", "status.stopped": "gestoppt", "status.disabled": "deaktiviert", "status.unknown": "unbekannt",
  "status.created": "erstellt", "status.paused": "pausiert",
  "dash.title": "Dashboard", "dash.hosts": "Hosts", "dash.reachable": "Erreichbar", "dash.unreachable": "Nicht erreichbar",
  "dash.other": "Deaktiviert / ausstehend", "dash.containers": "Container", "dash.running": "Laufend", "dash.stopped": "Gestoppt",
  "dash.excluded": "Die Container-Zahlen enthalten {n} Host(s) nicht, die nicht abgefragt werden konnten: {names}.",
  "dash.empty": "Noch keine Hosts registriert. Fügen Sie unter Hosts einen Agent hinzu.",
  "hosts.title": "Hosts", "hosts.hostname": "Hostname", "hosts.agentId": "Agent-ID", "hosts.address": "Adresse",
  "hosts.status": "Status", "hosts.heartbeat": "Letzter Heartbeat", "hosts.podman": "Podman", "hosts.containers": "Container",
  "hosts.none": "Keine Agents registriert.", "hosts.add": "Agent hinzufügen", "hosts.addrLabel": "Agent-Adresse",
  "hosts.tokenLabel": "Agent-Token", "hosts.register": "Verbindung testen & registrieren", "hosts.test": "Testen",
  "hosts.disable": "Deaktivieren", "hosts.enable": "Aktivieren", "hosts.remove": "Entfernen", "hosts.removeQ": "{name} entfernen?",
  "hosts.cardMeta": "Heartbeat: {hb} · Podman {pv} · {n} Container",
  "cont.title": "Container", "cont.allHosts": "Alle Hosts", "cont.anyStatus": "Beliebiger Status", "cont.running": "Laufend",
  "cont.notRunning": "Nicht laufend", "cont.namePh": "Containername", "cont.filter": "Filtern", "cont.name": "Name",
  "cont.id": "ID", "cont.host": "Host", "cont.image": "Image", "cont.status": "Status", "cont.created": "Erstellt",
  "cont.started": "Gestartet", "cont.actions": "Aktionen", "cont.none": "Keine Container gefunden.",
  "cont.unavailable": "{host}: Container nicht verfügbar — {msg}",
  "act.start": "Start", "act.stop": "Stopp", "act.restart": "Neustart", "act.stopQ": "„{name}“ stoppen?",
  "act.restartQ": "„{name}“ neu starten?", "act.working": "Bitte warten …",
  "detail.back": "← Container", "detail.notFound": "Container nicht gefunden.", "detail.disabled": "Host {host} ist deaktiviert.",
  "detail.noCreds": "Zugangsdaten fehlen", "detail.cid": "Container-ID",
  "set.title": "Einstellungen", "set.monitoring": "Überwachung (per Umgebungsvariablen gesetzt)", "set.interval": "Heartbeat-Intervall",
  "set.timeout": "Agent-Timeout", "set.failures": "Offline nach fehlgeschlagenen Prüfungen", "set.changePw": "Passwort ändern",
  "set.current": "Aktuelles Passwort", "set.new": "Neues Passwort (mind. 10)", "set.repeat": "Neues Passwort wiederholen",
  "set.changeBtn": "Passwort ändern", "set.logout": "Abmelden",
  "auth.signIn": "Anmelden", "auth.createAdmin": "Admin-Passwort festlegen", "auth.password": "Passwort", "auth.repeat": "Passwort wiederholen",
  "msg.pwShort": "Das Passwort muss mindestens {n} Zeichen lang sein", "msg.pwMismatch": "Die Passwörter stimmen nicht überein",
  "msg.tooMany": "Zu viele Fehlversuche. Bitte in einer Minute erneut versuchen.", "msg.pwInvalid": "Ungültiges Passwort",
  "msg.curWrong": "Das aktuelle Passwort ist falsch", "msg.pwChanged": "Passwort geändert", "msg.agentAdded": "Agent registriert",
  "msg.agentRemoved": "Agent entfernt", "msg.updated": "Aktualisiert", "msg.invalidAgent": "Ungültiger Agent",
  "msg.agentDisabled": "Agent ist deaktiviert", "msg.connOk": "Verbindung und Authentifizierung in Ordnung",
  "msg.connDegraded": "Agent erreichbar, Podman-Problem: {err}", "msg.checkFailed": "Prüfung fehlgeschlagen",
  "msg.opNotAllowed": "Aktion nicht erlaubt", "msg.invalidId": "Ungültige Container-ID", "msg.unknownHost": "Unbekannter Host",
  "msg.hostDisabled": "Host ist deaktiviert", "msg.noCreds": "Zugangsdaten des Hosts fehlen",
  "msg.opOk": "{action} erfolgreich: jetzt {state}", "msg.opNoChange": "Keine Änderung nötig ({state})",
  "msg.opFailed": "{action} fehlgeschlagen: {msg} ({code})",
  "err.invalidAddress": "Ungültige Adresse. Erwartet: http://host:port", "err.invalidToken": "Ungültiges Token-Format",
  "err.alreadyRegistered": "Agent ist bereits registriert", "err.authFailed": "Authentifizierung fehlgeschlagen: Token vom Agent abgelehnt",
  "err.connFailed": "Verbindungstest fehlgeschlagen: {msg}", "err.agentIdTaken": "Agent-ID „{id}“ ist bereits registriert",
  "errc.TIMEOUT": "Agent hat nicht rechtzeitig geantwortet", "errc.UNREACHABLE": "Agent nicht erreichbar",
  "errc.BAD_RESPONSE": "Unerwartete Antwort des Agents", "errc.INVALID_ID": "Ungültige Container-ID",
  "errc.UNAUTHORIZED": "Token fehlt oder ist ungültig", "errc.RATE_LIMITED": "Zu viele Fehlversuche",
  "errc.SOCKET_MISSING": "Podman-Socket nicht gefunden", "errc.SOCKET_UNREACHABLE": "Podman-Socket nicht erreichbar",
  "errc.PODMAN_API_ERROR": "Podman-API-Fehler", "errc.PODMAN_TIMEOUT": "Podman antwortet nicht",
  "errc.CONTAINER_NOT_FOUND": "Container nicht gefunden", "errc.INTERNAL": "Interner Fehler", "errc.NOT_FOUND": "Nicht gefunden",
  "errc.SKIPPED": "Nicht abgefragt (deaktiviert oder Zugangsdaten nicht lesbar)",
};

const ro: Dict = {
  "nav.dashboard": "Panou", "nav.hosts": "Gazde", "nav.containers": "Containere", "nav.settings": "Setări",
  "common.confirm": "Confirmă", "common.cancel": "Anulează", "common.na": "n/d",
  "lang.label": "Limbă",
  "status.online": "online", "status.offline": "offline", "status.degraded": "degradat", "status.running": "rulează",
  "status.exited": "oprit", "status.stopped": "oprit", "status.disabled": "dezactivat", "status.unknown": "necunoscut",
  "status.created": "creat", "status.paused": "în pauză",
  "dash.title": "Panou", "dash.hosts": "Gazde", "dash.reachable": "Accesibile", "dash.unreachable": "Inaccesibile",
  "dash.other": "Dezactivate / în așteptare", "dash.containers": "Containere", "dash.running": "În execuție", "dash.stopped": "Oprite",
  "dash.excluded": "Numărul de containere nu include {n} gazdă/gazde care nu au putut fi interogate: {names}.",
  "dash.empty": "Nicio gazdă înregistrată încă. Adăugați un agent la Gazde.",
  "hosts.title": "Gazde", "hosts.hostname": "Nume gazdă", "hosts.agentId": "ID agent", "hosts.address": "Adresă",
  "hosts.status": "Stare", "hosts.heartbeat": "Ultimul heartbeat", "hosts.podman": "Podman", "hosts.containers": "Containere",
  "hosts.none": "Niciun agent înregistrat.", "hosts.add": "Adaugă agent", "hosts.addrLabel": "Adresa agentului",
  "hosts.tokenLabel": "Token agent", "hosts.register": "Testează conexiunea și înregistrează", "hosts.test": "Testează",
  "hosts.disable": "Dezactivează", "hosts.enable": "Activează", "hosts.remove": "Elimină", "hosts.removeQ": "Eliminați {name}?",
  "hosts.cardMeta": "Heartbeat: {hb} · Podman {pv} · {n} containere",
  "cont.title": "Containere", "cont.allHosts": "Toate gazdele", "cont.anyStatus": "Orice stare", "cont.running": "În execuție",
  "cont.notRunning": "Nu rulează", "cont.namePh": "Nume container", "cont.filter": "Filtrează", "cont.name": "Nume",
  "cont.id": "ID", "cont.host": "Gazdă", "cont.image": "Imagine", "cont.status": "Stare", "cont.created": "Creat",
  "cont.started": "Pornit", "cont.actions": "Acțiuni", "cont.none": "Nu s-au găsit containere.",
  "cont.unavailable": "{host}: containere indisponibile — {msg}",
  "act.start": "Pornește", "act.stop": "Oprește", "act.restart": "Repornește", "act.stopQ": "Opriți „{name}”?",
  "act.restartQ": "Reporniți „{name}”?", "act.working": "Se procesează…",
  "detail.back": "← Containere", "detail.notFound": "Containerul nu a fost găsit.", "detail.disabled": "Gazda {host} este dezactivată.",
  "detail.noCreds": "Lipsesc datele de autentificare", "detail.cid": "ID container",
  "set.title": "Setări", "set.monitoring": "Monitorizare (setată prin variabile de mediu)", "set.interval": "Interval heartbeat",
  "set.timeout": "Timeout agent", "set.failures": "Offline după verificări eșuate", "set.changePw": "Schimbă parola",
  "set.current": "Parola curentă", "set.new": "Parola nouă (min. 10)", "set.repeat": "Repetați parola nouă",
  "set.changeBtn": "Schimbă parola", "set.logout": "Deconectare",
  "auth.signIn": "Autentificare", "auth.createAdmin": "Creați parola de administrator", "auth.password": "Parolă", "auth.repeat": "Repetați parola",
  "msg.pwShort": "Parola trebuie să aibă cel puțin {n} caractere", "msg.pwMismatch": "Parolele nu coincid",
  "msg.tooMany": "Prea multe încercări eșuate. Încercați din nou peste un minut.", "msg.pwInvalid": "Parolă incorectă",
  "msg.curWrong": "Parola curentă este greșită", "msg.pwChanged": "Parola a fost schimbată", "msg.agentAdded": "Agent înregistrat",
  "msg.agentRemoved": "Agent eliminat", "msg.updated": "Actualizat", "msg.invalidAgent": "Agent invalid",
  "msg.agentDisabled": "Agentul este dezactivat", "msg.connOk": "Conexiune și autentificare reușite",
  "msg.connDegraded": "Agent accesibil, problemă Podman: {err}", "msg.checkFailed": "Verificarea a eșuat",
  "msg.opNotAllowed": "Acțiune nepermisă", "msg.invalidId": "ID de container invalid", "msg.unknownHost": "Gazdă necunoscută",
  "msg.hostDisabled": "Gazda este dezactivată", "msg.noCreds": "Lipsesc datele de autentificare ale gazdei",
  "msg.opOk": "{action} reușită: acum {state}", "msg.opNoChange": "Nicio modificare necesară ({state})",
  "msg.opFailed": "{action} eșuată: {msg} ({code})",
  "err.invalidAddress": "Adresă invalidă. Format așteptat: http://host:port", "err.invalidToken": "Format de token invalid",
  "err.alreadyRegistered": "Agentul este deja înregistrat", "err.authFailed": "Autentificare eșuată: tokenul a fost respins de agent",
  "err.connFailed": "Testul de conexiune a eșuat: {msg}", "err.agentIdTaken": "ID-ul de agent „{id}” este deja înregistrat",
  "errc.TIMEOUT": "Agentul nu a răspuns la timp", "errc.UNREACHABLE": "Agent inaccesibil",
  "errc.BAD_RESPONSE": "Răspuns neașteptat de la agent", "errc.INVALID_ID": "ID de container invalid",
  "errc.UNAUTHORIZED": "Token lipsă sau invalid", "errc.RATE_LIMITED": "Prea multe încercări eșuate",
  "errc.SOCKET_MISSING": "Socketul Podman nu a fost găsit", "errc.SOCKET_UNREACHABLE": "Socketul Podman este inaccesibil",
  "errc.PODMAN_API_ERROR": "Eroare API Podman", "errc.PODMAN_TIMEOUT": "Podman nu răspunde",
  "errc.CONTAINER_NOT_FOUND": "Containerul nu a fost găsit", "errc.INTERNAL": "Eroare internă", "errc.NOT_FOUND": "Negăsit",
  "errc.SKIPPED": "Neinterogat (dezactivat sau date de autentificare ilizibile)",
};

const es: Dict = {
  "nav.dashboard": "Panel", "nav.hosts": "Hosts", "nav.containers": "Contenedores", "nav.settings": "Ajustes",
  "common.confirm": "Confirmar", "common.cancel": "Cancelar", "common.na": "n/d",
  "lang.label": "Idioma",
  "status.online": "en línea", "status.offline": "sin conexión", "status.degraded": "degradado", "status.running": "en ejecución",
  "status.exited": "finalizado", "status.stopped": "detenido", "status.disabled": "desactivado", "status.unknown": "desconocido",
  "status.created": "creado", "status.paused": "en pausa",
  "dash.title": "Panel", "dash.hosts": "Hosts", "dash.reachable": "Accesibles", "dash.unreachable": "Inaccesibles",
  "dash.other": "Desactivados / pendientes", "dash.containers": "Contenedores", "dash.running": "En ejecución", "dash.stopped": "Detenidos",
  "dash.excluded": "El recuento de contenedores excluye {n} host(s) que no se pudieron consultar: {names}.",
  "dash.empty": "Aún no hay hosts registrados. Añade un agente en Hosts.",
  "hosts.title": "Hosts", "hosts.hostname": "Nombre de host", "hosts.agentId": "ID del agente", "hosts.address": "Dirección",
  "hosts.status": "Estado", "hosts.heartbeat": "Último heartbeat", "hosts.podman": "Podman", "hosts.containers": "Contenedores",
  "hosts.none": "No hay agentes registrados.", "hosts.add": "Añadir agente", "hosts.addrLabel": "Dirección del agente",
  "hosts.tokenLabel": "Token del agente", "hosts.register": "Probar conexión y registrar", "hosts.test": "Probar",
  "hosts.disable": "Desactivar", "hosts.enable": "Activar", "hosts.remove": "Eliminar", "hosts.removeQ": "¿Eliminar {name}?",
  "hosts.cardMeta": "Heartbeat: {hb} · Podman {pv} · {n} contenedores",
  "cont.title": "Contenedores", "cont.allHosts": "Todos los hosts", "cont.anyStatus": "Cualquier estado", "cont.running": "En ejecución",
  "cont.notRunning": "No en ejecución", "cont.namePh": "Nombre del contenedor", "cont.filter": "Filtrar", "cont.name": "Nombre",
  "cont.id": "ID", "cont.host": "Host", "cont.image": "Imagen", "cont.status": "Estado", "cont.created": "Creado",
  "cont.started": "Iniciado", "cont.actions": "Acciones", "cont.none": "No se encontraron contenedores.",
  "cont.unavailable": "{host}: contenedores no disponibles — {msg}",
  "act.start": "Iniciar", "act.stop": "Detener", "act.restart": "Reiniciar", "act.stopQ": "¿Detener «{name}»?",
  "act.restartQ": "¿Reiniciar «{name}»?", "act.working": "Procesando…",
  "detail.back": "← Contenedores", "detail.notFound": "Contenedor no encontrado.", "detail.disabled": "El host {host} está desactivado.",
  "detail.noCreds": "Faltan las credenciales", "detail.cid": "ID del contenedor",
  "set.title": "Ajustes", "set.monitoring": "Supervisión (definida mediante variables de entorno)", "set.interval": "Intervalo de heartbeat",
  "set.timeout": "Timeout del agente", "set.failures": "Sin conexión tras comprobaciones fallidas", "set.changePw": "Cambiar contraseña",
  "set.current": "Contraseña actual", "set.new": "Nueva contraseña (mín. 10)", "set.repeat": "Repite la nueva contraseña",
  "set.changeBtn": "Cambiar contraseña", "set.logout": "Cerrar sesión",
  "auth.signIn": "Iniciar sesión", "auth.createAdmin": "Crear contraseña de administrador", "auth.password": "Contraseña", "auth.repeat": "Repite la contraseña",
  "msg.pwShort": "La contraseña debe tener al menos {n} caracteres", "msg.pwMismatch": "Las contraseñas no coinciden",
  "msg.tooMany": "Demasiados intentos fallidos. Inténtalo de nuevo en un minuto.", "msg.pwInvalid": "Contraseña incorrecta",
  "msg.curWrong": "La contraseña actual es incorrecta", "msg.pwChanged": "Contraseña cambiada", "msg.agentAdded": "Agente registrado",
  "msg.agentRemoved": "Agente eliminado", "msg.updated": "Actualizado", "msg.invalidAgent": "Agente no válido",
  "msg.agentDisabled": "El agente está desactivado", "msg.connOk": "Conexión y autenticación correctas",
  "msg.connDegraded": "Agente accesible, problema con Podman: {err}", "msg.checkFailed": "La comprobación falló",
  "msg.opNotAllowed": "Acción no permitida", "msg.invalidId": "ID de contenedor no válido", "msg.unknownHost": "Host desconocido",
  "msg.hostDisabled": "El host está desactivado", "msg.noCreds": "Faltan las credenciales del host",
  "msg.opOk": "{action} correcto: ahora {state}", "msg.opNoChange": "No hacen falta cambios ({state})",
  "msg.opFailed": "{action} falló: {msg} ({code})",
  "err.invalidAddress": "Dirección no válida. Se esperaba http://host:puerto", "err.invalidToken": "Formato de token no válido",
  "err.alreadyRegistered": "El agente ya está registrado", "err.authFailed": "Autenticación fallida: el agente rechazó el token",
  "err.connFailed": "La prueba de conexión falló: {msg}", "err.agentIdTaken": "El ID de agente «{id}» ya está registrado",
  "errc.TIMEOUT": "El agente no respondió a tiempo", "errc.UNREACHABLE": "Agente no accesible",
  "errc.BAD_RESPONSE": "Respuesta inesperada del agente", "errc.INVALID_ID": "ID de contenedor no válido",
  "errc.UNAUTHORIZED": "Token ausente o no válido", "errc.RATE_LIMITED": "Demasiados intentos fallidos",
  "errc.SOCKET_MISSING": "No se encontró el socket de Podman", "errc.SOCKET_UNREACHABLE": "El socket de Podman no es accesible",
  "errc.PODMAN_API_ERROR": "Error de la API de Podman", "errc.PODMAN_TIMEOUT": "Podman no responde",
  "errc.CONTAINER_NOT_FOUND": "Contenedor no encontrado", "errc.INTERNAL": "Error interno", "errc.NOT_FOUND": "No encontrado",
  "errc.SKIPPED": "No consultado (desactivado o credenciales ilegibles)",
};

export const dicts: Record<Lang, Dict> = { en, de, ro, es };

export type T = (key: Key, params?: Record<string, string | number>) => string;

export function makeT(lang: Lang): T {
  const d = dicts[lang];
  return (key, params) => d[key].replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
}

/** Picks the best supported language from an Accept-Language header; default English. */
export function pickLang(header: string | null | undefined): Lang {
  const tags = (header ?? "")
    .split(",")
    .map((p) => {
      const [tag = "", q] = p.trim().split(";q=");
      return { base: tag.toLowerCase().split("-")[0] ?? "", q: q ? Number(q) : 1 };
    })
    .filter((x) => x.base && !Number.isNaN(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const t of tags) if (isLang(t.base)) return t.base;
  return "en";
}

export function statusLabel(t: T, s: string): string {
  const k = `status.${s}` as Key;
  return k in en ? t(k) : s;
}

export function errText(t: T, code: string, message = ""): string {
  const k = `errc.${code}` as Key;
  if (k in en) return code === "PODMAN_API_ERROR" && message ? `${t(k)}: ${message}` : t(k);
  return message || code;
}

/** Translates stored "CODE: message" error strings. */
export function lastErrText(t: T, raw: string): string {
  const m = /^([A-Z_]+): ?([\s\S]*)$/.exec(raw);
  return m ? errText(t, m[1]!, m[2]) : raw;
}
