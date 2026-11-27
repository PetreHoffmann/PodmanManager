import Link from "next/link";
import ContainerActions from "@/components/ContainerActions";
import ContainerLogs from "@/components/ContainerLogs";
import AutoRefresh from "@/components/AutoRefresh";
import { MetricsCard } from "@/components/MetricsCard";
import { StatusBadge } from "@/components/StatusBadge";
import { fmt } from "@/components/ui";
import { agentContainerConfig, agentHealth, agentInspect } from "@/lib/agent-client";
import ContainerExec from "@/components/ContainerExec";
import ContainerDelete from "@/components/ContainerDelete";
import ContainerConfigTabs from "@/components/ContainerConfigTabs";
import { kubePlayCommand, kubeYaml, podmanRunCommand, quadletFile } from "@/lib/create-preview";
import { getAgent, targetFor } from "@/lib/agents";
import { errText } from "@/lib/i18n";
import { getConfig } from "@/lib/config";
import { getT, getLang } from "@/lib/lang";
import { hostState, seriesFor } from "@/lib/metrics";
import { allowedAgentIds, mayAccessAgent } from "@/lib/groups";
import { hiddenPatternsFor, isHidden } from "@/lib/hidden";
import { requireAuth } from "@/lib/session";
import { CONTAINER_ID_RE } from "@/lib/validate";

export const dynamic = "force-dynamic";

export default async function Detail({ params }: { params: Promise<{ host: string; id: string }> }) {
  const session = await requireAuth();
  const t = await getT();
  const { host, id } = await params;
  const agent = /^\d+$/.test(host) ? getAgent(Number(host)) : null;
  const visible = agent !== null && mayAccessAgent(allowedAgentIds(session), agent.id);
  const back = <Link href="/containers" className="text-sm text-sky-400 hover:underline">{t("detail.back")}</Link>;
  if (!agent || !visible || !CONTAINER_ID_RE.test(id)) return <div className="space-y-3">{back}<p className="card">{t("detail.notFound")}</p></div>;
  if (!agent.enabled) return <div className="space-y-3">{back}<p className="card text-amber-300">{t("detail.disabled", { host: agent.hostname })}</p></div>;
  const target = targetFor(agent.id);
  const r = target ? await agentInspect(target, id) : null;
  if (!r || !r.ok) {
    return <div className="space-y-3">{back}<p className="card border-red-900 text-red-300">{r ? `${errText(t, r.code, r.message)} (${r.code})` : t("detail.noCreds")}</p></div>;
  }
  const c = r.data;
  if (isHidden(c.name, hiddenPatternsFor(session))) return <div className="space-y-3">{back}<p className="card">{t("detail.notFound")}</p></div>;
  // the settings contain environment values (often passwords): administrators only
  const conf = session.access === "all" ? await agentContainerConfig(target!, id) : null;
  const confTexts = conf?.ok ? {
    run: podmanRunCommand(conf.data), quadlet: quadletFile(conf.data), file: `${conf.data.name}.container`, bindMounts: conf.data.bindMounts,
    kube: conf.data.pod ? kubeYaml(conf.data) : null, kubeCmd: conf.data.pod ? kubePlayCommand(conf.data) : null,
  } : null;
  // running commands: administrators only, and only where the agent switched it on (EXEC_ENABLED)
  const execOn = session.access === "all" && c.state === "running" ? await agentHealth(target!).then((h) => h.ok && h.data.execEnabled === true) : false;
  const canDelete = session.access === "all" && c.systemdUnit === null && c.infra !== true && !["running", "paused", "restarting"].includes(c.state);
  const rows: [string, React.ReactNode][] = [
    [t("cont.name"), c.name], [t("detail.cid"), <span className="font-mono text-xs break-all" key="i">{c.id}</span>],
    [t("cont.image"), c.image], [t("cont.status"), <StatusBadge key="s" status={c.state} />],
    [t("cont.host"), `${agent.hostname} (${agent.address}:${agent.port})`],
    ...(c.podId ? [[t("cont.pod"), <Link key="p" className="text-sky-400 hover:underline" href={`/pods/${agent.id}/${c.podId}`}>{c.podName || c.podId.slice(0, 12)}</Link>] as [string, React.ReactNode]] : []),
    [t("cont.created"), fmt(c.createdAt)], [t("cont.started"), fmt(c.startedAt)],
  ];
  return (
    <div className="space-y-4">
      {back}
      <h1 className="text-xl font-semibold">{c.name}</h1>
      <dl className="card grid max-w-2xl grid-cols-[8rem_1fr] gap-y-2 text-sm">
        {rows.map(([k, v]) => (<><dt key={k} className="text-slate-400">{k}</dt><dd key={k + "v"}>{v}</dd></>))}
      </dl>
      <ContainerActions agentId={agent.id} containerId={c.id} state={c.state} name={c.name} />
      {canDelete && <ContainerDelete agentId={agent.id} containerId={c.id} name={c.name} redirectTo="/containers" />}
      {session.access === "all" && c.systemdUnit && <p className="text-xs text-slate-500">{t("del.systemd", { unit: c.systemdUnit })}</p>}
      {c.state === "running" && (
        <>
          <MetricsCard t={t} lang={await getLang()} points={seriesFor(agent.id, c.id)?.points ?? null} host={hostState(agent.id)} keepMin={getConfig().metricsKeepMin} />
          {getConfig().metricsKeepMin > 0 && <AutoRefresh seconds={getConfig().metricsIntervalSec} />}
        </>
      )}
      {execOn && <ContainerExec agentId={agent.id} containerId={c.id} name={c.name} />}
      {confTexts && <ContainerConfigTabs texts={confTexts} />}
      <ContainerLogs agentId={agent.id} containerId={c.id} />
    </div>
  );
}
