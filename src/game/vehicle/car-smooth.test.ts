import * as THREE from "three";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { CAR_STYLES, CAR_STYLE_IDS, type BodyStyle, type CarStyleId } from "./car-variants.ts";
import { makeRoofFittings } from "./car-fittings-mesh.ts";
import { CREASE_DEGREES, SHUT_RAMP, bayAt, cantY, makeBumperGeometry, makeHoodGeometry, makeTrunkGeometry, sampleSlice, sectionPoints, shoulderTop } from "./car-mesh.ts";
import { makeChassisGeometry, sliceZs } from "./car-chassis-mesh.ts";
import { PRIMER_ATTRIBUTE } from "./constants.ts";
import { archLipGeometry, makeWellLiners, wellHumpGeometry } from "./car-well-mesh.ts";
import { makeDoorGeometry } from "./car-door-mesh.ts";
import { SAIL_SWEEP, makeGreenhouseFrame, makeRoofGeometry, postSection } from "./car-greenhouse-mesh.ts";
import { DeformableCar } from "./car.ts";
import { panelRegions, PANEL_NAMES } from "./car-panels.ts";
import { cageSourceOf } from "./car-cage-rig.ts";
import { assertSameDigest, paint } from "./test-support.ts";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { tyresUnderSkin } from "./car-suspension.ts";
import { STYLE_CLASS } from "./vehicle-classes.ts";

const DEGREES_PER_RADIAN = 180 / Math.PI;

type Loft = { ring: number; slices: number };

