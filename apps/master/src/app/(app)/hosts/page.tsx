import Link from "next/link";
import AgentUpdate from "@/components/AgentUpdate";
import AgentUpdateAll from "@/components/AgentUpdateAll";
import { compareSemver } from "@/lib/update-check";
import { getVersion } from "@/lib/version";
import { Suspense } from "react";
import SortTh from "@/components/SortTh";
import SortForm from "@/components/SortForm";
import { parseSort, sortHosts } from "@/lib/host-sort";
import HostStorage, { hostStorage } from "@/components/HostStorage";
import AppLogs from "@/components/AppLogs";
import HostActions from "@/components/HostActions";
import { StatusBadge } from "@/components/StatusBadge";
import { fmt, fmtShort } from "@/components/ui";
import { appLogsAction } from "@/app/actions";
import { fetchAllContainers } from "@/lib/agents";
import { lastErrText } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { sortLabels } from "@/lib/sort-labels";
import { allowedAgentIds, groupNames } from "@/lib/groups";
import { hiddenPatternsFor } from "@/lib/hidden";
import { requireAuth } from "@/lib/session";
import Icon from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function Hosts({ searchParams }: { searchParams: Promise<{ sort?: string; dir?: string }> }) {
  const session = await requireAuth();
  const sp = await searchParams;
  const sort = parseSort(sp.sort, sp.dir);
  const t = await getT();
  const canManage = session.access === "all";
  const masterVersion = getVersion();
  const outdated = (v: string | null | undefined) => !!v && /^\d+\.\d+\.\d+/.test(v) && compareSemver(masterVersion, v) > 0;
  const loaded = await fetchAllContainers(undefined, allowedAgentIds(session), hiddenPatternsFor(session));
  // Sorting by storage needs every host's figure first (the table otherwise streams them in); the request cache makes the cells instant afterwards.
  const storage = new Map<number, number | null>();
  if (sort?.key === "storage") {
    await Promise.all(loaded.filter(({ agent: a }) => a.enabled && a.status !== "offline").map(async ({ agent: a }) => {
      const r = await hostStorage(a.id).catch(() => null);
      storage.set(a.id, r && r.ok ? r.data.total : null);
    }));
  }
  const hosts = sortHosts(loaded.map((h) => ({ ...h, containers: h.result.ok ? h.result.data.length : null, storage: storage.get(h.agent.id) ?? null })), sort);
  const updatable = canManage ? hosts.filter(({ agent: a }) => a.kind !== "local" && a.enabled && a.status !== "offline" && outdated(a.agent_version)).map(({ agent: a }) => ({ id: a.id, label: a.hostname })) : [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("hosts.title")}</h1>
        <div className="flex flex-wrap items-center gap-3">
          {updatable.length > 0 && <AgentUpdateAll hosts={updatable} />}
          {canManage && <Link href="/hosts/new" className="btn btn-primary !px-3 !py-1.5 text-sm" data-testid="new-agent-btn"><Icon name="plus-circle" />{t("wiz.title")}</Link>}
        </div>
      </div>
      {!canManage && <p className="text-xs text-slate-400">{t("scope.note", { groups: groupNames(session).join(", ") || "—" })}</p>}
      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full">
          <thead className="border-b border-slate-800">
            <tr>
              {([["hosts.agentId", "", "agent"], ["hosts.address", "", "address"], ["hosts.status", "", "status"], ["hosts.heartbeat", "hidden lg:table-cell", "heartbeat"], ["hosts.podman", "hidden xl:table-cell", "podman"], ["hosts.agentVersion", "", "version"], ["hosts.containers", "", "containers"], ["hosts.storage", "", "storage"]] as const).map(([k, c, key]) => (
                <SortTh key={k} label={t(k)} sortKey={key} current={sort} base="/hosts" params={{}} className={c} />
              ))}
              {canManage && <th className="th" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {hosts.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={canManage ? 9 : 8}>{t("hosts.none")}{canManage && <> <Link className="text-sky-400 hover:underline" href="/hosts/new">{t("wiz.title")}</Link></>}</td></tr>
            )}
            {hosts.map(({ agent: a, result }) => (
              <tr key={a.id} className="transition hover:bg-slate-900">
                <td className="td" title={a.hostname}>
                  <Link href={`/containers?host=${a.id}`} className="whitespace-nowrap font-mono text-xs font-medium text-sky-400 hover:underline" data-testid="host-link">{a.agent_id}</Link>
                  {a.kind === "local" && <div className="text-xs text-slate-500">{a.hostname}</div>}
                  {a.podman_version && <div className="text-xs text-slate-500 xl:hidden">Podman {a.podman_version}</div>}
                </td>
                <td className="td font-mono text-xs">{a.kind === "local" ? <span className="font-sans">{t("hosts.local")}</span> : <>{a.address}:{a.port}</>}</td>
                <td className="td">
                  <StatusBadge status={a.enabled ? a.status : "disabled"} />
                  {a.enabled && a.last_error && a.status !== "online" && (
                    <div className="mt-1 max-w-xs truncate text-xs text-slate-500" title={a.last_error}>{lastErrText(t, a.last_error)}</div>
                  )}
                </td>
                <td className="td hidden whitespace-nowrap text-xs lg:table-cell" title={fmt(a.last_heartbeat)}>{fmtShort(a.last_heartbeat)}</td>
                <td className="td hidden text-xs xl:table-cell">{a.podman_version ?? "—"}</td>
                <td className="td font-mono text-xs">{a.agent_version ?? "—"}{outdated(a.agent_version) && <div className="mt-1 space-y-1 font-sans"><span className="rounded border border-amber-500/40 px-1.5 py-0.5 text-xs text-amber-300">{t("update.outdated")}</span>{canManage && a.enabled && a.status !== "offline" && <AgentUpdate id={a.id} />}</div>}</td>
                <td className="td">{result.ok ? result.data.length : t("common.na")}</td>
                <td className="td max-w-[11rem]">
                  {a.enabled && a.status !== "offline" ? <Suspense fallback={<span className="animate-pulse text-slate-500">…</span>}><HostStorage agentId={a.id} /></Suspense> : <span className="text-slate-500">—</span>}
                </td>
                {canManage && <td className="td w-[15rem]"><HostActions id={a.id} enabled={!!a.enabled} hostname={a.hostname} url={a.kind === "local" ? "" : `http://${a.address}:${a.port}`} local={a.kind === "local"} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {hosts.length > 1 && (
          <SortForm base="/hosts" params={{}} current={sort} labels={sortLabels(t)}
            options={([["agent", "hosts.agentId"], ["address", "hosts.address"], ["status", "hosts.status"], ["heartbeat", "hosts.heartbeat"], ["podman", "hosts.podman"], ["version", "hosts.agentVersion"], ["containers", "hosts.containers"], ["storage", "hosts.storage"]] as const).map(([key, l]) => ({ key, label: t(l) }))} />
        )}
        {hosts.length === 0 && <p className="card text-sm text-slate-400">{t("hosts.none")}{canManage && <> <Link className="text-sky-400 hover:underline" href="/hosts/new">{t("wiz.title")}</Link></>}</p>}
        {hosts.map(({ agent: a, result }) => (
          <div key={a.id} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/containers?host=${a.id}`} className="font-medium text-sky-400 hover:underline" data-testid="host-link">{a.agent_id}</Link>
              <StatusBadge status={a.enabled ? a.status : "disabled"} />
            </div>
            <div className="font-mono text-xs text-slate-400">{a.hostname} · {a.kind === "local" ? t("hosts.local") : `${a.address}:${a.port}`}</div>
            <div className="text-xs text-slate-500">{t("hosts.cardMeta", { hb: fmt(a.last_heartbeat), pv: a.podman_version ?? "—", av: a.agent_version ?? "—", n: result.ok ? result.data.length : t("common.na") })}</div>
            {a.enabled && a.status !== "offline" && (
              <div className="text-xs text-slate-500">{t("hosts.storage")}: <Suspense fallback="…"><HostStorage agentId={a.id} compact /></Suspense></div>
            )}
            {a.enabled && a.last_error && a.status !== "online" && <div className="break-all text-xs text-slate-500">{lastErrText(t, a.last_error)}</div>}
            {outdated(a.agent_version) && <div className="flex flex-wrap items-start gap-2 text-xs"><span className="text-amber-300">{t("update.outdated")}</span>{canManage && a.enabled && a.status !== "offline" && <AgentUpdate id={a.id} />}</div>}
            {canManage && <HostActions id={a.id} enabled={!!a.enabled} hostname={a.hostname} url={a.kind === "local" ? "" : `http://${a.address}:${a.port}`} local={a.kind === "local"} />}
          </div>
        ))}
      </div>

      {canManage && hosts.length > 0 && (
        <AppLogs title={t("alogs.agent")} load={appLogsAction} options={hosts.map(({ agent: a }) => ({ id: a.id, label: `${a.agent_id} (${a.hostname})` }))} />
      )}
    </div>
  );
}
