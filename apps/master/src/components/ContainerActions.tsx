"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { containerOpAction } from "@/app/actions";

type Op = "start" | "stop" | "restart";

export default function ContainerActions({ agentId, containerId, state, name }: { agentId: number; containerId: string; state: string; name: string }) {
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
          <span className="text-sm text-amber-300">{confirm === "stop" ? "Stop" : "Restart"} “{name}”?</span>
          <button className="btn btn-danger" onClick={() => run(confirm)}>Confirm</button>
          <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
        </>
      ) : (
        <>
          <button className="btn" disabled={pending || running} onClick={() => ask("start")}>Start</button>
          <button className="btn" disabled={pending || !running} onClick={() => ask("stop")}>Stop</button>
          <button className="btn" disabled={pending} onClick={() => ask("restart")}>Restart</button>
        </>
      )}
      {pending && <span className="text-xs text-slate-400 animate-pulse">working…</span>}
      {msg && <span role="status" className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}
