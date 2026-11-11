import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { MAX_LOGO_BYTES, MAX_TEXT_CHARS, clearLogo, detectImage, loadBranding, loadLogo, normalizeText, saveLogo, saveText } from "../src/lib/branding";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]);
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>');

describe("navbar text", () => {
  it("trims, collapses whitespace, strips control characters, limits the length; empty means default", () => {
    assert.equal(normalizeText("  Acme \t Ops \n Console  "), "Acme Ops Console");
    assert.equal(normalizeText("a\u0000b\u2028c"), "a b c");
    assert.equal(normalizeText("   "), null);
    assert.equal(normalizeText(""), null);
    assert.equal([...normalizeText("x".repeat(100))!].length, MAX_TEXT_CHARS);
    assert.equal(normalizeText("Prod 🚀 Cluster"), "Prod 🚀 Cluster");
  });
});

describe("logo type detection", () => {
  it("accepts PNG, JPEG, GIF, WebP and plain SVG by content", () => {
    assert.equal(detectImage(PNG), "image/png");
    assert.equal(detectImage(JPG), "image/jpeg");
    assert.equal(detectImage(GIF), "image/gif");
    assert.equal(detectImage(WEBP), "image/webp");
    assert.equal(detectImage(SVG), "image/svg+xml");
    assert.equal(detectImage(Buffer.from("﻿  <svg xmlns='http://www.w3.org/2000/svg'></svg>")), "image/svg+xml");
  });
  it("rejects everything else, including active SVG content", () => {
    for (const bad of [Buffer.alloc(0), Buffer.from("hello"), Buffer.from("<html><body>x</body></html>"), Buffer.from("MZ\u0090\u0000"), Buffer.from("%PDF-1.7"),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="x"/></foreignObject></svg>'),
      Buffer.from('<svg><a href="javascript:alert(1)"><text>x</text></a></svg>'),
      Buffer.from("<!DOCTYPE x [<!ENTITY a 'b'>]><svg></svg>")]) {
      assert.equal(detectImage(bad), null, bad.toString("latin1").slice(0, 30));
    }
  });
});

describe("branding storage", () => {
  it("defaults to no text and no logo", () => {
    assert.deepEqual(loadBranding(openDb(":memory:")), { text: null, logo: null });
  });
  it("stores text and logo, returns the logo bytes with a cache-busting id, and resets", () => {
    const db = openDb(":memory:");
    saveText("Acme Ops", db);
    assert.deepEqual(saveLogo(PNG, db), { ok: true });
    const b = loadBranding(db);
    assert.equal(b.text, "Acme Ops");
    assert.match(b.logo ?? "", /^[0-9a-f]{16}$/);
    const l = loadLogo(db)!;
    assert.equal(l.mime, "image/png");
    assert.ok(l.data.equals(PNG));
    assert.equal(l.v, b.logo);
    saveLogo(JPG, db);
    assert.notEqual(loadBranding(db).logo, b.logo, "new logo -> new id");
    clearLogo(db);
    saveText(null, db);
    assert.deepEqual(loadBranding(db), { text: null, logo: null });
    assert.equal(loadLogo(db), null);
  });
  it("refuses oversized and non-image data without changing the stored logo", () => {
    const db = openDb(":memory:");
    saveLogo(PNG, db);
    const before = loadBranding(db).logo;
    assert.deepEqual(saveLogo(Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]), db), { ok: false, error: "err.brandTooLarge" });
    assert.deepEqual(saveLogo(Buffer.from("not an image"), db), { ok: false, error: "err.brandType" });
    assert.equal(loadBranding(db).logo, before);
  });
  it("re-checks stored data on read (tampered database never serves active content)", () => {
    const db = openDb(":memory:");
    const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    db.prepare("INSERT INTO settings (key, value) VALUES ('brand_logo', ?)").run(JSON.stringify({ mime: "image/svg+xml", b64: evil.toString("base64"), v: "abc" }));
    assert.equal(loadLogo(db), null);
    db.prepare("UPDATE settings SET value = 'garbage' WHERE key = 'brand_logo'").run();
    assert.equal(loadLogo(db), null);
    assert.equal(loadBranding(db).logo, null);
  });
});
