import * as THREE from "three";
import { detCos, detSin } from "../kernel/physics-core.js";
import { afterAll, describe, expect, it } from "vitest";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { BAY, BAY_FLOORS, DOOR, BLOCK_FACE_HALF, drawnHalf, HOME_HEIGHT, homeFrontages, STOOP } from "../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { BRICK_STYLE } from "../world/openworld/openworld-programme.ts";
import { buildBayGeometry, buildCondenserGeometry, buildCorniceGeometry, buildDeckGeometry, buildFanlightGeometry, buildRailingGeometry, buildRoofGeometry, buildStoopGeometry, buildSurroundGeometry } from "./facade-bay-parts.ts";
import { FacadeBays, HOUSE_ACCENTS, tintedColorVertex } from "./facade-bays.ts";
import { ATLAS_SIZE, KIT_CELL, paintKit, type UvRect } from "./facade-kit-atlas.ts";
import { HALF } from "./facade-mesh.ts";
import { roofLiftAt } from "./facades.ts";
import { shuttersOf, visibleWindowsOf } from "./facade-fittings.ts";

const lots = layOutLots();
const frontages = homeFrontages(lots.places.slice(0, lots.backdropStart));
const EPSILON = 1e-6;
/** The door hole the facade art cuts, half its width (m), and where its middle stands across the lot (u; the kit's x is u negated). */
const DOOR_HOLE_HALF_WIDTH = 0.5;
const DOOR_HOLE_X = -1.8;
/** The lot's half width (m) and the least clear gap between the bay's slab lip and the door's hood (m): a hand and a half. */
const LOT_HALF_WIDTH = 2.8;
const STOOP_BAY_GAP_MIN = 0.2;
/** The open world's house depth (m), and how far past the party wall the chimney may reach (its half width and its cap, m). */
const HOUSE_DEPTH = 15;
const CHIMNEY_HALF_MAX = 0.45;
/** The cell is twice as wide as it is tall, so a radius (a share of its half width) reaches the same share of its height. */
/** Radii (shares of the fan's) of an inner pane, the ring between the panes and the outer pane at the rim; the reds and glow that tell glass from bar. */
const FAN_GLASS_RADIUS = 0.3;
const FAN_RING_RADIUS = 0.55;
const FAN_RIM_RADIUS = 0.85;
const FAN_GLASS_RED_MAX = 150;
const FAN_GLOW_MIN = 100;
const FAN_BAR_RED_MIN = 220;
/** What a marble texel's red is below when it is vein, how white its mean is, and what share of it veins may be. */
const MARBLE_VEIN_RED_MAX = 215;
const MARBLE_WHITE_RED_MIN = 220;
const MARBLE_VEIN_SHARE_MIN = 0.01;
const MARBLE_VEIN_SHARE_MAX = 0.2;
/** The fan glass stands this far out of the wall at most (m), a vertex reads as upward when its normal's y is over this, a quad has this many vertices. */
const FAN_GLASS_OUT_MAX = 0.03;
const UPWARD = 0.9;
const VERTICES_PER_QUAD = 6;
/** The door's column: how far off the door's middle the Federal door reaches (m), and how far under the lowest upper window's sill its cap ends (m). */
const DOOR_COLUMN_HALF = 0.9;
const DOOR_TO_WINDOW_GAP_MIN = 0.3;
/** The kit's draws (its instanced meshes), the ones every house has, and the most triangles one rowhome's kit may cost. */
/** Shares of the louvre cell's height (a slat texel row, a gap texel row) and the least red the slats stand over the gaps. */
const LOUVRE_SLAT_ROW = 0;
const LOUVRE_GAP_ROW = 0.1;
const LOUVRE_CONTRAST_MIN = 40;
const KIT_DRAWS = 12;
const EVERY_HOUSE: readonly string[] = ["facade-bay", "facade-stoop", "facade-railing", "facade-cornice", "facade-roof"];
/** The most shutters a house hangs: a pair on each of its upper storeys' windows on the door's half. */
const SHUTTERS_PER_HOUSE_MAX = 4;
/** The most window boxes a house stands: one on each of the windows of its storey the bay leaves. */
const WINDOW_BOXES_PER_HOUSE_MAX = 2;
/** The fanlight kit's about 415 a house plus a quarter of the houses' two 60-triangle window boxes (about 30 on average). */
const TRIANGLES_PER_HOME_MAX = 480;

