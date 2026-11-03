"use client";

import { useRef, useState, useTransition } from "react";
import { checkUpdateAction } from "@/app/actions";
import type { UpdateInfo } from "@/lib/update-check";
import { AUTHOR, APP_NAME, COPYRIGHT_YEAR, REPO_URL } from "@/lib/brand";
import { useT } from "./I18nProvider";

const HUB_URL = "https://hub.docker.com/r/petrecalinoiu/podmanmanager-master";

export default function AboutDialog({ version }: { version: string }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [pending, start] = useTransition();

  const open = () => {
    ref.current?.showModal();
    setInfo(null);
    start(async () => setInfo(await checkUpdateAction()));
  };
  const close = () => ref.current?.close();

  return (
    <>
      <button type="button" onClick={open} className="rounded-md px-3 py-1.5 text-sm text-slate-400 transition hover:text-white">
        {t("nav.about")}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="about-title"
        onClick={(e) => e.target === ref.current && close()}
        className="m-auto w-[min(28rem,92vw)] rounded-xl border border-slate-700 bg-slate-900 p-0 text-slate-200 backdrop:bg-black/60"
      >
        <div className="space-y-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="about-title" className="text-lg font-semibold text-sky-400">{APP_NAME}</h2>
              <p className="text-sm text-slate-400">{t("about.version")} <span className="font-mono text-slate-200">{version}</span></p>
            </div>
            <button type="button" onClick={close} aria-label={t("about.close")} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white">✕</button>
          </div>

          <div role="status" aria-live="polite" className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
            {pending || info === null ? (
              <span className="animate-pulse text-slate-400">{t("about.checking")}</span>
            ) : info.state === "disabled" ? (
              <span className="text-slate-400">{t("about.disabled")}</span>
            ) : info.state === "unavailable" ? (
              <span className="text-amber-300">{t("about.unavailable")}</span>
            ) : info.newer ? (
              <div className="space-y-1">
                <p className="font-medium text-emerald-400">{t("about.updateAvailable", { latest: info.latest })}</p>
                <p className="text-xs text-slate-400">{t("about.updateHint")}</p>
                <a href={HUB_URL} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:underline">Docker Hub ↗</a>
              </div>
            ) : info.devBuild ? (
              <span className="text-slate-300">{t("about.devBuild", { latest: info.latest })}</span>
            ) : (
              <span className="text-emerald-400">{t("about.upToDate", { latest: info.latest })}</span>
            )}
          </div>

          <div className="space-y-1 text-sm">
            <p>{t("about.createdBy", { author: AUTHOR })}</p>
            <p className="text-xs text-slate-400">{t("about.copyright", { year: COPYRIGHT_YEAR, author: AUTHOR })}</p>
            <p className="text-xs"><a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">GitHub ↗</a></p>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={close} className="btn">{t("about.close")}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
