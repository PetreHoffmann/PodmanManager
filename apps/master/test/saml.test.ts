import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { DbCacheProvider, REQUEST_TTL_MS } from "../src/lib/saml-cache";
import { DEFAULT_GROUP_CLAIM, DEFAULT_USERNAME_CLAIM, EMPTY_SAML, certInfo, loadSamlConfig, parseSamlInput, samlReady, saveSamlConfig, spAcsUrl, spEntityId, splitCerts, type SamlConfig } from "../src/lib/saml-config";
import { parseIdpMetadata } from "../src/lib/saml-metadata";
import { resolveSamlAccess, safeNext } from "../src/lib/saml-access";
import { completeLogin, spMetadataXml, startLogin } from "../src/lib/saml";
import { makeIdpKey, requestIdFrom, samlResponse } from "./saml-helpers";

process.env.MASTER_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");

const IDP = "http://adfs.corp.example.com/adfs/services/trust";
let idp: { key: string; cert: string };
let cfg: SamlConfig;
before(() => {
  idp = makeIdpKey();
  cfg = { ...EMPTY_SAML, enabled: true, publicUrl: "https://master.example.com", idpEntityId: IDP, idpSsoUrl: "https://adfs.corp.example.com/adfs/ls/", idpCert: idp.cert, adminGroup: "CORP\\PodmanAdmins" };
});

const resp = (o: Partial<Parameters<typeof samlResponse>[0]> & { inResponseTo: string }) =>
  samlResponse({ idpEntityId: IDP, spEntityId: spEntityId(cfg), acsUrl: spAcsUrl(cfg), key: idp.key, cert: idp.cert, ...o });

/** Starts a login like the master does and returns the id of its request. */
async function begin(cache: DbCacheProvider): Promise<string> {
  return requestIdFrom(await startLogin(cfg, "nonce.%2F".replace("%2F", "/"), cache));
}

