import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { authenticateLdap, type ClientFactory, type LdapConfig, type LdapEntry } from "../src/lib/ldap";
import { EMPTY_LDAP, loadLdapConfig, parseLdapInput, saveLdapConfig } from "../src/lib/ldap-config";
import { AD_ATTRS, LDAP_PRESETS } from "../src/lib/ldap-presets";

process.env.MASTER_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");

const ADMINS = "cn=admins,ou=groups,dc=ex,dc=com";
const TEAM = "cn=team,ou=groups,dc=ex,dc=com";
const USER_DN = "uid=mmuster,ou=people,dc=ex,dc=com";
const base: LdapConfig = { ...EMPTY_LDAP, enabled: true, url: "ldaps://ldap.example", bindDn: "cn=svc,dc=ex,dc=com", bindPassword: "svc", baseDn: "dc=ex,dc=com", groupDn: ADMINS };

/** A directory double that records the searches; `answer` decides which of them find something. */
function directory(entry: Record<string, unknown>, answer: (base: string, filter: string) => boolean): { factory: ClientFactory; searches: { base: string; filter: string; attrs: string[] }[] } {
  const searches: { base: string; filter: string; attrs: string[] }[] = [];
  const factory: ClientFactory = () => ({
    async startTLS() {},
    async bind() {},
    async search(b, o): Promise<{ searchEntries: LdapEntry[] }> {
      searches.push({ base: b, filter: o.filter, attrs: o.attributes });
      if (b === "dc=ex,dc=com") return { searchEntries: [{ dn: USER_DN, ...entry }] };
      return { searchEntries: answer(b, o.filter) ? [{ dn: b }] : [] };
    },
    async unbind() {},
  });
  return { factory, searches };
}

describe("other directory servers: attributes and group checks", () => {
  it("reads the configured attributes, case-insensitively (servers return their own spelling)", async () => {
    const cfg = { ...base, ...LDAP_PRESETS.openldap };
    const { factory, searches } = directory({ UID: "mmuster", CN: "Max Muster" }, () => true);
    const r = await authenticateLdap(cfg, "mmuster@ex.com", "pw", [], factory);
    assert.ok(r.ok && r.username === "mmuster" && r.displayName === "Max Muster (mmuster)", JSON.stringify(r));
    assert.deepEqual(searches[0]!.attrs, ["dn", "uid", "cn"], "only the configured attributes are requested");
  });

  it("group mode with member / uniqueMember: the group entry is asked for the user DN", async () => {
    for (const attr of ["member", "uniqueMember"]) {
      const cfg = { ...base, ...LDAP_PRESETS.openldap, memberAttr: attr };
      const { factory, searches } = directory({ uid: "mmuster" }, (b, f) => b === ADMINS && f === `(${attr}=${USER_DN})`);
      const r = await authenticateLdap(cfg, "mmuster", "pw", [], factory);
      assert.ok(r.ok && r.admin, attr);
      assert.ok(searches.some((s) => s.base === ADMINS && s.filter === `(${attr}=${USER_DN})`), attr);
    }
  });

  it("group mode with memberUid: the group entry is asked for the account name (not the DN)", async () => {
    const cfg = { ...base, ...LDAP_PRESETS.openldapPosix };
    const { factory } = directory({ uid: "mmuster", cn: "Max Muster" }, (b, f) => b === ADMINS && f === "(memberUid=mmuster)");
    const r = await authenticateLdap(cfg, "mmuster", "pw", [], factory);
    assert.ok(r.ok && r.admin);
  });

  it("user mode: the user entry is asked whether it lists the group (memberOf, isMemberOf)", async () => {
    for (const attr of ["memberOf", "isMemberOf"]) {
      const cfg = { ...base, ...LDAP_PRESETS.openldapMemberOf, memberAttr: attr };
      const { factory, searches } = directory({ uid: "mmuster" }, (b, f) => b === USER_DN && f === `(${attr}=${TEAM})`);
      const r = await authenticateLdap(cfg, "mmuster", "pw", [{ id: 5, name: "Team", dn: TEAM }], factory);
      assert.ok(r.ok && !r.admin && r.groupIds.length === 1 && r.groupIds[0] === 5, attr);
      assert.ok(searches.some((s) => s.base === USER_DN && s.filter === `(${attr}=${TEAM})`), attr);
    }
  });

  it("Active Directory mode is unchanged (matching rule in chain on the user entry)", async () => {
    const { factory, searches } = directory({ sAMAccountName: "mmuster", displayName: "Max Muster" }, (b, f) => b === USER_DN && f.includes("1.2.840.113556.1.4.1941:=" + ADMINS));
    const r = await authenticateLdap({ ...base, ...AD_ATTRS }, "mmuster", "pw", [], factory);
    assert.ok(r.ok && r.admin && r.displayName === "Max Muster (mmuster)");
    assert.ok(searches.some((s) => s.filter.includes("memberOf:1.2.840.113556.1.4.1941:=")));
  });

  it("a user who is in no mapped group is turned away in every mode, and filter characters in DNs are escaped", async () => {
    for (const p of ["openldap", "openldapMemberOf", "openldapPosix"] as const) {
      const { factory } = directory({ uid: "mmuster" }, () => false);
      const r = await authenticateLdap({ ...base, ...LDAP_PRESETS[p] }, "mmuster", "pw", [{ id: 1, name: "T", dn: "cn=a(b)*,dc=ex" }], factory);
      assert.ok(!r.ok && r.reason === "not_member", p);
    }
    const { factory, searches } = directory({ uid: "u" }, () => false);
    await authenticateLdap({ ...base, ...LDAP_PRESETS.openldapMemberOf, groupDn: "" }, "u", "pw", [{ id: 1, name: "T", dn: "cn=a(b)*,dc=ex" }], factory);
    assert.ok(searches.some((s) => s.filter === "(memberOf=cn=a\\28b\\29\\2a,dc=ex)"), JSON.stringify(searches.map((s) => s.filter)));
  });
});

