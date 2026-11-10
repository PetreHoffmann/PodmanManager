import Link from "next/link";
import ContainerActions from "@/components/ContainerActions";
import ContainerLogs from "@/components/ContainerLogs";
import { StatusBadge } from "@/components/StatusBadge";
import { fmt } from "@/components/ui";
import { agentPod } from "@/lib/agent-client";
import { getAgent, targetFor } from "@/lib/agents";
import { errText } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { allowedAgentIds, mayAccessAgent } from "@/lib/groups";
import { hiddenPatternsFor, isPodHidden } from "@/lib/hidden";
import { requireAuth } from "@/lib/session";
import { CONTAINER_ID_RE } from "@/lib/validate";

export const dynamic = "force-dynamic";

export default async function PodDetail({ params }: { params: Promise<{ host: string; id: string }> }) {
  const session = await requireAuth();
  const t = await getT();
  const { host, id } = await params;
  const agent = /^\d+$/.test(host) ? getAgent(Number(host)) : null;
  const visible = agent !== null && mayAccessAgent(allowedAgentIds(session), agent.id);
  const back = <Link href="/pods" className="text-sm text-sky-400 hover:underline">{t("pods.back")}</Link>;
  if (!agent || !visible || !CONTAINER_ID_RE.test(id)) return <div className="space-y-3">{back}<p className="card">{t("pods.notFound")}</p></div>;
  if (!agent.enabled) return <div className="space-y-3">{back}<p className="card text-amber-300">{t("detail.disabled", { host: agent.hostname })}</p></div>;
  const target = targetFor(agent.id);
  const r = target ? await agentPod(target, id) : null;
  if (!r || !r.ok) {
    return <div className="space-y-3">{back}<p className="card border-red-900 text-red-300">{r ? `${errText(t, r.code, r.message)} (${r.code})` : t("detail.noCreds")}</p></div>;
  }
  const p = r.data;
  if (isPodHidden(p, hiddenPatternsFor(session))) return <div className="space-y-3">{back}<p className="card">{t("pods.notFound")}</p></div>;
  const rows: [string, React.ReactNode][] = [
    [t("pods.name"), p.name], [t("pods.id"), <span className="font-mono text-xs break-all" key="i">{p.id}</span>],
    [t("cont.status"), <StatusBadge key="s" status={p.status} />],
    [t("cont.host"), `${agent.hostname} (${agent.address}:${agent.port})`], [t("cont.created"), fmt(p.createdAt)],
  ];
  return (
    <div className="space-y-4">
      {back}
      <h1 className="text-xl font-semibold">{p.name}</h1>
      <dl className="card grid max-w-2xl grid-cols-[8rem_1fr] gap-y-2 text-sm">
        {rows.map(([k, v]) => (<><dt key={k} className="text-slate-400">{k}</dt><dd key={k + "v"}>{v}</dd></>))}
      </dl>
      <ContainerActions kind="pod" agentId={agent.id} containerId={p.id} state={p.status} name={p.name} />
      <section className="space-y-2">
        <h2 className="font-medium">{t("pods.members")}</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead className="border-b border-slate-800"><tr><th className="th">{t("cont.name")}</th><th className="th">{t("cont.id")}</th><th className="th">{t("cont.status")}</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {p.containers.length === 0 && <tr><td className="td text-slate-400" colSpan={3}>{t("cont.none")}</td></tr>}
              {p.containers.map((c) => (
                <tr key={c.id} className="transition hover:bg-slate-900">
                  <td className="td break-all font-medium">
                    <Link className="text-sky-400 hover:underline" href={`/containers/${agent.id}/${c.id}`}>{c.name || c.id.slice(0, 12)}</Link>
                    {c.infra && <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{t("pods.infra")}</span>}
                  </td>
                  <td className="td font-mono text-xs">{c.id.slice(0, 12)}</td>
                  <td className="td"><StatusBadge status={c.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <ContainerLogs kind="pod" agentId={agent.id} containerId={p.id} />
    </div>
  );
}
