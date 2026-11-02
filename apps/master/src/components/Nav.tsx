"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Key } from "@/lib/i18n";
import { useT } from "./I18nProvider";
import LangSelect from "./LangSelect";

const ITEMS: { href: string; key: Key }[] = [
  { href: "/", key: "nav.dashboard" },
  { href: "/hosts", key: "nav.hosts" },
  { href: "/containers", key: "nav.containers" },
  { href: "/settings", key: "nav.settings" },
];

export default function Nav() {
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
        <LangSelect className="ml-auto" />
      </div>
    </nav>
  );
}
