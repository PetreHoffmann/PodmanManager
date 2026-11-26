import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomBytes, type JsonWebKey } from "node:crypto";
import { describe, it } from "node:test";
import { decodeCbor } from "../src/lib/cbor";
import { openDb } from "../src/database/db";
import { CHALLENGE_TTL_MS, MAX_PASSKEYS, addPasskey, consumeChallenge, deleteAllPasskeys, deletePasskey, findPasskey, issueChallenge, listPasskeys, recordPasskeyUse, userHandleFor } from "../src/lib/passkeys";
import { FLAG_AT, FLAG_UP, FLAG_UV, b64u, sha256, verifyAssertion, verifyRegistration, WebAuthnError } from "../src/lib/webauthn";

// --- a tiny CBOR writer and a software authenticator, to build real-looking WebAuthn messages
const head = (major: number, n: number) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
const enc = (v: unknown): Buffer => {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [enc(k), enc(x)])]);
  throw new Error("unsupported");
};

const RP = "master.example.com";
const ORIGIN = "https://master.example.com";

function authData(opts: { rpId?: string; flags: number; count: number; credId?: Buffer; cose?: Map<unknown, unknown> }): Buffer {
  const parts = [sha256(opts.rpId ?? RP), Buffer.from([opts.flags]), Buffer.from([opts.count >>> 24, (opts.count >>> 16) & 255, (opts.count >>> 8) & 255, opts.count & 255])];
  if (opts.credId) {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(opts.credId.length);
    parts.push(Buffer.alloc(16), len, opts.credId, enc(opts.cose));
  }
  return Buffer.concat(parts);
}
const clientData = (type: string, challenge: string, origin = ORIGIN, extra: object = {}) => Buffer.from(JSON.stringify({ type, challenge, origin, ...extra }));

function ec() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const cose = new Map<unknown, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]);
  const sign = (data: Buffer) => createSign("sha256").update(data).sign(privateKey);
  return { cose, sign };
}

