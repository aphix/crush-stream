import { describe, expect, it } from "vitest";
import { MAT } from "../../kernel/material-ids.ts";
import { buildingPieces } from "../../present/facade-mesh.ts";
import { PREFAB, ROOFLINE } from "../constants.ts";
import { PREFABS } from "../catalog.ts";
import { faceBands, FACADE_FACE, isOpenStyle, OPEN_SIDE, roomPlaceOf, roomWindows } from "./facade-windows.ts";
import { buildingHeight, CORNICE_DEPTH, DEFAULT_STOREYS, levelsOf, MAX_STOREYS, MIN_STOREYS, OPENING, type InteriorPlan, type Opening } from "./interior-kinds.ts";
import { planInterior } from "./interior-plan.ts";
import { BAY, bayStackOf } from "./openworld-facade-solids.ts";
import { planBlocks } from "./openworld-blocks.ts";
import { layOutLots } from "./openworld-lots.ts";
import { LANE, LANELESS_BLOCKS } from "./openworld-programme.ts";
import type { InteriorKind, Place } from "./walk-graph.ts";

import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
const lots = layOutLots();
const plans = planBlocks(lots.geometry).playable;
const furnished = lots.places.filter((place) => place.interior !== undefined && place.doorNode === -1 && lots.places.indexOf(place) < lots.backdropStart);
/** A storey's nominal height (m), as the facade draws it above its ground band. */
const NOMINAL_STOREY = 3;
/** How far (m) an opening's edge may stand from its facade window's. */
const TOLERANCE = 0.03;
/** The lowest a window's sill may stand over its storey's floor (m): knee height for a room's, none for an office's curtain wall. */
const MIN_SILL: Record<InteriorKind, number> = { rowhome: 0.5, coffee: 0.5, bar: 0.5, office: 0, store: 0.5 };
const FACES = [FACADE_FACE.plusAcross, FACADE_FACE.street, FACADE_FACE.minusAcross, FACADE_FACE.back] as const;

/** The wall of `plan` on `face` at `level`: the street and back walls run across, the two party walls along the depth. */
function wallOn(plan: InteriorPlan, level: number, face: number) {
  return plan.walls.find((wall) => {
    if (wall.level !== level) return false;
    if (face === FACADE_FACE.street) return wall.axis === "across" && wall.fixed < plan.depth / 2;
    if (face === FACADE_FACE.back) return wall.axis === "across" && wall.fixed > plan.depth / 2;
    return wall.axis === "deep" && (face === FACADE_FACE.plusAcross ? wall.fixed > 0 : wall.fixed < 0);
  })!;
}

const covers = (opening: Opening, from: number, to: number, y0: number, y1: number, floor: number): boolean =>
  opening.centre - opening.width / 2 <= from + TOLERANCE && opening.centre + opening.width / 2 >= to - TOLERANCE && floor + opening.sill <= y0 + TOLERANCE && floor + opening.top >= y1 - TOLERANCE;

