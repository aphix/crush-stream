import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { residentToolFiles, spineTools } from "./export-resident-tools.mjs";
import { ACTIVITIES, EVENT_KINDS, NEEDS, PURPOSES } from "../src/game/ai/civilians/resident-spine.ts";

describe("given the exported resident tool files", () => {
  // mutation: sed -i 's/about: "a car crashed into a building"/about: "a car hit a building"/' src/game/ai/civilians/resident-spine.ts
  it("when they are compared with a fresh build from the spine and the thought tools, then each is the same text", () => {
    for (const [file, text] of Object.entries(residentToolFiles())) expect(readFileSync(file, "utf8") === text, `${file} is stale: run node scripts/export-resident-tools.mjs`).toBe(true);
  });

  // mutation: sed -i 's/    ...Object.entries(EVENT_KINDS).map/    ...Object.entries({}).map/' scripts/export-resident-tools.mjs
  it("when the spine's tools are listed, then every purpose, activity and event kind is one tool, named once", () => {
    const names = spineTools().map((tool) => tool.name);
    expect(names.length, "tools").toBe(Object.keys(NEEDS).length + Object.keys(PURPOSES).length + Object.keys(ACTIVITIES).length + Object.keys(EVENT_KINDS).length);
    expect(new Set(names).size, "distinct names").toBe(names.length);
  });
});
