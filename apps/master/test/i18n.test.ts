import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LANGS, dicts, errText, lastErrText, makeT, pickLang, statusLabel } from "../src/lib/i18n";

const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("i18n", () => {
  it("all languages have identical, non-empty keys and placeholders", () => {
    const base = Object.keys(dicts.en).sort();
    for (const l of LANGS) {
      assert.deepEqual(Object.keys(dicts[l]).sort(), base, l);
      for (const k of base) {
        const v = (dicts[l] as Record<string, string>)[k]!;
        assert.ok(v.trim().length > 0, `${l}:${k} empty`);
        assert.equal(ph(v), ph((dicts.en as Record<string, string>)[k]!), `${l}:${k} placeholders`);
      }
    }
  });
  it("translations differ from English for de/ro/es on key UI strings", () => {
    for (const l of ["de", "ro", "es"] as const) {
      assert.notEqual(dicts[l]["hosts.add"], dicts.en["hosts.add"], l);
      assert.notEqual(dicts[l]["set.logout"], dicts.en["set.logout"], l);
    }
  });
  it("interpolates", () => {
    assert.equal(makeT("de")("hosts.removeQ", { name: "x" }), "x entfernen?");
    assert.equal(makeT("es")("act.stopQ", { name: "web" }), "¿Detener «web»?");
  });
  it("picks language from Accept-Language", () => {
    assert.equal(pickLang("de-DE,de;q=0.9,en;q=0.8"), "de");
    assert.equal(pickLang("fr,ro;q=0.7,en;q=0.5"), "ro");
    assert.equal(pickLang("es-MX"), "es");
    assert.equal(pickLang("fr-FR"), "en");
    assert.equal(pickLang(null), "en");
    assert.equal(pickLang("de;q=0,en"), "en");
  });
  it("translates error codes and unknown values gracefully", () => {
    const t = makeT("de");
    assert.equal(errText(t, "SOCKET_MISSING"), "Podman-Socket nicht gefunden");
    assert.equal(errText(t, "PODMAN_API_ERROR", "boom"), "Podman-API-Fehler: boom");
    assert.equal(errText(t, "UNREACHABLE", "ECONNREFUSED"), "Agent nicht erreichbar (ECONNREFUSED)");
    assert.equal(errText(t, "UNREACHABLE", "Agent not reachable"), "Agent nicht erreichbar");
    assert.equal(lastErrText(t, "UNREACHABLE: ENOTFOUND"), "Agent nicht erreichbar (ENOTFOUND)");
    assert.equal(errText(t, "WEIRD", "raw msg"), "raw msg");
    assert.equal(lastErrText(t, "TIMEOUT: Agent did not respond in time"), "Agent hat nicht rechtzeitig geantwortet");
    assert.equal(statusLabel(t, "running"), "läuft");
    assert.equal(statusLabel(t, "weird"), "weird");
  });
});
