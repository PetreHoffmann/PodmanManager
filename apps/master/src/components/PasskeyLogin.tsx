"use client";

import { useEffect, useState } from "react";
import { passkeyLoginOptionsAction, passkeyLoginVerifyAction } from "@/app/actions";
import { useT } from "./I18nProvider";
import Icon from "./Icon";
import { getPasskey, passkeysSupported } from "./passkey-client";

/** "Sign in with a passkey" button of the login page; hidden where the browser or address cannot do passkeys. */
export default function PasskeyLogin() {
  const t = useT();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setSupported(passkeysSupported()), []);
  if (!supported) return null;
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const o = await passkeyLoginOptionsAction();
      if (!o.ok) return setErr(o.message);
      const a = await getPasskey(o);
      const r = await passkeyLoginVerifyAction(a);
      if (r.ok) window.location.href = "/";
      else setErr(r.message);
    } catch {
      setErr(t("msg.passkeyFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 space-y-2">
      <p className="text-center text-xs text-slate-500">{t("auth.or")}</p>
      <button type="button" className="btn w-full justify-center" disabled={busy} onClick={run}><Icon name="key" />{t("pk.signIn")}</button>
      {err && <p role="alert" className="text-center text-xs text-red-400">{err}</p>}
    </div>
  );
}
