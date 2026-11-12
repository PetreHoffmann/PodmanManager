import type { DatabaseSync } from "node:sqlite";
import type { CacheItem, CacheProvider } from "@node-saml/node-saml";
import { getDb } from "../database/db";

/** Request ids are accepted for this long after the login was started. */
export const REQUEST_TTL_MS = 8 * 60 * 1000;

/**
 * node-saml cache in the database: remembers the ids of login requests (so that a response is only accepted
 * for a request this master made, and only once) and the ids of assertions (replay protection). The master may
 * run several server bundles, so process memory would not be shared reliably.
 */
export class DbCacheProvider implements CacheProvider {
  constructor(private readonly db: DatabaseSync = getDb(), private readonly now: () => number = Date.now) {}

  private purge(): void {
    this.db.prepare("DELETE FROM saml_cache WHERE expires_at <= ?").run(this.now());
  }

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    this.purge();
    const t = this.now();
    this.db.prepare("INSERT INTO saml_cache (key, value, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at, expires_at = excluded.expires_at").run(key, value, t, t + REQUEST_TTL_MS);
    return { value, createdAt: t };
  }

  async getAsync(key: string): Promise<string | null> {
    const r = this.db.prepare("SELECT value FROM saml_cache WHERE key = ? AND expires_at > ?").get(key, this.now()) as { value: string } | undefined;
    return r?.value ?? null;
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (key === null) return null;
    return this.consumeAsync(key);
  }

  /** Removes the key and returns its value in one step: of two copies of a response only one gets it. */
  async consumeAsync(key: string): Promise<string | null> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = this.db.prepare("SELECT value FROM saml_cache WHERE key = ? AND expires_at > ?").get(key, this.now()) as { value: string } | undefined;
      this.db.prepare("DELETE FROM saml_cache WHERE key = ?").run(key);
      this.db.exec("COMMIT");
      return r?.value ?? null;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** true if saved, false if the key was already present (and not expired). */
  async saveIfAbsentAsync(key: string, value: string, expiresAtMs: number): Promise<boolean> {
    this.purge();
    const r = this.db.prepare("INSERT OR IGNORE INTO saml_cache (key, value, created_at, expires_at) VALUES (?, ?, ?, ?)").run(key, value, this.now(), expiresAtMs);
    return Number(r.changes) === 1;
  }
}
