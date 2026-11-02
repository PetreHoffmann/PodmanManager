"use client";

import { statusLabel } from "@/lib/i18n";
import { useT } from "./I18nProvider";

const MAP: Record<string, string> = {
  online: "bg-emerald-950 text-emerald-300 border-emerald-800",
  running: "bg-emerald-950 text-emerald-300 border-emerald-800",
  degraded: "bg-amber-950 text-amber-300 border-amber-800",
  offline: "bg-red-950 text-red-300 border-red-800",
  exited: "bg-slate-800 text-slate-300 border-slate-700",
  stopped: "bg-slate-800 text-slate-300 border-slate-700",
  disabled: "bg-slate-800 text-slate-400 border-slate-700",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const cls = MAP[status] ?? "bg-amber-950 text-amber-300 border-amber-800";
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{statusLabel(t, status || "unknown")}</span>;
}
