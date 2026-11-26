import Link from "next/link";
import { agentStorage } from "@/lib/agent-client";
import { listAgents, targetFor } from "@/lib/agents";
import { sumVolumes } from "@/lib/dashboard";
import { getLang, getT } from "@/lib/lang";
import { fmtBytes } from "@/components/ui";

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
  return (
    <Link href="/resources?tab=volumes" className="card block transition hover:bg-slate-900" data-testid="dash-volumes">
      <div className="text-xs uppercase tracking-wide text-slate-400">{t("dash.volumes")}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-100">{v.count}</div>
      <div className="mt-0.5 text-sm tabular-nums text-slate-400">{fmtBytes(v.size, lang)}</div>
      {v.missing > 0 && <div className="mt-0.5 text-xs text-amber-400">{t("dash.volumesMissing", { n: v.missing })}</div>}
    </Link>
  );
}

export function DashboardVolumesFallback({ label }: { label: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 animate-pulse text-3xl font-semibold text-slate-600">…</div>
    </div>
  );
}
