import Link from "next/link";
import ContainerActions from "@/components/ContainerActions";
import { StatusBadge, fmt } from "@/components/ui";
import { agentInspect } from "@/lib/agent-client";
import { getAgent, targetFor } from "@/lib/agents";
import { requireAuth } from "@/lib/session";
import { CONTAINER_ID_RE } from "@/lib/validate";

export const dynamic = "force-dynamic";

export default async function Detail({ params }: { params: Promise<{ host: string; id: string }> }) {
  await requireAuth();
  const { host, id } = await params;
  const agent = /^\d+$/.test(host) ? getAgent(Number(host)) : null;
  const back = <Link href="/containers" className="text-sm text-sky-400 hover:underline">← Containers</Link>;
  if (!agent || !CONTAINER_ID_RE.test(id)) return <div className="space-y-3">{back}<p className="card">Container not found.</p></div>;
  if (!agent.enabled) return <div className="space-y-3">{back}<p className="card text-amber-300">Host {agent.hostname} is disabled.</p></div>;
  const t = targetFor(agent.id);
  const r = t ? await agentInspect(t, id) : null;
  if (!r || !r.ok) {
    return <div className="space-y-3">{back}<p className="card border-red-900 text-red-300">{r ? `${r.message} (${r.code})` : "Credentials missing"}</p></div>;
  }
  const c = r.data;
  const rows: [string, React.ReactNode][] = [
    ["Name", c.name], ["Container ID", <span className="font-mono text-xs break-all" key="i">{c.id}</span>],
    ["Image", c.image], ["Status", <StatusBadge key="s" status={c.state} />],
    ["Host", `${agent.hostname} (${agent.address}:${agent.port})`],
    ["Created", fmt(c.createdAt)], ["Started", fmt(c.startedAt)],
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
