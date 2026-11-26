import Link from "next/link";
import ContainerActions from "@/components/ContainerActions";
import { StatusBadge } from "@/components/StatusBadge";
import { fmt, fmtShort } from "@/components/ui";
import { fetchAllContainers } from "@/lib/agents";
import { errText, type Key } from "@/lib/i18n";
import { getT, getLang } from "@/lib/lang";
import { allowedAgentIds, groupNames } from "@/lib/groups";
import { hiddenPatternsFor } from "@/lib/hidden";
import { latestFor } from "@/lib/metrics";
import { getConfig } from "@/lib/config";
import { fmtBytes } from "@/components/ui";
import AutoRefresh from "@/components/AutoRefresh";
import SortTh from "@/components/SortTh";
import SortForm from "@/components/SortForm";
import { sortLabels } from "@/lib/sort-labels";
import { parseSortFor, sortRows, timeOf, type SortValue } from "@/lib/table-sort";
import { requireAuth } from "@/lib/session";
import Icon from "@/components/Icon";

export const dynamic = "force-dynamic";

type SP = Promise<{ host?: string; status?: string; q?: string; sort?: string; dir?: string }>;

const SORT_KEYS = ["name", "pod", "host", "image", "status", "cpu", "ram", "started"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const STATE_RANK: Record<string, number> = { running: 0, paused: 1, created: 2, exited: 3, stopped: 3 };

export default async function Containers({ searchParams }: { searchParams: SP }) {
  const session = await requireAuth();
  const t = await getT();
  const sp = await searchParams;
  const { host = "", status = "", q = "" } = sp;
  const sort = parseSortFor(SORT_KEYS, sp.sort, sp.dir);
  const hosts = await fetchAllContainers(undefined, allowedAgentIds(session), hiddenPatternsFor(session));

  const filtered = hosts
    .flatMap((h) => (h.result.ok ? h.result.data.map((c) => ({ agent: h.agent, c })) : []))
    .filter(({ agent, c }) => (!host || String(agent.id) === host)
      && (!status || (status === "running" ? c.state === "running" : c.state !== "running"))
      && (!q || c.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.c.name.localeCompare(b.c.name));
  const lang = await getLang();
  const latest = new Map(hosts.map((h) => [h.agent.id, latestFor(h.agent.id)]));
  const cpuOf = (agentId: number, id: string) => { const p = latest.get(agentId)?.get(id); return p && p.cpu !== null ? `${p.cpu.toFixed(p.cpu < 10 ? 1 : 0)} %` : "–"; };
  const ramOf = (agentId: number, id: string) => { const p = latest.get(agentId)?.get(id); return p ? fmtBytes(p.mem, lang) : "–"; };

  const metricOf = (agentId: number, c: { id: string; state: string }, key: "cpu" | "ram"): number | null => {
    const p = c.state === "running" ? latest.get(agentId)?.get(c.id) : undefined;
    return !p ? null : key === "cpu" ? p.cpu : p.mem;
  };
  const value = ({ agent, c }: { agent: { id: number; hostname: string }; c: (typeof filtered)[number]["c"] }, key: SortKey): SortValue => {
    switch (key) {
      case "name": return c.name || c.id;
      case "pod": return c.podName || c.podId || null;
      case "host": return agent.hostname;
      case "image": return c.image;
      case "status": return STATE_RANK[c.state] ?? 4;
      case "cpu": return metricOf(agent.id, c, "cpu");
      case "ram": return metricOf(agent.id, c, "ram");
      case "started": return timeOf(c.startedAt);
    }
  };
  const rows = sortRows(filtered, sort, value);
  const failed = hosts.filter((h) => !h.result.ok && h.agent.enabled);
  const metricsOn = getConfig().metricsKeepMin > 0;
  // narrow screens drop the least useful columns first, so the action buttons never run off the edge
  const cols: [Key, string, SortKey | null][] = [
    ["cont.name", "", "name"], ["cont.pod", "hidden xl:table-cell", "pod"], ["cont.host", "", "host"], ["cont.image", "hidden xl:table-cell", "image"], ["cont.status", "", "status"],
    ...(metricsOn ? ([["cont.cpu", "", "cpu"], ["cont.ram", "", "ram"]] as [Key, string, SortKey][]) : []),
    ["cont.started", "hidden lg:table-cell", "started"], ["cont.actions", "", null],
  ];
  const params = { host, status, q };

  return (
    <div className="space-y-4">
      {metricsOn && <AutoRefresh seconds={getConfig().metricsIntervalSec} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("cont.title")}</h1>
        {session.access === "all" && <Link href="/containers/new" className="btn btn-primary !px-3 !py-1.5 text-sm" data-testid="create-btn"><Icon name="plus-circle" />{t("cr.btn")}</Link>}
      </div>
      {session.access === "groups" && <p className="text-xs text-slate-400">{t("scope.note", { groups: groupNames(session).join(", ") || "—" })}</p>}
      <form className="flex flex-wrap gap-2" method="get">
        {sort && <input type="hidden" name="sort" value={sort.key} />}
        {sort && <input type="hidden" name="dir" value={sort.dir} />}
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
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-slate-800">
            <tr>{cols.map(([k, cls, key]) => key ? <SortTh key={k} label={t(k)} sortKey={key} current={sort} base="/containers" params={params} className={cls} /> : <th key={k} className={`th ${cls}`}>{t(k)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>{t("cont.none")}</td></tr>}
            {rows.map(({ agent, c }) => (
              <tr key={`${agent.id}-${c.id}`} className="transition hover:bg-slate-900">
                <td className="td max-w-[12rem] break-words font-medium"><Link className="text-sky-400 hover:underline" href={`/containers/${agent.id}/${c.id}`} title={`${c.id}\n${t("cont.created")}: ${fmt(c.createdAt)}`}>{c.name || c.id.slice(0, 12)}</Link></td>
                <td className="td hidden max-w-[10rem] truncate text-xs xl:table-cell">{c.podId ? <Link className="text-sky-400 hover:underline" href={`/pods/${agent.id}/${c.podId}`}>{c.podName || c.podId.slice(0, 12)}</Link> : "—"}</td>
                <td className="td max-w-[7rem] truncate lg:max-w-[10rem]" title={agent.hostname}>{agent.hostname}</td>
                <td className="td hidden max-w-[12rem] truncate text-xs xl:table-cell" title={c.image}>{c.image}</td>
                <td className="td"><StatusBadge status={c.state} /></td>
                {metricsOn && <td className="td whitespace-nowrap text-xs tabular-nums">{c.state === "running" ? cpuOf(agent.id, c.id) : "–"}</td>}
                {metricsOn && <td className="td whitespace-nowrap text-xs tabular-nums">{c.state === "running" ? ramOf(agent.id, c.id) : "–"}</td>}
                <td className="td hidden whitespace-nowrap text-xs lg:table-cell" title={fmt(c.startedAt)}>{fmtShort(c.startedAt)}</td>
                <td className="td w-px"><ContainerActions agentId={agent.id} containerId={c.id} state={c.state} name={c.name} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.length > 1 && <SortForm base="/containers" params={params} current={sort} labels={sortLabels(t)} options={cols.flatMap(([k, , key]) => (key ? [{ key, label: t(k) }] : []))} />}
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
