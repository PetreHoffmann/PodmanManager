"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { agentImageDelete, agentImagePrune, agentNetworkDelete, agentNetworks, agentVolumeDelete, agentVolumes, agentPeerInfo, agentSelfInfo, agentPeerStart, agentUpdateStart, agentAction, agentAppLogs, agentInspect, agentLogs, agentPod, agentPodAction, agentPodLogs } from "@/lib/agent-client";
import { MAX_LOGO_BYTES, clearLogo, normalizeText, saveLogo, saveText } from "@/lib/branding";
import { appLogTail } from "@/lib/applog";
import type { AppLogLine, LogLine } from "../../../../shared/types/index.js";
import { checkAgent, getAgent, listAgents, registerAgent, removeAgent, setEnabled, targetFor } from "@/lib/agents";
import { LANG_COOKIE, errText, isLang, lastErrText, statusLabel, type Key } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { loadLdapConfig, parseLdapInput, saveLdapConfig } from "@/lib/ldap-config";
import { MAX_PATTERNS, hiddenPatternsFor, isHidden, isPodHidden, parsePatterns, saveHiddenPatterns } from "@/lib/hidden";
import { checkForUpdate, type UpdateInfo } from "@/lib/update-check";
import { getVersion } from "@/lib/version";
import { EMPTY_SAML, certInfo, loadSamlConfig, parseSamlInput, saveSamlConfig, spAcsUrl, spEntityId, splitCerts, type SamlConfig } from "@/lib/saml-config";
import { loadIdpMetadata } from "@/lib/saml-metadata";
import { LdapError, authenticateLdap, testLdap, type MappedGroup } from "@/lib/ldap";
import { getUserByName, authenticateUser, checkUserPassword, deleteUser, listUsers, saveUser, sessionFor, setUserPassword } from "@/lib/users";
import { audit } from "@/lib/audit";
import { allowedAgentIds, deleteGroup, listGroups, mayAccessAgent, saveGroup } from "@/lib/groups";
import {
  COOKIE, LOCAL_ADMIN, LOCAL_SESSION, adminExists, checkAdminPassword, endSession, getSession, loginBlocked, recordLoginFailure,
  requireAuth, setAdminPassword, startSession,
} from "@/lib/session";
import { MANUAL_COOKIE, REAUTH_COOKIE } from "@/lib/saml-http";
import { fmtBytes } from "@/components/ui";
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
      await audit(LOCAL_SESSION, "login.ok");
      redirect("/");
    }
    console.warn(`local login denied: wrong password for "${LOCAL_ADMIN}"`);
    await audit({ username: LOCAL_ADMIN, kind: "local" }, "login.fail", { ok: false, detail: "wrong password" });
  } else if (getUserByName(username)) {
    // a local user of that name never falls through to LDAP
    const r = await authenticateUser(username, password);
    if (r.ok) {
      await startSession(sessionFor(r.user));
      await audit(sessionFor(r.user), "login.ok");
      redirect("/");
    }
    if (r.reason === "no_group") {
      console.warn(`local login denied: user "${username}": not an administrator and in no agent group (no access)`);
      await audit({ username, kind: "user" }, "login.denied", { ok: false, detail: "no agent group" });
      return { ok: false, message: t("msg.noGroup") };
    }
    await audit({ username, kind: "user" }, "login.fail", { ok: false, detail: r.reason === "disabled" ? "disabled" : "wrong password" });
    console.warn(r.reason === "disabled" ? `local login denied: user "${username}" is disabled` : `local login denied: wrong password for user "${username}"`);
  } else {
    const cfg = loadLdapConfig();
    if (!cfg?.enabled) {
      // the typed name is not logged: it may be a mistyped password
      console.warn("login denied: unknown user (not a local account, LDAP login is not enabled)");
      await audit(null, "login.fail", { ok: false, detail: "unknown user" });
    }
    if (cfg?.enabled) {
      const r = await authenticateLdap(cfg, username, password, mappedGroups());
      if (r.ok) {
        await startSession({ username: r.username, kind: "ldap", access: r.admin ? "all" : "groups", groupIds: r.groupIds, displayName: r.displayName });
        await audit({ username: r.username, kind: "ldap" }, "login.ok");
        redirect("/");
      }
      // only the directory's own account name is stored; a typed name may be a mistyped password
      await audit(r.reason === "not_member" ? { username: r.username, kind: "ldap" } : null, r.reason === "not_member" ? "login.denied" : "login.fail", { ok: false, detail: r.reason === "not_member" ? "no agent group" : r.reason === "unavailable" ? "directory unavailable" : "unknown user or wrong password" });
      if (r.reason === "unavailable") {
        console.warn(`ldap login failed: directory unavailable (${r.code})`);
        return { ok: false, message: `${t("msg.ldapUnavailable")} (${errText(t, r.code)})` };
      }
      // not_member: the user was found in the directory, so the name is the directory's (never what was typed, which may be a mistyped password)
      console.warn(
        r.reason === "not_member"
          ? `ldap login denied: ${r.displayName ?? r.username}: not in the administrators group or in a group assigned to an agent group (no access)`
          : r.reason === "invalid"
            ? "ldap login denied: unknown user or wrong password"
            : `ldap login denied: ${r.reason}`,
      );
    }
  }
  // the fifth failure blocks this name for a minute: say so once (not for every further attempt, which would flood the log)
  if (recordLoginFailure(username) === 5) {
    const known = username.toLowerCase() === LOCAL_ADMIN || !!getUserByName(username);
    await audit(known ? { username, kind: "local" } : null, "login.blocked", { ok: false, detail: "5 failed attempts, blocked for 60 s" });
    console.warn(`login blocked for 60 s after 5 failed attempts (${username.toLowerCase() === LOCAL_ADMIN ? `"${LOCAL_ADMIN}"` : "one login name, not shown"})`);
  }
  return { ok: false, message: t("msg.pwInvalid") };
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const who = getSession(jar.get(COOKIE)?.value);
  const kind = who?.kind;
  if (who) await audit(who, "logout");
  await endSession();
  // Seamless sign-on must not send the user straight back in after an explicit logout
  jar.set(MANUAL_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/" });
  // After an SSO logout the next SSO login must ask for credentials again (otherwise the identity provider logs the user straight back in)
  if (kind === "saml") jar.set(REAUTH_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/saml", maxAge: 30 * 24 * 3600 });
  redirect("/login");
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth({ allowMustChange: true });
  const t = await getT();
  if (session.kind !== "local" && session.kind !== "user") return { ok: false, message: t("set.pwExternal") };
  const isUser = session.kind === "user";
  if (!(await (isUser ? checkUserPassword(session.username, s(fd, "current")) : checkAdminPassword(s(fd, "current"))))) return { ok: false, message: t("msg.curWrong") };
  const pw = s(fd, "password");
  if (pw.length < MIN_PW) return { ok: false, message: t("msg.pwShort", { n: MIN_PW }) };
  if (pw !== s(fd, "confirm")) return { ok: false, message: t("msg.pwMismatch") };
  if (isUser) {
    await setUserPassword(session.username, pw);
    const u = getUserByName(session.username);
    if (u) await startSession(sessionFor(u));
    if (session.mustChange) redirect("/");
  } else {
    await setAdminPassword(pw);
    await startSession(LOCAL_SESSION);
  }
  await audit(session, "password.change");
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
  await audit(session, "host.add", { target: s(fd, "url").trim() });
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
  if (getAgent(id)?.kind === "local") return { ok: false, message: t("msg.localHost") };
  const gone = getAgent(id);
  removeAgent(id);
  await audit(session, "host.remove", { target: gone?.hostname ?? String(id) });
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
  await audit(session, s(fd, "enable") === "1" ? "host.enable" : "host.disable", { target: getAgent(id)?.hostname ?? String(id) });
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
  await audit(session, `container.${action}`, { target: r.ok ? `${r.data.container.name} (${containerId.slice(0, 12)})` : containerId.slice(0, 12), host: a.hostname, ok: r.ok, detail: r.ok ? "" : r.code });
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
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };

  const existing = loadLdapConfig();
  const parsed = parseLdapInput(
    {
      enabled: s(fd, "enabled") === "on", url: s(fd, "url"), startTls: s(fd, "startTls") === "on", caCert: s(fd, "caCert"),
      bindDn: s(fd, "bindDn"), bindPassword: s(fd, "bindPassword"), baseDn: s(fd, "baseDn"), filter: s(fd, "filter"), groupDn: s(fd, "groupDn"),
      accountAttr: s(fd, "accountAttr"), displayAttr: s(fd, "displayAttr"), groupMode: s(fd, "groupMode"), memberAttr: s(fd, "memberAttr"),
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
  await audit(session, "ldap.save", { detail: cfg.enabled ? "enabled" : "disabled" });
  revalidatePath("/settings");
  const insecure = cfg.url.startsWith("ldap://") && !cfg.startTls;
  return { ok: true, message: insecure ? `${t("msg.ldapSaved")}. ${t("ldap.insecure")}` : t("msg.ldapSaved") };
}

export async function groupAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };

  const idRaw = s(fd, "id");
  const id = idRaw === "" ? undefined : Number(idRaw);
  if (id !== undefined && (!Number.isInteger(id) || id < 1)) return { ok: false, message: t("err.groupNotFound") };

  if (s(fd, "intent") === "delete") {
    if (id === undefined) return { ok: false, message: t("err.groupNotFound") };
    const gname = listGroups().find((g) => g.id === id)?.name ?? String(id);
    deleteGroup(id);
    await audit(session, "group.delete", { target: gname });
    revalidatePath("/settings");
    return { ok: true, message: t("msg.groupDeleted") };
  }

  const agentIds = fd.getAll("agents").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  const r = saveGroup({ id, name: s(fd, "name"), adGroupDn: s(fd, "adGroupDn"), samlGroup: s(fd, "samlGroup"), agentIds });
  if (!r.ok) return { ok: false, message: t(r.error as Key) };
  await audit(session, "group.save", { target: s(fd, "name").trim() });
  revalidatePath("/settings");
  revalidatePath("/hosts");
  return { ok: true, message: t("msg.groupSaved") };
}

