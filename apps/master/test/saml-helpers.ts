import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";

/** A throw-away signing key and self-signed certificate, like ADFS's token-signing certificate (tests only). */
export function makeIdpKey(days = 3650): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "pm-saml-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-subj", "/CN=ADFS Signing - adfs.corp.example.com", "-days", String(days)], { stdio: "ignore" });
    return { key: readFileSync(join(dir, "k.pem"), "utf8"), cert: readFileSync(join(dir, "c.pem"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Request id of the AuthnRequest in a redirect URL produced by startLogin. */
export function requestIdFrom(redirectUrl: string): string {
  const q = new URL(redirectUrl).searchParams.get("SAMLRequest")!;
  const xml = inflateRawSync(Buffer.from(q, "base64")).toString("utf8");
  return /\sID="([^"]+)"/.exec(xml)![1]!;
}

export interface ResponseOpts {
  inResponseTo: string;
  idpEntityId: string;
  spEntityId: string;
  acsUrl: string;
  key: string;
  cert: string;
  sign?: boolean;
  /** use another private key for the signature */
  signKey?: string;
  nameId?: string;
  upn?: string | null;
  groups?: string[];
  /** attribute names (defaults: the ADFS claim types); userClaim null = no user name attribute */
  userClaim?: string | null;
  groupClaim?: string;
  nameIdFormat?: string;
  /** further attributes (name -> value) */
  extra?: Record<string, string>;
  audience?: string;
  /** issue time in ms (defaults to now) */
  now?: number;
  /** lifetime of the assertion in ms from `now` (negative = already expired) */
  lifetimeMs?: number;
  issuer?: string;
  assertionId?: string;
  status?: string;
}

const iso = (ms: number) => new Date(ms).toISOString();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A response shaped like ADFS's (signed assertion, bearer confirmation, UPN and group claims). */
export function samlResponse(o: ResponseOpts): string {
  const now = o.now ?? Date.now();
  const end = now + (o.lifetimeMs ?? 3_600_000);
  const nameId = o.nameId ?? "alice@corp.example.com";
  const upn = o.upn === undefined ? "alice@corp.example.com" : o.upn;
  const groups = o.groups ?? ["CORP\\Team-A"];
  const aid = o.assertionId ?? `_a${Math.random().toString(16).slice(2)}`;
  const issuer = o.issuer ?? o.idpEntityId;
  const xml = `<samlp:Response ID="_r${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${iso(now)}" Destination="${o.acsUrl}" Consent="urn:oasis:names:tc:SAML:2.0:consent:unspecified" InResponseTo="${o.inResponseTo}" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${issuer}</Issuer><samlp:Status><samlp:StatusCode Value="${o.status ?? "urn:oasis:names:tc:SAML:2.0:status:Success"}"/></samlp:Status><Assertion ID="${aid}" IssueInstant="${iso(now)}" Version="2.0" xmlns="urn:oasis:names:tc:SAML:2.0:assertion"><Issuer>${issuer}</Issuer><Subject><NameID Format="${o.nameIdFormat ?? "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified"}">${esc(nameId)}</NameID><SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><SubjectConfirmationData InResponseTo="${o.inResponseTo}" NotOnOrAfter="${iso(end)}" Recipient="${o.acsUrl}"/></SubjectConfirmation></Subject><Conditions NotBefore="${iso(now)}" NotOnOrAfter="${iso(end)}"><AudienceRestriction><Audience>${o.audience ?? o.spEntityId}</Audience></AudienceRestriction></Conditions><AttributeStatement>${upn === null || o.userClaim === null ? "" : `<Attribute Name="${o.userClaim ?? "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn"}"><AttributeValue>${esc(upn)}</AttributeValue></Attribute>`}<Attribute Name="${o.groupClaim ?? "http://schemas.xmlsoap.org/claims/Group"}">${groups.map((g) => `<AttributeValue>${esc(g)}</AttributeValue>`).join("")}</Attribute>${Object.entries(o.extra ?? {}).map(([k, v]) => `<Attribute Name="${k}"><AttributeValue>${esc(v)}</AttributeValue></Attribute>`).join("")}</AttributeStatement><AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="_s1"><AuthnContext><AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</AuthnContextClassRef></AuthnContext></AuthnStatement></Assertion></samlp:Response>`;
  if (o.sign === false) return Buffer.from(xml).toString("base64");
  const sig = new SignedXml({ privateKey: o.signKey ?? o.key, publicCert: o.cert, signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"], digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: "after" } });
  return Buffer.from(sig.getSignedXml()).toString("base64");
}
