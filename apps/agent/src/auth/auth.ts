import { createHash, timingSafeEqual } from "node:crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{16,512})$/.exec(header);
  return m ? (m[1] ?? null) : null;
}

export function verifyToken(header: string | undefined, expectedHashHex: string): boolean {
  const token = extractBearer(header);
  if (token === null) return false;
  const got = Buffer.from(hashToken(token), "hex");
  const want = Buffer.from(expectedHashHex, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Counts failed auth attempts per source IP in a sliding window. */
export class FailureLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(ip: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(ip) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.hits.delete(ip);
    else this.hits.set(ip, list);
    return list;
  }

  isBlocked(ip: string): boolean {
    return this.prune(ip).length >= this.max;
  }

  recordFailure(ip: string): void {
    const list = this.prune(ip);
    list.push(this.now());
    this.hits.set(ip, list);
  }

  reset(ip: string): void {
    this.hits.delete(ip);
  }
}
