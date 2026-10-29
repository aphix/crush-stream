import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FLEET_HALF } from "../vehicle/car-rig.ts";
import { PR_BASE, PR_HX, PR_HZ, PR_TOP, PR_X, PR_YAW, PR_Z } from "../world/prism.ts";
import type { Plateau } from "../world/terrain.ts";
import { P_STRIDE, PRISM, Q_KIND, Q_STRIDE } from "../world/surfaces.ts";
import { DERBY_ARENA } from "./constants.ts";
import { GLASS_MESH_NAME, makeDerbyArena } from "./derby-arena.ts";
import { DERBY_BOXES, DERBY_PLATEAUS, DERBY_PROP, DERBY_RAMPS, DERBY_TABLE_TOP, DerbyGround } from "./derby-ground.ts";
import { SUNK_CAR_DEPTH } from "./fleet.ts";
import { must } from "../kernel/must.test-util.ts";

/** Metres (and radians) two drawn numbers may differ by and still be one: the instance matrices are Float32. */
const TOLERANCE = 1e-4;
/** The wall's inner face may sit this far (m) off `DERBY_ARENA.radius`. */
const WALL_FACE_TOLERANCE = 0.01;
/** A wall box's long axis is tangent: its dot with the radial direction stays under this. */
const TANGENT_LIMIT = 0.25;
/** Draw calls the arena may make: the old arena's ten plus 20 % (the glass wall and the ramp decks). */
const DRAW_CALL_LIMIT = 12;
/** Side (texels) of the floor's dirt texture: one square map over the whole arena. */
const DIRT_TEXTURE_SIZE = 1024;
/** A floor vertex this close (m) to a box's edge counts as under the box. */
const EDGE_REACH = 1e-6;
/** At least this share of the floor's vertices must be compared: a test that skipped them all would prove nothing. */
const LEAST_COMPARED_SHARE = 0.9;
/** A prism's base reaches down past a car sunk to `SUNK_CAR_DEPTH` (2 m) and its body, 2 x `FLEET_HALF.y` (1.36 m): -3.36 m, so it still meets the wall (`prop-contact.ts` skips a prism a body is wholly under). */
const DEEPEST_REACHED_BASE = -(SUNK_CAR_DEPTH + 2 * FLEET_HALF.y);

type Placement = { x: number; z: number; base: number; yaw: number; hx: number; hz: number; height: number };

const ground = new DerbyGround();
const arena = makeDerbyArena(ground);

function sameYawModuloHalfTurn(first: number, second: number): boolean {
  return Math.abs(Math.sin(first - second)) < TOLERANCE;
}

function isSameSolid(first: Placement, second: Placement): boolean {
  return (
    Math.abs(first.x - second.x) < TOLERANCE &&
    Math.abs(first.z - second.z) < TOLERANCE &&
    Math.abs(first.base - second.base) < TOLERANCE &&
    sameYawModuloHalfTurn(first.yaw, second.yaw) &&
    Math.abs(first.hx - second.hx) < TOLERANCE &&
    Math.abs(first.hz - second.hz) < TOLERANCE &&
    Math.abs(first.height - second.height) < TOLERANCE
  );
}

const listedBoxes: readonly (Placement & { kind: string })[] = DERBY_BOXES.map(({ kind, x, z, yaw, hx, hz, height }) => ({ kind, x, z, base: 0, yaw, hx, hz, height }));

/** What is drawn of a listed box: the wall's concrete foot (the glass above it is its own draw), every other box whole. */
const drawnBoxes = listedBoxes.map((box) => (box.kind === DERBY_PROP.wall ? { ...box, height: DERBY_ARENA.concreteHeight } : box));

/** Every instance of a drawn box mesh, read back from its matrix and its box geometry. */
function placementsOf(mesh: THREE.InstancedMesh): Placement[] {
  must(mesh.geometry instanceof THREE.BoxGeometry, `${mesh.name} is drawn from a box`);
  const { width, height, depth } = mesh.geometry.parameters;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  return Array.from({ length: mesh.count }, (_unused, index) => {
    mesh.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale);
    const instanceHeight = height * scale.y;
    return {
      x: position.x,
      z: position.z,
      base: position.y - instanceHeight / 2,
      yaw: 2 * Math.atan2(quaternion.y, quaternion.w),
      hx: (width * scale.x) / 2,
      hz: (depth * scale.z) / 2,
      height: instanceHeight,
    };
  });
}

