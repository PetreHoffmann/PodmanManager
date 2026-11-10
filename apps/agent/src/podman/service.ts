import type { ContainerAction, ContainerInfo, LogLine } from "../../../../shared/types/index.js";
import { PodmanClient, PodmanError, TOO_LARGE_MESSAGE, type PodmanResponse } from "./client.js";
import { parseLogStream } from "./logs.js";

export const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/;

export function isValidContainerId(id: string): boolean {
  return CONTAINER_ID_RE.test(id);
}

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
    const m = typeof o.message === "string" ? o.message : typeof o.cause === "string" ? o.cause : "";
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
  };
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

  private assertId(id: string): void {
    if (!isValidContainerId(id)) throw new Error("invalid container id");
  }
}