const loftOf = (geometry: THREE.BufferGeometry): Loft => geometry.userData.loft as Loft;
const positionAt = (geometry: THREE.BufferGeometry, vertex: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("position"), vertex);
const angleBetweenDegrees = (a: THREE.Vector3, b: THREE.Vector3): number => Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * DEGREES_PER_RADIAN;
const triangleCountOf = (geometry: THREE.BufferGeometry): number => (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;

// ---- the measuring helpers ------------------------------------------------------------------------------------------------

/** A face thinner than this (m^2, doubled) has no normal to compare. */
const DEGENERATE_FACE_AREA = 1e-12;

/** Unit normal of the triangle (a, b, c), or null when it is degenerate. */
function triangleNormal(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 | null {
  const normal = b.clone().sub(a).cross(c.clone().sub(a));
  return normal.lengthSq() < DEGENERATE_FACE_AREA ? null : normal.normalize();
}

/** Unit normal of the loft quad of ring segment `segment` between slices `slice` and `slice + 1`, or null when degenerate. */
function loftQuadNormal(geometry: THREE.BufferGeometry, loft: Loft, slice: number, segment: number): THREE.Vector3 | null {
  const next = (segment + 1) % loft.ring;
  const a = positionAt(geometry, slice * loft.ring + segment);
  const b = positionAt(geometry, slice * loft.ring + next);
  const c = positionAt(geometry, (slice + 1) * loft.ring + segment);
  const d = positionAt(geometry, (slice + 1) * loft.ring + next);
  const sum = b.clone().sub(a).cross(c.clone().sub(a)).add(d.clone().sub(b).cross(c.clone().sub(b)));
  return sum.lengthSq() < DEGENERATE_FACE_AREA ? null : sum.normalize();
}

/** The angles (degrees) between the quad before ring line `line` and the quad after it, at every slice of the loft: the lengthwise edge's dihedral. */
function ringLineDihedrals(geometry: THREE.BufferGeometry, line: number, sliceFilter: (slice: number) => boolean = () => true): number[] {
  const loft = loftOf(geometry);
  const angles: number[] = [];
  for (let slice = 0; slice < loft.slices - 1; slice++) {
    if (!sliceFilter(slice)) continue;
    const before = loftQuadNormal(geometry, loft, slice, (line + loft.ring - 1) % loft.ring);
    const after = loftQuadNormal(geometry, loft, slice, line);
    if (before && after) angles.push(angleBetweenDegrees(before, after));
  }
  return angles;
}

/** How many vertices of `geometry` sit exactly where vertex `vertex` does (1: a lone vertex, 2 or more: the edge was split here). */
function verticesAtSamePlace(geometry: THREE.BufferGeometry, vertex: number): number {
  const position = geometry.getAttribute("position");
  let count = 0;
  for (let other = 0; other < position.count; other++) {
    if (position.getX(other) === position.getX(vertex) && position.getY(other) === position.getY(vertex) && position.getZ(other) === position.getZ(vertex)) count++;
  }
  return count;
}

type EdgeCensus = { sharpEdges: number; sharpEdgesStillShared: number; smoothEdgesSplit: number; firstOffence: string };

/**
 * Every edge shared by exactly two faces of `geometry` (edges matched by the vertices' places, so a split edge still counts), against
 * `creaseDegrees`: the sharp ones (the faces' normals at least that far apart) must not share their vertices, the smooth ones must.
 * A loft's end caps (`loftFromRings` writes them after its quads) are the panel's cut ends, hard by construction: their seams are not read.
 */
function censusOfEdges(geometry: THREE.BufferGeometry, creaseDegrees: number, capsAreCuts: boolean): EdgeCensus {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  const placeOf = (vertex: number) => `${position.getX(vertex)},${position.getY(vertex)},${position.getZ(vertex)}`;
  const faces = new Map<string, { normal: THREE.Vector3; vertices: string; cut: boolean }[]>();
  const loft = geometry.userData.loft as { ring: number; slices: number } | undefined;
  const firstCapTriangle = capsAreCuts && loft ? 2 * loft.ring * (loft.slices - 1) : Infinity;
  for (let t = 0; t < index.count; t += 3) {
    const cut = t / 3 >= firstCapTriangle;
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    const normal = triangleNormal(...(corners.map((vertex) => positionAt(geometry, vertex)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]));
    if (!normal) continue;
    for (let k = 0; k < 3; k++) {
      const [a, b] = [corners[k]!, corners[(k + 1) % 3]!];
      const key = [placeOf(a), placeOf(b)].sort().join("|");
      const record = { normal, vertices: [a, b].sort((x, y) => x - y).join(","), cut };
      const list = faces.get(key);
      if (list) list.push(record);
      else faces.set(key, [record]);
    }
  }
  const census: EdgeCensus = { sharpEdges: 0, sharpEdgesStillShared: 0, smoothEdgesSplit: 0, firstOffence: "none" };
  for (const [key, [first, second, ...rest]] of faces) {
    if (!first || !second || rest.length > 0 || first.cut !== second.cut) continue;
    const shared = first.vertices === second.vertices;
    const degrees = angleBetweenDegrees(first.normal, second.normal);
    if (degrees >= creaseDegrees) {
      census.sharpEdges++;
      if (shared) census.sharpEdgesStillShared++;
      if (shared && census.firstOffence === "none") census.firstOffence = `a ${degrees.toFixed(1)}° edge at ${key} shares its vertices`;
    } else if (!shared) {
      census.smoothEdgesSplit++;
      if (census.firstOffence === "none") census.firstOffence = `a ${degrees.toFixed(1)}° edge at ${key} is split`;
    }
  }
  return census;
}

// ---- (a) rest normals ------------------------------------------------------------------------------------------------------

/** Half-ring indices of the body's side that the arches and the door cut never reach: the shoulder rows and the feature line (`sectionPoints`); the ring's deck rows face up into a tub on some bodies, so no outward test reads them. */
const SIDE_HALF_FIRST = 2;
const SIDE_HALF_LAST = 4;
/** Slices nearer than this (m) to the end faces are the rolled ends. */
const END_SLICES = 3;
/** The front door's cut runs from z 0 to 0.54 (`doorAperture`): the side there drops to the sill and faces up, so no outward test reads it. */
const DOOR_CUT_Z = [-0.05, 0.6] as const;

/** The slice's ring points on the body's side (both halves), with the vertex's ring-centroid estimate of "outward". */
function outerSidePoints(geometry: THREE.BufferGeometry, normals: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): { vertex: number; normal: THREE.Vector3; outward: THREE.Vector3 }[] {
  const loft = loftOf(geometry);
  const halfCount = (loft.ring - 1) / 2;
  const centre = new THREE.Vector3();
  for (let vertex = 0; vertex < loft.ring * loft.slices; vertex++) centre.add(positionAt(geometry, vertex));
  centre.multiplyScalar(1 / (loft.ring * loft.slices));
  const points: { vertex: number; normal: THREE.Vector3; outward: THREE.Vector3 }[] = [];
  for (let slice = 0; slice < loft.slices; slice++) {
    const ringCentre = new THREE.Vector3();
    for (let k = 0; k < loft.ring; k++) ringCentre.add(positionAt(geometry, slice * loft.ring + k));
    ringCentre.multiplyScalar(1 / loft.ring);
    const isEnd = slice < END_SLICES || slice >= loft.slices - END_SLICES;
    for (let k = 0; k < loft.ring; k++) {
      const half = k < halfCount ? k : loft.ring - 1 - k;
      if (k === halfCount || half > SIDE_HALF_LAST || half < SIDE_HALF_FIRST) continue;
      const vertex = slice * loft.ring + k;
      const at = positionAt(geometry, vertex);
      if (!isEnd && at.z > DOOR_CUT_Z[0] && at.z < DOOR_CUT_Z[1]) continue;
      points.push({ vertex, normal: new THREE.Vector3().fromBufferAttribute(normals, vertex), outward: at.clone().sub(isEnd ? centre : ringCentre).normalize() });
    }
  }
  return points;
}

const normalTestCases = CAR_STYLE_IDS.map((id) => ({ id }));

describe("given every body style's rest meshes (chassis, bonnet, boot, doors, bumpers) as built", () => {
  for (const testCase of normalTestCases) {
    const style = CAR_STYLES[testCase.id];
    const meshes: [string, THREE.BufferGeometry][] = [
      ["chassis", makeChassisGeometry(style)],
      ["bonnet", makeHoodGeometry(style)],
      ["boot", makeTrunkGeometry(style)],
      ["left door", makeDoorGeometry(-1, style)],
      ["right door", makeDoorGeometry(1, style)],
      ["front bumper", makeBumperGeometry(true, style)],
      ["rear bumper", makeBumperGeometry(false, style)],
    ];

    it(`when a ${testCase.id}'s normals are read, then every normal of every mesh is finite and unit length`, () => {
      for (const [name, geometry] of meshes) {
        const normal = geometry.getAttribute("normal");
        for (let vertex = 0; vertex < normal.count; vertex++) {
          const length = Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
          assert.ok(Math.abs(length - 1) < 1e-4, `${testCase.id} ${name} vertex ${vertex}: normal length ${length}`);
        }
      }
    });

    it(`when a ${testCase.id}'s body side and ends are read, then every normal points outward (dot with the centroid direction above 0)`, () => {
      const chassis = meshes[0]![1];
      for (const point of outerSidePoints(chassis, chassis.getAttribute("normal"))) {
        assert.ok(point.normal.dot(point.outward) > 0, `${testCase.id} vertex ${point.vertex}: normal ${point.normal.dot(point.outward)} against outward`);
      }
    });
  }
});

// ---- (b) the declared creases and curves ----------------------------------------------------------------------------------

/** An edge that rolls round (a pillar's octagon corner, the nose's roll) must turn by less than this per chord: the octagon's 45° plus a 5° margin. */
const ROLLED_EDGE_LIMIT_DEGREES = 50;
/** A lid's dome, bow and skirt corners barely turn: under 5° a chord. */
const FLAT_CURVE_LIMIT_DEGREES = 5;

const lidCreaseTable = [
  // The sedan's hood is crowned (`hood.crown`): its ring carries 3 dome points a side (17 points), so the shut line and lip corners sit at 0, 8, 10 to 15.
  { it: "a bonnet's shut line and lip corners (ring points 0, 8, 10 to 15)", style: "sedan", part: "bonnet", creaseLines: [0, 8, 10, 11, 12, 13, 14, 15], smoothLines: [1, 2, 3, 4, 5, 6, 7, 9, 16], creaseDegrees: CREASE_DEGREES.deckLid },
  { it: "a sedan boot lid's shut line and lip corners (ring points 0, 4, 6 to 11)", style: "sedan", part: "boot", creaseLines: [0, 4, 6, 7, 8, 9, 10, 11], smoothLines: [1, 2, 3, 5, 12], creaseDegrees: CREASE_DEGREES.deckLid },
  { it: "a hatchback's tailgate edges (ring points 0, 4, 5, 6)", style: "hatchback", part: "boot", creaseLines: [0, 4, 5, 6], smoothLines: [1, 2, 3], creaseDegrees: CREASE_DEGREES.tailgate },
] as const;

/** The sedan with the reference's hood crown: its top 6 cm under the centre line at |x| .66. */
const CROWNED_SEDAN: BodyStyle = { ...CAR_STYLES.sedan, hood: { ...CAR_STYLES.sedan.hood, crown: [0.06, 0.66] } };

describe("given the lids as built", () => {
  for (const testCase of lidCreaseTable) {
    it(`when ${testCase.it} are read, then each turns its declared ${testCase.creaseDegrees}° or more at vertices of its own, and the dome or bow turns under ${FLAT_CURVE_LIMIT_DEGREES}° as one vertex`, () => {
      const style = CAR_STYLES[testCase.style];
      const lid = testCase.part === "bonnet" ? makeHoodGeometry(style) : makeTrunkGeometry(style);
      const loft = loftOf(lid);
      const inner = (slice: number) => slice > 0 && slice < loft.slices - 2;
      for (const line of testCase.creaseLines) {
        const angles = ringLineDihedrals(lid, line, inner);
        assert.ok(Math.min(...angles) >= testCase.creaseDegrees, `ring line ${line} turns only ${Math.min(...angles)}°`);
        for (let slice = 1; slice < loft.slices - 1; slice++) {
          assert.ok(verticesAtSamePlace(lid, slice * loft.ring + line) >= 2, `ring line ${line} slice ${slice} is one vertex: its crease is not split`);
        }
      }
      for (const line of testCase.smoothLines) {
        const angles = ringLineDihedrals(lid, line, inner);
        assert.ok(Math.max(...angles) < FLAT_CURVE_LIMIT_DEGREES, `ring line ${line} turns ${Math.max(...angles)}°`);
        for (let slice = 1; slice < loft.slices - 1; slice++) {
          assert.equal(verticesAtSamePlace(lid, slice * loft.ring + line), 1, `ring line ${line} slice ${slice} is split: its curve is not smooth`);
        }
      }
    });
  }

  it(`when a crowned hood (the sedan's: 6 cm under the centre at |x| .66) is read, then its centre stands that parabola's drop over its edge at every station and its dome, edge to edge, turns under ${FLAT_CURVE_LIMIT_DEGREES}° at each of its own vertices`, () => {
    const [drop, at] = CROWNED_SEDAN.hood.crown!;
    const lid = makeHoodGeometry(CROWNED_SEDAN);
    const loft = loftOf(lid);
    // The top runs edge, dome points, centre, dome points, edge; the skirt and underside are the ring's last 8 points.
    const rim = loft.ring - 9;
    for (let slice = 0; slice < loft.slices; slice++) {
      const edge = positionAt(lid, slice * loft.ring);
      const rise = positionAt(lid, slice * loft.ring + rim / 2).y - edge.y;
      const want = drop * (edge.x / at) ** 2;
      assert.ok(Math.abs(rise - want) < 1e-4, `slice ${slice}: the centre stands ${(rise * 100).toFixed(2)} cm over the edge at |x| ${(-edge.x).toFixed(3)}, want ${(want * 100).toFixed(2)}`);
    }
    const inner = (slice: number) => slice > 0 && slice < loft.slices - 2;
    for (let line = 1; line < rim; line++) {
      const turn = Math.max(...ringLineDihedrals(lid, line, inner));
      assert.ok(turn < FLAT_CURVE_LIMIT_DEGREES, `dome ring line ${line} of ${rim - 1} turns ${turn.toFixed(2)}°`);
    }
  });
});

type PartCase = { readonly name: string; readonly make: (id: CarStyleId) => THREE.BufferGeometry; readonly creaseDegrees: number; readonly capsAreCuts: boolean };
const partCases: readonly PartCase[] = [
  { name: "bonnet", make: (id) => makeHoodGeometry(CAR_STYLES[id]), creaseDegrees: CREASE_DEGREES.deckLid, capsAreCuts: true },
  { name: "boot", make: (id) => makeTrunkGeometry(CAR_STYLES[id]), creaseDegrees: CREASE_DEGREES.deckLid, capsAreCuts: true },
  { name: "left door", make: (id) => makeDoorGeometry(-1, CAR_STYLES[id]), creaseDegrees: CREASE_DEGREES.door, capsAreCuts: false },
  { name: "right door", make: (id) => makeDoorGeometry(1, CAR_STYLES[id]), creaseDegrees: CREASE_DEGREES.door, capsAreCuts: false },
  { name: "front bumper", make: (id) => makeBumperGeometry(true, CAR_STYLES[id]), creaseDegrees: CREASE_DEGREES.bumper, capsAreCuts: true },
  { name: "rear bumper", make: (id) => makeBumperGeometry(false, CAR_STYLES[id]), creaseDegrees: CREASE_DEGREES.bumper, capsAreCuts: true },
];

describe("given every part whose hard edges are declared, as built for every body style", () => {
  for (const id of CAR_STYLE_IDS) {
    for (const testCase of partCases) {
      it(`when a ${id} ${testCase.name}'s edges are read against its ${testCase.creaseDegrees}° crease, then every sharper edge has vertices of its own and every softer one shares them`, () => {
        const geometry = testCase.make(id);
        const census = censusOfEdges(geometry, testCase.creaseDegrees, testCase.capsAreCuts);
        assert.ok(census.sharpEdges > 0, `${id} ${testCase.name} has no sharp edge at all`);
        assert.equal(census.sharpEdgesStillShared, 0, `${id} ${testCase.name}: sharp edges still share vertices (${JSON.stringify(census)})`);
        assert.equal(census.smoothEdgesSplit, 0, `${id} ${testCase.name}: smooth edges were split (${JSON.stringify(census)})`);
      });
    }
  }
});

/** The loft's quads wind one way all round: a left-side quad one slice in from the tail (ring segment 3, the shoulder's lower chord) faces -x when outward. */
const REFERENCE_SLICE = 1;
const REFERENCE_SEGMENT = 3;

/** The outward unit normal of ring segment `segment`'s quad between slices `slice` and `slice + 1`, or null when degenerate (the winding is read off the reference quad, so a tub's inward-facing floor still reads as it faces). */
function outwardQuadNormal(geometry: THREE.BufferGeometry, loft: Loft, slice: number, segment: number): THREE.Vector3 | null {
  const normal = loftQuadNormal(geometry, loft, slice, segment);
  const reference = loftQuadNormal(geometry, loft, REFERENCE_SLICE, REFERENCE_SEGMENT);
  if (!normal || !reference) return null;
  return reference.x > 0 ? normal.negate() : normal;
}

/** Whether ring segment `segment` lies on the body's side (both its points between the shoulder rows and the feature line on one half): the deck and floor rows turn into a tub at the pickup's tail. */
function isSideSegment(loft: Loft, segment: number): boolean {
  const halfCount = (loft.ring - 1) / 2;
  const halfOf = (point: number) => (point < halfCount ? point : loft.ring - 1 - point);
  const [first, second] = [halfOf(segment), halfOf((segment + 1) % loft.ring)];
  return first >= SIDE_HALF_FIRST && first <= SIDE_HALF_LAST && second >= SIDE_HALF_FIRST && second <= SIDE_HALF_LAST;
}

describe("given every body style's chassis, whose nose and tail roll into the end faces", () => {
  for (const id of CAR_STYLE_IDS) {
    for (const end of ["tail", "nose"] as const) {
      it(`when a ${id}'s ${end} rows are read, then no row turns ${ROLLED_EDGE_LIMIT_DEGREES}° or more from the one before, nor does the last from the flat end face`, () => {
        const body = makeChassisGeometry(CAR_STYLES[id]);
        const loft = loftOf(body);
        const rows = end === "tail" ? Array.from({ length: END_SLICES }, (_, k) => k) : Array.from({ length: END_SLICES }, (_, k) => loft.slices - 1 - k);
        const endFaceNormal = new THREE.Vector3(0, 0, end === "tail" ? -1 : 1);
        for (let segment = 0; segment < loft.ring; segment++) {
          if (!isSideSegment(loft, segment)) continue;
          const normals = rows.map((row) => outwardQuadNormal(body, loft, end === "tail" ? row : row - 1, segment));
          const outermost = normals[0];
          if (outermost) assert.ok(angleBetweenDegrees(outermost, endFaceNormal) < ROLLED_EDGE_LIMIT_DEGREES, `${id} ${end} segment ${segment}: ${angleBetweenDegrees(outermost, endFaceNormal)}° from the end face`);
          for (let k = 1; k < normals.length; k++) {
            const [outer, inner] = [normals[k - 1], normals[k]];
            if (outer && inner) assert.ok(angleBetweenDegrees(outer, inner) < ROLLED_EDGE_LIMIT_DEGREES, `${id} ${end} segment ${segment} row ${k}: ${angleBetweenDegrees(outer, inner)}° between rows`);
          }
        }
      });
    }
  }
});

/** A drawn nose's chord may sag this far (m) off the curve it spans at its middle: the body's deck edge and shoulder lines (ring points 1 to 4) off the station table's section, the hood's edge off its plan line. */
const NOSE_CHORD_SAG = 0.005;
/** How far back from the nose (m) its chords are read, and how far ahead of it the roll's own rings take over. */
const NOSE_READ = 0.25;
const NOSE_ROLL = 0.03;

describe("given every body style's drawn nose, whose plan and fender line turn hardest there", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s deck edge, shoulder and hood edge chords over its last ${NOSE_READ * 100} cm are read, then each lies within ${NOSE_CHORD_SAG * 1000} mm of the curve at its middle`, () => {
      const style = CAR_STYLES[id];
      const noseZ = style.profile[style.profile.length - 1]!.z;
      const body = makeChassisGeometry(style);
      const loft = loftOf(body);
      for (let slice = 0; slice < loft.slices - 1; slice++) {
        const [a, b] = [positionAt(body, slice * loft.ring), positionAt(body, (slice + 1) * loft.ring)];
        if (a.z < noseZ - NOSE_READ || b.z > noseZ - NOSE_ROLL) continue;
        const section = sectionPoints(sampleSlice((a.z + b.z) / 2, style.profile), style, "drawn");
        for (let point = 1; point <= 4; point++) {
          const line = loft.ring - 1 - point;
          const chord = positionAt(body, slice * loft.ring + line).add(positionAt(body, (slice + 1) * loft.ring + line)).multiplyScalar(0.5);
          const sag = Math.hypot(chord.x - section[line]!.x, chord.y - section[line]!.y);
          assert.ok(sag <= NOSE_CHORD_SAG, `${id} ring point ${point} between z ${a.z.toFixed(3)} and ${b.z.toFixed(3)}: ${(sag * 1000).toFixed(1)} mm off the section`);
        }
      }
      const hood = makeHoodGeometry(style);
      const hoodLoft = loftOf(hood);
      const [, oz] = style.hood.origin;
      // The edge (the top's last point) stands a fixed inset inside the station's half-width: its chord's middle against the half-width there.
      const rim = hoodLoft.ring - 9;
      const inset = (v: THREE.Vector3) => sampleSlice(v.z + oz, style.profile).hw - v.x;
      for (let slice = 0; slice < hoodLoft.slices - 1; slice++) {
        const [a, b] = [positionAt(hood, slice * hoodLoft.ring + rim), positionAt(hood, (slice + 1) * hoodLoft.ring + rim)];
        if (b.z + oz < noseZ - NOSE_READ) continue;
        const sag = Math.abs(inset(a.clone().add(b).multiplyScalar(0.5)) - inset(a));
        assert.ok(sag <= NOSE_CHORD_SAG, `${id} hood edge between z ${(a.z + oz).toFixed(3)} and ${(b.z + oz).toFixed(3)}: ${(sag * 1000).toFixed(1)} mm off its plan line`);
      }
    });
  }
});

/** Where the bay is open, the fender strip's wall-top vertex faces up and out with the strip (normal y over this), not sideways with the bay's wall. */
const WALL_TOP_NORMAL_Y = 0.5;
/** The drawn hood's edge stands at most this far (m) over the fender 2 mm outboard of it: a groove, not a step. */
const HOOD_EDGE_STEP = 0.005;
/** A clamshell's top edge and skirt (ring points 4, 5, 6) stand off the body's deck edge and shoulder by more than 0 and at most this (m): flush, never coincident. */
const CLAMSHELL_LAP = 0.002;
/** Under a clamshell's side shut line the body's 30° point stands at least this far (m) inboard of the line the lid's edge laps: a groove. */
const SHUT_GROOVE = 0.0025;
/** The SUV with a clamshell nose, its hood otherwise its own. */
const CLAMSHELL_SUV: BodyStyle = { ...CAR_STYLES.wagon, hood: { ...CAR_STYLES.wagon.hood, kind: "clamshell" } };

/** Distance (m) from `p` to the polyline `chain`. */
function distanceToChain(p: { x: number; y: number }, chain: readonly { x: number; y: number }[]): number {
  let best = Infinity;
  for (let k = 1; k < chain.length; k++) {
    const [a, b] = [chain[k - 1]!, chain[k]!];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = THREE.MathUtils.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

describe("given every body style's drawn hood over its open engine bay", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s fender strip beside the hood is read where the bay is open, then its wall-top vertex is painted and faces up (normal y over ${WALL_TOP_NORMAL_Y})`, () => {
      const style = CAR_STYLES[id];
      const body = makeChassisGeometry(style);
      const loft = loftOf(body);
      const normal = body.getAttribute("normal");
      const primer = body.getAttribute(PRIMER_ATTRIBUTE);
      let read = 0;
      for (let slice = 0; slice < loft.slices; slice++) {
        if (bayAt(positionAt(body, slice * loft.ring).z, style) < 0.5) continue;
        for (const point of [1, loft.ring - 2]) {
          const v = slice * loft.ring + point;
          assert.ok(normal.getY(v) > WALL_TOP_NORMAL_Y && primer.getX(v) === 0, `${id} slice ${slice} ring point ${point}: normal y ${normal.getY(v).toFixed(3)}, primer ${primer.getX(v)}`);
          read++;
        }
      }
      assert.ok(read > 0, `${id}: no slice over the open bay`);
    });

    it(`when a ${id}'s drawn hood is laid on its body, then its edge stands 0 to ${HOOD_EDGE_STEP * 1000} mm over the fender just outboard of it at every station`, (t) => {
      const style = CAR_STYLES[id];
      if (style.hood.kind === "clamshell") return t.skip("a clamshell wraps the fender instead");
      const hood = makeHoodGeometry(style);
      const loft = loftOf(hood);
      const [oy, oz] = style.hood.origin;
      for (let slice = 1; slice < loft.slices - 1; slice++) {
        const edge = positionAt(hood, slice * loft.ring + loft.ring - 9);
        const z = edge.z + oz;
        // The section's right half, outward from its deck edge (ring point 1): the fender's top line the edge looks over.
        const section = sectionPoints(sampleSlice(z, style.profile), style, "drawn");
        const top = section.slice(-5, -1).reverse();
        const x = edge.x + 0.002;
        const k = top.findIndex((p, i) => i > 0 && p.x >= x);
        const fender = x <= top[0]!.x || k < 0 ? top[0]!.y : top[k - 1]!.y + ((top[k]!.y - top[k - 1]!.y) * (x - top[k - 1]!.x)) / (top[k]!.x - top[k - 1]!.x);
        const step = edge.y + oy - fender;
        assert.ok(step >= 0 && step <= HOOD_EDGE_STEP, `${id} hood edge at z ${z.toFixed(3)}: ${(step * 1000).toFixed(1)} mm over the fender`);
      }
    });
  }

  it(`when an SUV's clamshell is laid on its body, then its top edge and skirt stand within ${CLAMSHELL_LAP * 1000} mm of the body's deck edge and shoulder at every station, both ends included`, () => {
    const hood = makeHoodGeometry(CLAMSHELL_SUV);
    const loft = loftOf(hood);
    const [oy, oz] = CLAMSHELL_SUV.hood.origin;
    for (let slice = 0; slice < loft.slices; slice++) {
      const z = positionAt(hood, slice * loft.ring).z + oz;
      // The section's right half from its 30° shoulder point up to its deck edge.
      const chain = sectionPoints(sampleSlice(z, CLAMSHELL_SUV.profile), CLAMSHELL_SUV, "drawn").slice(-4, -1);
      for (const k of [loft.ring - 9, loft.ring - 8, loft.ring - 7]) {
        const p = positionAt(hood, slice * loft.ring + k);
        const off = distanceToChain({ x: p.x, y: p.y + oy }, chain);
        assert.ok(off > 0 && off <= CLAMSHELL_LAP, `z ${z.toFixed(3)} ring point ${k}: ${(off * 1000).toFixed(2)} mm off the body`);
      }
    }
  });

  it(`when an SUV's body is read under its clamshell's side shut line, then its 30° shoulder point steps ${SHUT_GROOVE * 1000} mm or more in, and not at all on the slice at the lid's rear end`, () => {
    const body = makeChassisGeometry(CLAMSHELL_SUV);
    const loft = loftOf(body);
    const { z0, z1 } = CLAMSHELL_SUV.hood;
    const shut = loft.ring - 4;
    let [grooved, rearEnd] = [0, 0];
    for (let slice = 0; slice < loft.slices; slice++) {
      const v = positionAt(body, slice * loft.ring + shut);
      const step = sectionPoints(sampleSlice(v.z, CLAMSHELL_SUV.profile), CLAMSHELL_SUV, "drawn")[shut]!.x - v.x;
      if (Math.abs(v.z - z0) < 1e-6) {
        assert.ok(Math.abs(step) < 1e-6, `the slice at the lid's rear end steps ${(step * 1000).toFixed(2)} mm`);
        rearEnd++;
      } else if (v.z > z0 + SHUT_RAMP && v.z < z1 - SHUT_RAMP) {
        assert.ok(step >= SHUT_GROOVE, `z ${v.z.toFixed(3)}: the shut line steps ${(step * 1000).toFixed(2)} mm in`);
        grooved++;
      }
    }
    assert.ok(rearEnd === 1 && grooved > 0, `${rearEnd} slices at the lid's rear end, ${grooved} under its shut line`);
  });
});

