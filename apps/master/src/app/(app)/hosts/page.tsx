import ActionForm from "@/components/ActionForm";
import AppLogs from "@/components/AppLogs";
import HostActions from "@/components/HostActions";
import { StatusBadge } from "@/components/StatusBadge";
import { fmt } from "@/components/ui";
import { addAgentAction, appLogsAction } from "@/app/actions";
import { fetchAllContainers } from "@/lib/agents";
import { lastErrText } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { allowedAgentIds, groupNames } from "@/lib/groups";
import { hiddenPatternsFor } from "@/lib/hidden";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Hosts() {
  const session = await requireAuth();
  const t = await getT();
  const canManage = session.access === "all";
  const hosts = await fetchAllContainers(undefined, allowedAgentIds(session), hiddenPatternsFor(session));
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t("hosts.title")}</h1>
      {!canManage && <p className="text-xs text-slate-400">{t("scope.note", { groups: groupNames(session).join(", ") || "—" })}</p>}
      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-800">
            <tr>
              {(["hosts.hostname", "hosts.agentId", "hosts.address", "hosts.status", "hosts.heartbeat", "hosts.podman", "hosts.containers"] as const).map((k) => (
                <th key={k} className="th">{t(k)}</th>
              ))}
              {canManage && <th className="th" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {hosts.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={canManage ? 8 : 7}>{t("hosts.none")}</td></tr>
            )}
            {hosts.map(({ agent: a, result }) => (
              <tr key={a.id} className="transition hover:bg-slate-900">
                <td className="td font-medium">{a.hostname}</td>
                <td className="td font-mono text-xs">{a.agent_id}</td>
                <td className="td font-mono text-xs">{a.address}:{a.port}</td>
                <td className="td">
                  <StatusBadge status={a.enabled ? a.status : "disabled"} />
                  {a.enabled && a.last_error && a.status !== "online" && (
                    <div className="mt-1 max-w-xs truncate text-xs text-slate-500" title={a.last_error}>{lastErrText(t, a.last_error)}</div>
                  )}
                </td>
                <td className="td text-xs">{fmt(a.last_heartbeat)}</td>
                <td className="td text-xs">{a.podman_version ?? "—"}</td>
                <td className="td">{result.ok ? result.data.length : t("common.na")}</td>
                {canManage && <td className="td"><HostActions id={a.id} enabled={!!a.enabled} hostname={a.hostname} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {hosts.length === 0 && <p className="card text-sm text-slate-400">{t("hosts.none")}</p>}
        {hosts.map(({ agent: a, result }) => (
          <div key={a.id} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{a.agent_id}</div>
              <StatusBadge status={a.enabled ? a.status : "disabled"} />
            </div>
            <div className="font-mono text-xs text-slate-400">{a.hostname} · {a.address}:{a.port}</div>
            <div className="text-xs text-slate-500">{t("hosts.cardMeta", { hb: fmt(a.last_heartbeat), pv: a.podman_version ?? "—", n: result.ok ? result.data.length : t("common.na") })}</div>
            {a.enabled && a.last_error && a.status !== "online" && <div className="break-all text-xs text-slate-500">{lastErrText(t, a.last_error)}</div>}
            {canManage && <HostActions id={a.id} enabled={!!a.enabled} hostname={a.hostname} />}
          </div>
        ))}
      </div>

      {canManage && hosts.length > 0 && (
        <AppLogs title={t("alogs.agent")} load={appLogsAction} options={hosts.map(({ agent: a }) => ({ id: a.id, label: `${a.agent_id} (${a.hostname})` }))} />
      )}

      {canManage && (
      <section className="card max-w-xl">
        <h2 className="mb-3 font-medium">{t("hosts.add")}</h2>
        <ActionForm action={addAgentAction} className="space-y-3">
          <label className="block text-sm">{t("hosts.addrLabel")}
            <input name="url" required placeholder="http://192.168.1.21:9126" className="input mt-1" />
          </label>
          <label className="block text-sm">{t("hosts.tokenLabel")}
            <input name="token" type="password" required autoComplete="off" className="input mt-1" />
          </label>
          <button className="btn btn-primary" type="submit">{t("hosts.register")}</button>
        </ActionForm>
      </section>
      )}
    </div>
  );
}
