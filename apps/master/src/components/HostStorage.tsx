import { cache } from "react";
import { fmtBytes } from "@/components/ui";
import { agentStorage } from "@/lib/agent-client";
import { targetFor } from "@/lib/agents";
import { getLang, getT } from "@/lib/lang";

// desktop table and phone card both ask for the same host: one query per request
const query = cache(async (agentId: number) => {
  const t = targetFor(agentId);
  return t ? agentStorage(t) : null;
});

/**
 * Disk space used by the Podman storage of a host. Rendered inside <Suspense>, so the host list
 * is shown immediately and the numbers stream in (`podman system df` can be slow).
 */
export default async function HostStorage({ agentId, compact }: { agentId: number; compact?: boolean }) {
  const t = await getT();
  const lang = await getLang();
  const r = await query(agentId);
  if (!r || !r.ok) return <span className="text-slate-500" title={r ? `${r.code}` : ""}>{t("common.na")}</span>;
  const s = r.data;
  const f = (n: number) => fmtBytes(n, lang);
  const parts = `${t("storage.images")} ${f(s.images.size)} · ${t("storage.containers")} ${f(s.containers.size)} · ${t("storage.volumes")} ${f(s.volumes.size)}`;
  const reclaim = s.images.reclaimable + s.containers.reclaimable + s.volumes.reclaimable;
  const title = `${parts}\n${t("storage.reclaimable")}: ${f(reclaim)}`;
  return compact ? (
    <span title={title}>{t("storage.card", { total: f(s.total), images: f(s.images.size), containers: f(s.containers.size), volumes: f(s.volumes.size) })}</span>
  ) : (
    <div title={title}>
      <div className="font-medium tabular-nums">{f(s.total)}</div>
      <div className="text-xs text-slate-500">{parts}</div>
      {reclaim > 0 && <div className="text-xs text-slate-500">{t("storage.reclaimable")}: {f(reclaim)}</div>}
    </div>
  );
}