describe("SAML response validation (ADFS-shaped, signed assertion)", () => {
  it("accepts a valid response and reads user name and groups", async () => {
    const cache = new DbCacheProvider(openDb(":memory:"));
    const id = await begin(cache);
    const r = await completeLogin(cfg, resp({ inResponseTo: id, groups: ["CORP\\Team-A", "CORP\\Other"] }), cache);
    assert.deepEqual(r, { ok: true, username: "alice@corp.example.com", groups: ["CORP\\Team-A", "CORP\\Other"] });
  });

  it("falls back to the NameID when the user name claim is missing; a single group value works", async () => {
    const cache = new DbCacheProvider(openDb(":memory:"));
    const r = await completeLogin(cfg, resp({ inResponseTo: await begin(cache), upn: null, nameId: "bob@corp.example.com", groups: ["CORP\\Only"] }), cache);
    assert.deepEqual(r, { ok: true, username: "bob@corp.example.com", groups: ["CORP\\Only"] });
  });

  it("works without groups (the caller then turns the user away)", async () => {
    const cache = new DbCacheProvider(openDb(":memory:"));
    const r = await completeLogin(cfg, resp({ inResponseTo: await begin(cache), groups: [] }), cache);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.groups, []);
  });

  it("accepts a response only once (replay) and only for a request this master made", async () => {
    const cache = new DbCacheProvider(openDb(":memory:"));
    const id = await begin(cache);
    const xml = resp({ inResponseTo: id });
    assert.equal((await completeLogin(cfg, xml, cache)).ok, true);
    assert.equal((await completeLogin(cfg, xml, cache)).ok, false, "second use");
    assert.equal((await completeLogin(cfg, resp({ inResponseTo: "_never-issued" }), cache)).ok, false, "unknown request id");
    // a second login with the same assertion id is rejected as well
    const id2 = await begin(cache);
    assert.equal((await completeLogin(cfg, resp({ inResponseTo: id2, assertionId: "_fixed" }), cache)).ok, true);
    const id3 = await begin(cache);
    assert.equal((await completeLogin(cfg, resp({ inResponseTo: id3, assertionId: "_fixed" }), cache)).ok, false, "assertion replay");
  });

  it("rejects an unsigned assertion and one signed with another key", async () => {
    const cache = new DbCacheProvider(openDb(":memory:"));
    assert.equal((await completeLogin(cfg, resp({ inResponseTo: await begin(cache), sign: false }), cache)).ok, false);
    const other = makeIdpKey();
    assert.equal((await completeLogin(cfg, resp({ inResponseTo: await begin(cache), signKey: other.key, cert: other.cert }), cache)).ok, false);
  });

  it("rejects a tampered assertion (groups changed after signing)", async () => {
    const cache = new DbCacheProvider(openDb(":memory:"));
    const xml = Buffer.from(resp({ inResponseTo: await begin(cache), groups: ["CORP\\Team-A"] }), "base64").toString("utf8");
    const forged = Buffer.from(xml.replace("CORP\\Team-A", "CORP\\PodmanAdmins")).toString("base64");
    assert.equal((await completeLogin(cfg, forged, cache)).ok, false);
  });

  it("rejects expired, wrong-audience, wrong-issuer and failed responses", async () => {
    const cache = new DbCacheProvider(openDb(":memory:"));
    const t = Date.now();
    assert.equal((await completeLogin(cfg, resp({ inResponseTo: await begin(cache), now: t - 7_200_000, lifetimeMs: 3_600_000 }), cache)).ok, false, "expired");
    assert.equal((await completeLogin(cfg, resp({ inResponseTo: await begin(cache), audience: "https://evil.example.com/saml/metadata" }), cache)).ok, false, "audience");
    assert.equal((await completeLogin(cfg, resp({ inResponseTo: await begin(cache), issuer: "http://other-idp.example.com/trust" }), cache)).ok, false, "issuer");
    const failed = `<samlp:Response ID="_f" Version="2.0" IssueInstant="${new Date().toISOString()}" InResponseTo="${await begin(cache)}" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${IDP}</Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Responder"><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:AuthnFailed"/></samlp:StatusCode></samlp:Status></samlp:Response>`;
    assert.equal((await completeLogin(cfg, Buffer.from(failed).toString("base64"), cache)).ok, false, "failed status (no assertion)");
    const wrongRecipient = samlResponse({ inResponseTo: await begin(cache), idpEntityId: IDP, spEntityId: spEntityId(cfg), acsUrl: "https://evil.example.com/saml/acs", key: idp.key, cert: idp.cert });
    const rr = await completeLogin(cfg, wrongRecipient, cache);
    assert.ok(!rr.ok && /Recipient/.test(rr.reason), "assertion addressed to another endpoint");
    assert.equal((await completeLogin(cfg, "not base64 xml", cache)).ok, false);
    assert.equal((await completeLogin(cfg, "", cache)).ok, false);
  });

  it("tolerates a small clock difference between ADFS and the master", async () => {
    const cache = new DbCacheProvider(openDb(":memory:"));
    const r = await completeLogin(cfg, resp({ inResponseTo: await begin(cache), now: Date.now() + 60_000 }), cache);
    assert.equal(r.ok, true, "ADFS clock 1 minute ahead");
  });

  it("the login request carries no NameID format and no requested authentication context (ADFS rejects both for Kerberos/WIA logins)", async () => {
    const url = new URL(await startLogin(cfg, "n./x", new DbCacheProvider(openDb(":memory:"))));
    assert.equal(url.origin + url.pathname, "https://adfs.corp.example.com/adfs/ls/");
    assert.equal(url.searchParams.get("RelayState"), "n./x");
    const xml = (await import("node:zlib")).inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString("utf8");
    assert.ok(xml.includes(`AssertionConsumerServiceURL="${spAcsUrl(cfg)}"`));
    assert.ok(!/NameIDPolicy[^>]*Format=/.test(xml) && !xml.includes("RequestedAuthnContext"), xml);
  });
});

