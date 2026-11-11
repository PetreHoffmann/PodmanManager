export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "bad" | "warn" }) {
  const c = tone === "ok" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-slate-100";
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

export function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** Compact table form "YYYY-MM-DD HH:MM" (UTC); show the full value via fmt() in a title attribute. */
export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().replace("T", " ").slice(0, 16);
}

/** Decimal units like `podman system df` (1 GB = 10^9 bytes), one decimal for MB and above. */
export function fmtBytes(n: number, locale = "en"): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const f = new Intl.NumberFormat(locale, { maximumFractionDigits: i < 2 ? 0 : 1, minimumFractionDigits: 0 });
  return `${f.format(v)} ${units[i]}`;
}
