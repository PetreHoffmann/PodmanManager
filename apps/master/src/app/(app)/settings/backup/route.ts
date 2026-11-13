import { NextResponse, type NextRequest } from "next/server";
import { ensureLocalHost } from "@/lib/agents";
import { audit } from "@/lib/audit";
import { isBackupName, readStoredBackup } from "@/lib/autobackup";
import { MAX_BACKUP_BYTES, createBackup, restoreBackup } from "@/lib/backup";
import { getSecretKey } from "@/lib/config";
import { getT } from "@/lib/lang";
import { COOKIE, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Only the built-in administrator: a backup holds password hashes and the encrypted host tokens, a restore replaces all accounts. */
function adminOnly(req: NextRequest) {
  const s = getSession(req.cookies.get(COOKIE)?.value);
  return s?.kind === "local" ? s : null;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(req: NextRequest) {
  const admin = adminOnly(req);
  if (!admin) return new NextResponse(null, { status: 403, headers: NO_STORE });
  const stored = req.nextUrl.searchParams.get("file");
  let data: Buffer | null;
  let name: string;
  if (stored !== null) {
    data = readStoredBackup(stored);
    if (!data) return new NextResponse(null, { status: 404, headers: NO_STORE });
    name = `podmanmanager-${stored.slice(7)}`;
  } else {
    data = createBackup();
    name = `podmanmanager-${new Date().toISOString().slice(0, 10)}.db`;
  }
  console.warn(`database backup downloaded by the local administrator${stored !== null ? ` (${stored})` : ""}`);
  await audit(admin, "backup.download", { target: stored ?? "" });
  return new NextResponse(new Uint8Array(data), {
    headers: { ...NO_STORE, "Content-Type": "application/vnd.sqlite3", "Content-Length": String(data.length), "Content-Disposition": `attachment; filename="${name}"` },
  });
}

export async function POST(req: NextRequest) {
  const t = await getT();
  const json = (status: number, ok: boolean, message: string) => NextResponse.json({ ok, message }, { status, headers: NO_STORE });
  const admin = adminOnly(req);
  if (!admin) return json(403, false, t("msg.forbidden"));
  // a browser form on another site must not be able to trigger this
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return json(403, false, t("msg.forbidden"));
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return json(400, false, t("err.restoreFile"));
  }
  const f = fd.get("file");
  const pick = fd.get("stored");
  let upload: Buffer | null = null;
  if (typeof pick === "string" && pick !== "") {
    if (!isBackupName(pick)) return json(400, false, t("err.restoreFile"));
    upload = readStoredBackup(pick);
  } else if (f instanceof File && f.size <= MAX_BACKUP_BYTES) {
    upload = Buffer.from(await f.arrayBuffer());
  }
  if (!upload || fd.get("confirm") !== "on") return json(400, false, t("err.restoreFile"));
  let key: Buffer | undefined;
  try {
    key = getSecretKey();
  } catch {
    key = undefined;
  }
  let r;
  try {
    r = restoreBackup(upload, { key, force: fd.get("force") === "on" });
  } catch (e) {
    console.warn(`database restore failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    await audit(admin, "backup.restore", { ok: false, detail: "error" });
    return json(500, false, t("err.restoreFile"));
  }
  if (!r.ok) {
    console.warn(`database restore refused: ${r.error}${r.why ? ` (${r.why})` : ""}${r.unreadable ? ` (${r.unreadable} host tokens not readable with the current MASTER_SECRET_KEY)` : ""}`);
    await audit(admin, "backup.restore", { ok: false, detail: r.error === "err.restoreKey" ? "host tokens not readable" : "invalid file" });
    return json(400, false, r.error === "err.restoreKey" ? t("err.restoreKey", { n: r.unreadable ?? 0 }) : t("err.restoreFile"));
  }
  ensureLocalHost();
  await audit(admin, "backup.restore", { detail: `${r.agents} hosts, ${r.groups} groups, ${r.users} users` });
  console.warn(`database restored by the local administrator: ${r.agents} hosts, ${r.groups} groups, ${r.users} local users; all sessions ended`);
  return json(200, true, t("msg.restored", { agents: r.agents, groups: r.groups, users: r.users }));
}
