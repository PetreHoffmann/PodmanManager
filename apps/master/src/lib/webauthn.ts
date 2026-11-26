import { createHash, createPublicKey, randomBytes, verify as cryptoVerify, type JsonWebKey } from "node:crypto";
import { CborError, decodeCbor, type Cbor } from "./cbor";

/** Passkeys (WebAuthn level 2) with the Node standard library: attestation "none", ES256 and RS256, user verification required. */
export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_AT = 0x40;
export const ALG_ES256 = -7;
export const ALG_RS256 = -257;

export const b64u = (b: Buffer): string => b.toString("base64url");
export const fromB64u = (s: string): Buffer => Buffer.from(s, "base64url");
export const sha256 = (b: Buffer | string): Buffer => createHash("sha256").update(b).digest();
export const newChallenge = (): string => b64u(randomBytes(32));

export class WebAuthnError extends Error {}
const fail = (m: string): never => {
  throw new WebAuthnError(m);
};

export interface ClientData { type: string; challenge: string; origin: string }

export function parseClientData(raw: Buffer): ClientData {
  let o: unknown;
  try {
    o = JSON.parse(raw.toString("utf8"));
  } catch {
    return fail("clientDataJSON is not JSON");
  }
  const r = o as Record<string, unknown>;
  if (typeof r.type !== "string" || typeof r.challenge !== "string" || typeof r.origin !== "string") return fail("clientDataJSON incomplete");
  // crossOrigin (a frame on another site) is refused
  if (r.crossOrigin === true) return fail("cross-origin request");
  return { type: r.type, challenge: r.challenge, origin: r.origin };
}

export interface AuthData { rpIdHash: Buffer; flags: number; signCount: number; credentialId?: Buffer; coseKey?: Map<Cbor, Cbor> }

export function parseAuthData(buf: Buffer, expectCredential: boolean): AuthData {
  if (buf.length < 37) return fail("authenticator data too short");
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf[32]!;
  const signCount = buf.readUInt32BE(33);
  const out: AuthData = { rpIdHash, flags, signCount };
  if (expectCredential) {
    if (!(flags & FLAG_AT)) return fail("no credential data");
    if (buf.length < 55) return fail("credential data too short");
    const idLen = buf.readUInt16BE(53);
    if (idLen < 1 || idLen > 1023 || buf.length < 55 + idLen) return fail("bad credential id");
    out.credentialId = Buffer.from(buf.subarray(55, 55 + idLen));
    let key: Cbor;
    try {
      key = decodeCbor(buf, 55 + idLen).value;
    } catch (e) {
      return fail(e instanceof CborError ? `bad public key: ${e.message}` : "bad public key");
    }
    if (!(key instanceof Map)) return fail("public key is not a map");
    out.coseKey = key;
  }
  return out;
}

/** COSE public key (EC2/P-256 or RSA) as a JWK that Node can import. */
export function coseToJwk(k: Map<Cbor, Cbor>): { alg: number; jwk: JsonWebKey } {
  const kty = k.get(1);
  const alg = k.get(3);
  if (kty === 2 && alg === ALG_ES256) {
    const crv = k.get(-1);
    const x = k.get(-2);
    const y = k.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) return fail("unsupported EC key");
    return { alg: ALG_ES256, jwk: { kty: "EC", crv: "P-256", x: b64u(x), y: b64u(y) } };
  }
  if (kty === 3 && alg === ALG_RS256) {
    const n = k.get(-1);
    const e = k.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256 || n.length > 1024) return fail("unsupported RSA key");
    return { alg: ALG_RS256, jwk: { kty: "RSA", n: b64u(n), e: b64u(e) } };
  }
  return fail("unsupported key type (only ES256 and RS256)");
}

export interface Expect { rpId: string; origin: string; challenge: string }

// eslint-disable-next-line no-control-regex
const shown = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);

function checkCommon(cd: ClientData, ad: AuthData, want: Expect, type: string): void {
  if (cd.type !== type) fail("wrong ceremony type");
  if (cd.challenge !== want.challenge) fail("challenge does not match");
  // both origins are not secret; naming them shows at once whether the proxy passes the wrong scheme, host or port
  if (cd.origin !== want.origin) fail(`origin does not match (browser: ${shown(cd.origin)}, master expects: ${shown(want.origin)}; the reverse proxy must pass Host and X-Forwarded-Proto: https)`);
  if (!ad.rpIdHash.equals(sha256(want.rpId))) fail("relying party id does not match");
  if (!(ad.flags & FLAG_UP)) fail("user presence missing");
  if (!(ad.flags & FLAG_UV)) fail("user verification missing");
}

export interface Registered { credentialId: Buffer; alg: number; jwk: JsonWebKey; signCount: number }

/** Checks a registration response ("none" attestation: the statement is not evaluated). */
export function verifyRegistration(input: { clientDataJSON: Buffer; attestationObject: Buffer }, want: Expect): Registered {
  const cd = parseClientData(input.clientDataJSON);
  let att: Cbor;
  try {
    att = decodeCbor(input.attestationObject).value;
  } catch {
    return fail("bad attestation object");
  }
  if (!(att instanceof Map)) return fail("attestation object is not a map");
  const authData = att.get("authData");
  if (!Buffer.isBuffer(authData)) return fail("authData missing");
  const ad = parseAuthData(authData, true);
  checkCommon(cd, ad, want, "webauthn.create");
  const { alg, jwk } = coseToJwk(ad.coseKey!);
  return { credentialId: ad.credentialId!, alg, jwk, signCount: ad.signCount };
}

/** Checks a sign-in response against the stored key; returns the new signature counter. */
export function verifyAssertion(input: { clientDataJSON: Buffer; authenticatorData: Buffer; signature: Buffer }, stored: { alg: number; jwk: JsonWebKey; signCount: number }, want: Expect): { signCount: number } {
  const cd = parseClientData(input.clientDataJSON);
  const ad = parseAuthData(input.authenticatorData, false);
  checkCommon(cd, ad, want, "webauthn.get");
  const key = createPublicKey({ key: stored.jwk, format: "jwk" });
  const signed = Buffer.concat([input.authenticatorData, sha256(input.clientDataJSON)]);
  if (!cryptoVerify("sha256", signed, key, input.signature)) fail("signature is wrong");
  // counters of platform authenticators are often always 0; otherwise they must rise (a copy of the key would not)
  if ((ad.signCount !== 0 || stored.signCount !== 0) && ad.signCount <= stored.signCount) fail("signature counter did not increase");
  return { signCount: ad.signCount };
}
