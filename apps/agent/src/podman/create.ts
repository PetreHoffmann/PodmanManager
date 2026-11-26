/**
 * Creating a container: the master sends a small, strictly validated description; the agent builds the Podman
 * specification itself. Nothing of the request is passed through, and risky options (privileged, capabilities,
 * host paths, host namespaces) cannot be expressed at all.
 */
export type RestartPolicy = "no" | "always" | "unless-stopped" | "on-failure";

export interface CreateRequest {
  name: string;
  image: string;
  ports: { host: number; container: number; protocol: "tcp" | "udp" }[];
  env: { key: string; value: string }[];
  /** named volumes only (created by Podman if missing) */
  volumes: { name: string; path: string; readOnly: boolean }[];
  network: string | null;
  restart: RestartPolicy;
  memoryMb: number | null;
  command: string[];
}

export type ParsedCreate = { ok: true; req: CreateRequest } | { ok: false; message: string };

const ALLOWED_FIELDS = ["name", "image", "ports", "env", "volumes", "network", "restart", "memoryMb", "command"];
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]{0,254}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const RESOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PATH_RE = /^\/[A-Za-z0-9_.\-/]{0,254}$/;
const RESTART: readonly string[] = ["no", "always", "unless-stopped", "on-failure"];
const FORBIDDEN_NETWORKS = ["host", "none", "container", "private", "ns", "slirp4netns", "pasta", "bridge"];
const FORBIDDEN_DEST = ["/proc", "/sys", "/dev"];
const MAX_PORTS = 20, MAX_ENV = 50, MAX_VOLUMES = 20, MAX_ARGS = 20;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (message: string): ParsedCreate => ({ ok: false, message });
const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

