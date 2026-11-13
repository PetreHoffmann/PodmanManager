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

/** Remove untagged, unused images of the hosts the list is filtered to (one host, or all hosts shown). */
export function ImagePrune({ hosts }: { hosts: { id: number; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (hosts.length === 0) return null;
  const one = hosts.length === 1;
  const run = () => {
    setConfirm(false);
    start(async () => {
      const r = await imagePruneAction(hosts.map((h) => h.id));
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span className="text-xs text-amber-300">{one ? t("images.pruneQHost", { host: hosts[0]!.name }) : t("images.pruneQMany", { hosts: hosts.map((h) => h.name).join(", ") })}</span>
            <button className="btn btn-danger !px-3 !py-1 text-xs" onClick={run}>{t("common.confirm")}</button>
            <button className="btn !px-3 !py-1 text-xs" onClick={() => setConfirm(false)}>{t("common.cancel")}</button>
          </>
        ) : (
          <button className="btn !px-3 !py-1 text-xs" disabled={pending} onClick={() => { setMsg(null); setConfirm(true); }}>
            {pending ? "…" : `${t("images.prune")} (${one ? hosts[0]!.name : t("images.pruneAll", { n: hosts.length })})`}
          </button>
        )}
      </div>
      {msg && <p className={`whitespace-pre-line text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</p>}
    </div>
  );
}
