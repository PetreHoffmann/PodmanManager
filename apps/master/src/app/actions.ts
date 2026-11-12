"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { agentAction, agentAppLogs, agentInspect, agentLogs, agentPod, agentPodAction, agentPodLogs } from "@/lib/agent-client";
import { MAX_LOGO_BYTES, clearLogo, normalizeText, saveLogo, saveText } from "@/lib/branding";
import { appLogTail } from "@/lib/applog";
import type { AppLogLine, LogLine } from "../../../../shared/types/index.js";
import { checkAgent, getAgent, registerAgent, removeAgent, setEnabled, targetFor } from "@/lib/agents";
import { LANG_COOKIE, errText, isLang, lastErrText, statusLabel, type Key } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { loadLdapConfig, parseLdapInput, saveLdapConfig } from "@/lib/ldap-config";
import { MAX_PATTERNS, hiddenPatternsFor, isHidden, isPodHidden, parsePatterns, saveHiddenPatterns } from "@/lib/hidden";
import { checkForUpdate, type UpdateInfo } from "@/lib/update-check";
import { getVersion } from "@/lib/version";
import { EMPTY_SAML, certInfo, loadSamlConfig, parseSamlInput, saveSamlConfig, spAcsUrl, spEntityId, splitCerts, type SamlConfig } from "@/lib/saml-config";
import { loadIdpMetadata } from "@/lib/saml-metadata";
import { LdapError, authenticateLdap, testLdap, type MappedGroup } from "@/lib/ldap";
import { allowedAgentIds, deleteGroup, listGroups, mayAccessAgent, saveGroup } from "@/lib/groups";
import {
  LOCAL_ADMIN, LOCAL_SESSION, adminExists, checkAdminPassword, endSession, loginBlocked, recordLoginFailure,
  requireAuth, setAdminPassword, startSession,
} from "@/lib/session";
import { isAction, CONTAINER_ID_RE } from "@/lib/validate";

export type FormState = { ok: boolean; message: string } | null;

const s = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
const MIN_PW = 10;

const mappedGroups = (): MappedGroup[] => listGroups().filter((g) => g.ad_group_dn).map((g) => ({ id: g.id, name: g.name, dn: g.ad_group_dn }));

export async function setLangAction(fd: FormData): Promise<void> {
  const l = s(fd, "lang");
  if (!isLang(l)) return;
  (await cookies()).set(LANG_COOKIE, l, { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
}

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  if (adminExists()) redirect("/login");
  const t = await getT();
  const pw = s(fd, "password");
  if (pw.length < MIN_PW) return { ok: false, message: t("msg.pwShort", { n: MIN_PW }) };
  if (pw !== s(fd, "confirm")) return { ok: false, message: t("msg.pwMismatch") };
  await setAdminPassword(pw);
  await startSession(LOCAL_SESSION);
  redirect("/");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!adminExists()) redirect("/setup");
  const t = await getT();
  const username = s(fd, "username").trim();
  const password = s(fd, "password");
  if (loginBlocked(username)) return { ok: false, message: t("msg.tooMany") };

  if (username.toLowerCase() === LOCAL_ADMIN) {
    if (await checkAdminPassword(password)) {
      await startSession(LOCAL_SESSION);
      redirect("/");
    }
  } else {
    const cfg = loadLdapConfig();
    if (cfg?.enabled) {
      const r = await authenticateLdap(cfg, username, password, mappedGroups());
      if (r.ok) {
        await startSession({ username: r.username, kind: "ldap", access: r.admin ? "all" : "groups", groupIds: r.groupIds });
        redirect("/");
      }
      if (r.reason === "unavailable") return { ok: false, message: `${t("msg.ldapUnavailable")} (${errText(t, r.code)})` };
      console.warn(`ldap login denied: ${r.reason}`);
    }
  }
  recordLoginFailure(username);
  return { ok: false, message: t("msg.pwInvalid") };
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.kind !== "local") return { ok: false, message: t("set.localOnly") };
  if (!(await checkAdminPassword(s(fd, "current")))) return { ok: false, message: t("msg.curWrong") };
  const pw = s(fd, "password");
  if (pw.length < MIN_PW) return { ok: false, message: t("msg.pwShort", { n: MIN_PW }) };
  if (pw !== s(fd, "confirm")) return { ok: false, message: t("msg.pwMismatch") };
  await setAdminPassword(pw);
  await startSession(LOCAL_SESSION);
  return { ok: true, message: t("msg.pwChanged") };
}

