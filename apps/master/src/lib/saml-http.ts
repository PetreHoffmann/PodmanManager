import { NextResponse } from "next/server";
import { safeNext } from "./saml-access";

/** Name of the cookie that ties the response to the browser that started the login. */
export const NONCE_COOKIE = "pm_saml_nonce";
/** RelayState is limited to 80 bytes by the SAML specification: 22 characters nonce + "." + path. */
export const MAX_NEXT = 40;

export const relayTarget = (next: string | null): string => {
  const n = safeNext(next ?? "/");
  return n.length <= MAX_NEXT ? n : "/";
};

/**
 * A page that sends the browser on with a client-side redirect. After the cross-site POST from ADFS a
 * server redirect would still count as cross-site and the SameSite=Strict session cookie would not be sent.
 */
export function htmlRedirect(path: string): NextResponse {
  const safe = path.replace(/[^A-Za-z0-9/_\-.?=&]/g, "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"><title>PodmanManager</title></head><body><p><a href="${safe}">Continue</a></p><script>location.replace(${JSON.stringify(safe)})</script></body></html>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const g = globalThis as unknown as { __pmSamlStarts?: number[] };

/** At most 30 login starts per minute (each one stores a request id). */
export function startAllowed(now = Date.now()): boolean {
  const l = (g.__pmSamlStarts ??= []).filter((t) => t > now - 60_000);
  g.__pmSamlStarts = l;
  if (l.length >= 30) return false;
  l.push(now);
  return true;
}
