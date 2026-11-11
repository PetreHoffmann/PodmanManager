import Nav from "@/components/Nav";
import { loadBranding } from "@/lib/branding";
import { requireAuth } from "@/lib/session";
import { getVersion } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  return (
    <>
      <Nav version={getVersion()} brand={loadBranding()} />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </>
  );
}
