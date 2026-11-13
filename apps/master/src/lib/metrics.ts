import type { ContainerStatsRaw, StatsReport } from "../../../../shared/types/index.js";
import { listAgents, targetFor } from "./agents";
import { agentStats } from "./agent-client";
import { getConfig } from "./config";

/** One measurement: rates are per second and null when they cannot be computed (first sample, counter reset, gap). */
export interface Point {
  t: number;
  /** percent of one core (100 = one full core) */
  cpu: number | null;
  mem: number;
  memLimit: number;
  netIn: number | null;
  netOut: number | null;
  blockIn: number | null;
  blockOut: number | null;
  pids: number;
}

interface Series {
  name: string;
  prev: { ts: number; raw: ContainerStatsRaw } | null;
  points: Point[];
}

export type HostState = { state: "ok" | "unavailable" | "error"; message?: string; at: number };

export interface MetricsStore {
  series: Map<string, Series>;
  hosts: Map<number, HostState>;
}

export const MAX_POINTS = 2000;

export const newStore = (): MetricsStore => ({ series: new Map(), hosts: new Map() });
const g = globalThis as unknown as { __pmMetrics?: MetricsStore; __pmMetricsTimer?: NodeJS.Timeout; __pmMetricsRunning?: boolean };
export const metricsStore = (): MetricsStore => (g.__pmMetrics ??= newStore());

const keyOf = (agentId: number, id: string) => `${agentId}:${id}`;

function rate(cur: number, prev: number, dt: number): number | null {
  const d = cur - prev;
  return d >= 0 && dt > 0 ? d / dt : null; // a falling counter means the container restarted
}

/** Adds one agent report to the store, drops what is older than `keepMs`, and returns nothing. */
export function ingest(store: MetricsStore, agentId: number, report: StatsReport, opts: { keepMs: number; intervalMs: number; now?: number }): void {
  const now = opts.now ?? Date.now();
  const maxGap = opts.intervalMs * 5;
  const maxPoints = Math.min(MAX_POINTS, Math.ceil(opts.keepMs / opts.intervalMs) + 2);
  for (const raw of report.containers) {
    const key = keyOf(agentId, raw.id);
    const s = store.series.get(key) ?? { name: raw.name, prev: null, points: [] };
    s.name = raw.name || s.name;
    const p0 = s.prev;
    const dt = p0 ? (report.ts - p0.ts) / 1000 : 0;
    const usable = p0 !== null && dt > 0.5 && dt * 1000 <= maxGap;
    const point: Point = {
      t: report.ts,
      cpu: usable ? (() => { const r = rate(raw.cpuNano, p0.raw.cpuNano, dt); return r === null ? null : (r / 1e9) * 100; })() : null,
      mem: raw.memUsage,
      memLimit: raw.memLimit,
      netIn: usable ? rate(raw.netIn, p0.raw.netIn, dt) : null,
      netOut: usable ? rate(raw.netOut, p0.raw.netOut, dt) : null,
      blockIn: usable ? rate(raw.blockIn, p0.raw.blockIn, dt) : null,
      blockOut: usable ? rate(raw.blockOut, p0.raw.blockOut, dt) : null,
      pids: raw.pids,
    };
    s.prev = { ts: report.ts, raw };
    s.points.push(point);
    store.series.set(key, s);
  }
  const cutoff = now - opts.keepMs;
  for (const [key, s] of store.series) {
    if (!key.startsWith(`${agentId}:`)) continue;
    while (s.points.length > 0 && s.points[0]!.t < cutoff) s.points.shift();
    if (s.points.length > maxPoints) s.points.splice(0, s.points.length - maxPoints);
    if (s.points.length === 0) store.series.delete(key);
  }
}

export const hostState = (agentId: number, store: MetricsStore = metricsStore()): HostState | undefined => store.hosts.get(agentId);

export function seriesFor(agentId: number, id: string, store: MetricsStore = metricsStore()): { name: string; points: Point[] } | null {
  const s = store.series.get(keyOf(agentId, id));
  return s ? { name: s.name, points: s.points } : null;
}

/** Latest point per container of one host, only while the container still reports (a stopped container has no current value). */
export function latestFor(agentId: number, store: MetricsStore = metricsStore(), now: number = Date.now(), maxAgeMs: number = getConfig().metricsIntervalSec * 3000): Map<string, Point> {
  const out = new Map<string, Point>();
  const prefix = `${agentId}:`;
  for (const [key, s] of store.series) {
    if (!key.startsWith(prefix)) continue;
    const last = s.points[s.points.length - 1];
    if (last && now - last.t <= maxAgeMs) out.set(key.slice(prefix.length), last);
  }
  return out;
}

/** One sampling round over all reachable hosts; never throws. */
export async function sampleOnce(store: MetricsStore = metricsStore()): Promise<void> {
  const cfg = getConfig();
  const keepMs = cfg.metricsKeepMin * 60_000;
  const intervalMs = cfg.metricsIntervalSec * 1000;
  await Promise.allSettled(
    listAgents().filter((a) => a.enabled && a.status !== "offline").map(async (a) => {
      const t = targetFor(a.id);
      if (!t) return;
      const r = await agentStats(t);
      if (r.ok) {
        ingest(store, a.id, r.data, { keepMs, intervalMs });
        store.hosts.set(a.id, { state: "ok", at: Date.now() });
      } else if (r.code === "STATS_UNAVAILABLE") {
        store.hosts.set(a.id, { state: "unavailable", message: r.message, at: Date.now() });
      } else {
        store.hosts.set(a.id, { state: "error", message: r.message, at: Date.now() });
      }
    }),
  );
}

export function startMetrics(): void {
  const cfg = getConfig();
  if (g.__pmMetricsTimer || cfg.metricsKeepMin <= 0) return;
  const tick = () => {
    if (g.__pmMetricsRunning) return;
    g.__pmMetricsRunning = true;
    sampleOnce().catch(() => {}).finally(() => { g.__pmMetricsRunning = false; });
  };
  g.__pmMetricsTimer = setInterval(tick, cfg.metricsIntervalSec * 1000);
  g.__pmMetricsTimer.unref();
  tick();
}