function boxMesh(kind: string): THREE.InstancedMesh {
  const found = arena.children.find((child) => child instanceof THREE.InstancedMesh && child.name === kind);
  must(found instanceof THREE.InstancedMesh, `the arena draws ${kind} boxes`);
  return found;
}

/** The prisms of the ground, as placements (the grid patch is not a prism). */
function prismPlacements(): Placement[] {
  const placements: Placement[] = [];
  for (let patch = 0; patch < ground.count; patch++) {
    if (ground.q[patch * Q_STRIDE + Q_KIND] !== PRISM) continue;
    const offset = patch * P_STRIDE;
    placements.push({
      x: ground.p[offset + PR_X]!,
      z: ground.p[offset + PR_Z]!,
      base: ground.p[offset + PR_BASE]!,
      yaw: ground.p[offset + PR_YAW]!,
      hx: ground.p[offset + PR_HX]!,
      hz: ground.p[offset + PR_HZ]!,
      height: ground.p[offset + PR_TOP]!,
    });
  }
  return placements;
}

/** Pairs each of `found` with one of `expected`, each used once; the ones left over on either side are the mismatch. */
function leftOvers(expected: readonly Placement[], found: readonly Placement[]): { missing: Placement[]; extra: Placement[] } {
  const missing = [...expected];
  const extra: Placement[] = [];
  for (const placement of found) {
    const at = missing.findIndex((candidate) => isSameSolid(candidate, placement));
    if (at < 0) extra.push(placement);
    else missing.splice(at, 1);
  }
  return { missing, extra };
}

function isUnderBox(x: number, z: number, box: Placement): boolean {
  const offsetX = x - box.x;
  const offsetZ = z - box.z;
  const across = offsetX * Math.cos(box.yaw) - offsetZ * Math.sin(box.yaw);
  const along = offsetX * Math.sin(box.yaw) + offsetZ * Math.cos(box.yaw);
  return Math.abs(across) <= box.hx + EDGE_REACH && Math.abs(along) <= box.hz + EDGE_REACH;
}

