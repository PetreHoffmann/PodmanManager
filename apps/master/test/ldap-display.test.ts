import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authenticateLdap, type ClientFactory, type LdapConfig, type LdapEntry } from "../src/lib/ldap";
import { AD_ATTRS } from "../src/lib/ldap-presets";
import { accountFromUpn, formatDisplayName } from "../src/lib/display-name";

const ADMINS = "CN=Admins,OU=Groups,DC=ex,DC=com";
const cfg: LdapConfig = { enabled: true, url: "ldaps://dc.example", startTls: false, caCert: "", bindDn: "CN=svc,DC=ex,DC=com", bindPassword: "svc", baseDn: "DC=ex,DC=com", groupDn: ADMINS, ...AD_ATTRS };

/** A directory double: one user whose attributes are whatever the test passes (as ldapts returns them: strings or lists). */
const directory = (attrs: Record<string, unknown>): ClientFactory => () => ({
  async startTLS() {},
  async bind() {},
  async search(_base, options): Promise<{ searchEntries: LdapEntry[] }> {
    if (options.filter.includes("1.2.840.113556.1.4.1941")) return { searchEntries: [{ dn: "CN=Max,OU=Users,DC=ex,DC=com" }] };
    return { searchEntries: [{ dn: "CN=Max,OU=Users,DC=ex,DC=com", ...attrs }] };
  },
  async unbind() {},
});

describe("display name of LDAP users", () => {
  it("is \"Display Name (account)\" from displayName and sAMAccountName, read in the same search that finds the user", async () => {
    const r = await authenticateLdap(cfg, "mustermannm", "pw", [], directory({ sAMAccountName: "MustermannM", displayName: "Max Mustermann" }));
    assert.ok(r.ok);
    assert.equal(r.ok && r.displayName, "Max Mustermann (MustermannM)");
    assert.equal(r.ok && r.username, "MustermannM", "the login name stays the account name");
  });

  it("works when the directory returns lists, and falls back to the login name without a display name", async () => {
    const list = await authenticateLdap(cfg, "x", "pw", [], directory({ sAMAccountName: ["MustermannM"], displayName: ["Max Mustermann"] }));
    assert.ok(list.ok && list.displayName === "Max Mustermann (MustermannM)", JSON.stringify(list));
    for (const attrs of [{ sAMAccountName: "MustermannM" }, { sAMAccountName: "MustermannM", displayName: "  " }, { displayName: [] as string[] }]) {
      const r = await authenticateLdap(cfg, "mustermannm", "pw", [], directory(attrs));
      assert.ok(r.ok && !("displayName" in r), JSON.stringify(attrs));
    }
  });

  it("a user who is in no group is reported with the name from the directory (never the typed text), for the log", async () => {
    const noGroups: ClientFactory = () => ({
      async startTLS() {},
      async bind() {},
      async search(_b, o): Promise<{ searchEntries: LdapEntry[] }> {
        if (o.filter.includes("1.2.840.113556.1.4.1941")) return { searchEntries: [] };
        return { searchEntries: [{ dn: "CN=Max,OU=Users,DC=ex,DC=com", sAMAccountName: "MustermannM", displayName: "Max Mustermann" }] };
      },
      async unbind() {},
    });
    const r = await authenticateLdap(cfg, "mustermannm@ex.example", "pw", [], noGroups);
    assert.deepEqual(r, { ok: false, reason: "not_member", username: "MustermannM", displayName: "Max Mustermann (MustermannM)" });
    const none: ClientFactory = () => ({ async startTLS() {}, async bind() {}, async search() { return { searchEntries: [] }; }, async unbind() {} });
    const u = await authenticateLdap(cfg, "SecretPassw0rd!", "pw", [], none);
    assert.deepEqual(u, { ok: false, reason: "invalid" }, "an unknown typed name (maybe a mistyped password) is not reported");
  });

  it("formatting: cleaned, bounded, no duplicate when both are the same", () => {
    assert.equal(formatDisplayName("  Eve\u0000  \n Example ", "eve"), "Eve Example (eve)");
    assert.equal(formatDisplayName("eve", "EVE"), "eve");
    assert.equal(formatDisplayName(undefined, "eve"), null);
    assert.equal(formatDisplayName(42, "eve"), null);
    assert.ok(formatDisplayName("x".repeat(500), "a")!.length < 130);
    assert.equal(accountFromUpn("MustermannM@corp.example.com"), "MustermannM");
    assert.equal(accountFromUpn("plain"), "plain");
  });
});