export async function addAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
  const r = await registerAgent(s(fd, "url"), s(fd, "token").trim());
  if (!r.ok) {
    const p = r.params ?? {};
    const msg = p.code ? errText(t, p.code, p.msg) : p.msg;
    return { ok: false, message: t(r.error as Key, { ...p, msg: msg ?? "" }) };
  }
  revalidatePath("/hosts");
  return { ok: true, message: t("msg.agentAdded") };
}

function idOf(fd: FormData): number | null {
  const n = Number(s(fd, "id"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function removeAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
  const id = idOf(fd);
  if (!id) return { ok: false, message: t("msg.invalidAgent") };
  removeAgent(id);
  revalidatePath("/hosts");
  return { ok: true, message: t("msg.agentRemoved") };
}

export async function toggleAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
  const id = idOf(fd);
  if (!id || !getAgent(id)) return { ok: false, message: t("msg.invalidAgent") };
  setEnabled(id, s(fd, "enable") === "1");
  revalidatePath("/hosts");
  return { ok: true, message: t("msg.updated") };
}

export async function testAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
  const id = idOf(fd);
  const a = id ? getAgent(id) : null;
  if (!id || !a) return { ok: false, message: t("msg.invalidAgent") };
  if (!a.enabled) return { ok: false, message: t("msg.agentDisabled") };
  const r = await checkAgent(id);
  revalidatePath("/hosts");
  const err = r?.last_error ? lastErrText(t, r.last_error) : "";
  if (r && (r.status === "online" || r.status === "degraded") && r.fail_count === 0) {
    return r.status === "online"
      ? { ok: true, message: t("msg.connOk") }
      : { ok: false, message: t("msg.connDegraded", { err: err || "?" }) };
  }
  return { ok: false, message: err || t("msg.checkFailed") };
}

export async function containerOpAction(agentId: number, containerId: string, action: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireAuth();
  const t = await getT();
  if (!isAction(action)) return { ok: false, message: t("msg.opNotAllowed") };
  if (!CONTAINER_ID_RE.test(containerId)) return { ok: false, message: t("msg.invalidId") };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a || !mayAccessAgent(allowedAgentIds(session), a.id)) return { ok: false, message: t("msg.unknownHost") };
  if (!a.enabled) return { ok: false, message: t("msg.hostDisabled") };
  const tg = targetFor(agentId);
  if (!tg) return { ok: false, message: t("msg.noCreds") };
  // Restricted users must not operate hidden containers: check the container's current name first.
  const hidden = hiddenPatternsFor(session);
  if (hidden.length > 0) {
    const ins = await agentInspect(tg, containerId);
    if (!ins.ok) return { ok: false, message: errText(t, ins.code, ins.message) };
    if (isHidden(ins.data.name, hidden)) return { ok: false, message: t("detail.notFound") };
  }
  const r = await agentAction(tg, containerId, action);
  revalidatePath("/containers");
  revalidatePath("/");
  const verb = t(`act.${action}` as Key);
  if (r.ok) {
    const state = r.data.container.state;
    const label = statusLabel(t, state);
    return { ok: true, message: r.data.changed ? t("msg.opOk", { action: verb, state: label }) : t("msg.opNoChange", { state: label }) };
  }
  return { ok: false, message: t("msg.opFailed", { action: verb, msg: errText(t, r.code, r.message), code: r.code }) };
}

