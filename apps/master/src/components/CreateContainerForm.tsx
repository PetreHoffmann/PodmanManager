"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createContainerAction, createFormHostDataAction, type CreateContainerOutcome } from "@/app/actions";
import { podmanRunCommand, quadletFile } from "@/lib/create-preview";
import { splitCommand } from "@/lib/shell-words";
import { Block } from "./AgentSetupPanel";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

interface PortRow { host: string; container: string; protocol: "tcp" | "udp" }
interface EnvRow { key: string; value: string }
interface VolRow { name: string; path: string; readOnly: boolean }

const blank = { port: (): PortRow => ({ host: "", container: "", protocol: "tcp" }), env: (): EnvRow => ({ key: "", value: "" }), vol: (): VolRow => ({ name: "", path: "", readOnly: false }) };

/** Form for creating a container on one host (administrators only). Empty rows are ignored. */
export default function CreateContainerForm({ hosts }: { hosts: { id: number; label: string }[] }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [agentId, setAgentId] = useState(hosts[0]?.id ?? 0);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [vols, setVols] = useState<VolRow[]>([]);
  const [network, setNetwork] = useState("");
  const [restart, setRestart] = useState("no");
  const [memory, setMemory] = useState("");
  const [command, setCommand] = useState("");
  const [pod, setPod] = useState("");
  const [pods, setPods] = useState<string[]>([]);
  const [networks, setNetworks] = useState<string[]>([]);
  const [volumeNames, setVolumeNames] = useState<string[]>([]);
  const [result, setResult] = useState<CreateContainerOutcome | null>(null);

  useEffect(() => {
    let live = true;
    setNetwork("");
    setPod("");
    setPods([]);
    setNetworks([]);
    setVolumeNames([]);
    if (agentId) createFormHostDataAction(agentId).then((r) => { if (live && r.ok) { setNetworks(r.networks); setPods(r.pods); setVolumeNames(r.volumes); } }).catch(() => undefined);
    return () => { live = false; };
  }, [agentId]);

  const upd = <T,>(set: (f: (rows: T[]) => T[]) => void, i: number, patch: Partial<T>) => set((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const del = <T,>(set: (f: (rows: T[]) => T[]) => void, i: number) => set((rows) => rows.filter((_, k) => k !== i));

  const buildBody = () => {
    const args = splitCommand(command);
    if (args === null) return null;
    return {
      name: name.trim(),
      image: image.trim(),
      pod: pod || null,
      ports: pod ? [] : ports.filter((p) => p.host.trim() !== "" || p.container.trim() !== "").map((p) => ({ host: Number(p.host), container: Number(p.container), protocol: p.protocol })),
      env: env.filter((r) => r.key.trim() !== "").map((r) => ({ key: r.key.trim(), value: r.value })),
      volumes: vols.filter((v) => v.name.trim() !== "" || v.path.trim() !== "").map((v) => ({ name: v.name.trim(), path: v.path.trim(), readOnly: v.readOnly })),
      network: pod ? null : network || null,
      restart: restart as "no" | "always" | "unless-stopped" | "on-failure",
      memoryMb: memory.trim() === "" ? null : Number(memory),
      command: args,
    };
  };
  // live text previews (only for complete rows, so half-typed numbers never show up as NaN)
  const preview = useMemo(() => {
    const b = buildBody();
    if (!b || b.name === "" || b.image === "") return null;
    if (b.ports.some((p) => !Number.isInteger(p.host) || !Number.isInteger(p.container))) return null;
    if (b.volumes.some((v) => v.name === "" || v.path === "")) return null;
    if (b.memoryMb !== null && !Number.isInteger(b.memoryMb)) return null;
    return { run: podmanRunCommand(b), quadlet: quadletFile(b), file: `${b.name}.container` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, image, pod, ports, env, vols, network, restart, memory, command]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = buildBody();
    if (body === null) return setResult({ ok: false, message: t("cr.cmdBad") });
    setResult(null);
    start(async () => {
      try {
        setResult(await createContainerAction(agentId, body));
      } catch (err) {
        setResult({ ok: false, message: err instanceof Error ? err.message : "error" });
      }
    });
  };

  const label = "block text-sm";
  const small = "btn !px-2.5 !py-1 text-xs";

  return (
    <form onSubmit={submit} className="card max-w-3xl space-y-5" aria-busy={pending} data-testid="create-container">
      <p className="text-xs text-slate-400">{t("cr.intro")}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className={label}>{t("cr.host")}
          <select value={agentId} onChange={(e) => setAgentId(Number(e.target.value))} className="input mt-1" name="host">
            {hosts.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </label>
        <label className={label}>{t("cr.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} placeholder="web" className="input mt-1" name="name" />
        </label>
      </div>
      <label className={label}>{t("cr.image")}
        <input value={image} onChange={(e) => setImage(e.target.value)} required placeholder="docker.io/library/nginx:latest" className="input mt-1 font-mono text-xs" name="image" />
      </label>

      <label className="block text-sm">{t("cr.pod")}
        <select value={pod} onChange={(e) => setPod(e.target.value)} className="input mt-1 max-w-sm" name="pod">
          <option value="">{t("cr.podNone")}</option>
          {pods.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {pod && <p className="-mt-3 text-xs text-slate-500">{t("cr.podNote")}</p>}

      {!pod && <fieldset className="space-y-2">
        <legend className="text-sm">{t("cr.ports")}</legend>
        {ports.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input value={p.host} onChange={(e) => upd(setPorts, i, { host: e.target.value })} inputMode="numeric" placeholder={t("cr.portHost")} aria-label={t("cr.portHost")} className="input !w-28" />
            <span aria-hidden>:</span>
            <input value={p.container} onChange={(e) => upd(setPorts, i, { container: e.target.value })} inputMode="numeric" placeholder={t("cr.portCont")} aria-label={t("cr.portCont")} className="input !w-28" />
            <select value={p.protocol} onChange={(e) => upd(setPorts, i, { protocol: e.target.value as "tcp" | "udp" })} className="input !w-20" aria-label="protocol"><option value="tcp">tcp</option><option value="udp">udp</option></select>
            <button type="button" className={small} onClick={() => del(setPorts, i)}><Icon name="x" />{t("cr.remove")}</button>
          </div>
        ))}
        <button type="button" className={small} onClick={() => setPorts((r) => [...r, blank.port()])}><Icon name="plus-circle" />{t("cr.add")}</button>
      </fieldset>}

      <fieldset className="space-y-2">
        <legend className="text-sm">{t("cr.env")}</legend>
        {env.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input value={r.key} onChange={(e) => upd(setEnv, i, { key: e.target.value })} placeholder={t("cr.envKey")} aria-label={t("cr.envKey")} className="input !w-44 font-mono text-xs" />
            <span aria-hidden>=</span>
            <input value={r.value} onChange={(e) => upd(setEnv, i, { value: e.target.value })} placeholder={t("cr.envVal")} aria-label={t("cr.envVal")} className="input min-w-[10rem] flex-1 font-mono text-xs" autoComplete="off" />
            <button type="button" className={small} onClick={() => del(setEnv, i)}><Icon name="x" />{t("cr.remove")}</button>
          </div>
        ))}
        <button type="button" className={small} onClick={() => setEnv((r) => [...r, blank.env()])}><Icon name="plus-circle" />{t("cr.add")}</button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm">{t("cr.vols")}</legend>
        <datalist id="cr-volumes">{volumeNames.map((v) => <option key={v} value={v} />)}</datalist>
        {vols.map((v, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input value={v.name} onChange={(e) => upd(setVols, i, { name: e.target.value })} list="cr-volumes" placeholder={t("cr.volName")} aria-label={t("cr.volName")} className="input !w-44 font-mono text-xs" />
            <span aria-hidden>→</span>
            <input value={v.path} onChange={(e) => upd(setVols, i, { path: e.target.value })} placeholder="/data" aria-label={t("cr.volPath")} className="input min-w-[8rem] flex-1 font-mono text-xs" />
            <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={v.readOnly} onChange={(e) => upd(setVols, i, { readOnly: e.target.checked })} />{t("cr.volRo")}</label>
            <button type="button" className={small} onClick={() => del(setVols, i)}><Icon name="x" />{t("cr.remove")}</button>
          </div>
        ))}
        <button type="button" className={small} onClick={() => setVols((r) => [...r, blank.vol()])}><Icon name="plus-circle" />{t("cr.add")}</button>
      </fieldset>

      <div className="grid gap-3 md:grid-cols-3">
        {!pod && <label className={label}>{t("cr.network")}
          <select value={network} onChange={(e) => setNetwork(e.target.value)} className="input mt-1" name="network">
            <option value="">{t("cr.netDefault")}</option>
            {networks.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>}
        <label className={label}>{t("cr.restart")}
          <select value={restart} onChange={(e) => setRestart(e.target.value)} className="input mt-1" name="restart">
            <option value="no">{t("cr.rNo")}</option>
            <option value="always">{t("cr.rAlways")}</option>
            <option value="unless-stopped">{t("cr.rUnless")}</option>
            <option value="on-failure">{t("cr.rFail")}</option>
          </select>
        </label>
        <label className={label}>{t("cr.memory")}
          <input value={memory} onChange={(e) => setMemory(e.target.value)} inputMode="numeric" placeholder="512" className="input mt-1" name="memory" />
        </label>
      </div>
      <p className="-mt-3 text-xs text-slate-500">{t("cr.restartNote")}</p>

      <label className={label}>{t("cr.command")}
        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={`nginx -g "daemon off;"`} className="input mt-1 font-mono text-xs" name="command" />
      </label>

      {preview && (
        <div className="space-y-4 border-t border-slate-800 pt-4">
          <Block text={preview.run} title={t("cr.pvRun")} testid="preview-run" copyLabel={t("wiz.copy")} copiedLabel={t("wiz.copied")} />
          <Block text={preview.quadlet} title={t("cr.pvQuadlet", { file: preview.file })} testid="preview-quadlet" copyLabel={t("wiz.copy")} copiedLabel={t("wiz.copied")} />
          <p className="text-xs text-slate-500">{t("cr.pvNote")}</p>
        </div>
      )}

      <div className="space-y-2">
        <button className="btn btn-primary" type="submit" disabled={pending || hosts.length === 0}><Icon name="plus-circle" />{t("cr.submit")}</button>
        {pending && <p role="status" className="animate-pulse text-xs text-slate-400">{t("cr.working")}</p>}
        {result && !result.ok && <p role="alert" className="whitespace-pre-line text-sm text-red-400">{result.message}</p>}
        {result?.ok && (
          <div role="status" className="space-y-1 text-sm text-emerald-300" data-testid="create-result">
            <p>{t("cr.done", { name: result.name })}</p>
            {result.warnings.length > 0 && <p className="text-xs text-amber-300">{t("cr.warn", { w: result.warnings.join("; ") })}</p>}
            <Link className="text-sky-400 hover:underline" href={`/containers/${result.agentId}/${result.id}`}>{t("cr.open")}</Link>
          </div>
        )}
      </div>
    </form>
  );
}