describe("derby arena", () => {
  for (const kind of Object.values(DERBY_PROP)) {
    it(`given the drawn arena, when every ${kind} instance is read back, then each is exactly one box of the list and each box is drawn once`, () => {
      const expected = drawnBoxes.filter((box) => box.kind === kind);
      const mesh = boxMesh(kind);
      expect(mesh.count, `${kind} instance count`).toBe(expected.length);
      const { missing, extra } = leftOvers(expected, placementsOf(mesh));
      expect(extra, `${kind} instances that are no listed box`).toHaveLength(0);
      expect(missing, `${kind} boxes that are not drawn`).toHaveLength(0);
    });
  }

  it("given the ground built from the list, when its prism patches are read, then each is sunk deep enough, each is a listed box and each box is a prism", () => {
    const prisms = prismPlacements();
    for (const prism of prisms) expect(prism.base, `prism at (${prism.x}, ${prism.z}) has base ${prism.base}, above ${DEEPEST_REACHED_BASE}`).toBeLessThanOrEqual(DEEPEST_REACHED_BASE);
    const { missing, extra } = leftOvers(
      listedBoxes,
      prisms.map((prism) => ({ ...prism, base: 0 })),
    );
    expect(extra, "prisms that are no listed box").toHaveLength(0);
    expect(missing, "boxes that are no prism").toHaveLength(0);
  });

  it("given the drawn floor, when each vertex is compared with the ground's height query, then it is the surface a car meets", () => {
    const floor = arena.getObjectByName("derby-floor");
    must(floor instanceof THREE.Mesh, "the arena draws a floor");
    const positions = floor.geometry.getAttribute("position");
    let compared = 0;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex);
      const z = positions.getZ(vertex);
      if (listedBoxes.some((box) => isUnderBox(x, z, box))) continue;
      compared++;
      expect(Math.abs(positions.getY(vertex) - ground.heightAt(x, z)), `floor vertex (${x}, ${z}) is at the ground's height`).toBeLessThan(TOLERANCE);
    }
    expect(compared, `${compared} of ${positions.count} vertices compared`).toBeGreaterThan(positions.count * LEAST_COMPARED_SHARE);
  });

  it("given the drawn arena, when its draw calls are counted, then there are at most twelve and it is hidden until the engine shows it", () => {
    let drawCalls = 0;
    arena.traverse((object) => {
      if (object instanceof THREE.Mesh) drawCalls++;
    });
    expect(drawCalls, `${drawCalls} draw calls`).toBeLessThanOrEqual(DRAW_CALL_LIMIT);
    expect(arena.name).toBe("derby-arena");
    expect(arena.visible).toBe(false);
  });

  it("given the wall boxes as drawn, when each is read back, then its long axis runs along the wall and its inner face stands on the arena radius", () => {
    const pieces = placementsOf(boxMesh(DERBY_PROP.wall));
    expect(pieces.length).toBe(DERBY_ARENA.wallPieces);
    for (const piece of pieces) {
      const centreRadius = Math.hypot(piece.x, piece.z);
      const radialAlongLongAxis = (piece.x * Math.sin(piece.yaw) + piece.z * Math.cos(piece.yaw)) / centreRadius;
      expect(Math.abs(radialAlongLongAxis), `wall piece at (${piece.x}, ${piece.z}) lies along the wall`).toBeLessThan(TANGENT_LIMIT);
      expect(Math.abs(centreRadius - piece.hx - DERBY_ARENA.radius), `wall piece at (${piece.x}, ${piece.z}) has its inner face on the radius`).toBeLessThan(WALL_FACE_TOLERANCE);
    }
  });
});

/** Indices of one grid cell's two triangles. */
const INDICES_PER_CELL = 6;

function meshNamed(name: string): THREE.Mesh {
  const found = arena.getObjectByName(name);
  must(found instanceof THREE.Mesh, `the arena draws ${name}`);
  return found;
}

function standardMaterialOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  must(mesh.material instanceof THREE.MeshStandardMaterial, `${mesh.name} has a standard material`);
  return mesh.material;
}

/** A ramp's deck as the design reads: as wide as the ramp's top, from the foot of its long run to the far edge of its crest. */
function isOnDeck(ramp: (typeof DERBY_RAMPS)[number], x: number, z: number): boolean {
  const { plateau, toward } = ramp;
  const risesAlongX = toward.x !== 0;
  const along = toward.x * x + toward.z * z;
  const lateral = risesAlongX ? z - plateau.z : x - plateau.x;
  const crestCentre = toward.x * plateau.x + toward.z * plateau.z;
  const halfCrest = risesAlongX ? plateau.halfX : plateau.halfZ;
  const halfWidth = risesAlongX ? plateau.halfZ : plateau.halfX;
  return Math.abs(lateral) <= halfWidth && along >= crestCentre - halfCrest - ramp.length && along <= crestCentre + halfCrest;
}

/** Each grid cell a mesh draws: its lower corner as `x,z` and the plan corners of its six indexed vertices in order. */
function cellsOf(mesh: THREE.Mesh): Map<string, string> {
  const positions = mesh.geometry.getAttribute("position");
  const indices = mesh.geometry.getIndex();
  must(indices, `${mesh.name} is indexed`);
  const cells = new Map<string, string>();
  for (let start = 0; start < indices.count; start += INDICES_PER_CELL) {
    const corners = Array.from({ length: INDICES_PER_CELL }, (_unused, offset) => {
      const vertex = indices.getX(start + offset);
      return [positions.getX(vertex), positions.getZ(vertex)] as const;
    });
    const lowX = Math.min(...corners.map(([x]) => x));
    const lowZ = Math.min(...corners.map(([, z]) => z));
    cells.set(`${lowX},${lowZ}`, corners.map(([x, z]) => `${x},${z}`).join(" "));
  }
  return cells;
}