export async function userAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };

  const idRaw = s(fd, "id");
  const id = idRaw === "" ? undefined : Number(idRaw);
  if (id !== undefined && (!Number.isInteger(id) || id < 1)) return { ok: false, message: t("err.userNotFound") };

  if (s(fd, "intent") === "delete") {
    if (id === undefined) return { ok: false, message: t("err.userNotFound") };
    const uname = listUsers().find((u) => u.id === id)?.username ?? String(id);
    deleteUser(id);
    await audit(session, "user.delete", { target: uname });
    revalidatePath("/settings");
    return { ok: true, message: t("msg.userDeleted") };
  }

  const groupIds = fd.getAll("groups").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  const r = await saveUser({
    id, username: s(fd, "username"), password: s(fd, "password"), isAdmin: s(fd, "isAdmin") === "on",
    enabled: s(fd, "enabled") === "on", mustChange: s(fd, "mustChange") === "on", groupIds,
  });
  if (!r.ok) return { ok: false, message: t(r.error as Key) };
  await audit(session, "user.save", { target: listUsers().find((u) => u.id === r.id)?.username ?? s(fd, "username").trim(), detail: id === undefined ? "created" : "changed" });
  revalidatePath("/settings");
  return { ok: true, message: t("msg.userSaved") };
}

