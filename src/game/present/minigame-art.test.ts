import { beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { levelOrder } from "../scenes/ground-stack.ts";
import { LANDING_HEIGHT, MINIGAME_MODES, STATION_ANCHORS, STATION_HALF_WIDTH, type MinigameMode } from "../scenes/minigame-constants.ts";
import { highJumpLayout } from "../scenes/minigame-high-jump.ts";
import { stationBackX, stationFrontX } from "../scenes/minigame-profile.ts";
import { RING_BACKSTOP, RING_BOARD_BOUNDS } from "../scenes/minigame-ring.ts";
import { RANGE } from "../scenes/range.ts";
import { makeHighJumpArt } from "./high-jump-art.ts";
import { drawCalls } from "./fx-uploads.test-util.ts";
import { makeLongJumpArt } from "./long-jump-art.ts";
import { BOXES_MESH_NAME, GROUND_MARGIN, MinigameArt, OUTER_GROUND_NAME, STATION_PLUG_PREFIX } from "./minigame-art.ts";
import { SURFACE_DRAW_CALL_BUDGET } from "./minigame-surface-art.ts";
import { BOX_POSE_FLOATS } from "./ragdoll-boxes.ts";
import { makeRingFlingArt, RING_FLING_DRAW_BUDGET } from "./ring-fling-art.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

/**
 * Most draws the composer adds to any one station over its art's own: the High jump's surface (its art's factory leaves it to the
 * composer), the other two stations' arts already have theirs.
 */
const STATION_EXTRA_DRAW_BUDGET = { longJump: 0, highJump: 1, ringFling: 0 } as const;
/** Most draws the flat ground costs with a mode shown: the ground around the bands, and a plug over each of the other stations' bands. */
const GROUND_DRAW_BUDGET = 1 + MINIGAME_MODES.length - 1;
/** Most draw calls the High jump's whole art may cost: timber, boards, trim, back-board, net, with room for the composer's own (`high-jump-art.test.ts` pins the same number). */
const HIGH_JUMP_DRAW_BUDGET = 12;

/** Made-up measurements (m): the layout's own functions turn them into posts, boards, net and boxes. */
const MEASURED = { bestHeight: 18, landingDistance: 22 };
const LIP_Y = 7;
/** Two normalised quaternions that agree to ~1e-7 per component have a dot within ~1e-14 of 1: this bar is far looser than that and far tighter than any real turn. */
const QUATERNION_DOT_TOLERANCE = 1e-9;
const layout = highJumpLayout(MEASURED, LIP_Y);
/** Geometry and poses are f32: equal to within a few ulps of a value near 100. */
const FLOAT32_TOLERANCE = 1e-4;
const REBUILD_COUNT = 3;
const VERTICES_PER_TRIANGLE = 3;
/** Areas (m2) add up to the ground's to within the f32 rounding of its edges: far under the smallest plan cell. */
const GROUND_AREA_TOLERANCE = 0.01;

function stationOf(art: MinigameArt, mode: MinigameMode): THREE.Object3D {
  const station = art.group.getObjectByName(`station:${mode}`);
  must(station, `the composer has a station group for ${mode}`);
  return station;
}

function descendantCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => count++);
  return count;
}

function meshVertices(mesh: THREE.Mesh): THREE.Vector3[] {
  const positions = mesh.geometry.getAttribute("position");
  return Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index));
}

function groundMeshNamed(art: MinigameArt, name: string): THREE.Mesh {
  const mesh = art.group.getObjectByName(name);
  must(mesh instanceof THREE.Mesh, `the composer has a ground mesh ${name}`);
  return mesh;
}