/** The least a floor vertex's colour may be, of the floor's mean in each channel (linear light): the scrap hump is damp earth, not a black blob. */
const LEAST_FLOOR_SHARE = 0.25;

describe("derby arena floor colour", () => {
  const colours = meshNamed("derby-floor").geometry.getAttribute("color");
  const channels = [0, 1, 2].map((channel) => ({ channel, read: (vertex: number) => colours.getComponent(vertex, channel) }));

  for (const { channel, read } of channels) {
    it(`given the drawn floor, when each vertex's colour channel ${channel} is read, then none is under ${LEAST_FLOOR_SHARE} of the floor's mean`, () => {
      let total = 0;
      for (let vertex = 0; vertex < colours.count; vertex++) total += read(vertex);
      const mean = total / colours.count;
      let darkest = Infinity;
      for (let vertex = 0; vertex < colours.count; vertex++) darkest = Math.min(darkest, read(vertex));
      expect(darkest, `darkest ${darkest} of mean ${mean}`).toBeGreaterThanOrEqual(mean * LEAST_FLOOR_SHARE);
    });
  }
});

/** The level floor compared with: vertices at height 0 this near (m) the middle, clear of every rise and prop. */
const LEVEL_FLOOR_REACH = 8;
/** The pit plateau is the one rise 1 m high (`DERBY_PLATEAUS`). */
const PIT_HEIGHT = 1;
/** Shares of a rise's height: its top is from the first, its mid slope between the next two, its foot under the last. */
const TOP_FROM_SHARE = 0.98;
const MID_SLOPE_SHARES = [0.4, 0.6] as const;
const FOOT_UNDER_SHARE = 0.1;

describe("derby arena rise colour", () => {
  const floor = meshNamed("derby-floor");
  const positions = floor.geometry.getAttribute("position");
  const colours = floor.geometry.getAttribute("color");
  const meanRed = (select: (vertex: number) => boolean): number => {
    let total = 0;
    let count = 0;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (!select(vertex)) continue;
      total += colours.getX(vertex);
      count++;
    }
    expect(count, "some vertices were compared").toBeGreaterThan(0);
    return total / count;
  };
  const level = (vertex: number) => positions.getY(vertex) === 0 && Math.hypot(positions.getX(vertex), positions.getZ(vertex)) <= LEVEL_FLOOR_REACH;
  const onRise = (rise: Plateau, vertex: number) => {
    const reachX = rise.halfX + rise.run[0] + rise.round;
    const reachZ = rise.halfZ + rise.run[2] + rise.round;
    return Math.abs(positions.getX(vertex) - rise.x) <= reachX && Math.abs(positions.getZ(vertex) - rise.z) <= reachZ;
  };
  const shareBetween = (rise: Plateau, vertex: number, from: number, to: number) => onRise(rise, vertex) && positions.getY(vertex) / rise.height >= from && positions.getY(vertex) / rise.height <= to;
  const pit = DERBY_PLATEAUS.find((plateau) => plateau.height === PIT_HEIGHT);
  must(pit, "the arena has a pit plateau");
  const riseCases = [
    { name: "table-top's flat top", rise: DERBY_TABLE_TOP, from: TOP_FROM_SHARE, to: 1, least: 1.5, most: Infinity },
    { name: "pit plateau's flat top", rise: pit, from: TOP_FROM_SHARE, to: 1, least: 1.5, most: Infinity },
    { name: "table-top's mid slope", rise: DERBY_TABLE_TOP, from: MID_SLOPE_SHARES[0], to: MID_SLOPE_SHARES[1], least: 0, most: 0.9 },
    { name: "pit plateau's mid slope", rise: pit, from: MID_SLOPE_SHARES[0], to: MID_SLOPE_SHARES[1], least: 0, most: 0.9 },
    { name: "table-top's foot", rise: DERBY_TABLE_TOP, from: 0.001, to: FOOT_UNDER_SHARE, least: 0, most: 0.8 },
    { name: "pit plateau's foot", rise: pit, from: 0.001, to: FOOT_UNDER_SHARE, least: 0, most: 0.8 },
  ];

  for (const { name, rise, from, to, least, most } of riseCases) {
    it(`given the drawn floor, when the ${name} is compared with the level floor, then its mean red is ${least} to ${most} times the floor's`, () => {
      const ratio = meanRed((vertex) => shareBetween(rise, vertex, from, to)) / meanRed(level);
      expect(ratio, `${name} ratio ${ratio} under ${least}`).toBeGreaterThanOrEqual(least);
      expect(ratio, `${name} ratio ${ratio} over ${most}`).toBeLessThanOrEqual(most);
    });
  }
});