export function parseCreateRequest(input: unknown): ParsedCreate {
  if (!isRec(input)) return fail("Request body must be an object");
  for (const k of Object.keys(input)) if (!ALLOWED_FIELDS.includes(k)) return fail(`Unknown field "${k.slice(0, 40)}"`);

  const name = input.name;
  if (typeof name !== "string" || !NAME_RE.test(name)) return fail("Invalid container name (A-Z a-z 0-9 . _ -, max 64, must start with a letter or digit)");
  const image = input.image;
  if (typeof image !== "string" || !IMAGE_RE.test(image)) return fail("Invalid image name");

  const ports: CreateRequest["ports"] = [];
  const rawPorts = input.ports ?? [];
  if (!Array.isArray(rawPorts) || rawPorts.length > MAX_PORTS) return fail(`At most ${MAX_PORTS} ports`);
  const seenPorts = new Set<string>();
  for (const p of rawPorts) {
    if (!isRec(p)) return fail("Invalid port entry");
    const host = int(p.host, 1, 65535), container = int(p.container, 1, 65535);
    const protocol = p.protocol ?? "tcp";
    if (host === null || container === null) return fail("Ports must be numbers from 1 to 65535");
    if (protocol !== "tcp" && protocol !== "udp") return fail("Port protocol must be tcp or udp");
    const key = `${protocol}/${host}`;
    if (seenPorts.has(key)) return fail(`Host port ${host}/${protocol} is used twice`);
    seenPorts.add(key);
    ports.push({ host, container, protocol });
  }

  const env: CreateRequest["env"] = [];
  const rawEnv = input.env ?? [];
  if (!Array.isArray(rawEnv) || rawEnv.length > MAX_ENV) return fail(`At most ${MAX_ENV} environment variables`);
  const seenEnv = new Set<string>();
  for (const e of rawEnv) {
    if (!isRec(e) || typeof e.key !== "string" || typeof e.value !== "string") return fail("Invalid environment entry");
    if (!ENV_KEY_RE.test(e.key)) return fail(`Invalid environment variable name "${e.key.slice(0, 40)}"`);
    if (e.value.length > 4096 || e.value.includes("\0")) return fail(`Value of ${e.key} is too long or contains a NUL character`);
    if (seenEnv.has(e.key)) return fail(`Environment variable ${e.key} is set twice`);
    seenEnv.add(e.key);
    env.push({ key: e.key, value: e.value });
  }

  const volumes: CreateRequest["volumes"] = [];
  const rawVol = input.volumes ?? [];
  if (!Array.isArray(rawVol) || rawVol.length > MAX_VOLUMES) return fail(`At most ${MAX_VOLUMES} volumes`);
  const seenDest = new Set<string>();
  for (const v of rawVol) {
    if (!isRec(v)) return fail("Invalid volume entry");
    const vname = v.name, vpath = v.path;
    if (typeof vname !== "string" || typeof vpath !== "string") return fail("Invalid volume entry");
    if (!RESOURCE_RE.test(vname)) return fail(`Invalid volume name "${vname.slice(0, 40)}": only named volumes are allowed, no host paths`);
    if (!PATH_RE.test(vpath) || vpath === "/" || vpath.split("/").includes("..")) return fail(`Invalid path in the container "${vpath.slice(0, 60)}"`);
    if (FORBIDDEN_DEST.some((d) => vpath === d || vpath.startsWith(`${d}/`))) return fail(`The path ${vpath} is not allowed`);
    if (seenDest.has(vpath)) return fail(`Path ${vpath} is used twice`);
    seenDest.add(vpath);
    volumes.push({ name: vname, path: vpath, readOnly: v.readOnly === true });
  }

  let network: string | null = null;
  if (input.network !== undefined && input.network !== null && input.network !== "") {
    if (typeof input.network !== "string" || !RESOURCE_RE.test(input.network) || FORBIDDEN_NETWORKS.includes(input.network)) return fail("Invalid network");
    network = input.network;
  }

  const restart = input.restart ?? "no";
  if (typeof restart !== "string" || !RESTART.includes(restart)) return fail("Invalid restart policy");

  let memoryMb: number | null = null;
  if (input.memoryMb !== undefined && input.memoryMb !== null) {
    memoryMb = int(input.memoryMb, 16, 1_048_576);
    if (memoryMb === null) return fail("Memory limit must be 16 to 1048576 MB");
  }

  const command: string[] = [];
  const rawCmd = input.command ?? [];
  if (!Array.isArray(rawCmd) || rawCmd.length > MAX_ARGS) return fail(`At most ${MAX_ARGS} command arguments`);
  for (const a of rawCmd) {
    if (typeof a !== "string" || a.length < 1 || a.length > 1024 || a.includes("\0")) return fail("Invalid command argument");
    command.push(a);
  }

  return { ok: true, req: { name, image, ports, env, volumes, network, restart: restart as RestartPolicy, memoryMb, command } };
}

/** The Podman (libpod) container specification, built only from validated fields. Hardening is fixed here. */
export function libpodSpec(req: CreateRequest): Record<string, unknown> {
  return {
    name: req.name,
    image: req.image,
    ...(req.command.length > 0 ? { command: req.command } : {}),
    ...(req.env.length > 0 ? { env: Object.fromEntries(req.env.map((e) => [e.key, e.value])) } : {}),
    ...(req.ports.length > 0 ? { portmappings: req.ports.map((p) => ({ container_port: p.container, host_port: p.host, protocol: p.protocol })) } : {}),
    ...(req.volumes.length > 0 ? { volumes: req.volumes.map((v) => ({ Name: v.name, Dest: v.path, Options: v.readOnly ? ["ro"] : [] })) } : {}),
    ...(req.network ? { netns: { nsmode: "bridge" }, Networks: { [req.network]: {} } } : {}),
    restart_policy: req.restart,
    ...(req.restart === "on-failure" ? { restart_tries: 5 } : {}),
    ...(req.memoryMb !== null ? { resource_limits: { memory: { limit: req.memoryMb * 1024 * 1024 } } } : {}),
    privileged: false,
    remove: false,
  };
}
