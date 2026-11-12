import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { loadSamlConfig, samlReady, spAcsUrl, spEntityId } from "@/lib/saml-config";
import { NONCE_COOKIE, relayTarget, startAllowed } from "@/lib/saml-http";
import { startLogin } from "@/lib/saml";

export const dynamic = "force-dynamic";

/** Starts the SSO login: redirects the browser to ADFS with a single-use request. */
export async function GET(req: NextRequest) {
  const cfg = loadSamlConfig();
  if (!samlReady(cfg)) return new NextResponse("Not found", { status: 404 });
  if (!startAllowed()) return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const nonce = randomBytes(16).toString("base64url");
  const url = await startLogin(cfg, `${nonce}.${relayTarget(req.nextUrl.searchParams.get("next"))}`);
  console.info(`saml login started: identifier ${spEntityId(cfg)}, sign-in endpoint ${spAcsUrl(cfg)}, sent to ${cfg.idpSsoUrl}`);
  const https = cfg.publicUrl.startsWith("https://");
  const res = NextResponse.redirect(url, 302);
  // Sent back with ADFS's cross-site POST, so it needs SameSite=None (which requires https); plain http can only use Lax.
  res.cookies.set(NONCE_COOKIE, nonce, { httpOnly: true, sameSite: https ? "none" : "lax", secure: https, path: "/saml", maxAge: 600 });
  return res;
}
