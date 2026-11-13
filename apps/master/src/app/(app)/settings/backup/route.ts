import { NextResponse, type NextRequest } from "next/server";
import { ensureLocalHost } from "@/lib/agents";
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
  if (!adminOnly(req)) return new NextResponse(null, { status: 403, headers: NO_STORE });
  const day = new Date().toISOString().slice(0, 10);
  const data = createBackup();
  console.warn("database backup downloaded by the local administrator");
  return new NextResponse(new Uint8Array(data), {
    headers: { ...NO_STORE, "Content-Type": "application/vnd.sqlite3", "Content-Length": String(data.length), "Content-Disposition": `attachment; filename="podmanmanager-${day}.db"` },
  });
}

export async function POST(req: NextRequest) {
  const t = await getT();
  const json = (status: number, ok: boolean, message: string) => NextResponse.json({ ok, message }, { status, headers: NO_STORE });
  if (!adminOnly(req)) return json(403, false, t("msg.forbidden"));
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
  if (!(f instanceof File) || f.size > MAX_BACKUP_BYTES) return json(400, false, t("err.restoreFile"));
  if (fd.get("confirm") !== "on") return json(400, false, t("err.restoreFile"));
  let key: Buffer | undefined;
  try {
    key = getSecretKey();
  } catch {
    key = undefined;
  }
  let r;
  try {
    r = restoreBackup(Buffer.from(await f.arrayBuffer()), { key, force: fd.get("force") === "on" });
  } catch (e) {
    console.warn(`database restore failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    return json(500, false, t("err.restoreFile"));
  }
  if (!r.ok) {
    console.warn(`database restore refused: ${r.error}${r.unreadable ? ` (${r.unreadable} host tokens not readable with the current MASTER_SECRET_KEY)` : ""}`);
    return json(400, false, r.error === "err.restoreKey" ? t("err.restoreKey", { n: r.unreadable ?? 0 }) : t("err.restoreFile"));
  }
  ensureLocalHost();
  console.warn(`database restored by the local administrator: ${r.agents} hosts, ${r.groups} groups, ${r.users} local users; all sessions ended`);
  return json(200, true, t("msg.restored", { agents: r.agents, groups: r.groups, users: r.users }));
}
