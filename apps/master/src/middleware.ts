import { NextResponse, type NextRequest } from "next/server";
import { originAllowed, parseAllowedOrigins } from "@/lib/origins";

/**
 * Behind a reverse proxy that rewrites the Host header, Next.js rejects Server Actions with
 * "Invalid Server Actions request" (Origin != Host). Hosts listed in ALLOWED_ORIGINS (runtime env)
 * are accepted by presenting the browser's own host as X-Forwarded-Host. Everything else keeps the
 * normal CSRF check.
 */
export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (req.method !== "POST" || !req.headers.has("next-action") || !origin) return NextResponse.next();
  const patterns = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  if (patterns.length === 0) return NextResponse.next();
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return NextResponse.next();
  }
  if (!originAllowed(host, patterns)) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.set("x-forwarded-host", host);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
