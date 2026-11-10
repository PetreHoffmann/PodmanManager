import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import type { SessionInfo } from "./session-types";

const KEY = "hidden_containers";
export const MAX_PATTERNS = 100;
const PATTERN_RE = /^[a-z0-9._*?-]{1,128}$/;

/** "podman*" -> /^podman.*$/i  (only * and ? are wildcards; everything else is literal). */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}

export function isHidden(name: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(name));
}

export type ParseResult = { ok: true; patterns: string[] } | { ok: false; error: "err.hiddenPattern" | "err.hiddenLimit"; pattern?: string };

/** One pattern per line; blank lines and "#" comments are ignored; duplicates are merged. */
export function parsePatterns(text: string): ParseResult {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase();
    if (!line || line.startsWith("#")) continue;
    if (!PATTERN_RE.test(line)) return { ok: false, error: "err.hiddenPattern", pattern: raw.trim().slice(0, 40) };
    if (!out.includes(line)) out.push(line);
  }
  if (out.length > MAX_PATTERNS) return { ok: false, error: "err.hiddenLimit" };
  return { ok: true, patterns: out };
}

export function loadHiddenPatterns(db: DatabaseSync = getDb()): string[] {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!r) return [];
  try {
    const v = JSON.parse(r.value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && PATTERN_RE.test(x)).slice(0, MAX_PATTERNS) : [];
  } catch {
    return [];
  }
}

export function saveHiddenPatterns(patterns: string[], db: DatabaseSync = getDb()): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(patterns));
}

/** Patterns that apply to this session: none for users with full access. */
export function hiddenPatternsFor(session: SessionInfo, db: DatabaseSync = getDb()): string[] {
  return session.access === "all" ? [] : loadHiddenPatterns(db);
}

/** A pod is hidden from restricted users as soon as one of its containers matches a hidden pattern. */
export function isPodHidden(pod: { containers: readonly { name: string }[] }, patterns: readonly string[]): boolean {
  return patterns.length > 0 && pod.containers.some((c) => isHidden(c.name, patterns));
}
