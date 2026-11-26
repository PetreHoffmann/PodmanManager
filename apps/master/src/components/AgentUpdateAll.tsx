"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { agentUpdateAction, agentUpdateStatusAction } from "@/app/actions";
import { pollUpdate } from "@/lib/update-poll";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

interface Result { label: string; ok: boolean; text: string }

/** Updates all outdated agents one after another (after a confirmation); each host reports its own result. */
export default function AgentUpdateAll({ hosts }: { hosts: { id: number; label: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  const run = async () => {
    setAsk(false);
    setResults([]);
    const done: Result[] = [];
    for (const h of hosts) {
      setRunning(h.label);
      let r: { ok: boolean; message: string };
      try {
        r = await agentUpdateAction(h.id);
      } catch (e) {
        r = { ok: false, message: e instanceof Error ? e.message : "error" };
      }
      let res: Result = { label: h.label, ok: r.ok, text: r.message };
      if (r.ok) {
        // wait for the end of this host's update (failed pull, unchanged image, restart) before the next one starts
        const o = await pollUpdate(() => agentUpdateStatusAction(h.id));
        res = o.kind === "error" ? { label: h.label, ok: false, text: t("update.failed", { msg: o.message ?? "?" }) }
          : o.kind === "current" ? { label: h.label, ok: true, text: t("update.current") }
          : o.kind === "timeout" ? { label: h.label, ok: false, text: t("update.slow") }
          : { label: h.label, ok: true, text: t("update.restarting") };
      }
      done.push(res);
      setResults([...done]);
    }
    setRunning(null);
    if (done.some((d) => d.ok)) setTimeout(() => router.refresh(), 15000);
  };

  return (
    <div className="space-y-2" data-testid="update-all">
      <div className="flex flex-wrap items-center gap-2">
        {ask ? (
          <>
            <span className="text-xs text-amber-300">{t("update.allQ", { n: hosts.length })}</span>
            <button type="button" className="btn btn-primary !px-2.5 !py-1 text-xs" onClick={run}><Icon name="check" />{t("common.confirm")}</button>
            <button type="button" className="btn !px-2.5 !py-1 text-xs" onClick={() => setAsk(false)}><Icon name="x" />{t("common.cancel")}</button>
          </>
        ) : (
          <button type="button" className="btn !px-2.5 !py-1 text-xs" disabled={running !== null} onClick={() => setAsk(true)}>
            {running !== null ? "…" : <><Icon name="arrow-circle-up" />{t("update.all", { n: hosts.length })}</>}
          </button>
        )}
        {running !== null && <span className="animate-pulse text-xs text-slate-400">{t("update.allRunning", { name: running })}</span>}
      </div>
      {results && results.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {results.map((r) => <li key={r.label} className={r.ok ? "text-emerald-300" : "text-amber-300"}><span className="font-medium">{r.label}:</span> {r.text}</li>)}
        </ul>
      )}
    </div>
  );
}