describe("group mapping", () => {
  const mapped = [{ id: 1, name: "Team A", samlGroup: "CORP\\Team-A" }, { id: 2, name: "Team B", samlGroup: "corp\\team-b" }, { id: 3, name: "LDAP only", samlGroup: "" }];
  it("administrators see everything; members get the union of their groups; case-insensitive", () => {
    assert.deepEqual(resolveSamlAccess(cfg, ["CORP\\podmanadmins"], mapped), { ok: true, admin: true, groupIds: [] });
    assert.deepEqual(resolveSamlAccess(cfg, ["CORP\\Team-A", "CORP\\TEAM-B"], mapped), { ok: true, admin: false, groupIds: [1, 2] });
    assert.deepEqual(resolveSamlAccess(cfg, [" CORP\\Team-A "], mapped), { ok: true, admin: false, groupIds: [1] });
  });
  it("turns everybody else away; empty values never match", () => {
    assert.deepEqual(resolveSamlAccess(cfg, ["CORP\\Nobody"], mapped), { ok: false, reason: "no_group" });
    assert.deepEqual(resolveSamlAccess(cfg, [], mapped), { ok: false, reason: "no_group" });
    assert.deepEqual(resolveSamlAccess(cfg, [""], mapped), { ok: false, reason: "no_group" });
    assert.deepEqual(resolveSamlAccess({ adminGroup: "" }, [""], mapped), { ok: false, reason: "no_group" });
  });
  it("only local paths are accepted as relay target", () => {
    for (const bad of ["//evil.com", "https://evil.com", "/../etc", "javascript:alert(1)", "/a b", "", "/x?y=1", "\\evil"]) assert.equal(safeNext(bad), "/", bad);
    for (const ok of ["/", "/containers", "/pods/1/abc", "/settings"]) assert.equal(safeNext(ok), ok);
  });
});

