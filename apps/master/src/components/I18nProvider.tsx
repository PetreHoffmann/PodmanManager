"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type Lang, type T } from "@/lib/i18n";

const Ctx = createContext<{ lang: Lang; t: T } | null>(null);

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("I18nProvider missing");
  return v;
}
export const useT = () => useI18n().t;
