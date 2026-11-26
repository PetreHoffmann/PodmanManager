"use client";

import { useState } from "react";
import type { AgentSetup } from "@/lib/agent-setup";
import { useT } from "./I18nProvider";

type Tab = "file" | "secret" | "run" | "hash";
const TABS: { key: Tab; label: "wiz.tabFile" | "wiz.tabSecret" | "wiz.tabRun" | "wiz.tabHash"; steps: "wiz.stepsFile" | "wiz.stepsSecret" | "wiz.stepsRun" | "wiz.stepsHash" }[] = [
  { key: "file", label: "wiz.tabFile", steps: "wiz.stepsFile" },
  { key: "secret", label: "wiz.tabSecret", steps: "wiz.stepsSecret" },
  { key: "run", label: "wiz.tabRun", steps: "wiz.stepsRun" },
  { key: "hash", label: "wiz.tabHash", steps: "wiz.stepsHash" },
];

/** A code block with its own copy button. */
function Block({ text, title, testid, copyLabel, copiedLabel }: { text: string; title?: string; testid: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
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
    <div className="space-y-1">
      {title && <div className="text-xs font-medium text-slate-300">{title}</div>}
      <pre className="max-h-72 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs" data-testid={testid}>{text}</pre>
      <button type="button" className="btn !px-2.5 !py-1 text-xs" onClick={copy}>{copied ? copiedLabel : copyLabel}</button>
    </div>
  );
}

/** Shows what the agent host needs: the Quadlet file (hash in the file or as Podman secret), the podman run command or just the hash. */
export default function AgentSetupPanel({ setup }: { setup: AgentSetup }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("file");
  const cur = TABS.find((x) => x.key === tab)!;
  const common = { copyLabel: t("wiz.copy"), copiedLabel: t("wiz.copied") };
  return (
    <div className="space-y-2" data-testid="agent-setup">
      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)} className={`btn !px-2.5 !py-1 text-xs ${tab === x.key ? "btn-primary" : ""}`}>
            {t(x.label)}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400">{t(cur.steps)}</p>
      {tab === "secret" ? (
        <div className="space-y-3">
          <Block text={setup.secretCommand} title={t("wiz.secretStep1")} testid="agent-setup-secret-cmd" {...common} />
          <Block text={setup.quadletSecret} title={t("wiz.secretStep2")} testid="agent-setup-text" {...common} />
        </div>
      ) : (
        <Block text={tab === "file" ? setup.quadlet : tab === "run" ? setup.podmanRun : setup.hashLine} testid="agent-setup-text" {...common} />
      )}
      <span className="block text-xs text-slate-500">{t("wiz.hashNote")}</span>
    </div>
  );
}
