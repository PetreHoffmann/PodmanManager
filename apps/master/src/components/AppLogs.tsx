"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { AppLogsResult } from "@/app/actions";
import type { AppLogLine } from "../../../../shared/types/index.js";
import { useT } from "./I18nProvider";

const COLOR = { info: "text-slate-300", warn: "text-amber-300", error: "text-red-400" } as const;

/** Log viewer for the master (id 0) or a selectable agent; lines load on demand. */
export default function AppLogs({ title, load, options }: { title: string; load: (id: number) => Promise<AppLogsResult>; options?: { id: number; label: string }[] }) {
  const t = useT();
  const [id, setId] = useState(options?.[0]?.id ?? 0);
  const [lines, setLines] = useState<AppLogLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  const run = () =>
    start(async () => {
      const r = await load(id);
      if (r.ok) {
        setLines(r.lines);
        setError(null);
      } else {
        setError(r.message);
      }
    });

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium">{title}</h2>
        {options && (
          <select aria-label={t("alogs.host")} className="input !w-auto !py-1 text-xs" value={id} onChange={(e) => { setId(Number(e.target.value)); setLines(null); setError(null); }}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        <button type="button" className="btn !px-3 !py-1 text-xs" disabled={pending || (options !== undefined && options.length === 0)} onClick={run}>
          {lines === null ? t("logs.show") : t("logs.refresh")}
        </button>
        {pending && <span className="animate-pulse text-xs text-slate-400">{t("logs.loading")}</span>}
      </div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {lines !== null && (
        <>
          <p className="text-xs text-slate-500">{t("alogs.caption", { n: lines.length })}</p>
          <div ref={box} data-testid="applog-box" className="max-h-96 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2 font-mono text-xs leading-5">
            {lines.length === 0 ? (
              <p className="text-slate-500">{t("logs.empty")}</p>
            ) : (
              lines.map((l, i) => (
                <div key={i} data-level={l.level} className={`whitespace-pre-wrap break-all ${COLOR[l.level]}`}>
                  <span className="mr-2 select-none text-slate-500" title={l.ts}>{l.ts.slice(11, 19)}</span>
                  <span className="mr-2 select-none uppercase text-slate-500">{l.level}</span>
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
