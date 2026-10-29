import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { DeformableCar } from "./car.ts";
import { paint } from "./test-support.ts";
import { must } from "../kernel/must.test-util.ts";

/** The rest-ripple check's measure (`scripts/contour-ripples.mjs`): each skin of a panel read for gentle folds each way side by side, normals its faces do not give, and split normals its faces do not account for. */
interface Skin {
  rippleDeg: number;
  shadeDeg: number;
  seamDeg: number;
}
interface RippleTool {
  panelsOf(car: DeformableCar): unknown;
  ripplesOf(panels: unknown): { panels: Record<string, Record<"outer" | "inner", Skin>> };
  RIPPLE_FLAG: Record<`${keyof Skin}`, readonly [mild: number, bad: number]>;
}

const PANELS = ["hood", "boot", "doorL", "doorR", "roof"] as const;
const SKINS = ["outer", "inner"] as const;
const KINDS = ["rippleDeg", "shadeDeg", "seamDeg"] as const;

/**
 * The readings still past the bad level, each with the cause found and who takes it. A listed one is held to staying past it (fixing one
 * removes its line); an unlisted one must stay under it.
 */
const OPEN: Readonly<Partial<Record<CarStyleId, Readonly<Record<string, string>>>>> = {
  hatchback: {
    "doorL outer rippleDeg": "a concave row-edge where the shoulder rows meet the top roll, door columns z 0 to 0.31",
    "doorR outer rippleDeg": "as the left door",
  },
};

function isRippleTool(tool: unknown): tool is RippleTool {
  return typeof tool === "object" && tool !== null && "panelsOf" in tool && typeof tool.panelsOf === "function" && "ripplesOf" in tool && typeof tool.ripplesOf === "function" && "RIPPLE_FLAG" in tool;
}

describe("given every body style as built and undeformed", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s lids, doors and roof are read skin by skin, then none ripples past the bad level but the readings listed as open, and those are still past it`, async () => {
      // Imported at run time: a static import would pull the script into tsc's strict checkJs program.
      const tool: unknown = await import(new URL("../../../scripts/contour-ripples.mjs", import.meta.url).href);
      must(isRippleTool(tool), "the script exports panelsOf, ripplesOf and RIPPLE_FLAG");
      const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
      const { panels } = tool.ripplesOf(tool.panelsOf(car));
      const open = OPEN[id] ?? {};
      const over: string[] = [];
      const fixed: string[] = [];
      for (const panel of PANELS) {
        for (const skin of SKINS) {
          for (const kind of KINDS) {
            const reading = panels[panel]![skin][kind];
            const key = `${panel} ${skin} ${kind}`;
            const past = reading >= tool.RIPPLE_FLAG[kind][1];
            if (past && open[key] === undefined) over.push(`${key} ${reading}°`);
            if (!past && open[key] !== undefined) fixed.push(`${key} ${reading}°`);
          }
        }
      }
      expect(over.join("; "), `${id}: a skin ripples past the bad level`).toBe("");
      expect(fixed.join("; "), `${id}: a listed open reading is clean now: drop it from OPEN`).toBe("");
    });
  }
});
