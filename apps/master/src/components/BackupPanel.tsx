"use client";

import { useRef, useState } from "react";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

export interface StoredBackup { name: string; size: number; mtime: number }

const fmt = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function BackupPanel({ keep, items }: { keep: number; items: StoredBackup[] }) {
  const t = useT();
  const ref = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const storedRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">{t("backup.intro")}</p>
      <a href="/settings/backup" className="btn btn-primary w-fit" download><Icon name="download-simple" />{t("backup.download")}</a>
      <section className="space-y-2 rounded-lg border border-slate-800 p-3" data-testid="auto-backups">
        <h3 className="text-sm font-medium">{t("backup.autoTitle")}</h3>
        <p className="text-xs text-slate-400">{keep > 0 ? t("backup.autoOn", { n: keep }) : t("backup.autoOff")}</p>
        {keep > 0 && items.length === 0 && <p className="text-xs text-slate-500">{t("backup.autoNone")}</p>}
        {items.length > 0 && (
          <ul className="divide-y divide-slate-800 text-sm">
            {items.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <span className="font-mono text-xs">{b.name}</span>
                <span className="text-xs text-slate-500">{fmt(b.size)}</span>
                <span className="ml-auto flex gap-2">
                  <a href={`/settings/backup?file=${encodeURIComponent(b.name)}`} className="btn" download><Icon name="download-simple" />{t("backup.download")}</a>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (storedRef.current) storedRef.current.value = b.name;
                      if (fileRef.current) fileRef.current.required = false;
                      const f = ref.current;
                      if (f && !f.checkValidity()) {
                        // the confirmation is not ticked yet: show the hint and forget the pick
                        f.reportValidity();
                        if (storedRef.current) storedRef.current.value = "";
                        if (fileRef.current) fileRef.current.required = true;
                        return;
                      }
                      f?.requestSubmit();
                    }}
                  ><Icon name="arrow-counter-clockwise" />{t("backup.restoreThis")}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form
        ref={ref}
        className="space-y-3 rounded-lg border border-slate-800 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            const r = await fetch("/settings/backup", { method: "POST", body: new FormData(e.currentTarget) });
            if (storedRef.current) storedRef.current.value = "";
            if (fileRef.current) fileRef.current.required = true;
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
        <input ref={storedRef} type="hidden" name="stored" defaultValue="" />
        <label className="block text-sm">{t("backup.file")}
          <input ref={fileRef} id="backup-file" name="file" type="file" accept=".db,application/vnd.sqlite3,application/octet-stream" required className="input mt-1" />
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