describe("given every place that has an interior", () => {
  // mutation: sed -i 's/this.crossWall(level, streetAt, -this.half, this.half, \[...doors, ...this.glazed(level, FACADE_FACE.street, streetAt), ...this.bayOpening(level)\], ground, SHELL_WALL);/this.crossWall(level, streetAt, -this.half, this.half, [...doors, ...this.bayOpening(level)], ground, SHELL_WALL);/' src/game/world/openworld/interior-draft.ts
  it("when each window its facade shows to a room is looked for in the room's wall, then an opening stands on the same face and storey, as wide and as tall within a few centimetres, with a pane of glass over it", () => {
    const missing: string[] = [];
    for (const place of furnished) {
      const plan = planInterior(place);
      const windows = roomWindows(roomPlaceOf(place)!);
      for (const window of windows) {
        const floor = plan.floors[window.level]!;
        const opening = wallOn(plan, window.level, window.face).openings.find((candidate) => candidate.kind === OPENING.window && covers(candidate, window.along0, window.along1, window.y0, window.y1, floor));
        if (opening === undefined) missing.push(`${place.name} face ${window.face} level ${window.level}: no opening at ${window.along0.toFixed(2)}..${window.along1.toFixed(2)}, ${window.y0.toFixed(2)}..${window.y1.toFixed(2)}`);
        const street = window.face === FACADE_FACE.street || window.face === FACADE_FACE.back;
        const glazed = plan.panes.some((pane) => pane.level === window.level && Math.abs(pane.y0 - window.y0) < TOLERANCE && Math.abs(pane.y1 - window.y1) < TOLERANCE && Math.abs(Math.min(street ? pane.across0 : pane.deep0, street ? pane.across1 : pane.deep1) - window.along0) < TOLERANCE);
        if (!glazed) missing.push(`${place.name} face ${window.face} level ${window.level}: no glass at ${window.along0.toFixed(2)}`);
      }
      expect(windows.length, `${place.name}: windows its rooms look out of`).toBeGreaterThan(0);
    }
    expect(missing.slice(0, 3).join("; "), "facade windows without an opening and glass").toBe("");
  });

  // mutation: sed -i 's/const BAY_SILL_ABOVE_FLOOR = 0.75;/const BAY_SILL_ABOVE_FLOOR = 0.1;/' src/game/world/openworld/interior-kinds.ts
  it("when every window of every room is measured against its storey's floor, then its sill stands at least a set height above it, and under its ceiling", () => {
    const low: string[] = [];
    for (const place of furnished) {
      const plan = planInterior(place);
      for (const window of roomWindows(roomPlaceOf(place)!)) {
        const sill = window.y0 - plan.floors[window.level]!;
        if (sill < MIN_SILL[place.interior!] - 1e-9) low.push(`${place.name} face ${window.face} level ${window.level}: sill ${sill.toFixed(2)} m over the floor`);
      }
      for (const [level, bay] of bayStackOf(place.storeys).floors.entries()) if (place.interior === "rowhome" && bay.sill - plan.floors[level]! < MIN_SILL.rowhome) low.push(`${place.name} bay ${level}: sill ${(bay.sill - plan.floors[level]!).toFixed(2)} m over the floor`);
    }
    expect(low.slice(0, 3).join("; "), "sills too low").toBe("");
  });
});

describe("given a rowhome's bay stack", () => {
  const home = furnished.find((place) => place.interior === "rowhome")!;
  const plan = planInterior(home);

  // mutation: sed -i 's/    if (this.kind !== "rowhome") return \[\];/    return [];/' src/game/world/openworld/interior-draft.ts
  it("when the street wall of each storey is read, then the room opens onto the bay's mouth from the floor up to the glass's head, with an alcove and three panes of glass round the bay's outline", () => {
    for (const [level, bay] of bayStackOf(home.storeys).floors.entries()) {
      const mouth = wallOn(plan, level, FACADE_FACE.street).openings.find((opening) => opening.kind === OPENING.bay);
      expect(mouth, `storey ${level} bay mouth`).toBeDefined();
      expect(mouth!.centre, `storey ${level} mouth centre`).toBeCloseTo(BAY.across, 6);
      expect(mouth!.width, `storey ${level} mouth width`).toBeCloseTo(BAY.width, 6);
      expect(plan.floors[level]! + mouth!.top, `storey ${level} mouth head`).toBeCloseTo(bay.head, 6);
      expect(plan.alcoves.filter((alcove) => alcove.level === level).length, `storey ${level} alcoves`).toBe(1);
      const panes = plan.panes.filter((pane) => pane.level === level && Math.min(pane.deep0, pane.deep1) < 0);
      expect(panes.length, `storey ${level} bay panes`).toBe(3);
      for (const pane of panes) expect(Math.abs(pane.y0 - bay.sill) + Math.abs(pane.y1 - bay.head), `storey ${level} pane heights off the bay window's`).toBeLessThan(1e-9);
    }
  });
});

