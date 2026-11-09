import * as THREE from "three";
import { afterAll, describe, expect, it } from "vitest";
import { BAY, BAY_FLOORS, DOOR, BLOCK_FACE_HALF, homeFrontages, STOOP } from "../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { buildBayGeometry, buildCorniceGeometry, buildRailingGeometry, buildStoopGeometry } from "./facade-bay-parts.ts";
import { FacadeBays, HOUSE_ACCENTS, tintedColorVertex } from "./facade-bays.ts";
import { ATLAS_SIZE, KIT_CELL, paintKit, type UvRect } from "./facade-kit-atlas.ts";
import { HALF } from "./facade-mesh.ts";

const lots = layOutLots();
const frontages = homeFrontages(lots.places.slice(0, lots.backdropStart));
const EPSILON = 1e-6;
/** The door hole the facade art cuts, half its width (m). */
const DOOR_HOLE_HALF_WIDTH = 0.5;
/** The most triangles one rowhome's kit may cost: four meshes, each drawn once per house. */
const TRIANGLES_PER_HOME_MAX = 400;

type Extent = { minX: number; maxX: number; maxZ: number; count: number };

/** The x range and the furthest z of the vertices at height `y`. */
function extentAt(geometry: THREE.BufferGeometry, y: number): Extent {
  const position = geometry.getAttribute("position");
  const extent: Extent = { minX: Infinity, maxX: -Infinity, maxZ: -Infinity, count: 0 };
  for (let at = 0; at < position.count; at++) {
    if (Math.abs(position.getY(at) - y) > EPSILON) continue;
    extent.minX = Math.min(extent.minX, position.getX(at));
    extent.maxX = Math.max(extent.maxX, position.getX(at));
    extent.maxZ = Math.max(extent.maxZ, position.getZ(at));
    extent.count++;
  }
  return extent;
}

describe("given the bay stack of a rowhome", () => {
  const bay = buildBayGeometry();

  // mutation: sed -i 's/ring(builder, floor.sill, floor.head, 0, WINDOW_CELLS, WHITE, FIXED);/ring(builder, floor.sill, floor.head, floor.sill > 5 ? 0.2 : 0, WINDOW_CELLS, WHITE, FIXED);/' src/game/present/facade-bay-parts.ts
  it("when each floor's bay is measured at its sill, then every one has the same x range and projection, centred over the door", () => {
    for (const [at, floor] of BAY_FLOORS.entries()) {
      const extent = extentAt(bay, floor.sill);
      expect(extent.count, `vertices at floor ${at}'s sill`).toBeGreaterThan(0);
      expect(extent.maxX - extent.minX, `width of floor ${at}'s bay (m)`).toBeCloseTo(BAY.width, 6);
      expect(extent.maxX + extent.minX, `floor ${at}'s bay off the door's line (m)`).toBeCloseTo(0, 6);
      expect(extent.maxZ, `projection of floor ${at}'s bay (m)`).toBeCloseTo(BAY.out, 6);
    }
    expect(BAY_FLOORS.length, "floors with a bay").toBeGreaterThanOrEqual(2);
  });

  it("when each floor's belt band is measured at its window's head, then every floor's is the same and sits over the hood's footprint", () => {
    const hood = extentAt(bay, BAY.bottom);
    expect(hood.count, "vertices at the hood's underside").toBeGreaterThan(0);
    expect(hood.maxX + hood.minX, "hood off the door's line (m)").toBeCloseTo(0, 6);
    const first = extentAt(bay, BAY_FLOORS[0]!.head);
    for (const [at, floor] of BAY_FLOORS.entries()) {
      const belt = extentAt(bay, floor.head);
      expect(belt.maxX - belt.minX, `belt of floor ${at} against floor 0 (m)`).toBeCloseTo(first.maxX - first.minX, 6);
      expect(belt.maxZ, `belt projection of floor ${at} against floor 0 (m)`).toBeCloseTo(first.maxZ, 6);
      expect(belt.maxX - belt.minX, `belt of floor ${at} wider than the hood (m)`).toBeGreaterThanOrEqual(hood.maxX - hood.minX - EPSILON);
    }
  });
});