export async function ldapAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.kind !== "local") return { ok: false, message: t("set.localOnly") };

  const existing = loadLdapConfig();
  const parsed = parseLdapInput(
    {
      enabled: s(fd, "enabled") === "on", url: s(fd, "url"), startTls: s(fd, "startTls") === "on", caCert: s(fd, "caCert"),
      bindDn: s(fd, "bindDn"), bindPassword: s(fd, "bindPassword"), baseDn: s(fd, "baseDn"), filter: s(fd, "filter"), groupDn: s(fd, "groupDn"),
    },
    existing,
  );
  if (!parsed.ok) return { ok: false, message: t(parsed.error as Key, parsed.params) };
  const cfg = parsed.config;

  if (s(fd, "intent") === "test") {
    try {
      const steps = await testLdap({ ...cfg, enabled: true }, s(fd, "testUser").trim(), mappedGroups(), t("groups.accessAll"));
      const user = s(fd, "testUser").trim();
      const text = steps.map((st) => `${st.ok ? "✓" : "✗"} ${t(`msg.ldapTest${st.key[0]!.toUpperCase()}${st.key.slice(1)}` as Key, { user, name: st.name ?? "", access: st.name ?? "" })}`);
      return { ok: steps.every((st) => st.ok), message: text.join("\n") };
    } catch (e) {
      const code = e instanceof LdapError ? e.code : "LDAP_SEARCH";
      return { ok: false, message: t("msg.ldapTestFail", { msg: errText(t, code) }) };
    }
  }

  saveLdapConfig(cfg);
  revalidatePath("/settings");
  const insecure = cfg.url.startsWith("ldap://") && !cfg.startTls;
  return { ok: true, message: insecure ? `${t("msg.ldapSaved")}. ${t("ldap.insecure")}` : t("msg.ldapSaved") };
}

export async function groupAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.kind !== "local") return { ok: false, message: t("set.localOnly") };

  const idRaw = s(fd, "id");
  const id = idRaw === "" ? undefined : Number(idRaw);
  if (id !== undefined && (!Number.isInteger(id) || id < 1)) return { ok: false, message: t("err.groupNotFound") };

  if (s(fd, "intent") === "delete") {
    if (id === undefined) return { ok: false, message: t("err.groupNotFound") };
    deleteGroup(id);
    revalidatePath("/settings");
    return { ok: true, message: t("msg.groupDeleted") };
  }

  const agentIds = fd.getAll("agents").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  const r = saveGroup({ id, name: s(fd, "name"), adGroupDn: s(fd, "adGroupDn"), samlGroup: s(fd, "samlGroup"), agentIds });
  if (!r.ok) return { ok: false, message: t(r.error as Key) };
  revalidatePath("/settings");
  revalidatePath("/hosts");
  return { ok: true, message: t("msg.groupSaved") };
}

export async function checkUpdateAction(): Promise<UpdateInfo> {
  await requireAuth();
  return checkForUpdate(getVersion());
}

export async function hiddenAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.kind !== "local") return { ok: false, message: t("set.localOnly") };
  const parsed = parsePatterns(s(fd, "patterns"));
  if (!parsed.ok) return { ok: false, message: t(parsed.error as Key, { pattern: parsed.pattern ?? "", max: MAX_PATTERNS }) };

  if (s(fd, "intent") === "test") {
    const name = s(fd, "testName").trim();
    if (!name) return { ok: false, message: t("err.hiddenPattern", { pattern: "" }) };
    return isHidden(name, parsed.patterns)
      ? { ok: true, message: t("msg.hiddenTestYes", { name }) }
      : { ok: true, message: t("msg.hiddenTestNo", { name }) };
  }
  saveHiddenPatterns(parsed.patterns);
  revalidatePath("/", "layout");
  return { ok: true, message: t("msg.hiddenSaved", { n: parsed.patterns.length }) };
}

export type LogsResult = { ok: true; lines: LogLine[]; skipped?: string[] } | { ok: false; message: string };

/** Last log lines of a container; same access rules as container actions (agent scope, hidden containers). */
export async function containerLogsAction(agentId: number, containerId: string): Promise<LogsResult> {
  const session = await requireAuth();
  const t = await getT();
  if (!CONTAINER_ID_RE.test(containerId)) return { ok: false, message: t("msg.invalidId") };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a || !mayAccessAgent(allowedAgentIds(session), a.id)) return { ok: false, message: t("msg.unknownHost") };
  if (!a.enabled) return { ok: false, message: t("msg.hostDisabled") };
  const tg = targetFor(agentId);
  if (!tg) return { ok: false, message: t("msg.noCreds") };
  const hidden = hiddenPatternsFor(session);
  if (hidden.length > 0) {
    const ins = await agentInspect(tg, containerId);
    if (!ins.ok) return { ok: false, message: errText(t, ins.code, ins.message) };
    if (isHidden(ins.data.name, hidden)) return { ok: false, message: t("detail.notFound") };
  }
  const r = await agentLogs(tg, containerId);
  if (!r.ok) return { ok: false, message: errText(t, r.code, r.message) };
  return { ok: true, lines: r.data.lines };
}