/** The x range of every vertex of `geometry`. */
function xRange(geometry: THREE.BufferGeometry): { min: number; max: number } {
  const position = geometry.getAttribute("position");
  const range = { min: Infinity, max: -Infinity };
  for (let at = 0; at < position.count; at++) {
    range.min = Math.min(range.min, position.getX(at));
    range.max = Math.max(range.max, position.getX(at));
  }
  return range;
}

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
  it("when each floor's bay is measured at its sill, then every one has the same x range and projection, beside the door", () => {
    for (const [at, floor] of BAY_FLOORS.entries()) {
      const extent = extentAt(bay, floor.sill);
      expect(extent.count, `vertices at floor ${at}'s sill`).toBeGreaterThan(0);
      expect(extent.maxX - extent.minX, `width of floor ${at}'s bay (m)`).toBeCloseTo(BAY.width, 6);
      expect((extent.maxX + extent.minX) / 2, `floor ${at}'s bay off its line (kit x, m)`).toBeCloseTo(-BAY.across, 6);
      expect(extent.maxZ, `projection of floor ${at}'s bay (m)`).toBeCloseTo(BAY.out, 6);
    }
    expect(BAY_FLOORS.length, "floors with a bay, the ground storey included").toBe(3);
  });

  it("when the plinth is measured, then the stack stands from the ground on the same footprint the floors do and each belt band sits over it", () => {
    const plinth = extentAt(bay, 0);
    expect(plinth.count, "vertices at the ground").toBeGreaterThan(0);
    expect((plinth.maxX + plinth.minX) / 2, "plinth off the bay's line (kit x, m)").toBeCloseTo(-BAY.across, 6);
    expect(plinth.maxX - plinth.minX, "plinth width (m)").toBeCloseTo(BAY.width, 6);
    const first = extentAt(bay, BAY_FLOORS[0]!.head);
    for (const [at, floor] of BAY_FLOORS.entries()) {
      const belt = extentAt(bay, floor.head);
      expect(belt.maxX - belt.minX, `belt of floor ${at} against floor 0 (m)`).toBeCloseTo(first.maxX - first.minX, 6);
      expect(belt.maxZ, `belt projection of floor ${at} against floor 0 (m)`).toBeCloseTo(first.maxZ, 6);
      expect(belt.maxX - belt.minX, `belt of floor ${at} wider than the plinth (m)`).toBeGreaterThanOrEqual(plinth.maxX - plinth.minX - EPSILON);
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
    for (const geometry of [buildBayGeometry(), stoop, railing, buildCorniceGeometry(), buildSurroundGeometry(), buildFanlightGeometry()]) {
      const position = geometry.getAttribute("position");
      for (let at = 0; at < position.count; at++) {
        const across = Math.abs(position.getX(at) - DOOR_HOLE_X);
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

describe("given every piece of the kit", () => {
  // mutation: sed -i 's/const BAY_ACROSS = -0.9;/const BAY_ACROSS = -1.9;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the pieces are measured across the lot, then all stand inside its edges, the stoop on the door's side with a clear gap to the bay", () => {
    const bayRange = xRange(buildBayGeometry());
    const surroundRange = xRange(buildSurroundGeometry());
    const fanlightRange = xRange(buildFanlightGeometry());
    const stoopRange = xRange(buildStoopGeometry());
    const pieces = [
      { name: "bay", range: bayRange },
      { name: "stoop", range: stoopRange },
      { name: "surround", range: surroundRange },
      { name: "fanlight", range: fanlightRange },
      { name: "railing", range: xRange(buildRailingGeometry()) },
      { name: "cornice", range: xRange(buildCorniceGeometry()) },
    ];
    for (const { name, range } of pieces) {
      expect(range.min, `${name}'s least x (m)`).toBeGreaterThanOrEqual(-LOT_HALF_WIDTH - EPSILON);
      expect(range.max, `${name}'s greatest x (m)`).toBeLessThanOrEqual(LOT_HALF_WIDTH + EPSILON);
    }
    expect(bayRange.min - Math.max(stoopRange.max, surroundRange.max, fanlightRange.max), "clear gap from the door's surround to the bay (m)").toBeGreaterThanOrEqual(STOOP_BAY_GAP_MIN);
  });
});

describe("given the kit made for the layout's rowhomes", () => {
  const kit = new FacadeBays(frontages);
  const bays = kit.group.getObjectByName("facade-bay");
  if (!(bays instanceof THREE.InstancedMesh)) throw new Error("the kit has no bay mesh");
  afterAll(() => kit.dispose());

  // mutation: sed -i 's/new THREE.InstancedMesh(geometry, material, houses.length)/new THREE.InstancedMesh(geometry, material, Math.min(houses.length, 8))/' src/game/present/facade-bays.ts
  it("when the kit is drawn for a few houses and then for many, then it is the same draws, an instance of each every-house piece for each house and of the others for a share", () => {
    const few = new FacadeBays(frontages.slice(0, 10));
    const many = new FacadeBays(frontages.slice(0, 40));
    const cases = [
      { name: "few", made: few, houses: 10 },
      { name: "many", made: many, houses: 40 },
      { name: "layout", made: kit, houses: frontages.length },
    ];
    for (const { name, made, houses } of cases) {
      expect(made.group.children.length, `${name}: draws`).toBe(KIT_DRAWS);
      expect(made.stats.draws, `${name}: draws counted`).toBe(KIT_DRAWS);
      for (const mesh of made.group.children) {
        const count = mesh instanceof THREE.InstancedMesh ? mesh.count : -1;
        if (EVERY_HOUSE.includes(mesh.name)) expect(count, `${name}: instances of ${mesh.name}`).toBe(houses);
        else expect(count, `${name}: instances of ${mesh.name}`).toBeLessThanOrEqual(mesh.name === "facade-shutter" ? houses * SHUTTERS_PER_HOUSE_MAX : mesh.name === "facade-windowBox" ? houses * WINDOW_BOXES_PER_HOUSE_MAX : houses);
      }
    }
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

  // mutation: sed -i 's/setPosition(frontage.x, onRoof ? roofTopOf(frontage) : 0, frontage.z)/setPosition(frontage.x, onRoof ? HOME_HEIGHT : 0, frontage.z)/' src/game/present/facade-bays.ts
  it("when each house's roof pieces are read, then they stand on its roof, raised by the parapet lift the facade shader gives that building", () => {
    const roof = kit.group.getObjectByName("facade-roof");
    if (!(roof instanceof THREE.InstancedMesh)) throw new Error("the kit has no roof mesh");
    const matrix = new THREE.Matrix4();
    const block = PREFABS[PREFAB.building].size[1];
    let lifted = 0;
    let worst = 0;
    for (const [at, frontage] of frontages.entries()) {
      const face = drawnHalf(frontage.depth);
      const lift = roofLiftAt(frontage.x - detCos(frontage.yaw) * face, frontage.z + detSin(frontage.yaw) * face);
      if (lift > 0) lifted++;
      roof.getMatrixAt(at, matrix);
      worst = Math.max(worst, Math.abs(matrix.elements[13]! - ((block + lift) * HOME_HEIGHT) / block));
    }
    expect(lifted, "houses whose roof the shader lifts").toBeGreaterThan(0);
    expect(lifted, "houses whose roof the shader lifts").toBeLessThan(frontages.length);
    expect(worst, "furthest a roof piece stands off its roof (m)").toBeLessThan(EPSILON);
  });

  // mutation: sed -i 's/const CONDENSER_SHARE = 45;/const CONDENSER_SHARE = 100;/' src/game/present/facade-bays.ts
  it("when the roofs are counted, then some houses have a condenser and some a deck, and neither is on every house", () => {
    for (const name of ["facade-condenser", "facade-deck"]) {
      const mesh = kit.group.getObjectByName(name);
      const count = mesh instanceof THREE.InstancedMesh ? mesh.count : -1;
      expect(count, `houses with ${name}`).toBeGreaterThan(0);
      expect(count, `houses with ${name}`).toBeLessThan(frontages.length);
    }
  });
});

describe("given the fittings of the kit made for the layout", () => {
  const kit = new FacadeBays(frontages);
  afterAll(() => kit.dispose());

  // mutation: sed -i 's/placements: (frontage) => shuttersFor(frontage.style).map(/placements: (frontage) => shuttersFor(frontage.style).slice(1).map(/' src/game/present/facade-bays.ts
  it("when the shutters are counted, then there is one for each shutter the table gives each house's style", () => {
    const mesh = kit.group.getObjectByName("facade-shutter");
    const expected = frontages.reduce((sum, frontage) => sum + shuttersOf(frontage.style).length, 0);
    expect(expected, "shutters the table gives the layout").toBeGreaterThan(frontages.length);
    expect(mesh instanceof THREE.InstancedMesh ? mesh.count : -1, "shutter instances").toBe(expected);
  });

  // mutation: sed -i 's/local.compose(position.set(-placement.across, placement.up, 0)/local.compose(position.set(placement.across, placement.up, 0)/' src/game/present/facade-bays.ts
  it("when each shutter instance is read back, then it stands at its table entry's place on its house's facade, the same height up and as wide and tall", () => {
    const mesh = kit.group.getObjectByName("facade-shutter");
    if (!(mesh instanceof THREE.InstancedMesh)) throw new Error("the kit has no shutter mesh");
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const size = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    let at = 0;
    let worst = 0;
    for (const frontage of frontages) {
      for (const shutter of shuttersOf(frontage.style)) {
        mesh.getMatrixAt(at++, matrix);
        matrix.decompose(position, turn, size);
        const dx = position.x - frontage.x;
        const dz = position.z - frontage.z;
        const out = dx * detCos(frontage.yaw) - dz * detSin(frontage.yaw);
        const across = dx * detSin(frontage.yaw) + dz * detCos(frontage.yaw);
        worst = Math.max(worst, Math.abs(out), Math.abs(across - shutter.across), Math.abs(position.y - shutter.sill), Math.abs(size.x - shutter.width), Math.abs(size.y - shutter.height));
      }
    }
    expect(at, "shutters read back").toBeGreaterThan(frontages.length);
    expect(worst, "furthest a shutter instance is from its table entry (m)").toBeLessThan(EPSILON * 10);
  });

  // mutation: sed -i 's/const AIRCON_SHARE = 40;/const AIRCON_SHARE = 100;/' src/game/present/facade-bays.ts
  it("when the air-conditioners are counted, then some houses have one in a window and not every house does", () => {
    const mesh = kit.group.getObjectByName("facade-aircon");
    const count = mesh instanceof THREE.InstancedMesh ? mesh.count : -1;
    expect(count, "air-conditioner instances").toBeGreaterThan(0);
    expect(count, "air-conditioner instances").toBeLessThan(frontages.length);
  });
});

describe("given the Federal door", () => {
  const fanlight = buildFanlightGeometry();
  const kit = new FacadeBays(frontages);
  afterAll(() => kit.dispose());

  // mutation: sed -i 's/const ARCHED_DOOR_STYLES: readonly string\[\] = \["rowbrick"\];/const ARCHED_DOOR_STYLES: readonly string[] = [];/' src/game/present/facade-bays.ts
  it("when the doors are counted, then every house has a surround or a fanlight, the fanlight on the brick houses and the flat surround on the rest", () => {
    const count = (name: string): number => {
      const mesh = kit.group.getObjectByName(name);
      return mesh instanceof THREE.InstancedMesh ? mesh.count : -1;
    };
    const brick = frontages.filter((frontage) => frontage.style === BRICK_STYLE).length;
    expect(brick, "brick houses").toBeGreaterThan(0);
    expect(brick, "brick houses").toBeLessThan(frontages.length);
    expect(count("facade-fanlight"), "fanlight instances").toBe(brick);
    expect(count("facade-surround"), "flat surround instances").toBe(frontages.length - brick);
  });

  // mutation: sed -i 's/fanGlass(builder, DOOR.halfWidth);/fanGlass(builder, DOOR.halfWidth * 2);/' src/game/present/facade-bay-parts.ts
  it("when the fan of glass is read, then it springs from the door's head, as wide as the hole and as high as it is wide over two", () => {
    const position = fanlight.getAttribute("position");
    const uv = fanlight.getAttribute("uv");
    const fan = { minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity, count: 0 };
    for (let at = 0; at < position.count; at++) {
      const inCell = uv.getX(at) >= KIT_CELL.fanlight.u0 - EPSILON && uv.getX(at) <= KIT_CELL.fanlight.u1 + EPSILON && uv.getY(at) >= KIT_CELL.fanlight.v0 - EPSILON && uv.getY(at) <= KIT_CELL.fanlight.v1 + EPSILON;
      if (!inCell || position.getZ(at) > FAN_GLASS_OUT_MAX) continue;
      fan.count++;
      fan.minY = Math.min(fan.minY, position.getY(at));
      fan.maxY = Math.max(fan.maxY, position.getY(at));
      fan.minX = Math.min(fan.minX, position.getX(at));
      fan.maxX = Math.max(fan.maxX, position.getX(at));
    }
    expect(fan.count, "vertices of the fan's triangles").toBeGreaterThan(0);
    expect(fan.minY, "the fan springs from the door's head (m)").toBeCloseTo(DOOR.head, 6);
    expect(fan.maxX - fan.minX, "the fan's width (m)").toBeCloseTo(2 * DOOR.halfWidth, 6);
    expect(fan.maxY - fan.minY, "the fan's height (m)").toBeCloseTo(DOOR.halfWidth, 6);
    expect((fan.maxX + fan.minX) / 2, "the fan's middle off the door's (kit x, m)").toBeCloseTo(DOOR_HOLE_X, 6);
  });

  // mutation: sed -i 's/const ARCH_CAP_HEIGHT = 0.1;/const ARCH_CAP_HEIGHT = 1;/' src/game/present/facade-bay-parts.ts
  it("when the Federal door's top is read against the upper windows, then it ends well under the lowest of them and never leaves the door's column", () => {
    const position = fanlight.getAttribute("position");
    let top = -Infinity;
    for (let at = 0; at < position.count; at++) {
      top = Math.max(top, position.getY(at));
      expect(Math.abs(position.getX(at) - DOOR_HOLE_X), "a vertex's distance off the door's middle (m)").toBeLessThanOrEqual(DOOR_COLUMN_HALF);
    }
    const lowestSill = Math.min(...visibleWindowsOf(BRICK_STYLE).filter((window) => window.storey > 0).map((window) => window.sill));
    expect(lowestSill - top, "gap from the door's cap to the upper windows' sills (m)").toBeGreaterThanOrEqual(DOOR_TO_WINDOW_GAP_MIN);
  });

  // mutation: sed -i 's/builder.quad(\[left, top, far\], \[right, top, far\], \[right, top, near\], \[left, top, near\], KIT_CELL.marble, TREAD_SHADE, ACCENT);/builder.quad([left, top, far], [right, top, far], [right, top, near], [left, top, near], KIT_CELL.stone, TREAD_SHADE, ACCENT);/' src/game/present/facade-bay-parts.ts
  it("when the stoop's upward faces are read, then every tread reads the marble", () => {
    const geometry = buildStoopGeometry();
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    let treads = 0;
    for (let at = 0; at < normal.count; at++) {
      if (normal.getY(at) < UPWARD) continue;
      treads++;
      expect(uv.getX(at) >= KIT_CELL.marble.u0 - EPSILON && uv.getX(at) <= KIT_CELL.marble.u1 + EPSILON && uv.getY(at) >= KIT_CELL.marble.v0 - EPSILON && uv.getY(at) <= KIT_CELL.marble.v1 + EPSILON, "a tread vertex reads the marble cell").toBe(true);
    }
    expect(treads, "vertices of the treads").toBe(STOOP.steps * VERTICES_PER_QUAD);
  });
});

describe("given the roof pieces", () => {
  // mutation: sed -i 's/const CHIMNEY_BACK = 9.5;/const CHIMNEY_BACK = 15.5;/' src/game/present/facade-bay-parts.ts
  it("when their vertices are read, then every one stands on or over the roof and within it: behind the facade, before the back wall, inside the lot but for the chimney astride the party wall", () => {
    const roofDepth = 2 * drawnHalf(HOUSE_DEPTH);
    const outside: string[] = [];
    const pieces = [
      { name: "roof", geometry: buildRoofGeometry() },
      { name: "condenser", geometry: buildCondenserGeometry() },
      { name: "deck", geometry: buildDeckGeometry() },
    ];
    for (const { name, geometry } of pieces) {
      const position = geometry.getAttribute("position");
      for (let at = 0; at < position.count; at++) {
        const x = position.getX(at);
        const z = position.getZ(at);
        if (position.getY(at) < -EPSILON || z > EPSILON || z < -roofDepth - EPSILON || Math.abs(x) > LOT_HALF_WIDTH + CHIMNEY_HALF_MAX) outside.push(`${name} ${x.toFixed(2)}, ${z.toFixed(2)}`);
      }
    }
    expect(outside.slice(0, 3).join("; "), "roof piece vertices off the roof").toBe("");
  });
});

describe("given the kit's shared pieces", () => {
  // mutation: sed -i 's/const MARBLE_VEIN_SHADE = 0.8;/const MARBLE_VEIN_SHADE = 1;/' src/game/present/facade-kit-atlas.ts
  it("when the marble cell is read, then it is near white with grey veins through a share of it", () => {
    const painted = paintKit().albedo;
    const cell = KIT_CELL.marble;
    let veins = 0;
    let total = 0;
    let sum = 0;
    for (let y = Math.ceil(cell.v0 * ATLAS_SIZE); y < Math.floor(cell.v1 * ATLAS_SIZE); y++) {
      for (let x = Math.ceil(cell.u0 * ATLAS_SIZE); x < Math.floor(cell.u1 * ATLAS_SIZE); x++) {
        const red = painted[(y * ATLAS_SIZE + x) * 4]!;
        total++;
        sum += red;
        if (red < MARBLE_VEIN_RED_MAX) veins++;
      }
    }
    expect(sum / total, "the marble's mean red").toBeGreaterThan(MARBLE_WHITE_RED_MIN);
    expect(veins / total, "the share of the marble that is vein").toBeGreaterThan(MARBLE_VEIN_SHARE_MIN);
    expect(veins / total, "the share of the marble that is vein").toBeLessThan(MARBLE_VEIN_SHARE_MAX);
  });

  // mutation: sed -i 's/const FAN_RING_AT = 0.55;/const FAN_RING_AT = 0.8;/' src/game/present/facade-kit-atlas.ts
  it("when the fanlight cell is sampled up its middle, then its glass lights at night, the ring between its two panes is white and unlit, and the pane at the rim is darker than at the centre", () => {
    const painted = paintKit();
    const middle = 0.5;
    expect(texelAt(painted.albedo, KIT_CELL.fanlight, middle, FAN_GLASS_RADIUS), "inner pane's red").toBeLessThan(FAN_GLASS_RED_MAX);
    expect(texelAt(painted.glow, KIT_CELL.fanlight, middle, FAN_GLASS_RADIUS), "inner pane's glow").toBeGreaterThan(FAN_GLOW_MIN);
    expect(texelAt(painted.albedo, KIT_CELL.fanlight, middle, FAN_RING_RADIUS), "ring's red").toBeGreaterThan(FAN_BAR_RED_MIN);
    expect(texelAt(painted.glow, KIT_CELL.fanlight, middle, FAN_RING_RADIUS), "ring's glow").toBe(0);
    expect(texelAt(painted.albedo, KIT_CELL.fanlight, middle, FAN_RIM_RADIUS), "outer pane's red against the inner's").toBeLessThan(texelAt(painted.albedo, KIT_CELL.fanlight, middle, FAN_GLASS_RADIUS));
  });

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

  // mutation: sed -i 's/const LOUVRE_GAP_SHADE = 0.5;/const LOUVRE_GAP_SHADE = 1;/' src/game/present/facade-kit-atlas.ts
  it("when the louvre cell is sampled up its height, then its slats are lit and a dark gap lies under each", () => {
    const painted = paintKit().albedo;
    const columnAt = 0.5;
    const lit = texelAt(painted, KIT_CELL.louvre, columnAt, LOUVRE_SLAT_ROW);
    const gap = texelAt(painted, KIT_CELL.louvre, columnAt, LOUVRE_GAP_ROW);
    expect(lit, "a slat's red").toBeGreaterThan(gap + LOUVRE_CONTRAST_MIN);
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
