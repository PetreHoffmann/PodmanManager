import { ResourceDelete, ResourcePrune } from "@/components/ResourceActions";
import { fmt, fmtBytes, fmtShort } from "@/components/ui";
import { fetchAllVolumes } from "@/lib/agents";
import { errText } from "@/lib/i18n";
import { getT, getLang } from "@/lib/lang";
import { allowedAgentIds } from "@/lib/groups";
import { requireAuth } from "@/lib/session";
import Icon from "@/components/Icon";

export default async function VolumesTab({ host, q }: { host: string; q: string }) {
  const session = await requireAuth();
  const t = await getT();
  const lang = await getLang();
  const admin = session.access === "all";
  const hosts = await fetchAllVolumes(undefined, allowedAgentIds(session));

  const rows = hosts
    .flatMap((h) => (h.result.ok ? h.result.data.map((vol) => ({ agent: h.agent, vol })) : []))
    .filter(({ agent, vol }) => (!host || String(agent.id) === host) && (!q || vol.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.vol.name.localeCompare(b.vol.name) || a.agent.hostname.localeCompare(b.agent.hostname));
  const failed = hosts.filter((h) => !h.result.ok && h.agent.enabled);
  const pruneHosts = hosts.filter((h) => h.result.ok && (!host || String(h.agent.id) === host)).map((h) => ({ id: h.agent.id, name: h.agent.hostname }));
  const unusedCount = rows.filter(({ vol }) => vol.unused).length;
  const size = (b: number | null) => (b === null ? t("volumes.sizeUnknown") : fmtBytes(b, lang));
  const cols = ["volumes.name", "volumes.driver", "cont.host", "images.size", "volumes.usage", "cont.created"] as const;
  const usage = (unused: boolean) => (unused ? <span className="text-slate-400">{t("volumes.unused")}</span> : <span className="text-emerald-300">{t("volumes.inUse")}</span>);

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2" method="get">
        <input type="hidden" name="tab" value="volumes" />
        <select name="host" defaultValue={host} className="input w-auto">
          <option value="">{t("cont.allHosts")}</option>
          {hosts.map((h) => <option key={h.agent.id} value={h.agent.id}>{h.agent.agent_id} ({h.agent.hostname})</option>)}
        </select>
        <input name="q" defaultValue={q} placeholder={t("volumes.namePh")} className="input w-48" />
        <button className="btn"><Icon name="funnel" />{t("cont.filter")}</button>
      </form>
      {admin && <ResourcePrune kind="volume" hosts={pruneHosts} count={unusedCount} />}

      {failed.map((h) => (
        <p key={h.agent.id} className="card border-red-900 text-sm text-red-300">
          {t("volumes.unavailable", { host: h.agent.hostname, msg: h.result.ok ? "" : errText(t, h.result.code, h.result.message) })}
        </p>
      ))}

      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[800px]">
          <thead className="border-b border-slate-800">
            <tr>
              {cols.map((k) => <th key={k} className="th">{t(k)}</th>)}
              {admin && <th className="th">{t("cont.actions")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={admin ? 7 : 6}>{t("volumes.none")}</td></tr>}
            {rows.map(({ agent, vol }) => (
              <tr key={`${agent.id}-${vol.name}`} className="transition hover:bg-slate-900">
                <td className="td max-w-[22rem] break-all font-medium" title={vol.name}>{vol.anonymous ? `${vol.name.slice(0, 12)}…` : vol.name}{vol.anonymous && <div className="text-xs font-normal text-slate-500">{t("volumes.anon")}</div>}</td>
                <td className="td">{vol.driver}</td>
                <td className="td max-w-[11rem] truncate" title={agent.hostname}>{agent.hostname}</td>
                <td className="td whitespace-nowrap tabular-nums">{size(vol.size)}</td>
                <td className="td">{usage(vol.unused)}</td>
                <td className="td whitespace-nowrap text-xs" title={fmt(vol.createdAt)}>{fmtShort(vol.createdAt)}</td>
                {admin && <td className="td w-px"><ResourceDelete kind="volume" agentId={agent.id} name={vol.name} blockedReason={vol.unused ? undefined : t("volumes.usedBlocked")} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="card text-sm text-slate-400">{t("volumes.none")}</p>}
        {rows.map(({ agent, vol }) => (
          <div key={`${agent.id}-${vol.name}`} className="card space-y-2">
            <div className="break-all font-medium">{vol.anonymous ? `${vol.name.slice(0, 12)}…` : vol.name}{vol.anonymous && <span className="ml-2 text-xs font-normal text-slate-500">{t("volumes.anon")}</span>}</div>
            <div className="text-xs text-slate-500">{agent.agent_id} · {size(vol.size)} · {vol.unused ? t("volumes.unused") : t("volumes.inUse")}</div>
            {admin && <ResourceDelete kind="volume" agentId={agent.id} name={vol.name} blockedReason={vol.unused ? undefined : t("volumes.usedBlocked")} />}
          </div>
        ))}
      </div>
    </div>
  );
}
