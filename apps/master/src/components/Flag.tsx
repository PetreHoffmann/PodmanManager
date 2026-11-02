import type { Lang } from "@/lib/i18n";

export default function Flag({ lang }: { lang: Lang }) {
  const common = { viewBox: "0 0 60 40", width: 24, height: 16, "aria-hidden": true, className: "rounded-[2px]" } as const;
  switch (lang) {
    case "de":
      return (<svg {...common}><rect width="60" height="40" fill="#000" /><rect y="13.3" width="60" height="26.7" fill="#DD0000" /><rect y="26.6" width="60" height="13.4" fill="#FFCE00" /></svg>);
    case "ro":
      return (<svg {...common}><rect width="20" height="40" fill="#002B7F" /><rect x="20" width="20" height="40" fill="#FCD116" /><rect x="40" width="20" height="40" fill="#CE1126" /></svg>);
    case "es":
      return (<svg {...common}><rect width="60" height="40" fill="#AA151B" /><rect y="10" width="60" height="20" fill="#F1BF00" /></svg>);
    default:
      return (
        <svg {...common}>
          <rect width="60" height="40" fill="#012169" />
          <path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="8" />
          <path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3" />
          <path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="13" />
          <path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="8" />
        </svg>
      );
  }
}