/** Where each triangle of `mesh` is on the plan (its centre) and how much ground it covers (m2). */
function triangleFootprints(mesh: THREE.Mesh): { centreX: number; centreZ: number; area: number }[] {
  const vertices = meshVertices(mesh);
  const footprints: { centreX: number; centreZ: number; area: number }[] = [];
  for (let first = 0; first < vertices.length; first += VERTICES_PER_TRIANGLE) {
    const [a, b, c] = [vertices[first]!, vertices[first + 1]!, vertices[first + 2]!];
    footprints.push({
      centreX: (a.x + b.x + c.x) / 3,
      centreZ: (a.z + b.z + c.z) / 3,
      area: Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2,
    });
  }
  return footprints;
}

/** The world rectangle of `mode`'s band, from the profile and the anchors alone. */
function bandRectangle(mode: MinigameMode): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const anchor = STATION_ANCHORS[mode];
  return { minX: anchor.x + stationBackX(mode), maxX: anchor.x + stationFrontX(mode), minZ: anchor.z - STATION_HALF_WIDTH, maxZ: anchor.z + STATION_HALF_WIDTH };
}

const ringFlingEndX = RING_BOARD_BOUNDS.maxX + RING_BACKSTOP.distancePastBoard + RING_BACKSTOP.thickness;

function builtArt(): MinigameArt {
  const art = new MinigameArt();
  art.setHighJumpLayout(layout, LIP_Y);
  return art;
}

