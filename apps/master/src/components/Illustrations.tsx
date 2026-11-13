/**
 * Static duotone illustrations for the dashboard rows (one per card type): the line takes the text color, the soft fills and
 * the highlights the accent color of the row. Decorative only.
 */
type Props = { className?: string };

const LINE = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Hosts: a server rack with status lights, connected to the network. */
export function HostsArt({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={`text-slate-300 ${className}`} aria-hidden="true" focusable="false">
      {[16, 44, 72].map((y, i) => (
        <g key={y}>
          <rect x="30" y={y} width="100" height="24" rx="6" {...LINE} fill="#38bdf8" fillOpacity={0.14 + i * 0.05} />
          <circle cx="44" cy={y + 12} r="3.5" fill={i === 1 ? "#fbbf24" : "#34d399"} />
          <circle cx="56" cy={y + 12} r="3.5" fill="#38bdf8" />
          <path d={`M82 ${y + 12} h38`} stroke="currentColor" strokeWidth={3} strokeLinecap="round" opacity={0.55} />
        </g>
      ))}
      <path d="M80 98 v8 M80 106 H44 M80 106 H116 M44 106 v6 M116 106 v6" {...LINE} />
      <circle cx="44" cy="113" r="4" fill="#38bdf8" />
      <circle cx="116" cy="113" r="4" fill="#38bdf8" />
      <circle cx="80" cy="106" r="4" fill="#38bdf8" />
    </svg>
  );
}

function Box({ x, y, accent, opacity = 0.2 }: { x: number; y: number; accent: string; opacity?: number }) {
  return (
    <g>
      <rect x={x} y={y} width="44" height="30" rx="5" {...LINE} fill={accent} fillOpacity={opacity} />
      <path d={`M${x + 12} ${y + 6} v18 M${x + 22} ${y + 6} v18 M${x + 32} ${y + 6} v18`} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" opacity={0.5} />
    </g>
  );
}

/** Containers: a stack of freight boxes. */
export function ContainersArt({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={`text-slate-300 ${className}`} aria-hidden="true" focusable="false">
      <path d="M16 106 H144" {...LINE} opacity={0.6} />
      <Box x={22} y={74} accent="#34d399" opacity={0.18} />
      <Box x={70} y={74} accent="#34d399" opacity={0.3} />
      <Box x={46} y={42} accent="#34d399" opacity={0.26} />
      <Box x={94} y={42} accent="#38bdf8" opacity={0.22} />
      <Box x={70} y={10} accent="#34d399" opacity={0.42} />
      <circle cx="136" cy="86" r="5" fill="#34d399" />
    </svg>
  );
}

/** Pods: a capsule that holds several containers together. */
export function PodsArt({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={`text-slate-300 ${className}`} aria-hidden="true" focusable="false">
      <rect x="14" y="26" width="132" height="68" rx="34" {...LINE} fill="#a78bfa" fillOpacity={0.14} />
      <rect x="34" y="46" width="26" height="28" rx="5" {...LINE} fill="#a78bfa" fillOpacity={0.32} />
      <rect x="67" y="46" width="26" height="28" rx="5" {...LINE} fill="#a78bfa" fillOpacity={0.5} />
      <rect x="100" y="46" width="26" height="28" rx="5" {...LINE} fill="#a78bfa" fillOpacity={0.32} />
      <path d="M47 60 h0 M80 60 h0 M113 60 h0" {...LINE} strokeWidth={6} />
      <path d="M40 104 h80" {...LINE} opacity={0.5} />
    </svg>
  );
}