describe("given the stoop and its railing", () => {
  const stoop = buildStoopGeometry();
  const railing = buildRailingGeometry();

  /** The heights of the vertices of `geometry` on the landing's front edge. */
  function heightsAtLandingEdge(geometry: THREE.BufferGeometry): number[] {
    const position = geometry.getAttribute("position");
    const heights: number[] = [];
    for (let at = 0; at < position.count; at++) if (Math.abs(position.getZ(at) - STOOP.landing) < EPSILON) heights.push(position.getY(at));
    return heights;
  }

  // mutation: sed -i 's/const STOOP_STEPS = 5;/const STOOP_STEPS = 4;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the landing is measured, then its top is the door sill and the railing stands on it", () => {
    const stoopTop = Math.max(...heightsAtLandingEdge(stoop));
    const railBase = Math.min(...heightsAtLandingEdge(railing));
    expect(stoopTop, "top of the stoop at the landing (m)").toBeCloseTo(DOOR.sill, 6);
    expect(railBase, "bottom of the railing at the landing (m)").toBeCloseTo(DOOR.sill, 6);
  });

  // mutation: sed -i 's/const DOOR_HALF_WIDTH = 0.5;/const DOOR_HALF_WIDTH = 0.3;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when every piece's vertices are tested against the facade's door hole, then none stands in the hole and the jambs stand at its edges", () => {
    let inside = 0;
    let atEdge = 0;
    for (const geometry of [buildBayGeometry(), stoop, railing, buildCorniceGeometry()]) {
      const position = geometry.getAttribute("position");
      for (let at = 0; at < position.count; at++) {
        const across = Math.abs(position.getX(at));
        const height = position.getY(at);
        const betweenSillAndHead = height > DOOR.sill + EPSILON && height < DOOR.head - EPSILON;
        const withinHoleHeight = height > DOOR.sill - EPSILON && height < DOOR.head + EPSILON;
        if (betweenSillAndHead && across < DOOR_HOLE_HALF_WIDTH - EPSILON && position.getZ(at) < STOOP.landing) inside++;
        if (withinHoleHeight && Math.abs(across - DOOR_HOLE_HALF_WIDTH) < EPSILON) atEdge++;
      }
    }
    expect(atEdge, "jamb vertices on the hole's edges").toBeGreaterThan(0);
    expect(inside, "vertices inside the hole").toBe(0);
  });
});

describe("given the kit made for the layout's rowhomes", () => {
  const kit = new FacadeBays(frontages);
  const bays = kit.group.getObjectByName("facade-bay");
  if (!(bays instanceof THREE.InstancedMesh)) throw new Error("the kit has no bay mesh");
  afterAll(() => kit.dispose());

  // mutation: sed -i 's/new THREE.InstancedMesh(geometry, material, frontages.length)/new THREE.InstancedMesh(geometry, material, Math.min(frontages.length, 8))/' src/game/present/facade-bays.ts
  it("when the kit is drawn for a few houses and then for many, then it is the same four draws with an instance for each house", () => {
    const few = new FacadeBays(frontages.slice(0, 10));
    const many = new FacadeBays(frontages.slice(0, 40));
    for (const [name, made, houses] of [["few", few, 10], ["many", many, 40], ["layout", kit, frontages.length]] as const) {
      expect(made.group.children.length, `${name}: draws`).toBe(4);
      expect(made.stats.draws, `${name}: draws counted`).toBe(4);
      for (const mesh of made.group.children) expect(mesh instanceof THREE.InstancedMesh ? mesh.count : -1, `${name}: instances of ${mesh.name}`).toBe(houses);
    }
    expect(many.stats.triangles / few.stats.triangles, "triangles grow with the houses").toBeCloseTo(4, 6);
    few.dispose();
    many.dispose();
  });

  // mutation: sed -i 's/frontage.yaw + Math.PI \/ 2/frontage.yaw/' src/game/present/facade-bays.ts
  it("when each house's instance is read, then it stands on its frontage with the kit's front turned to the street", () => {
    const matrix = new THREE.Matrix4();
    const front = new THREE.Vector3();
    const place = new THREE.Vector3();
    let worst = 0;
    for (const [at, frontage] of frontages.entries()) {
      bays.getMatrixAt(at, matrix);
      front.set(0, 0, 1).transformDirection(matrix);
      place.setFromMatrixPosition(matrix);
      worst = Math.max(worst, Math.abs(front.x - Math.cos(frontage.yaw)), Math.abs(front.z + Math.sin(frontage.yaw)), Math.abs(place.x - frontage.x), Math.abs(place.z - frontage.z));
    }
    expect(frontages.length, "houses read").toBeGreaterThan(100);
    expect(worst, "furthest an instance is from its frontage (m or unit)").toBeLessThan(EPSILON * 10);
  });

  // mutation: sed -i 's/frontage.variant % HOUSE_ACCENTS.length/0/g' src/game/present/facade-bays.ts
  it("when the houses' bay colours are read, then they vary from house to house", () => {
    expect(bays.instanceColor, "bay colours set").not.toBeNull();
    const colours = new Set<number>();
    for (let at = 0; at < bays.count; at++) colours.add(Math.round(bays.instanceColor!.getX(at) * 1000));
    expect(colours.size, "distinct bay colours").toBeGreaterThanOrEqual(HOUSE_ACCENTS.length - 1);
  });

  // mutation: sed -i 's/const CORNICE_BRACKETS = 5;/const CORNICE_BRACKETS = 500;/' src/game/present/facade-bay-parts.ts
  it("when the kit's triangles are counted for the layout, then a house costs no more than the budget", () => {
    expect(frontages.length, "houses").toBeGreaterThan(100);
    expect(kit.stats.triangles / frontages.length, "triangles per house").toBeLessThanOrEqual(TRIANGLES_PER_HOME_MAX);
  });
});

