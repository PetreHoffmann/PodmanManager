import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { listGroups } from "@/lib/groups";
import { resolveSamlAccess, safeNext } from "@/lib/saml-access";
import { loadSamlConfig, samlReady } from "@/lib/saml-config";
import { MANUAL_COOKIE, NONCE_COOKIE, REAUTH_COOKIE, htmlRedirect } from "@/lib/saml-http";
import { completeLogin } from "@/lib/saml";
import { adminExists, startSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_RESPONSE = 512 * 1024;

/** Assertion consumer service: ADFS posts the signed response here. */
export async function POST(req: NextRequest) {
  const cfg = loadSamlConfig();
  if (!samlReady(cfg)) return new NextResponse("Not found", { status: 404 });
  if (!adminExists()) return htmlRedirect("/setup");

  let samlResponse = "";
  let relay = "";
  try {
    const form = await req.formData();
    samlResponse = String(form.get("SAMLResponse") ?? "");
    relay = String(form.get("RelayState") ?? "");
  } catch {
    return htmlRedirect("/login?sso=failed");
  }
  if (!samlResponse || samlResponse.length > MAX_RESPONSE) return htmlRedirect("/login?sso=failed");

  // With https the response must come back in the browser that started the login (protects against login CSRF).
  const jar = await cookies();
  const dot = relay.indexOf(".");
  const nonce = dot > 0 ? relay.slice(0, dot) : "";
  const next = dot > 0 ? safeNext(relay.slice(dot + 1)) : "/";
  const cookieNonce = jar.get(NONCE_COOKIE)?.value;
  if (cfg.publicUrl.startsWith("https://") && (!nonce || cookieNonce !== nonce)) {
    console.warn("saml login failed: response does not belong to this browser (nonce missing or different)");
    return htmlRedirect("/login?sso=failed");
  }
  jar.delete(NONCE_COOKIE);

  const r = await completeLogin(cfg, samlResponse);
  if (!r.ok) {
    console.warn(`saml login failed: ${r.reason}`);
    await audit(null, "login.fail", { ok: false, detail: `sso: ${r.reason}` });
    return htmlRedirect("/login?sso=failed");
  }
  const access = resolveSamlAccess(cfg, r.groups, listGroups().filter((g) => g.saml_group).map((g) => ({ id: g.id, name: g.name, samlGroup: g.saml_group })));
  if (!access.ok) {
    console.warn(`saml login denied: ${r.username}${r.displayName ? ` (${r.displayName})` : ""}: no matching group (received: ${r.groups.slice(0, 20).join(", ").slice(0, 300) || "none"})`);
    await audit({ username: r.username, kind: "saml" }, "login.denied", { ok: false, detail: "no agent group" });
    return htmlRedirect("/login?sso=denied");
  }
  jar.delete({ name: MANUAL_COOKIE, path: "/" });
  jar.delete({ name: REAUTH_COOKIE, path: "/saml" }); // the identity provider has authenticated the user again
  await startSession({ username: r.username, kind: "saml", access: access.admin ? "all" : "groups", groupIds: access.groupIds, displayName: r.displayName });
  await audit({ username: r.username, kind: "saml" }, "login.ok");
  return htmlRedirect(next);
}