describe("LDAP settings: attribute fields", () => {
  const input = { enabled: true, url: "ldaps://ldap.example", startTls: false, caCert: "", bindDn: "cn=svc,dc=ex", bindPassword: "pw", baseDn: "dc=ex", filter: "", groupDn: "" };
  it("defaults to Active Directory when the fields are empty, validates attribute names and the group check", () => {
    const d = parseLdapInput(input, null);
    assert.ok(d.ok && d.config.accountAttr === "sAMAccountName" && d.config.displayAttr === "displayName" && d.config.groupMode === "chain" && d.config.memberAttr === "");
    assert.deepEqual(parseLdapInput({ ...input, accountAttr: "uid)(x" }, null), { ok: false, error: "err.ldapAttr" });
    assert.deepEqual(parseLdapInput({ ...input, memberAttr: "a b" }, null), { ok: false, error: "err.ldapAttr" });
    assert.deepEqual(parseLdapInput({ ...input, groupMode: "bogus" }, null), { ok: false, error: "err.ldapGroupMode" });
    const o = parseLdapInput({ ...input, accountAttr: " uid ", displayAttr: "cn", groupMode: "group", memberAttr: "member" }, null);
    assert.ok(o.ok && o.config.accountAttr === "uid" && o.config.groupMode === "group" && o.config.memberAttr === "member");
  });
  it("a configuration saved before these fields existed loads as an Active Directory one", () => {
    const db = openDb(":memory:");
    saveLdapConfig({ ...EMPTY_LDAP, url: "ldaps://x", bindDn: "b", baseDn: "d", bindPassword: "p" }, db);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'ldap'").run(JSON.stringify({ enabled: true, url: "ldaps://x", startTls: false, caCert: "", bindDn: "b", bindPasswordEnc: "", baseDn: "d", filter: "(x={username})", groupDn: "" }));
    const c = loadLdapConfig(db);
    assert.ok(c && c.accountAttr === "sAMAccountName" && c.displayAttr === "displayName" && c.groupMode === "chain" && c.memberAttr === "");
  });
  it("every template is valid input", () => {
    for (const [k, p] of Object.entries(LDAP_PRESETS)) {
      assert.ok(p.filter.includes("{username}"), k);
      const r = parseLdapInput({ ...input, ...p }, null);
      assert.ok(r.ok, k + " " + JSON.stringify(r));
    }
  });
});
