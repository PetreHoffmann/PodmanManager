export type UpdateInfo =
  | { state: "disabled" }
  | { state: "unavailable" }
  | { state: "ok"; current: string; latest: string; newer: boolean; devBuild: boolean };

export const DEFAULT_REPO = "petrecalinoiu/podmanmanager-master";
const REPO_RE = /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/;
const OK_TTL_MS = 6 * 3600_000;
const FAIL_TTL_MS = 5 * 60_000;

export function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a), pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  return 0;
}

/** Highest plain x.y.z tag (ignores latest, sha-*, pre-releases). */
export function latestStable(tags: string[]): string | null {
  const stable = tags.filter((t) => parseSemver(t) !== null);
  if (stable.length === 0) return null;
  return stable.reduce((a, b) => (compareSemver(a, b) >= 0 ? a : b));
}

export const updateCheckEnabled = (env: Record<string, string | undefined> = process.env) => !/^(off|false|0|no)$/i.test((env.UPDATE_CHECK ?? "").trim());

export function updateRepo(env: Record<string, string | undefined> = process.env): string {
  const r = (env.UPDATE_CHECK_REPO ?? "").trim().toLowerCase();
  return REPO_RE.test(r) ? r : DEFAULT_REPO;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
const cache = new Map<string, { at: number; latest: string | null }>();

/** Asks Docker Hub for the newest release tag; results are cached, failures never throw. */
export async function checkForUpdate(
  current: string,
  opts: { fetchFn?: FetchFn; repo?: string; now?: number; enabled?: boolean } = {},
): Promise<UpdateInfo> {
  if (!(opts.enabled ?? updateCheckEnabled())) return { state: "disabled" };
  const repo = opts.repo ?? updateRepo();
  const now = opts.now ?? Date.now();
  const hit = cache.get(repo);
  let latest: string | null;
  if (hit && now - hit.at < (hit.latest ? OK_TTL_MS : FAIL_TTL_MS)) {
    latest = hit.latest;
  } else {
    latest = null;
    try {
      const res = await (opts.fetchFn ?? fetch)(`https://hub.docker.com/v2/repositories/${repo}/tags/?page_size=100`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = (await res.json()) as { results?: { name?: unknown }[] };
        latest = latestStable((body.results ?? []).map((r) => (typeof r.name === "string" ? r.name : "")));
      }
    } catch {
      latest = null;
    }
    cache.set(repo, { at: now, latest });
  }
  if (!latest) return { state: "unavailable" };
  const devBuild = parseSemver(current) === null;
  return { state: "ok", current, latest, newer: !devBuild && compareSemver(latest, current) > 0, devBuild };
}

export const clearUpdateCache = () => cache.clear();