/** Of each side's greenhouse parts the B pillar and the rail are the near-rectangular ones (the A and C pillars lean in plan, so their section is a sheared parallelogram). */
const roundedPartCases = [
  { name: "B pillar", pick: (parts: THREE.BufferGeometry[]) => parts[1]! },
  { name: "side rail", pick: (parts: THREE.BufferGeometry[]) => parts.find((g) => g.name === "beltRail")! },
] as const;

/** At the cant line the drawn roof's side keeps normals of its own, pointing out at least this much (x share), not down with its underside's. */
const ROOF_SIDE_NORMAL_X = 0.8;

/** The drawn posts the curved section (`postSection`) builds: the A-post, the B-pillar, the C-pillar ("rear") and the divider. */
const POST_NAMES = ["a", "b", "rear", "divider"];
/** A drawn post's section: at least this many points, each chord turning under `POST_TURN_DEGREES` from the one before, and its depth sides' chords under a third of its depth (its corners rounded, not chamfered). */
const POST_MIN_POINTS = 12;
const POST_TURN_DEGREES = 35;
/** At least this many of the A-post's stations show under the roof's side (the rest run up into it). */
const A_POST_STATIONS_SHOWN = 5;
/** The drawn A-post laps the windshield's side edge within this (m) at every station, and in side view its section's centre keeps its offset from that edge within this along the post: it follows the edge, never twisting off it. */
const A_POST_EDGE_FOLLOW = 0.01;

