import Link from "next/link";
import ContainerActions from "@/components/ContainerActions";
import { StatusBadge } from "@/components/StatusBadge";
import { fmt, fmtShort } from "@/components/ui";
import { fetchAllContainers } from "@/lib/agents";
import { errText } from "@/lib/i18n";
import { getT, getLang } from "@/lib/lang";
import { allowedAgentIds, groupNames } from "@/lib/groups";
import { hiddenPatternsFor } from "@/lib/hidden";
import { latestFor } from "@/lib/metrics";
import { getConfig } from "@/lib/config";
import { fmtBytes } from "@/components/ui";
import AutoRefresh from "@/components/AutoRefresh";
import { requireAuth } from "@/lib/session";
import Icon from "@/components/Icon";

export const dynamic = "force-dynamic";

type SP = Promise<{ host?: string; status?: string; q?: string }>;

export default async function Containers({ searchParams }: { searchParams: SP }) {
  const session = await requireAuth();
  const t = await getT();
  const { host = "", status = "", q = "" } = await searchParams;
  const hosts = await fetchAllContainers(undefined, allowedAgentIds(session), hiddenPatternsFor(session));

  const rows = hosts
    .flatMap((h) => (h.result.ok ? h.result.data.map((c) => ({ agent: h.agent, c })) : []))
    .filter(({ agent, c }) => (!host || String(agent.id) === host)
      && (!status || (status === "running" ? c.state === "running" : c.state !== "running"))
      && (!q || c.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.c.name.localeCompare(b.c.name));
  const failed = hosts.filter((h) => !h.result.ok && h.agent.enabled);
  const lang = await getLang();
  const metricsOn = getConfig().metricsKeepMin > 0;
  const latest = new Map(hosts.map((h) => [h.agent.id, latestFor(h.agent.id)]));
  const cpuOf = (agentId: number, id: string) => { const p = latest.get(agentId)?.get(id); return p && p.cpu !== null ? `${p.cpu.toFixed(p.cpu < 10 ? 1 : 0)} %` : "–"; };
  const ramOf = (agentId: number, id: string) => { const p = latest.get(agentId)?.get(id); return p ? fmtBytes(p.mem, lang) : "–"; };

  return (
    <div className="space-y-4">
      {metricsOn && <AutoRefresh seconds={getConfig().metricsIntervalSec} />}
      <h1 className="text-xl font-semibold">{t("cont.title")}</h1>
      {session.access === "groups" && <p className="text-xs text-slate-400">{t("scope.note", { groups: groupNames(session).join(", ") || "—" })}</p>}
      <form className="flex flex-wrap gap-2" method="get">
        <select name="host" defaultValue={host} className="input w-auto">
          <option value="">{t("cont.allHosts")}</option>
          {hosts.map((h) => <option key={h.agent.id} value={h.agent.id}>{h.agent.agent_id} ({h.agent.hostname})</option>)}
        </select>
        <select name="status" defaultValue={status} className="input w-auto">
          <option value="">{t("cont.anyStatus")}</option>
          <option value="running">{t("cont.running")}</option>
          <option value="stopped">{t("cont.notRunning")}</option>
        </select>
        <input name="q" defaultValue={q} placeholder={t("cont.namePh")} className="input w-48" />
        <button className="btn"><Icon name="funnel" />{t("cont.filter")}</button>
      </form>

      {failed.map((h) => (
        <p key={h.agent.id} className="card border-red-900 text-sm text-red-300">
          {t("cont.unavailable", { host: h.agent.hostname, msg: h.result.ok ? "" : errText(t, h.result.code, h.result.message) })}
        </p>
      ))}

      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[960px]">
          <thead className="border-b border-slate-800">
            <tr>{(["cont.name", "cont.id", "cont.pod", "cont.host", "cont.image", "cont.status", ...(metricsOn ? (["cont.cpu", "cont.ram"] as const) : []), "cont.created", "cont.started", "cont.actions"] as const).map((k) => <th key={k} className="th">{t(k)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={metricsOn ? 11 : 9}>{t("cont.none")}</td></tr>}
            {rows.map(({ agent, c }) => (
              <tr key={`${agent.id}-${c.id}`} className="transition hover:bg-slate-900">
                <td className="td max-w-[12rem] break-words font-medium"><Link className="text-sky-400 hover:underline" href={`/containers/${agent.id}/${c.id}`}>{c.name || c.id.slice(0, 12)}</Link></td>
                <td className="td font-mono text-xs">{c.id.slice(0, 12)}</td>
                <td className="td max-w-[10rem] truncate text-xs">{c.podId ? <Link className="text-sky-400 hover:underline" href={`/pods/${agent.id}/${c.podId}`}>{c.podName || c.podId.slice(0, 12)}</Link> : "—"}</td>
                <td className="td max-w-[9rem] truncate" title={agent.hostname}>{agent.hostname}</td>
                <td className="td max-w-[12rem] truncate text-xs" title={c.image}>{c.image}</td>
                <td className="td"><StatusBadge status={c.state} /></td>
                {metricsOn && <td className="td whitespace-nowrap text-xs tabular-nums">{c.state === "running" ? cpuOf(agent.id, c.id) : "–"}</td>}
                {metricsOn && <td className="td whitespace-nowrap text-xs tabular-nums">{c.state === "running" ? ramOf(agent.id, c.id) : "–"}</td>}
                <td className="td whitespace-nowrap text-xs" title={fmt(c.createdAt)}>{fmtShort(c.createdAt)}</td>
                <td className="td whitespace-nowrap text-xs" title={fmt(c.startedAt)}>{fmtShort(c.startedAt)}</td>
                <td className="td w-px"><ContainerActions agentId={agent.id} containerId={c.id} state={c.state} name={c.name} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="card text-sm text-slate-400">{t("cont.none")}</p>}
        {rows.map(({ agent, c }) => (
          <div key={`${agent.id}-${c.id}`} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <Link className="break-all font-medium text-sky-400" href={`/containers/${agent.id}/${c.id}`}>{c.name || c.id.slice(0, 12)}</Link>
              <StatusBadge status={c.state} />
            </div>
            <div className="break-all text-xs text-slate-400">{c.image}</div>
            <div className="text-xs text-slate-500">{agent.agent_id} · {c.id.slice(0, 12)}{metricsOn && c.state === "running" ? ` · ${t("cont.cpu")} ${cpuOf(agent.id, c.id)} · ${t("cont.ram")} ${ramOf(agent.id, c.id)}` : ""}</div>
            {c.podId && <div className="text-xs text-slate-500">{t("cont.pod")}: <Link className="text-sky-400" href={`/pods/${agent.id}/${c.podId}`}>{c.podName || c.podId.slice(0, 12)}</Link></div>}
            <div className="text-xs text-slate-500">{t("cont.started")}: {fmt(c.startedAt)}</div>
            <ContainerActions agentId={agent.id} containerId={c.id} state={c.state} name={c.name} />
          </div>
        ))}
      </div>
    </div>
  );
}