export async function checkUpdateAction(): Promise<UpdateInfo> {
  await requireAuth();
  return checkForUpdate(getVersion());
}

export async function hiddenAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
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
  await audit(session, "hidden.save", { detail: `${parsed.patterns.length} patterns` });
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
  await audit(session, `pod.${action}`, { target: r.ok ? `${r.data.pod.name} (${podId.slice(0, 12)})` : podId.slice(0, 12), host: a.hostname, ok: r.ok, detail: r.ok ? "" : r.code });
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

/** Custom navbar text and logo (administrators only). */
export async function brandingAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
  const intent = s(fd, "intent");
  if (intent === "reset") {
    saveText(null);
    clearLogo();
    await audit(session, "branding.save", { detail: "reset" });
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
  await audit(session, "branding.save");
  revalidatePath("/", "layout");
  return { ok: true, message: t("msg.brandSaved") };
}

const samlInput = (fd: FormData, enabled: boolean): SamlConfig => ({
  enabled, publicUrl: s(fd, "publicUrl"), idpEntityId: s(fd, "idpEntityId"), idpSsoUrl: s(fd, "idpSsoUrl"), idpCert: s(fd, "idpCert"),
  usernameClaim: s(fd, "usernameClaim"), groupClaim: s(fd, "groupClaim"), displayNameClaim: s(fd, "displayNameClaim"), adminGroup: s(fd, "adminGroup"), buttonLabel: s(fd, "buttonLabel"), nameIdFormat: s(fd, "nameIdFormat"), autoSignIn: s(fd, "autoSignIn") === "on",
});