/** Distance (m) from `p` to the line through `a` and `b`. */
function distanceToLine(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const along = b.clone().sub(a).normalize();
  const off = p.clone().sub(a);
  return off.sub(along.multiplyScalar(off.dot(along))).length();
}

describe("given every body style's drawn A-, B-, C- and divider posts", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s posts are read at every station under the roof, then each section has ${POST_MIN_POINTS} points or more and every chord turns under ${POST_TURN_DEGREES}° from the one before`, () => {
      const style = CAR_STYLES[id];
      const posts = makeGreenhouseFrame(style, "drawn").filter((g) => POST_NAMES.includes(g.name));
      assert.ok(posts.filter((g) => g.name === "a").length === 2 && posts.length >= 6, `${id}: ${posts.length} posts`);
      // A station reaching up past the cant line into the roof's side has its points held in under the roof (`insideRoof`).
      const held = (p: THREE.Vector3) => p.z >= style.roofZ[0] && p.z <= style.roofZ[1] && p.y > cantY(p.z, style);
      for (const post of posts) {
        const { ring, slices } = loftOf(post);
        assert.ok(ring >= POST_MIN_POINTS, `${id} ${post.name}: ${ring} section points`);
        let read = 0;
        for (let slice = 0; slice < slices; slice++) {
          const at = (k: number) => positionAt(post, slice * ring + ((k + ring) % ring));
          if (Array.from({ length: ring }, (_, k) => at(k)).some(held)) continue;
          read++;
          for (let k = 0; k < ring; k++) {
            const turn = angleBetweenDegrees(at(k).sub(at(k - 1)).normalize(), at(k + 1).sub(at(k)).normalize());
            assert.ok(turn < POST_TURN_DEGREES, `${id} ${post.name} station ${slice} section point ${k} turns ${turn.toFixed(1)}°`);
          }
        }
        assert.ok(read > 0 && (post.name !== "a" || read >= A_POST_STATIONS_SHOWN), `${id} ${post.name}: ${read} stations read under the roof`);
      }
    });

    it(`when a ${id}'s A-posts are laid along its windshield, then each laps the windshield's side edge within ${A_POST_EDGE_FOLLOW * 100} cm at every station under the roof and in side view its centre's offset from that edge varies under ${A_POST_EDGE_FOLLOW * 100} cm`, () => {
      const { base, wBase, wTop } = CAR_STYLES[id].windshield;
      const [topY, topZ] = CAR_STYLES[id].windshieldTop;
      for (const post of makeGreenhouseFrame(CAR_STYLES[id], "drawn").filter((g) => g.name === "a")) {
        const { ring, slices } = loftOf(post);
        const side = Math.sign(positionAt(post, 0).x);
        const [edgeBase, edgeTop] = [new THREE.Vector3((side * wBase) / 2, base[0], base[1]), new THREE.Vector3((side * wTop) / 2, topY, topZ)];
        const sideView = (p: THREE.Vector3) => p.clone().setX(0);
        const offsets: number[] = [];
        for (let slice = 0; slice < slices - 1; slice++) {
          const section = Array.from({ length: ring }, (_, k) => positionAt(post, slice * ring + k));
          const lap = Math.min(...section.map((p) => distanceToLine(p, edgeBase, edgeTop)));
          assert.ok(lap <= A_POST_EDGE_FOLLOW, `${id} station ${slice}: the post stands ${(lap * 100).toFixed(1)} cm off the windshield's edge`);
          const centre = section.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(ring);
          offsets.push(distanceToLine(sideView(centre), sideView(edgeBase), sideView(edgeTop)));
        }
        const drift = Math.max(...offsets) - Math.min(...offsets);
        assert.ok(drift < A_POST_EDGE_FOLLOW, `${id}: the post's centre runs ${offsets.map((d) => (d * 100).toFixed(1)).join(", ")} cm off the edge`);
      }
    });
  }

  it("when a post's section is read across depths and widths, then the chords along its depth sides are each under a third of its depth", () => {
    for (const thick of [0.03, 0.04, 0.05]) {
      for (const width of [0.04, 0.08, 0.17, 0.5]) {
        const metric = postSection(thick, width).map((p) => ({ depth: p.x * thick, across: p.y * width }));
        for (let k = 0; k < metric.length; k++) {
          const [a, b] = [metric[k]!, metric[(k + 1) % metric.length]!];
          const [depth, across] = [Math.abs(b.depth - a.depth), Math.abs(b.across - a.across)];
          if (depth > across) assert.ok(Math.hypot(depth, across) < thick / 3, `depth ${thick}, width ${width}: chord ${k} along the depth side is ${(Math.hypot(depth, across) * 1000).toFixed(1)} mm`);
        }
      }
    }
  });
});

