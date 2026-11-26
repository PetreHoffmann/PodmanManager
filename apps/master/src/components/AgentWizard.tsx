"use client";

import { useState, useTransition } from "react";
import { createAgentAction, type SetupResult } from "@/app/actions";
import { useT } from "./I18nProvider";
import AgentSetupPanel from "./AgentSetupPanel";
import Icon from "./Icon";

export default function AgentWizard() {
  const t = useT();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<SetupResult | null>(null);
  const [url, setUrl] = useState("");
  const [agentId, setAgentId] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await createAgentAction(url, agentId);
      setRes(r);
      if (r.ok) { setUrl(""); setAgentId(""); }
    });
  };
  return (
    <section className="card max-w-3xl space-y-3" data-testid="agent-wizard">
      <h2 className="font-medium">{t("wiz.title")}</h2>
      <p className="text-xs text-slate-400">{t("wiz.intro")}</p>
      <form onSubmit={submit} className="space-y-3" aria-busy={pending}>
        <label className="block text-sm">{t("hosts.addrLabel")}
          <input name="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.21:9126" className="input mt-1" />
        </label>
        <label className="block text-sm">{t("wiz.agentId")}
          <input name="agentId" required value={agentId} onChange={(e) => setAgentId(e.target.value)} pattern="[A-Za-z0-9._\-]{1,64}" placeholder="host-1" className="input mt-1" />
        </label>
        <button className="btn btn-primary" type="submit" disabled={pending}><Icon name="plus-circle" />{t("wiz.create")}</button>
      </form>
      {res && !res.ok && <p role="status" className="text-xs text-red-400">{res.message}</p>}
      {res?.ok && (
        <div className="space-y-2">
          <p role="status" className="text-xs text-emerald-400">{res.message}</p>
          <AgentSetupPanel setup={res.setup} />
        </div>
      )}
    </section>
  );
}
