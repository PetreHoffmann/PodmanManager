import http from "node:http";
import https from "node:https";
import tls from "node:tls";

/**
 * Node's global fetch ignores http(s)_proxy. Podman passes the host's proxy variables into containers,
 * so a master behind a corporate proxy can reach nothing directly. This module sends HTTPS requests
 * through an HTTP proxy (CONNECT tunnel) and is used ONLY for the update check, never for agent calls
 * (agents are internal and must not be routed through a proxy).
 */

type Env = Record<string, string | undefined>;

/** NO_PROXY: "*" , exact hosts, domain suffixes (with or without leading dot / "*."), optional ":port". */
export function noProxyMatch(host: string, port: number, list: string | undefined): boolean {
  const h = host.toLowerCase();
  for (const raw of (list ?? "").split(/[\s,]+/)) {
    let e = raw.trim().toLowerCase();
    if (!e) continue;
    if (e === "*") return true;
    const m = /^(.*):(\d{1,5})$/.exec(e);
    if (m && !e.includes("]")) {
      if (Number(m[2]) !== port) continue;
      e = m[1]!;
    }
    e = e.replace(/^\*?\./, "");
    if (h === e || h.endsWith(`.${e}`)) return true;
  }
  return false;
}

/** The HTTP proxy to use for this https URL, or null (none configured, bypassed, or unsupported). */
export function proxyFor(target: URL, env: Env = process.env): URL | null {
  if (target.protocol !== "https:") return null;
  const raw = (env.https_proxy || env.HTTPS_PROXY || env.all_proxy || env.ALL_PROXY || "").trim();
  if (!raw) return null;
  if (noProxyMatch(target.hostname, Number(target.port || 443), env.no_proxy ?? env.NO_PROXY)) return null;
  try {
    const p = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    return p.protocol === "http:" && p.hostname ? p : null;
  } catch {
    return null;
  }
}

const MAX_BODY = 2 * 1024 * 1024;

const err = (code: string, message: string) => Object.assign(new Error(message), { cause: { code } });

/** GET through an HTTP proxy with a CONNECT tunnel; TLS to the target is verified normally. */
export function fetchViaProxy(target: URL, proxy: URL, init: RequestInit = {}, tlsOptions: { ca?: string | Buffer } = {}): Promise<Response> {
  const headers: Record<string, string> = init.headers instanceof Headers ? Object.fromEntries(init.headers) : { ...(init.headers as Record<string, string> | undefined) };
  const hostPort = `${target.hostname}:${target.port || 443}`;
  const proxyHeaders: Record<string, string> = { Host: hostPort };
  if (proxy.username) {
    proxyHeaders["Proxy-Authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
  }
  return new Promise<Response>((resolve, reject) => {
    const signal = init.signal ?? undefined;
    const connect = http.request({ host: proxy.hostname, port: proxy.port || 80, method: "CONNECT", path: hostPort, headers: proxyHeaders, signal });
    connect.on("error", reject);
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(err(`PROXY_${res.statusCode ?? 0}`, `proxy refused CONNECT (${res.statusCode})`));
      }
      const req = https.request(
        {
          host: target.hostname,
          path: `${target.pathname}${target.search}`,
          method: "GET",
          headers: { Host: target.host, ...headers },
          signal,
          createConnection: () => tls.connect({ socket, servername: target.hostname, ca: tlsOptions.ca }),
        },
        (resp) => {
          const chunks: Buffer[] = [];
          let size = 0;
          resp.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY) return resp.destroy(err("BODY_TOO_LARGE", "response too large"));
            chunks.push(c);
          });
          resp.on("error", reject);
          resp.on("end", () => {
            const status = resp.statusCode ?? 0;
            if (status < 200 || status > 599) return reject(err("BAD_STATUS", "unexpected status"));
            resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status }));
          });
        },
      );
      req.on("error", (e) => {
        socket.destroy();
        reject(e);
      });
      req.end();
    });
    connect.end();
  });
}

/** fetch() that goes through the environment's HTTP proxy for https URLs (when configured). */
export function makeProxyAwareFetch(env: Env = process.env, tlsOptions: { ca?: string | Buffer } = {}) {
  return (url: string, init: RequestInit = {}): Promise<Response> => {
    const target = new URL(url);
    const proxy = proxyFor(target, env);
    return proxy ? fetchViaProxy(target, proxy, init, tlsOptions) : fetch(url, init);
  };
}

/** Short machine code for an error ("ECONNREFUSED", "TIMEOUT", "PROXY_407", ...), no free text. */
export function failCode(e: unknown): string {
  const x = e as { name?: string; code?: unknown; cause?: { code?: unknown }; message?: string };
  if (x?.name === "TimeoutError" || x?.name === "AbortError") return "TIMEOUT";
  for (const c of [x?.cause?.code, x?.code]) if (typeof c === "string" && /^[A-Z0-9_]{3,40}$/.test(c)) return c;
  if (typeof x?.message === "string" && /^[A-Z0-9_]{3,40}$/.test(x.message)) return x.message;
  return "ERROR";
}
