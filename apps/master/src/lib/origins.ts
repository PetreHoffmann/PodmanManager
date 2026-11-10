/**
 * Public host names (as seen by the browser) that may submit Server Actions even though the
 * reverse proxy forwards a different Host header. Edge-safe: pure functions only.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => {
      // accept "https://master.example.com" as well as "master.example.com[:port]"
      if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
        try {
          return new URL(s).host;
        } catch {
          return "";
        }
      }
      return s.replace(/\/+$/, "");
    })
    .filter((s) => /^(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/.test(s));
}

/** `originHost` is the host[:port] part of the Origin header. Patterns: exact or "*.example.com". */
export function originAllowed(originHost: string, patterns: string[]): boolean {
  const h = originHost.toLowerCase();
  return patterns.some((p) => {
    if (p.startsWith("*.")) {
      const suffix = p.slice(1); // ".example.com[:port]"
      return h.length > suffix.length && h.endsWith(suffix);
    }
    return h === p;
  });
}
