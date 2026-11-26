import type { Sort } from "@/lib/table-sort";

/** Sort selection for phones (no column headers there): column and direction, other page parameters stay as hidden fields. */
export default function SortForm<K extends string>({ options, current, base, params, labels }: {
  options: { key: K; label: string }[];
  current: Sort<K> | null;
  base: string;
  params: Record<string, string | undefined>;
  labels: { by: string; dflt: string; dir: string; asc: string; desc: string; apply: string };
}) {
  return (
    <form action={base} method="get" className="flex flex-wrap items-center gap-2 text-xs" data-testid="sort-form">
      {Object.entries(params).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label htmlFor="sort-by" className="text-slate-400">{labels.by}</label>
      <select id="sort-by" name="sort" defaultValue={current?.key ?? ""} className="input !w-auto !py-1 text-xs">
        <option value="">{labels.dflt}</option>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <select name="dir" defaultValue={current?.dir ?? "asc"} className="input !w-auto !py-1 text-xs" aria-label={labels.dir}>
        <option value="asc">{labels.asc}</option>
        <option value="desc">{labels.desc}</option>
      </select>
      <button className="btn !px-2.5 !py-1 text-xs" type="submit">{labels.apply}</button>
    </form>
  );
}
