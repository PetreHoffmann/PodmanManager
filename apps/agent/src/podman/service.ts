import type { ContainerAction, ContainerInfo, LogLine, PodInfo, PodLogs } from "../../../../shared/types/index.js";
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

export class PodmanService {
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
