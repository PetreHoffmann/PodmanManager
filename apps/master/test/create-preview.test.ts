import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateRequest } from "@agent/podman/create";
import { podCreateCommand, podmanRunCommand, podQuadletFile, quadletFile, shq } from "../src/lib/create-preview";

const base: CreateRequest = { name: "web", image: "docker.io/library/nginx:latest", ports: [], env: [], volumes: [], network: null, pod: null, restart: "no", memoryMb: null, command: [] };
const full: CreateRequest = {
  ...base, ports: [{ host: 8081, container: 80, protocol: "tcp" }, { host: 53, container: 53, protocol: "udp" }], env: [{ key: "A", value: "b c" }, { key: "Q", value: "it's" }],
  volumes: [{ name: "data", path: "/data", readOnly: true }], network: "appnet", restart: "unless-stopped", memoryMb: 256, command: ["nginx", "-g", "daemon off;"],
};

describe("create previews", () => {
  it("quotes for the shell", () => {
    assert.equal(shq("abc"), "abc");
    assert.equal(shq("b c"), "'b c'");
    assert.equal(shq("it's"), `'it'\\''s'`);
    assert.equal(shq(""), "''");
  });
  it("minimal podman run", () => {
    assert.equal(podmanRunCommand(base), "podman run -d --name web \\\n  docker.io/library/nginx:latest");
  });
  it("full podman run", () => {
    assert.equal(podmanRunCommand(full), [
      "podman run -d --name web", "-p 8081:80", "-p 53:53/udp", "-e 'A=b c'", `-e 'Q=it'\\''s'`, "-v data:/data:ro", "--network appnet", "--restart=unless-stopped", "--memory=256m",
      "docker.io/library/nginx:latest nginx -g 'daemon off;'",
    ].join(" \\\n  "));
  });
  it("on-failure gets a retry limit like the created container", () => {
    assert.match(podmanRunCommand({ ...base, restart: "on-failure" }), /--restart=on-failure:5/);
  });
  it("quadlet maps the restart policy", () => {
    assert.doesNotMatch(quadletFile(base), /Restart=/);
    assert.match(quadletFile({ ...base, restart: "always" }), /\[Service\]\nRestart=always/);
    assert.match(quadletFile({ ...base, restart: "unless-stopped" }), /Restart=always/);
    assert.match(quadletFile({ ...base, restart: "on-failure" }), /Restart=on-failure/);
  });
  it("full quadlet", () => {
    const q = quadletFile(full);
    for (const l of ["ContainerName=web", "PublishPort=8081:80", "PublishPort=53:53/udp", 'Environment="A=b c"', "Volume=data:/data:ro", "Network=appnet", "PodmanArgs=--memory=256m", 'Exec=nginx -g "daemon off;"', "WantedBy=default.target"]) assert.ok(q.includes(l), l);
  });
  it("escapes % for systemd", () => {
    assert.match(quadletFile({ ...base, env: [{ key: "P", value: "100%" }] }), /Environment="P=100%%"/);
  });
});

describe("pod previews", () => {
  const pod = { name: "app", ports: [{ host: 8080, container: 80, protocol: "tcp" as const }], network: "appnet", hostname: "app1" };
  it("podman pod create", () => {
    assert.equal(podCreateCommand(pod), "podman pod create --name app \\\n  --hostname app1 \\\n  -p 8080:80 \\\n  --network appnet");
    assert.equal(podCreateCommand({ name: "app", ports: [], network: null, hostname: null }), "podman pod create --name app");
  });
  it("quadlet .pod file", () => {
    const q = podQuadletFile(pod);
    for (const l of ["[Pod]", "PodName=app", "HostName=app1", "PublishPort=8080:80", "Network=appnet", "WantedBy=default.target"]) assert.ok(q.includes(l), l);
  });
  it("a container in a pod refers to it", () => {
    assert.match(podmanRunCommand({ ...base, pod: "app" }), /--pod app/);
    assert.match(quadletFile({ ...base, pod: "app" }), /Pod=app\.pod/);
  });
});