describe("derby arena ramp decks", () => {
  const decks = meshNamed("derby-ramp-decks");
  const deckCells = cellsOf(decks);

  it("given the drawn decks, when each vertex is compared with the ground's height query, then it lies on the surface a car meets", () => {
    const positions = decks.geometry.getAttribute("position");
    expect(positions.count, "the decks have vertices").toBeGreaterThan(0);
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex);
      const z = positions.getZ(vertex);
      expect(Math.abs(positions.getY(vertex) - ground.heightAt(x, z)), `deck vertex (${x}, ${z}) is at the ground's height`).toBeLessThan(TOLERANCE);
    }
  });

  it("given the ramps' decks as designed, when the drawn cells are compared with the cells whose centre is on one, then none is missing and none is extra", () => {
    const expected = new Set<string>();
    for (let z = -DERBY_ARENA.gridHalf; z < DERBY_ARENA.gridHalf; z++) {
      for (let x = -DERBY_ARENA.gridHalf; x < DERBY_ARENA.gridHalf; x++) {
        if (DERBY_RAMPS.some((ramp) => isOnDeck(ramp, x + 0.5, z + 0.5))) expected.add(`${x},${z}`);
      }
    }
    const missing = [...expected].filter((key) => !deckCells.has(key));
    const extra = [...deckCells.keys()].filter((key) => !expected.has(key));
    expect(missing.length, `deck cells not drawn: ${missing.slice(0, 5).join(" | ")}`).toBe(0);
    expect(extra.length, `drawn cells on no deck: ${extra.slice(0, 5).join(" | ")}`).toBe(0);
    expect(expected.size, "the ramps have deck cells").toBeGreaterThan(0);
  });

  it("given the floor's cells and the deck's, when a cell is in both, then both split it into the same two triangles", () => {
    const floorCells = cellsOf(meshNamed("derby-floor"));
    for (const [key, split] of deckCells) expect(split, `cell ${key} is split like the floor's`).toBe(floorCells.get(key));
  });
});

describe("derby arena glass", () => {
  const glass = boxMesh(GLASS_MESH_NAME);
  const panes = placementsOf(glass);
  const wallPieces = listedBoxes.filter((box) => box.kind === DERBY_PROP.wall);

  it("given the drawn glass, when its instances are counted, then there is one pane per wall piece", () => {
    expect(glass.count).toBe(DERBY_ARENA.wallPieces);
  });

  it("given each glass pane, when its base and top are read back, then it spans the concrete's top to the wall's top", () => {
    for (const pane of panes) {
      expect(Math.abs(pane.base - DERBY_ARENA.concreteHeight), `pane at (${pane.x}, ${pane.z}) starts at the concrete's top`).toBeLessThan(TOLERANCE);
      expect(Math.abs(pane.base + pane.height - DERBY_ARENA.wallHeight), `pane at (${pane.x}, ${pane.z}) ends at the wall's top`).toBeLessThan(TOLERANCE);
    }
  });

  it("given each glass pane, when its place is read back, then it stands over a wall piece with its inner face on the arena radius", () => {
    for (const pane of panes) {
      expect(wallPieces.some((piece) => isUnderBox(pane.x, pane.z, piece)), `pane at (${pane.x}, ${pane.z}) is over a wall piece`).toBeTruthy();
      expect(Math.abs(Math.hypot(pane.x, pane.z) - pane.hx - DERBY_ARENA.radius), `pane at (${pane.x}, ${pane.z}) has its inner face on the radius`).toBeLessThan(WALL_FACE_TOLERANCE);
    }
  });

  const glassCases = [
    { field: "transparent", read: () => standardMaterialOf(glass).transparent, expected: true, then: "it blends over the scene" },
    { field: "depthWrite", read: () => standardMaterialOf(glass).depthWrite, expected: false, then: "it writes no depth" },
    { field: "side", read: () => standardMaterialOf(glass).side, expected: THREE.FrontSide, then: "only its front faces draw" },
    { field: "castShadow", read: () => glass.castShadow, expected: false, then: "it casts no shadow" },
    { field: "receiveShadow", read: () => glass.receiveShadow, expected: false, then: "it receives no shadow" },
  ];
  for (const { field, read, expected, then } of glassCases) {
    it(`given the glass draw, when its ${field} is read, then ${then}`, () => {
      expect(read()).toBe(expected);
    });
  }
});