describe("configuration", () => {
  const base: SamlConfig = { ...EMPTY_SAML, enabled: true, publicUrl: "https://master.example.com/", idpEntityId: IDP, idpSsoUrl: "https://adfs.corp.example.com/adfs/ls/", idpCert: "" };
  it("validates and normalises the input", () => {
    const ok = parseSamlInput({ ...base, idpCert: `  ${idp.cert}  ` });
    assert.equal(ok.ok && ok.config.publicUrl, "https://master.example.com");
    assert.ok(ok.ok && samlReady(ok.config));
    assert.deepEqual(parseSamlInput({ ...base, idpCert: "" }), { ok: false, error: "err.samlCert" }, "enabled needs a certificate");
    assert.equal(parseSamlInput({ ...base, enabled: false, idpCert: "", idpSsoUrl: "", idpEntityId: "", publicUrl: "" }).ok, true, "a disabled draft may be incomplete");
    for (const bad of ["ftp://x", "https://m.example.com/app", "https://user:pw@m.example.com", "https://m.example.com?x=1", "not a url"]) assert.equal(parseSamlInput({ ...base, publicUrl: bad, idpCert: idp.cert }).ok, false, bad);
    assert.equal(parseSamlInput({ ...base, publicUrl: "http://master.example.com:8080", idpCert: idp.cert }).ok, true, "http is allowed for the master (behind a proxy)");
    assert.deepEqual(parseSamlInput({ ...base, idpSsoUrl: "http://adfs.corp.example.com/adfs/ls/", idpCert: idp.cert }), { ok: false, error: "err.samlSsoUrl" }, "ADFS must be https");
    assert.equal(parseSamlInput({ ...base, idpSsoUrl: "http://localhost:9000/sso", idpCert: idp.cert }).ok, true, "http only for localhost");
    assert.deepEqual(parseSamlInput({ ...base, idpEntityId: "has space", idpCert: idp.cert }), { ok: false, error: "err.samlEntityId" });
    assert.deepEqual(parseSamlInput({ ...base, idpCert: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----" }), { ok: false, error: "err.samlCert" });
    assert.deepEqual(parseSamlInput({ ...base, idpCert: idp.cert, usernameClaim: "a b" }), { ok: false, error: "err.samlClaim" });
    const d = parseSamlInput({ ...base, idpCert: idp.cert, usernameClaim: "", groupClaim: "" });
    assert.ok(d.ok && d.config.usernameClaim === "" && d.config.groupClaim === DEFAULT_GROUP_CLAIM, "empty user name claim = NameID, empty group claim = default");
    assert.equal(DEFAULT_USERNAME_CLAIM.endsWith("/upn"), true);
  });
  it("accepts several certificates and bare base64", () => {
    const b64 = idp.cert.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    assert.equal(splitCerts(`${idp.cert}\n${idp.cert}`).length, 2);
    assert.equal(splitCerts(b64).length, 1);
    assert.ok(certInfo(splitCerts(b64)[0]!)!.subject.includes("ADFS Signing"));
    assert.equal(splitCerts("garbage text").length, 0);
  });
  it("stores and loads the configuration", () => {
    const db = openDb(":memory:");
    assert.equal(loadSamlConfig(db), null);
    saveSamlConfig(cfg, db);
    assert.deepEqual(loadSamlConfig(db), cfg);
    db.prepare("UPDATE settings SET value = 'junk' WHERE key = 'saml'").run();
    assert.equal(loadSamlConfig(db), null);
    assert.equal(samlReady({ ...cfg, enabled: false }), false);
    assert.equal(samlReady(null), false);
  });
  it("service provider metadata names entity id and sign-in endpoint (no secrets)", () => {
    const xml = spMetadataXml(cfg);
    assert.ok(xml.includes(`entityID="https://master.example.com/saml/metadata"`), xml);
    assert.ok(xml.includes(`Location="https://master.example.com/saml/acs"`) && xml.includes("HTTP-POST"));
    assert.ok(!xml.includes("PRIVATE"));
  });
});

describe("IdP metadata import (ADFS FederationMetadata.xml)", () => {
  const b64 = () => idp.cert.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const adfs = () => `<?xml version="1.0" encoding="utf-8"?><EntityDescriptor ID="_x" entityID="${IDP}" xmlns="urn:oasis:names:tc:SAML:2.0:metadata"><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo/></ds:Signature><RoleDescriptor xsi:type="fed:ApplicationServiceType" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:fed="http://docs.oasis-open.org/wsfed/federation/200706"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>WSFEDONLY</X509Certificate></X509Data></KeyInfo></KeyDescriptor></RoleDescriptor><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="encryption"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>ENCRYPTIONONLY</X509Certificate></X509Data></KeyInfo></KeyDescriptor><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${b64()}</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://adfs.corp.example.com/adfs/ls/"/><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://adfs.corp.example.com/adfs/ls/"/><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://adfs.corp.example.com/adfs/ls/"/></IDPSSODescriptor></EntityDescriptor>`;
  it("takes entity id, redirect sign-in address and only the signing certificate of the SAML role", () => {
    const r = parseIdpMetadata(adfs());
    assert.ok(r.ok);
    assert.equal(r.data.entityId, IDP);
    assert.equal(r.data.ssoUrl, "https://adfs.corp.example.com/adfs/ls/");
    assert.equal(r.data.certs.length, 1);
    assert.equal(r.data.certs[0], splitCerts(idp.cert)[0]);
  });
  it("rejects broken, foreign and empty documents", () => {
    assert.deepEqual(parseIdpMetadata("not xml at all <<<"), { ok: false, error: "err.samlMetaParse" });
    assert.equal(parseIdpMetadata("<a><b></a>").ok, false);
    assert.deepEqual(parseIdpMetadata('<EntityDescriptor entityID="x" xmlns="urn:oasis:names:tc:SAML:2.0:metadata"/>'), { ok: false, error: "err.samlMetaNoIdp" });
    assert.deepEqual(parseIdpMetadata("x".repeat(1024 * 1024 + 1)), { ok: false, error: "err.samlMetaTooLarge" });
  });
  it("does not expand external entities (XXE)", () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${adfs().replace(/^<\?xml[^>]*>/, "").replace(`entityID="${IDP}"`, `entityID="&xxe;"`)}`;
    const r = parseIdpMetadata(evil);
    assert.ok(!r.ok || !r.data.entityId.includes("root:"), "no file content in the result");
  });
});

describe("request cache", () => {
  it("keeps a request id for 8 minutes, hands it out once, and refuses a repeated assertion id", async () => {
    let now = 1_000_000;
    const c = new DbCacheProvider(openDb(":memory:"), () => now);
    await c.saveAsync("req1", "x");
    assert.equal(await c.getAsync("req1"), "x");
    assert.equal(await c.consumeAsync("req1"), "x");
    assert.equal(await c.consumeAsync("req1"), null, "only once");
    await c.saveAsync("req2", "y");
    now += REQUEST_TTL_MS + 1;
    assert.equal(await c.getAsync("req2"), null, "expired");
    assert.equal(await c.saveIfAbsentAsync("as1", "1", now + 1000), true);
    assert.equal(await c.saveIfAbsentAsync("as1", "1", now + 1000), false);
    now += 2000;
    assert.equal(await c.saveIfAbsentAsync("as1", "1", now + 1000), true, "free again after it expired");
  });
});
