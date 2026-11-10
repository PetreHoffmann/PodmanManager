"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Key } from "@/lib/i18n";
import { useT } from "./I18nProvider";
import AboutDialog from "./AboutDialog";
import LangSelect from "./LangSelect";
import { REPO_URL } from "@/lib/brand";

const ITEMS: { href: string; key: Key }[] = [
  { href: "/", key: "nav.dashboard" },
  { href: "/hosts", key: "nav.hosts" },
  { href: "/containers", key: "nav.containers" },
  { href: "/pods", key: "nav.pods" },
  { href: "/settings", key: "nav.settings" },
];

export default function Nav({ version }: { version: string }) {
  const path = usePathname();
  const t = useT();
  return (
    <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-2">
        <span className="mr-4 w-full font-semibold text-sky-400 sm:w-auto">PodmanManager</span>
        {ITEMS.map((i) => {
          const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
          return (
            <Link key={i.href} href={i.href} className={`rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`}>
              {t(i.key)}
            </Link>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="rounded-md px-3 py-1.5 text-sm text-slate-400 transition hover:text-white">
            {t("nav.help")}
          </a>
          <AboutDialog version={version} />
          <LangSelect className="ml-2" />
        </div>
      </div>
    </nav>
  );
}
