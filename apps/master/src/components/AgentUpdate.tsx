"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { agentUpdateAction, agentUpdateStatusAction } from "@/app/actions";
import { pollUpdate } from "@/lib/update-poll";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

/** Starts the update of a remote agent and reports how it ends (failed pull, already current, restart). */
export default function AgentUpdate({ id }: { id: number }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-1">
      <button
        className="btn !px-2 !py-0.5 text-xs"
        disabled={pending || (msg?.ok === true && !done)}
        onClick={() =>
          start(async () => {
            setDone(false);
            const r = await agentUpdateAction(id);
            setMsg({ ok: r.ok, text: r.message });
            if (!r.ok) return setDone(true);
            const o = await pollUpdate(() => agentUpdateStatusAction(id));
            if (o.kind === "error") setMsg({ ok: false, text: t("update.failed", { msg: o.message ?? "?" }) });
            else if (o.kind === "current") setMsg({ ok: true, text: t("update.current") });
            else if (o.kind === "timeout") setMsg({ ok: false, text: t("update.slow") });
            else setMsg({ ok: true, text: t("update.restarting") });
            setDone(true);
            if (o.kind === "restarting" || o.kind === "current") setTimeout(() => router.refresh(), o.kind === "restarting" ? 15000 : 500);
          })
        }
      >
        {pending ? "…" : <><Icon name="arrow-circle-up" />{t("update.btn")}</>}
      </button>
      {msg && <div className={`max-w-xs text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</div>}
    </div>
  );
}
