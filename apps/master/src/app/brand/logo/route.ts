import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadLogo } from "@/lib/branding";
import { COOKIE, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The custom navbar logo. Signed-in users only; served so that an SVG can never run scripts. */
export async function GET() {
  if (!getSession((await cookies()).get(COOKIE)?.value)) return new NextResponse(null, { status: 401 });
  const logo = loadLogo();
  if (!logo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.data.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // the URL carries ?v=<hash>, so a changed logo gets a new URL
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