/** A sail's foot stands at most this far (m) off the body's shoulder point it leaves, its face within `SAIL_LEAN_DEGREES` of the shoulder's tangent there (a flat post's foot stands 7-15 cm inboard, 35-45° off). */
const SAIL_FOOT_OFF = 0.005;
const SAIL_LEAN_DEGREES = 10;
/** Sections read along the haunch, behind the run where the sail's foot sweeps in onto the side window's line: at least this many (its rear end and the sweep's start). */
const SAIL_HAUNCH_SECTIONS = 2;

describe("given every body style whose drawn C-pillar is a sail (`cPillar`)", () => {
  for (const id of CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].cPillar)) {
    it(`when a ${id}'s sail is read along its haunch, then each section's foot sits on the body's shoulder and its face leaves it within ${SAIL_LEAN_DEGREES}° of the shoulder's tangent`, () => {
      const style = CAR_STYLES[id];
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const haunchZ = Math.fround((style.cPillar?.tip?.[1] ?? style.quarter.zRearBot) - SAIL_SWEEP);
      const { ring, slices } = loftOf(sail);
      let read = 0;
      for (let s = 0; s < slices; s++) {
        const [foot, next] = [positionAt(sail, s * ring), positionAt(sail, s * ring + 1)];
        if (foot.z > haunchZ) continue;
        read++;
        const shoulder = shoulderTop(foot.z, style);
        const off = Math.hypot(foot.x - shoulder.x, foot.y - shoulder.y);
        const lean = angleBetweenDegrees(next.sub(foot).normalize(), new THREE.Vector3(shoulder.tangent[0], shoulder.tangent[1], 0));
        assert.ok(off <= SAIL_FOOT_OFF && lean < SAIL_LEAN_DEGREES, `${id} z ${foot.z.toFixed(3)}: foot ${(off * 1000).toFixed(1)} mm off the shoulder, face ${lean.toFixed(1)}° off its tangent`);
      }
      assert.ok(read >= SAIL_HAUNCH_SECTIONS, `${id}: ${read} sections along the haunch`);
    });
  }
});

describe("given every body style's greenhouse frame", () => {
  for (const id of CAR_STYLE_IDS) {
    for (const testCase of roundedPartCases) {
      it(`when a ${id}'s ${testCase.name} is read, then no lengthwise edge turns ${ROLLED_EDGE_LIMIT_DEGREES}° or more (the box's 90° corners are rolled)`, () => {
        const part = testCase.pick(makeGreenhouseFrame(CAR_STYLES[id]));
        const loft = loftOf(part);
        for (let line = 0; line < loft.ring; line++) {
          const angles = ringLineDihedrals(part, line);
          assert.ok(angles.length > 0 && Math.max(...angles) < ROLLED_EDGE_LIMIT_DEGREES, `${id} ${testCase.name} ring line ${line} turns ${Math.max(...angles)}°`);
        }
      });
    }
  }
});

