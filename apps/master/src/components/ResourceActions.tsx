"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { networkDeleteAction, networksPruneAction, volumeDeleteAction, volumesPruneAction } from "@/app/actions";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

export type ResourceKind = "volume" | "network";

/** Delete one volume or network. The agent refuses what is in use; the disabled button is only a convenience. */
export function ResourceDelete({ kind, agentId, name, blockedReason }: { kind: ResourceKind; agentId: number; name: string; blockedReason?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () => {
    setConfirm(false);
    start(async () => {
      const r = await (kind === "volume" ? volumeDeleteAction : networkDeleteAction)(agentId, name);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  };
  const short = name.length > 24 ? `${name.slice(0, 12)}…` : name;
  return (
    <div className="flex flex-col items-start gap-1">
      {confirm ? (
        <>
          <span className="text-xs text-amber-300">{t(kind === "volume" ? "volumes.deleteQ" : "networks.deleteQ", { name: short })}</span>
          <div className="flex gap-1">
            <button className="btn btn-danger !px-3 !py-1 text-xs" onClick={run}><Icon name="check" />{t("common.confirm")}</button>
            <button className="btn !px-3 !py-1 text-xs" onClick={() => setConfirm(false)}><Icon name="x" />{t("common.cancel")}</button>
          </div>
        </>
      ) : (
        <button className="btn btn-danger !px-3 !py-1 text-xs disabled:opacity-40" disabled={pending || !!blockedReason} title={blockedReason} onClick={() => setConfirm(true)}>
          {pending ? "…" : <><Icon name="trash" />{t(kind === "volume" ? "volumes.delete" : "networks.delete")}</>}
        </button>
      )}
      {msg && <span className={`max-w-xs text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</span>}
    </div>
  );
}

/** Remove all unused volumes or networks of the hosts the list is filtered to; `count` is how many the list shows as unused. */
export function ResourcePrune({ kind, hosts, count }: { kind: ResourceKind; hosts: { id: number; name: string }[]; count: number }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (hosts.length === 0 || (count === 0 && !msg)) return null;
  const one = hosts.length === 1;
  const names = hosts.map((h) => h.name).join(", ");
  const run = () => {
    setConfirm(false);
    start(async () => {
      const r = await (kind === "volume" ? volumesPruneAction : networksPruneAction)(hosts.map((h) => h.id));
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span className="text-xs text-amber-300">{t(kind === "volume" ? "volumes.pruneQ" : "networks.pruneQ", { n: count, hosts: names })}</span>
            <button className="btn btn-danger !px-3 !py-1 text-xs" onClick={run}><Icon name="check" />{t("common.confirm")}</button>
            <button className="btn !px-3 !py-1 text-xs" onClick={() => setConfirm(false)}><Icon name="x" />{t("common.cancel")}</button>
          </>
        ) : count > 0 ? (
          <button className="btn !px-3 !py-1 text-xs" disabled={pending} onClick={() => { setMsg(null); setConfirm(true); }}>
            {pending ? "…" : <><Icon name="broom" />{`${t(kind === "volume" ? "volumes.prune" : "networks.prune")} (${one ? hosts[0]!.name : t("volumes.pruneAll", { n: hosts.length })})`}</>}
          </button>
        ) : null}
      </div>
      {msg && <p className={`whitespace-pre-line text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</p>}
    </div>
  );
}
