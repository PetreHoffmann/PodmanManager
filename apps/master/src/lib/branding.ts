import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { getDb } from "../database/db";
import { APP_NAME } from "./brand";

const TEXT_KEY = "brand_text";
const LOGO_KEY = "brand_logo";
export const MAX_LOGO_BYTES = 512 * 1024;
export const MAX_TEXT_CHARS = 40;

export type LogoMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";

export interface Branding {
  /** custom navbar text, or null for the default */
  text: string | null;
  /** cache-busting id of the uploaded logo, or null if there is none */
  logo: string | null;
}

export const DEFAULT_BRANDING: Branding = { text: null, logo: null };
export const brandText = (b: Branding): string => b.text ?? APP_NAME;

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Trims, collapses whitespace, drops control characters, limits the length. Empty -> null (default text). */
export function normalizeText(input: string): string | null {
  const t = [...input.replace(CTRL, " ").replace(/\s+/g, " ").trim()].slice(0, MAX_TEXT_CHARS).join("").trim();
  return t === "" ? null : t;
}

const SVG_FORBIDDEN = /<script|\son[a-z]+\s*=|javascript:|<foreignObject|<iframe|<embed|<object|<!ENTITY/i;

/** Recognizes the image type from its content (never from the file name or the browser-supplied type). */
export function detectImage(buf: Buffer): LogoMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  const head = buf.subarray(0, 4096).toString("utf8").replace(/^﻿/, "").trimStart();
  if ((head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!--") || head.startsWith("<!DOCTYPE svg")) && /<svg[\s>]/i.test(buf.toString("utf8"))) {
    return SVG_FORBIDDEN.test(buf.toString("utf8")) ? null : "image/svg+xml";
  }
  return null;
}

export function loadBranding(db: DatabaseSync = getDb()): Branding {
  const get = (k: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value;
  const text = get(TEXT_KEY);
  let logo: string | null = null;
  const l = get(LOGO_KEY);
  if (l) {
    try {
      const o = JSON.parse(l) as { v?: unknown };
      if (typeof o.v === "string") logo = o.v;
    } catch {
      /* ignore broken value */
    }
  }
  return { text: text ? normalizeText(text) : null, logo };
}

export function loadLogo(db: DatabaseSync = getDb()): { mime: LogoMime; data: Buffer; v: string } | null {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(LOGO_KEY) as { value: string } | undefined;
  if (!r) return null;
  try {
    const o = JSON.parse(r.value) as { mime?: unknown; b64?: unknown; v?: unknown };
    if (typeof o.b64 !== "string" || typeof o.v !== "string") return null;
    const data = Buffer.from(o.b64, "base64");
    const mime = detectImage(data); // re-check on every read, never trust the stored type
    return mime ? { mime, data, v: o.v } : null;
  } catch {
    return null;
  }
}

const put = (db: DatabaseSync, k: string, v: string) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export function saveText(text: string | null, db: DatabaseSync = getDb()): void {
  if (text === null) db.prepare("DELETE FROM settings WHERE key = ?").run(TEXT_KEY);
  else put(db, TEXT_KEY, text);
}

export type SaveLogoResult = { ok: true } | { ok: false; error: "err.brandTooLarge" | "err.brandType" };

export function saveLogo(data: Buffer, db: DatabaseSync = getDb()): SaveLogoResult {
  if (data.length > MAX_LOGO_BYTES) return { ok: false, error: "err.brandTooLarge" };
  const mime = detectImage(data);
  if (!mime) return { ok: false, error: "err.brandType" };
  const v = createHash("sha256").update(data).digest("hex").slice(0, 16);
  put(db, LOGO_KEY, JSON.stringify({ mime, b64: data.toString("base64"), v }));
  return { ok: true };
}

export function clearLogo(db: DatabaseSync = getDb()): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(LOGO_KEY);
}
