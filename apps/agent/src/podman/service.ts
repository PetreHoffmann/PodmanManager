import type { ContainerAction, ContainerInfo } from "../../../../shared/types/index.js";
import { PodmanClient, PodmanError, type PodmanResponse } from "./client.js";

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

export class PodmanService {
  constructor(
    private readonly client: PodmanClient,
    private readonly stopTimeoutSec: number,
  ) {}

  /** Socket exists, API answers _ping. Throws PodmanError otherwise. */
  async ping(): Promise<void> {
    await this.client.checkSocket();
    const res = await this.client.call("GET", "/libpod/_ping");
    if (res.status !== 200) {
      throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    }
  }

  async version(): Promise<PodmanVersion> {
    const res = await this.client.call("GET", "/libpod/version");
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
    const res = await this.client.call("GET", "/libpod/containers/json?all=true");
    if (res.status !== 200) {
      throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    }
    const arr = json(res);
    return Array.isArray(arr) ? arr.map(mapListItem) : [];
  }

  async inspect(id: string): Promise<ContainerInfo> {
    this.assertId(id);
    await this.client.checkSocket();
    const res = await this.client.call("GET", `/libpod/containers/${id}/json`);
    if (res.status === 404) throw new PodmanError("CONTAINER_NOT_FOUND", "Container not found", 404);
    if (res.status !== 200) {
      throw new PodmanError("PODMAN_API_ERROR", upstreamMessage(res), res.status);
    }
    return mapInspect(json(res));
  }

  async act(id: string, action: ContainerAction): Promise<{ changed: boolean; container: ContainerInfo }> {
    this.assertId(id);
    await this.client.checkSocket();
    const t = this.stopTimeoutSec;
    const path =
      action === "start"
        ? `/libpod/containers/${id}/start`
        : action === "stop"
          ? `/libpod/containers/${id}/stop?timeout=${t}`
          : `/libpod/containers/${id}/restart?t=${t}`;
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
