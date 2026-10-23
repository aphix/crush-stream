import * as THREE from "three";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { CAR_STYLES, CAR_STYLE_IDS, drawnStyle, type BodyStyle, type CarStyleId, type DrawnTwin } from "./car-variants.ts";
import { makeRoofFittings } from "./car-fittings-mesh.ts";
import { CREASE_DEGREES, SHUT_RAMP, bayAt, cantX, cantY, glassTopY, makeBumperGeometry, makeHoodGeometry, makeTrunkGeometry, roofArc, roofTopY, sampleSlice, sectionPoints, shoulderTop } from "./car-mesh.ts";
import { beltX, beltY } from "./car-lines.ts";
import { makeChassisGeometry, sliceZs } from "./car-chassis-mesh.ts";
import { PRIMER_ATTRIBUTE } from "./constants.ts";
import { archLipGeometry, makeWellLiners, wellHumpGeometry } from "./car-well-mesh.ts";
import { makeDoorGeometry } from "./car-door-mesh.ts";
import { SAIL_SWEEP, makeGreenhouseFrame, makeRoofGeometry, postSection } from "./car-greenhouse-mesh.ts";
import { drawnQuarter, makeWindshield, rearGlassCornerZ, rearGlassInset, windshieldBaseY } from "./car-glass.ts";
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
 * A rolled edge's chord (`userData.rolled`: both its vertices flagged) shades round at any angle: the lid rows read it.
 */
function censusOfEdges(geometry: THREE.BufferGeometry, creaseDegrees: number, capsAreCuts: boolean): EdgeCensus {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  const placeOf = (vertex: number) => `${position.getX(vertex)},${position.getY(vertex)},${position.getZ(vertex)}`;
  const faces = new Map<string, { normal: THREE.Vector3; vertices: string; cut: boolean }[]>();
  const loft = geometry.userData.loft as { ring: number; slices: number } | undefined;
  const rolled = geometry.userData.rolled as Uint8Array | undefined;
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
    const [a, b] = first.vertices.split(",").map(Number) as [number, number];
    if (first.vertices === second.vertices && rolled?.[a] === 1 && rolled[b] === 1) continue;
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
/** The platform's front door cut runs from z 0 to 0.54 (`doorAperture`): the side there drops to the sill and faces up, so no outward test at rest reads it. */
const DOOR_CUT_Z = [-0.05, 0.6] as const;
/** A slice standing on a door cut's end (to float32) is the full side, read like any other. */
const DOOR_CUT_END = 1e-4;

/** The slice's ring points on the body's side (both halves) whose `rest` z lies outside the door cut `doorCut`, with the vertex's ring-centroid estimate of "outward". */
function outerSidePoints(geometry: THREE.BufferGeometry, normals: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, doorCut: readonly [number, number], rest: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): { vertex: number; normal: THREE.Vector3; outward: THREE.Vector3 }[] {
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
      if (!isEnd && rest.getZ(vertex) > doorCut[0] + DOOR_CUT_END && rest.getZ(vertex) < doorCut[1] - DOOR_CUT_END) continue;
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
      for (const point of outerSidePoints(chassis, chassis.getAttribute("normal"), DOOR_CUT_Z, chassis.getAttribute("position"))) {
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
  // The sedan's hood is crowned (`hood.crown`): its ring carries 3 dome points a side and its skirt's straight wall no upper point (15 points), so the shut line and lip corners sit at 0, 8, 9 to 14.
  { it: "a bonnet's shut line and lip corners (ring points 0, 8, 9 to 14)", style: "sedan", part: "bonnet", rolledLid: false, creaseLines: [0, 8, 9, 10, 11, 12, 13, 14], smoothLines: [1, 2, 3, 4, 5, 6, 7], rollLines: [], creaseDegrees: CREASE_DEGREES.deckLid },
  // The sedan's boot rolls its side edges (`boot.edgeRoll`): its ring lines are read off its ring (`rolledLidLines`).
  { it: "a sedan boot lid's rolled edges, dome and skirt corners", style: "sedan", part: "boot", rolledLid: true, creaseLines: [], smoothLines: [], rollLines: [], creaseDegrees: CREASE_DEGREES.deckLid },
  { it: "a hatchback's tailgate edges (ring points 0, 4, 5, 6)", style: "hatchback", part: "boot", rolledLid: false, creaseLines: [0, 4, 5, 6], smoothLines: [1, 2, 3], rollLines: [], creaseDegrees: CREASE_DEGREES.tailgate },
  // The wagon's gate rolls its side edges (`boot.edgeRoll`, one chord a side at 0-1 and 5-6): its back corners at 7 and 8.
  { it: "a wagon's tailgate back corners (ring points 7, 8)", style: "wagon", part: "boot", rolledLid: false, creaseLines: [7, 8], smoothLines: [2, 3, 4], rollLines: [0, 1, 5, 6], creaseDegrees: CREASE_DEGREES.tailgate },
] as const;

/** A rolled edge's chords split its corner's turn (~90°, up to ~100° at a tapering lid's lip): each turns at most this (°), shading round on shared vertices. */
const ROLL_TURN_MAX_DEGREES = 50;

/**
 * A rolled deck lid's ring (`boot.edgeRoll`, `n` points) runs side, roll middle, roll start, dome, centre, dome, roll start, roll middle,
 * side, then its skirt and underside's six corners: its roll lines, its top's lines between them, and its six creases.
 */
function rolledLidLines(n: number): { rollLines: number[]; smoothLines: number[]; creaseLines: number[] } {
  return {
    rollLines: [0, 1, 2, n - 9, n - 8, n - 7],
    smoothLines: Array.from({ length: n - 12 }, (_, k) => k + 3),
    creaseLines: Array.from({ length: 6 }, (_, k) => n - 6 + k),
  };
}

/** A lid ring's top edge at `slice` (its side at |x| w): the corner point, or for a rolled ring the top's line carried out past its roll to the side. */
function lidEdgeAt(lid: THREE.BufferGeometry, slice: number, rolled: boolean): THREE.Vector3 {
  const { ring } = loftOf(lid);
  const side = positionAt(lid, slice * ring);
  if (!rolled) return side;
  const [start, dome] = [positionAt(lid, slice * ring + 2), positionAt(lid, slice * ring + 3)];
  return new THREE.Vector3(side.x, start.y + ((side.x - start.x) * (start.y - dome.y)) / (start.x - dome.x), side.z);
}

/** The sedan with the reference's hood crown: its top 6 cm under the centre line at |x| .66, its edge at the plain inset (`hood.inset` steepens the dome). */
const CROWNED_SEDAN: BodyStyle = { ...CAR_STYLES.sedan, hood: { ...CAR_STYLES.sedan.hood, crown: [0.06, 0.66], inset: undefined, followGlass: undefined } };

describe("given the lids as built", () => {
  for (const testCase of lidCreaseTable) {
    it(`when ${testCase.it} are read, then each turns its declared ${testCase.creaseDegrees}° or more at vertices of its own, a rolled edge's chord turns under ${ROLL_TURN_MAX_DEGREES}° on shared vertices, and the dome or bow turns under ${FLAT_CURVE_LIMIT_DEGREES}° as one vertex`, () => {
      const style = CAR_STYLES[testCase.style];
      const lid = testCase.part === "bonnet" ? makeHoodGeometry(style) : makeTrunkGeometry(style);
      const loft = loftOf(lid);
      const { creaseLines, smoothLines, rollLines } = testCase.rolledLid ? rolledLidLines(loft.ring) : testCase;
      const inner = (slice: number) => slice > 0 && slice < loft.slices - 2;
      for (const line of creaseLines) {
        const angles = ringLineDihedrals(lid, line, inner);
        assert.ok(Math.min(...angles) >= testCase.creaseDegrees, `ring line ${line} turns only ${Math.min(...angles)}°`);
        for (let slice = 1; slice < loft.slices - 1; slice++) {
          assert.ok(verticesAtSamePlace(lid, slice * loft.ring + line) >= 2, `ring line ${line} slice ${slice} is one vertex: its crease is not split`);
        }
      }
      // A lid that wraps the tail ends its deck on the lip's crest (its last deck ring): the kick turns 51-54° down into the fold there,
      // the ducktail's hard edge across the dome, so that slice is split and every other is one vertex.
      const crest = testCase.rolledLid ? (lid.userData.deckRings as number) - 1 : -1;
      for (const line of smoothLines) {
        const angles = ringLineDihedrals(lid, line, inner);
        assert.ok(Math.max(...angles) < FLAT_CURVE_LIMIT_DEGREES, `ring line ${line} turns ${Math.max(...angles)}°`);
        for (let slice = 1; slice < loft.slices - 1; slice++) {
          const want = slice === crest ? 2 : 1;
          assert.equal(verticesAtSamePlace(lid, slice * loft.ring + line), want, `ring line ${line} slice ${slice}: ${want === 2 ? "the lip's crest is not a hard edge" : "split, its curve is not smooth"}`);
        }
      }
      for (const line of rollLines) {
        const angles = ringLineDihedrals(lid, line, inner);
        assert.ok(Math.max(...angles) < ROLL_TURN_MAX_DEGREES && Math.min(...angles) >= FLAT_CURVE_LIMIT_DEGREES, `rolled ring line ${line} turns ${Math.min(...angles).toFixed(1)}-${Math.max(...angles).toFixed(1)}°`);
        for (let slice = 1; slice < loft.slices - 1; slice++) {
          assert.equal(verticesAtSamePlace(lid, slice * loft.ring + line), 1, `rolled ring line ${line} slice ${slice} is split: the roll does not shade round`);
        }
      }
    });
  }

  it(`when a crowned hood (the sedan's: 6 cm under the centre at |x| .66) is read, then its centre stands that parabola's drop over its edge at every station and its dome, edge to edge, turns under ${FLAT_CURVE_LIMIT_DEGREES}° at each of its own vertices`, () => {
    const [drop, at] = CROWNED_SEDAN.hood.crown!;
    const lid = makeHoodGeometry(CROWNED_SEDAN);
    const loft = loftOf(lid);
    // The top runs edge, dome points, centre, dome points, edge (`userData.lidEdge`); the skirt and underside follow.
    const rim = lid.userData.lidEdge as number;
    for (let slice = 0; slice < loft.slices; slice++) {
      const edge = positionAt(lid, slice * loft.ring);
      const rise = positionAt(lid, slice * loft.ring + rim / 2).y - edge.y;
      const want = drop * (edge.x / at) ** 2;
      assert.ok(Math.abs(rise - want) < 1e-4, `slice ${slice}: the centre stands ${(rise * 100).toFixed(2)} cm over the edge at |x| ${(-edge.x).toFixed(3)}, want ${(want * 100).toFixed(2)}`);
    }
    // The sedan's own hood, its edge inset, keeps the dome as smooth.
    for (const style of [CROWNED_SEDAN, CAR_STYLES.sedan]) {
      const hood = makeHoodGeometry(style);
      const hoodLoft = loftOf(hood);
      const inner = (slice: number) => slice > 0 && slice < hoodLoft.slices - 2;
      for (let line = 1; line < rim; line++) {
        const turn = Math.max(...ringLineDihedrals(hood, line, inner));
        assert.ok(turn < FLAT_CURVE_LIMIT_DEGREES, `${style.hood.inset ? "inset" : "plain"} dome ring line ${line} of ${rim - 1} turns ${turn.toFixed(2)}°`);
      }
    }
  });

  it("when a hood that wraps the nose (hood.nose: the pickup's, 6.5 cm down on a 2 cm bend) is read, then its fold's last ring stands that drop under the deck's edge on the nose's face plane, every fold ring's edge lies on the bend or the face, and the cage's hood is the plain one", () => {
    /** The pickup's hood run to its nose and folded down onto the grille's top. */
    const [DROP, RADIUS] = [0.065, 0.02];
    const pickup = CAR_STYLES.pickup;
    const style: BodyStyle = { ...pickup, hood: { ...pickup.hood, z1: 1.92, nose: [DROP, RADIUS] } };
    const hood = makeHoodGeometry(style);
    const { ring, slices } = loftOf(hood);
    const deck = hood.userData.deckRings as number;
    const rim = hood.userData.lidEdge as number;
    const [, oz] = style.hood.origin;
    assert.ok(slices > deck, `${slices} rings, ${deck} of them the deck's: no fold`);
    const top = positionAt(hood, (deck - 1) * ring + rim);
    const [yc, zc] = [top.y - RADIUS, top.z];
    for (let slice = deck; slice < slices; slice++) {
      const p = positionAt(hood, slice * ring + rim);
      const off = p.y >= yc ? Math.hypot(p.y - yc, p.z - zc) - RADIUS : p.z - zc - RADIUS;
      assert.ok(Math.abs(off) < 1e-4, `fold ring ${slice - deck}: its edge stands ${(off * 1000).toFixed(2)} mm off the bend or face`);
    }
    const bottom = positionAt(hood, (slices - 1) * ring + rim);
    assert.ok(Math.abs(top.y - bottom.y - DROP) < 1e-4 && Math.abs(bottom.z + oz - style.hood.z1) < 1e-4, `the fold ends ${((top.y - bottom.y) * 100).toFixed(2)} cm under the deck's edge at z ${(bottom.z + oz).toFixed(3)}, want ${DROP * 100} at ${style.hood.z1}`);
    assert.ok(loftOf(makeHoodGeometry(style, "cage")).slices === loftOf(makeHoodGeometry({ ...style, hood: { ...style.hood, nose: undefined } }, "cage")).slices, "the cage's hood folds too");
  });

  it(`when the sedan's crowned deck lid (boot.crown) is read, then past its 25 cm ease-in its centre stands the parabola's drop over its edge at every deck station, its dome turns under ${FLAT_CURVE_LIMIT_DEGREES}° at each of its own vertices, and the cage's lid is the plain one`, () => {
    /** The crown eases in over this far (m) from the lid's front edge; the tail fold's radius (m) ends the deck. */
    const [RUN, FOLD] = [0.25, 0.08];
    const style = CAR_STYLES.sedan;
    const b = style.boot;
    assert.ok(b.kind === "lid" && b.crown !== undefined, "the sedan's boot is a crowned deck lid");
    const [drop, at] = b.crown;
    const lid = makeTrunkGeometry(style);
    const loft = loftOf(lid);
    const pivotZ = (b.pivot ?? b.origin)[1];
    // A rolled lid's top runs side, roll middle, roll start, dome, centre, dome, roll start, roll middle, side over its skirt and underside's last six points.
    const rolled = b.edgeRoll !== undefined;
    const centre = rolled ? (loft.ring - 7) / 2 : (loft.ring - 9) / 2;
    const domeLines = rolled ? rolledLidLines(loft.ring).smoothLines : Array.from({ length: loft.ring - 10 }, (_, k) => k + 1);
    let read = 0;
    for (let slice = 0; slice < loft.slices; slice++) {
      const edge = lidEdgeAt(lid, slice, rolled);
      const z = edge.z + pivotZ;
      if (z > b.z0 - RUN || z < b.z1 + FOLD + 1e-6) continue;
      const rise = positionAt(lid, slice * loft.ring + centre).y - edge.y;
      const want = drop * (edge.x / at) ** 2;
      assert.ok(Math.abs(rise - want) < 1e-4, `z ${z.toFixed(3)}: the centre stands ${(rise * 100).toFixed(2)} cm over the edge at |x| ${(-edge.x).toFixed(3)}, want ${(want * 100).toFixed(2)}`);
      read++;
    }
    assert.ok(read >= 2, `only ${read} deck stations past the ease-in`);
    const inner = (slice: number) => slice > 0 && slice < loft.slices - 2;
    for (const line of domeLines) {
      const turn = Math.max(...ringLineDihedrals(lid, line, inner));
      assert.ok(turn < FLAT_CURVE_LIMIT_DEGREES, `dome ring line ${line} turns ${turn.toFixed(2)}°`);
    }
    const plain: BodyStyle = { ...style, boot: { ...b, crown: undefined } };
    const [cage, plainCage] = [makeTrunkGeometry(style, "cage"), makeTrunkGeometry(plain, "cage")].map((g) => (g.getAttribute("position").array as Float32Array).join(","));
    assert.ok(cage === plainCage, "the cage's lid moved with the crown");
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

/** Styles whose drawn bumper still shades a fold over the bumper crease smooth, with its owner and the reading: the owner's ticket turns them live. */
const BUMPER_FOLDS_OPEN: Partial<Record<CarStyleId, string>> = {
  sedan: "lamps lane: the seam cover's band, met on the skin across the bumper's side corner, welds front 5 folds of 70° and more",
  wagon: "lamps lane: the seam cover's band, met on the skin across the bumper's side corner, welds front 2 folds of 70° and more",
};

describe("given every style's bumpers as its car wears them (the fascia with its fittings and seam cover merged in)", () => {
  for (const id of CAR_STYLE_IDS) {
    const name = `when a ${id}'s drawn bumpers' edges are read against the bumper's ${CREASE_DEGREES.bumper}° crease, then no sharper edge shares its vertices: a fold the merge brought in shades as a crease, not a soft blob`;
    if (BUMPER_FOLDS_OPEN[id] !== undefined) {
      it.todo(`${name} (${BUMPER_FOLDS_OPEN[id]})`);
      continue;
    }
    it(name, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
      for (const end of ["bumperF", "bumperR"] as const) {
        const group: THREE.Object3D = car[end];
        const mesh = group.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh);
        assert.ok(mesh, `${id} ${end}: a drawn mesh`);
        const census = censusOfEdges(mesh.geometry, CREASE_DEGREES.bumper, false);
        assert.equal(census.sharpEdgesStillShared, 0, `${id} ${end}: ${census.sharpEdgesStillShared} of its ${census.sharpEdges} folds over ${CREASE_DEGREES.bumper}° shaded smooth; first: ${census.firstOffence}`);
      }
    });
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
      const rim = hood.userData.lidEdge as number;
      const inset = (v: THREE.Vector3) => sampleSlice(v.z + oz, style.profile).hw - v.x;
      for (let slice = 0; slice < (hood.userData.deckRings as number) - 1; slice++) {
        const [a, b] = [positionAt(hood, slice * hoodLoft.ring + rim), positionAt(hood, (slice + 1) * hoodLoft.ring + rim)];
        if (b.z + oz < noseZ - NOSE_READ) continue;
        const sag = Math.abs(inset(a.clone().add(b).multiplyScalar(0.5)) - inset(a));
        assert.ok(sag <= NOSE_CHORD_SAG, `${id} hood edge between z ${(a.z + oz).toFixed(3)} and ${(b.z + oz).toFixed(3)}: ${(sag * 1000).toFixed(1)} mm off its plan line`);
      }
    });
  }
});

/** A drawn flank's chord over a split range (`ringSplit`) may sag this far (m) off the section at its middle, as the nose's may. */
const FLANK_CHORD_SAG = 0.005;

describe("given every body style whose drawn body splits its loft gaps over a z range (`ringSplit`)", () => {
  for (const id of CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].ringSplit)) {
    it(`when a ${id}'s body chords over that range are read, then every ring point's chord lies within ${FLANK_CHORD_SAG * 1000} mm of the section at its middle`, () => {
      const style = CAR_STYLES[id];
      const [z0, z1] = style.ringSplit!;
      const body = makeChassisGeometry(style);
      const loft = loftOf(body);
      const off: string[] = [];
      let read = 0;
      for (let slice = 0; slice < loft.slices - 1; slice++) {
        const [a, b] = [positionAt(body, slice * loft.ring), positionAt(body, (slice + 1) * loft.ring)];
        const mid = (a.z + b.z) / 2;
        if (mid < z0 || mid > z1) continue;
        read++;
        const section = sectionPoints(sampleSlice(mid, style.profile), style, "drawn");
        for (let point = 0; point < loft.ring; point++) {
          const chord = positionAt(body, slice * loft.ring + point).add(positionAt(body, (slice + 1) * loft.ring + point)).multiplyScalar(0.5);
          const sag = Math.hypot(chord.x - section[point]!.x, chord.y - section[point]!.y);
          if (sag > FLANK_CHORD_SAG) off.push(`ring point ${point} between z ${a.z.toFixed(3)} and ${b.z.toFixed(3)}: ${(sag * 1000).toFixed(1)} mm`);
        }
      }
      assert.ok(read > 0, `${id}: no body gap over z ${z0}-${z1}`);
      assert.ok(off.length === 0, `${id}: ${off.join("; ")}`);
    });
  }
});

