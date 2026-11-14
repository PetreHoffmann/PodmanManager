/** Minimal CBOR reader for WebAuthn: integers, byte/text strings, arrays, maps, booleans, null. No indefinite lengths, no floats. */
export type Cbor = number | bigint | string | Buffer | boolean | null | Cbor[] | Map<Cbor, Cbor>;

export class CborError extends Error {}

const MAX_DEPTH = 8;
const MAX_ITEMS = 1000;

export function decodeCbor(buf: Buffer, offset = 0): { value: Cbor; end: number } {
  let pos = offset;
  let items = 0;
  const need = (n: number) => {
    if (pos + n > buf.length) throw new CborError("truncated");
  };
  const readLen = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) { need(1); return buf[pos++]!; }
    if (info === 25) { need(2); const v = buf.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { need(4); const v = buf.readUInt32BE(pos); pos += 4; return v; }
    throw new CborError("unsupported length");
  };
  const item = (depth: number): Cbor => {
    if (depth > MAX_DEPTH || ++items > MAX_ITEMS) throw new CborError("too complex");
    need(1);
    const b = buf[pos++]!;
    const major = b >> 5;
    const info = b & 31;
    if (info === 31) throw new CborError("indefinite length");
    switch (major) {
      case 0: return readLen(info);
      case 1: return -1 - readLen(info);
      case 2: { const n = readLen(info); need(n); const v = Buffer.from(buf.subarray(pos, pos + n)); pos += n; return v; }
      case 3: { const n = readLen(info); need(n); const v = buf.subarray(pos, pos + n).toString("utf8"); pos += n; return v; }
      case 4: { const n = readLen(info); if (n > MAX_ITEMS) throw new CborError("too long"); const a: Cbor[] = []; for (let i = 0; i < n; i++) a.push(item(depth + 1)); return a; }
      case 5: { const n = readLen(info); if (n > MAX_ITEMS) throw new CborError("too long"); const m = new Map<Cbor, Cbor>(); for (let i = 0; i < n; i++) { const k = item(depth + 1); m.set(k, item(depth + 1)); } return m; }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new CborError("unsupported simple value");
      default: throw new CborError("unsupported type");
    }
  };
  const value = item(0);
  return { value, end: pos };
}