export type AppLogsResult = { ok: true; lines: AppLogLine[] } | { ok: false; message: string };

/** Own log lines of an agent (agentId > 0) or of the master itself (agentId 0). Admins only. */
export async function appLogsAction(agentId: number): Promise<AppLogsResult> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
  if (agentId === 0) return { ok: true, lines: appLogTail(150) };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a) return { ok: false, message: t("msg.unknownHost") };
  if (!a.enabled) return { ok: false, message: t("msg.hostDisabled") };
  const tg = targetFor(agentId);
  if (!tg) return { ok: false, message: t("msg.noCreds") };
  const r = await agentAppLogs(tg);
  if (!r.ok) return { ok: false, message: errText(t, r.code, r.message) };
  return { ok: true, lines: r.data.lines };
}

/** Start/stop/restart a whole pod. Same rules as containers; a pod with a hidden container is off limits for restricted users. */
export async function podOpAction(agentId: number, podId: string, action: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireAuth();
  const t = await getT();
  if (!isAction(action)) return { ok: false, message: t("msg.opNotAllowed") };
  if (!CONTAINER_ID_RE.test(podId)) return { ok: false, message: t("msg.invalidPodId") };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a || !mayAccessAgent(allowedAgentIds(session), a.id)) return { ok: false, message: t("msg.unknownHost") };
  if (!a.enabled) return { ok: false, message: t("msg.hostDisabled") };
  const tg = targetFor(agentId);
  if (!tg) return { ok: false, message: t("msg.noCreds") };
  const hidden = hiddenPatternsFor(session);
  if (hidden.length > 0) {
    const cur = await agentPod(tg, podId);
    if (!cur.ok) return { ok: false, message: errText(t, cur.code, cur.message) };
    if (isPodHidden(cur.data, hidden)) return { ok: false, message: t("pods.notFound") };
  }
  const r = await agentPodAction(tg, podId, action);
  revalidatePath("/pods");
  revalidatePath("/containers");
  revalidatePath("/");
  const verb = t(`act.${action}` as Key);
  if (r.ok) {
    const label = statusLabel(t, r.data.pod.status);
    return { ok: true, message: r.data.changed ? t("msg.opOk", { action: verb, state: label }) : t("msg.opNoChange", { state: label }) };
  }
  return { ok: false, message: t("msg.opFailed", { action: verb, msg: errText(t, r.code, r.message), code: r.code }) };
}

/** Merged logs of a pod; same rules as pod actions (agent scope, pods with hidden containers are blocked). */
export async function podLogsAction(agentId: number, podId: string): Promise<LogsResult> {
  const session = await requireAuth();
  const t = await getT();
  if (!CONTAINER_ID_RE.test(podId)) return { ok: false, message: t("msg.invalidPodId") };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a || !mayAccessAgent(allowedAgentIds(session), a.id)) return { ok: false, message: t("msg.unknownHost") };
  if (!a.enabled) return { ok: false, message: t("msg.hostDisabled") };
  const tg = targetFor(agentId);
  if (!tg) return { ok: false, message: t("msg.noCreds") };
  const hidden = hiddenPatternsFor(session);
  if (hidden.length > 0) {
    const cur = await agentPod(tg, podId);
    if (!cur.ok) return { ok: false, message: errText(t, cur.code, cur.message) };
    if (isPodHidden(cur.data, hidden)) return { ok: false, message: t("pods.notFound") };
  }
  const r = await agentPodLogs(tg, podId);
  if (!r.ok) return { ok: false, message: errText(t, r.code, r.message) };
  return { ok: true, lines: r.data.lines, skipped: r.data.skipped };
}

