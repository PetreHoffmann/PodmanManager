import { fetchAllContainers, fetchAllPods } from "@/lib/agents";
import { getT } from "@/lib/lang";
import { allowedAgentIds, groupNames } from "@/lib/groups";
import { hiddenPatternsFor } from "@/lib/hidden";
import { requireAuth } from "@/lib/session";
import { Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await requireAuth();
  const t = await getT();
  const allowed = allowedAgentIds(session);
  const hidden = hiddenPatternsFor(session);
  const [hosts, podHosts] = await Promise.all([fetchAllContainers(undefined, allowed, hidden), fetchAllPods(undefined, allowed, hidden)]);
  const total = hosts.length;
  const reachable = hosts.filter((h) => h.agent.enabled && (h.agent.status === "online" || h.agent.status === "degraded")).length;
  const unreachable = hosts.filter((h) => h.agent.enabled && h.agent.status === "offline").length;
  const other = total - reachable - unreachable;
  const known = hosts.filter((h) => h.result.ok);
  const all = known.flatMap((h) => (h.result.ok ? h.result.data : []));
  const running = all.filter((c) => c.state === "running").length;
  const missing = total - known.length;
  const pods = podHosts.flatMap((h) => (h.result.ok ? h.result.data : []));
  const podRunning = pods.filter((p) => p.status === "running").length;
  const podDegraded = pods.filter((p) => p.status === "degraded").length;
  // Hosts whose containers could be read but whose pods could not (e.g. agent older than 0.6.0).
  const podsMissing = podHosts.filter((h) => !h.result.ok && h.agent.enabled && hosts.some((c) => c.agent.id === h.agent.id && c.result.ok));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t("dash.title")}</h1>
      {session.access === "groups" && <p className="text-xs text-slate-400">{t("scope.note", { groups: groupNames(session).join(", ") || "—" })}</p>}
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
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("dash.pods")} value={pods.length} />
        <Stat label={t("dash.podsRunning")} value={podRunning} tone="ok" />
        <Stat label={t("dash.podsDegraded")} value={podDegraded} tone={podDegraded ? "warn" : undefined} />
        <Stat label={t("dash.podsStopped")} value={pods.length - podRunning - podDegraded} />
      </section>
      {podsMissing.length > 0 && (
        <p className="card border-amber-800 text-sm text-amber-300">
          {t("dash.podsExcluded", { n: podsMissing.length, names: podsMissing.map((h) => h.agent.agent_id).join(", ") })}
        </p>
      )}
      {missing > 0 && (
        <p className="card border-amber-800 text-sm text-amber-300">
          {t("dash.excluded", { n: missing, names: hosts.filter((h) => !h.result.ok).map((h) => h.agent.hostname).join(", ") })}
        </p>
      )}
      {total === 0 && <p className="text-sm text-slate-400">{t("dash.empty")}</p>}
    </div>
  );
}
