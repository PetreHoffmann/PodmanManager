import ActionForm from "@/components/ActionForm";
import HostActions from "@/components/HostActions";
import { StatusBadge, fmt } from "@/components/ui";
import { addAgentAction } from "@/app/actions";
import { fetchAllContainers } from "@/lib/agents";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Hosts() {
  await requireAuth();
  const hosts = await fetchAllContainers();
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Hosts</h1>
      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-800">
            <tr>
              {["Hostname", "Agent ID", "Address", "Status", "Last heartbeat", "Podman", "Containers", ""].map((h) => (
                <th key={h} className="th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {hosts.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={8}>No agents registered.</td></tr>
            )}
            {hosts.map(({ agent: a, result }) => (
              <tr key={a.id} className="transition hover:bg-slate-900">
                <td className="td font-medium">{a.hostname}</td>
                <td className="td font-mono text-xs">{a.agent_id}</td>
                <td className="td font-mono text-xs">{a.address}:{a.port}</td>
                <td className="td">
                  <StatusBadge status={a.enabled ? a.status : "disabled"} />
                  {a.enabled && a.last_error && a.status !== "online" && (
                    <div className="mt-1 max-w-xs truncate text-xs text-slate-500" title={a.last_error}>{a.last_error}</div>
                  )}
                </td>
                <td className="td text-xs">{fmt(a.last_heartbeat)}</td>
                <td className="td text-xs">{a.podman_version ?? "—"}</td>
                <td className="td">{result.ok ? result.data.length : "n/a"}</td>
                <td className="td"><HostActions id={a.id} enabled={!!a.enabled} hostname={a.hostname} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {hosts.length === 0 && <p className="card text-sm text-slate-400">No agents registered.</p>}
        {hosts.map(({ agent: a, result }) => (
          <div key={a.id} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{a.agent_id}</div>
              <StatusBadge status={a.enabled ? a.status : "disabled"} />
            </div>
            <div className="font-mono text-xs text-slate-400">{a.hostname} · {a.address}:{a.port}</div>
            <div className="text-xs text-slate-500">Heartbeat: {fmt(a.last_heartbeat)} · Podman {a.podman_version ?? "—"} · {result.ok ? result.data.length : "n/a"} containers</div>
            {a.enabled && a.last_error && a.status !== "online" && <div className="break-all text-xs text-slate-500">{a.last_error}</div>}
            <HostActions id={a.id} enabled={!!a.enabled} hostname={a.hostname} />
          </div>
        ))}
      </div>

      <section className="card max-w-xl">
        <h2 className="mb-3 font-medium">Add agent</h2>
        <ActionForm action={addAgentAction} className="space-y-3">
          <label className="block text-sm">Agent address
            <input name="url" required placeholder="http://192.168.1.21:9126" className="input mt-1" />
          </label>
          <label className="block text-sm">Agent token
            <input name="token" type="password" required autoComplete="off" className="input mt-1" />
          </label>
          <button className="btn btn-primary" type="submit">Test connection &amp; register</button>
        </ActionForm>
      </section>
    </div>
  );
}
