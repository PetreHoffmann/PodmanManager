"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { agentAction } from "@/lib/agent-client";
import { checkAgent, getAgent, registerAgent, removeAgent, setEnabled, targetFor } from "@/lib/agents";
import { LANG_COOKIE, errText, isLang, lastErrText, statusLabel, type Key } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import {
  adminExists, checkAdminPassword, endSession, loginBlocked, recordLoginFailure,
  requireAuth, setAdminPassword, startSession,
} from "@/lib/session";
import { isAction, CONTAINER_ID_RE } from "@/lib/validate";

export type FormState = { ok: boolean; message: string } | null;

const s = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
const MIN_PW = 10;

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
  await startSession();
  redirect("/");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!adminExists()) redirect("/setup");
  const t = await getT();
  if (loginBlocked()) return { ok: false, message: t("msg.tooMany") };
  if (!(await checkAdminPassword(s(fd, "password")))) {
    recordLoginFailure();
    return { ok: false, message: t("msg.pwInvalid") };
  }
  await startSession();
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const t = await getT();
  if (!(await checkAdminPassword(s(fd, "current")))) return { ok: false, message: t("msg.curWrong") };
  const pw = s(fd, "password");
  if (pw.length < MIN_PW) return { ok: false, message: t("msg.pwShort", { n: MIN_PW }) };
  if (pw !== s(fd, "confirm")) return { ok: false, message: t("msg.pwMismatch") };
  await setAdminPassword(pw);
  await startSession();
  return { ok: true, message: t("msg.pwChanged") };
}

export async function addAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const t = await getT();
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
  await requireAuth();
  const t = await getT();
  const id = idOf(fd);
  if (!id) return { ok: false, message: t("msg.invalidAgent") };
  removeAgent(id);
  revalidatePath("/hosts");
  return { ok: true, message: t("msg.agentRemoved") };
}

export async function toggleAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const t = await getT();
  const id = idOf(fd);
  if (!id || !getAgent(id)) return { ok: false, message: t("msg.invalidAgent") };
  setEnabled(id, s(fd, "enable") === "1");
  revalidatePath("/hosts");
  return { ok: true, message: t("msg.updated") };
}

export async function testAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const t = await getT();
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
  await requireAuth();
  const t = await getT();
  if (!isAction(action)) return { ok: false, message: t("msg.opNotAllowed") };
  if (!CONTAINER_ID_RE.test(containerId)) return { ok: false, message: t("msg.invalidId") };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a) return { ok: false, message: t("msg.unknownHost") };
  if (!a.enabled) return { ok: false, message: t("msg.hostDisabled") };
  const tg = targetFor(agentId);
  if (!tg) return { ok: false, message: t("msg.noCreds") };
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