/** SSO (SAML 2.0 / ADFS) settings: save or check. Local administrator only. */
export async function samlAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
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
  await audit(session, "saml.save", { detail: cfg.enabled ? "enabled" : "disabled" });
  revalidatePath("/settings");
  revalidatePath("/login");
  const warn = lines.filter((l) => !l.ok).map((l) => `✗ ${l.text}`);
  return { ok: true, message: [t("msg.samlSaved"), ...warn].join("\n") };
}

/** Takes entity id, SSO address and signing certificates from IdP metadata (address or pasted XML). */
export async function samlImportAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
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
  await audit(session, "saml.save", { detail: "metadata import" });
  revalidatePath("/settings");
  return { ok: true, message: t("msg.samlImported", { entity: m.data.entityId, n: String(m.data.certs.length) }) };
}

const UPDATE_REASONS: Record<string, Key> = {
  pinned_tag: "update.reason.pinned_tag",
  not_systemd: "update.reason.not_systemd",
  no_container: "update.reason.no_container",
  inspect_failed: "update.reason.inspect_failed",
};

/** Ask an outdated agent to pull its image and restart itself. Admins only. */
export async function agentUpdateAction(agentId: number): Promise<{ ok: boolean; message: string }> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a) return { ok: false, message: t("msg.unknownHost") };
  if (a.kind === "local") return { ok: false, message: t("msg.localHost") };
  if (!a.enabled) return { ok: false, message: t("msg.hostDisabled") };
  const tg = targetFor(agentId);
  if (!tg) return { ok: false, message: t("msg.noCreds") };
  const r = await agentUpdateStart(tg);
  if (!r.ok) {
    if (r.code === "NOT_FOUND") return { ok: false, message: t("update.tooOld") };
    if (r.code === "UPDATE_NOT_POSSIBLE") {
      const k = UPDATE_REASONS[r.message];
      return { ok: false, message: k ? t(k) : errText(t, r.code, r.message) };
    }
    return { ok: false, message: errText(t, r.code, r.message) };
  }
  await audit(session, "host.update", { target: a.hostname });
  revalidatePath("/hosts");
  return { ok: true, message: t("update.started") };
}

export type MasterUpdateAgents = { ok: true; agents: { id: number; label: string; local?: boolean }[]; blocked?: Key } | { ok: false };

/** Why the master (running on its own host) cannot update itself, in the master's own wording. */
const MASTER_REASONS: Record<string, Key> = {
  pinned_tag: "mupdate.reason.pinned_tag",
  not_systemd: "mupdate.reason.not_systemd",
  no_container: "mupdate.reason.no_container",
  inspect_failed: "mupdate.reason.inspect_failed",
};

/** Agents that are set up (UPDATE_UNIT) to update this master. Admins only. */
export async function masterUpdateAgentsAction(): Promise<MasterUpdateAgents> {
  const session = await requireAuth();
  if (session.access !== "all") return { ok: false };
  let blocked: Key | undefined;
  const found = await Promise.all(
    listAgents().filter((a) => a.enabled && a.status !== "offline").map(async (a) => {
      const tg = targetFor(a.id);
      // the master's own host updates the master itself; other agents update the master through the peer route
      const r = tg ? await (tg.local ? agentSelfInfo(tg) : agentPeerInfo(tg)) : null;
      if (tg?.local && r && r.ok && !r.data.possible && r.data.reason) blocked = MASTER_REASONS[r.data.reason];
      return r && r.ok && r.data.possible ? { id: a.id, label: `${a.agent_id} (${a.hostname})`, ...(tg?.local ? { local: true } : {}) } : null;
    }),
  );
  const agents = found.filter((x): x is { id: number; label: string; local?: boolean } => x !== null);
  // the reason is only shown when nothing else could update the master
  return { ok: true, agents, ...(agents.length === 0 && blocked ? { blocked } : {}) };
}

