"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { containerOpAction } from "@/app/actions";
import { useT } from "./I18nProvider";

type Op = "start" | "stop" | "restart";

export default function ContainerActions({ agentId, containerId, state, name }: { agentId: number; containerId: string; state: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<Op | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const running = state === "running";

  const run = (op: Op) => {
    setConfirm(null);
    setMsg(null);
    start(async () => {
      const r = await containerOpAction(agentId, containerId, op);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  };

  const ask = (op: Op) => (op === "start" ? run(op) : setConfirm(op));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirm ? (
        <>
          <span className="text-sm text-amber-300">{confirm === "stop" ? t("act.stopQ", { name }) : t("act.restartQ", { name })}</span>
          <button className="btn btn-danger" onClick={() => run(confirm)}>{t("common.confirm")}</button>
          <button className="btn" onClick={() => setConfirm(null)}>{t("common.cancel")}</button>
        </>
      ) : (
        <>
          <button className="btn" disabled={pending || running} onClick={() => ask("start")}>{t("act.start")}</button>
          <button className="btn" disabled={pending || !running} onClick={() => ask("stop")}>{t("act.stop")}</button>
          <button className="btn" disabled={pending} onClick={() => ask("restart")}>{t("act.restart")}</button>
        </>
      )}
      {pending && <span className="animate-pulse text-xs text-slate-400">{t("act.working")}</span>}
      {msg && <span role="status" className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}
