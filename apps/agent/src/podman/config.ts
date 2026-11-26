import type { CreateRequest, RestartPolicy } from "./create.js";

/**
 * Rebuilds the fields of the "create container" form from a libpod container inspect (and, if available, the image
 * inspect, so that settings that only come from the image are not listed as if the user had set them). Read-only text
 * for the preview tabs; options the form cannot express (bind mounts, capabilities, healthchecks, entrypoint ...) are
 * left out, bind mounts are only counted.
 */
export type ContainerConfig = CreateRequest & { bindMounts: number };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Variables Podman adds itself (it also passes the proxy variables of the host into every container). */
const AUTO_ENV = new Set(["container", "HOSTNAME", "HOME", "TERM", "http_proxy", "https_proxy", "ftp_proxy", "no_proxy", "HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "NO_PROXY"]);
const SPECIAL_NETWORKS = new Set(["host", "none", "bridge", "default", "podman", "private", "slirp4netns", "pasta"]);
const RESTART: readonly string[] = ["always", "unless-stopped", "on-failure"];

export function mapContainerConfig(raw: unknown, imageRaw?: unknown, podNameHint?: string): ContainerConfig {
  const o = rec(raw);
  const cfg = rec(o.Config);
  const host = rec(o.HostConfig);
  const imgCfg = rec(rec(imageRaw).Config);
  // Podman 5 inspect names the pod only by id (Pod), Podman 4 also by name (PodName)
  const podId = str(o.Pod);
  const pod = str(o.PodName) || podNameHint || (podId ? podId.slice(0, 12) : null);

  const imgEnv = new Set(strs(imgCfg.Env));
  const env: CreateRequest["env"] = [];
  for (const e of strs(cfg.Env)) {
    if (imgEnv.has(e)) continue;
    const i = e.indexOf("=");
    if (i < 1) continue;
    const key = e.slice(0, i);
    if (AUTO_ENV.has(key)) continue;
    env.push({ key, value: e.slice(i + 1) });
  }

  const ports: CreateRequest["ports"] = [];
  if (!pod) {
    for (const [k, v] of Object.entries(rec(host.PortBindings))) {
      const m = /^(\d{1,5})\/(tcp|udp)$/.exec(k);
      if (!m || !Array.isArray(v)) continue;
      for (const b of v) {
        const hp = Number(str(rec(b).HostPort));
        if (Number.isInteger(hp) && hp > 0) ports.push({ host: hp, container: Number(m[1]), protocol: m[2] as "tcp" | "udp" });
      }
    }
  }

  const volumes: CreateRequest["volumes"] = [];
  let bindMounts = 0;
  for (const m of Array.isArray(o.Mounts) ? o.Mounts : []) {
    const mm = rec(m);
    if (str(mm.Type) === "volume" && str(mm.Name) && str(mm.Destination)) volumes.push({ name: str(mm.Name), path: str(mm.Destination), readOnly: mm.RW === false });
    else if (str(mm.Type) === "bind") bindMounts++;
  }

  let network: string | null = null;
  if (!pod) {
    const names = Object.keys(rec(rec(o.NetworkSettings).Networks)).filter((n) => !SPECIAL_NETWORKS.has(n));
    if (names.length === 1) network = names[0]!;
  }

  const policy = str(rec(host.RestartPolicy).Name);
  const restart = (RESTART.includes(policy) ? policy : "no") as RestartPolicy;
  const mem = typeof host.Memory === "number" && host.Memory > 0 ? Math.round(host.Memory / 1_048_576) : 0;

  const cmd = strs(cfg.Cmd);
  const imgCmd = strs(imgCfg.Cmd);
  const sameAsImage = cmd.length === imgCmd.length && cmd.every((c, i) => c === imgCmd[i]);

  return {
    name: str(o.Name).replace(/^\//, ""),
    image: str(o.ImageName) || str(o.Image),
    ports, env, volumes, network, pod, restart,
    memoryMb: mem > 0 ? mem : null,
    command: sameAsImage ? [] : cmd,
    bindMounts,
  };
}
