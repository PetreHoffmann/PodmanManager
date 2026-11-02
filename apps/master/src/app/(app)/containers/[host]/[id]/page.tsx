import Link from "next/link";
import ContainerActions from "@/components/ContainerActions";
import { StatusBadge } from "@/components/StatusBadge";
import { fmt } from "@/components/ui";
import { agentInspect } from "@/lib/agent-client";
import { getAgent, targetFor } from "@/lib/agents";
import { errText } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { requireAuth } from "@/lib/session";
import { CONTAINER_ID_RE } from "@/lib/validate";

export const dynamic = "force-dynamic";

export default async function Detail({ params }: { params: Promise<{ host: string; id: string }> }) {
  await requireAuth();
  const t = await getT();
  const { host, id } = await params;
  const agent = /^\d+$/.test(host) ? getAgent(Number(host)) : null;
  const back = <Link href="/containers" className="text-sm text-sky-400 hover:underline">{t("detail.back")}</Link>;
  if (!agent || !CONTAINER_ID_RE.test(id)) return <div className="space-y-3">{back}<p className="card">{t("detail.notFound")}</p></div>;
  if (!agent.enabled) return <div className="space-y-3">{back}<p className="card text-amber-300">{t("detail.disabled", { host: agent.hostname })}</p></div>;
  const target = targetFor(agent.id);
  const r = target ? await agentInspect(target, id) : null;
  if (!r || !r.ok) {
    return <div className="space-y-3">{back}<p className="card border-red-900 text-red-300">{r ? `${errText(t, r.code, r.message)} (${r.code})` : t("detail.noCreds")}</p></div>;
  }
  const c = r.data;
  const rows: [string, React.ReactNode][] = [
    [t("cont.name"), c.name], [t("detail.cid"), <span className="font-mono text-xs break-all" key="i">{c.id}</span>],
    [t("cont.image"), c.image], [t("cont.status"), <StatusBadge key="s" status={c.state} />],
    [t("cont.host"), `${agent.hostname} (${agent.address}:${agent.port})`],
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
    </div>
  );
}