describe("given every body style's drawn roof and greenhouse", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s drawn greenhouse is read, then no part of it crosses the centre line: the roof alone covers both glass tops, no header bar stands on it (the cage keeps its two boxes)`, () => {
      const crossing = (source: "drawn" | "cage") =>
        makeGreenhouseFrame(CAR_STYLES[id], source).filter((g) => {
          g.computeBoundingBox();
          return g.boundingBox!.min.x < 0 && g.boundingBox!.max.x > 0;
        }).length;
      assert.equal(crossing("cage"), 2, "the control: the cage's two header boxes");
      assert.equal(crossing("drawn"), 0, `${id}: drawn parts across the roof`);
    });

    it(`when a ${id}'s drawn roof side is read at mid-roof, then its normals at the cant line point out (x over ${ROOF_SIDE_NORMAL_X}), not down with the underside's: no grey band along the roof's edge`, () => {
      const style = CAR_STYLES[id];
      const roof = makeRoofGeometry(style);
      roof.computeVertexNormals();
      const pos = roof.getAttribute("position") as THREE.BufferAttribute;
      const normal = roof.getAttribute("normal") as THREE.BufferAttribute;
      const z = (style.roofZ[0] + style.roofZ[1]) / 2;
      // The right side's lowest ring point at the mid station (a loft station) is the cant line; a crease copy shares its position.
      let cant = { y: Infinity, nx: -1 };
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getZ(i) - z) > 1e-5 || pos.getX(i) <= 1e-6) continue;
        if (pos.getY(i) < cant.y) cant = { y: pos.getY(i), nx: normal.getX(i) };
        else if (pos.getY(i) === cant.y) cant.nx = Math.max(cant.nx, normal.getX(i));
      }
      assert.ok(cant.nx > ROOF_SIDE_NORMAL_X, `${id}: the roof's side at the cant line (y ${cant.y}) has normal x ${cant.nx} at most`);
    });
  }
});

// ---- (c) after a real crush ------------------------------------------------------------------------------------------------

/** A normal may point this far past square to the local outward direction (dot above the negative of this) and still read as outward after a wrinkled crush. */
const CRUSHED_OUTWARD_DOT_FLOOR = -0.2;
const CRUSH_SPEED_KPH = 64;

/** A `id` car crushed by the 64 km/h wall as the engine steps it, its skin written as drawn. */
function crushedByWall(id: CarStyleId): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.deform.setMode("shape");
  runWall(CRUSH_SPEED_KPH, 1, "front", { car });
  car.flushDeferredSkin();
  car.updateSkin();
  return car;
}

/** No normal (`normals`) of `geometry` on the side or ends points into the hull past `CRUSHED_OUTWARD_DOT_FLOOR`. */
function assertFacesOut(label: string, geometry: THREE.BufferGeometry, normals: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): void {
  for (const point of outerSidePoints(geometry, normals)) {
    assert.ok(point.normal.dot(point.outward) > CRUSHED_OUTWARD_DOT_FLOOR, `${label} vertex ${point.vertex}: crushed normal ${point.normal.dot(point.outward)} against outward`);
  }
}

describe("given every body style crushed by a 64 km/h full-width wall hit, as the engine steps it", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s body normals are read after the skin is written, then every normal is finite and unit length and none on the side or ends points into the hull`, () => {
      const geometry = crushedByWall(id).body.geometry;
      const normals = geometry.getAttribute("normal");
      for (let vertex = 0; vertex < normals.count; vertex++) {
        const length = Math.hypot(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex));
        assert.ok(Number.isFinite(length) && Math.abs(length - 1) < 1e-4, `${id} vertex ${vertex}: crushed normal length ${length}`);
      }
      assertFacesOut(id, geometry, normals);
    });
  }
  // A class whose tyres ride free of the body (the monster's) runs no tyre hold: its drawn skin, read above, is the sim's.
  for (const id of CAR_STYLE_IDS.filter((style) => tyresUnderSkin(STYLE_CLASS[style]))) {
    it(`when a ${id}'s skin is read as the sim writes it, before the drawn tyre hold (the skin the wire carries and the cage is cut from), then none of its normals on the side or ends points into the hull`, () => {
      const car = crushedByWall(id);
      const written = car["bodyTyres"]?.["written"];
      assert.ok(written, `${id}: no tyre hold ran`);
      const geometry = car.body.geometry.clone();
      geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(written), 3));
      geometry.computeVertexNormals();
      assertFacesOut(`${id} sim skin`, geometry, geometry.getAttribute("normal"));
    });
  }
});

// ---- (d) draw calls and cost -----------------------------------------------------------------------------------------------

/**
 * Measured by building every style's car: the visible meshes a car draws, the triangles they hold, and the body mesh's vertices (what the
 * skin writes each frame, so what its cost follows). `drawCalls` counts the car's own meshes: its seven static parts are seats `PartBatch`
 * draws, one instanced draw per kind for every car.
 */
const BASELINE_BY_STYLE = [
  { id: "sedan", drawCalls: 13, triangles: 5266, bodyVertices: 1587 },
  { id: "hatchback", drawCalls: 13, triangles: 5064, bodyVertices: 1587 },
  { id: "wagon", drawCalls: 13, triangles: 5088, bodyVertices: 1635 },
  { id: "coupe", drawCalls: 13, triangles: 5152, bodyVertices: 1530 },
  { id: "pickup", drawCalls: 13, triangles: 5026, bodyVertices: 1568 },
  { id: "police", drawCalls: 14, triangles: 5338, bodyVertices: 1587 },
  { id: "monster", drawCalls: 13, triangles: 5026, bodyVertices: 1568 },
] as const satisfies readonly { id: CarStyleId; drawCalls: number; triangles: number; bodyVertices: number }[];
/** The stated budget: a car's triangles at most 1.6 x the baseline. */
const TRIANGLE_BUDGET = 1.6;
/** The skin writes every body vertex each frame (its cost follows the count): the body's loft at most 1.2 x the baseline's vertices, which measured 1.2 x the baseline's skin time at most. */
const BODY_VERTEX_BUDGET = 1.2;
/** Each roof fitting kind's vertices as built (`makeRoofFittings`), merged into the body on top of its loft: red if a fitting grows. */
const ROOF_FITTING_VERTICES = { rails: 220, glassPanel: 154, spoiler: 26 } as const;
type RoofKind = keyof typeof ROOF_FITTING_VERTICES;

/** `style`'s roof fittings' vertices, all together and per kind (each built alone). */
function roofFittingVertices(style: BodyStyle): { all: number; byKind: [RoofKind, number][] } {
  const count = (s: BodyStyle) => makeRoofFittings(s)?.geometry.getAttribute("position").count ?? 0;
  const kinds = Object.keys(style.roof ?? {}) as RoofKind[];
  return { all: count(style), byKind: kinds.map((kind) => [kind, count({ ...style, roof: { [kind]: style.roof![kind] } })]) };
}

function assertRoofFittingCaps(id: string, byKind: [RoofKind, number][]): void {
  for (const [kind, n] of byKind) assert.ok(n <= ROOF_FITTING_VERTICES[kind], `${id} ${kind}: ${n} vertices against ${ROOF_FITTING_VERTICES[kind]}`);
}

/**
 * Each style's drawn wheel-well parts (lips, humps, liner sides), its boot cut's loft rings, its nose's own rings (`noseRefined`, the
 * roll's third chord), its tub walls' own top vertices and its curved posts' section points past the chamfered box's as built, merged
 * into the body on top of its loft: red if one grows.
 */
const WELL_AND_CUT_VERTICES: Record<CarStyleId, { lips: number; humps: number; liners: number; bootRings: number; noseRings: number; wallTops: number; curvedPosts: number }> = {
  // The sedan's, police's and coupe's C-pillar is a sail (`cPillar`): 6 or 7 sections of 19 points a side, not a post's 2 of 11.
  sedan: { lips: 360, humps: 0, liners: 120, bootRings: 63, noseRings: 147, wallTops: 50, curvedPosts: 416 },
  hatchback: { lips: 360, humps: 94, liners: 120, bootRings: 42, noseRings: 105, wallTops: 18, curvedPosts: 296 },
  wagon: { lips: 360, humps: 94, liners: 120, bootRings: 42, noseRings: 147, wallTops: 30, curvedPosts: 296 },
  coupe: { lips: 360, humps: 94, liners: 120, bootRings: 42, noseRings: 105, wallTops: 46, curvedPosts: 454 },
  pickup: { lips: 260, humps: 94, liners: 120, bootRings: 42, noseRings: 63, wallTops: 16, curvedPosts: 264 },
  police: { lips: 360, humps: 0, liners: 120, bootRings: 63, noseRings: 147, wallTops: 50, curvedPosts: 416 },
  monster: { lips: 312, humps: 94, liners: 214, bootRings: 42, noseRings: 42, wallTops: 26, curvedPosts: 264 },
};
/** The chamfered box section (eight corner points, three crown points) the drawn posts had before they curved, and their stations then (the A-post's, every other post's). */
const CHAMFERED_POST_RING = 11;
const CHAMFERED_A_POST_STATIONS = 3;
const CHAMFERED_POST_STATIONS = 2;

