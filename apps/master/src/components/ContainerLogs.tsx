"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { containerLogsAction, podLogsAction } from "@/app/actions";
import type { LogLine } from "../../../../shared/types/index.js";
import { useT } from "./I18nProvider";

export default function ContainerLogs({ agentId, containerId, kind = "container" }: { agentId: number; containerId: string; kind?: "container" | "pod" }) {
  const t = useT();
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  const load = () =>
    start(async () => {
      const r = await (kind === "pod" ? podLogsAction : containerLogsAction)(agentId, containerId);
      if (r.ok) {
        setLines(r.lines);
        setSkipped(r.skipped ?? []);
        setError(null);
      } else {
        setError(r.message);
      }
    });

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight; // newest lines at the bottom
  }, [lines]);

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3">
        <h2 className="font-medium">{t("logs.title")}</h2>
        <button type="button" className="btn !px-3 !py-1 text-xs" disabled={pending} onClick={load}>
          {lines === null ? t("logs.show") : t("logs.refresh")}
        </button>
        {pending && <span className="animate-pulse text-xs text-slate-400">{t("logs.loading")}</span>}
      </div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {lines !== null && (
        <>
          <p className="text-xs text-slate-500">{t("logs.caption", { n: lines.length })}</p>
          {skipped.length > 0 && <p className="text-xs text-amber-400">{t("logs.skipped", { names: skipped.join(", ") })}</p>}
          <div ref={box} data-testid="log-box" className="max-h-96 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2 font-mono text-xs leading-5">
            {lines.length === 0 ? (
              <p className="text-slate-500">{t("logs.empty")}</p>
            ) : (
              lines.map((l, i) => (
                <div key={i} data-stream={l.stream} className={`whitespace-pre-wrap break-all ${l.stream === "stderr" ? "text-amber-300" : "text-slate-300"}`}>
                  <span className="mr-2 select-none text-slate-500" title={l.ts ?? ""}>{l.ts ? l.ts.slice(11, 19) : "--:--:--"}</span>
                  {l.container && <span className="mr-2 select-none text-sky-400" data-testid="log-container">{l.container}</span>}
                  {l.text}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
