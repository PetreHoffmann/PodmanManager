/** "2026-11-13 17:56:17" from an RFC 3339 / ISO timestamp (UTC as delivered); "—" when there is none. */
export function logStamp(ts: string | null | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(ts ?? "");
  return m ? `${m[1]} ${m[2]}` : "—";
}
