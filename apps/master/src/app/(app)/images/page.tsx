import { ImageDelete, ImagePrune } from "@/components/ImageActions";
import { fmt, fmtBytes, fmtShort } from "@/components/ui";
import { fetchAllImages } from "@/lib/agents";
import { errText } from "@/lib/i18n";
import { getT, getLang } from "@/lib/lang";
import { allowedAgentIds, groupNames } from "@/lib/groups";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

type SP = Promise<{ host?: string; q?: string }>;

export default async function Images({ searchParams }: { searchParams: SP }) {
  const session = await requireAuth();
  const t = await getT();
  const lang = await getLang();
  const admin = session.access === "all";
  const { host = "", q = "" } = await searchParams;
  const hosts = await fetchAllImages(undefined, allowedAgentIds(session));

  // one row per tag; an image without tag (dangling) is one row
  const rows = hosts
    .flatMap((h) => (h.result.ok ? h.result.data.map((img) => ({ agent: h.agent, img })) : []))
    .flatMap(({ agent, img }) => (img.tags.length > 0 ? img.tags.map((tag) => ({ agent, img, tag: tag as string | null })) : [{ agent, img, tag: null as string | null }]))
    .filter(({ agent, tag, img }) => (!host || String(agent.id) === host) && (!q || (tag ?? img.id).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.tag ?? "~").localeCompare(b.tag ?? "~") || a.agent.hostname.localeCompare(b.agent.hostname));
  const failed = hosts.filter((h) => !h.result.ok && h.agent.enabled);
  const okHosts = hosts.filter((h) => h.result.ok).map((h) => ({ id: h.agent.id, label: `${h.agent.agent_id} (${h.agent.hostname})` }));
  const label = (tag: string | null, id: string) => tag ?? `<${t("images.dangling")}> ${id.slice(0, 12)}`;
  const blocked = (img: { protected: boolean; containers: number; tags: string[] }) =>
    img.protected ? t("images.protected") : img.containers > 0 && img.tags.length <= 1 ? t("errc.IMAGE_IN_USE") : undefined;
  const cols = ["images.image", "cont.id", "cont.host", "images.size", "images.usedBy", "cont.created"] as const;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("images.title")}</h1>
      {session.access === "groups" && <p className="text-xs text-slate-400">{t("scope.note", { groups: groupNames(session).join(", ") || "—" })}</p>}
      <form className="flex flex-wrap gap-2" method="get">
        <select name="host" defaultValue={host} className="input w-auto">
          <option value="">{t("cont.allHosts")}</option>
          {hosts.map((h) => <option key={h.agent.id} value={h.agent.id}>{h.agent.agent_id} ({h.agent.hostname})</option>)}
        </select>
        <input name="q" defaultValue={q} placeholder={t("images.namePh")} className="input w-48" />
        <button className="btn">{t("cont.filter")}</button>
      </form>
      {admin && <ImagePrune hosts={okHosts} />}

      {failed.map((h) => (
        <p key={h.agent.id} className="card border-red-900 text-sm text-red-300">
          {t("images.unavailable", { host: h.agent.hostname, msg: h.result.ok ? "" : errText(t, h.result.code, h.result.message) })}
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
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={admin ? 7 : 6}>{t("images.none")}</td></tr>}
            {rows.map(({ agent, img, tag }) => (
              <tr key={`${agent.id}-${img.id}-${tag ?? ""}`} className="transition hover:bg-slate-900">
                <td className="td max-w-[22rem] break-all font-medium">{label(tag, img.id)}{img.protected && <div className="text-xs font-normal text-amber-300">{t("images.protected")}</div>}</td>
                <td className="td font-mono text-xs">{img.id.slice(0, 12)}</td>
                <td className="td max-w-[11rem] truncate" title={agent.hostname}>{agent.hostname}</td>
                <td className="td whitespace-nowrap tabular-nums">{fmtBytes(img.size, lang)}</td>
                <td className="td tabular-nums">{img.containers > 0 ? img.containers : <span className="text-slate-500">{t("images.noneUsed")}</span>}</td>
                <td className="td whitespace-nowrap text-xs" title={fmt(img.createdAt)}>{fmtShort(img.createdAt)}</td>
                {admin && <td className="td w-px"><ImageDelete agentId={agent.id} imageId={img.id} tag={tag} name={label(tag, img.id)} multiTag={!!tag && img.tags.length > 1} blockedReason={blocked(img)} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="card text-sm text-slate-400">{t("images.none")}</p>}
        {rows.map(({ agent, img, tag }) => (
          <div key={`${agent.id}-${img.id}-${tag ?? ""}`} className="card space-y-2">
            <div className="break-all font-medium">{label(tag, img.id)}</div>
            <div className="text-xs text-slate-500">{agent.agent_id} · {img.id.slice(0, 12)} · {fmtBytes(img.size, lang)} · {t("images.usedBy")}: {img.containers}</div>
            {img.protected && <div className="text-xs text-amber-300">{t("images.protected")}</div>}
            {admin && <ImageDelete agentId={agent.id} imageId={img.id} tag={tag} name={label(tag, img.id)} multiTag={!!tag && img.tags.length > 1} blockedReason={blocked(img)} />}
          </div>
        ))}
      </div>
    </div>
  );
}
