import Link from "next/link";
import ContainerActions from "@/components/ContainerActions";
import { StatusBadge, fmt } from "@/components/ui";
import { fetchAllContainers } from "@/lib/agents";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

type SP = Promise<{ host?: string; status?: string; q?: string }>;

export default async function Containers({ searchParams }: { searchParams: SP }) {
  await requireAuth();
  const { host = "", status = "", q = "" } = await searchParams;
  const hosts = await fetchAllContainers();

  const rows = hosts
    .flatMap((h) => (h.result.ok ? h.result.data.map((c) => ({ agent: h.agent, c })) : []))
    .filter(({ agent, c }) => (!host || String(agent.id) === host)
      && (!status || (status === "running" ? c.state === "running" : c.state !== "running"))
      && (!q || c.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.c.name.localeCompare(b.c.name));
  const failed = hosts.filter((h) => !h.result.ok && h.agent.enabled);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Containers</h1>
      <form className="flex flex-wrap gap-2" method="get">
        <select name="host" defaultValue={host} className="input w-auto">
          <option value="">All hosts</option>
          {hosts.map((h) => <option key={h.agent.id} value={h.agent.id}>{h.agent.hostname}</option>)}
        </select>
        <select name="status" defaultValue={status} className="input w-auto">
          <option value="">Any status</option>
          <option value="running">Running</option>
          <option value="stopped">Not running</option>
        </select>
        <input name="q" defaultValue={q} placeholder="Container name" className="input w-48" />
        <button className="btn">Filter</button>
      </form>

      {failed.map((h) => (
        <p key={h.agent.id} className="card border-red-900 text-sm text-red-300">
          {h.agent.hostname}: containers unavailable — {h.result.ok ? "" : h.result.message}
        </p>
      ))}

      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[1000px]">
          <thead className="border-b border-slate-800">
            <tr>{["Name", "ID", "Host", "Image", "Status", "Created", "Started", "Actions"].map((h) => <th key={h} className="th">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No containers found.</td></tr>}
            {rows.map(({ agent, c }) => (
              <tr key={`${agent.id}-${c.id}`} className="transition hover:bg-slate-900">
                <td className="td font-medium"><Link className="text-sky-400 hover:underline" href={`/containers/${agent.id}/${c.id}`}>{c.name || c.id.slice(0, 12)}</Link></td>
                <td className="td font-mono text-xs">{c.id.slice(0, 12)}</td>
                <td className="td">{agent.hostname}</td>
                <td className="td max-w-[220px] truncate text-xs" title={c.image}>{c.image}</td>
                <td className="td"><StatusBadge status={c.state} /></td>
                <td className="td text-xs">{fmt(c.createdAt)}</td>
                <td className="td text-xs">{fmt(c.startedAt)}</td>
                <td className="td"><ContainerActions agentId={agent.id} containerId={c.id} state={c.state} name={c.name} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="card text-sm text-slate-400">No containers found.</p>}
        {rows.map(({ agent, c }) => (
          <div key={`${agent.id}-${c.id}`} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <Link className="break-all font-medium text-sky-400" href={`/containers/${agent.id}/${c.id}`}>{c.name || c.id.slice(0, 12)}</Link>
              <StatusBadge status={c.state} />
            </div>
            <div className="break-all text-xs text-slate-400">{c.image}</div>
            <div className="text-xs text-slate-500">{agent.agent_id} · {c.id.slice(0, 12)}</div>
            <div className="text-xs text-slate-500">Started: {fmt(c.startedAt)}</div>
            <ContainerActions agentId={agent.id} containerId={c.id} state={c.state} name={c.name} />
          </div>
        ))}
      </div>
    </div>
  );
}
