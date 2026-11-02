import { fetchAllContainers } from "@/lib/agents";
import { getT } from "@/lib/lang";
import { requireAuth } from "@/lib/session";
import { Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireAuth();
  const t = await getT();
  const hosts = await fetchAllContainers();
  const total = hosts.length;
  const reachable = hosts.filter((h) => h.agent.enabled && (h.agent.status === "online" || h.agent.status === "degraded")).length;
  const unreachable = hosts.filter((h) => h.agent.enabled && h.agent.status === "offline").length;
  const other = total - reachable - unreachable;
  const known = hosts.filter((h) => h.result.ok);
  const all = known.flatMap((h) => (h.result.ok ? h.result.data : []));
  const running = all.filter((c) => c.state === "running").length;
  const missing = total - known.length;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t("dash.title")}</h1>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("dash.hosts")} value={total} />
        <Stat label={t("dash.reachable")} value={reachable} tone="ok" />
        <Stat label={t("dash.unreachable")} value={unreachable} tone={unreachable ? "bad" : undefined} />
        <Stat label={t("dash.other")} value={other} tone={other ? "warn" : undefined} />
      </section>
      <section className="grid grid-cols-3 gap-3">
        <Stat label={t("dash.containers")} value={all.length} />
        <Stat label={t("dash.running")} value={running} tone="ok" />
        <Stat label={t("dash.stopped")} value={all.length - running} />
      </section>
      {missing > 0 && (
        <p className="card border-amber-800 text-sm text-amber-300">
          {t("dash.excluded", { n: missing, names: hosts.filter((h) => !h.result.ok).map((h) => h.agent.hostname).join(", ") })}
        </p>
      )}
      {total === 0 && <p className="text-sm text-slate-400">{t("dash.empty")}</p>}
    </div>
  );
}
