import Link from "next/link";
import { agentStorage } from "@/lib/agent-client";
import { listAgents, targetFor } from "@/lib/agents";
import { sumVolumes } from "@/lib/dashboard";
import { getLang, getT } from "@/lib/lang";
import { Stat, fmtBytes } from "@/components/ui";

/**
 * Number and size of all volumes over the hosts the user may see. Rendered inside <Suspense>: `podman system df` can be slow,
 * so the dashboard appears at once and this card fills in.
 */
export default async function DashboardVolumes({ allowed }: { allowed: ReadonlySet<number> | null }) {
  const t = await getT();
  const lang = await getLang();
  const agents = listAgents().filter((a) => a.enabled && (allowed === null || allowed.has(a.id)) && a.status !== "offline");
  const results = await Promise.all(
    agents.map(async (a) => {
      try {
        const tg = targetFor(a.id);
        const r = tg ? await agentStorage(tg) : null;
        return r && r.ok ? r.data : null;
      } catch {
        return null;
      }
    }),
  );
  const v = sumVolumes(results);
  const tone = v.missing > 0 ? "warn" : undefined;
  const title = v.missing > 0 ? t("dash.volumesMissing", { n: v.missing }) : undefined;
  return (
    <>
      <Link href="/resources?tab=volumes" className="block transition hover:opacity-90" title={title} data-testid="dash-volumes"><Stat label={t("dash.volumes")} value={v.count} tone={tone} /></Link>
      <Link href="/resources?tab=volumes" className="block transition hover:opacity-90" title={title} data-testid="dash-volumes-size"><Stat label={t("dash.volumesSize")} value={fmtBytes(v.size, lang)} tone={tone} /></Link>
    </>
  );
}

export function DashboardVolumesFallback({ labels }: { labels: [string, string] }) {
  return (
    <>
      {labels.map((label) => <Stat key={label} label={label} value="…" />)}
    </>
  );
}
