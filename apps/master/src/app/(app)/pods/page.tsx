import Link from "next/link";
import ContainerActions from "@/components/ContainerActions";
import { StatusBadge } from "@/components/StatusBadge";
import { fmt, fmtShort } from "@/components/ui";
import { fetchAllPods } from "@/lib/agents";
import { errText } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { allowedAgentIds, groupNames } from "@/lib/groups";
import { hiddenPatternsFor } from "@/lib/hidden";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

type SP = Promise<{ host?: string; status?: string; q?: string }>;

export default async function Pods({ searchParams }: { searchParams: SP }) {
  const session = await requireAuth();
  const t = await getT();
  const { host = "", status = "", q = "" } = await searchParams;
  const hosts = await fetchAllPods(undefined, allowedAgentIds(session), hiddenPatternsFor(session));

  const rows = hosts
    .flatMap((h) => (h.result.ok ? h.result.data.map((p) => ({ agent: h.agent, p })) : []))
    .filter(({ agent, p }) => (!host || String(agent.id) === host)
      && (!status || (status === "running" ? p.status === "running" : status === "degraded" ? p.status === "degraded" : p.status !== "running" && p.status !== "degraded"))
      && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.p.name.localeCompare(b.p.name));
  const failed = hosts.filter((h) => !h.result.ok && h.agent.enabled);
  const count = (p: { containers: { infra: boolean }[] }) => p.containers.filter((c) => !c.infra).length;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("pods.title")}</h1>
      {session.access === "groups" && <p className="text-xs text-slate-400">{t("scope.note", { groups: groupNames(session).join(", ") || "—" })}</p>}
      <form className="flex flex-wrap gap-2" method="get">
        <select name="host" defaultValue={host} className="input w-auto">
          <option value="">{t("cont.allHosts")}</option>
          {hosts.map((h) => <option key={h.agent.id} value={h.agent.id}>{h.agent.hostname}</option>)}
        </select>
        <select name="status" defaultValue={status} className="input w-auto">
          <option value="">{t("cont.anyStatus")}</option>
          <option value="running">{t("status.running")}</option>
          <option value="degraded">{t("status.degraded")}</option>
          <option value="stopped">{t("cont.notRunning")}</option>
        </select>
        <input name="q" defaultValue={q} placeholder={t("pods.namePh")} className="input w-48" />
        <button className="btn">{t("cont.filter")}</button>
      </form>

      {failed.map((h) => (
        <p key={h.agent.id} className="card border-red-900 text-sm text-red-300">
          {t("pods.unavailable", { host: h.agent.hostname, msg: h.result.ok ? "" : errText(t, h.result.code, h.result.message) })}
        </p>
      ))}

      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[800px]">
          <thead className="border-b border-slate-800">
            <tr>{(["pods.name", "cont.id", "cont.host", "cont.status", "pods.containers", "cont.created", "cont.actions"] as const).map((k) => <th key={k} className="th">{t(k)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>{t("pods.none")}</td></tr>}
            {rows.map(({ agent, p }) => (
              <tr key={`${agent.id}-${p.id}`} className="transition hover:bg-slate-900">
                <td className="td max-w-[14rem] break-words font-medium"><Link className="text-sky-400 hover:underline" href={`/pods/${agent.id}/${p.id}`}>{p.name || p.id.slice(0, 12)}</Link></td>
                <td className="td font-mono text-xs">{p.id.slice(0, 12)}</td>
                <td className="td max-w-[11rem] truncate" title={agent.hostname}>{agent.hostname}</td>
                <td className="td"><StatusBadge status={p.status} /></td>
                <td className="td tabular-nums">{count(p)}</td>
                <td className="td whitespace-nowrap text-xs" title={fmt(p.createdAt)}>{fmtShort(p.createdAt)}</td>
                <td className="td w-px"><ContainerActions kind="pod" agentId={agent.id} containerId={p.id} state={p.status} name={p.name} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="card text-sm text-slate-400">{t("pods.none")}</p>}
        {rows.map(({ agent, p }) => (
          <div key={`${agent.id}-${p.id}`} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <Link className="break-all font-medium text-sky-400" href={`/pods/${agent.id}/${p.id}`}>{p.name || p.id.slice(0, 12)}</Link>
              <StatusBadge status={p.status} />
            </div>
            <div className="text-xs text-slate-500">{agent.agent_id} · {p.id.slice(0, 12)} · {t("pods.containers")}: {count(p)}</div>
            <ContainerActions kind="pod" agentId={agent.id} containerId={p.id} state={p.status} name={p.name} />
          </div>
        ))}
      </div>
    </div>
  );
}
