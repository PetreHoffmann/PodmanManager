import type { CreatePodRequest, CreateRequest } from "@agent/podman/create";

/** Text previews of a container request: the equivalent `podman run` command and a Quadlet `.container` file. Pure text, nothing is executed. */

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
/** POSIX shell quoting: plain words stay as they are, everything else goes into single quotes. */
export const shq = (s: string): string => (s !== "" && SAFE.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** systemd quoting for Exec= / Environment= words: double quotes with \ and " escaped, % doubled. */
const sdq = (s: string): string => {
  const esc = s.replace(/%/g, "%%");
  return /^[A-Za-z0-9_@+=:,./-]+$/.test(esc) ? esc : `"${esc.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};

const portStr = (p: CreateRequest["ports"][number]) => `${p.host}:${p.container}${p.protocol === "udp" ? "/udp" : ""}`;
const volStr = (v: CreateRequest["volumes"][number]) => `${v.name}:${v.path}${v.readOnly ? ":ro" : ""}`;

export function podmanRunCommand(r: CreateRequest): string {
  const lines = [`podman run -d --name ${shq(r.name)}`];
  if (r.pod) lines.push(`--pod ${shq(r.pod)}`);
  for (const p of r.ports) lines.push(`-p ${portStr(p)}`);
  for (const e of r.env) lines.push(`-e ${shq(`${e.key}=${e.value}`)}`);
  for (const v of r.volumes) lines.push(`-v ${shq(volStr(v))}`);
  if (r.network) lines.push(`--network ${shq(r.network)}`);
  if (r.restart === "on-failure") lines.push("--restart=on-failure:5");
  else if (r.restart !== "no") lines.push(`--restart=${r.restart}`);
  if (r.memoryMb) lines.push(`--memory=${r.memoryMb}m`);
  lines.push([shq(r.image), ...r.command.map(shq)].join(" "));
  return lines.join(" \\\n  ");
}

export function quadletFile(r: CreateRequest): string {
  const c = ["[Container]", `ContainerName=${r.name}`, `Image=${r.image}`];
  if (r.pod) c.push(`Pod=${r.pod}.pod`);
  for (const p of r.ports) c.push(`PublishPort=${portStr(p)}`);
  for (const e of r.env) c.push(`Environment=${sdq(`${e.key}=${e.value}`)}`);
  for (const v of r.volumes) c.push(`Volume=${volStr(v)}`);
  if (r.network) c.push(`Network=${r.network}`);
  if (r.memoryMb) c.push(`PodmanArgs=--memory=${r.memoryMb}m`);
  if (r.command.length) c.push(`Exec=${r.command.map(sdq).join(" ")}`);
  const out = [`[Unit]`, `Description=${r.name}`, "", ...c, ""];
  // unless-stopped has no systemd equivalent: always is the closest
  const restart = r.restart === "unless-stopped" ? "always" : r.restart;
  if (restart !== "no") out.push("[Service]", `Restart=${restart}`, "");
  out.push("[Install]", "WantedBy=default.target", "");
  return out.join("\n");
}

export function podCreateCommand(r: CreatePodRequest): string {
  const lines = [`podman pod create --name ${shq(r.name)}`];
  if (r.hostname) lines.push(`--hostname ${shq(r.hostname)}`);
  for (const p of r.ports) lines.push(`-p ${portStr(p)}`);
  if (r.network) lines.push(`--network ${shq(r.network)}`);
  return lines.join(" \\\n  ");
}

/** Quadlet `.pod` file; containers join it with `Pod=<name>.pod` in their `.container` file. */
export function podQuadletFile(r: CreatePodRequest): string {
  const l = ["[Pod]", `PodName=${r.name}`];
  if (r.hostname) l.push(`HostName=${r.hostname}`);
  for (const p of r.ports) l.push(`PublishPort=${portStr(p)}`);
  if (r.network) l.push(`Network=${r.network}`);
  return [...l, "", "[Install]", "WantedBy=default.target", ""].join("\n");
}

const yq = (s: string): string => (/^[A-Za-z0-9/][A-Za-z0-9_./:-]*$/.test(s) && !/^(true|false|yes|no|null|on|off|~)$/i.test(s) && !/^[0-9.]+$/.test(s) ? s : JSON.stringify(s));

/** Kubernetes YAML for `podman kube play`: one pod with this container (the pod name if the container joins a pod). */
export function kubeYaml(r: CreateRequest): string {
  const restart = { no: "Never", always: "Always", "unless-stopped": "Always", "on-failure": "OnFailure" }[r.restart];
  const l = ["apiVersion: v1", "kind: Pod", "metadata:", `  name: ${yq(r.pod ?? r.name)}`, "spec:", `  restartPolicy: ${restart}`, "  containers:", `    - name: ${yq(r.name)}`, `      image: ${yq(r.image)}`];
  if (r.command.length) l.push("      args:", ...r.command.map((a) => `        - ${yq(a)}`));
  if (r.env.length) l.push("      env:", ...r.env.flatMap((e) => [`        - name: ${yq(e.key)}`, `          value: ${JSON.stringify(e.value)}`]));
  if (r.ports.length) l.push("      ports:", ...r.ports.flatMap((p) => [`        - containerPort: ${p.container}`, `          hostPort: ${p.host}`, `          protocol: ${p.protocol === "udp" ? "UDP" : "TCP"}`]));
  if (r.volumes.length) l.push("      volumeMounts:", ...r.volumes.flatMap((v) => [`        - name: ${yq(v.name)}`, `          mountPath: ${yq(v.path)}`, ...(v.readOnly ? ["          readOnly: true"] : [])]));
  if (r.memoryMb) l.push("      resources:", "        limits:", `          memory: ${r.memoryMb}Mi`);
  if (r.volumes.length) l.push("  volumes:", ...[...new Set(r.volumes.map((v) => v.name))].flatMap((n) => [`    - name: ${yq(n)}`, "      persistentVolumeClaim:", `        claimName: ${yq(n)}`]));
  return l.join("\n") + "\n";
}

/** The network is not part of the YAML: `podman kube play` takes it as an option. */
export const kubePlayCommand = (r: CreateRequest): string => `podman kube play${r.network ? ` --network ${shq(r.network)}` : ""} ${shq(`${r.name}.yaml`)}`;