/** Let the given agent pull the master image and restart the master unit. Admins only. */
export async function masterUpdateStartAction(agentId: number): Promise<{ ok: boolean; message: string }> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { ok: false, message: t("msg.forbidden") };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a) return { ok: false, message: t("msg.unknownHost") };
  if (!a.enabled) return { ok: false, message: t("msg.hostDisabled") };
  const tg = targetFor(agentId);
  if (!tg) return { ok: false, message: t("msg.noCreds") };
  const r = await (tg.local ? agentUpdateStart(tg) : agentPeerStart(tg));
  if (!r.ok) {
    if (r.code === "UPDATE_NOT_POSSIBLE") {
      const k = tg.local ? MASTER_REASONS[r.message] : UPDATE_REASONS[r.message];
      return { ok: false, message: k ? t(k) : errText(t, r.code, r.message) };
    }
    return { ok: false, message: errText(t, r.code, r.message) };
  }
  await audit(session, "master.update", { host: a.hostname });
  return { ok: true, message: t("mupdate.started") };
}

export type MasterUpdateStatus = { state: "pulling" | "restarting" | "current" | "error" | "idle"; message?: string };

/** Progress of the master's update of itself (only for the master's own host). Admins only. */
export async function masterUpdateStatusAction(agentId: number): Promise<MasterUpdateStatus | null> {
  const session = await requireAuth();
  if (session.access !== "all") return null;
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  const tg = a ? targetFor(a.id) : null;
  if (!tg?.local) return null;
  const r = await agentSelfInfo(tg);
  if (!r.ok) return null;
  const st = r.data.state;
  return { state: st === "pulling" || st === "restarting" || st === "current" || st === "error" ? st : "idle", ...(r.data.message ? { message: r.data.message } : {}) };
}

const IMAGE_TAG_RE = /^[A-Za-z0-9._\-/:@]{1,255}$/;

async function imageAdminTarget(agentId: number): Promise<{ err: string; t: Awaited<ReturnType<typeof getT>> } | { err?: undefined; tg: NonNullable<ReturnType<typeof targetFor>>; t: Awaited<ReturnType<typeof getT>> }> {
  const session = await requireAuth();
  const t = await getT();
  if (session.access !== "all") return { err: t("msg.forbidden"), t };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a) return { err: t("msg.unknownHost"), t };
  if (!a.enabled) return { err: t("msg.hostDisabled"), t };
  const tg = targetFor(agentId);
  if (!tg) return { err: t("msg.noCreds"), t };
  return { tg, t };
}

/** Delete an image or, with `tag`, only that tag. Admins only; the agent refuses images in use and its own images. */
export async function imageDeleteAction(agentId: number, imageId: string, tag: string | null): Promise<{ ok: boolean; message: string }> {
  const x = await imageAdminTarget(agentId);
  if (x.err !== undefined) return { ok: false, message: x.err };
  const { tg, t } = x;
  if (!CONTAINER_ID_RE.test(imageId) || (tag !== null && !IMAGE_TAG_RE.test(tag))) return { ok: false, message: t("errc.INVALID_PARAM") };
  const r = await agentImageDelete(tg, imageId, tag);
  await audit(await requireAuth(), "image.delete", { target: tag ?? imageId.slice(0, 12), host: getAgent(agentId)?.hostname, ok: r.ok, detail: r.ok ? "" : r.code });
  revalidatePath("/resources");
  revalidatePath("/hosts");
  if (!r.ok) return { ok: false, message: errText(t, r.code, r.message) };
  return { ok: true, message: r.data.result === "untagged" ? t("images.untagged") : t("images.deleted") };
}

/** Remove dangling images of the given hosts (one line of result per host). Admins only; every host is checked on its own. */
export async function imagePruneAction(agentIds: number[]): Promise<{ ok: boolean; message: string }> {
  const t = await getT();
  const ids = [...new Set(Array.isArray(agentIds) ? agentIds : [])].filter((n) => Number.isInteger(n)).slice(0, 200);
  if (ids.length === 0) return { ok: false, message: t("msg.unknownHost") };
  const lines = await Promise.all(
    ids.map(async (id): Promise<{ ok: boolean; line: string }> => {
      const x = await imageAdminTarget(id);
      if (x.err !== undefined) return { ok: false, line: x.err };
      const name = getAgent(id)?.hostname ?? String(id);
      const r = await agentImagePrune(x.tg);
      await audit(await requireAuth(), "image.prune", { host: name, ok: r.ok, detail: r.ok ? `${r.data.removed} images` : r.code });
      if (!r.ok) return { ok: false, line: `${name}: ${errText(x.t, r.code, r.message)}` };
      return { ok: true, line: `${name}: ${r.data.removed > 0 ? x.t("images.pruned", { n: r.data.removed, size: fmtBytes(r.data.reclaimed) }) : x.t("images.pruneNone")}` };
    }),
  );
  revalidatePath("/resources");
  revalidatePath("/hosts");
  return { ok: lines.every((l) => l.ok), message: lines.map((l) => l.line).join("\n") };
}

