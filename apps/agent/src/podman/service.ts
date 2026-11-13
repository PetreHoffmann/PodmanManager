import type { ContainerAction, ContainerInfo, ImageDeleteResult, ImageInfo, ImagePruneResult, LogLine, PodInfo, PodLogs, StorageInfo } from "../../../../shared/types/index.js";
import { PodmanClient, PodmanError, TOO_LARGE_MESSAGE, type PodmanResponse } from "./client.js";
import { parseLogStream } from "./logs.js";

export const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/;

export function isValidContainerId(id: string): boolean {
  return CONTAINER_ID_RE.test(id);
}

/** Pod ids have the same shape as container ids (hex, 12-64). */
export const isValidPodId = isValidContainerId;

function json(res: PodmanResponse): unknown {
  try {
    return JSON.parse(res.body.toString("utf8"));
  } catch {
    throw new PodmanError("PODMAN_API_ERROR", "Invalid JSON from Podman", res.status);
  }
}

function upstreamMessage(res: PodmanResponse): string {
  try {
    const o = JSON.parse(res.body.toString("utf8")) as { message?: unknown; cause?: unknown };
    const errs = (o as { Errs?: unknown }).Errs;
    const e = Array.isArray(errs) ? errs.filter((x) => typeof x === "string").join("; ") : "";
    const m = typeof o.message === "string" ? o.message : typeof o.cause === "string" ? o.cause : e;
    if (m) return m.slice(0, 300);
  } catch {
    /* fall through */
  }
  return `Podman returned HTTP ${res.status}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isoTime(v: unknown): string | null {
  if (typeof v === "number") return v > 0 ? new Date(v * 1000).toISOString() : null;
  if (typeof v === "string" && v !== "") {
    if (v.startsWith("0001-")) return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});

export function mapListItem(raw: unknown): ContainerInfo {
  const o = rec(raw);
  const names = Array.isArray(o.Names) ? o.Names : [];
  return {
    id: str(o.Id),
    name: str(names[0]).replace(/^\//, ""),
    image: str(o.Image),
    state: str(o.State),
    status: str(o.Status) || str(o.State),
    createdAt: isoTime(o.Created) ?? isoTime(o.CreatedAt),
    startedAt: isoTime(o.StartedAt),
    podId: str(o.Pod) || null,
    podName: str(o.PodName) || null,
  };
}

export function mapPod(raw: unknown): PodInfo {
  const o = rec(raw);
  const infraId = str(o.InfraId);
  const list = Array.isArray(o.Containers) ? o.Containers : [];
  return {
    id: str(o.Id),
    name: str(o.Name),
    status: str(o.Status).toLowerCase() || "unknown",
    createdAt: isoTime(o.Created),
    containers: list.map((c) => {
      const r = rec(c);
      const names = Array.isArray(r.Names) ? str(r.Names[0]) : str(r.Names);
      const id = str(r.Id);
      return { id, name: names.replace(/^\//, ""), state: str(r.Status).toLowerCase() || "unknown", infra: infraId !== "" && id === infraId };
    }),
  };
}

export function mapInspect(raw: unknown): ContainerInfo {
  const o = rec(raw);
  const st = rec(o.State);
  return {
    id: str(o.Id),
    name: str(o.Name).replace(/^\//, ""),
    image: str(o.ImageName) || str(o.Image),
    state: str(st.Status),
    status: str(st.Status),
    createdAt: isoTime(o.Created),
    startedAt: isoTime(st.StartedAt),
    podId: str(o.Pod) || null,
    podName: str(o.PodName) || null,
  };
}

export const MAX_POD_LOG_CONTAINERS = 50;
const STORAGE_TTL_MS = 60_000;
const STORAGE_TIMEOUT_MS = 30_000;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** Maps the libpod `system/df` report (verified with Podman 4.9.3 and 5.8.2; sums match `podman system df`). */
export function mapStorage(raw: unknown, now: Date = new Date()): StorageInfo {
  const o = rec(raw);
  const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);
  const imgs = list(o.Images);
  const ctrs = list(o.Containers);
  const vols = list(o.Volumes);
  const unusedImgs = imgs.filter((i) => num(i.Containers) === 0);
  // ImagesSize counts shared layers once; fall back to the sum of the unique parts plus the shared base.
  const imagesSize = num(o.ImagesSize) || imgs.reduce((a, i) => a + num(i.UniqueSize), 0) + imgs.reduce((m, i) => Math.max(m, num(i.SharedSize)), 0);
  const running = ctrs.filter((c) => str(c.Status).toLowerCase() === "running");
  const containersSize = ctrs.reduce((a, c) => a + num(c.RWSize), 0);
  const volumesSize = vols.reduce((a, v) => a + num(v.Size), 0);
  return {
    images: { count: imgs.length, unused: unusedImgs.length, size: imagesSize, reclaimable: unusedImgs.reduce((a, i) => a + num(i.UniqueSize), 0) },
    containers: { count: ctrs.length, running: running.length, size: containersSize, reclaimable: ctrs.filter((c) => !running.includes(c)).reduce((a, c) => a + num(c.RWSize), 0) },
    volumes: { count: vols.length, size: volumesSize, reclaimable: vols.reduce((a, v) => a + num(v.ReclaimableSize), 0) },
    total: imagesSize + containersSize + volumesSize,
    measuredAt: now.toISOString(),
  };
}

/** Merges per-container log lines by time (stable; lines without timestamp stay behind their predecessor). */
export function mergeLogs(sources: { name: string; lines: LogLine[] }[], tail: number): LogLine[] {
  const all: { t: number; order: number; line: LogLine }[] = [];
  let order = 0;
  for (const src of sources) {
    let last = 0;
    for (const l of src.lines) {
      const t = l.ts ? Date.parse(l.ts) : NaN;
      if (!Number.isNaN(t)) last = t;
      all.push({ t: last, order: order++, line: { ...l, container: src.name } });
    }
  }
  all.sort((a, b) => a.t - b.t || a.order - b.order);
  return all.slice(-tail).map((x) => x.line);
}

export interface PodmanVersion {
  version: string | null;
  apiVersion: string | null;
}

/** Used when a Podman does not announce its libpod API version. */
export const FALLBACK_API_VERSION = "4.0.0";

export function mapImage(raw: unknown, inUse: number, isProtected: boolean): ImageInfo {
  const o = rec(raw);
  const tags = (Array.isArray(o.RepoTags) ? o.RepoTags : []).filter((t): t is string => typeof t === "string" && t !== "" && !t.startsWith("<none>"));
  return {
    id: str(o.Id).replace(/^sha256:/, ""),
    tags,
    size: num(o.Size),
    createdAt: isoTime(o.Created),
    containers: inUse,
    dangling: tags.length === 0,
    protected: isProtected,
  };
}

export class PodmanService {
  /** returns ids of images that must not be deleted (own image, image of the updatable unit) */
  imageGuard: () => Promise<string[]> = async () => [];

  /**
   * Podman serves most libpod routes only with a version prefix (/v4.9.3/libpod/...);
   * unversioned paths answer 404. The prefix is taken from the ping header Libpod-Api-Version.
   */
  private base: string | null = null;

  constructor(
    private readonly client: PodmanClient,
    private readonly stopTimeoutSec: number,
  ) {}

  /** Socket exists, API answers _ping (unversioned by design). Learns the libpod API version. */
  async ping(): Promise<void> {
    await this.client.checkSocket();
    const res = await this.client.call("GET", "/libpod/_ping");
    if (res.status !== 200) {
      throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    }
    const h = res.headers["libpod-api-version"];
    const v = Array.isArray(h) ? h[0] : h;
    this.base = `/v${typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v : FALLBACK_API_VERSION}`;
  }

  /** "/v<libpod api version>/libpod" */
  private async libpod(): Promise<string> {
    if (this.base === null) await this.ping();
    return `${this.base ?? `/v${FALLBACK_API_VERSION}`}/libpod`;
  }

  async version(): Promise<PodmanVersion> {
    const res = await this.client.call("GET", `${await this.libpod()}/version`);
    if (res.status !== 200) {
      throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    }
    const o = rec(json(res));
    const v = o.Version;
    const version = typeof v === "string" ? v : str(rec(v).Version) || null;
    return { version: version || null, apiVersion: str(o.ApiVersion) || str(o.APIVersion) || null };
  }

  async list(): Promise<ContainerInfo[]> {
    await this.client.checkSocket();
    const res = await this.client.call("GET", `${await this.libpod()}/containers/json?all=true`);
    if (res.status !== 200) {
      throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    }
    const arr = json(res);
    return Array.isArray(arr) ? arr.map(mapListItem) : [];
  }

  async inspect(id: string): Promise<ContainerInfo> {
    this.assertId(id);
    await this.client.checkSocket();
    const res = await this.client.call("GET", `${await this.libpod()}/containers/${id}/json`);
    if (res.status === 404) throw new PodmanError("CONTAINER_NOT_FOUND", "Container not found", 404);
    if (res.status !== 200) {
      throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    }
    return mapInspect(json(res));
  }

  /** Last `tail` lines (stdout and stderr, with timestamps). `tail` must be validated by the caller. */
  async logs(id: string, tail: number): Promise<LogLine[]> {
    this.assertId(id);
    await this.client.checkSocket();
    const lp = await this.libpod();
    let res: PodmanResponse;
    try {
      res = await this.client.call("GET", `${lp}/containers/${id}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`, { maxBytes: 4 * 1024 * 1024 });
    } catch (e) {
      if (e instanceof PodmanError && e.message === TOO_LARGE_MESSAGE) throw new PodmanError("LOGS_TOO_LARGE", "Log output too large", e.upstreamStatus);
      throw e;
    }
    if (res.status === 404) throw new PodmanError("CONTAINER_NOT_FOUND", "Container not found", 404);
    if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    return parseLogStream(res.body, tail);
  }

  async act(id: string, action: ContainerAction): Promise<{ changed: boolean; container: ContainerInfo }> {
    this.assertId(id);
    await this.client.checkSocket();
    const t = this.stopTimeoutSec;
    const lp = await this.libpod();
    const path =
      action === "start"
        ? `${lp}/containers/${id}/start`
        : action === "stop"
          ? `${lp}/containers/${id}/stop?timeout=${t}`
          : `${lp}/containers/${id}/restart?t=${t}`;
    const res = await this.client.call("POST", path);
    if (res.status === 404) throw new PodmanError("CONTAINER_NOT_FOUND", "Container not found", 404);
    if (res.status !== 204 && res.status !== 304) {
      throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    }
    return { changed: res.status === 204, container: await this.inspect(id) };
  }

  private storageCache: { at: number; value: StorageInfo } | null = null;
  private storagePending: Promise<StorageInfo> | null = null;

  /** `podman system df` can be slow with many images: cached for a minute, concurrent calls share one query. */
  async storage(): Promise<StorageInfo> {
    const now = Date.now();
    if (this.storageCache && now - this.storageCache.at < STORAGE_TTL_MS) return this.storageCache.value;
    if (!this.storagePending) {
      this.storagePending = (async () => {
        try {
          await this.client.checkSocket();
          const res = await this.client.call("GET", `${await this.libpod()}/system/df`, { timeoutMs: STORAGE_TIMEOUT_MS });
          if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
          const value = mapStorage(json(res));
          this.storageCache = { at: Date.now(), value };
          return value;
        } finally {
          this.storagePending = null;
        }
      })();
    }
    return this.storagePending;
  }

  /** Selected fields of the raw container inspect, for the agent's own update check. */
  async inspectSelf(id: string): Promise<{ imageName: string; imageId: string; labels: Record<string, string> }> {
    this.assertId(id);
    await this.client.checkSocket();
    const res = await this.client.call("GET", `${await this.libpod()}/containers/${id}/json`);
    if (res.status === 404) throw new PodmanError("CONTAINER_NOT_FOUND", "Container not found", 404);
    if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    const o = rec(json(res));
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec(rec(o.Config).Labels))) if (typeof v === "string") labels[k] = v;
    return { imageName: str(o.ImageName), imageId: str(o.Image), labels };
  }

  /** The container started by the given systemd unit (label PODMAN_SYSTEMD_UNIT), with image name/id; null if none exists. */
  async findUnitContainer(unit: string): Promise<{ id: string; imageName: string; imageId: string } | null> {
    if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(unit)) return null;
    await this.client.checkSocket();
    const filters = encodeURIComponent(JSON.stringify({ label: [`PODMAN_SYSTEMD_UNIT=${unit}.service`] }));
    const res = await this.client.call("GET", `${await this.libpod()}/containers/json?all=true&filters=${filters}`);
    if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    const arr = json(res);
    const first = Array.isArray(arr) ? rec(arr[0]) : {};
    const id = str(first.Id);
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    const s = await this.inspectSelf(id);
    return { id, imageName: s.imageName, imageId: s.imageId };
  }

  private hostNameCache: { at: number; value: string | undefined } | null = null;

  /** The real host name as Podman reports it (cached for 10 minutes); undefined if it cannot be read. */
  async hostName(): Promise<string | undefined> {
    if (this.hostNameCache && Date.now() - this.hostNameCache.at < 600_000) return this.hostNameCache.value;
    await this.client.checkSocket();
    const res = await this.client.call("GET", `${await this.libpod()}/info`);
    let value: string | undefined;
    if (res.status === 200) {
      const h = rec(rec(json(res)).host).hostname;
      if (typeof h === "string" && /^[A-Za-z0-9._-]{1,253}$/.test(h)) value = h;
    }
    this.hostNameCache = { at: Date.now(), value };
    return value;
  }

  /** Counts of containers per image id (all containers, running or not). */
  private async imageUsage(): Promise<Map<string, number>> {
    const res = await this.client.call("GET", `${await this.libpod()}/containers/json?all=true`);
    if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    const m = new Map<string, number>();
    const arr = json(res);
    if (Array.isArray(arr)) for (const c of arr) {
      const id = str(rec(c).ImageID).replace(/^sha256:/, "");
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }

  async listImages(): Promise<ImageInfo[]> {
    await this.client.checkSocket();
    const res = await this.client.call("GET", `${await this.libpod()}/images/json`);
    if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    const [usage, guard] = await Promise.all([this.imageUsage(), this.imageGuard().catch(() => [] as string[])]);
    const arr = json(res);
    const out = (Array.isArray(arr) ? arr : []).map((r) => {
      const id = str(rec(r).Id).replace(/^sha256:/, "");
      return mapImage(r, usage.get(id) ?? 0, guard.includes(id));
    });
    return out.sort((a, b) => (a.tags[0] ?? "~").localeCompare(b.tags[0] ?? "~"));
  }

  /**
   * Removes an image, or only one tag of it (`tag` given and the image has other tags). Refuses images that are in use
   * (409 IMAGE_IN_USE) and the protected ones (409 IMAGE_PROTECTED); never forces.
   */
  async deleteImage(id: string, tag?: string): Promise<ImageDeleteResult> {
    if (!isValidContainerId(id)) throw new PodmanError("IMAGE_NOT_FOUND", "Image not found", 404);
    if (tag !== undefined && !/^[A-Za-z0-9._\-/:@]{1,255}$/.test(tag)) throw new PodmanError("INVALID_PARAM", "Invalid tag", 400);
    const img = (await this.listImages()).find((i) => i.id === id || (id.length < 64 && i.id.startsWith(id)));
    if (!img) throw new PodmanError("IMAGE_NOT_FOUND", "Image not found", 404);
    if (tag !== undefined && !img.tags.includes(tag)) throw new PodmanError("IMAGE_NOT_FOUND", "Tag not found on this image", 404);
    if (img.protected) throw new PodmanError("IMAGE_PROTECTED", "Image is used by the agent or by the unit it updates", 409);
    const untag = tag !== undefined && img.tags.length > 1;
    if (!untag && img.containers > 0) throw new PodmanError("IMAGE_IN_USE", `Image is used by ${img.containers} container(s)`, 409);
    const ref = untag ? tag! : img.id;
    const res = await this.client.call("DELETE", `${await this.libpod()}/images/${encodeURIComponent(ref).replace(/%2F/g, "/")}?force=false`);
    if (res.status === 404) throw new PodmanError("IMAGE_NOT_FOUND", "Image not found", 404);
    if (res.status === 409) throw new PodmanError("IMAGE_IN_USE", upstreamMessage(res), 409);
    if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    return { result: untag ? "untagged" : "removed" };
  }

  /** Removes dangling images that no container uses. */
  async pruneImages(): Promise<ImagePruneResult> {
    await this.client.checkSocket();
    const filters = encodeURIComponent(JSON.stringify({ dangling: ["true"] }));
    const res = await this.client.call("POST", `${await this.libpod()}/images/prune?all=false&filters=${filters}`, { timeoutMs: 120_000 });
    if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    const arr = json(res);
    let removed = 0;
    let reclaimed = 0;
    if (Array.isArray(arr)) for (const r of arr) {
      const o = rec(r);
      if (o.Err) continue;
      removed++;
      reclaimed += num(o.Size);
    }
    return { removed, reclaimed };
  }

  /** Pulls an image (the registry is reached by the host's Podman) and returns its image id. */
  async pullImage(reference: string, timeoutMs: number): Promise<string> {
    if (!/^[A-Za-z0-9._\-/:@]{1,255}$/.test(reference)) throw new PodmanError("PODMAN_API_ERROR", "Invalid image reference");
    await this.client.checkSocket();
    const res = await this.client.call("POST", `${await this.libpod()}/images/pull?reference=${encodeURIComponent(reference)}&quiet=true`, { timeoutMs, maxBytes: 1024 * 1024 });
    if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    // Podman reports a failed pull inside a 200 response: {"error":"..."}
    const lines = res.body.toString("utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "");
    let id = "";
    for (const l of lines) {
      let o: Rec;
      try {
        o = rec(JSON.parse(l));
      } catch {
        continue;
      }
      if (typeof o.error === "string" && o.error) throw new PodmanError("PODMAN_API_ERROR", o.error.slice(0, 300));
      if (typeof o.id === "string" && o.id) id = o.id;
    }
    if (!id) throw new PodmanError("PODMAN_API_ERROR", "Podman did not report an image id");
    return id;
  }

  async listPods(): Promise<PodInfo[]> {
    await this.client.checkSocket();
    const res = await this.client.call("GET", `${await this.libpod()}/pods/json`);
    if (res.status !== 200) throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    const arr = json(res);
    return Array.isArray(arr) ? arr.map(mapPod) : [];
  }

  /** Found by id prefix (12-64 hex chars) in the pod list. */
  async pod(id: string): Promise<PodInfo> {
    this.assertId(id);
    const p = (await this.listPods()).find((x) => x.id === id || (id.length < 64 && x.id.startsWith(id)));
    if (!p) throw new PodmanError("POD_NOT_FOUND", "Pod not found", 404);
    return p;
  }

  /**
   * Logs of all (non-infra) containers of a pod, merged by timestamp; podman has no pod-logs API route
   * (`podman pod logs` merges on the client). Containers whose logs cannot be read are reported in `skipped`.
   */
  async podLogs(id: string, tail: number): Promise<PodLogs> {
    const pod = await this.pod(id);
    const members = pod.containers.filter((c) => !c.infra).slice(0, MAX_POD_LOG_CONTAINERS);
    const results = await Promise.all(
      members.map(async (c) => {
        try {
          return { c, lines: await this.logs(c.id, tail), err: null as PodmanError | null };
        } catch (e) {
          if (e instanceof PodmanError && e.code !== "SOCKET_MISSING" && e.code !== "SOCKET_UNREACHABLE" && e.code !== "PODMAN_TIMEOUT") return { c, lines: [] as LogLine[], err: e };
          throw e;
        }
      }),
    );
    const failed = results.filter((r) => r.err);
    if (members.length > 0 && failed.length === members.length) throw failed[0]!.err!;
    return { tail, lines: mergeLogs(results.map((r) => ({ name: r.c.name || r.c.id.slice(0, 12), lines: r.lines })), tail), skipped: failed.map((r) => r.c.name || r.c.id.slice(0, 12)) };
  }

  async podAct(id: string, action: ContainerAction): Promise<{ changed: boolean; pod: PodInfo }> {
    const pod = await this.pod(id); // also resolves a short id to the full id
    const t = this.stopTimeoutSec;
    const lp = await this.libpod();
    const path =
      action === "start"
        ? `${lp}/pods/${pod.id}/start`
        : action === "stop"
          ? `${lp}/pods/${pod.id}/stop?t=${t}`
          : `${lp}/pods/${pod.id}/restart`;
    const res = await this.client.call("POST", path);
    if (res.status === 404) throw new PodmanError("POD_NOT_FOUND", "Pod not found", 404);
    if (res.status !== 200 && res.status !== 204 && res.status !== 304) {
      throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    }
    return { changed: res.status !== 304, pod: await this.pod(pod.id) };
  }

  private assertId(id: string): void {
    if (!isValidContainerId(id)) throw new Error("invalid container id");
  }
}