describe("derby arena materials", () => {
  const floorMap = standardMaterialOf(meshNamed("derby-floor")).map;
  must(floorMap instanceof THREE.DataTexture, "the floor's map is a painted texture");
  const floorMapImage = floorMap.image;
  const deckMaterial = standardMaterialOf(meshNamed("derby-ramp-decks"));
  const mapCases = [
    { name: "floor map width", read: () => floorMapImage.width, expected: DIRT_TEXTURE_SIZE, then: "it is one 1024 texel square" },
    { name: "floor map height", read: () => floorMapImage.height, expected: DIRT_TEXTURE_SIZE, then: "it is one 1024 texel square" },
    { name: "floor map horizontal wrap", read: () => floorMap?.wrapS, expected: THREE.ClampToEdgeWrapping, then: "it clamps: one map covers the arena, no tiling" },
    { name: "ramp deck map horizontal wrap", read: () => deckMaterial.map?.wrapS, expected: THREE.RepeatWrapping, then: "the planks repeat" },
    { name: "ramp deck map vertical wrap", read: () => deckMaterial.map?.wrapT, expected: THREE.RepeatWrapping, then: "the planks repeat" },
    { name: "ramp deck depth write", read: () => deckMaterial.depthWrite, expected: false, then: "it writes no depth (a decal over the floor)" },
  ];
  for (const { name, read, expected, then } of mapCases) {
    it(`given the drawn arena, when the ${name} is read, then ${then}`, () => {
      expect(read()).toBe(expected);
    });
  }
});

/** Metres one tile of each texture covers across and up its box faces (the textures' own scale: 1 m tiles, a 3 m panel, a 1.83 x 1.8 m K-rail panel, 1.3 m of two tyres), and the glass tile is its whole height. */
const tileCases = [
  { name: DERBY_PROP.wall, across: 3, up: 3.5 },
  { name: GLASS_MESH_NAME, across: 3, up: DERBY_ARENA.wallHeight - DERBY_ARENA.concreteHeight },
  { name: DERBY_PROP.container, across: 1, up: 1 },
  { name: DERBY_PROP.rail, across: 1.83, up: 1.8 },
  { name: DERBY_PROP.pad, across: 1, up: 1 },
  { name: DERBY_PROP.tyres, across: 1.3, up: 1.3 },
];

describe("derby arena metric uv", () => {
  for (const { name, across, up } of tileCases) {
    it(`given the ${name} box, when its side face's uv is read, then it spans that face's metres over the texture's tile`, () => {
      const { geometry } = boxMesh(name);
      must(geometry instanceof THREE.BoxGeometry, `${name} is drawn from a box`);
      const uv = geometry.getAttribute("uv");
      const sideFaceVertices = [0, 1, 2, 3];
      const reachU = Math.max(...sideFaceVertices.map((vertex) => uv.getX(vertex)));
      const reachV = Math.max(...sideFaceVertices.map((vertex) => uv.getY(vertex)));
      expect(Math.abs(reachU - geometry.parameters.depth / across), `${name} u reach`).toBeLessThan(TOLERANCE);
      expect(Math.abs(reachV - geometry.parameters.height / up), `${name} v reach`).toBeLessThan(TOLERANCE);
    });
  }
});
