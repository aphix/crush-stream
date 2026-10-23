import * as THREE from "three";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { DeformableCar } from "./car.ts";
import { paint } from "./test-support.ts";

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
  sedan: {
    "boot outer rippleDeg": "the rolled tail corner's chords meet the tail fold's first ring (13°)",
    "boot inner rippleDeg": "the rolled corner's chords read from the fender side as the inner skin",
    "roof outer seamDeg": "the end cap's thin fan: one of its triangles tilts down 27° and reads from the hood, so the loft's end ring and the cap copy disagree",
  },
  police: {
    "boot outer rippleDeg": "as the sedan's",
    "boot inner rippleDeg": "as the sedan's",
    "roof outer seamDeg": "as the sedan's",
  },
  hatchback: {
    "doorL outer rippleDeg": "a concave row-edge where the shoulder rows meet the top roll, door columns z 0 to 0.31",
    "doorR outer rippleDeg": "as the left door",
    "roof outer seamDeg": "the end cap's thin fan, as the sedan's",
    "roof inner seamDeg": "the end cap's thin fan, as the sedan's",
  },
  coupe: {
    "hood outer rippleDeg": "the hood's rear 30 cm follows a belt that crests 1.3 cm at the cowl (profile stations 0.64, 0.73, 0.95)",
    "roof outer rippleDeg": "the roof's front end: yRoof, cabin and cabinHw ease between stations on a smoothstep, an S in every interval",
    "roof outer seamDeg": "the end cap's thin fan, as the sedan's",
    "roof inner shadeDeg": "the roof's headliner pinch at its front corners",
  },
  pickup: {
    "hood inner seamDeg": "the nose fold's first ring",
    "roof outer rippleDeg": "the roof's front end: the smoothstep between profile stations, as the coupe's",
    "roof outer seamDeg": "the end cap's thin fan, as the sedan's",
    "roof inner seamDeg": "the end cap's thin fan, as the sedan's",
  },
  monster: {
    "doorL inner rippleDeg": "the skin's top corners at the hinge cut (door.hingeTop 0.99 drops the top rows)",
    "doorR inner rippleDeg": "as the left door",
    "roof outer rippleDeg": "the roof's front end: the smoothstep between profile stations, as the coupe's",
    "roof outer shadeDeg": "the roof's end rings",
    "roof outer seamDeg": "the end cap's thin fan, as the sedan's",
    "roof inner shadeDeg": "the roof's end rings",
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
      assert.ok(isRippleTool(tool), "the script exports panelsOf, ripplesOf and RIPPLE_FLAG");
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
      assert.equal(over.join("; "), "", `${id}: a skin ripples past the bad level`);
      assert.equal(fixed.join("; "), "", `${id}: a listed open reading is clean now: drop it from OPEN`);
    });
  }
});
