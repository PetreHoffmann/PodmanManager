import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import ldap from "ldapjs";
import { DEFAULT_FILTER, authenticateLdap, escapeFilterValue, testLdap, type LdapConfig } from "../src/lib/ldap";
import { parseLdapInput } from "../src/lib/ldap-config";

const BASE = "DC=ex,DC=com";
const GROUP = "CN=Grp Podman,OU=Groups,DC=ex,DC=com";
const users: Record<string, { dn: string; pw: string; member: boolean }> = {
  alice: { dn: "CN=Alice,OU=Users,DC=ex,DC=com", pw: "alicepw", member: true },
  bob: { dn: "CN=Bob,OU=Users,DC=ex,DC=com", pw: "bobpw", member: false },
};
const SVC = { dn: "CN=svc,DC=ex,DC=com", pw: "svcpw" };

describe("ldap against a protocol-level fake directory", () => {
  const binds: string[] = [];
  const searches: { base: string; filter: string }[] = [];
  let server: ReturnType<typeof ldap.createServer>;
  let cfg: LdapConfig;

  before(async () => {
    server = ldap.createServer();
    server.bind(BASE, (req: any, res: any, next: any) => {
      const dn = req.dn.toString();
      binds.push(dn);
      const u = Object.values(users).find((x) => x.dn.toLowerCase() === dn.toLowerCase());
      const ok = (u && u.pw === req.credentials) || (dn.toLowerCase() === SVC.dn.toLowerCase() && req.credentials === SVC.pw);
      if (!ok || !req.credentials) return next(new ldap.InvalidCredentialsError());
      res.end();
      return next();
    });
    server.search(BASE, (req: any, res: any, next: any) => {
      const base = req.dn.toString();
      const filter = req.filter.toString();
      searches.push({ base, filter });
      if (base.toLowerCase() === GROUP.toLowerCase()) {
        res.send({ dn: GROUP, attributes: { objectClass: "group" } });
      } else if (filter.includes("1.2.840.113556.1.4.1941")) {
        const u = Object.values(users).find((x) => x.dn.toLowerCase() === base.toLowerCase());
        if (u?.member && filter.includes("Grp Podman")) res.send({ dn: u.dn, attributes: {} });
      } else {
        const m = /sAMAccountName=([A-Za-z0-9]+)\)/.exec(filter);
        const u = m ? users[m[1]!.toLowerCase()] : undefined;
        if (u) res.send({ dn: u.dn, attributes: { sAMAccountName: m![1]!.toLowerCase() } });
      }
      res.end();
      return next();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = ((server as any).server.address() as AddressInfo).port;
    cfg = { enabled: true, url: `ldap://127.0.0.1:${port}`, startTls: false, caCert: "", bindDn: SVC.dn, bindPassword: SVC.pw, baseDn: BASE, filter: DEFAULT_FILTER, groupDn: GROUP };
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  it("accepts a member with the right password", async () => {
    const r = await authenticateLdap(cfg, "alice", "alicepw");
    assert.deepEqual(r, { ok: true, username: "alice", dn: users.alice!.dn });
  });

  it("rejects a wrong password", async () => {
    assert.deepEqual(await authenticateLdap(cfg, "alice", "nope"), { ok: false, reason: "invalid" });
  });

  it("rejects non-members without ever binding as that user", async () => {
    binds.length = 0;
    assert.deepEqual(await authenticateLdap(cfg, "bob", "bobpw"), { ok: false, reason: "not_member" });
    assert.ok(!binds.includes(users.bob!.dn));
  });

  it("rejects unknown users", async () => {
    assert.deepEqual(await authenticateLdap(cfg, "nobody", "x"), { ok: false, reason: "invalid" });
  });

  it("never performs a bind for an empty password (anonymous bind protection)", async () => {
    binds.length = 0;
    assert.deepEqual(await authenticateLdap(cfg, "alice", ""), { ok: false, reason: "invalid" });
    assert.equal(binds.length, 0);
  });

  it("escapes LDAP filter metacharacters in the username", async () => {
    searches.length = 0;
    const r = await authenticateLdap(cfg, "alice)(|(sAMAccountName=*", "x");
    assert.deepEqual(r, { ok: false, reason: "invalid" });
    const f = searches[0]!.filter;
    assert.ok(f.includes("\\29") && f.includes("\\2a"), f);
  });

  it("reports an unusable service account as unavailable", async () => {
    const r = await authenticateLdap({ ...cfg, bindPassword: "wrong" }, "alice", "alicepw");
    assert.deepEqual(r, { ok: false, reason: "unavailable", code: "LDAP_BIND" });
  });

  it("reports an unreachable server as unavailable", async () => {
    const r = await authenticateLdap({ ...cfg, url: "ldap://127.0.0.1:1" }, "alice", "alicepw");
    assert.equal(r.ok, false);
    assert.equal((r as { code?: string }).code, "LDAP_CONNECT");
  });

  it("does nothing when disabled", async () => {
    assert.deepEqual(await authenticateLdap({ ...cfg, enabled: false }, "alice", "alicepw"), { ok: false, reason: "disabled" });
  });

  it("diagnoses configuration without a password", async () => {
    assert.deepEqual(await testLdap(cfg, "alice"), [{ key: "conn", ok: true }, { key: "group", ok: true }, { key: "userOk", ok: true }]);
    assert.deepEqual((await testLdap(cfg, "bob")).at(-1), { key: "userNoMember", ok: false });
    assert.deepEqual((await testLdap(cfg, "zed")).at(-1), { key: "userNone", ok: false });
    assert.deepEqual((await testLdap({ ...cfg, groupDn: "CN=Missing,DC=ex,DC=com" }, "")).at(-1), { key: "groupMissing", ok: false });
  });
});

describe("ldap helpers", () => {
  it("escapes RFC 4515 characters", () => {
    assert.equal(escapeFilterValue("a*b(c)d\\e\0"), "a\\2ab\\28c\\29d\\5ce\\00");
  });

  const good = { enabled: true, url: "ldaps://dc.ex.com:636", startTls: true, caCert: "", bindDn: "CN=svc,DC=ex", bindPassword: "pw", baseDn: "DC=ex", filter: "", groupDn: "CN=G,DC=ex" };
  it("validates configuration input", () => {
    const ok = parseLdapInput(good, null);
    assert.ok(ok.ok && ok.config.filter === DEFAULT_FILTER && ok.config.startTls === false, "startTls only applies to ldap://");
    assert.equal(parseLdapInput({ ...good, url: "http://x" }, null).ok, false);
    assert.equal(parseLdapInput({ ...good, url: "ldaps://x/y" }, null).ok, false);
    assert.equal(parseLdapInput({ ...good, url: "ldaps://x:99999" }, null).ok, false);
    assert.equal(parseLdapInput({ ...good, filter: "(uid=bob)" }, null).ok, false);
    assert.equal(parseLdapInput({ ...good, filter: "uid={username}" }, null).ok, false);
    assert.equal(parseLdapInput({ ...good, caCert: "not a cert" }, null).ok, false);
    assert.equal(parseLdapInput({ ...good, groupDn: "" }, null).ok, false);
    assert.equal(parseLdapInput({ ...good, bindPassword: "" }, null).ok, false);
  });
  it("keeps the stored password when the field is left empty", () => {
    const r = parseLdapInput({ ...good, bindPassword: "" }, { ...(parseLdapInput(good, null) as { ok: true; config: LdapConfig }).config, bindPassword: "stored" });
    assert.ok(r.ok && r.config.bindPassword === "stored");
  });
});
