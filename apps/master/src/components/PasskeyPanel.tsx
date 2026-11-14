"use client";

import { useEffect, useState, useTransition } from "react";
import { passkeyDeleteAction, passkeyRegisterOptionsAction, passkeyRegisterVerifyAction } from "@/app/actions";
import { useT } from "./I18nProvider";
import Icon from "./Icon";
import { createPasskey, passkeysSupported } from "./passkey-client";

export interface PasskeyItem { id: number; name: string; createdAt: string; lastUsed: string | null }

/** Passkeys of the signed-in local account: add and remove. */
export default function PasskeyPanel({ items }: { items: PasskeyItem[] }) {
  const t = useT();
  const [supported, setSupported] = useState(true);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setSupported(passkeysSupported()), []);

  const add = () => start(async () => {
    setMsg({ ok: true, text: t("pk.working") });
    try {
      const o = await passkeyRegisterOptionsAction();
      if (!o.ok) return setMsg({ ok: false, text: o.message });
      const cred = await createPasskey(o.options);
      const r = await passkeyRegisterVerifyAction(cred, name);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setName("");
    } catch (e) {
      setMsg({ ok: false, text: t("pk.failed", { msg: e instanceof Error ? e.message : "error" }) });
    }
  });
  const remove = (id: number) => start(async () => {
    const r = await passkeyDeleteAction(id);
    setMsg({ ok: r.ok, text: r.message });
  });
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : t("pk.never"));

  return (
    <div className="space-y-3" data-testid="passkey-panel">
      <p className="text-xs text-slate-400">{t("pk.intro")}</p>
      {items.length === 0 ? <p className="text-sm text-slate-400">{t("pk.none")}</p> : (
        <ul className="divide-y divide-slate-800 text-sm">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-slate-500">{t("pk.created")} {day(p.createdAt)} · {t("pk.lastUsed")} {day(p.lastUsed)}</span>
              <button type="button" className="btn btn-danger ml-auto !px-3 !py-1 text-xs" disabled={pending} onClick={() => remove(p.id)}><Icon name="trash" />{t("pk.delete")}</button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">{t("pk.name")}
            <input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} className="input mt-1 w-56" />
          </label>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={add}><Icon name="key" />{t("pk.add")}</button>
        </div>
      ) : <p className="text-xs text-amber-300">{t("pk.unsupported")}</p>}
      {msg && <p role="status" className={`text-xs ${msg.ok ? "text-emerald-300" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
