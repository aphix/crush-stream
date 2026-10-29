import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  RING_BACKSTOP,
  RING_BOARD_BOUNDS,
  RING_CUPS,
  RING_CUP_PROFILE,
  RING_POCKETS,
  RING_RAIL_PROFILE,
  RING_RAIL_START_X,
  SKEE_SCALE,
  ringBoardPlaneHeight,
  ringHeightAt,
  type RingZone,
} from "../scenes/minigame-ring.ts";
import { STATION_SURFACE_STYLES } from "./minigame-surface-art.ts";
import { makeRingFlingArt, RING_FLING_DRAW_BUDGET } from "./ring-fling-art.ts";
import { must } from "../kernel/must.test-util.ts";

/** A canvas that is only a recorder: the art's canvas textures are drawn into it, and the text it was told to draw is kept (there is no `document` in node). */
type DrawnText = { text: string; x: number; y: number };
type RecordingCanvas = { width: number; height: number; drawnTexts: DrawnText[]; getContext: () => unknown };
const recordingCanvases: RecordingCanvas[] = [];

function makeRecordingCanvas(): RecordingCanvas {
  const drawnTexts: DrawnText[] = [];
  const settings = {
    fillText: (text: string, x: number, y: number) => {
      drawnTexts.push({ text, x, y });
    },
  };
  const context = new Proxy(settings, { get: (target, property) => (property in target ? target[property as keyof typeof target] : () => undefined) });
  const canvas: RecordingCanvas = { width: 0, height: 0, drawnTexts, getContext: () => context };
  recordingCanvases.push(canvas);
  return canvas;
}

Object.defineProperty(globalThis, "document", { value: { createElement: makeRecordingCanvas }, configurable: true });

const HEIGHT_TOLERANCE = 0.001;
/** How closely the art's smooth cups and rim follow the model's piecewise profile: the polygon's chord sag over the steepest wall and the rim ramp's bilinear rise both stay under 1.5 cm. */
const SURFACE_TOLERANCE = 0.02;
const ZONES: readonly RingZone[] = [...RING_CUPS, ...RING_POCKETS];
const REAL_INCH_SCALED = 0.0254 * SKEE_SCALE;
const REAL_BACKBOARD_HEIGHT_INCHES = 50;
/** The throw the board is designed for (as in minigame-ring.test.ts): up to 22 m/s at 35 degrees from the lip. */
const DESIGN_THROW_SPEED_MAX = 22;
const DESIGN_THROW_PITCH = (35 * Math.PI) / 180;
const GRAVITY = 9.80665;
const BACKSTOP_RIM_CLEARANCE_FACTOR = 3;
/** A numeral lies on its cup floor: over it, but by no more than this (m). */
const DECAL_HOVER_MAX = 0.1;
/** The lying dummy's width (m), as in minigame-ring.test.ts (present/ragdoll-body.ts PARTS): a numeral disc wider than it in both directions cannot be wholly covered by a dummy lying either way across the cup. */
const DUMMY_LYING_WIDTH = 0.58;

const RAY_START_HEIGHT = 100;
/** The grid the board is read on: steps (m) that fit no cup, rim or wall, so probes land at varied phases of every curve. */
const GRID_STEP_X = 0.41;
const GRID_STEP_Z = 0.37;
const MIN_GRID_PROBES = 500;
/** Directions (rad) a cup is probed along: across the lane, where no neighbouring cup or pocket overlaps its skirt. */
const PROBE_ANGLES = [Math.PI / 2, (3 * Math.PI) / 2];
/** A round rim has at least this many vertices on each of its circles (a vertex every 7.5 degrees). */
const MIN_RIM_VERTICES_PER_CIRCLE = 48;
const NORMAL_TOLERANCE = 0.02;
/** Red of the white cup walls in the mesh's linear colours, against the light grey floor's (0.69): tells a wall vertex from a floor vertex at the same place. */
const WALL_COLOUR_MIN_RED = 0.8;
/** Distances (m) to probe clear of a rim feature: in front of its start, just inside its slope; and beyond the corner arc. */
const RIM_CLEAR_MARGIN = 0.3;
const CORNER_CUT_OFF_PROBE = 0.3;
const BOARD_TO_WHITE_LIGHTNESS_MAX = 0.6;
/** Cup floors must be at least this light (linear lightness, 0 black to 1 white) for black numerals to read, and lighter than the board so they do not read as holes. */
const CUP_FLOOR_LIGHTNESS_MIN = 0.5;
/** A numeral disc has at least this many vertices (a circle of 48 segments and its centre). */
const MIN_DISC_VERTICES = 49;
/** A wing must reach at least this far (m) forward of the slab and outward past its end. */
const MIN_WING_REACH = 1;