describe("given the kit's shared pieces", () => {
  /** The red of the atlas's texel at a share of a cell's width and height. */
  function texelAt(data: Uint8Array, cell: UvRect, across: number, up: number): number {
    const x = Math.floor((cell.u0 + (cell.u1 - cell.u0) * across) * ATLAS_SIZE);
    const y = Math.floor((cell.v0 + (cell.v1 - cell.v0) * up) * ATLAS_SIZE);
    return data[(y * ATLAS_SIZE + x) * 4]!;
  }

  // mutation: sed -i 's/const FRAME_TEXELS = 7;/const FRAME_TEXELS = 60;/' src/game/present/facade-kit-atlas.ts
  it("when the window's panes and frame are sampled, then a pane is dark glass that lights at night and the frame is pale and never lights", () => {
    const painted = paintKit();
    expect(texelAt(painted.albedo, KIT_CELL.window, 0.25, 0.25), "pane's red").toBeLessThan(150);
    expect(texelAt(painted.glow, KIT_CELL.window, 0.25, 0.25), "pane's glow").toBeGreaterThan(120);
    expect(texelAt(painted.albedo, KIT_CELL.window, 0.03, 0.5), "frame's red").toBeGreaterThan(200);
    expect(texelAt(painted.glow, KIT_CELL.window, 0.03, 0.5), "frame's glow").toBe(0);
  });

  // mutation: sed -i 's/const RAIL_BAR_FROM = 13;/const RAIL_BAR_FROM = 25;/' src/game/present/facade-kit-atlas.ts
  it("when the railing strip is sampled, then a bar and the rails are iron and the gaps between bars are open", () => {
    const rail = paintKit().rail;
    const alpha = (column: number, row: number): number => rail[(row * 32 + column) * 4 + 3]!;
    expect(alpha(15, 30), "alpha on a bar").toBe(255);
    expect(alpha(2, 30), "alpha between bars").toBe(0);
    expect(alpha(2, 60), "alpha on the top rail").toBe(255);
    expect(alpha(2, 2), "alpha on the bottom rail").toBe(255);
  });

  // mutation: sed -i 's/const BLOCK_FACE_HALF = 5.9;/const BLOCK_FACE_HALF = 5.8;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the kit's wall plane is read, then it is the building mesh's own front face", () => {
    expect(BLOCK_FACE_HALF, "the face the kit stands on (m)").toBe(HALF);
  });

  // mutation: sed -i 's/vColor.rgb \*= mix(vec3(1.0), instanceColor.rgb, ${TINT_ATTRIBUTE});/vColor.rgb *= instanceColor.rgb;/' src/game/present/facade-bays.ts
  it("when the colour chunk is patched, then the instance colour is weighted by each vertex's tint share", () => {
    expect(tintedColorVertex(), "patched chunk").toContain("mix(vec3(1.0), instanceColor.rgb, tintShare)");
  });
});
