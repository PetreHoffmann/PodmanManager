import { NextResponse } from "next/server";
import { loadSamlConfig } from "@/lib/saml-config";
import { spMetadataXml } from "@/lib/saml";

export const dynamic = "force-dynamic";

/** Service provider metadata, imported by ADFS when the relying party trust is created. Contains no secrets. */
export async function GET() {
  const cfg = loadSamlConfig();
  if (!cfg || !cfg.publicUrl) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(spMetadataXml(cfg), { headers: { "Content-Type": "application/samlmetadata+xml; charset=utf-8", "Cache-Control": "no-store" } });
}
