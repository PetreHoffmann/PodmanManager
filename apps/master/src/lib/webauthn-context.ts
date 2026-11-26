import { originAllowed, parseAllowedOrigins } from "./origins";

export interface WebauthnContext { rpId: string; origin: string }

const validHost = (hostname: string) => !!hostname && !/^[\d.]+$/.test(hostname) && !hostname.includes(":") && !hostname.includes("[");

/**
 * Relying party id and origin as the browser sees them. IP addresses cannot be relying party ids.
 * 1. If the browser's own Origin header names a host from ALLOWED_ORIGINS (the same allowlist that lets Server Actions through
 *    a proxy), that origin is used: it is what the browser compares against, whatever the proxy forwards.
 * 2. Otherwise it is derived from X-Forwarded-Host/Host and X-Forwarded-Proto (the proxy must pass them).
 */
export function webauthnContext(get: (name: string) => string | null, allowedRaw: string | undefined): WebauthnContext | null {
  const origin = get("origin");
  const patterns = parseAllowedOrigins(allowedRaw);
  if (origin && patterns.length > 0) {
    try {
      const u = new URL(origin);
      if ((u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost")) && validHost(u.hostname) && originAllowed(u.host, patterns)) {
        return { rpId: u.hostname, origin: u.origin };
      }
    } catch { /* not a URL: fall through */ }
  }
  const host = (get("x-forwarded-host") ?? get("host") ?? "").split(",")[0]!.trim();
  const hostname = host.replace(/:\d+$/, "");
  if (!validHost(hostname)) return null;
  const proto = get("x-forwarded-proto")?.split(",")[0]!.trim() || (hostname === "localhost" ? "http" : "https");
  if (proto !== "http" && proto !== "https") return null;
  return { rpId: hostname, origin: `${proto}://${host}` };
}
