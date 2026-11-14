"use client";

import { useState, useTransition } from "react";
import { mfaBeginAction, mfaCodesAction, mfaConfirmAction, mfaDisableAction } from "@/app/actions";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

type Step = { kind: "idle" } | { kind: "setup"; secret: string; qr: string } | { kind: "codes"; codes: string[] };

/** Second factor of the signed-in local account: set up, recovery codes, turn off. `forced`: the administrator requires it. */
export default function MfaPanel({ enabled, recoveryLeft, required, forced = false }: { enabled: boolean; recoveryLeft: number; required: boolean; forced?: boolean }) {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [on, setOn] = useState(enabled);
  const [left, setLeft] = useState(recoveryLeft);
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");

  const begin = () => start(async () => {
    setMsg(null);
    const r = await mfaBeginAction();
    if (r.ok) setStep({ kind: "setup", secret: r.secret, qr: r.qr });
    else setMsg({ ok: false, text: r.message });
  });
  const confirm = () => start(async () => {
    if (step.kind !== "setup") return;
    const r = await mfaConfirmAction(step.secret, code);
    if (r.ok) { setStep({ kind: "codes", codes: r.codes }); setOn(true); setLeft(r.codes.length); setCode(""); setMsg(null); }
    else setMsg({ ok: false, text: r.message });
  });
  const regen = () => start(async () => {
    const r = await mfaCodesAction(pw);
    if (r.ok) { setStep({ kind: "codes", codes: r.codes }); setLeft(r.codes.length); setPw(""); setMsg(null); }
    else setMsg({ ok: false, text: r.message });
  });
  const disable = () => start(async () => {
    const r = await mfaDisableAction(pw);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setOn(false); setPw(""); }
  });

  return (
    <div className="space-y-3" data-testid="mfa-panel">
      <p className="text-xs text-slate-400">{t("mfa.intro")}</p>
      <p className="text-sm">{on ? <span className="text-emerald-300">{t("mfa.statusOn", { n: left })}</span> : <span className="text-slate-400">{t("mfa.statusOff")}</span>}</p>

      {step.kind === "idle" && !on && <button type="button" className="btn btn-primary" disabled={pending} onClick={begin}><Icon name="shield-check" />{t("mfa.enable")}</button>}

      {step.kind === "setup" && (
        <div className="space-y-3 rounded-lg border border-slate-800 p-3">
          <p className="text-sm">{t("mfa.scan")}</p>
          <div className="flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={step.qr} alt="QR" width={176} height={176} className="rounded bg-white p-1" />
            <div className="space-y-1 text-sm">
              <div className="text-xs text-slate-400">{t("mfa.key")}</div>
              <code className="break-all font-mono text-sm" data-testid="mfa-secret">{step.secret.match(/.{1,4}/g)?.join(" ")}</code>
            </div>
          </div>
          <label className="block text-sm">{t("mfa.codeLabel")}
            <input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="input mt-1 w-40 font-mono" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={pending || code.replace(/\s/g, "").length !== 6} onClick={confirm}><Icon name="check" />{t("mfa.confirm")}</button>
            {!forced && <button type="button" className="btn" onClick={() => { setStep({ kind: "idle" }); setCode(""); setMsg(null); }}><Icon name="x" />{t("mfa.cancel")}</button>}
          </div>
        </div>
      )}

      {step.kind === "codes" && (
        <div className="space-y-2 rounded-lg border border-amber-700 p-3" data-testid="mfa-codes">
          <h3 className="text-sm font-medium">{t("mfa.codesTitle")}</h3>
          <p className="text-xs text-amber-300">{t("mfa.codesHint")}</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3">{step.codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <button type="button" className="btn btn-primary" onClick={() => { setStep({ kind: "idle" }); if (forced) window.location.href = "/"; }}><Icon name="check" />{t("mfa.codesDone")}</button>
        </div>
      )}

      {on && step.kind === "idle" && (
        <div className="space-y-2 rounded-lg border border-slate-800 p-3">
          <label className="block text-sm">{t("mfa.password")}
            <input id="mfa-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" className="input mt-1 max-w-xs" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" disabled={pending || !pw} onClick={regen}><Icon name="arrow-clockwise" />{t("mfa.regen")}</button>
            {!required && <button type="button" className="btn btn-danger" disabled={pending || !pw} onClick={disable}><Icon name="trash" />{t("mfa.disable")}</button>}
          </div>
          {required && <p className="text-xs text-slate-500">{t("mfa.noDisable")}</p>}
        </div>
      )}
      {msg && <p role="status" className={`text-xs ${msg.ok ? "text-emerald-300" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
