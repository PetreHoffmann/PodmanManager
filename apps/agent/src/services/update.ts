import { readFileSync } from "node:fs";
import type { UpdateInfo, UpdateState } from "../../../../shared/types/index.js";
import type { PodmanService } from "../podman/service.js";

const SYSTEMD_LABEL = "PODMAN_SYSTEMD_UNIT";

/** Id of the container this process runs in: Podman bind-mounts /etc/hosts etc. from `.../overlay-containers/<id>/userdata/`. */
export function containerIdFromMountinfo(text: string): string | null {
  const count = new Map<string, number>();
  for (const m of text.matchAll(/\/overlay-containers\/([a-f0-9]{64})\/userdata\//g)) count.set(m[1]!, (count.get(m[1]!) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [id, c] of count) {
    if (c > n) {
      best = id;
      n = c;
    }
  }
  return best;
}

/** A tag that moves with new releases (`latest`, `0`, `0.9`) can be updated by pulling it again; `0.9.2` or a digest cannot. */
export function classifyImage(imageName: string): { tag: string | null; floating: boolean } {
  if (!imageName || imageName.includes("@")) return { tag: null, floating: false };
  const last = imageName.slice(imageName.lastIndexOf("/") + 1);
  const i = last.lastIndexOf(":");
  const tag = i >= 0 ? last.slice(i + 1) : "latest"; // no tag means latest
  return { tag, floating: tag === "latest" || /^\d+(\.\d+)?$/.test(tag) };
}

export interface UpdaterOptions {
  /** reads /proc/self/mountinfo (replaceable for tests) */
  mountinfo?: () => string;
  /** called to restart: the process exits with a failure code so that systemd starts it again from the new image */
  exit?: (code: number) => void;
  exitDelayMs?: number;
  pullTimeoutMs?: number;
  log?: { info(m: string): void; error(m: string): void };
}

/**
 * Self-update of an agent that runs as a Quadlet/systemd container from a floating image tag: pull the same
 * image again and, if it changed, exit so that systemd (Restart=always) recreates the container from the new image.
 * Only the agent's own image reference is pulled, never a name supplied by a caller.
 */
export class SelfUpdater {
  private state: UpdateState = "idle";
  private message: string | undefined;
  private readonly o: Required<Omit<UpdaterOptions, "log">> & Pick<UpdaterOptions, "log">;

  constructor(private readonly podman: PodmanService, opts: UpdaterOptions = {}) {
    this.o = {
      mountinfo: opts.mountinfo ?? (() => readFileSync("/proc/self/mountinfo", "utf8")),
      exit: opts.exit ?? ((c) => process.exit(c)),
      exitDelayMs: opts.exitDelayMs ?? 1500,
      pullTimeoutMs: opts.pullTimeoutMs ?? 10 * 60 * 1000,
      log: opts.log,
    };
  }

  private async eligibility(): Promise<{ info: UpdateInfo; imageId?: string }> {
    let id: string | null = null;
    try {
      id = containerIdFromMountinfo(this.o.mountinfo());
    } catch {
      id = null;
    }
    const base = { state: this.state, ...(this.message ? { message: this.message } : {}) };
    if (!id) return { info: { possible: false, reason: "no_container", ...base } };
    let self: Awaited<ReturnType<PodmanService["inspectSelf"]>>;
    try {
      self = await this.podman.inspectSelf(id);
    } catch {
      return { info: { possible: false, reason: "inspect_failed", ...base } };
    }
    const { tag, floating } = classifyImage(self.imageName);
    const common = { image: self.imageName, ...(tag ? { tag } : {}), ...base };
    if (!floating) return { info: { possible: false, reason: "pinned_tag", ...common } };
    if (!self.labels[SYSTEMD_LABEL]) return { info: { possible: false, reason: "not_systemd", ...common } };
    return { info: { possible: true, ...common }, imageId: self.imageId };
  }

  async info(): Promise<UpdateInfo> {
    return (await this.eligibility()).info;
  }

  /** Id of the image this agent runs from (cannot be deleted); null outside a container. */
  async ownImageId(): Promise<string | null> {
    try {
      const id = containerIdFromMountinfo(this.o.mountinfo());
      return id ? (await this.podman.inspectSelf(id)).imageId.replace(/^sha256:/, "") : null;
    } catch {
      return null;
    }
  }

  /** Starts the update in the background; returns at once. An update that is already running is not started twice. */
  async start(): Promise<UpdateInfo> {
    const { info, imageId } = await this.eligibility();
    if (!info.possible || this.state === "pulling" || this.state === "restarting") return info;
    this.state = "pulling";
    this.message = undefined;
    this.o.log?.info(`update: pulling ${info.image}`);
    void this.run(info.image!, imageId ?? "");
    return { ...info, state: "pulling", message: undefined };
  }

  private async run(image: string, currentId: string): Promise<void> {
    try {
      const newId = await this.podman.pullImage(image, this.o.pullTimeoutMs);
      if (currentId && newId === currentId) {
        this.state = "current";
        this.message = "Already up to date";
        this.o.log?.info("update: the image is unchanged, nothing to do");
        return;
      }
      this.state = "restarting";
      this.o.log?.info(`update: new image ${newId.slice(0, 12)} (running ${currentId.slice(0, 12)}); restarting`);
      setTimeout(() => this.o.exit(1), this.o.exitDelayMs).unref?.();
    } catch (e) {
      this.state = "error";
      this.message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      this.o.log?.error(`update failed: ${this.message}`);
    }
  }
}

/**
 * Update of another Quadlet container on the same host (the master): pull its image again and, if it changed, stop the
 * container so that systemd (Restart=always) recreates it from the new image. Only the container of the configured
 * unit is touched; the image reference comes from that container, never from a caller.
 */
export class PeerUpdater {
  private state: UpdateState = "idle";
  private message: string | undefined;
  private readonly pullTimeoutMs: number;

  constructor(private readonly podman: PodmanService, private readonly unit: string, private readonly opts: { log?: UpdaterOptions["log"]; pullTimeoutMs?: number } = {}) {
    this.pullTimeoutMs = opts.pullTimeoutMs ?? 10 * 60 * 1000;
  }

  private async eligibility(): Promise<{ info: UpdateInfo; target?: { id: string; imageId: string } }> {
    const base = { state: this.state, ...(this.message ? { message: this.message } : {}) };
    let t: Awaited<ReturnType<PodmanService["findUnitContainer"]>>;
    try {
      t = await this.podman.findUnitContainer(this.unit);
    } catch {
      return { info: { possible: false, reason: "inspect_failed", ...base } };
    }
    if (!t) return { info: { possible: false, reason: "no_container", ...base } };
    const { tag, floating } = classifyImage(t.imageName);
    const common = { image: t.imageName, ...(tag ? { tag } : {}), ...base };
    if (!floating) return { info: { possible: false, reason: "pinned_tag", ...common } };
    return { info: { possible: true, ...common }, target: { id: t.id, imageId: t.imageId } };
  }

  async info(): Promise<UpdateInfo> {
    return (await this.eligibility()).info;
  }

  /** Id of the image of the unit's container (cannot be deleted). */
  async targetImageId(): Promise<string | null> {
    try {
      return (await this.podman.findUnitContainer(this.unit))?.imageId.replace(/^sha256:/, "") ?? null;
    } catch {
      return null;
    }
  }

  async start(): Promise<UpdateInfo> {
    const { info, target } = await this.eligibility();
    if (!info.possible || !target || this.state === "pulling" || this.state === "restarting") return info;
    this.state = "pulling";
    this.message = undefined;
    this.opts.log?.info(`update of unit ${this.unit}: pulling ${info.image}`);
    void this.run(info.image!, target);
    return { ...info, state: "pulling", message: undefined };
  }

  private async run(image: string, target: { id: string; imageId: string }): Promise<void> {
    try {
      const newId = await this.podman.pullImage(image, this.pullTimeoutMs);
      if (newId === target.imageId) {
        this.state = "current";
        this.message = "Already up to date";
        this.opts.log?.info(`update of unit ${this.unit}: image unchanged`);
        return;
      }
      this.state = "restarting";
      this.opts.log?.info(`update of unit ${this.unit}: new image ${newId.slice(0, 12)}; stopping the container so systemd recreates it`);
      await this.podman.act(target.id, "stop");
    } catch (e) {
      this.state = "error";
      this.message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      this.opts.log?.error(`update of unit ${this.unit} failed: ${this.message}`);
    }
  }
}
