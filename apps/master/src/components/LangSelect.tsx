"use client";

import { setLangAction } from "@/app/actions";
import { LANGS, LANG_NAMES } from "@/lib/i18n";
import Flag from "./Flag";
import { useI18n } from "./I18nProvider";

export default function LangSelect({ className = "" }: { className?: string }) {
  const { lang, t } = useI18n();
  return (
    <form action={setLangAction} className={`flex items-center gap-1 ${className}`} role="group" aria-label={t("lang.label")}>
      {LANGS.map((l) => (
        <button
          key={l}
          name="lang"
          value={l}
          title={LANG_NAMES[l]}
          aria-label={LANG_NAMES[l]}
          aria-pressed={l === lang}
          className={`rounded-md p-1 transition ${l === lang ? "bg-slate-700 ring-1 ring-sky-500" : "opacity-60 hover:bg-slate-800 hover:opacity-100"}`}
        >
          <Flag lang={l} />
        </button>
      ))}
    </form>
  );
}