describe("given the places at the ends of a block's faces", () => {
  const reach = lots.geometry.blockLength / 2;
  /** The block a place stands in (the blocks of a column share their centre's x). */
  const blockOf = (place: Place) => plans.reduce((best, block) => (hypot2(block.centreX - place.x, block.centreZ - place.z) < hypot2(best.centreX - place.x, best.centreZ - place.z) ? block : best));
  /** Whether the place's footprint touches its block's west or east end. */
  const atEnd = (place: Place): boolean => Math.abs(Math.abs(place.x - blockOf(place).centreX) + place.width / 2 - reach) < 1e-6;
  /** The lane lot of a place's block (none in a block without a lane). */
  const laneLotOf = (place: Place) => {
    const block = blockOf(place);
    if (LANELESS_BLOCKS.some((laneless) => laneless.row === block.row && laneless.column === block.column)) return undefined;
    return block.lots.find((lot) => lot.face === LANE.face && lot.index === LANE.at);
  };
  /** Whether the place's footprint touches the lane of its block, on the lane's own face. */
  const besideLane = (place: Place): boolean => {
    const lane = laneLotOf(place);
    if (lane === undefined || Math.abs(place.z - (lane.house.z0 + lane.house.z1) / 2) > TOLERANCE) return false;
    return Math.abs(place.x + place.width / 2 - lane.lot.x0) < 1e-6 || Math.abs(place.x - place.width / 2 - lane.lot.x1) < 1e-6;
  };

  // mutation: sed -i 's/return ((north ? east : west) ? OPEN_SIDE.plusAcross : 0) | ((north ? west : east) ? OPEN_SIDE.minusAcross : 0);/return ((north ? west : east) ? OPEN_SIDE.plusAcross : 0) | ((north ? east : west) ? OPEN_SIDE.minusAcross : 0);/' src/game/world/openworld/openworld-lots.ts
  it("when each place's open sides are read, then exactly the places at a block's end or beside its lane have one, and it stands on the block's end or the lane's edge", () => {
    let corners = 0;
    let lanesides = 0;
    for (const place of furnished) {
      const sides = [OPEN_SIDE.plusAcross, OPEN_SIDE.minusAcross].filter((side) => ((place.openSides ?? 0) & side) !== 0);
      expect(sides.length > 0, `${place.name} open side where it ends a block or stands by the lane`).toBe(atEnd(place) || besideLane(place));
      if (atEnd(place)) corners++;
      if (besideLane(place)) lanesides++;
      for (const side of sides) {
        const x = place.x + detSin(place.yaw) * (side === OPEN_SIDE.plusAcross ? 1 : -1) * (place.width / 2);
        const lane = laneLotOf(place);
        const onLane = lane !== undefined && (Math.abs(x - lane.lot.x0) < 1e-6 || Math.abs(x - lane.lot.x1) < 1e-6);
        expect(Math.abs(Math.abs(x - blockOf(place).centreX) - reach) < 1e-6 || onLane, `${place.name}: the open side stands on the block's end or the lane's edge`).toBe(true);
      }
    }
    expect(corners, "places at a block's end").toBeGreaterThan(0);
    expect(lanesides, "places beside a lane").toBeGreaterThan(0);
  });

  // mutation: sed -i 's/      this.spineWall(level, sideAt, STREET_SKIN, this.depth - STREET_SKIN, this.glazed(level, face, sideAt), ground, PARTY_WALL);/      this.spineWall(level, sideAt, STREET_SKIN, this.depth - STREET_SKIN, [], ground, PARTY_WALL);/' src/game/world/openworld/interior-draft.ts
  it("when the side walls of an end-of-terrace house and a mid-terrace one are read, then the open side has windows on every storey and a side with a neighbour has none", () => {
    const corner = furnished.find((place) => place.interior === "rowhome" && atEnd(place) && place.openSides === OPEN_SIDE.minusAcross)!;
    const middle = furnished.find((place) => place.interior === "rowhome" && place.openSides === undefined)!;
    const cornerPlan = planInterior(corner);
    const middlePlan = planInterior(middle);
    for (let level = 0; level < cornerPlan.floors.length; level++) {
      expect(wallOn(cornerPlan, level, FACADE_FACE.minusAcross).openings.filter((opening) => opening.kind === OPENING.window).length, `corner house side windows on storey ${level}`).toBeGreaterThan(0);
      expect(wallOn(cornerPlan, level, FACADE_FACE.plusAcross).openings.length, `corner house party wall openings on storey ${level}`).toBe(0);
    }
    for (let level = 0; level < middlePlan.floors.length; level++) {
      for (const face of [FACADE_FACE.plusAcross, FACADE_FACE.minusAcross]) expect(wallOn(middlePlan, level, face).openings.length, `mid-terrace party wall openings on storey ${level}`).toBe(0);
    }
  });
});