type Vertex = { x: number; y: number; z: number };

function meshNamed(art: THREE.Group, name: string): THREE.Mesh {
  const found = art.getObjectByName(name);
  must(found instanceof THREE.Mesh, `a mesh named ${name}`);
  return found;
}

function allMeshes(art: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  art.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

function verticesOf(mesh: THREE.Mesh): Vertex[] {
  const positions = mesh.geometry.getAttribute("position");
  return Array.from({ length: positions.count }, (_, index) => ({ x: positions.getX(index), y: positions.getY(index), z: positions.getZ(index) }));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe("given the Ring Fling station's art in station-local coordinates", () => {
  const art = makeRingFlingArt();
  art.updateMatrixWorld(true);
  const wood = meshNamed(art, "ring-board-wood");
  const white = meshNamed(art, "ring-board-white");
  const whiteVertices = verticesOf(white);
  const raycaster = new THREE.Raycaster();

  /** The art's top surface at a plan point and the colour painted there: a ray straight down from far above, its nearest hit. */
  function surfaceAt(x: number, z: number): { height: number; colour: THREE.Color } {
    raycaster.set(new THREE.Vector3(x, RAY_START_HEIGHT, z), new THREE.Vector3(0, -1, 0));
    const hit = raycaster.intersectObjects([wood, white], false)[0];
    must(hit?.face, `nothing is drawn at (${x}, ${z})`);
    const colours = (hit.object as THREE.Mesh).geometry.getAttribute("color");
    return { height: hit.point.y, colour: new THREE.Color(colours.getX(hit.face.a), colours.getY(hit.face.a), colours.getZ(hit.face.a)) };
  }

  it("when the board is read on a grid over its whole plan, then its surface stands on ringHeightAt within 2 cm everywhere", () => {
    const { minX, maxX, minZ, maxZ } = RING_BOARD_BOUNDS;
    let probes = 0;
    for (let x = minX + GRID_STEP_X / 2; x < maxX; x += GRID_STEP_X) {
      for (let z = minZ + GRID_STEP_Z / 2; z < maxZ; z += GRID_STEP_Z) {
        expect(Math.abs(surfaceAt(x, z).height - ringHeightAt(x, z)), `(${x}, ${z}) is ${surfaceAt(x, z).height}, the model says ${ringHeightAt(x, z)}`).toBeLessThanOrEqual(SURFACE_TOLERANCE);
        probes++;
      }
    }
    expect(probes, `${probes} probes`).toBeGreaterThan(MIN_GRID_PROBES);
  });

  it("when each cup and pocket is read along a line out from its centre, then its floor, wall, rim top and skirt stand at the model's radii and heights", () => {
    for (const zone of ZONES) {
      const floorRadius = zone.radius - RING_CUP_PROFILE.wallFootWidth;
      const rimEndRadius = zone.radius + RING_CUP_PROFILE.rimTopWidth;
      const skirtMiddleRadius = rimEndRadius + RING_CUP_PROFILE.skirtWidth / 2;
      for (const angle of PROBE_ANGLES) {
        const probe = (radius: number) => surfaceAt(zone.centreX + radius * Math.cos(angle), zone.centreZ + radius * Math.sin(angle)).height;
        const label = `${zone.score} cup at ${angle} rad`;
        expect(Math.abs(probe(0) - zone.floorHeight), `${label}: floor centre ${probe(0)}`).toBeLessThanOrEqual(SURFACE_TOLERANCE);
        expect(Math.abs(probe(floorRadius / 2) - zone.floorHeight), `${label}: floor ${probe(floorRadius / 2)}`).toBeLessThanOrEqual(SURFACE_TOLERANCE);
        expect(Math.abs(probe(floorRadius + RING_CUP_PROFILE.wallFootWidth / 2) - (zone.floorHeight + RING_CUP_PROFILE.wallHeight / 2)), `${label}: wall middle ${probe(floorRadius + RING_CUP_PROFILE.wallFootWidth / 2)}`).toBeLessThanOrEqual(SURFACE_TOLERANCE);
        expect(Math.abs(probe(zone.radius + RING_CUP_PROFILE.rimTopWidth / 2) - zone.rimHeight), `${label}: rim top ${probe(zone.radius + RING_CUP_PROFILE.rimTopWidth / 2)}`).toBeLessThanOrEqual(SURFACE_TOLERANCE);
        const skirtMiddleX = zone.centreX + skirtMiddleRadius * Math.cos(angle);
        const skirtMiddleZ = zone.centreZ + skirtMiddleRadius * Math.sin(angle);
        expect(Math.abs(probe(skirtMiddleRadius) - ringHeightAt(skirtMiddleX, skirtMiddleZ)), `${label}: skirt middle ${probe(skirtMiddleRadius)}, the model says ${ringHeightAt(skirtMiddleX, skirtMiddleZ)}`).toBeLessThanOrEqual(SURFACE_TOLERANCE);
      }
    }
  });

  it("when each cup's rim crest is read, then its vertices lie on two exact circles, closely enough spaced to read as round, and the wall's normals all tilt alike", () => {
    for (const zone of ZONES) {
      const rimEndRadius = zone.radius + RING_CUP_PROFILE.rimTopWidth;
      const crest = whiteVertices.filter((vertex) => Math.abs(vertex.y - zone.rimHeight) <= HEIGHT_TOLERANCE && Math.hypot(vertex.x - zone.centreX, vertex.z - zone.centreZ) < rimEndRadius + HEIGHT_TOLERANCE);
      expect(crest.length, `${zone.score} rim has ${crest.length} vertices`).toBeGreaterThanOrEqual(2 * MIN_RIM_VERTICES_PER_CIRCLE);
      for (const vertex of crest) {
        const radius = Math.hypot(vertex.x - zone.centreX, vertex.z - zone.centreZ);
        expect(Math.abs(radius - zone.radius) <= HEIGHT_TOLERANCE || Math.abs(radius - rimEndRadius) <= HEIGHT_TOLERANCE, `${zone.score} rim vertex at radius ${radius}`).toBeTruthy();
      }
      const normals = white.geometry.getAttribute("normal");
      const colours = white.geometry.getAttribute("color");
      const wallFoot = whiteVertices
        .map((vertex, index) => ({ vertex, index }))
        .filter(({ vertex, index }) => Math.abs(vertex.y - zone.floorHeight) <= HEIGHT_TOLERANCE && colours.getX(index) > WALL_COLOUR_MIN_RED && Math.abs(Math.hypot(vertex.x - zone.centreX, vertex.z - zone.centreZ) - (zone.radius - RING_CUP_PROFILE.wallFootWidth)) <= HEIGHT_TOLERANCE);
      expect(wallFoot.length, `${zone.score} wall foot has ${wallFoot.length} vertices`).toBeGreaterThanOrEqual(MIN_RIM_VERTICES_PER_CIRCLE);
      for (const { vertex, index } of wallFoot) {
        const inwardness = ((zone.centreX - vertex.x) * normals.getX(index) + (zone.centreZ - vertex.z) * normals.getZ(index)) / Math.hypot(vertex.x - zone.centreX, vertex.z - zone.centreZ);
        expect(Math.abs(inwardness - Math.sqrt(1 - normals.getY(index) ** 2)), `${zone.score} wall normal (${normals.getX(index)}, ${normals.getY(index)}, ${normals.getZ(index)}) does not point to the centre`).toBeLessThanOrEqual(NORMAL_TOLERANCE);
        expect(Math.abs(normals.getY(index) - normals.getY(wallFoot[0]!.index)), `${zone.score} wall normals tilt differently`).toBeLessThanOrEqual(NORMAL_TOLERANCE);
      }
    }
  });

  it("when the rim is read along its sides, back and corners, then it rises over its ramp, stands at the model's rim height with its top and slope where the profile puts them, and is solid in the corner cut-offs", () => {
    const { maxX, maxZ } = RING_BOARD_BOUNDS;
    const fullHeightX = RING_RAIL_START_X + RING_RAIL_PROFILE.rampLength + 1;
    const cornerCentreX = RING_POCKETS[0]!.centreX;
    const cornerCentreZ = RING_POCKETS[1]!.centreZ;
    const cornerRadius = maxX - cornerCentreX;
    const slopeMiddle = RING_RAIL_PROFILE.topWidth + RING_RAIL_PROFILE.slopeWidth / 2;
    const insideSlope = RING_RAIL_PROFILE.topWidth + RING_RAIL_PROFILE.slopeWidth + RIM_CLEAR_MARGIN;
    const aroundCorner = (radius: number) => ({ x: cornerCentreX + radius * Math.SQRT1_2, z: cornerCentreZ + radius * Math.SQRT1_2 });
    const probes = [
      { name: "no rim before its start", x: RING_RAIL_START_X - RIM_CLEAR_MARGIN, z: -maxZ + RING_RAIL_PROFILE.topWidth / 2, rise: 0 },
      { name: "halfway up its ramp", x: RING_RAIL_START_X + RING_RAIL_PROFILE.rampLength / 2, z: -maxZ + RING_RAIL_PROFILE.topWidth / 2, rise: RING_RAIL_PROFILE.height / 2 },
      { name: "left side top", x: fullHeightX, z: -maxZ + RING_RAIL_PROFILE.topWidth / 2, rise: RING_RAIL_PROFILE.height },
      { name: "right side top", x: fullHeightX, z: maxZ - RING_RAIL_PROFILE.topWidth / 2, rise: RING_RAIL_PROFILE.height },
      { name: "left side slope", x: fullHeightX, z: -maxZ + slopeMiddle, rise: RING_RAIL_PROFILE.height / 2 },
      { name: "left side, just inside the slope", x: fullHeightX, z: -maxZ + insideSlope, rise: 0 },
      { name: "back top", x: maxX - RING_RAIL_PROFILE.topWidth / 2, z: 0, rise: RING_RAIL_PROFILE.height },
      { name: "back slope", x: maxX - slopeMiddle, z: 0, rise: RING_RAIL_PROFILE.height / 2 },
      { name: "back, just inside the slope", x: maxX - insideSlope, z: 0, rise: 0 },
      { name: "right corner top", ...aroundCorner(cornerRadius - RING_RAIL_PROFILE.topWidth / 2), rise: RING_RAIL_PROFILE.height },
      { name: "right corner slope", ...aroundCorner(cornerRadius - slopeMiddle), rise: RING_RAIL_PROFILE.height / 2 },
      { name: "right corner cut-off beyond the arc", ...aroundCorner(cornerRadius + CORNER_CUT_OFF_PROBE), rise: RING_RAIL_PROFILE.height },
    ];
    for (const probe of probes) {
      const expected = ringBoardPlaneHeight(probe.x) + probe.rise;
      expect(Math.abs(surfaceAt(probe.x, probe.z).height - expected), `${probe.name}: ${surfaceAt(probe.x, probe.z).height}, expected ${expected}`).toBeLessThanOrEqual(SURFACE_TOLERANCE);
    }
    expect(Math.abs(cornerCentreZ + cornerRadius - maxZ), "the corner arc is tangent to the side").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
  });

  it("when the board's wooden skirt is read, then each wall hangs from the model's height down to the pad", () => {
    const skirtVertices = verticesOf(wood).filter((vertex) => Math.abs(vertex.z) >= RING_BOARD_BOUNDS.maxZ - HEIGHT_TOLERANCE || vertex.x >= RING_BOARD_BOUNDS.maxX - HEIGHT_TOLERANCE);
    expect(skirtVertices.length, "a skirt exists").toBeGreaterThan(0);
    for (const vertex of skirtVertices) {
      const topHeight = ringHeightAt(vertex.x, vertex.z);
      expect(Math.abs(vertex.y) <= HEIGHT_TOLERANCE || Math.abs(vertex.y - topHeight) <= HEIGHT_TOLERANCE || Math.abs(vertex.y - ringBoardPlaneHeight(vertex.x)) <= HEIGHT_TOLERANCE, `skirt vertex (${vertex.x}, ${vertex.z}) at ${vertex.y} is neither the pad nor ${topHeight}`).toBeTruthy();
    }
  });

  it("when the colours are read, then the board is a mid tone clearly darker than the glossy white cups and rim, the cup floors are light (lighter than the board, a shade under the cups), and the lane is darker than the board", () => {
    const lightnessOf = (colour: THREE.Color) => colour.getHSL({ h: 0, s: 0, l: 0 }).l;
    const cup = RING_CUPS[0]!;
    const cupSkirtEdgeZ = cup.radius + RING_CUP_PROFILE.rimTopWidth + RING_CUP_PROFILE.skirtWidth;
    const railFootZ = RING_BOARD_BOUNDS.maxZ - RING_RAIL_PROFILE.topWidth - RING_RAIL_PROFILE.slopeWidth;
    const boardLightness = lightnessOf(surfaceAt(cup.centreX, (cupSkirtEdgeZ + railFootZ) / 2).colour);
    const rimLightness = lightnessOf(surfaceAt(cup.centreX - cup.radius - RING_CUP_PROFILE.rimTopWidth / 2, 0).colour);
    const sideRimLightness = lightnessOf(surfaceAt(RING_RAIL_START_X + RING_RAIL_PROFILE.rampLength + 1, -RING_BOARD_BOUNDS.maxZ + RING_RAIL_PROFILE.topWidth / 2).colour);
    const floorLightness = lightnessOf(surfaceAt(cup.centreX, cup.centreZ + (cup.radius - RING_CUP_PROFILE.wallFootWidth) / 2).colour);
    const laneLightness = lightnessOf(new THREE.Color(STATION_SURFACE_STYLES.ringFling.baseColour));
    expect(boardLightness, `board ${boardLightness} against cup rim ${rimLightness}`).toBeLessThanOrEqual(BOARD_TO_WHITE_LIGHTNESS_MAX * rimLightness);
    expect(boardLightness, `board ${boardLightness} against side rim ${sideRimLightness}`).toBeLessThanOrEqual(BOARD_TO_WHITE_LIGHTNESS_MAX * sideRimLightness);
    expect(floorLightness, `cup floor ${floorLightness} is no lighter than the board ${boardLightness}: it would read as a hole`).toBeGreaterThan(boardLightness);
    expect(floorLightness, `cup floor ${floorLightness} is too dark for black numerals`).toBeGreaterThanOrEqual(CUP_FLOOR_LIGHTNESS_MIN);
    expect(floorLightness, `cup floor ${floorLightness} against the cups' white ${rimLightness}`).toBeLessThan(rimLightness);
    expect(laneLightness, `lane ${laneLightness} against board ${boardLightness}`).toBeLessThan(boardLightness);
  });

  it("when the numeral discs are read, then there is one per cup and pocket, centred on it, lying wholly inside its floor circle, and each reads its zone's score", () => {
    const numerals = meshNamed(art, "ring-numerals");
    const vertices = verticesOf(numerals);
    const uv = numerals.geometry.getAttribute("uv");
    const atlas = recordingCanvases.find((canvas) => canvas.drawnTexts.some((drawn) => drawn.text === "10"))!;
    const nearestZoneIndex = (vertex: Vertex) =>
      ZONES.map((zone, zoneIndex) => ({ zoneIndex, distance: Math.hypot(vertex.x - zone.centreX, vertex.z - zone.centreZ) })).sort((first, second) => first.distance - second.distance)[0]!.zoneIndex;
    for (let zoneIndex = 0; zoneIndex < ZONES.length; zoneIndex++) {
      const zone = ZONES[zoneIndex]!;
      const members = vertices.map((vertex, index) => ({ vertex, index })).filter(({ vertex }) => nearestZoneIndex(vertex) === zoneIndex);
      expect(members.length, `${zone.score} disc has ${members.length} vertices`).toBeGreaterThanOrEqual(MIN_DISC_VERTICES);
      const corners = members.map(({ vertex }) => vertex);
      expect(Math.abs((Math.max(...corners.map((corner) => corner.x)) + Math.min(...corners.map((corner) => corner.x))) / 2 - zone.centreX), `${zone.score} centre x`).toBeLessThanOrEqual(HEIGHT_TOLERANCE);
      expect(Math.abs((Math.max(...corners.map((corner) => corner.z)) + Math.min(...corners.map((corner) => corner.z))) / 2 - zone.centreZ), `${zone.score} centre z`).toBeLessThanOrEqual(HEIGHT_TOLERANCE);
      const hover = mean(corners.map((corner) => corner.y)) - zone.floorHeight;
      expect(hover > 0 && hover <= DECAL_HOVER_MAX, `${zone.score} hovers ${hover} m over its floor`).toBeTruthy();
      const floorRadius = zone.radius - RING_CUP_PROFILE.wallFootWidth;
      for (const corner of corners) {
        const reach = Math.hypot(corner.x - zone.centreX, corner.z - zone.centreZ);
        expect(reach, `a ${zone.score} disc vertex is ${reach} m out, the floor circle is ${floorRadius} m`).toBeLessThanOrEqual(floorRadius);
      }
      const alongThrow = Math.max(...corners.map((corner) => corner.x)) - Math.min(...corners.map((corner) => corner.x));
      const acrossLane = Math.max(...corners.map((corner) => corner.z)) - Math.min(...corners.map((corner) => corner.z));
      expect(Math.min(alongThrow, acrossLane), `a ${zone.score} disc is ${alongThrow} x ${acrossLane} m: a dummy ${DUMMY_LYING_WIDTH} m wide, either way round, would cover all of it`).toBeGreaterThan(DUMMY_LYING_WIDTH);
      const atlasX = mean(members.map(({ index }) => uv.getX(index))) * atlas.width;
      const atlasY = (1 - mean(members.map(({ index }) => uv.getY(index)))) * atlas.height;
      const [readText] = [...atlas.drawnTexts].sort((first, second) => Math.hypot(first.x - atlasX, first.y - atlasY) - Math.hypot(second.x - atlasX, second.y - atlasY));
      expect(readText!.text, `the disc at the ${zone.score} zone reads ${readText!.text}`).toBe(String(zone.score));
    }
  });

  it("when the numerals' atlas and the backboard's face were drawn, then every score and the title were written and the score strip shows dashes, never a number", () => {
    const writtenTexts = recordingCanvases.flatMap((canvas) => canvas.drawnTexts.map((drawn) => drawn.text));
    for (const text of ["10", "20", "30", "40", "50", "100", "RING FLING", "HIGH SCORE", "---"]) expect(writtenTexts.includes(text), `"${text}" is drawn`).toBeTruthy();
    expect(!writtenTexts.includes("000"), "the strip does not claim a score").toBe(true);
  });

  it("when the backboard is read, then its front face stands at the backstop's distance with the stated height, thickness and a span wider than the board", () => {
    const slab = verticesOf(meshNamed(art, "ring-backboard"));
    const frontX = RING_BOARD_BOUNDS.maxX + RING_BACKSTOP.distancePastBoard;
    expect(Math.abs(Math.min(...slab.map((vertex) => vertex.x)) - frontX), "front face x").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    expect(Math.abs(Math.max(...slab.map((vertex) => vertex.x)) - (frontX + RING_BACKSTOP.thickness)), "back face x").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    expect(Math.abs(Math.max(...slab.map((vertex) => vertex.y)) - RING_BACKSTOP.height), "top").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    expect(Math.abs(Math.min(...slab.map((vertex) => vertex.y))), "foot on the pad").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    expect(Math.min(...slab.map((vertex) => vertex.z)), "reaches past the board's left side").toBeLessThanOrEqual(RING_BOARD_BOUNDS.minZ - RING_RAIL_PROFILE.height + HEIGHT_TOLERANCE);
    expect(Math.max(...slab.map((vertex) => vertex.z)), "reaches past the board's right side").toBeGreaterThanOrEqual(RING_BOARD_BOUNDS.maxZ + RING_RAIL_PROFILE.height - HEIGHT_TOLERANCE);
    const faceX = verticesOf(meshNamed(art, "ring-backboard-face")).map((vertex) => vertex.x);
    expect(Math.max(...faceX) < frontX && frontX - Math.max(...faceX) < RING_BACKSTOP.thickness, "the face hovers a hair in front of the slab, facing the lip").toBeTruthy();
  });

  it("when the backboard's wings are read, then one flanks each end of the slab, splayed forward and outward, clear of the board and lower than the slab", () => {
    const wings = verticesOf(meshNamed(art, "ring-backboard-wings"));
    const frontX = RING_BOARD_BOUNDS.maxX + RING_BACKSTOP.distancePastBoard;
    const slabHalfWidth = (RING_BOARD_BOUNDS.maxZ - RING_BOARD_BOUNDS.minZ) / 2 + RING_RAIL_PROFILE.height;
    for (const side of [-1, 1]) {
      const wing = wings.filter((vertex) => Math.sign(vertex.z) === side);
      expect(wing.length, `a wing on the ${side} side`).toBeGreaterThan(0);
      expect(Math.min(...wing.map((vertex) => vertex.x)), `the ${side} wing reaches forward of the slab`).toBeLessThan(frontX - MIN_WING_REACH);
      expect(Math.max(...wing.map((vertex) => vertex.x)), `the ${side} wing stays in front of the slab's back face`).toBeLessThanOrEqual(frontX + RING_BACKSTOP.thickness + HEIGHT_TOLERANCE);
      expect(Math.max(...wing.map((vertex) => Math.abs(vertex.z))), `the ${side} wing splays outward past the slab's end`).toBeGreaterThan(slabHalfWidth + MIN_WING_REACH);
      expect(Math.min(...wing.map((vertex) => Math.abs(vertex.z))), `the ${side} wing stands clear of the board`).toBeGreaterThanOrEqual(RING_BOARD_BOUNDS.maxZ);
      expect(Math.max(...wing.map((vertex) => vertex.y)), `the ${side} wing is lower than the slab`).toBeLessThan(RING_BACKSTOP.height);
      expect(Math.abs(Math.min(...wing.map((vertex) => vertex.y))), `the ${side} wing stands on the pad`).toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    }
  });

  it("when the station is drawn, then it costs no more than the draw budget, the numerals are one merged mesh, no two meshes share a geometry and the black pieces share one material", () => {
    const meshes = allMeshes(art);
    expect(meshes.length, `${meshes.length} meshes, budget ${RING_FLING_DRAW_BUDGET}`).toBeLessThanOrEqual(RING_FLING_DRAW_BUDGET);
    expect(meshes.filter((mesh) => mesh.name === "ring-numerals").length, "all numerals in one mesh").toBe(1);
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size, "one geometry per mesh, none per cup").toBe(meshes.length);
    expect(meshNamed(art, "ring-backboard").material, "the slab and the wings share a material").toBe(meshNamed(art, "ring-backboard-wings").material);
  });
});

describe("given the Ring Fling backstop's constant", () => {
  const boardTop = Math.max(...RING_CUPS.map((cup) => cup.rimHeight), ...RING_POCKETS.map((pocket) => pocket.rimHeight));

  it("when it is read, then it is the real machine's 50 in backboard and 1 in thickness at the board's scale, with a positive gap", () => {
    expect(RING_BACKSTOP.distancePastBoard, "gap past the board").toBeGreaterThan(0);
    expect(Math.abs(RING_BACKSTOP.height - REAL_BACKBOARD_HEIGHT_INCHES * REAL_INCH_SCALED), "height").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    expect(Math.abs(RING_BACKSTOP.thickness - REAL_INCH_SCALED), "thickness").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
  });

  it("when it is read against the board, then it stands over every rim and is at least 3 x the 50 cup's rim height", () => {
    expect(RING_BACKSTOP.height, "above the highest rim").toBeGreaterThan(boardTop);
    expect(RING_BACKSTOP.height, `${RING_BACKSTOP.height} m is less than ${BACKSTOP_RIM_CLEARANCE_FACTOR} x the 50 cup's rim (${RING_CUPS[4]!.rimHeight} m)`).toBeGreaterThanOrEqual(BACKSTOP_RIM_CLEARANCE_FACTOR * RING_CUPS[4]!.rimHeight);
  });

  it("when a dummy leaves the highest rim at the fastest design throw, then his ballistic apex stays under the backstop's top", () => {
    const apexRise = (DESIGN_THROW_SPEED_MAX * Math.sin(DESIGN_THROW_PITCH)) ** 2 / (2 * GRAVITY);
    expect(RING_BACKSTOP.height, `top ${RING_BACKSTOP.height} m, a dummy at ${boardTop} m rises ${apexRise} m`).toBeGreaterThanOrEqual(boardTop + apexRise);
  });
});
