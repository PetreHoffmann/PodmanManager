import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ICONS, type IconName } from "../src/components/icons-data";

// the components use the automatic JSX runtime of Next.js; the test runner compiles JSX to React.createElement
(globalThis as { React?: unknown }).React = React;
type Comp = (props: Record<string, unknown>) => React.ReactElement;
let Icon: Comp, HostsArt: Comp, ContainersArt: Comp, PodsArt: Comp;
before(async () => {
  Icon = (await import("../src/components/Icon")).default as unknown as Comp;
  const art = (await import("../src/components/Illustrations")) as unknown as Record<string, Comp>;
  HostsArt = art.HostsArt!;
  ContainersArt = art.ContainersArt!;
  PodsArt = art.PodsArt!;
});

describe("icons", () => {
  const names = Object.keys(ICONS) as IconName[];
  it("every icon is duotone markup from the package (line layer plus translucent layer), without scripts or links", () => {
    assert.ok(names.length >= 30);
    for (const n of names) {
      const m = ICONS[n];
      assert.ok(m.startsWith("<path"), n);
      assert.ok(m.includes('class="duo"'), n + " has a second (translucent) layer");
      assert.ok(!/<script|on\w+=|href=|<use|<image/i.test(m), n);
    }
  });

  it("renders decorative, accent-colored icons that are hidden on phones unless asked otherwise", () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: "play" }));
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /icon-ok/, "start is green");
    assert.match(html, /hidden md:inline-block/);
    assert.match(renderToStaticMarkup(createElement(Icon, { name: "trash" })), /icon-bad/);
    assert.match(renderToStaticMarkup(createElement(Icon, { name: "stop", tone: "warn" })), /icon-warn/, "the tone can be overridden");
    const always = renderToStaticMarkup(createElement(Icon, { name: "cube", always: true }));
    assert.ok(always.includes("inline-block") && !always.includes("hidden md:inline-block"));
  });

  it("the dashboard illustrations are static, decorative SVGs", () => {
    for (const Art of [HostsArt, ContainersArt, PodsArt]) {
      const html = renderToStaticMarkup(createElement(Art, { className: "w-32" }));
      assert.ok(html.startsWith("<svg") && html.includes('aria-hidden="true"'));
      assert.ok(!/<animate|<script|<style|animation/i.test(html), "no animation");
    }
  });
});
