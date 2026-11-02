export const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/;
export const ACTIONS = ["start", "stop", "restart"] as const;
export type Action = (typeof ACTIONS)[number];
export const isAction = (v: unknown): v is Action => typeof v === "string" && (ACTIONS as readonly string[]).includes(v);

export interface ParsedAddress {
  address: string;
  port: number;
}

/** Accepts only http://host:port (no path, credentials, query). */
export function parseAgentUrl(input: string): ParsedAddress | null {
  const s = input.trim();
  if (!/^http:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const port = u.port ? Number(u.port) : 9126;
  if (port < 1 || port > 65535) return null;
  return { address: u.hostname.toLowerCase(), port };
}

export const validToken = (t: string) => /^[A-Za-z0-9._~+/=-]{16,512}$/.test(t);