describe("given the window table's bands and the drawn building", () => {
  const styles = ["rowbrick", "rowpainted", "coffee", "bar", "office", "cornerstore"] as const;
  const BLOCK_HEIGHT = PREFABS[PREFAB.building].size[1];

  /** The y ranges (block metres) a face of the drawn building is cut into above the ground. */
  function drawnBands(style: (typeof styles)[number], face: number, storeys: number): [number, number][] {
    const out: [number, number][] = [];
    for (const piece of buildingPieces(style, MAT.BUILDING_WALL, false, storeys)) {
      const normal = piece[0].getAttribute("normal");
      const turned = (face * Math.PI) / 2;
      if (Math.abs(normal.getX(0) - detSin(turned)) > 1e-6 || Math.abs(normal.getZ(0) - detCos(turned)) > 1e-6) continue;
      piece[0].computeBoundingBox();
      const { min, max } = piece[0].boundingBox!;
      if (max.y > 0 && max.y < ROOFLINE + 1e-6 && Math.abs(max.x - min.x) + Math.abs(max.z - min.z) > 1) out.push([min.y, max.y]);
    }
    return out;
  }

  // mutation: sed -i 's/const sideBays = Math.max(1, Math.round((LAYOUT.houseDepth \* bays) \/ (STYLE_LOTS\[style\] \* LAYOUT.lotFrontage)));/const sideBays = bays;/' src/game/world/openworld/facade-windows.ts
  it("when each style's faces are drawn for every storey count, then every band the table lists is a band of the drawn face, a side face holds more bays than the street, and the roofline closes it", () => {
    for (const style of styles) {
      expect(isOpenStyle(style), `${style} is an open style`).toBe(true);
      for (const storeys of [MIN_STOREYS, DEFAULT_STOREYS, MAX_STOREYS]) {
        for (const face of FACES) {
          const drawn = drawnBands(style, face, storeys);
          for (const band of faceBands(style, face, storeys).bands) {
            expect(drawn.some(([y0, y1]) => Math.abs(y0 - band.y0) < 1e-4 && Math.abs(y1 - band.y1) < 1e-4), `${style} x${storeys} face ${face}: band ${band.y0.toFixed(2)}..${band.y1.toFixed(2)} drawn`).toBe(true);
          }
        }
        expect(faceBands(style, FACADE_FACE.plusAcross, storeys).bays, `${style} x${storeys} side bays`).toBeGreaterThan(faceBands(style, FACADE_FACE.street, storeys).bays);
        const bands = faceBands(style, FACADE_FACE.minusAcross, storeys).bands;
        expect(bands[bands.length - 1]!.y1, `${style} x${storeys} roofline`).toBeCloseTo(ROOFLINE, 6);
      }
    }
  });

  // mutation: sed -i 's/  const repeat = (corniceFoot - ground) \/ (storeys - 1);/  const repeat = STOREY;/' src/game/world/openworld/interior-kinds.ts (the storeys no longer fill the height between the ground band and the cornice)
  it("when a street face is read at every storey count in the building's own metres, then its ground band is the ground storey, its storeys are about three metres each and its cornice is the cornice's depth", () => {
    for (const style of styles) {
      const shop = style === "coffee" || style === "bar" || style === "office" || style === "cornerstore";
      for (const storeys of [MIN_STOREYS, DEFAULT_STOREYS, MAX_STOREYS]) {
        const toMetres = buildingHeight(storeys, shop) / BLOCK_HEIGHT;
        const [ground, floors, cornice] = faceBands(style, FACADE_FACE.street, storeys).bands;
        expect(ground!.y1 * toMetres, `${style} x${storeys} ground band (m)`).toBeCloseTo(shop ? 4 : 3.6, 6);
        expect(((floors!.y1 - floors!.y0) * toMetres) / floors!.v1, `${style} x${storeys} one storey (m)`).toBeCloseTo(NOMINAL_STOREY, 0);
        expect(floors!.v1, `${style} x${storeys} repeats of the storey layer`).toBe(storeys - 1);
        expect((cornice!.y1 - cornice!.y0) * toMetres, `${style} x${storeys} cornice (m)`).toBeCloseTo(CORNICE_DEPTH, 6);
      }
    }
  });

  // mutation: sed -i 's/  const plinth = block(levelsOf(STYLE_INTERIOR\[style\], storeys).floors\[0\]!);/  const plinth = block(0.5);/' src/game/world/openworld/facade-windows.ts
  it("when a side face's plinth is read in the building's own metres, then it stands on the interior's raised ground floor, so its windows sit over the floor", () => {
    for (const place of furnished) {
      if (!isOpenStyle(place.style)) continue;
      const plinth = faceBands(place.style, FACADE_FACE.plusAcross, place.storeys).bands[0]!;
      const height = buildingHeight(place.storeys, place.interior !== "rowhome");
      expect((plinth.y1 * height) / BLOCK_HEIGHT, `${place.name}: plinth top in metres`).toBeCloseTo(levelsOf(place.interior!, place.storeys).floors[0]!, 6);
    }
  });
});
