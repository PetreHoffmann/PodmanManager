"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteContainerAction } from "@/app/actions";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

/** Delete button with a confirmation (administrators, stopped containers that systemd does not manage). */
export default function ContainerDelete({ agentId, containerId, name, redirectTo }: { agentId: number; containerId: string; name: string; redirectTo?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () => {
    setAsk(false);
    setMsg(null);
    start(async () => {
      const r = await deleteContainerAction(agentId, containerId);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok && redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-start gap-1" data-testid="delete-container">
      {ask ? (
        <>
          <span className="max-w-[16rem] text-xs text-amber-300">{t("del.q", { name })}</span>
          <div className="flex gap-1">
            <button className="btn btn-danger !px-3 !py-1 text-xs" onClick={run} data-testid="delete-yes"><Icon name="check" />{t("common.confirm")}</button>
            <button className="btn !px-3 !py-1 text-xs" onClick={() => setAsk(false)}><Icon name="x" />{t("common.cancel")}</button>
          </div>
        </>
      ) : (
        <button className="btn !px-3 !py-1 text-xs enabled:hover:bg-red-900/60" disabled={pending} onClick={() => setAsk(true)} data-testid="delete-btn" title={t("del.hint")}><Icon name="trash" />{t("del.btn")}</button>
      )}
      {pending && <span className="animate-pulse text-xs text-slate-400">{t("act.working")}</span>}
      {msg && <span role="status" className={`max-w-[16rem] text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}