/** Custom navbar text and logo (local administrator only). */
export async function brandingAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.kind !== "local") return { ok: false, message: t("set.localOnly") };
  const intent = s(fd, "intent");
  if (intent === "reset") {
    saveText(null);
    clearLogo();
    revalidatePath("/", "layout");
    return { ok: true, message: t("msg.brandReset") };
  }
  const file = fd.get("logo");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) return { ok: false, message: t("err.brandTooLarge", { max: Math.round(MAX_LOGO_BYTES / 1024) }) };
    const r = saveLogo(Buffer.from(await file.arrayBuffer()));
    if (!r.ok) return { ok: false, message: t(r.error, { max: Math.round(MAX_LOGO_BYTES / 1024) }) };
  } else if (fd.get("removeLogo") === "on") {
    clearLogo();
  }
  saveText(normalizeText(s(fd, "text")));
  revalidatePath("/", "layout");
  return { ok: true, message: t("msg.brandSaved") };
}

const samlInput = (fd: FormData, enabled: boolean): SamlConfig => ({
  enabled, publicUrl: s(fd, "publicUrl"), idpEntityId: s(fd, "idpEntityId"), idpSsoUrl: s(fd, "idpSsoUrl"), idpCert: s(fd, "idpCert"),
  usernameClaim: s(fd, "usernameClaim"), groupClaim: s(fd, "groupClaim"), adminGroup: s(fd, "adminGroup"),
});

/** SSO (SAML 2.0 / ADFS) settings: save or check. Local administrator only. */
export async function samlAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.kind !== "local") return { ok: false, message: t("set.localOnly") };
  const parsed = parseSamlInput(samlInput(fd, s(fd, "samlEnabled") === "on"));
  if (!parsed.ok) return { ok: false, message: t(parsed.error as Key) };
  const cfg = parsed.config;

  const lines: { ok: boolean; text: string }[] = [];
  if (cfg.publicUrl) {
    lines.push({ ok: true, text: t("msg.samlCheckEndpoints", { entity: spEntityId(cfg), acs: spAcsUrl(cfg) }) });
    if (cfg.publicUrl.startsWith("http://")) lines.push({ ok: false, text: t("msg.samlCheckHttp") });
  }
  for (const pem of splitCerts(cfg.idpCert)) {
    const c = certInfo(pem);
    if (c) lines.push({ ok: !c.expired, text: t(c.expired ? "msg.samlCheckCertExpired" : "msg.samlCheckCert", { subject: c.subject, date: c.validTo.toISOString().slice(0, 10) }) });
  }
  if (cfg.enabled && !cfg.adminGroup && listGroups().every((g) => !g.saml_group)) lines.push({ ok: false, text: t("msg.samlCheckNoGroups") });

  if (s(fd, "intent") === "check") {
    return { ok: lines.every((l) => l.ok), message: lines.map((l) => `${l.ok ? "✓" : "✗"} ${l.text}`).join("\n") || t("msg.samlCheckEmpty") };
  }
  saveSamlConfig(cfg);
  revalidatePath("/settings");
  revalidatePath("/login");
  const warn = lines.filter((l) => !l.ok).map((l) => `✗ ${l.text}`);
  return { ok: true, message: [t("msg.samlSaved"), ...warn].join("\n") };
}

/** Takes entity id, SSO address and signing certificates from IdP metadata (address or pasted XML). */
export async function samlImportAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.kind !== "local") return { ok: false, message: t("set.localOnly") };
  const input = s(fd, "metadata").trim();
  if (!input) return { ok: false, message: t("err.samlMetaParse") };
  const m = await loadIdpMetadata(input);
  if (!m.ok) return { ok: false, message: t(m.error as Key) };
  const existing = loadSamlConfig() ?? EMPTY_SAML;
  const parsed = parseSamlInput({ ...existing, idpEntityId: m.data.entityId, idpSsoUrl: m.data.ssoUrl, idpCert: m.data.certs.join("\n"), enabled: false });
  if (!parsed.ok) return { ok: false, message: t(parsed.error as Key) };
  // Stays switched off if it was off; a complete configuration keeps its state.
  const merged = { ...parsed.config, enabled: existing.enabled };
  saveSamlConfig(merged);
  revalidatePath("/settings");
  return { ok: true, message: t("msg.samlImported", { entity: m.data.entityId, n: String(m.data.certs.length) }) };
}
