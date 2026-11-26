"use client";

import { useState } from "react";
import { fmtClock, fmtUnit, nearestIndex, type ChartUnit } from "@/lib/chart-hover";

const W = 320;
const H = 90;
const PAD = { l: 4, r: 4, t: 6, b: 4 };

export interface ChartLine { values: (number | null)[]; cls: string; label: string }

/** Line chart on one shared time axis; null values break the line. Hovering (or touching) shows the values of the nearest point. */
export function MetricsChart({ times, lines, yMax, unit, limit, limitLabel, label, lang }: { times: number[]; lines: ChartLine[]; yMax: number; unit: ChartUnit; limit?: number; limitLabel: string; label: string; lang: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const t0 = times[0]!;
  const t1 = Math.max(times[times.length - 1]!, t0 + 1);
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - Math.min(v, yMax) / yMax) * (H - PAD.t - PAD.b);
  const paths = lines.map((ln) => {
    let d = "";
    let pen = false;
    ln.values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(times[i]!).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return { d: d.trim(), cls: ln.cls, only: ln.values.filter((v) => v !== null).length === 1 ? ln.values.findIndex((v) => v !== null) : -1 };
  });

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (t1 - t0);
    setHover(nearestIndex(times, t));
  };
  const hx = hover === null ? 0 : x(times[hover]!);
  const left = (hx / W) * 100;

  return (
    <div className="relative touch-pan-y" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)} data-testid="metrics-chart">
      <span className="pointer-events-none absolute right-1 top-0 text-[10px] tabular-nums text-slate-500">{fmtUnit(yMax, unit, lang)}</span>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label={label} preserveAspectRatio="none">
        {[0, 0.5, 1].map((f) => <line key={f} x1={PAD.l} x2={W - PAD.r} y1={y(yMax * f)} y2={y(yMax * f)} className="stroke-slate-800" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {limit !== undefined && limit <= yMax && <line x1={PAD.l} x2={W - PAD.r} y1={y(limit)} y2={y(limit)} className="stroke-amber-500" strokeDasharray="4 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        {paths.map((p, i) => (
          <g key={i}>
            {p.d && <path d={p.d} fill="none" className={p.cls} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {p.only >= 0 && <ellipse cx={x(times[p.only]!)} cy={y(lines[i]!.values[p.only]!)} rx="2" ry="2" className={p.cls.replace("stroke-", "fill-")} />}
          </g>
        ))}
        {hover !== null && <line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} className="stroke-slate-500" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && (
        <>
          {lines.map((ln, i) => {
            const v = ln.values[hover];
            return v === null || v === undefined ? null : <span key={i} className={`pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-slate-950 ${ln.cls.replace("stroke-", "bg-")}`} style={{ left: `${left}%`, top: `${(y(v) / H) * 100}%` }} />;
          })}
          <div role="tooltip" data-testid="metrics-tooltip" className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900/95 px-2 py-1 text-xs shadow-lg" style={left > 60 ? { right: `${100 - left + 2}%` } : { left: `${left + 2}%` }}>
            <div className="tabular-nums text-slate-400">{fmtClock(times[hover]!, lang)}</div>
            {lines.map((ln, i) => (
              <div key={i} className="flex items-center gap-1.5 tabular-nums">
                <span className={`inline-block h-2 w-2 rounded-full ${ln.cls.replace("stroke-", "bg-")}`} />
                {lines.length > 1 && <span className="text-slate-400">{ln.label}</span>}
                <span>{fmtUnit(ln.values[hover] ?? null, unit, lang)}</span>
              </div>
            ))}
            {limit !== undefined && <div className="tabular-nums text-amber-400">{limitLabel} {fmtUnit(limit, unit, lang)}</div>}
          </div>
        </>
      )}
    </div>
  );
}
