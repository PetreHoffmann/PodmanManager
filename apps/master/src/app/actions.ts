"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { agentAction } from "@/lib/agent-client";
import { checkAgent, getAgent, registerAgent, removeAgent, setEnabled, targetFor } from "@/lib/agents";
import {
  adminExists, checkAdminPassword, endSession, loginBlocked, recordLoginFailure,
  requireAuth, setAdminPassword, startSession,
} from "@/lib/session";
import { isAction, CONTAINER_ID_RE } from "@/lib/validate";

export type FormState = { ok: boolean; message: string } | null;

const s = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
const MIN_PW = 10;

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  if (adminExists()) redirect("/login");
  const pw = s(fd, "password");
  if (pw.length < MIN_PW) return { ok: false, message: `Password must be at least ${MIN_PW} characters` };
  if (pw !== s(fd, "confirm")) return { ok: false, message: "Passwords do not match" };
  await setAdminPassword(pw);
  await startSession();
  redirect("/");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!adminExists()) redirect("/setup");
  if (loginBlocked()) return { ok: false, message: "Too many failed attempts. Try again in a minute." };
  if (!(await checkAdminPassword(s(fd, "password")))) {
    recordLoginFailure();
    return { ok: false, message: "Invalid password" };
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
  if (!(await checkAdminPassword(s(fd, "current")))) return { ok: false, message: "Current password is wrong" };
  const pw = s(fd, "password");
  if (pw.length < MIN_PW) return { ok: false, message: `Password must be at least ${MIN_PW} characters` };
  if (pw !== s(fd, "confirm")) return { ok: false, message: "Passwords do not match" };
  await setAdminPassword(pw);
  await startSession();
  return { ok: true, message: "Password changed" };
}

export async function addAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const r = await registerAgent(s(fd, "url"), s(fd, "token").trim());
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath("/hosts");
  return { ok: true, message: "Agent registered" };
}

function idOf(fd: FormData): number | null {
  const n = Number(s(fd, "id"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function removeAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const id = idOf(fd);
  if (!id) return { ok: false, message: "Invalid agent" };
  removeAgent(id);
  revalidatePath("/hosts");
  return { ok: true, message: "Agent removed" };
}

export async function toggleAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const id = idOf(fd);
  if (!id || !getAgent(id)) return { ok: false, message: "Invalid agent" };
  setEnabled(id, s(fd, "enable") === "1");
  revalidatePath("/hosts");
  return { ok: true, message: "Updated" };
}

export async function testAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const id = idOf(fd);
  const a = id ? getAgent(id) : null;
  if (!id || !a) return { ok: false, message: "Invalid agent" };
  if (!a.enabled) return { ok: false, message: "Agent is disabled" };
  const r = await checkAgent(id);
  revalidatePath("/hosts");
  if (r && (r.status === "online" || r.status === "degraded") && r.fail_count === 0) {
    return { ok: r.status === "online", message: r.status === "online" ? "Connection and authentication OK" : `Agent reachable, Podman problem: ${r.last_error ?? "unknown"}` };
  }
  return { ok: false, message: r?.last_error ?? "Check failed" };
}

export async function containerOpAction(agentId: number, containerId: string, action: string): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  if (!isAction(action)) return { ok: false, message: "Action not allowed" };
  if (!CONTAINER_ID_RE.test(containerId)) return { ok: false, message: "Invalid container id" };
  const a = Number.isInteger(agentId) ? getAgent(agentId) : null;
  if (!a) return { ok: false, message: "Unknown host" };
  if (!a.enabled) return { ok: false, message: "Host is disabled" };
  const t = targetFor(agentId);
  if (!t) return { ok: false, message: "Host credentials missing" };
  const r = await agentAction(t, containerId, action);
  revalidatePath("/containers");
  revalidatePath("/");
  if (r.ok) {
    return { ok: true, message: r.data.changed ? `${action} succeeded: now ${r.data.container.state}` : `No change needed (${r.data.container.state})` };
  }
  return { ok: false, message: `${action} failed: ${r.message} (${r.code})` };
}
