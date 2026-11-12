"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { imageDeleteAction, imagePruneAction } from "@/app/actions";
import { useT } from "./I18nProvider";

/** Delete one image (or one tag of it). The agent refuses images in use; the button is only a convenience. */
export function ImageDelete({ agentId, imageId, tag, name, multiTag, blockedReason }: { agentId: number; imageId: string; tag: string | null; name: string; multiTag: boolean; blockedReason?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () => {
    setConfirm(false);
    start(async () => {
      const r = await imageDeleteAction(agentId, imageId, tag);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  };
  return (
    <div className="flex flex-col items-start gap-1">
      {confirm ? (
        <>
          <span className="text-xs text-amber-300">{multiTag ? t("images.untagQ", { name }) : t("images.deleteQ", { name })}</span>
          <div className="flex gap-1">
            <button className="btn btn-danger !px-3 !py-1 text-xs" onClick={run}>{t("common.confirm")}</button>
            <button className="btn !px-3 !py-1 text-xs" onClick={() => setConfirm(false)}>{t("common.cancel")}</button>
          </div>
        </>
      ) : (
        <button className="btn btn-danger !px-3 !py-1 text-xs disabled:opacity-40" disabled={pending || !!blockedReason} title={blockedReason} onClick={() => setConfirm(true)}>
          {pending ? "…" : t("images.delete")}
        </button>
      )}
      {msg && <span className={`max-w-xs text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</span>}
    </div>
  );
}

/** Remove untagged, unused images of the chosen host. */
export function ImagePrune({ hosts }: { hosts: { id: number; label: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [host, setHost] = useState(hosts[0]?.id ?? 0);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (hosts.length === 0) return null;
  const run = () => {
    setConfirm(false);
    start(async () => {
      const r = await imagePruneAction(host);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {hosts.length > 1 && (
        <select className="input w-auto !py-1 text-xs" value={host} onChange={(e) => setHost(Number(e.target.value))} disabled={pending}>
          {hosts.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
        </select>
      )}
      {confirm ? (
        <>
          <span className="text-xs text-amber-300">{t("images.pruneQ")}</span>
          <button className="btn btn-danger !px-3 !py-1 text-xs" onClick={run}>{t("common.confirm")}</button>
          <button className="btn !px-3 !py-1 text-xs" onClick={() => setConfirm(false)}>{t("common.cancel")}</button>
        </>
      ) : (
        <button className="btn !px-3 !py-1 text-xs" disabled={pending} onClick={() => setConfirm(true)}>{pending ? "…" : t("images.prune")}</button>
      )}
      {msg && <span className={`text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</span>}
    </div>
  );
}
