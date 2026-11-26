"use client";

import { useState, useTransition } from "react";
import { execAction, type ExecOutcome } from "@/app/actions";
import { splitCommand } from "@/lib/shell-words";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

/** Runs one command in the container (administrators, only where the agent allows it): no shell session, output shown once. */
export default function ContainerExec({ agentId, containerId, name }: { agentId: number; containerId: string; name: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [line, setLine] = useState("");
  const [timeout, setTimeoutSec] = useState(15);
  const [ask, setAsk] = useState<string[] | null>(null);
  const [result, setResult] = useState<ExecOutcome | null>(null);
  const [ran, setRan] = useState("");

  const prepare = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    const args = splitCommand(line);
    if (args === null || args.length === 0) return setResult({ ok: false, message: t("ex.cmdBad") });
    setAsk(args);
  };
  const run = (args: string[]) => {
    setAsk(null);
    setRan(args.join(" "));
    start(async () => {
      try {
        setResult(await execAction(agentId, containerId, { cmd: args, timeoutSec: timeout }));
      } catch (err) {
        setResult({ ok: false, message: err instanceof Error ? err.message : "error" });
      }
    });
  };

  return (
    <section className="card space-y-3" data-testid="exec" aria-busy={pending}>
      <h2 className="font-medium">{t("ex.title")}</h2>
      <p className="text-xs text-slate-400">{t("ex.intro")}</p>
      <form onSubmit={prepare} className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[14rem] flex-1 text-sm">{t("ex.cmd")}
          <input value={line} onChange={(e) => setLine(e.target.value)} required placeholder="ls -l /data" className="input mt-1 font-mono text-xs" name="cmd" autoComplete="off" />
        </label>
        <label className="block text-sm">{t("ex.timeout")}
          <select value={timeout} onChange={(e) => setTimeoutSec(Number(e.target.value))} className="input mt-1 !w-24" name="timeout">
            {[5, 15, 30, 60].map((s) => <option key={s} value={s}>{s} s</option>)}
          </select>
        </label>
        {!ask && <button className="btn btn-primary" type="submit" disabled={pending}><Icon name="terminal-window" />{t("ex.run")}</button>}
      </form>
      {ask && (
        <div className="space-y-2" role="alertdialog">
          <p className="text-xs text-amber-300">{t("ex.confirm", { name })}</p>
          <pre className="overflow-auto rounded-md border border-slate-800 bg-slate-950 p-2 text-xs" data-testid="exec-confirm">{ask.join(" ")}</pre>
          <div className="flex gap-1">
            <button type="button" className="btn btn-danger !px-3 !py-1 text-xs" onClick={() => run(ask)} data-testid="exec-yes"><Icon name="check" />{t("common.confirm")}</button>
            <button type="button" className="btn !px-3 !py-1 text-xs" onClick={() => setAsk(null)}><Icon name="x" />{t("common.cancel")}</button>
          </div>
        </div>
      )}
      {pending && <p role="status" className="animate-pulse text-xs text-slate-400">{t("ex.running")}</p>}
      {result && !result.ok && <p role="alert" className="whitespace-pre-line text-sm text-red-400">{result.message}</p>}
      {result?.ok && (
        <div className="space-y-2" data-testid="exec-result">
          <p className="text-xs text-slate-400"><span className="font-mono">{ran}</span> · {result.timedOut ? t("ex.timedOut") : t("ex.exit", { code: String(result.exitCode ?? "–") })}{result.truncated ? ` · ${t("ex.truncated")}` : ""}</p>
          {result.stdout !== "" && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950 p-3 text-xs" data-testid="exec-stdout">{result.stdout}</pre>}
          {result.stderr !== "" && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-amber-900 bg-slate-950 p-3 text-xs text-amber-300" data-testid="exec-stderr">{result.stderr}</pre>}
          {result.stdout === "" && result.stderr === "" && <p className="text-xs text-slate-500">{t("ex.noOutput")}</p>}
        </div>
      )}
    </section>
  );
}