const RES_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;

/** Delete one volume or network. Admins only; the agent refuses what is in use (and the default network). */
async function resourceDelete(kind: "volume" | "network", agentId: number, name: string): Promise<{ ok: boolean; message: string }> {
  const x = await imageAdminTarget(agentId);
  if (x.err !== undefined) return { ok: false, message: x.err };
  const { tg, t } = x;
  if (typeof name !== "string" || !RES_NAME_RE.test(name)) return { ok: false, message: t("errc.INVALID_PARAM") };
  const r = await (kind === "volume" ? agentVolumeDelete(tg, name) : agentNetworkDelete(tg, name));
  await audit(await requireAuth(), `${kind}.delete`, { target: name, host: getAgent(agentId)?.hostname, ok: r.ok, detail: r.ok ? "" : r.code });
  revalidatePath("/resources");
  if (!r.ok) return { ok: false, message: errText(t, r.code, r.message) };
  return { ok: true, message: t(kind === "volume" ? "volumes.deleted" : "networks.deleted") };
}

export async function volumeDeleteAction(agentId: number, name: string): Promise<{ ok: boolean; message: string }> {
  return resourceDelete("volume", agentId, name);
}
export async function networkDeleteAction(agentId: number, name: string): Promise<{ ok: boolean; message: string }> {
  return resourceDelete("network", agentId, name);
}

/**
 * Remove every unused volume or network of the given hosts, one by one (the agent refuses anything that became used in the
 * meantime). One result line per host. Admins only; every host is checked on its own.
 */
async function resourcePrune(kind: "volume" | "network", agentIds: number[]): Promise<{ ok: boolean; message: string }> {
  const t = await getT();
  const ids = [...new Set(Array.isArray(agentIds) ? agentIds : [])].filter((n) => Number.isInteger(n)).slice(0, 200);
  if (ids.length === 0) return { ok: false, message: t("msg.unknownHost") };
  const lines = await Promise.all(
    ids.map(async (id): Promise<{ ok: boolean; line: string }> => {
      const x = await imageAdminTarget(id);
      if (x.err !== undefined) return { ok: false, line: x.err };
      const host = getAgent(id)?.hostname ?? String(id);
      const list = await (kind === "volume" ? agentVolumes(x.tg) : agentNetworks(x.tg));
      if (!list.ok) return { ok: false, line: `${host}: ${errText(x.t, list.code, list.message)}` };
      const names = kind === "volume"
        ? (list.data as { name: string; unused: boolean }[]).filter((v) => v.unused).map((v) => v.name)
        : (list.data as { name: string; containers: string[]; protected: boolean }[]).filter((n) => !n.protected && n.containers.length === 0).map((n) => n.name);
      let removed = 0;
      let skipped = 0;
      for (const name of names) {
        const r = await (kind === "volume" ? agentVolumeDelete(x.tg, name) : agentNetworkDelete(x.tg, name));
        if (r.ok) removed++;
        else skipped++;
      }
      await audit(await requireAuth(), `${kind}.prune`, { host, ok: skipped === 0, detail: `${removed} removed${skipped ? `, ${skipped} skipped` : ""}` });
      const key = kind === "volume" ? "volumes.pruned" : "networks.pruned";
      return { ok: true, line: `${host}: ${removed > 0 || skipped > 0 ? x.t(key, { n: removed, skipped }) : x.t(kind === "volume" ? "volumes.pruneNone" : "networks.pruneNone")}` };
    }),
  );
  revalidatePath("/resources");
  return { ok: lines.every((l) => l.ok), message: lines.map((l) => l.line).join("\n") };
}

export async function volumesPruneAction(agentIds: number[]): Promise<{ ok: boolean; message: string }> {
  return resourcePrune("volume", agentIds);
}
export async function networksPruneAction(agentIds: number[]): Promise<{ ok: boolean; message: string }> {
  return resourcePrune("network", agentIds);
}
