import Link from "next/link";
import { nextSortFor, sortHrefFor, type Sort } from "@/lib/table-sort";

/** Column header that sorts by a click: ascending, descending, default. Keeps the other parameters (filters, tab) of the page. */
export default function SortTh<K extends string>({ label, sortKey, current, base, params, className = "" }: {
  label: string;
  sortKey: K;
  current: Sort<K> | null;
  base: string;
  params: Record<string, string | undefined>;
  className?: string;
}) {
  const active = current?.key === sortKey ? current.dir : null;
  return (
    <th className={`th ${className}`} aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}>
      <Link href={sortHrefFor(base, params, nextSortFor(current, sortKey))} className="inline-flex items-center gap-1 hover:text-white" data-testid={`sort-${sortKey}`}>
        {label}<span aria-hidden className={active ? "text-sky-400" : "text-slate-600"}>{active === "desc" ? "▼" : active === "asc" ? "▲" : "↕"}</span>
      </Link>
    </th>
  );
}
