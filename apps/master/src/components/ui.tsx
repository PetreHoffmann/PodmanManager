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