describe("given the three minigame stations' art laid out together on one ground", () => {
  beforeAll(stubBrowser);

  it("when it is built, then it starts invisible, and each station group sits at its anchor's x and z on the ground", () => {
    const art = builtArt();
    expect(art.group.visible).toBe(false);
    expect(art.group.parent, "the engine adds it to a scene, not the composer").toBe(null);
    for (const mode of MINIGAME_MODES) {
      const station = stationOf(art, mode);
      expect(station.position.x, `${mode} station x`).toBe(STATION_ANCHORS[mode].x);
      expect(station.position.y, `${mode} station y`).toBe(0);
      expect(station.position.z, `${mode} station z`).toBe(STATION_ANCHORS[mode].z);
    }
    art.dispose();
  });

  it("when a mode is set, then exactly that mode's station shows, the boxes only with the High jump, and null hides the lot", () => {
    const art = builtArt();
    for (const shown of MINIGAME_MODES) {
      art.setMode(shown);
      expect(art.group.visible).toBe(true);
      expect(MINIGAME_MODES.filter((mode) => stationOf(art, mode).visible).join(","), `only ${shown} shows`).toBe(shown);
      expect(art.group.getObjectByName(BOXES_MESH_NAME)?.visible, `the boxes show with the High jump alone (mode ${shown})`).toBe(shown === "highJump");
    }
    art.setMode(null);
    expect(art.group.visible).toBe(false);
    expect(MINIGAME_MODES.filter((mode) => stationOf(art, mode).visible)).toHaveLength(0);
    expect(art.group.getObjectByName(BOXES_MESH_NAME)?.visible).toBe(false);
    art.dispose();
  });

  it("when the High jump layout is set, then the returned boxes are the layout's placed at the High jump's anchor, in the layout's order", () => {
    const art = new MinigameArt();
    const placements = art.setHighJumpLayout(layout, LIP_Y);
    const anchor = STATION_ANCHORS.highJump;
    expect(placements.length).toBe(layout.boxes.length);
    for (let boxIndex = 0; boxIndex < layout.boxes.length; boxIndex++) {
      const local = layout.boxes[boxIndex]!;
      const placed = placements[boxIndex]!;
      expect(placed.x, `box ${boxIndex} x`).toBe(local.x + anchor.x);
      expect(placed.y, `box ${boxIndex} y`).toBe(local.y);
      expect(placed.z, `box ${boxIndex} z`).toBe(local.z + anchor.z);
      expect(placed.yaw, `box ${boxIndex} yaw`).toBe(local.yaw);
      expect(placed.width, `box ${boxIndex} width`).toBe(local.width);
      expect(placed.height, `box ${boxIndex} height`).toBe(local.height);
      expect(placed.depth, `box ${boxIndex} depth`).toBe(local.depth);
    }
    art.dispose();
  });

  it("when the High jump layout is rebuilt again and again, then its art and the ground around the bands replace the old (the children stay as many, the old art is freed), never piling up", () => {
    const art = builtArt();
    const station = stationOf(art, "highJump");
    const childCount = station.children.length;
    const descendants = descendantCount(art.group);
    for (let rebuild = 0; rebuild < REBUILD_COUNT; rebuild++) {
      const oldGround = groundMeshNamed(art, OUTER_GROUND_NAME);
      const oldGeometries: THREE.BufferGeometry[] = [oldGround.geometry];
      station.traverse((object) => {
        if (object instanceof THREE.Mesh && object.name !== "") oldGeometries.push(object.geometry);
      });
      const disposals = oldGeometries.map((geometry) => vi.spyOn(geometry, "dispose"));
      art.setHighJumpLayout(layout, LIP_Y);
      expect(station.children.length, `rebuild ${rebuild + 1}: child count`).toBe(childCount);
      expect(descendantCount(art.group), `rebuild ${rebuild + 1}: descendant count`).toBe(descendants);
      expect(groundMeshNamed(art, OUTER_GROUND_NAME), `rebuild ${rebuild + 1}: a new ground`).not.toBe(oldGround);
      expect(oldGround.parent, `rebuild ${rebuild + 1}: the old ground is out of the scene graph`).toBe(null);
      expect(disposals.every((spy) => spy.mock.calls.length >= 1), `rebuild ${rebuild + 1}: every old geometry freed`).toBeTruthy();
    }
    art.dispose();
  });

  it("when the stations are built, then the ground around the bands is one flat mesh at the pad's level, at the terrain level, reaching the margin past every band and the farthest end", () => {
    const art = builtArt();
    const ground = groundMeshNamed(art, OUTER_GROUND_NAME);
    const vertices = meshVertices(ground);
    const bands = MINIGAME_MODES.map(bandRectangle);
    const farthestEnd = Math.max(STATION_ANCHORS.longJump.x + RANGE.length, STATION_ANCHORS.highJump.x + layout.netX, STATION_ANCHORS.ringFling.x + ringFlingEndX);
    const expected = {
      minX: Math.min(...bands.map((band) => band.minX)) - GROUND_MARGIN.x,
      maxX: farthestEnd + GROUND_MARGIN.x,
      minZ: Math.min(...bands.map((band) => band.minZ)) - GROUND_MARGIN.z,
      maxZ: Math.max(...bands.map((band) => band.maxZ)) + GROUND_MARGIN.z,
    };
    expect(Math.abs(Math.min(...vertices.map((vertex) => vertex.x)) - expected.minX), "west end").toBeLessThan(FLOAT32_TOLERANCE);
    expect(Math.abs(Math.max(...vertices.map((vertex) => vertex.x)) - expected.maxX), "east end").toBeLessThan(FLOAT32_TOLERANCE);
    expect(Math.abs(Math.min(...vertices.map((vertex) => vertex.z)) - expected.minZ), "first side").toBeLessThan(FLOAT32_TOLERANCE);
    expect(Math.abs(Math.max(...vertices.map((vertex) => vertex.z)) - expected.maxZ), "last side").toBeLessThan(FLOAT32_TOLERANCE);
    for (const vertex of vertices) expect(vertex.y, "flat at the pad's level").toBe(LANDING_HEIGHT);
    expect(ground.renderOrder, "draws at the terrain level").toBe(levelOrder("terrain"));
    art.dispose();
  });

  it("when the stations are built, then the ground around the bands has no triangle over any band and covers everything else in its extent", () => {
    const art = builtArt();
    const footprints = triangleFootprints(groundMeshNamed(art, OUTER_GROUND_NAME));
    const bands = MINIGAME_MODES.map(bandRectangle);
    expect(footprints.length, "there is ground").toBeGreaterThan(0);
    for (const footprint of footprints) {
      for (const band of bands) {
        const isOverBand = footprint.centreX > band.minX && footprint.centreX < band.maxX && footprint.centreZ > band.minZ && footprint.centreZ < band.maxZ;
        expect(isOverBand, `a triangle centred (${footprint.centreX}, ${footprint.centreZ}) lies over a band`).toBe(false);
      }
    }
    const vertices = meshVertices(groundMeshNamed(art, OUTER_GROUND_NAME));
    const extentArea = (Math.max(...vertices.map((vertex) => vertex.x)) - Math.min(...vertices.map((vertex) => vertex.x))) * (Math.max(...vertices.map((vertex) => vertex.z)) - Math.min(...vertices.map((vertex) => vertex.z)));
    const bandsArea = bands.reduce((total, band) => total + (band.maxX - band.minX) * (band.maxZ - band.minZ), 0);
    const groundArea = footprints.reduce((total, footprint) => total + footprint.area, 0);
    expect(Math.abs(groundArea - (extentArea - bandsArea)), `ground ${groundArea} m2, extent minus bands ${extentArea - bandsArea} m2`).toBeLessThan(GROUND_AREA_TOLERANCE);
    art.dispose();
  });

  it("when a mode is set, then a flat plug covers exactly each band of the stations not shown and none covers the shown one's", () => {
    const art = builtArt();
    for (const shown of MINIGAME_MODES) {
      art.setMode(shown);
      for (const mode of MINIGAME_MODES) {
        const plug = groundMeshNamed(art, `${STATION_PLUG_PREFIX}${mode}`);
        expect(plug.visible, `plug of ${mode} with ${shown} shown`).toBe(mode !== shown);
        const band = bandRectangle(mode);
        const plugArea = triangleFootprints(plug).reduce((total, footprint) => total + footprint.area, 0);
        expect(Math.abs(plugArea - (band.maxX - band.minX) * (band.maxZ - band.minZ)), `${mode} plug area ${plugArea}`).toBeLessThan(GROUND_AREA_TOLERANCE);
        for (const vertex of meshVertices(plug)) {
          expect(vertex.x >= band.minX - FLOAT32_TOLERANCE && vertex.x <= band.maxX + FLOAT32_TOLERANCE && vertex.z >= band.minZ - FLOAT32_TOLERANCE && vertex.z <= band.maxZ + FLOAT32_TOLERANCE, `${mode} plug vertex (${vertex.x}, ${vertex.z}) is in its band`).toBeTruthy();
          expect(vertex.y, "flat at the pad's level").toBe(LANDING_HEIGHT);
        }
      }
    }
    art.dispose();
  });

  it("when a station is composed, then its draws stay within its art's own budget plus the composer's extra, and the ground costs at most the ground budget with any mode shown", () => {
    const art = builtArt();
    const ownBudgets = { longJump: SURFACE_DRAW_CALL_BUDGET, highJump: HIGH_JUMP_DRAW_BUDGET, ringFling: RING_FLING_DRAW_BUDGET };
    const factoryOutputs = { longJump: makeLongJumpArt(), highJump: makeHighJumpArt(layout, LIP_Y), ringFling: makeRingFlingArt() };
    for (const mode of MINIGAME_MODES) {
      const stationDraws = drawCalls(stationOf(art, mode));
      const added = stationDraws - drawCalls(factoryOutputs[mode]);
      expect(added, `${mode}: the composer adds ${added} draws`).toBeLessThanOrEqual(STATION_EXTRA_DRAW_BUDGET[mode]);
      expect(stationDraws, `${mode} draws ${stationDraws}`).toBeLessThanOrEqual(ownBudgets[mode] + STATION_EXTRA_DRAW_BUDGET[mode]);
      art.setMode(mode);
      const groundDraws = drawCalls(groundMeshNamed(art, OUTER_GROUND_NAME).parent!, "traverseVisible");
      expect(groundDraws >= 1 && groundDraws <= GROUND_DRAW_BUDGET, `${mode} shown: the ground draws ${groundDraws}`).toBeTruthy();
    }
    art.dispose();
  });

  it("when box poses arrive from the sim, then the boxes drawn sit at those poses at the world origin, scaled to the layout's sizes", () => {
    const art = new MinigameArt();
    const placements = art.setHighJumpLayout(layout, LIP_Y);
    const poses = new Float32Array(placements.length * BOX_POSE_FLOATS);
    const turn = new THREE.Quaternion();
    for (let boxIndex = 0; boxIndex < placements.length; boxIndex++) {
      turn.setFromAxisAngle(new THREE.Vector3(1, boxIndex + 1, 2).normalize(), 0.3 * boxIndex);
      poses.set([5 + boxIndex, 0.5 + boxIndex / 10, STATION_ANCHORS.highJump.z - 3 + boxIndex / 3, turn.x, turn.y, turn.z, turn.w], boxIndex * BOX_POSE_FLOATS);
    }
    art.updateBoxes(poses, placements.length);
    const boxes = art.group.getObjectByName(BOXES_MESH_NAME) as THREE.InstancedMesh;
    expect(firstMismatch(boxes.position.toArray(), [0, 0, 0]), "the boxes' mesh stays at the world origin").toBeUndefined();
    expect(boxes.parent, "not inside a station group (which sits at an anchor)").toBe(art.group);
    expect(boxes.count).toBe(placements.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let boxIndex = 0; boxIndex < placements.length; boxIndex++) {
      boxes.getMatrixAt(boxIndex, matrix).decompose(position, rotation, scale);
      const pose = boxIndex * BOX_POSE_FLOATS;
      const placement = placements[boxIndex]!;
      expect(position.distanceTo(new THREE.Vector3(poses[pose], poses[pose + 1], poses[pose + 2])), `box ${boxIndex} position ${position.toArray()}`).toBeLessThan(FLOAT32_TOLERANCE);
      const expectedRotation = new THREE.Quaternion(poses[pose + 3], poses[pose + 4], poses[pose + 5], poses[pose + 6]).normalize();
      expect(Math.abs(rotation.normalize().dot(expectedRotation)), `box ${boxIndex} rotation ${rotation.toArray()} vs ${expectedRotation.toArray()}`).toBeGreaterThan(1 - QUATERNION_DOT_TOLERANCE);
      expect(scale.distanceTo(new THREE.Vector3(placement.width, placement.height, placement.depth)), `box ${boxIndex} size ${scale.toArray()}`).toBeLessThan(FLOAT32_TOLERANCE);
    }
    art.dispose();
  });

  it("when it is disposed, then every geometry and every texture under its group (the boxes' too) is freed", () => {
    const art = builtArt();
    const geometries = new Set<THREE.BufferGeometry>();
    const textures = new Set<THREE.Texture>();
    art.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    expect(geometries.size > 0 && textures.size > 0, "there is something to free").toBeTruthy();
    const geometryDisposals = [...geometries].map((geometry) => ({ geometry, spy: vi.spyOn(geometry, "dispose") }));
    const textureDisposals = [...textures].map((texture) => ({ texture, spy: vi.spyOn(texture, "dispose") }));
    art.dispose();
    const liveGeometries = geometryDisposals.filter(({ spy }) => spy.mock.calls.length === 0).map(({ geometry }) => geometry.type + ":" + geometry.uuid);
    const liveTextures = textureDisposals.filter(({ spy }) => spy.mock.calls.length === 0).map(({ texture }) => texture.uuid);
    expect(liveGeometries, "no live geometry").toHaveLength(0);
    expect(liveTextures, "no live texture").toHaveLength(0);
  });
});
