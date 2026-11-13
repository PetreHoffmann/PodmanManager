import { ResourceDelete, ResourcePrune } from "@/components/ResourceActions";
import { fetchAllNetworks } from "@/lib/agents";
import { errText } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { allowedAgentIds } from "@/lib/groups";
import { hiddenPatternsFor, isHidden } from "@/lib/hidden";
import { requireAuth } from "@/lib/session";
import Icon from "@/components/Icon";

export default async function NetworksTab({ host, q }: { host: string; q: string }) {
  const session = await requireAuth();
  const t = await getT();
  const admin = session.access === "all";
  const hidden = hiddenPatternsFor(session);
  const hosts = await fetchAllNetworks(undefined, allowedAgentIds(session));

  const rows = hosts
    .flatMap((h) => (h.result.ok ? h.result.data.map((net) => ({ agent: h.agent, net: { ...net, containers: net.containers.filter((c) => !isHidden(c, hidden)), hiddenCount: net.containers.filter((c) => isHidden(c, hidden)).length } })) : []))
    .filter(({ agent, net }) => (!host || String(agent.id) === host) && (!q || net.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.net.name.localeCompare(b.net.name) || a.agent.hostname.localeCompare(b.agent.hostname));
  const failed = hosts.filter((h) => !h.result.ok && h.agent.enabled);
  const pruneHosts = hosts.filter((h) => h.result.ok && (!host || String(h.agent.id) === host)).map((h) => ({ id: h.agent.id, name: h.agent.hostname }));
  const isFree = (n: { protected: boolean; containers: string[]; hiddenCount: number }) => !n.protected && n.containers.length === 0 && n.hiddenCount === 0;
  const unusedCount = rows.filter(({ net }) => isFree(net)).length;
  const blocked = (n: { protected: boolean; containers: string[]; hiddenCount: number }) => (n.protected ? t("networks.protected") : n.containers.length + n.hiddenCount > 0 ? t("networks.usedBlocked") : undefined);
  const flags = (n: { internal: boolean; dnsEnabled: boolean; ipv6: boolean }) => [n.internal && t("networks.internal"), n.dnsEnabled && t("networks.dns"), n.ipv6 && t("networks.ipv6")].filter(Boolean).join(" · ") || "–";
  const users = (n: { containers: string[]; hiddenCount: number }) => (n.containers.length > 0 ? n.containers.join(", ") : <span className="text-slate-500">{t("networks.noneUsed")}</span>);
  const cols = ["networks.name", "networks.driver", "networks.subnet", "networks.flags", "networks.usedBy", "cont.host"] as const;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2" method="get">
        <input type="hidden" name="tab" value="networks" />
        <select name="host" defaultValue={host} className="input w-auto">
          <option value="">{t("cont.allHosts")}</option>
          {hosts.map((h) => <option key={h.agent.id} value={h.agent.id}>{h.agent.agent_id} ({h.agent.hostname})</option>)}
        </select>
        <input name="q" defaultValue={q} placeholder={t("networks.namePh")} className="input w-48" />
        <button className="btn"><Icon name="funnel" />{t("cont.filter")}</button>
      </form>
      <p className="text-xs text-slate-500">{t("networks.note")}</p>
      {admin && <ResourcePrune kind="network" hosts={pruneHosts} count={unusedCount} />}

      {failed.map((h) => (
        <p key={h.agent.id} className="card border-red-900 text-sm text-red-300">
          {t("networks.unavailable", { host: h.agent.hostname, msg: h.result.ok ? "" : errText(t, h.result.code, h.result.message) })}
        </p>
      ))}

      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-800">
            <tr>
              {cols.map((k) => <th key={k} className="th">{t(k)}</th>)}
              {admin && <th className="th">{t("cont.actions")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={admin ? 7 : 6}>{t("networks.none")}</td></tr>}
            {rows.map(({ agent, net }) => (
              <tr key={`${agent.id}-${net.name}`} className="transition hover:bg-slate-900">
                <td className="td font-medium">{net.name}{net.protected && <div className="text-xs font-normal text-amber-300">{t("networks.protected")}</div>}</td>
                <td className="td">{net.driver}</td>
                <td className="td font-mono text-xs">{net.subnets.join(", ") || "–"}</td>
                <td className="td text-xs">{flags(net)}</td>
                <td className="td max-w-[16rem] break-words text-sm">{users(net)}</td>
                <td className="td max-w-[11rem] truncate" title={agent.hostname}>{agent.hostname}</td>
                {admin && <td className="td w-px"><ResourceDelete kind="network" agentId={agent.id} name={net.name} blockedReason={blocked(net)} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="card text-sm text-slate-400">{t("networks.none")}</p>}
        {rows.map(({ agent, net }) => (
          <div key={`${agent.id}-${net.name}`} className="card space-y-2">
            <div className="font-medium">{net.name}{net.protected && <span className="ml-2 text-xs font-normal text-amber-300">{t("networks.protected")}</span>}</div>
            <div className="text-xs text-slate-500">{agent.agent_id} · {net.driver} · {net.subnets.join(", ") || "–"} · {flags(net)}</div>
            <div className="text-xs text-slate-400">{t("networks.usedBy")}: {users(net)}</div>
            {admin && <ResourceDelete kind="network" agentId={agent.id} name={net.name} blockedReason={blocked(net)} />}
          </div>
        ))}
      </div>
    </div>
  );
}
