import { cache } from "react";
import { fmtBytes } from "@/components/ui";
import { agentStorage } from "@/lib/agent-client";
import { errText } from "@/lib/i18n";
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
  if (!r || !r.ok) {
    // e.g. Podman's `system df` fails as a whole when a volume directory is missing: show why instead of just "—"
    const why = r ? errText(t, r.code, r.message) : "";
    return compact ? (
      <span title={why}>{t("common.na")}{why && <span className="text-amber-400"> ({why.length > 90 ? `${why.slice(0, 90)}…` : why})</span>}</span>
    ) : (
      <div title={why}>
        <span className="text-slate-500">{t("common.na")}</span>
        {why && <div className="max-w-[15rem] break-words text-xs text-amber-400">{why.length > 110 ? `${why.slice(0, 110)}…` : why}</div>}
      </div>
    );
  }
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
