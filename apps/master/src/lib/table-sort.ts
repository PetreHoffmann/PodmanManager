export type SortDir = "asc" | "desc";
export interface Sort<K extends string = string> { key: K; dir: SortDir }
export type SortValue = string | number | number[] | null;

/** `sort` and `dir` from the address; a column that is not in `keys` means the default order. */
export function parseSortFor<K extends string>(keys: readonly K[], sort: string | undefined, dir: string | undefined): Sort<K> | null {
  const key = keys.find((k) => k === sort);
  return key ? { key, dir: dir === "desc" ? "desc" : "asc" } : null;
}

/** Click order of a column header: ascending, descending, back to the default. */
export function nextSortFor<K extends string>(current: Sort<K> | null, key: K): Sort<K> | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

/** Text with numbers compared as numbers ("host-2" before "host-10"), case-insensitive. */
export function naturalCompare(a: string, b: string): number {
  const x = a.toLowerCase().split(/(\d+)/), y = b.toLowerCase().split(/(\d+)/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? "", q = y[i] ?? "";
    if (p === q) continue;
    if (i % 2 === 1) return Number(p) - Number(q) || (p < q ? -1 : 1); // digit groups
    return p < q ? -1 : 1;
  }
  return 0;
}

/** "5.8.2", "4.9.4-rhel", "v0.28.0" → [5,8,2]; null if there is no version number. */
export function versionParts(v: string | null | undefined): number[] | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** Time in ms of an ISO string; null if missing or not a date. */
export function timeOf(iso: string | null | undefined): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

function cmp(a: SortValue, b: SortValue): number {
  if (typeof a === "string" && typeof b === "string") return naturalCompare(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  }
  return (a as number) - (b as number);
}

/** New array sorted by the column; missing values (null) always last, equal values keep their order. Without a sort the list is only copied. */
export function sortRows<T, K extends string>(rows: readonly T[], sort: Sort<K> | null, value: (row: T, key: K) => SortValue): T[] {
  const list = [...rows];
  if (!sort) return list;
  const sign = sort.dir === "desc" ? -1 : 1;
  return list
    .map((r, i) => ({ r, i, v: value(r, sort.key) }))
    .sort((p, q) => {
      if (p.v === null && q.v === null) return p.i - q.i;
      if (p.v === null) return 1;
      if (q.v === null) return -1;
      return sign * cmp(p.v, q.v) || p.i - q.i;
    })
    .map((x) => x.r);
}

/** Link target of a page with its other parameters (filters, tab) and the given sort. */
export function sortHrefFor(base: string, params: Record<string, string | undefined>, sort: Sort | null): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  if (sort) { q.set("sort", sort.key); q.set("dir", sort.dir); }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
