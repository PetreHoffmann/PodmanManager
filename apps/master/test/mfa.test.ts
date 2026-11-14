import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { createPending, disableMfa, enableMfa, failPending, getPending, hasMfa, mfaStatus, regenerateRecovery, verifySecondFactor, MAX_PENDING_ATTEMPTS, PENDING_TTL_MS } from "../src/lib/mfa";
import { base32Decode, base32Encode, generateSecret, hotp, otpauthUrl, stepOf, verifyTotp } from "../src/lib/totp";

const KEY = Buffer.alloc(32, 7);
const SECRET_ASCII = Buffer.from("12345678901234567890");
const T = 1_800_000_000_000;
const codeAt = (secretB32: string, ms: number) => hotp(base32Decode(secretB32)!, stepOf(ms));

describe("totp", () => {
  it("matches the RFC 6238 test vectors (SHA-1, last 6 digits)", () => {
    for (const [t, want] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]] as const) {
      assert.equal(hotp(SECRET_ASCII, Math.floor(t / 30)), want, `T=${t}`);
    }
  });

  it("encodes and decodes base32", () => {
    assert.equal(base32Encode(SECRET_ASCII), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    assert.deepEqual(base32Decode("gezd gnbv-GY3TQOJQ GEZDGNBVGY3TQOJQ"), SECRET_ASCII);
    assert.equal(base32Decode("not base32!"), null);
    assert.equal(generateSecret().length, 32);
  });

  it("accepts one step of drift, refuses more, and refuses a used step", () => {
    const s = generateSecret();
    assert.equal(verifyTotp(s, codeAt(s, T), T), stepOf(T));
    assert.equal(verifyTotp(s, codeAt(s, T - 30_000), T), stepOf(T) - 1);
    assert.equal(verifyTotp(s, codeAt(s, T + 30_000), T), stepOf(T) + 1);
    assert.equal(verifyTotp(s, codeAt(s, T - 90_000), T), null);
    assert.equal(verifyTotp(s, codeAt(s, T), T, stepOf(T)), null, "same step twice");
    assert.equal(verifyTotp(s, "12345", T), null);
    assert.equal(verifyTotp(s, "abcdef", T), null);
  });

  it("builds an otpauth address that apps understand", () => {
    const u = otpauthUrl("ABC234", "max@lab", "PodmanManager");
    assert.equal(u, "otpauth://totp/PodmanManager:max%40lab?secret=ABC234&issuer=PodmanManager&algorithm=SHA1&digits=6&period=30");
  });
});

describe("second factor of an account", () => {
  const setup = () => {
    const db = openDb(":memory:");
    const secret = generateSecret();
    const r = enableMfa("max", secret, codeAt(secret, T), T, db, KEY);
    assert.ok(r.ok);
    return { db, secret, codes: r.ok ? r.recoveryCodes : [] };
  };

  it("needs a valid code to switch on and then gives 10 recovery codes", () => {
    const db = openDb(":memory:");
    const s = generateSecret();
    assert.deepEqual(enableMfa("max", s, "000000", T, db, KEY), { ok: false, reason: "code" });
    assert.deepEqual(enableMfa("max", "!!", "000000", T, db, KEY), { ok: false, reason: "secret" });
    assert.equal(hasMfa("max", db), false);
    const r = enableMfa("max", s, codeAt(s, T), T, db, KEY);
    assert.ok(r.ok && r.recoveryCodes.length === 10 && r.recoveryCodes.every((c) => /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(c)));
    assert.deepEqual(mfaStatus("MAX", db), { enabled: true, recoveryLeft: 10 });
    assert.deepEqual(enableMfa("max", s, codeAt(s, T + 30_000), T + 30_000, db, KEY), { ok: false, reason: "exists" });
  });

  it("checks authenticator codes once only, also under parallel use", () => {
    const { db, secret } = setup();
    const next = T + 60_000;
    assert.deepEqual(verifySecondFactor("max", codeAt(secret, next), next, db, KEY), { ok: true, via: "totp" });
    assert.deepEqual(verifySecondFactor("max", codeAt(secret, next), next, db, KEY), { ok: false }, "the same code again");
    assert.deepEqual(verifySecondFactor("max", codeAt(secret, T), next, db, KEY), { ok: false }, "the code used while switching on is spent");
    assert.deepEqual(verifySecondFactor("max", "123456", next + 30_000, db, KEY), { ok: false });
    assert.deepEqual(verifySecondFactor("nobody", "123456", next, db, KEY), { ok: false });
  });

  it("accepts each recovery code once, ignoring case and the dash", () => {
    const { db, codes } = setup();
    assert.deepEqual(verifySecondFactor("max", codes[0]!.toLowerCase().replace("-", " "), T, db, KEY), { ok: true, via: "recovery" });
    assert.deepEqual(verifySecondFactor("max", codes[0]!, T, db, KEY), { ok: false });
    assert.equal(mfaStatus("max", db).recoveryLeft, 9);
    assert.deepEqual(verifySecondFactor("max", "AAAAA-AAAAA", T, db, KEY), { ok: false });
  });

  it("regenerates recovery codes (old ones stop) and can be switched off", () => {
    const { db, codes } = setup();
    const fresh = regenerateRecovery("max", db)!;
    assert.equal(fresh.length, 10);
    assert.deepEqual(verifySecondFactor("max", codes[1]!, T, db, KEY), { ok: false });
    assert.deepEqual(verifySecondFactor("max", fresh[1]!, T, db, KEY), { ok: true, via: "recovery" });
    disableMfa("max", db);
    assert.equal(hasMfa("max", db), false);
    assert.equal(regenerateRecovery("max", db), null);
  });

  it("with a different MASTER_SECRET_KEY only recovery codes still work", () => {
    const { db, secret, codes } = setup();
    const other = Buffer.alloc(32, 9);
    assert.deepEqual(verifySecondFactor("max", codeAt(secret, T + 120_000), T + 120_000, db, other), { ok: false });
    assert.deepEqual(verifySecondFactor("max", codes[2]!, T, db, other), { ok: true, via: "recovery" });
  });

  it("keeps a login between password and code for five minutes and five tries", () => {
    const db = openDb(":memory:");
    const tok = createPending("max", T, db);
    assert.deepEqual(getPending(tok, T + 1000, db), { username: "max" });
    assert.equal(getPending(tok, T + PENDING_TTL_MS + 1, db), null);
    assert.equal(getPending("nonsense", T, db), null);
    for (let i = 0; i < MAX_PENDING_ATTEMPTS; i++) failPending(tok, db);
    assert.equal(getPending(tok, T + 1000, db), null, "five wrong codes end it");
  });
});
