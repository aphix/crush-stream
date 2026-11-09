import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { INITIAL_HUD, type LookAtHud } from "./hud-store.ts";

/**
 * The panel is a .tsx file, which Node's own loader cannot read, so a Vite server in middleware mode compiles it for this file
 * (nothing is served or watched); the markup is React's own server render of the component the HUD mounts.
 */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PANEL = "/src/components/look-panel.tsx";

/** React's escaping of text in markup. */
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const escaped = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

describe("given the look-at panel the HUD mounts for the open world", () => {
  let server: ViteDevServer;
  let render: (lookAt: LookAtHud | null) => string;

  beforeAll(async () => {
    server = await createServer({
      root: ROOT,
      configFile: false,
      appType: "custom",
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false, watch: null },
      resolve: { alias: { "@": `${ROOT}src` } },
      optimizeDeps: { noDiscovery: true },
    });
    const module = await server.ssrLoadModule(PANEL);
    const LookPanel = module.LookPanel as FunctionComponent<{ lookAt: LookAtHud | null }>;
    render = (lookAt) => renderToStaticMarkup(createElement(LookPanel, { lookAt }));
  });

  afterAll(() => server.close());

  it("when the HUD starts, then the eye rests on nothing", () => {
    expect(INITIAL_HUD.lookAt).toBe(null);
  });

  it("when the HUD field is null, then the panel renders nothing", () => {
    expect(render(null)).toBe("");
  });

  it("when the field names a civilian, then the title and every line are in the panel, in order", () => {
    const lookAt = { title: "Rosa Kim, 34 · Cook at Sal's Diner", lines: ["hungry -> Sal's Diner", "left home", "started her shift"] };
    const markup = render(lookAt);
    const at = [lookAt.title, ...lookAt.lines].map((text) => markup.indexOf(escaped(text)));
    expect(at.every((index) => index >= 0), `every text is in the markup (found at ${at.join(", ")})`).toBe(true);
    expect(firstMismatch(at, [...at].sort((a, b) => a - b)), "title first, then the lines top to bottom").toBeUndefined();
  });

  it("when the field has a title and no lines, then the panel shows the title alone", () => {
    const markup = render({ title: "Bodega Supreme", lines: [] });
    expect(markup).toContain("Bodega Supreme");
    expect(markup).not.toContain("<li");
  });
});
