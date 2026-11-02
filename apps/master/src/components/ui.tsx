export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    online: "bg-emerald-950 text-emerald-300 border-emerald-800",
    running: "bg-emerald-950 text-emerald-300 border-emerald-800",
    degraded: "bg-amber-950 text-amber-300 border-amber-800",
    offline: "bg-red-950 text-red-300 border-red-800",
    exited: "bg-slate-800 text-slate-300 border-slate-700",
    stopped: "bg-slate-800 text-slate-300 border-slate-700",
    disabled: "bg-slate-800 text-slate-400 border-slate-700",
  };
  const cls = map[status] ?? "bg-amber-950 text-amber-300 border-amber-800";
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{status || "unknown"}</span>;
}

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
