"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createFormHostDataAction, createPodAction, type CreatePodOutcome } from "@/app/actions";
import { podCreateCommand, podQuadletFile } from "@/lib/create-preview";
import { useT } from "./I18nProvider";
import { Block } from "./AgentSetupPanel";
import Icon from "./Icon";

interface PortRow { host: string; container: string; protocol: "tcp" | "udp" }

/** Form for creating an empty pod on one host (administrators only). */
export default function CreatePodForm({ hosts }: { hosts: { id: number; label: string }[] }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [agentId, setAgentId] = useState(hosts[0]?.id ?? 0);
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [network, setNetwork] = useState("");
  const [networks, setNetworks] = useState<string[]>([]);
  const [result, setResult] = useState<CreatePodOutcome | null>(null);

  useEffect(() => {
    let live = true;
    setNetwork("");
    setNetworks([]);
    if (agentId) createFormHostDataAction(agentId).then((r) => { if (live && r.ok) setNetworks(r.networks); }).catch(() => undefined);
    return () => { live = false; };
  }, [agentId]);

  const body = () => ({
    name: name.trim(),
    hostname: hostname.trim() || null,
    ports: ports.filter((p) => p.host.trim() !== "" || p.container.trim() !== "").map((p) => ({ host: Number(p.host), container: Number(p.container), protocol: p.protocol })),
    network: network || null,
  });
  const preview = useMemo(() => {
    const b = body();
    if (b.name === "" || b.ports.some((p) => !Number.isInteger(p.host) || !Number.isInteger(p.container))) return null;
    return { run: podCreateCommand(b), quadlet: podQuadletFile(b), file: `${b.name}.pod` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, hostname, ports, network]);

  const upd = (i: number, patch: Partial<PortRow>) => setPorts((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    start(async () => {
      try { setResult(await createPodAction(agentId, body())); } catch (err) { setResult({ ok: false, message: err instanceof Error ? err.message : "error" }); }
    });
  };
  const label = "block text-sm";
  const small = "btn !px-2.5 !py-1 text-xs";

  return (
    <form onSubmit={submit} className="card max-w-3xl space-y-5" aria-busy={pending} data-testid="create-pod">
      <p className="text-xs text-slate-400">{t("crp.intro")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={label}>{t("cr.host")}
          <select value={agentId} onChange={(e) => setAgentId(Number(e.target.value))} className="input mt-1" name="host">
            {hosts.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </label>
        <label className={label}>{t("crp.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} placeholder="app" className="input mt-1" name="name" />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm">{t("cr.ports")}</legend>
        {ports.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input value={p.host} onChange={(e) => upd(i, { host: e.target.value })} inputMode="numeric" placeholder={t("cr.portHost")} aria-label={t("cr.portHost")} className="input !w-28" />
            <span aria-hidden>:</span>
            <input value={p.container} onChange={(e) => upd(i, { container: e.target.value })} inputMode="numeric" placeholder={t("cr.portCont")} aria-label={t("cr.portCont")} className="input !w-28" />
            <select value={p.protocol} onChange={(e) => upd(i, { protocol: e.target.value as "tcp" | "udp" })} className="input !w-20" aria-label="protocol"><option value="tcp">tcp</option><option value="udp">udp</option></select>
            <button type="button" className={small} onClick={() => setPorts((r) => r.filter((_, k) => k !== i))}><Icon name="x" />{t("cr.remove")}</button>
          </div>
        ))}
        <button type="button" className={small} onClick={() => setPorts((r) => [...r, { host: "", container: "", protocol: "tcp" }])}><Icon name="plus-circle" />{t("cr.add")}</button>
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={label}>{t("cr.network")}
          <select value={network} onChange={(e) => setNetwork(e.target.value)} className="input mt-1" name="network">
            <option value="">{t("cr.netDefault")}</option>
            {networks.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className={label}>{t("crp.hostname")}
          <input value={hostname} onChange={(e) => setHostname(e.target.value)} maxLength={63} placeholder="app1" className="input mt-1" name="hostname" />
        </label>
      </div>
      {preview && (
        <div className="space-y-4 border-t border-slate-800 pt-4">
          <Block text={preview.run} title={t("crp.pvRun")} testid="preview-run" copyLabel={t("wiz.copy")} copiedLabel={t("wiz.copied")} />
          <Block text={preview.quadlet} title={t("crp.pvQuadlet", { file: preview.file })} testid="preview-quadlet" copyLabel={t("wiz.copy")} copiedLabel={t("wiz.copied")} />
          <p className="text-xs text-slate-500">{t("crp.pvNote", { name: name.trim() })}</p>
          <p className="text-xs text-slate-500">{t("crp.kubeNote")}</p>
        </div>
      )}
      <div className="space-y-2">
        <button className="btn btn-primary" type="submit" disabled={pending || hosts.length === 0}><Icon name="plus-circle" />{t("crp.submit")}</button>
        {pending && <p role="status" className="animate-pulse text-xs text-slate-400">{t("crp.working")}</p>}
        {result && !result.ok && <p role="alert" className="whitespace-pre-line text-sm text-red-400">{result.message}</p>}
        {result?.ok && (
          <div role="status" className="space-y-1 text-sm text-emerald-300" data-testid="create-result">
            <p>{t("crp.done", { name: result.name })}</p>
            <Link className="text-sky-400 hover:underline" href="/pods">{t("crp.open")}</Link>
          </div>
        )}
      </div>
    </form>
  );
}