/**
 * `style`'s arch lips' and wheel humps' vertices (`archLipGeometry`, `wellHumpGeometry`), its drawn liners' over the cage's one-sided
 * liners (`makeWellLiners`: their insides and end caps), the rings its boot cut and its nose add to the loft, its walls' top copies, and
 * its posts' vertices past the chamfered posts' (`CHAMFERED_POST_RING` a station on `CHAMFERED_A_POST_STATIONS` or `CHAMFERED_POST_STATIONS`).
 */
function wellAndCutVertices(style: BodyStyle): { lips: number; humps: number; liners: number; bootRings: number; noseRings: number; wallTops: number; curvedPosts: number } {
  const body = makeChassisGeometry(style);
  const rings = (bootOpen: boolean, noseFill: boolean) => sliceZs(style, "drawn", bootOpen, noseFill).length;
  const liners = (source: "drawn" | "cage") => makeWellLiners(style, source, body).reduce((n, g) => n + g.getAttribute("position").count, 0);
  const posts = makeGreenhouseFrame(style, "drawn").filter((g) => POST_NAMES.includes(g.name));
  return {
    lips: archLipGeometry(style, body)?.getAttribute("position").count ?? 0,
    humps: wellHumpGeometry(style, "drawn")?.getAttribute("position").count ?? 0,
    liners: liners("drawn") - liners("cage"),
    bootRings: (rings(true, true) - rings(false, true)) * loftOf(body).ring,
    noseRings: (rings(true, true) - rings(true, false)) * loftOf(body).ring,
    wallTops: body.userData.wallTops as number,
    curvedPosts: posts.reduce((n, g) => n + loftOf(g).ring * loftOf(g).slices - CHAMFERED_POST_RING * (g.name === "a" ? CHAMFERED_A_POST_STATIONS : CHAMFERED_POST_STATIONS), 0),
  };
}

describe("given every body style's car built whole", () => {
  for (const testCase of BASELINE_BY_STYLE) {
    it(`when a ${testCase.id} is built, then it draws ${testCase.drawCalls} meshes, under ${TRIANGLE_BUDGET} x its ${testCase.triangles} triangles, with a body loft under ${BODY_VERTEX_BUDGET} x its ${testCase.bodyVertices} vertices and each roof fitting, arch lip, wheel hump, liner side, boot cut, nose ring, wall top and curved post within its own count`, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, testCase.id);
      let drawCalls = 0;
      let triangles = 0;
      car.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) if (ancestor.name === "deform-rig" || !ancestor.visible) return;
        drawCalls++;
        triangles += triangleCountOf(object.geometry);
      });
      assert.equal(drawCalls, testCase.drawCalls);
      assert.ok(triangles <= testCase.triangles * TRIANGLE_BUDGET, `${triangles} triangles against ${testCase.triangles * TRIANGLE_BUDGET}`);
      const fittings = roofFittingVertices(car.style);
      const wells = wellAndCutVertices(car.style);
      const loft = car.body.geometry.getAttribute("position").count - fittings.all - wells.lips - wells.humps - wells.liners - wells.bootRings - wells.noseRings - wells.wallTops - wells.curvedPosts;
      assert.ok(loft <= testCase.bodyVertices * BODY_VERTEX_BUDGET, `${loft} body loft vertices against ${testCase.bodyVertices * BODY_VERTEX_BUDGET}`);
      assertRoofFittingCaps(testCase.id, fittings.byKind);
      const cap = WELL_AND_CUT_VERTICES[testCase.id];
      const within = (Object.keys(cap) as (keyof typeof cap)[]).every((part) => wells[part] <= cap[part]);
      assert.ok(within, `${testCase.id} ${JSON.stringify(wells)} against ${JSON.stringify(cap)}`);
    });
  }

  it("when a body carries every roof fitting, then each adds at most its own count of vertices to the body", () => {
    const wagon = CAR_STYLES.wagon;
    const roof = { rails: { x: [0.5, 0.56], z: [-1.6, 0.12], rise: 0.045 }, glassPanel: { z: [-0.75, 0.05], width: 0.8 }, spoiler: { z: [-1.85, -1.7], y: [1.52, 1.6], halfWidth: 0.6 } } as const;
    const fittings = roofFittingVertices({ ...wagon, roof });
    assert.equal(fittings.byKind.length, 3, "the control: every kind is built");
    assertRoofFittingCaps("wagon", fittings.byKind);
    // Against the wagon with no fittings at all: the style itself may carry some.
    assert.equal(makeChassisGeometry({ ...wagon, roof }).getAttribute("position").count - fittings.all, makeChassisGeometry({ ...wagon, roof: undefined }).getAttribute("position").count, "the fittings are all the body gains");
  });
});

// ---- (e) the panels still cut ----------------------------------------------------------------------------------------------

describe("given every body style's panels cut from its smoothed loft", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s panels are cut, then all ${PANEL_NAMES.length} exist, none shares a triangle with another, and every triangle indexes the loft or, on an arch, that arch's own lip`, () => {
      const body = makeChassisGeometry(CAR_STYLES[id]);
      const loft = loftOf(body);
      const regions = panelRegions(CAR_STYLES[id], body);
      assert.equal(regions.length, PANEL_NAMES.length);
      // Each arch lip's triangles (`archLipGeometry`), keyed as the regions key theirs.
      const lips = body.userData.archLips as { from: number; perWheel: readonly number[] } | undefined;
      const lipOf = new Map<string, string>();
      for (let k = 0, at = lips?.from ?? 0; lips && k < lips.perWheel.length; at += lips.perWheel[k]!, k++) {
        for (let t = at; t < at + lips.perWheel[k]!; t += 3) lipOf.set([0, 1, 2].map((v) => body.index!.getX(t + v)).join(","), PANEL_NAMES[2 + k]!);
      }
      const seen = new Set<string>();
      for (const region of regions) {
        assert.ok(region.verts.length > 20 && region.tris.count >= 30 * 3, `${id} ${region.name} has ${region.tris.count / 3} triangles`);
        for (let t = 0; t < region.tris.count; t += 3) {
          const key = [0, 1, 2].map((k) => region.tris.getX(t + k)).join(",");
          assert.ok(!seen.has(key), `${id}: triangle ${key} is in two panels (${region.name})`);
          assert.ok(region.tris.getX(t) < loft.ring * loft.slices || lipOf.get(key) === region.name, `${id} ${region.name}: a triangle outside the loft and its own lip`);
          seen.add(key);
        }
      }
    });
  }
});

// ---- the sim is untouched --------------------------------------------------------------------------------------------------

/**
 * The scripted crash: a car of each body style driven into the jersey slab at this speed (`runWall`, the engine's own step and phase clock), and
 * the sha-256 of everything the sim holds of it afterwards (`snapshot()`: the masses, beams, sensors and clusters, plus every mass's
 * rest, local and world position and velocity). The expected values were produced on f3bd2074, before any smoothing, by hashing
 * `JSON.stringify({ snap: car.deform.snapshot(), raw: masses.map((m) => [m.rest, m.local, m.world, m.vel].map((v) => v.toArray())) })`.
 */
