"use client";

import { useState } from "react";
import type { AgentSetup } from "@/lib/agent-setup";
import { useT } from "./I18nProvider";

/** Shows what the agent host needs: the complete Quadlet file or just the hash line. */
export default function AgentSetupPanel({ setup }: { setup: AgentSetup }) {
  const t = useT();
  const [tab, setTab] = useState<"file" | "hash">("file");
  const [copied, setCopied] = useState(false);
  const text = tab === "file" ? setup.quadlet : setup.hashLine;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard access (http): the text can still be selected by hand */
    }
  };
  return (
    <div className="space-y-2" data-testid="agent-setup">
      <div className="flex gap-1" role="tablist">
        {(["file", "hash"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`btn !px-2.5 !py-1 text-xs ${tab === k ? "btn-primary" : ""}`}>
            {t(k === "file" ? "wiz.tabFile" : "wiz.tabHash")}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400">{t(tab === "file" ? "wiz.stepsFile" : "wiz.stepsHash")}</p>
      <pre className="max-h-72 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs" data-testid="agent-setup-text">{text}</pre>
      <div className="flex items-center gap-3">
        <button type="button" className="btn !px-2.5 !py-1 text-xs" onClick={copy}>{copied ? t("wiz.copied") : t("wiz.copy")}</button>
        <span className="text-xs text-slate-500">{t("wiz.hashNote")}</span>
      </div>
    </div>
  );
}
