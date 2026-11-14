import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer | null {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret in base32 (32 characters), the size authenticator apps expect. */
export const generateSecret = (): string => base32Encode(randomBytes(20));

/** RFC 4226 HOTP. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const stepOf = (nowMs: number) => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * Checks a 6-digit code against the current step and one step either side (clock drift).
 * Returns the matched step, or null. A step at or below `lastStep` is refused, so a code works only once.
 */
export function verifyTotp(secretB32: string, code: string, nowMs: number, lastStep = 0): number | null {
  const secret = base32Decode(secretB32);
  const c = code.replace(/\s/g, "");
  if (!secret || !/^\d{6}$/.test(c)) return null;
  const now = stepOf(nowMs);
  let match: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const want = Buffer.from(hotp(secret, step));
    // all three are always compared: the time taken does not tell which step was close
    if (timingSafeEqual(want, Buffer.from(c)) && step > lastStep) match = step;
  }
  return match;
}

export function otpauthUrl(secretB32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