describe("given every body style whose drawn loft keeps only its knots' rings inside the front door's cut (`bareDoorCut`)", () => {
  for (const id of CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].bareDoorCut)) {
    it(`when a ${id}'s loft stations are read, then inside the door cut the drawn build drops plain stations and adds none, and the cage keeps every ring`, () => {
      const style = CAR_STYLES[id];
      const plain: BodyStyle = { ...style, bareDoorCut: undefined };
      const [a0, a1] = style.door.aperture;
      const [bare, full] = [style, plain].map((s) => sliceZs(s, "drawn").filter((z) => z > a0 && z < a1).map((z) => z.toFixed(4)));
      assert.ok(bare!.length < full!.length && bare!.every((z) => full!.includes(z)), `${id}: door cut stations ${bare!.join(" ")} against ${full!.join(" ")}`);
      assert.ok(sliceZs(style, "cage").join() === sliceZs(plain, "cage").join(), `${id}: the cage's stations moved`);
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
      for (let slice = 1; slice < (hood.userData.deckRings as number) - 1; slice++) {
        const edge = positionAt(hood, slice * loft.ring + (hood.userData.lidEdge as number));
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

    it(`when a ${id}'s fender deck edge is read beside its hood over the open bay, then it stands its hood.groove out and down (a shut-line slot onto the bay wall, none without one), and the cage's ring is the groove-less style's`, () => {
      const style = CAR_STYLES[id];
      const [out, down] = style.hood.groove ?? [0, 0];
      const plain: BodyStyle = { ...style, hood: { ...style.hood, groove: undefined } };
      let read = 0;
      for (let z = style.hood.z0; z <= style.hood.z1; z += 0.05) {
        const s = sampleSlice(z, style.profile);
        const [grooved, flush] = [sectionPoints(s, style, "drawn"), sectionPoints(s, plain, "drawn")];
        const [p, q] = [grooved[grooved.length - 2]!, flush[flush.length - 2]!];
        const t = bayAt(z, style);
        assert.ok(Math.abs(p.x - q.x - out * t) < 1e-9 && Math.abs(q.y - p.y - down * t) < 1e-9, `${id} z ${z.toFixed(2)}: deck edge moved ${((p.x - q.x) * 1000).toFixed(2)} out, ${((q.y - p.y) * 1000).toFixed(2)} down, want ${out * t * 1000}, ${down * t * 1000}`);
        assert.ok(JSON.stringify(sectionPoints(s, style, "cage")) === JSON.stringify(sectionPoints(s, plain, "cage")), `${id} z ${z.toFixed(2)}: the cage ring moved with the groove`);
        if (t === 1) read++;
      }
      assert.ok(read > 0, `${id}: no station over the open bay`);
    });
  }

  it("when the coupe's hood is laid on its body, then over the open bay a slot at least 3 mm wide parts its edge from the fender's deck edge, the fender under the hood's edge (reference: the hood and fender meet in a groove)", () => {
    /** The slot's least width (m) between the hood's edge and the fender's deck edge where the bay is open. */
    const SLOT = 0.003;
    const style = CAR_STYLES.coupe;
    const hood = makeHoodGeometry(style);
    const loft = loftOf(hood);
    const [oy, oz] = style.hood.origin;
    let read = 0;
    for (let slice = 1; slice < loft.slices - 1; slice++) {
      const edge = positionAt(hood, slice * loft.ring + (hood.userData.lidEdge as number));
      const z = edge.z + oz;
      if (bayAt(z, style) < 1) continue;
      const section = sectionPoints(sampleSlice(z, style.profile), style, "drawn");
      const deckEdge = section[section.length - 2]!;
      assert.ok(deckEdge.x - edge.x >= SLOT && deckEdge.y < edge.y + oy, `coupe z ${z.toFixed(3)}: the fender's deck edge stands ${((deckEdge.x - edge.x) * 1000).toFixed(1)} mm outboard of the hood's edge, ${((edge.y + oy - deckEdge.y) * 1000).toFixed(1)} mm under it`);
      read++;
    }
    assert.ok(read > 0, "coupe: no hood station over the open bay");
  });

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
  { name: "B pillar", pick: (parts: THREE.BufferGeometry[]) => parts.find((g) => g.name === "b")! },
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

/** The sedan's windshield as the reference draws it: its base bowed hard in plan, its side edge convex, the hood's rear edge following it. */
const WRAPPED_SEDAN: BodyStyle = {
  ...CAR_STYLES.sedan,
  windshield: { ...CAR_STYLES.sedan.windshield, base: [0.95, 0.88], bow: { base: 0.165, top: 0.02 }, sideBow: 0.036 },
  hood: { ...CAR_STYLES.sedan.hood, followGlass: 0.04 },
};

/** `WRAPPED_SEDAN` with its hood running 2 cm under the glass's base, as the references draw it, and its pane seated on that hood (`windshield.seat`). */
const TUCKED_SEDAN: BodyStyle = { ...WRAPPED_SEDAN, windshield: { ...WRAPPED_SEDAN.windshield, seat: true }, hood: { ...WRAPPED_SEDAN.hood, followGlass: -0.02 } };

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
  }

  for (const [id, style] of [...CAR_STYLE_IDS.map((id) => [id, drawnStyle(CAR_STYLES[id])] as const), ["wrapped sedan", WRAPPED_SEDAN] as const]) {
    it(`when a ${id}'s A-posts are laid along its windshield, then each laps the windshield's side edge within ${A_POST_EDGE_FOLLOW * 100} cm at every station under the roof and in side view its centre's offset from that edge varies under ${A_POST_EDGE_FOLLOW * 100} cm`, () => {
      const glass = makeWindshield(style).getAttribute("position");
      for (const post of makeGreenhouseFrame(style, "drawn").filter((g) => g.name === "a")) {
        const { ring, slices } = loftOf(post);
        const side = Math.sign(positionAt(post, 0).x);
        // The pane's side edge as drawn, base to top (its 10 × 8 grid): it falls with the roof's dome toward its top.
        const edge = Array.from({ length: 9 }, (_, j) => new THREE.Vector3().fromBufferAttribute(glass, j * 11 + (side > 0 ? 10 : 0)));
        const run = edge[8]!.clone().sub(edge[0]!);
        // The edge's chord beside `p` (its first or last carried on past the pane's base or top).
        const chordAt = (p: THREE.Vector3) => {
          const k = edge.findIndex((e) => e.clone().sub(p).dot(run) >= 0);
          const end = k < 0 ? 8 : Math.max(1, k);
          return [edge[end - 1]!, edge[end]!] as const;
        };
        const sideView = (p: THREE.Vector3) => p.clone().setX(0);
        const offsets: number[] = [];
        for (let slice = 0; slice < slices - 1; slice++) {
          const section = Array.from({ length: ring }, (_, k) => positionAt(post, slice * ring + k));
          const centre = section.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(ring);
          const [edgeBase, edgeTop] = chordAt(centre);
          const lap = Math.min(...section.map((p) => distanceToLine(p, edgeBase, edgeTop)));
          assert.ok(lap <= A_POST_EDGE_FOLLOW, `${id} station ${slice}: the post stands ${(lap * 100).toFixed(1)} cm off the windshield's edge`);
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
/** A flat sail eases into the roof end's roll over this run (m) behind the roof's rear end unless its `cPillar.blend` says otherwise, its face's shape off its chord changing at most this many m per m of length on the way: the haunch-to-roll line a jump of 4.8 cm over 7 cm made. */
const SAIL_ROLL_BLEND_TEST = 0.45;
const SAIL_SHAPE_RATE = 0.25;
/** A flat sail's outer face folds at most this much (°) across any of its sections: the coupe's head jumping back out ahead of its roof end folded 54°, and a sweep station 7 cm behind the roof end, where the head turns in round the glass's corner, 40°: hard lines. */
const SAIL_END_FOLD_DEGREES = 25;
/** Sections read along the haunch, behind the run where the sail's foot sweeps in onto the side window's line: at least this many (its rear end and the sweep's start). */
const SAIL_HAUNCH_SECTIONS = 2;
/** The sail's section at the roof's rear end stands at most this far (m) behind it, so the roof's end outboard of the rear glass never shows past the sail's head. */
const SAIL_ROOF_GAP = 0.003;
/** A roof end skin point the sail's section misses by at most this much (m) still reads as covered: a pixel at the shot's closest range. */
const SAIL_ROOF_COVER = 0.001;
/** A flat sail's outer face (its first `SAIL_OUTER_POINTS` ring points) bows at most this far (m) off its foot-to-head line; the body under it stands at most the sail's foot sink (m) outside that line. */
const SAIL_FLAT_BOW = 0.001;
const SAIL_SINK_TEST = 0.002;
const SAIL_OUTER_POINTS = 6;
/** A sail ahead of its roof end (`cPillar.reachLip`) leaves at most this far (m) of the roof's cant lip past its outer face: the owner's 5 mm. */
const SAIL_LIP_GAP = 0.005;
/** The coupe's sail ahead of its roof end leaves at most this far (m) of the roof's cant lip past its outer face: the fin's share the shape-rate row leaves room for. */
const COUPE_FIN_GAP = 0.012;

/** The coupe on a curved roof section (`roofSection`): the sail rows read it beside every style as built. */
const DOMED_COUPE: BodyStyle = { ...CAR_STYLES.coupe, roofSection: { crown: 0.5, blend: 0.5 } };
/** The coupe with its side window pinched (`cPillar.pinch`): the sail rows read it beside every style as built. */
const PINCHED_COUPE: BodyStyle = { ...CAR_STYLES.coupe, cPillar: { ...CAR_STYLES.coupe.cPillar, pinch: 0.08 } };
/** The control: the coupe unpinched with its quarter glass's sill held at the door's belt (before it rose to the window's point), whose sail cut across the window's point. */
const UNPINCHED_COUPE: BodyStyle = { ...CAR_STYLES.coupe, cPillar: { ...CAR_STYLES.coupe.cPillar, pinch: undefined }, belt: { ...CAR_STYLES.coupe.belt, y: [[-0.981, 0.885], ...CAR_STYLES.coupe.belt.y.slice(1)] } };
const SAIL_STYLES = [
  ...CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].cPillar).map((id) => [id, CAR_STYLES[id]] as const),
  ["domed coupe", DOMED_COUPE] as const,
  ["pinched coupe", PINCHED_COUPE] as const,
];
/** In the side view a pinched window's glass shows from at most this far (m) ahead of its point on, so the point reads sharp. */
const WINDOW_POINT_SHOWS = 0.01;
/** The window's point is read over this run (m) ahead of its tip, in steps of this (m). */
const WINDOW_POINT_RUN = 0.1;
const WINDOW_POINT_STEP = 0.001;
/** At a pinched sail's front ring, where the window's line has rounded into the glass's top line, the sail reaches at most this far (m) under that line: two beads' span, not a post's depth cutting the rounded corner off. */
const PINCH_FRONT_UNDER = 0.035;
/** A rounded window end (`cPillar.dEnd`) is read on the sail's lower edge in the side view: no glass shows this far (m) over the arc, the sail covers it there. */
const D_END_FIT = 0.0015;
/** The arc's stations stand this far (m) apart, from its rearmost point to where it meets the window's line. */
const D_END_STEP = 0.0005;
/** Within this far (m) over the belt the belt rail stands under the sail's foot, so the arc is not read there. */
const D_END_RAIL = 0.006;
/** The row reads at least this many stations, or it would pass without reading a round end. */
const D_END_MIN_READ = 3;
/** The sail's visible lower edge is found by a ray scan down from this far (m) over the arc, in steps of `D_END_EDGE_STEP`, `D_END_EDGE_READS` of them. */
const D_END_REACH = 0.005;
const D_END_EDGE_STEP = 1e-4;
const D_END_EDGE_READS = 150;
/** The window's visible edge keeps one lap under the arc along the whole round, within this far (m): the round's shape, not its height (the bead's lap sets the height). */
const D_END_SHAPE = 0.002;

/** `style`'s +x sail's rings (every vertex of each section), rear to front. */
function sailRings(style: BodyStyle): THREE.Vector3[][] {
  const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
  const { ring, slices } = loftOf(sail);
  return Array.from({ length: slices }, (_, s) => Array.from({ length: ring }, (_, k) => positionAt(sail, s * ring + k)));
}

/** A section's outer points' offsets (m, + outboard) off its foot-to-head chord. */
function chordOffsets(section: THREE.Vector3[]): number[] {
  const [foot, head] = [section[0]!, section[SAIL_OUTER_POINTS - 1]!];
  const run = Math.hypot(head.x - foot.x, head.y - foot.y);
  return section.slice(0, SAIL_OUTER_POINTS).map((p) => ((p.x - foot.x) * (head.y - foot.y) - (p.y - foot.y) * (head.x - foot.x)) / run);
}

/** How far (m) the roof's cant lip at the section's z stands outboard of its outer face where that face crosses the lip's height; NaN if it never does. */
function lipGap(style: BodyStyle, section: THREE.Vector3[]): number {
  const lip = roofArc(section[0]!.z, style)!(1);
  for (let k = 1; k < SAIL_OUTER_POINTS; k++) {
    const [a, b] = [section[k - 1]!, section[k]!];
    if ((a.y - lip.y) * (b.y - lip.y) <= 0) return lip.x - THREE.MathUtils.lerp(a.x, b.x, (lip.y - a.y) / (b.y - a.y));
  }
  return NaN;
}

/**
 * Side view of `style`'s +x window point: how far (m) ahead of the point (where the window's line, tip to the glass's top corner,
 * rises out of the body loft's top at the glass; a rounded end's (`cPillar.dEnd`) rearmost point where that stands ahead of it) its glass shows past the sail for good, read mid-height between that top and the line.
 */
function windowPointCover(style: BodyStyle): number {
  const q = drawnQuarter(style);
  const [tipY, tipZ] = style.cPillar?.tip ?? [beltY(q.zRearBot, style), q.zRearBot];
  const [topY, topZ] = [glassTopY(q.zRearTop, style), q.zRearTop];
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const sail = new THREE.Mesh(makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!, material);
  const chassis = makeChassisGeometry(style);
  const body = new THREE.Mesh(chassis, material);
  const loftVertices = loftOf(chassis).ring * loftOf(chassis).slices;
  const glassX = (z: number, y: number) => THREE.MathUtils.lerp(beltX(z, style), cantX(z, style), (y - beltY(z, style)) / (cantY(z, style) - beltY(z, style)));
  const ray = new THREE.Raycaster();
  let [point, shows] = [NaN, NaN];
  for (let step = 0; step * WINDOW_POINT_STEP <= WINDOW_POINT_RUN; step++) {
    const z = tipZ + step * WINDOW_POINT_STEP;
    const line = tipY + ((topY - tipY) * (z - tipZ)) / (topZ - tipZ);
    ray.set(new THREE.Vector3(glassX(z, line), line + 1, z), new THREE.Vector3(0, -1, 0));
    const sill = ray.intersectObject(body).find((hit) => hit.face!.a < loftVertices)?.point.y ?? beltY(z, style);
    if (line <= sill) continue;
    if (Number.isNaN(point)) point = z;
    const y = (sill + line) / 2;
    ray.set(new THREE.Vector3(glassX(z, y), y, z), new THREE.Vector3(1, 0, 0));
    if (ray.intersectObject(sail).length > 0) shows = NaN;
    else if (Number.isNaN(shows)) shows = z;
  }
  // A rounded end's point is its rearmost, not where the straight line rises out of the sill.
  if (style.cPillar?.dEnd) point = Math.max(point, style.cPillar.dEnd[1]);
  return shows - point;
}

/** Side view of `style`'s +x sail: whether it covers the side glass at car (`z`, `y`), a ray along +x from the glass's plane there hitting it. */
function sailCovers(style: BodyStyle): (z: number, y: number) => boolean {
  const sail = new THREE.Mesh(makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const glassX = (z: number, y: number) => THREE.MathUtils.lerp(beltX(z, style), cantX(z, style), (y - beltY(z, style)) / (cantY(z, style) - beltY(z, style)));
  const ray = new THREE.Raycaster();
  return (z, y) => {
    ray.set(new THREE.Vector3(glassX(z, y), y, z), new THREE.Vector3(1, 0, 0));
    return ray.intersectObject(sail).length > 0;
  };
}

describe("given every body style whose drawn C-pillar is a sail (`cPillar`)", () => {
  for (const [id, style] of SAIL_STYLES) {
    it(`when a ${id}'s sail is read along its haunch, then each section's foot sits on the body's shoulder and its face leaves it within ${SAIL_LEAN_DEGREES}° of the shoulder's tangent`, (t) => {
      if (style.cPillar?.flat) return t.skip("a flat sail leaves the body where its line touches the section: its own row");
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const haunchZ = Math.fround((style.cPillar?.tip?.[1] ?? drawnQuarter(style).zRearBot) - (style.cPillar?.sweep ?? SAIL_SWEEP));
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
    it(`when a ${id}'s sail is read at the roof's rear end, then a section stands within ${SAIL_ROOF_GAP * 1000} mm behind it, none of its points stands over the roof's skin (no flap) and it covers the roof end's skin outboard of the rear glass (no slit)`, () => {
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const roofZ = style.roofZ[0];
      const { ring, slices } = loftOf(sail);
      const ends = Array.from({ length: slices }, (_, s) => s).filter((s) => {
        const z = positionAt(sail, s * ring).z;
        return z < roofZ && z >= roofZ - SAIL_ROOF_GAP;
      });
      assert.ok(ends.length === 1, `${id}: ${ends.length} sections within ${SAIL_ROOF_GAP * 1000} mm behind the roof's rear end (z ${roofZ})`);
      for (let k = 0; k < ring; k++) {
        const p = positionAt(sail, ends[0]! * ring + k);
        const over = p.y - roofTopY(Math.abs(p.x), roofZ, style);
        assert.ok(over <= 1e-4, `${id} point ${k} (x ${p.x.toFixed(3)}, y ${p.y.toFixed(3)}): ${(over * 1000).toFixed(1)} mm over the roof's skin`);
      }
      const section = Array.from({ length: ring }, (_, k) => positionAt(sail, ends[0]! * ring + k));
      const roof = makeRoofGeometry(style).getAttribute("position") as THREE.BufferAttribute;
      let read = 0;
      for (let i = 0; i < roof.count; i++) {
        const [x, y] = [roof.getX(i), roof.getY(i)];
        if (Math.abs(roof.getZ(i) - roofZ) > 1e-4 || x <= style.rearGlass.wTop / 2 + 1e-3) continue;
        read++;
        let inside = false;
        let near = Infinity;
        for (let k = 0, j = ring - 1; k < ring; j = k++) {
          const [a, b] = [section[j]!, section[k]!];
          if (a.y > y !== b.y > y && x < a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
          const t = THREE.MathUtils.clamp(((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1), 0, 1);
          near = Math.min(near, Math.hypot(x - a.x - t * (b.x - a.x), y - a.y - t * (b.y - a.y)));
        }
        assert.ok(inside || near <= SAIL_ROOF_COVER, `${id}: the roof end's skin at (x ${x.toFixed(3)}, y ${y.toFixed(3)}) stands ${(near * 1000).toFixed(1)} mm outside the sail's section`);
      }
      assert.ok(read > 0, `${id}: no roof end skin outboard of the rear glass read`);
    });
  }

  for (const [id, style] of SAIL_STYLES.filter(([, s]) => s.cPillar?.flat)) {
    it(`when a ${id}'s flat sail is read along its haunch, then each section's outer face is straight within ${SAIL_FLAT_BOW * 1000} mm behind its ${(style.cPillar?.blend ?? SAIL_ROLL_BLEND_TEST) * 100} cm ease into the roof end's roll, no body point stands outside its line by more than its ${SAIL_SINK_TEST * 1000} mm sink, and one touches it (tangent, no crease)`, () => {
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const haunchZ = Math.fround((style.cPillar?.tip?.[1] ?? drawnQuarter(style).zRearBot) - (style.cPillar?.sweep ?? SAIL_SWEEP));
      const { ring, slices } = loftOf(sail);
      const off: string[] = [];
      let read = 0;
      for (let s = 0; s < slices; s++) {
        const foot = positionAt(sail, s * ring);
        if (foot.z > haunchZ) continue;
        read++;
        const face = Array.from({ length: SAIL_OUTER_POINTS }, (_, k) => positionAt(sail, s * ring + k));
        const head = face.at(-1)!;
        const [ux, uy] = [(head.x - foot.x) / Math.hypot(head.x - foot.x, head.y - foot.y), (head.y - foot.y) / Math.hypot(head.x - foot.x, head.y - foot.y)];
        // Signed distance outboard of the foot-to-head line (+x side: the line's normal turned up and out).
        const outside = (x: number, y: number) => (x - foot.x) * uy - (y - foot.y) * ux;
        const bow = Math.max(...face.map((p) => Math.abs(outside(p.x, p.y))));
        const body = sectionPoints(sampleSlice(foot.z, style.profile), style, "drawn").filter((p) => p.x > 0 && p.y < head.y);
        const proud = Math.max(...body.map((p) => outside(p.x, p.y)));
        const straight = foot.z <= style.roofZ[0] - (style.cPillar?.blend ?? SAIL_ROLL_BLEND_TEST) - SAIL_ROOF_GAP;
        if ((straight && bow > SAIL_FLAT_BOW) || proud > SAIL_SINK_TEST + 1e-4 || proud < 0) off.push(`z ${foot.z.toFixed(3)}: face bows ${(bow * 1000).toFixed(1)} mm, body stands ${(proud * 1000).toFixed(1)} mm outside its line`);
      }
      assert.ok(read >= SAIL_HAUNCH_SECTIONS, `${id}: ${read} sections along the haunch`);
      assert.ok(off.length === 0, `${id}: ${off.join("; ")}`);
    });
    it(`when a ${id}'s flat sail is read from its rear end to its front, then its outer face's shape off its chord changes at most ${SAIL_SHAPE_RATE} m per m of length between sections (no line where the flat haunch meets the roof's roll, nor where the roll meets the post ahead of it)`, () => {
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const { ring, slices } = loftOf(sail);
      // Each section's outer points' offsets (m, + outboard) off its foot-to-head chord, up to and including the roof end's section.
      const profiles: { z: number; offsets: number[] }[] = [];
      for (let s = 0; s < slices; s++) {
        const face = Array.from({ length: SAIL_OUTER_POINTS }, (_, k) => positionAt(sail, s * ring + k));
        const [foot, head] = [face[0]!, face.at(-1)!];
        // The sail's front ring stands at the post's top under the roof: the window's line closes on the roof there and the section is the post's own.
        if (s === slices - 1) break;
        const run = Math.hypot(head.x - foot.x, head.y - foot.y);
        profiles.push({ z: foot.z, offsets: face.map((p) => ((p.x - foot.x) * (head.y - foot.y) - (p.y - foot.y) * (head.x - foot.x)) / run) });
      }
      const off: string[] = [];
      for (let i = 1; i < profiles.length; i++) {
        const [a, b] = [profiles[i - 1]!, profiles[i]!];
        const rate = Math.max(...a.offsets.map((o, k) => Math.abs(b.offsets[k]! - o))) / (b.z - a.z);
        if (rate > SAIL_SHAPE_RATE) off.push(`z ${a.z.toFixed(3)} to ${b.z.toFixed(3)}: ${rate.toFixed(2)} m per m`);
      }
      assert.ok(profiles.length >= 3, `${id}: ${profiles.length} sections up to the roof's rear end`);
      assert.ok(off.length === 0, `${id}: ${off.join("; ")}`);
    });
    it(`when a ${id}'s flat sail is read across each of its sections, then its outer face folds at most ${SAIL_END_FOLD_DEGREES}° there between the strips behind and ahead (no hard line from the roof's rear corner down to the quarter)`, () => {
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const { ring, slices } = loftOf(sail);
      const end = Array.from({ length: slices }, (_, s) => s).find((s) => positionAt(sail, s * ring).z < style.roofZ[0] && positionAt(sail, s * ring).z >= style.roofZ[0] - SAIL_ROOF_GAP);
      const at = (s: number, k: number) => positionAt(sail, s * ring + k);
      const normal = (s: number, k: number) => {
        const [a, b, c, d] = [at(s, k), at(s, k + 1), at(s + 1, k), at(s + 1, k + 1)];
        return b.clone().sub(a).cross(c.clone().sub(a)).add(d.clone().sub(b).cross(c.clone().sub(b))).normalize();
      };
      assert.ok(end !== undefined && end > 0 && end < slices - 1, `${id}: no section inside the sail at the roof's rear end`);
      const off = Array.from({ length: slices - 2 }, (_, i) => i + 1).flatMap((s) => {
        const folds = Array.from({ length: SAIL_OUTER_POINTS - 1 }, (_, k) => THREE.MathUtils.radToDeg(normal(s - 1, k).angleTo(normal(s, k))));
        return Math.max(...folds) > SAIL_END_FOLD_DEGREES ? [`z ${at(s, 0).z.toFixed(3)}: ${folds.map((f) => f.toFixed(1)).join(", ")}°`] : [];
      });
      assert.ok(off.length === 0, `${id}: the outer face folds across ${off.join("; ")}`);
    });
  }
  it(`when the coupe's flat sail sets \`cPillar.reachLip\`, then ahead of its roof end every section's outer face meets the roof's cant lip within ${SAIL_LIP_GAP * 1000} mm at the lip's height, not a chord to a head under the roof's edge`, () => {
    const coupe = CAR_STYLES.coupe;
    const stock: BodyStyle = { ...coupe, cPillar: { ...coupe.cPillar!, reachLip: undefined } };
    const reach: BodyStyle = { ...stock, cPillar: { ...stock.cPillar!, reachLip: 1 } };
    const ahead = (style: BodyStyle) => sailRings(style).filter(([foot]) => foot!.z > style.roofZ[0] && foot!.z <= drawnQuarter(style).zRearTop);
    const gaps = ahead(reach).map((section) => lipGap(reach, section));
    assert.ok(gaps.length >= 2, `${gaps.length} sections ahead of the roof end up to the quarter's top`);
    assert.ok(gaps.every((gap) => Math.abs(gap) <= SAIL_LIP_GAP), `lip past the face (mm): ${gaps.map((gap) => (gap * 1000).toFixed(1)).join(", ")}`);
    const control = lipGap(stock, ahead(stock)[0]!);
    assert.ok(control > SAIL_LIP_GAP, `the stock coupe's lip overhangs: the row would not catch it (${(control * 1000).toFixed(1)} mm)`);
  });
  it(`when the coupe's sail is read ahead of its roof end, then the roof's cant lip stands at most ${COUPE_FIN_GAP * 1000} mm past its outer face where it crosses the lip's height (a fin over the quarter)`, () => {
    const coupe = CAR_STYLES.coupe;
    const first = sailRings(coupe).find(([foot]) => foot!.z > coupe.roofZ[0])!;
    const gap = lipGap(coupe, first);
    assert.ok(gap <= COUPE_FIN_GAP, `the lip stands ${(gap * 1000).toFixed(1)} mm past the face at z ${first[0]!.z.toFixed(3)}`);
  });
  it("when the coupe's flat sail sets `cPillar.rollShare` 0.5, then each ring behind its roof end carries half the stock's offset off its chord and every vertex at or ahead of the roof end is the stock's", () => {
    const coupe = CAR_STYLES.coupe;
    const stock: BodyStyle = { ...coupe, cPillar: { ...coupe.cPillar!, rollShare: undefined } };
    const [base, halved] = [stock, { ...stock, cPillar: { ...stock.cPillar!, rollShare: 0.5 } }].map(sailRings);
    const atEnd = stock.roofZ[0] - SAIL_ROOF_GAP;
    const off: string[] = [];
    let [behind, carried] = [0, 0];
    for (let s = 0; s < base.length; s++) {
      const [stockRing, halfRing] = [base[s]!, halved[s]!];
      const z = stockRing[0]!.z;
      if (z >= atEnd) {
        const [kept, changed] = [stockRing, halfRing].map((ring) => ring.map((p) => `${p.x.toFixed(6)} ${p.y.toFixed(6)} ${p.z.toFixed(6)}`).join());
        if (kept !== changed) off.push(`z ${z.toFixed(3)} at or ahead of the roof end differs from the stock's`);
        continue;
      }
      behind++;
      const [whole, half] = [stockRing, halfRing].map(chordOffsets);
      for (let k = 1; k < SAIL_OUTER_POINTS - 1; k++) {
        carried = Math.max(carried, Math.abs(whole[k]!));
        if (Math.abs(half[k]! - 0.5 * whole[k]!) > 1e-6) off.push(`z ${z.toFixed(3)} point ${k}: ${(half[k]! * 1000).toFixed(2)} mm off its chord, the stock's ${(whole[k]! * 1000).toFixed(2)} mm`);
      }
    }
    assert.ok(behind >= 2, `${behind} rings behind the roof end`);
    assert.ok(carried > 0.001, `the stock's roll offsets stand at most ${(carried * 1000).toFixed(2)} mm off the chord: the row would not catch a wrong share`);
    assert.ok(off.length === 0, off.join("; "));
  });
  for (const [id, style] of SAIL_STYLES.filter(([, s]) => (s.cPillar?.pinch ?? 0) > 0)) {
    it(`when a ${id}'s pinched side window is read in the side view, then its glass shows within ${WINDOW_POINT_SHOWS * 1000} mm of the window's point: the sail never cuts across it`, () => {
      const blunt = windowPointCover(UNPINCHED_COUPE);
      assert.ok(blunt > WINDOW_POINT_SHOWS, `the control: the coupe's unpinched window shows its glass ${(blunt * 1000).toFixed(0)} mm past its point`);
      const cover = windowPointCover(style);
      assert.ok(cover <= WINDOW_POINT_SHOWS, `${id}: the glass shows ${(cover * 1000).toFixed(0)} mm past the window's point`);
    });
    it(`when a ${id}'s pinched side window is read at its sail's front ring, then the sail reaches at most ${PINCH_FRONT_UNDER * 1000} mm under the glass's top line there: the window's line rounds into it`, () => {
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const { ring, slices } = loftOf(sail);
      const points = Array.from({ length: ring }, (_, k) => positionAt(sail, (slices - 1) * ring + k));
      const under = glassTopY(points[0]!.z, style) - Math.min(...points.map((p) => p.y));
      assert.ok(under <= PINCH_FRONT_UNDER, `${id}: at z ${points[0]!.z.toFixed(3)} the sail reaches ${(under * 1000).toFixed(1)} mm under the glass's top line`);
    });
  }
  for (const [id, style] of SAIL_STYLES.filter(([, s]) => s.cPillar?.dEnd)) {
    it(`when a ${id}'s side window's rear end is read in the side view, then its glass's visible top edge keeps the D end's arc's shape within ${D_END_SHAPE * 1000} mm from its rearmost to the line: a round end, not a point`, () => {
      const q = drawnQuarter(style);
      const [tipY, tipZ] = style.cPillar?.tip ?? [beltY(q.zRearBot, style), q.zRearBot];
      const [topY, topZ] = [glassTopY(q.zRearTop, style), q.zRearTop];
      const [dR, dRear] = style.cPillar!.dEnd!;
      const m = (topY - tipY) / (topZ - tipZ);
      const slant = Math.sqrt(1 + m * m);
      const dZ = dRear + dR;
      const dY = tipY + m * (dZ - tipZ) - dR * slant;
      const dTangent = dZ - (dR * m) / slant;
      const arcY = (z: number) => dY + Math.sqrt(Math.max(0, dR * dR - (dZ - z) ** 2));
      const lineY = (z: number) => tipY + m * (z - tipZ);
      // Read where the arc stands over the belt's rail and more than the fit under the straight line: nearer the line a point reads the same.
      const stations = Array.from({ length: Math.floor((dTangent - dRear) / D_END_STEP) + 1 }, (_, k) => dRear + k * D_END_STEP).filter(
        (z) => arcY(z) - D_END_FIT >= beltY(z, style) + D_END_RAIL && lineY(z) - arcY(z) > D_END_FIT,
      );
      assert.ok(stations.length >= D_END_MIN_READ, `${id}: ${stations.length} stations read the arc over the belt's rail, under the line`);
      // The sail's visible lower edge at each station (the highest y under the scan's top where the glass shows), as its offset (m) off the arc; NaN where the scan finds none.
      const edgeOffsets = (covers: (z: number, y: number) => boolean) =>
        stations.map((z) => (Array.from({ length: D_END_EDGE_READS }, (_, k) => arcY(z) + D_END_REACH - k * D_END_EDGE_STEP).find((y) => !covers(z, y)) ?? NaN) - arcY(z));
      const spreadOf = (offsets: number[]) => Math.max(...offsets) - Math.min(...offsets);
      const listed = (offsets: number[]) => stations.map((z, k) => `${z.toFixed(4)}: ${(offsets[k]! * 1000).toFixed(2)}`).join(", ");
      const covers = sailCovers(style);
      const bare = stations.filter((z) => !covers(z, arcY(z) + D_END_FIT));
      assert.ok(bare.length === 0, `${id}: the glass shows over the arc at z ${bare.map((z) => z.toFixed(4)).join(", ")}`);
      const offsets = edgeOffsets(covers);
      assert.ok(spreadOf(offsets) <= D_END_SHAPE, `${id}: the sail's edge stands off the arc by (z: mm) ${listed(offsets)}`);
      const straight = edgeOffsets(sailCovers({ ...style, cPillar: { ...style.cPillar, dEnd: undefined } }));
      assert.ok(spreadOf(straight) > D_END_SHAPE, `${id}'s control: without the round end the sail's edge stands off the arc by (z: mm) ${listed(straight)}, within ${D_END_SHAPE * 1000} mm: the row would not catch a point`);
    });
  }
  it("when a truck cab (a curved roof square to its cant at the rear, an upright quarter window edge on the monster) sets any sail, then the sail builds whole: every vertex finite", () => {
    const off: string[] = [];
    for (const id of ["pickup", "monster"] as const)
      for (const cPillar of [{}, { flat: true }, { flush: true }, { flat: true, flush: true }]) {
        const sail = makeGreenhouseFrame({ ...CAR_STYLES[id], cPillar }, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
        const pos = sail.getAttribute("position");
        let bad = 0;
        for (let i = 0; i < pos.count; i++) if (!Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))) bad++;
        if (bad > 0) off.push(`${id} ${JSON.stringify(cPillar)}: ${bad} of ${pos.count} vertices not finite`);
      }
    assert.ok(off.length === 0, off.join("; "));
  });
});

/** A glass bar (`pillars.glassBar`) stands at most this far (m) off the side glass's plane, never under it; its ends keep their width and centre within this (m). */
const GLASS_BAR_STAND = 0.003;
const GLASS_BAR_FIT = 0.001;
/** The sedan with the reference side view's 2.2 cm black bar on its rear door's glass. */
const BARRED_SEDAN: BodyStyle = {
  ...CAR_STYLES.sedan,
  pillars: { ...CAR_STYLES.sedan.pillars, glassBar: { width: [0.022, 0.022], z: [-0.866, -0.884] } },
  blackout: { ...CAR_STYLES.sedan.blackout, divider: true },
};

describe("given a style that stands a bar on its side glass (`pillars.glassBar`)", () => {
  it(`when its drawn greenhouse is read, then each side carries one black strip on the glass, within ${GLASS_BAR_STAND * 1000} mm off its plane and never under it, its width about its centre line at the belt and at the top; the cage carries none`, () => {
    const { width, z } = BARRED_SEDAN.pillars!.glassBar!;
    const bars = makeGreenhouseFrame(BARRED_SEDAN, "drawn").filter((g) => g.name === "glassBar");
    assert.ok(bars.length === 2, `${bars.length} bars drawn`);
    assert.ok(makeGreenhouseFrame(BARRED_SEDAN, "cage").every((g) => g.name !== "glassBar"), "the cage carries a bar");
    const off: string[] = [];
    for (const bar of bars) {
      if (bar.userData.blackout !== true) off.push("not toned black");
      const p = Array.from({ length: bar.getAttribute("position").count }, (_, i) => positionAt(bar, i));
      // Its surface, not only its corners: points over each triangle on a 4-step grid, read where the glass is.
      const idx = bar.getIndex()!.array;
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [p[idx[t]!]!, p[idx[t + 1]!]!, p[idx[t + 2]!]!];
        for (let i = 0; i <= 4; i++)
          for (let j = 0; j <= 4 - i; j++) {
            const v = a.clone().multiplyScalar(1 - (i + j) / 4).addScaledVector(b, i / 4).addScaledVector(c, j / 4);
            if (v.y > glassTopY(v.z, BARRED_SEDAN) + 1e-4) continue;
            const plane = THREE.MathUtils.lerp(beltX(v.z, BARRED_SEDAN), cantX(v.z, BARRED_SEDAN), (v.y - beltY(v.z, BARRED_SEDAN)) / (cantY(v.z, BARRED_SEDAN) - beltY(v.z, BARRED_SEDAN)));
            const stand = Math.abs(v.x) - plane;
            if (stand < 0 || stand > GLASS_BAR_STAND) off.push(`(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}) stands ${(stand * 1000).toFixed(1)} mm off the glass`);
          }
      }
      const ends = [p.filter((v) => v.y < beltY(v.z, BARRED_SEDAN) - 0.01), p.filter((v) => Math.abs(v.y - glassTopY(v.z, BARRED_SEDAN)) < 1e-4)];
      for (const [k, end] of ends.entries()) {
        const [lo, hi] = [Math.min(...end.map((v) => v.z)), Math.max(...end.map((v) => v.z))];
        if (end.length !== 2 || Math.abs(hi - lo - width[k]!) > GLASS_BAR_FIT || Math.abs((hi + lo) / 2 - z[k]!) > GLASS_BAR_FIT)
          off.push(`${k === 0 ? "belt" : "top"} end: ${end.length} points, z ${lo.toFixed(4)} to ${hi.toFixed(4)}`);
      }
    }
    assert.ok(off.length === 0, off.join("; "));
  });
});

/** A squared rear post's (`pillars.rearSquare`) outer face turns at most this far (m) in plan between its rear and front thirds; its cab back panel laps at least this far (m) over the rear glass's side edge. */
const REAR_SQUARE_TURN = 0.01;
const REAR_SQUARE_LAP = 0.01;
/** The monster with its cab's back corners squared. */
const SQUARED_MONSTER: BodyStyle = { ...CAR_STYLES.monster, pillars: { ...CAR_STYLES.monster.pillars, rearSquare: true } };

describe("given a truck cab whose rear post is squared (`pillars.rearSquare`)", () => {
  it(`when its drawn greenhouse is read, then each rear post's outer face runs along the car within ${REAR_SQUARE_TURN * 100} cm from its rear third to its front third at the belt (its head tucks under the roof's rolled rear end), a flat cab back panel facing the tail laps at least ${REAR_SQUARE_LAP * 100} cm over the rear glass's side edge on each side, and the cage is the plain monster's`, () => {
    const drawn = makeGreenhouseFrame(SQUARED_MONSTER, "drawn");
    const off: string[] = [];
    for (const post of drawn.filter((g) => g.name === "rear")) {
      const { ring } = loftOf(post);
      const points = Array.from({ length: ring }, (_, k) => positionAt(post, k));
      const [lo, hi] = [Math.min(...points.map((p) => p.z)), Math.max(...points.map((p) => p.z))];
      const outerX = (inThird: (z: number) => boolean) => Math.max(...points.filter((p) => inThird(p.z)).map((p) => Math.abs(p.x)));
      const [rearX, frontX] = [outerX((z) => z < lo + (hi - lo) / 3), outerX((z) => z > hi - (hi - lo) / 3)];
      if (Math.abs(rearX - frontX) > REAR_SQUARE_TURN) off.push(`belt ring: outer face x ${rearX.toFixed(3)} at its rear third vs ${frontX.toFixed(3)} at its front`);
    }
    const panels = drawn.filter((g) => g.name === "cabBack");
    if (panels.length !== 2) off.push(`${panels.length} cab back panels`);
    for (const panel of panels) {
      const p = Array.from({ length: panel.getAttribute("position").count }, (_, i) => positionAt(panel, i));
      const inner = Math.min(...p.map((v) => Math.abs(v.x)));
      if (inner > SQUARED_MONSTER.rearGlass.wBase / 2 - REAR_SQUARE_LAP) off.push(`cab back reaches in to x ${inner.toFixed(3)}`);
      const normal = panel.getAttribute("normal");
      for (let i = 0; i < normal.count; i++) if (normal.getZ(i) >= 0) off.push(`cab back normal ${i} z ${normal.getZ(i).toFixed(3)}: not facing the tail`);
    }
    const cage = (style: BodyStyle) => makeGreenhouseFrame(style, "cage").map((g) => Array.from(g.getAttribute("position").array).join(",")).join(";");
    assert.ok(cage(SQUARED_MONSTER) === cage(CAR_STYLES.monster), "the squared monster's cage differs from the plain monster's");
    assert.ok(off.length === 0, off.join("; "));
  });
});

/** A flush sail's head (`cPillar.flush`) stands at most this far (m) over the drawn rear glass (a chrome bead's 5 mm, its rounded edge's 2.5 mm radius where the section rises steeply into it, and a mm), and laps at least this far in over its side edge, so the glass's edge lies under the sail. */
const SAIL_FLUSH_HEIGHT = 0.0085;
const SAIL_FLUSH_LAP_MIN = 0.005;

describe("given every body style whose drawn sail laps the rear glass (`cPillar.flush`)", () => {
  for (const [id, style] of SAIL_STYLES.filter(([, s]) => s.cPillar?.flush)) {
    it(`when a ${id}'s sail is read along the rear glass, then each section's head stands within ${SAIL_FLUSH_HEIGHT * 1000} mm over the drawn glass (fallen with the dome) and laps its side edge (round at the top corners) by at least ${SAIL_FLUSH_LAP_MIN * 1000} mm`, () => {
      const rg = style.rearGlass;
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const { ring, slices } = loftOf(sail);
      const off: string[] = [];
      let read = 0;
      for (let s = 0; s < slices; s++) {
        const z = positionAt(sail, s * ring).z;
        if (z < rg.base[1] || z >= style.roofZ[0] - SAIL_ROOF_GAP) continue;
        read++;
        const head = Array.from({ length: ring }, (_, k) => positionAt(sail, s * ring + k)).reduce((a, b) => (b.y > a.y ? b : a));
        const lap = rearGlassInset(style, z, 0).x - head.x;
        const over = head.y - rearGlassInset(style, z, lap).y;
        if (!(over > 0 && over <= SAIL_FLUSH_HEIGHT && lap >= SAIL_FLUSH_LAP_MIN)) off.push(`z ${z.toFixed(3)}: head ${(over * 1000).toFixed(1)} mm over the glass, ${(lap * 1000).toFixed(1)} mm in over its edge`);
      }
      assert.ok(read > 0, `${id}: no sail section along the rear glass`);
      assert.ok(off.length === 0, `${id}: ${off.join("; ")}`);
    });
  }

  for (const [id, style] of SAIL_STYLES.filter(([, s]) => s.cPillar?.flush && s.roofSection && s.rearGlass.round)) {
    it(`when a ${id}'s sail is read at its curved roof's rear end, then its head reaches in over the rear glass's round top corner's mid-arc by at least ${SAIL_FLUSH_LAP_MIN * 1000} mm (the ring behind follows the arc's lower half, the roof end meets its upper half: no notch), and that section stands behind the roof's bowed end at every point (no skin over skin)`, () => {
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const { ring, slices } = loftOf(sail);
      const end = Array.from({ length: slices }, (_, s) => s).find((s) => positionAt(sail, s * ring).z < style.roofZ[0] && positionAt(sail, s * ring).z >= style.roofZ[0] - SAIL_ROOF_GAP);
      assert.ok(end !== undefined, `${id}: no section at the roof's rear end`);
      const section = Array.from({ length: ring }, (_, k) => positionAt(sail, end * ring + k));
      const head = section.reduce((a, b) => (b.y > a.y ? b : a));
      const lap = rearGlassInset(style, rearGlassCornerZ(style, 0.5)!, 0).x - head.x;
      assert.ok(lap >= SAIL_FLUSH_LAP_MIN, `${id}: the roof end's head (x ${head.x.toFixed(3)}) ${(lap * 1000).toFixed(1)} mm in over the corner's mid-arc`);
      // The roof's rear end (its end ring, bowed with the glass top) as z by x, +x side.
      const roof = makeRoofGeometry(style).getAttribute("position") as THREE.BufferAttribute;
      const endRing = Array.from({ length: roof.count }, (_, v) => [roof.getX(v), roof.getZ(v)] as const)
        .filter(([x, z]) => x >= 0 && z <= style.roofZ[0] + 1e-6)
        .sort((a, b) => a[0] - b[0]);
      for (const p of section) {
        const k = endRing.findIndex(([x]) => x >= p.x);
        if (k <= 0) continue;
        const [[xa, za], [xb, zb]] = [endRing[k - 1]!, endRing[k]!];
        const roofEnd = xb === xa ? za : THREE.MathUtils.lerp(za, zb, (p.x - xa) / (xb - xa));
        assert.ok(p.z < roofEnd, `${id}: sail point (x ${p.x.toFixed(3)}, z ${p.z.toFixed(4)}) stands ${((p.z - roofEnd) * 1000).toFixed(1)} mm into the roof's end (z ${roofEnd.toFixed(4)})`);
      }
    });
  }

  it("when a curved-roof coupe's flush sail sets cPillar.corner, then its roof-end head laps the rear glass's round top corner at that share of the arc, where the mid-arc head stands outboard of it", () => {
    /** A share past the mid-arc, so the corner's upper half is covered from the roof end. */
    const SHARE = 0.8;
    const coupe = CAR_STYLES.coupe;
    const base: BodyStyle = { ...coupe, roofSection: coupe.roofSection ?? { crown: 0.5, blend: 0.5 }, cPillar: { ...coupe.cPillar, flush: true, corner: undefined } };
    const turned: BodyStyle = { ...base, cPillar: { ...base.cPillar, corner: SHARE } };
    /** The x of the head of `style`'s sail section at the roof's rear end, +x side. */
    const endHeadX = (style: BodyStyle): number => {
      const sail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "rear" && positionAt(g, 0).x > 0)!;
      const { ring, slices } = loftOf(sail);
      const end = Array.from({ length: slices }, (_, s) => s).find((s) => positionAt(sail, s * ring).z < style.roofZ[0] && positionAt(sail, s * ring).z >= style.roofZ[0] - SAIL_ROOF_GAP)!;
      return Array.from({ length: ring }, (_, k) => positionAt(sail, end * ring + k)).reduce((a, b) => (b.y > a.y ? b : a)).x;
    };
    const edge = rearGlassInset(turned, rearGlassCornerZ(turned, SHARE)!, 0).x;
    const [lap, midLap] = [edge - endHeadX(turned), edge - endHeadX(base)];
    assert.ok(lap >= SAIL_FLUSH_LAP_MIN && midLap < SAIL_FLUSH_LAP_MIN, `in over the arc at ${SHARE}: ${(lap * 1000).toFixed(1)} mm with the field, ${(midLap * 1000).toFixed(1)} mm with the mid-arc head`);
  });
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

/**
 * No normal (`normals`) of `geometry` on the side or ends points into the hull past `CRUSHED_OUTWARD_DOT_FLOOR`, outside `style`'s own door
 * cut (`door.aperture`): its sill and feathered jambs lie under the door skin, and a crush shears their slivers past each other there.
 */
function assertFacesOut(label: string, geometry: THREE.BufferGeometry, normals: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, style: BodyStyle): void {
  for (const point of outerSidePoints(geometry, normals, style.door.aperture, makeChassisGeometry(style).getAttribute("position"))) {
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
      assertFacesOut(id, geometry, normals, CAR_STYLES[id]);
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
      assertFacesOut(`${id} sim skin`, geometry, geometry.getAttribute("normal"), CAR_STYLES[id]);
    });
  }
});

// ---- (d) draw calls and cost -----------------------------------------------------------------------------------------------

/**
 * Measured by building every style's car: the visible meshes a car draws, the triangles they hold, and the body mesh's vertices (what the
 * skin writes each frame, so what its cost follows). `drawCalls` counts the car's own meshes: its static parts are seats `PartBatch` draws
 * (the plain kinds one instanced draw each, the styled kinds one `SeatDraw` for every car), none of them the car's meshes.
 */
const BASELINE_BY_STYLE = [
  // The sedan's re-pinned for its quarter window's round rear end (`cPillar.dEnd`) and the A-sail's glass-top station (`aPillarSailGlass`).
  { id: "sedan", drawCalls: 13, triangles: 5390, bodyVertices: 1587 },
  { id: "hatchback", drawCalls: 13, triangles: 5064, bodyVertices: 1587 },
  // The wagon's re-pinned for its roof spoiler carrying the roof's crown and rounding its corners in plan, as the reference's, and its drawn twin's front roll down onto the windshield top.
  { id: "wagon", drawCalls: 13, triangles: 5152, bodyVertices: 1660 },
  { id: "coupe", drawCalls: 16, triangles: 5152, bodyVertices: 1530 },
  { id: "pickup", drawCalls: 13, triangles: 5026, bodyVertices: 1568 },
  // The police carries the sedan's quarter window (pinch ring, sail sweep ring, round end), its divider bar and its belt rail's run-on under the sail.
  { id: "police", drawCalls: 14, triangles: 5535, bodyVertices: 1587 },
  { id: "monster", drawCalls: 13, triangles: 5026, bodyVertices: 1568 },
] as const satisfies readonly { id: CarStyleId; drawCalls: number; triangles: number; bodyVertices: number }[];
/** The stated budget: a car's triangles at most 1.6 x the baseline. */
const TRIANGLE_BUDGET = 1.6;
/** The skin writes every body vertex each frame (its cost follows the count): the body's loft at most 1.2 x the baseline's vertices, which measured 1.2 x the baseline's skin time at most. */
const BODY_VERTEX_BUDGET = 1.2;
/** Each roof fitting kind's vertices as built (`makeRoofFittings`), merged into the body on top of its loft: red if a fitting grows. */
// The spoiler's re-pinned for the wagon's crowned top and rounded corners (the most rings and points any car's spoiler draws).
const ROOF_FITTING_VERTICES = { rails: 220, glassPanel: 154, spoiler: 61 } as const;
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
 * roll's third chord), its split gaps' rings and their wall tops (`ringSplit`), its tub walls' own top vertices, its door cut's end rings'
 * ramp copies (`door.shutCrease`) and its curved posts' section points past the chamfered box's as built, merged into the body on top of its loft: red if one grows.
 */
const WELL_AND_CUT_VERTICES: Record<CarStyleId, { lips: number; humps: number; liners: number; bootRings: number; noseRings: number; splitRings: number; wallTops: number; shutCopies: number; curvedPosts: number }> = {
  // Sedan and police: curvedPosts 430 -> 550: the quarter window's round rear end (`cPillar.dEnd`) takes three 20-point sail rings a side
  // (rearmost, mid-arc, tangent).
  // wallTops 52 -> 54: the drawn windshield seated on the hood (`drawn.windshield.seat`, `hood.followGlass`).
  sedan: { lips: 360, humps: 0, liners: 120, bootRings: 84, noseRings: 168, splitRings: 46, wallTops: 54, shutCopies: 0, curvedPosts: 550 },
  hatchback: { lips: 360, humps: 94, liners: 120, bootRings: 42, noseRings: 105, splitRings: 0, wallTops: 18, shutCopies: 0, curvedPosts: 258 },
  wagon: { lips: 360, humps: 94, liners: 120, bootRings: 42, noseRings: 147, splitRings: 0, wallTops: 30, shutCopies: 0, curvedPosts: 258 },
  coupe: { lips: 360, humps: 94, liners: 120, bootRings: 42, noseRings: 105, splitRings: 0, wallTops: 46, shutCopies: 32, curvedPosts: 416 },
  pickup: { lips: 260, humps: 94, liners: 120, bootRings: 42, noseRings: 63, splitRings: 0, wallTops: 16, shutCopies: 0, curvedPosts: 226 },
  police: { lips: 360, humps: 0, liners: 120, bootRings: 84, noseRings: 168, splitRings: 46, wallTops: 54, shutCopies: 0, curvedPosts: 550 },
  monster: { lips: 312, humps: 94, liners: 214, bootRings: 42, noseRings: 42, splitRings: 0, wallTops: 26, shutCopies: 0, curvedPosts: 226 },
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
function wellAndCutVertices(style: BodyStyle): { lips: number; humps: number; liners: number; bootRings: number; noseRings: number; splitRings: number; wallTops: number; shutCopies: number; curvedPosts: number } {
  const body = makeChassisGeometry(style);
  const unsplit = makeChassisGeometry({ ...style, ringSplit: undefined });
  const rings = (bootOpen: boolean, noseFill: boolean) => sliceZs(style, "drawn", bootOpen, noseFill).length;
  const liners = (source: "drawn" | "cage") => makeWellLiners(style, source, body).reduce((n, g) => n + g.getAttribute("position").count, 0);
  const posts = makeGreenhouseFrame(style, "drawn").filter((g) => POST_NAMES.includes(g.name));
  return {
    lips: archLipGeometry(style, body)?.getAttribute("position").count ?? 0,
    humps: wellHumpGeometry(style, "drawn")?.getAttribute("position").count ?? 0,
    liners: liners("drawn") - liners("cage"),
    bootRings: (rings(true, true) - rings(false, true)) * loftOf(body).ring,
    noseRings: (rings(true, true) - rings(true, false)) * loftOf(body).ring,
    splitRings: body.getAttribute("position").count - unsplit.getAttribute("position").count,
    wallTops: unsplit.userData.wallTops as number,
    shutCopies: body.userData.shutCopies as number,
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
      const loft = car.body.geometry.getAttribute("position").count - fittings.all - wells.lips - wells.humps - wells.liners - wells.bootRings - wells.noseRings - wells.splitRings - wells.wallTops - wells.shutCopies - wells.curvedPosts;
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
      const body = makeChassisGeometry(drawnStyle(CAR_STYLES[id]));
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
// Re-pinned (sedan to police, the monster still rocking) when a placed wall no longer stirs a wreck at rest beside it every step: each ends asleep.
const SIM_DIGEST_BY_STYLE = [
  // CarSedan's shape data on top of CarRig's re-pin (sedan and police alike): crowned hood and its stations (f3ba51c8), the sedan's own front
  // fascia (e17b83ac), mirror reach .128 (28843919), then the reference's arch radius .405 -> .375. Sedan 3b05ae33... -> 26331e81... (shape
  // data) -> 92a72440... (arch); police 70734ab6... -> 2fe405f6... -> 1071e0a8....
  { id: "sedan", digest: "69c4aae6f1e25184d362169764b3a1666c1e242040ad888909d6a65f5c24b119" },
  // Re-pinned when every style's roof, glass, hood and boot cages came from its own panels (`carFrame`) instead of a hand fit; the sedan's are the fit itself.
  // Hatch and SUV re-pinned for their reference shapes: door shut lines, cowl belt, the SUV's clamshell hood and raked nose, bumpers wrapped to their seams, the hatch's boot foot.
  // The hatchback's again when the cage kept the underside a body rests on, over its vertex budget (CarRig rig-lip): d1b0dbd0... ->
  // ace6af8c...; the other six unchanged.
  // The hatchback's again for its roof rolling round into its side glass (`roofSection` .4/.9, as the coupe's): the panes' tops and roof cage follow it: ace6af8c... -> b1cfea45....
  { id: "hatchback", digest: "05d59711095526677badbe6274b0b65f41c0570b653ca66595a7a142c85db066" },
  { id: "wagon", digest: "ba34842cc75a5c8dd618874ce6ae44afe8fb4737d57ec461e345445b4428587c" },
  // The coupe re-pinned for its nose deck lowered 0.5-2.8 cm over z 1.76-1.945 to the reference's side line.
  { id: "coupe", digest: "0c2b0ea6af3a5c6a9d4dd886324a922b0c6a37378f5cbb1c70284b6e2b49a9cc" },
  // The pickup re-pinned for its hood wrapping the nose (`hood.z1` 1.86 -> 1.92): its hood's cage reaches the nose the wall meets.
  // Its cab roof narrowed to the top plate's (profile cabinHw) brings the wall hit back to the same crush as before its mid-cab roof rose.
  { id: "pickup", digest: "a46b9582e2076132941a87a47f2b8bb2eb472336a37c976b681b8fd509ec6cb6" },
  // The police's moved at REPLAY 116 (12fb33c4... before): its light bar folds about a base hinge across the car, so the bar's cage pose, which is part of the car's
  // contact shape, differs in the hit and the masses differ by the bar's contact. Probe: with the fold set to 0 the digest is another (899b2770...), so it is the bar's
  // pose that moves it; the five bar-less styles above are unchanged to the bit.
  { id: "police", digest: "2691a21952fe8fbb0240da1e6800a4c98763189c285cfab77b1a260b127fc2ee" },
  // The monster is its own body style (its own dims, cage and lifted class body), no longer the pickup's.
  // Again when a wreck's masses rode its lifted centre, not their centroid (CarRig rig-seat): 7a1610ef... -> db09b87c...; the other six unchanged.
  { id: "monster", digest: "dfb82826e0f6aa14d0fe5c3eb7c9247b381e841c2ec48ac1ad080e8ddfec6895" },
  // Every style re-pinned with its bumpers in the cage (`CageSource.apart`), each a window of its own (`CageFields.part`): the cage's nose and tail meet the drawn bumper faces.
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
    source.rest, Uint32Array.from(source.index), source.group, source.held, source.skinN, source.skinXf, source.skinW, source.resJ, source.resW, source.resC,
    source.skinHub, source.infN, source.infCo, source.infUvw, source.massRest, source.restCo, source.panelOrigin, source.panelGlass,
    source.interiorRest, Uint32Array.from(source.interiorIndex), source.interiorMass, Uint32Array.of(source.panelCount, source.clusterCount), source.sill,
  ];
  const hash = createHash("sha256");
  for (const field of fields) hash.update(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
  return hash.digest("hex");
}

// CarRig's single re-pin: sedan, coupe, pickup, police and monster's cage sources moved with each style's own panels, lids and hood, the wheel
// tubs and the interior (union 1d751bfc); the monster's is no longer the pickup's.
// Every style re-pinned for its raked panes' top edges falling onto the roof's dome (`domeFall`): the panes' cage-skinned rest moved;
// the coupe also for its rear glass's round corners (`rearGlass.round`).
const CAGE_SOURCE_DIGEST_BY_STYLE = [
  // CarSedan's shape data and arch radius (as the sim digests above): sedan b9e9e98b... -> df8e0b97... -> 720053fe...; police 2466b278... -> 5e59494a... -> 23142cfa....
  // Sedan and police re-pinned for the door glass's top-front corner kept in under the slim A-post (`aPillarTop` 0.143): 8540eed1 -> 2fc92389; police 5af761d2 -> d97239fa.
  // Then 0.13, so the cage's A-pillar box keeps the dummies' roof proxy off the windshield: 2fc92389 -> d4d091d3; police d97239fa -> 26d74836.
  // Again for the tail widened to the reference's plan: d4d091d3 -> 03293d37; police 26d74836 -> bb93a908.
  { id: "sedan", digest: "74f7608fb5214bcfa1d7e016fd10d8db529fa08524c5e67ad9da3e074dd162ca" },
  // Re-pinned with the cabin cages derived from each style's panels (`carFrame`): the cage-skinned tables over them moved.
  // Hatch, SUV, truck and monster re-pinned with the boot hinged at its own pivot (`bootPivot`): its panel origin and its lid's rest local to it moved; the car-frame cage at rest did not.
  // Hatch and SUV re-pinned for their reference shapes: door shut lines, cowl belt, the SUV's clamshell hood and raked nose, bumpers wrapped to their seams, the hatch's C-pillar top and boot foot.
  // The hatch's again for its windshield reaching the reference's glass top (`windshieldTop` [1.245, .245], `wTop` 1.03, roof ending there): a754e5e3... -> bd7135b8....
  // Again for its rear glass base and gate top dropped to the reference's (.94 -> .905): bd7135b8... -> b9336649....
  // Again for its quarter glass's rear edge leaning forward to the reference's (top z -1.07 -> -.96, belt -1.174 -> -1.15) and its roof's rear lip tucked over the D-pillars (`roofEnds.rear` .019, flush): b9336649... -> 5a049815....
  // Again for its rear glass's top widened to the reference's (`wTop` .9 -> 1.0), its side frit slimmed (.05 -> .03) so the D-pillar narrows at the roof, and its roof rolling round into its side glass (`roofSection`): 5a049815... -> 6648aae3....
  { id: "hatchback", digest: "da477675bc9e3e96562385c3c87ad5477440836fbdf64446c8a9b762db6dca47" },
  // The SUV's for its quarter glass running back to a slim D-post (rear edge belt -1.945 -> -1.995, top -1.67 -> -1.72): 367e3e9f... -> 94bad84a....
  // Again for its D-post's edges running near parallel (quarter top -1.72 -> -1.76, belt -1.995 -> -1.99; rear glass `wTop` .92 -> .96): 94bad84a... -> fa93839f....
  { id: "wagon", digest: "91dfb743bb14bff26a93709a62ddb97a6cd1f94bff06ee2ea07a817186540cc4" },
  // The coupe re-pinned for its crisper nose (hood lip and held station at z 1.945), its rear glass bowed 5 mm deeper than the default at its base (its glassRear cage 5 mm back), its nose crown at z 1.9 dropped 2.5 mm (as its sim digest above), and its drawn roof rolled onto the windshield's top (`roofEnds.front`).
  // Re-pinned for its rear glass's round outline (`rearGlass.roundOutline`): the frit's corner fans stand 1 cm in behind the pane as a backing, and the pane's drawn vertices are the glass panel's cage-skinned rest.
  // Re-pinned for its curved roof (`roofSection` .4/.6) and narrower rear glass top (`rearGlass.wTop` .92): the raked panes fall with the dome and the glass panel's cage-skinned rest moved.
  // Re-pinned for its belt's crest under the sail's foot dropped (profile z -1.49) and its quarter glass's point moved back (`quarter.zRearBot` -0.981, the belt's rear knots with it): the skin rows there and the glass panel's cage-skinned rest moved.
  // Re-pinned for its quarter glass's sill rising to the window's point (`belt.y` -0.981 .925) and its shoulder held level behind it (profile z -1.49 to -1.023 at .924-.93): the glass, its rail and the skin there moved.
  // Re-pinned for its haunch's crest (`shoulder`: the widest line 5-9 cm under the belt from the tail to the door), its quarter sill dipping behind the door and its roof's rear corner 2 cm wider (cabinHw .49/.50): 034d75e5 -> f8bbd431.
  { id: "coupe", digest: "a72e6e23cfde4dfb9c1449865aeec69e0ef3e8ea3ed626e9939a3837457edb9a" },
  // The monster re-pinned for its thin bed rim (`tubWall` .04): the bed walls' top edge stands 2 cm further out in both builds.
  // Pickup and monster re-pinned for the roof ending at the windshield's top (`roofZ`/`windshieldTop` z .45); the pickup's solid cab corner (`quarter` -0.3) too.
  // The pickup re-pinned for its thin bed rim (`tubWall` .04), now its own proxy belt keeps the dummies' bed open; both trucks for the greenhouse's dome-following panes and posts.
  // Both trucks re-pinned for their hoods wrapping the nose (`hood.z1` pickup 1.92, monster 2.10); the monster's for its lower bed humps (`wheelTub.rise` .21),
  // the pickup's for its panes taking a quarter of the roof's dome (`domeFall` .25); both for their roofs rolling onto their glass tops (`roofEnds`), which the
  // panes' tops follow; the pickup's again for its rear glass's top back at z -0.45 (at -0.5 the crushed cab's dummy-world roof stood 8 cm off the drawn one).
  // Both trucks re-pinned for their smooth roof crown (`roofSection`, square over the windshield) the panes' tops follow; the pickup's for its
  // rear glass's top raised under the roof's rolled end (y 1.6 -> 1.635) and its panes taking the whole dome.
  // The pickup's again for its door glass starting back where the side plate's does (`aPillarFoot` .7 -> .6, `aPillarTop` .41 -> .34): the A-post box moved.
  // The pickup's again for its windshield's foot forward to the side plate's edge (`windshield.base` z .9 -> .957: the A-post box moved) and its roof's
  // rear end over its rear glass's top (`roofZ[0]` -0.5 -> -0.46), its mid-cab roof 5 mm up to its dims' height.
  // The pickup's again for its rear glass's bowed top standing just ahead of the roof's end (`rearGlass.top`), so none shows past it.
  // The pickup's again for its cab narrowed to the top plate's roof edge (profile cabinHw) and its rear glass's top narrowed inside the roof's end.
  // Again for its door run back to the side plate's seam (`door.aperture`) with the B and rear post boxes behind it (`bPillar`, `quarter`).
  { id: "pickup", digest: "f59f3a60a1f7339e6b550aa99968a8dfbc7a14cf534140582c6a4c39f08e20a0" },
  { id: "police", digest: "64de4e9ece74a7ec7b4a4507ecc2c82750440baece8eeca74e54f264b2df89f9" },
  // The monster re-pinned for its rear door glass ending at the reference's C-pillar (`quarter` -0.55); again for its windshield base at the side
  // plate's (`windshield.base` [1.0, .92] -> [1.05, .98]) and its door glass starting back at .60 (`aPillarFoot` .74 -> .6): the glass-front and A-post boxes moved.
  // Again for its roof's flatter crown and tighter edge roll (`roofSection` crown .75, blend .8), as the pickup's.
  // The monster's again for its bed gate hinged at its bottom edge (`boot.pivot` [.45, -2.3]): it dropped open from its top like a hatch; the gate panel's origin and its rest local to it moved: 18934885... -> fc41fe09....
  { id: "monster", digest: "976fe14351a95b7be0d377b4c9a7fabe5cd5481926a662ff5a9bccef0d2e8232" },
  // Every style re-pinned with its bumpers in the cage (`CageSource.held`, `apart`): their fascia's rest, skin and held face points join the tables.
] as const satisfies readonly { id: CarStyleId; digest: string }[];

describe("given every body style's cage source, the tables its collision cage is decimated from", () => {
  for (const testCase of CAGE_SOURCE_DIGEST_BY_STYLE) {
    it(`when a ${testCase.id}'s cage source is hashed, then it equals the digest of the unsmoothed build, so the smoothed mesh never moves a contact shape`, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, testCase.id);
      assertSameDigest(cageSourceDigest(car), testCase.digest, `${testCase.id} cage source`);
    });
  }
});

/** The sedan with its windshield's base drawn 5 cm further back and its door glass starting 4 cm further back, its cage and sim on its own fields. */
const SEDAN_TWIN: DrawnTwin = {
  windshield: { ...CAR_STYLES.sedan.windshield, base: [CAR_STYLES.sedan.windshield.base[0], CAR_STYLES.sedan.windshield.base[1] - 0.05] },
  aPillarFoot: CAR_STYLES.sedan.aPillarFoot - 0.04,
};

describe("given a style whose windshield is drawn apart from its cage (`drawn`)", () => {
  it("when a car of it is built, then its windshield pane and its body's A-post and sail are the twin's, while its cage source, its sim masses at rest and the windshield's exit point stay the style's own", () => {
    const joined = (geo: THREE.BufferGeometry) => Array.from(geo.getAttribute("position").array).join(",");
    const paneOf = (car: DeformableCar) => car["glassPanes"].find((g) => g.name === "windshield")!.mesh.geometry;
    const massesOf = (car: DeformableCar) => car.deform.masses.map(({ rest }) => `${rest.x},${rest.y},${rest.z}`).join(";");
    const plain = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
    CAR_STYLES.sedan.drawn = SEDAN_TWIN;
    try {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
      const off: string[] = [];
      if (joined(paneOf(car)) !== joined(makeWindshield(drawnStyle(CAR_STYLES.sedan)))) off.push("the windshield pane is not the twin's");
      if (joined(paneOf(car)) === joined(paneOf(plain))) off.push("the windshield pane did not move");
      if (joined(car.body.geometry) === joined(plain.body.geometry)) off.push("the body's A-post and sail did not move");
      if (String(paneOf(car).userData.centre) !== String(paneOf(plain).userData.centre)) off.push(`the exit point moved: ${paneOf(car).userData.centre} vs ${paneOf(plain).userData.centre}`);
      if (massesOf(car) !== massesOf(plain)) off.push("the sim's masses at rest moved");
      if (cageSourceDigest(car) !== cageSourceDigest(plain)) off.push("the cage source moved");
      assert.ok(off.length === 0, off.join("; "));
    } finally {
      delete CAR_STYLES.sedan.drawn;
    }
  });
});

/** A pane's base vertex stands at most this far (m) over the hood's top. */
const PANE_OVER_HOOD_M = 0.01;
/** The probe ray starts this far (m) over the pane's base vertex: clear of the hood's skin, so it reads the hood's top, never its underside. */
const PANE_PROBE_LIFT_M = 0.05;
/** The drawn A-post's lowest point stands at most this far (m) over the windshield's side base. */
const A_POST_FOOT_SLACK_M = 0.005;

describe("given a sedan whose windshield wraps in plan and bulges in side view, its hood following it (`windshield.sideBow`, `hood.followGlass`)", () => {
  it("when its pane, A-post and hood are built, then the pane's side edge stands sideBow forward of its chord at mid-height, the drawn A-post laps that edge within 1 cm at every height, and the hood's rear edge runs the cowl's width in front of the pane's base at every point across", () => {
    const off: string[] = [];
    const { base, sideBow } = WRAPPED_SEDAN.windshield;
    const [, topZ] = WRAPPED_SEDAN.windshieldTop;
    const glass = makeWindshield(WRAPPED_SEDAN).getAttribute("position");
    // The pane's right column (its 11 x 9 grid), at mid-height.
    const mid = 4 * 11 + 10;
    const bulge = glass.getZ(mid) - THREE.MathUtils.lerp(base[1], topZ, 0.5);
    if (Math.abs(bulge - sideBow!) > 1e-4) off.push(`the side edge bulges ${(bulge * 1000).toFixed(1)} mm at mid-height`);
    const hood = makeHoodGeometry(WRAPPED_SEDAN);
    const hp = hood.getAttribute("position");
    const { ring } = loftOf(hood);
    const [, oz] = WRAPPED_SEDAN.hood.origin;
    for (let k = 0; k < ring; k++) {
      const x = hp.getX(k);
      const xn = Math.min(Math.abs(x) / (WRAPPED_SEDAN.windshield.wBase / 2), 1);
      const want = base[1] + 0.165 * (1 - xn * xn) + 0.04;
      if (Math.abs(hp.getZ(k) + oz - want) > 1e-4) off.push(`hood rear point ${k} at x ${x.toFixed(3)}: z ${(hp.getZ(k) + oz).toFixed(4)}, want ${want.toFixed(4)}`);
    }
    assert.ok(off.length === 0, off.join("; "));
  });
  it("when its hood tucks under the glass's base, then the pane's base sits on the hood's top at every column (under 1 cm over it, never into it), and the drawn A-post's foot stands on that base", () => {
    const off: string[] = [];
    const glass = makeWindshield(TUCKED_SEDAN).getAttribute("position");
    const hood = makeHoodGeometry(TUCKED_SEDAN);
    const hp = hood.getAttribute("position");
    const [oy, oz] = TUCKED_SEDAN.hood.origin;
    const mesh = new THREE.Mesh(hood, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.position.set(0, oy, oz);
    mesh.updateMatrixWorld(true);
    // The hood's rear ring is as wide as the cowl: the pane's outer columns stand past it, over the fender, where no hood lies to read.
    const hoodHalf = Math.max(...Array.from({ length: loftOf(hood).ring }, (_, k) => Math.abs(hp.getX(k))));
    const ray = new THREE.Raycaster();
    // The pane's base row is the first 11 vertices of its 11 x 9 grid.
    for (let i = 0; i <= 10; i++) {
      const [x, y, z] = [glass.getX(i), glass.getY(i), glass.getZ(i)];
      if (Math.abs(x) > hoodHalf) continue;
      ray.set(new THREE.Vector3(x, y + PANE_PROBE_LIFT_M, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      if (hit === undefined) off.push(`column ${i} (x ${x.toFixed(3)}): no hood under the pane's base`);
      else if (y - hit.point.y < 0 || y - hit.point.y > PANE_OVER_HOOD_M) off.push(`column ${i} (x ${x.toFixed(3)}): the base stands ${((y - hit.point.y) * 1000).toFixed(1)} mm over the hood`);
    }
    const post = makeGreenhouseFrame(TUCKED_SEDAN, "drawn").find((g) => g.name === "a")!;
    const foot = Math.min(...Array.from({ length: post.getAttribute("position").count }, (_, k) => post.getAttribute("position").getY(k)));
    const side = windshieldBaseY(TUCKED_SEDAN, 1);
    if (foot > side + A_POST_FOOT_SLACK_M) off.push(`the A-post's foot stands ${((foot - side) * 1000).toFixed(1)} mm over the pane's side base`);
    assert.ok(off.length === 0, off.join("; "));
  });
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
