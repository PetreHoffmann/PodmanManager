"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { containerOpAction, podOpAction } from "@/app/actions";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

type Op = "start" | "stop" | "restart";

export default function ContainerActions({ agentId, containerId, state, name, kind = "container" }: { agentId: number; containerId: string; state: string; name: string; kind?: "container" | "pod" }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<Op | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // A degraded pod has running and stopped containers: allow both start and stop.
  const running = state === "running";
  const degraded = kind === "pod" && state === "degraded";

  const run = (op: Op) => {
    setConfirm(null);
    setMsg(null);
    start(async () => {
      const r = await (kind === "pod" ? podOpAction : containerOpAction)(agentId, containerId, op);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  };

  const ask = (op: Op) => (op === "start" ? run(op) : setConfirm(op));

  const seg = "inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-slate-200 transition disabled:cursor-not-allowed disabled:opacity-40";
  const divider = "border-l border-slate-700";

  return (
    <div className="flex flex-col items-start gap-1">
      {confirm ? (
        <>
          <span key="question" className="text-xs text-amber-300">{confirm === "stop" ? t("act.stopQ", { name }) : t("act.restartQ", { name })}</span>
          <div key="confirm-buttons" className="flex gap-1">
            <button className="btn btn-danger !px-3 !py-1 text-xs" onClick={() => run(confirm)}><Icon name="check" />{t("common.confirm")}</button>
            <button className="btn !px-3 !py-1 text-xs" onClick={() => setConfirm(null)}><Icon name="x" />{t("common.cancel")}</button>
          </div>
        </>
      ) : (
        <div key="actions" className="inline-flex overflow-hidden whitespace-nowrap rounded-md border border-slate-700 bg-slate-800" role="group">
          <button className={`${seg} enabled:hover:bg-emerald-900/60 enabled:hover:text-emerald-200`} disabled={pending || (running && !degraded)} onClick={() => ask("start")}><Icon name="play" />{t("act.start")}</button>
          <button className={`${seg} ${divider} enabled:hover:bg-red-900/60 enabled:hover:text-red-200`} disabled={pending || (!running && !degraded)} onClick={() => ask("stop")}><Icon name="stop" />{t("act.stop")}</button>
          <button className={`${seg} ${divider} enabled:hover:bg-sky-900/60 enabled:hover:text-sky-200`} disabled={pending} onClick={() => ask("restart")}><Icon name="arrows-clockwise" />{t("act.restart")}</button>
        </div>
      )}
      {pending && <span className="animate-pulse text-xs text-slate-400">{t("act.working")}</span>}
      {msg && <span role="status" className={`max-w-[16rem] text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}