function register(a: ReturnType<typeof ec>, challenge: string, o: { flags?: number; rpId?: string; origin?: string; type?: string; credId?: Buffer } = {}) {
  const credId = o.credId ?? randomBytes(32);
  const ad = authData({ rpId: o.rpId, flags: o.flags ?? FLAG_UP | FLAG_UV | FLAG_AT, count: 0, credId, cose: a.cose });
  return { credId, input: { clientDataJSON: clientData(o.type ?? "webauthn.create", challenge, o.origin), attestationObject: enc(new Map<unknown, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", ad]])) } };
}
function assertion(a: ReturnType<typeof ec>, challenge: string, o: { count?: number; flags?: number; rpId?: string; origin?: string; type?: string; extra?: object } = {}) {
  const ad = authData({ rpId: o.rpId, flags: o.flags ?? FLAG_UP | FLAG_UV, count: o.count ?? 0 });
  const cd = clientData(o.type ?? "webauthn.get", challenge, o.origin, o.extra);
  return { clientDataJSON: cd, authenticatorData: ad, signature: a.sign(Buffer.concat([ad, sha256(cd)])) };
}
const want = (challenge: string) => ({ rpId: RP, origin: ORIGIN, challenge });

describe("cbor", () => {
  it("reads the types WebAuthn uses and refuses the rest", () => {
    const m = decodeCbor(enc(new Map<unknown, unknown>([[1, 2], [-7, Buffer.from("ab")], ["t", "text"]]))).value as Map<unknown, unknown>;
    assert.equal(m.get(1), 2);
    assert.equal(m.get(-7)?.toString(), "ab");
    assert.equal(m.get("t"), "text");
    assert.throws(() => decodeCbor(Buffer.from([0x9f, 0xff])), /indefinite/);
    assert.throws(() => decodeCbor(Buffer.from([0x58, 0x20, 1, 2])), /truncated/);
    assert.throws(() => decodeCbor(Buffer.from([0xf9, 0, 0])), /unsupported/);
  });
});

describe("registration", () => {
  it("accepts a good response and returns id, algorithm and key", () => {
    const a = ec();
    const r = register(a, "ch1");
    const v = verifyRegistration(r.input, want("ch1"));
    assert.deepEqual(v.credentialId, r.credId);
    assert.equal(v.alg, -7);
    assert.equal(v.jwk.kty, "EC");
  });

  it("refuses wrong challenge, origin, relying party, ceremony, missing user verification/presence", () => {
    const a = ec();
    const bad = (o: Parameters<typeof register>[2], expect: RegExp, w = want("c")) => assert.throws(() => verifyRegistration(register(a, "c", o).input, w), expect);
    bad({}, /challenge/, want("other"));
    bad({ origin: "https://evil.example" }, /origin/);
    bad({ origin: "http://master.example.com" }, /browser: http:\/\/master\.example\.com, master expects: https:\/\/master\.example\.com/);
    bad({ rpId: "evil.example" }, /relying party/);
    bad({ type: "webauthn.get" }, /ceremony/);
    bad({ flags: FLAG_UP | FLAG_AT }, /user verification/);
    bad({ flags: FLAG_UV | FLAG_AT }, /user presence/);
    bad({ flags: FLAG_UP | FLAG_UV }, /credential data/);
  });

  it("refuses unsupported keys and garbage", () => {
    const a = ec();
    a.cose.set(3, -8);
    assert.throws(() => verifyRegistration(register(a, "c").input, want("c")), /unsupported key type/);
    assert.throws(() => verifyRegistration({ clientDataJSON: clientData("webauthn.create", "c"), attestationObject: Buffer.from("nonsense") }, want("c")), WebAuthnError);
    assert.throws(() => verifyRegistration({ clientDataJSON: Buffer.from("{"), attestationObject: Buffer.alloc(0) }, want("c")), /not JSON/);
  });

  it("accepts an RS256 key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    const cose = new Map<unknown, unknown>([[1, 3], [3, -257], [-1, Buffer.from(jwk.n!, "base64url")], [-2, Buffer.from(jwk.e!, "base64url")]]);
    const credId = randomBytes(16);
    const ad = authData({ flags: FLAG_UP | FLAG_UV | FLAG_AT, count: 0, credId, cose });
    const v = verifyRegistration({ clientDataJSON: clientData("webauthn.create", "c"), attestationObject: enc(new Map<unknown, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", ad]])) }, want("c"));
    assert.equal(v.alg, -257);
    const adS = authData({ flags: FLAG_UP | FLAG_UV, count: 0 });
    const cd = clientData("webauthn.get", "g");
    const sig = createSign("sha256").update(Buffer.concat([adS, sha256(cd)])).sign(privateKey);
    assert.deepEqual(verifyAssertion({ clientDataJSON: cd, authenticatorData: adS, signature: sig }, { alg: v.alg, jwk: v.jwk, signCount: 0 }, want("g")), { signCount: 0 });
  });
});

describe("assertion (sign-in)", () => {
  const stored = () => {
    const a = ec();
    const v = verifyRegistration(register(a, "reg").input, want("reg"));
    return { a, key: { alg: v.alg, jwk: v.jwk, signCount: 0 } };
  };

  it("accepts a valid signature, also with counter 0 on every use", () => {
    const { a, key } = stored();
    assert.deepEqual(verifyAssertion(assertion(a, "g1"), key, want("g1")), { signCount: 0 });
  });

  it("refuses a wrong signature, a key that is not the stored one, and changed data", () => {
    const { a, key } = stored();
    const other = ec();
    assert.throws(() => verifyAssertion(assertion(other, "g"), key, want("g")), /signature/);
    const ok = assertion(a, "g");
    assert.throws(() => verifyAssertion({ ...ok, authenticatorData: Buffer.concat([ok.authenticatorData.subarray(0, 33), Buffer.from([0, 0, 0, 9])]) }, key, want("g")), /signature/);
    assert.throws(() => verifyAssertion(ok, key, want("not-g")), /challenge/);
  });

  it("refuses wrong origin, relying party, ceremony, missing verification and cross-origin frames", () => {
    const { a, key } = stored();
    const t = (o: Parameters<typeof assertion>[2], re: RegExp) => assert.throws(() => verifyAssertion(assertion(a, "g", o), key, want("g")), re);
    t({ origin: "http://master.example.com" }, /origin/);
    t({ rpId: "other.example" }, /relying party/);
    t({ type: "webauthn.create" }, /ceremony/);
    t({ flags: FLAG_UP }, /user verification/);
    t({ flags: FLAG_UV }, /user presence/);
    t({ extra: { crossOrigin: true } }, /cross-origin/);
  });

  it("detects a cloned authenticator by the signature counter", () => {
    const { a, key } = stored();
    assert.deepEqual(verifyAssertion(assertion(a, "g", { count: 5 }), { ...key, signCount: 4 }, want("g")), { signCount: 5 });
    assert.throws(() => verifyAssertion(assertion(a, "g", { count: 5 }), { ...key, signCount: 5 }, want("g")), /counter/);
    assert.throws(() => verifyAssertion(assertion(a, "g", { count: 3 }), { ...key, signCount: 5 }, want("g")), /counter/);
    assert.throws(() => verifyAssertion(assertion(a, "g", { count: 0 }), { ...key, signCount: 5 }, want("g")), /counter/);
  });
});

describe("stored passkeys and challenges", () => {
  const reg = () => {
    const a = ec();
    return verifyRegistration(register(a, "c").input, want("c"));
  };

  it("keeps passkeys per account, with limits", () => {
    const db = openDb(":memory:");
    const h = userHandleFor("max", db);
    const r = reg();
    const added = addPasskey("max", r, "Laptop\n", h, 1000, db);
    assert.ok(added.ok);
    assert.equal(addPasskey("max", r, "again", h, 1000, db).ok, false, "same credential twice");
    const list = listPasskeys("MAX", db);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.name, "Laptop");
    assert.equal(userHandleFor("max", db), h, "one handle per account");
    assert.notEqual(userHandleFor("anna", db), h);
    assert.equal(findPasskey(list[0]!.credentialId, db)?.username, "max");
    recordPasskeyUse(list[0]!.id, 7, 2000, db);
    assert.equal(listPasskeys("max", db)[0]!.signCount, 7);
    for (let i = 1; i < MAX_PASSKEYS; i++) assert.ok(addPasskey("max", reg(), `k${i}`, h, 1000, db).ok);
    assert.deepEqual(addPasskey("max", reg(), "one too many", h, 1000, db), { ok: false, reason: "limit" });
  });

  it("deletes only the own passkeys", () => {
    const db = openDb(":memory:");
    const a = addPasskey("max", reg(), "m", "h1", 1, db);
    const b = addPasskey("anna", reg(), "a", "h2", 1, db);
    assert.ok(a.ok && b.ok);
    assert.equal(deletePasskey("max", b.ok ? b.id : 0, db), false);
    assert.equal(deletePasskey("max", a.ok ? a.id : 0, db), true);
    deleteAllPasskeys("anna", db);
    assert.equal(listPasskeys("anna", db).length, 0);
  });

  it("uses a challenge once, for its purpose, within five minutes", () => {
    const db = openDb(":memory:");
    const c = issueChallenge("login", "", 1000, db);
    assert.deepEqual(consumeChallenge(c, "login", 2000, db), { username: "" });
    assert.equal(consumeChallenge(c, "login", 2000, db), null, "second use");
    const r = issueChallenge("register", "max", 1000, db);
    assert.equal(consumeChallenge(r, "login", 2000, db), null, "wrong purpose, and it is spent");
    assert.equal(consumeChallenge(r, "register", 2000, db), null);
    const old = issueChallenge("login", "", 1000, db);
    assert.equal(consumeChallenge(old, "login", 1000 + CHALLENGE_TTL_MS + 1, db), null, "expired");
    assert.equal(consumeChallenge("unknown", "login", 1, db), null);
    assert.equal(b64u(Buffer.from(c, "base64url")), c);
  });
});