const SIM_CRASH_KPH = 48;
// Re-pinned for the skin reading a kept set once (its fit rest takes the set): the first difference is bumperFL's velocity at 0.0217 s, in the hit,
// where the cage the contact reads first differs.
// CarRig's single re-pin (union 1d751bfc with the tread as wide as drawn): sedan, coupe, pickup, police and monster moved with the car overhaul's
// sim (each style's own frame and rig, its own cages and lids, the lifted centre, the tyre side rows and footprint), red on the union since
// e4f74c6e; hatch and SUV were re-pinned by their lane and are unchanged here.
const SIM_DIGEST_BY_STYLE = [
  { id: "sedan", digest: "3b05ae33d289fbd2da191012091e617aeea30ad0c0072e4fdc3b07545ffd45b3" },
  // Re-pinned when every style's roof, glass, hood and boot cages came from its own panels (`carFrame`) instead of a hand fit; the sedan's are the fit itself.
  // Hatch and SUV re-pinned for their reference shapes: door shut lines, cowl belt, the SUV's clamshell hood and blunt nose, bumpers wrapped to their seams.
  { id: "hatchback", digest: "674fca85d7893ab736a28bcff660adad5f319d6471bcd301a6bfa60bc8f7983e" },
  { id: "wagon", digest: "728e19f0a34f06b705de92b836b11640013dff0bc01857f6bd173b0308be8b37" },
  { id: "coupe", digest: "caa1fdf8cd6c154cc71882a4e87b5a98cc33ac904a46b3eb3611523ed07c3c14" },
  { id: "pickup", digest: "8ac3348022ccf861dcc32220681d991fadaba4b58f4cd87233f0374f7bfb5731" },
  // The police's moved at REPLAY 116 (12fb33c4... before): its light bar folds about a base hinge across the car, so the bar's cage pose, which is part of the car's
  // contact shape, differs in the hit and the masses differ by the bar's contact. Probe: with the fold set to 0 the digest is another (899b2770...), so it is the bar's
  // pose that moves it; the five bar-less styles above are unchanged to the bit.
  { id: "police", digest: "70734ab60eccfca209ff0e6e163c5a8f1c7e8c0ef501bf8ca8104e6b98ddb5e6" },
  // The monster is its own body style (its own dims, cage and lifted class body), no longer the pickup's.
  { id: "monster", digest: "7a1610ef755890bc133f287a9c31f175de8e9d6d7ee310aba95af8fa653a4297" },
] as const satisfies readonly { id: CarStyleId; digest: string }[];

describe("given every body style crashed into the wall at 48 km/h by the engine's own step", () => {
  for (const testCase of SIM_DIGEST_BY_STYLE) {
    it(`when a ${testCase.id}'s masses, beams, sensors and clusters are hashed, then they equal the digest the unsmoothed build produced`, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, testCase.id);
      car.deform.setMode("shape");
      runWall(SIM_CRASH_KPH, 1, "front", { car });
      const snap = car.deform.snapshot();
      const raw = car.deform.masses.map((mass) => [mass.rest.toArray(), mass.local.toArray(), mass.world.toArray(), mass.vel.toArray()]);
      const digest = createHash("sha256").update(JSON.stringify({ snap, raw })).digest("hex");
      assertSameDigest(digest, testCase.digest, `${testCase.id} after a ${SIM_CRASH_KPH} km/h wall hit`);
    });
  }
});

/**
 * Every rest-only table `cageSourceOf` hands the cage (the cage mesh is decimated from them, so they fix the contact shape of every
 * hit, not only the scripted one), hashed as raw bytes in field order. Re-pinned for the sill following the cell's clusters: only the
 * sill vertices' cluster tables (skinN, skinXf, skinW) changed. Re-pinned for the sill samples a wreck rests on (`sill`, the last table).
 * Re-pinned for the driver's side (`DRIVER_SIDE`, the steering wheel moved to +x): only `interiorRest` changed.
 */
function cageSourceDigest(car: DeformableCar): string {
  const source = cageSourceOf(car);
  const fields = [
    source.rest, Uint32Array.from(source.index), source.group, source.skinN, source.skinXf, source.skinW, source.resJ, source.resW, source.resC,
    source.skinHub, source.infN, source.infCo, source.infUvw, source.massRest, source.restCo, source.panelOrigin, source.panelGlass,
    source.interiorRest, Uint32Array.from(source.interiorIndex), source.interiorMass, Uint32Array.of(source.panelCount, source.clusterCount), source.sill,
  ];
  const hash = createHash("sha256");
  for (const field of fields) hash.update(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
  return hash.digest("hex");
}

// CarRig's single re-pin: sedan, coupe, pickup, police and monster's cage sources moved with each style's own panels, lids and hood, the wheel
// tubs and the interior (union 1d751bfc); the monster's is no longer the pickup's.
const CAGE_SOURCE_DIGEST_BY_STYLE = [
  { id: "sedan", digest: "b9e9e98ba9068979547f19b5638d909c0f93359b8550574b8abe840d3388eebe" },
  // Re-pinned with the cabin cages derived from each style's panels (`carFrame`): the cage-skinned tables over them moved.
  // Hatch, SUV, truck and monster re-pinned with the boot hinged at its own pivot (`bootPivot`): its panel origin and its lid's rest local to it moved; the car-frame cage at rest did not.
  // Hatch and SUV re-pinned for their reference shapes: door shut lines, cowl belt, the SUV's clamshell hood and blunt nose, bumpers wrapped to their seams, the hatch's C-pillar top.
  { id: "hatchback", digest: "ce63b76a30c823bfbb334938b043b0f30e1fbc3d33255ddeb254d45733b1737b" },
  { id: "wagon", digest: "eb9db693294fddf0470fba46a10bf8c4181d12a8d392ef892fc4beb6c843f908" },
  { id: "coupe", digest: "fae75944c9d7c46dfa25624af496ca874cff628595859acd29f6d585ae2456b7" },
  // Pickup and monster re-pinned for their thin bed rim (`tubWall` .04): the bed walls' top edge stands 2 cm further out in both builds.
  { id: "pickup", digest: "5e914ede89c07ac21bec7b8997641fe25db9f1eb75035ee912c4a0dd48b928cf" },
  { id: "police", digest: "2466b2789b5094d276c66155028c6d3cb0187b4a55ec4027966a326b4302b08f" },
  { id: "monster", digest: "ea8b2e2587a915177f279a2edfac3611fdd253740d9418000e6d99144f32c7fe" },
] as const satisfies readonly { id: CarStyleId; digest: string }[];

describe("given every body style's cage source, the tables its collision cage is decimated from", () => {
  for (const testCase of CAGE_SOURCE_DIGEST_BY_STYLE) {
    it(`when a ${testCase.id}'s cage source is hashed, then it equals the digest of the unsmoothed build, so the smoothed mesh never moves a contact shape`, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, testCase.id);
      assertSameDigest(cageSourceDigest(car), testCase.digest, `${testCase.id} cage source`);
    });
  }
});

/** A drawn ring point may stand this far (m) outside the cage source's ring at the same station: rounding in the chord interpolation. The cage carries the ground, so a car resting on its flank sinks into it by whatever the drawn side stands proud. */
const HULL_SKIN_M = 0.001;
/** Spacing (m) of the stations the rings are compared at: finer than the slice spacing (7 to 13 cm), so a bump between two slices shows. */
const HULL_STATION_STEP_M = 0.02;

/** How far (m) `point` stands outside the closed polygon `ring`: 0 inside, else its distance to the nearest edge. */
function distanceOutsideRing(point: { x: number; y: number }, ring: readonly { x: number; y: number }[]): number {
  let inside = false;
  let nearest = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a.y > point.y !== b.y > point.y && point.x < a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
    const edge = new THREE.Vector2(b.x - a.x, b.y - a.y);
    const along = THREE.MathUtils.clamp(new THREE.Vector2(point.x - a.x, point.y - a.y).dot(edge) / (edge.lengthSq() || 1), 0, 1);
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - edge.x * along, point.y - a.y - edge.y * along));
  }
  return inside ? 0 : nearest;
}

describe("given every body style's drawn rings beside the cage source's rings at the same stations", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s drawn cross-sections are compared with the cage source's every ${HULL_STATION_STEP_M * 100} cm, then no drawn point stands outside the cage ring by more than the skin`, () => {
      const style = CAR_STYLES[id];
      const first = style.profile[0]!.z;
      const last = style.profile[style.profile.length - 1]!.z;
      let worstOutside = 0;
      let worstAt = first;
      for (let z = first + HULL_STATION_STEP_M; z < last; z += HULL_STATION_STEP_M) {
        const station = sampleSlice(z, style.profile);
        const cageRing = sectionPoints(station, style, "cage");
        for (const point of sectionPoints(station, style, "drawn")) {
          const outside = distanceOutsideRing(point, cageRing);
          if (outside > worstOutside) {
            worstOutside = outside;
            worstAt = z;
          }
        }
      }
      assert.ok(worstOutside <= HULL_SKIN_M, `${id}: a drawn ring point at z ${worstAt.toFixed(2)} stands ${(worstOutside * 100).toFixed(1)} cm outside the cage source's ring`);
    });
  }
});
