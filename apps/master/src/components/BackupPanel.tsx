"use client";

import { useRef, useState } from "react";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

export default function BackupPanel() {
  const t = useT();
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">{t("backup.intro")}</p>
      <a href="/settings/backup" className="btn btn-primary w-fit" download><Icon name="download-simple" />{t("backup.download")}</a>
      <form
        ref={ref}
        className="space-y-3 rounded-lg border border-slate-800 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            const r = await fetch("/settings/backup", { method: "POST", body: new FormData(e.currentTarget) });
            const j = (await r.json()) as { ok: boolean; message: string };
            setMsg({ ok: j.ok, text: j.message });
            if (j.ok) setTimeout(() => { window.location.href = "/login"; }, 2500);
          } catch {
            setMsg({ ok: false, text: t("err.restoreFile") });
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 className="text-sm font-medium">{t("backup.restoreTitle")}</h3>
        <label className="block text-sm">{t("backup.file")}
          <input id="backup-file" name="file" type="file" accept=".db,application/vnd.sqlite3,application/octet-stream" required className="input mt-1" />
        </label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="force" className="mt-1" />{t("backup.force")}</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" required className="mt-1" />{t("backup.confirm")}</label>
        <button disabled={busy} className="btn btn-danger"><Icon name="arrow-counter-clockwise" />{busy ? t("backup.working") : t("backup.restore")}</button>
        <p className="text-xs text-slate-500">{t("backup.note")}</p>
        {msg && <p role="status" className={`whitespace-pre-line text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
      </form>
    </div>
  );
}
