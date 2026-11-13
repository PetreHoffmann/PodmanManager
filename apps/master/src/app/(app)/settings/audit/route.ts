import { NextResponse, type NextRequest } from "next/server";
import { auditCsv, filterFrom } from "@/lib/audit";
import { COOKIE, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";


/** CSV export of the (filtered) audit log, administrators only. */
export async function GET(req: NextRequest) {
  const s = getSession(req.cookies.get(COOKIE)?.value);
  if (!s || s.access !== "all") return new NextResponse(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(auditCsv(filterFrom(req.nextUrl.searchParams)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="podmanmanager-audit-${day}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
