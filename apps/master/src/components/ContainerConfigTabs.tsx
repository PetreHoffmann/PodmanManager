"use client";

import { useState } from "react";
import { useT } from "./I18nProvider";
import { Block } from "./AgentSetupPanel";

export interface ConfigTexts { run: string; quadlet: string; kube: string | null; kubeCmd: string | null; file: string; bindMounts: number }

/** Tabs with the container as podman run command, Quadlet file and (in a pod) Kubernetes YAML. */
export default function ContainerConfigTabs({ texts }: { texts: ConfigTexts }) {
  const t = useT();
  const tabs = [
    { key: "run", label: t("cfg.tabRun") },
    { key: "quadlet", label: t("cfg.tabQuadlet") },
    ...(texts.kube ? [{ key: "kube", label: t("cfg.tabKube") }] : []),
  ];
  const [tab, setTab] = useState("run");
  const common = { copyLabel: t("wiz.copy"), copiedLabel: t("wiz.copied") };
  return (
    <section className="card space-y-3" data-testid="config-tabs">
      <h2 className="font-medium">{t("cfg.title")}</h2>
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)} data-testid={`tab-${x.key}`}
            className={`btn !px-3 !py-1 text-sm ${tab === x.key ? "btn-primary" : ""}`}>{x.label}</button>
        ))}
      </div>
      {tab === "run" && <Block text={texts.run} testid="cfg-run" {...common} />}
      {tab === "quadlet" && <Block text={texts.quadlet} title={t("cfg.file", { file: texts.file })} testid="cfg-quadlet" {...common} />}
      {tab === "kube" && texts.kube && (
        <div className="space-y-3">
          <Block text={texts.kube} testid="cfg-kube" {...common} />
          {texts.kubeCmd && <Block text={texts.kubeCmd} testid="cfg-kube-cmd" {...common} />}
          <p className="text-xs text-slate-500">{t("cfg.kubeNote")}</p>
        </div>
      )}
      <p className="text-xs text-slate-500">{t("cfg.note")}{texts.bindMounts > 0 ? ` ${t("cfg.bind", { n: texts.bindMounts })}` : ""}</p>
    </section>
  );
}
