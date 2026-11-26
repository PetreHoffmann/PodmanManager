import { fmtBytes } from "@/components/ui";
import type { HostState, Point } from "@/lib/metrics";
import type { Key, T } from "@/lib/i18n";
import { MetricsChart } from "@/components/MetricsChart";

const niceMax = (v: number, min: number) => Math.max(min, v * 1.15);

function Panel({ title, now, legend, children }: { title: string; now: React.ReactNode; legend?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-sm tabular-nums">{now}</span>
      </div>
      {children}
      {legend && <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-400">{legend}</div>}
    </div>
  );
}

const Dot = ({ cls, children }: { cls: string; children: React.ReactNode }) => <span className="inline-flex items-center gap-1"><span className={`inline-block h-2 w-2 rounded-full ${cls}`} />{children}</span>;

export function MetricsCard({ t, lang, points, host, keepMin }: { t: T; lang: string; points: Point[] | null; host: HostState | undefined; keepMin: number }) {
  let body: React.ReactNode;
  if (keepMin <= 0) body = <p className="text-sm text-slate-400">{t("met.off")}</p>;
  else if (host?.state === "unavailable") body = <p className="text-sm text-amber-300">{t("met.unavailable")}</p>;
  else if (host?.state === "error") body = <p className="text-sm text-amber-300">{t("met.error", { msg: host.message ?? "" })}</p>;
  else if (!points || points.length < 2) body = <p className="text-sm text-slate-400">{t("met.noData")}</p>;
  else {
    const times = points.map((p) => p.t);
    const last = points[points.length - 1]!;
    const num = (f: (p: Point) => number | null) => points.map(f);
    const maxOf = (...vs: (number | null)[][]) => Math.max(0, ...vs.flat().filter((v): v is number => v !== null));
    const rate = (v: number | null) => (v === null ? "–" : `${fmtBytes(v, lang)}/s`);
    const cpu = num((p) => p.cpu);
    const mem = num((p) => p.mem);
    const memMax = Math.max(...points.map((p) => p.mem));
    const limit = last.memLimit > 0 && last.memLimit <= memMax * 8 ? last.memLimit : undefined;
    const netIn = num((p) => p.netIn), netOut = num((p) => p.netOut), blkIn = num((p) => p.blockIn), blkOut = num((p) => p.blockOut);
    const minutes = Math.max(1, Math.round((last.t - points[0]!.t) / 60_000));
    body = (
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{t("met.window", { n: minutes })} · {t("met.core")}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Panel title={t("met.cpu")} now={last.cpu === null ? "–" : `${last.cpu.toFixed(last.cpu < 10 ? 1 : 0)} %`}>
            <MetricsChart times={times} lines={[{ values: cpu, cls: "stroke-sky-400", label: t("met.cpu") }]} yMax={niceMax(maxOf(cpu), 100)} unit="percent" limitLabel="" label={t("met.cpu")} lang={lang} />
          </Panel>
          <Panel title={t("met.mem")} now={`${fmtBytes(last.mem, lang)}${last.memLimit > 0 ? ` / ${fmtBytes(last.memLimit, lang)}` : ""}`} legend={limit !== undefined ? <Dot cls="bg-amber-500">{t("met.limit")}</Dot> : undefined}>
            <MetricsChart times={times} lines={[{ values: mem, cls: "stroke-emerald-400", label: t("met.mem") }]} yMax={limit ?? niceMax(memMax, 1)} unit="bytes" limit={limit} limitLabel={t("met.limit")} label={t("met.mem")} lang={lang} />
          </Panel>
          <Panel title={t("met.net")} now={`↓ ${rate(last.netIn)} · ↑ ${rate(last.netOut)}`} legend={<><Dot cls="bg-sky-400">{t("met.in")}</Dot><Dot cls="bg-violet-400">{t("met.out")}</Dot></>}>
            <MetricsChart times={times} lines={[{ values: netIn, cls: "stroke-sky-400", label: t("met.in") }, { values: netOut, cls: "stroke-violet-400", label: t("met.out") }]} yMax={niceMax(maxOf(netIn, netOut), 1024)} unit="rate" limitLabel="" label={t("met.net")} lang={lang} />
          </Panel>
          <Panel title={t("met.disk")} now={`${t("met.read")} ${rate(last.blockIn)} · ${t("met.write")} ${rate(last.blockOut)}`} legend={<><Dot cls="bg-sky-400">{t("met.read")}</Dot><Dot cls="bg-violet-400">{t("met.write")}</Dot></>}>
            <MetricsChart times={times} lines={[{ values: blkIn, cls: "stroke-sky-400", label: t("met.read") }, { values: blkOut, cls: "stroke-violet-400", label: t("met.write") }]} yMax={niceMax(maxOf(blkIn, blkOut), 1024)} unit="rate" limitLabel="" label={t("met.disk")} lang={lang} />
          </Panel>
        </div>
      </div>
    );
  }
  return (
    <section className="card space-y-2" data-testid="metrics">
      <h2 className="font-medium">{t("met.title")}</h2>
      {body}
    </section>
  );
}

export type { Key };
