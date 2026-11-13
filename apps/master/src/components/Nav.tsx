"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Key } from "@/lib/i18n";
import { useT } from "./I18nProvider";
import AboutDialog from "./AboutDialog";
import LangSelect from "./LangSelect";
import { APP_NAME, REPO_URL } from "@/lib/brand";
import { logoutAction } from "@/app/actions";

const ITEMS: { href: string; key: Key }[] = [
  { href: "/", key: "nav.dashboard" },
  { href: "/hosts", key: "nav.hosts" },
  { href: "/containers", key: "nav.containers" },
  { href: "/pods", key: "nav.pods" },
  { href: "/images", key: "nav.images" },
  { href: "/settings", key: "nav.settings" },
];

export default function Nav({ version, brand }: { version: string; brand: { text: string | null; logo: string | null } }) {
  const path = usePathname();
  const t = useT();
  const [open, setOpen] = useState(false);
  // close the phone menu after navigating and on Escape
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const link = "rounded-md px-3 py-2 text-sm transition md:py-1.5";
  return (
    <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
      {/* below md: brand + hamburger, menu as a vertical list; from md: one row (md:contents flattens the wrappers) */}
      <div className="mx-auto max-w-7xl px-4 py-2 md:flex md:flex-wrap md:items-center md:gap-1">
        <div className="flex items-center justify-between gap-3 md:contents">
          <Link href="/" aria-label={t("nav.dashboard")} className="mr-4 flex h-8 min-w-0 items-center rounded-md font-semibold text-sky-400 outline-offset-4 transition hover:opacity-80">
            {brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/brand/logo?v=${brand.logo}`} alt={brand.text ?? APP_NAME} title={brand.text ?? APP_NAME} className="h-8 max-h-8 w-auto max-w-[14rem] object-contain" />
            ) : (
              <span className="max-w-[18rem] truncate" title={brand.text ?? APP_NAME}>{brand.text ?? APP_NAME}</span>
            )}
          </Link>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition hover:bg-slate-800 hover:text-white md:hidden"
            aria-label={t("nav.menu")}
            aria-expanded={open}
            aria-controls="nav-menu"
            onClick={() => setOpen((o) => !o)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M3 5h14M3 10h14M3 15h14" />}
            </svg>
          </button>
        </div>
        <div id="nav-menu" className={open ? "flex flex-col gap-1 pt-2 md:contents" : "hidden md:contents"}>
          {ITEMS.map((i) => {
            const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
            return (
              <Link key={i.href} href={i.href} className={`${link} ${active ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`}>
                {t(i.key)}
              </Link>
            );
          })}
          <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-slate-800 pt-2 md:ml-auto md:mt-0 md:border-0 md:pt-0">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={`${link} text-slate-400 hover:text-white`}>
              {t("nav.help")}
            </a>
            <AboutDialog version={version} />
            <form action={logoutAction}>
              <button type="submit" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white md:py-1.5">
                {t("set.logout")}
              </button>
            </form>
            <LangSelect className="ml-2" />
          </div>
        </div>
      </div>
    </nav>
  );
}
