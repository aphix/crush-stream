import * as THREE from "three";
import { BODY_VERTICES, bodyIndex } from "./dummy-bodies.ts";
import { HAND_LENGTH, KNEE_HALF_BAND, restFits, RIG_KNEE_Y } from "./dummy-fit.ts";
import { FACE_FRONT_FROM, FACE_FRONT_TO, FACE_HALF_WIDTH, FACE_SPAN, headAt, measureHead, RIM_AT } from "./dummy-head.ts";
import { scalpHairline } from "./dummy-hair.ts";
import { loft, type Lofted } from "./dummy-loft.ts";
import { BONES_ATTRIBUTE, BUILD, EVERY_BUILD, FLAGS_AT, HEAD, isDrawn, KINDS_ATTRIBUTE, LEFT_ARM, LEFT_LEG, NO_PRINT, NORMAL_PORTLY_ATTRIBUTE, NORMAL_WOMAN_ATTRIBUTE, PRINT_ATTRIBUTE, RIGHT_ARM, RIGHT_LEG, ROLE, ROW_TEXELS, SHAPE_PORTLY_ATTRIBUTE, SHAPE_WOMAN_ATTRIBUTE, smooth, TORSO, type Fit } from "./dummy-rig.ts";
import { dressRow } from "./dummy-dress.ts";
import { BELT_BOTTOM, hangAttribute } from "./dummy-garments.ts";
import { wearFor } from "./dummy-wear.ts";
import { bustWeights } from "./dummy-jiggle.ts";
import { once } from "../kernel/scalar.ts";
import { decimate } from "../vehicle/cage-mesh.ts";

/**
 * The dummy's one continuous body: `dummyGeometry` takes the three fitted bodies (one topology, three rest position sets), gives
 * every vertex two of the ten `PARTS` as bones with a blend between them and a colour role, and lofts each build's wear after.
 * `DummyMesh` (`ragdoll-mesh.ts`) poses it in the vertex shader; `skinPoint` is that skinning in TS.
 */

const { SHIRT, SKIN, LEGS, HAIR, SHOE, LOCKS, ARM } = ROLE;

/** Bones (first, second, weight of the second) for a `weight` between `first` and `second`: a whole weight is the one bone alone. */
function blendOf(first: number, second: number, weight: number): [number, number, number] {
  return weight <= 0 ? [first, first, 0] : weight >= 1 ? [second, second, 0] : [first, second, weight];
}

/** The foot is the shoe below this height (m); the shin above is the trouser's. */
const FOOT_TOP = 0.1;

/**
 * The body's bones, roles and prints, from the man's fit: the three builds share one topology, so a vertex is the same
 * anatomy on each. Neck skin begins where the neck's blend is done, all round: below it the shirt's neckline is the slot's
 * cut (front and back), so it follows the trapezius instead of cutting the mesh's rings in a zigzag. The face is the slot's
 * face print, projected flat from the front.
 */
function paintBody(fit: Fit): { bones: number[]; roleKind: number[]; print: number[] } {
  const head = measureHead(fit);
  const height = head.top - head.chin;
  const wrist = fit.fingertipY + HAND_LENGTH;
  const bones: number[] = [];
  const roleKind: number[] = [];
  const print: number[] = [];
  for (let i = 0; i < BODY_VERTICES; i++) {
    const [x, y, z] = [fit.rest[i * 3]!, fit.rest[i * 3 + 1]!, fit.rest[i * 3 + 2]!];
    const isLeft = fit.tpose[i * 3]! < 0;
    const upperArm = isLeft ? LEFT_ARM : RIGHT_ARM;
    const thigh = isLeft ? LEFT_LEG : RIGHT_LEG;
    const kneeWeight = smooth(RIG_KNEE_Y + KNEE_HALF_BAND, RIG_KNEE_Y - KNEE_HALF_BAND, y);
    if (fit.shoulderWeight[i]! > 0) bones.push(...(fit.shoulderWeight[i]! < 1 ? blendOf(TORSO, upperArm, fit.shoulderWeight[i]!) : blendOf(upperArm, upperArm + 1, fit.elbowWeight[i]!)));
    else if (fit.hipWeight[i]! > 0) bones.push(...(fit.hipWeight[i]! < 1 ? blendOf(TORSO, thigh, fit.hipWeight[i]!) : blendOf(thigh, thigh + 1, kneeWeight)));
    else bones.push(...blendOf(TORSO, HEAD, fit.neckWeight[i]!));
    const isHand = fit.shoulderWeight[i]! >= 1 && y < wrist;
    const isSkin = isHand || fit.neckWeight[i]! >= 1;
    const role = y < FOOT_TOP ? SHOE : isSkin ? SKIN : fit.shoulderWeight[i]! >= 1 ? ARM : fit.hipWeight[i]! > 0 ? LEGS : SHIRT;
    let kind: number = role;
    let printed: readonly number[] = NO_PRINT;
    if (fit.neckWeight[i] === 1 && role === SKIN) {
      const [, halfDepth, middleZ] = headAt(head, y);
      const frontness = (z - middleZ) / halfDepth;
      if (y > head.chin + height * scalpHairline(Math.atan2(Math.abs(x), z))) kind = y > head.chin + RIM_AT * height ? HAIR : LOCKS;
      else printed = [0.5 + x / (2 * FACE_HALF_WIDTH), (y - head.chin) / (FACE_SPAN * height), NO_PRINT[2], smooth(FACE_FRONT_FROM, FACE_FRONT_TO, frontness)];
    }
    roleKind.push(kind, EVERY_BUILD);
    print.push(...printed);
  }
  return { bones, roleKind, print };
}

/** `a` (`aSize` floats a vertex) and `b` (`bSize`) interleaved vertex by vertex: two attributes packed in one. */
function interleave(a: ArrayLike<number>, aSize: number, b: ArrayLike<number>, bSize: number): Float32Array {
  const size = aSize + bSize;
  const out = new Float32Array((a.length / aSize) * size);
  for (let i = 0; i < a.length / aSize; i++) {
    for (let k = 0; k < aSize; k++) out[i * size + k] = a[i * aSize + k]!;
    for (let k = 0; k < bSize; k++) out[i * size + aSize + k] = b[i * bSize + k]!;
  }
  return out;
}

/** The baked bodies, plus each build's wear lofted on after (one vertex order; three position attributes), and the wear's coarse index (`Lofted.coarse`). */
function buildDummy(): { geometry: THREE.BufferGeometry; coarseWear: number[] } {
  const { man, woman, portly } = restFits();
  const index = Array.from(bodyIndex());
  const { bones, roleKind, print } = paintBody(man);
  const wear: Lofted = { position: [], bones: [], roleKind: [], print: [], index: [], coarse: [] };
  for (const [build, fit] of [[BUILD.MAN, man], [BUILD.WOMAN, woman], [BUILD.PORTLY, portly]] as const) for (const shell of wearFor(build, fit)) loft(shell, wear);
  const count = BODY_VERTICES + wear.position.length / 3;
  const hang = hangAttribute(man, portly, count);
  const push = (part: number) => hang.filter((_, k) => k % 4 === part);
  const withWear = (body: Float32Array) => {
    const all = new Float32Array(body.length + wear.position.length);
    all.set(body);
    all.set(wear.position, body.length);
    return all;
  };
  for (const vertex of wear.index) index.push(vertex + BODY_VERTICES);
  const normalsOf = (positions: Float32Array) => {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    shape.setIndex(index);
    shape.computeVertexNormals();
    return shape.getAttribute("normal").array;
  };
  const [womanRest, portlyRest] = [withWear(woman.rest), withWear(portly.rest)];
  const kinds = roleKind.concat(wear.roleKind);
  const bust = bustWeights(new THREE.Float32BufferAttribute(womanRest, 3), new THREE.Float32BufferAttribute(kinds, 2));
  const onBody = Float32Array.from({ length: count }, (_, i) => Number(i < BODY_VERTICES));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(withWear(man.rest), 3));
  geometry.setAttribute(SHAPE_WOMAN_ATTRIBUTE, new THREE.Float32BufferAttribute(interleave(womanRest, 3, push(0), 1), 4));
  geometry.setAttribute(SHAPE_PORTLY_ATTRIBUTE, new THREE.Float32BufferAttribute(interleave(portlyRest, 3, push(2), 1), 4));
  geometry.setAttribute(NORMAL_WOMAN_ATTRIBUTE, new THREE.Float32BufferAttribute(interleave(normalsOf(womanRest), 3, push(1), 1), 4));
  geometry.setAttribute(NORMAL_PORTLY_ATTRIBUTE, new THREE.Float32BufferAttribute(interleave(normalsOf(portlyRest), 3, push(3), 1), 4));
  geometry.setAttribute(PRINT_ATTRIBUTE, new THREE.Float32BufferAttribute(print.concat(wear.print), 4));
  geometry.setAttribute(BONES_ATTRIBUTE, new THREE.Float32BufferAttribute(interleave(bones.concat(wear.bones), 3, onBody, 1), 4));
  geometry.setAttribute(KINDS_ATTRIBUTE, new THREE.Float32BufferAttribute(interleave(kinds, 2, bust, 2), 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return { geometry, coarseWear: wear.coarse.map((vertex) => vertex + BODY_VERTICES) };
}

const dummy = once(buildDummy);

/** The one body every DummyMesh draws, built on first use and shared: only engine teardown disposes it. */
export const dummyGeometry = (): THREE.BufferGeometry => dummy().geometry;

/** Thigh and shin bones (`PARTS` 6-9): a seated driver's legs are under the dash, and so is the bare torso under the belt. */
const LEG_BONES = [LEFT_LEG, LEFT_LEG + 1, RIGHT_LEG, RIGHT_LEG + 1];
/** The vertices the seated driver's body keeps: about 0.9k triangles, the most of a seated figure's budget. */
const SEATED_BODY_VERTICES = 450;

/** The slot flags (`dressRow`) of every look a seated driver wears: a man or a woman, his clothes or a cop's, with a cap or a moustache or not (`driverLook`, `pickedLook`). */
function seatedFlags(): number[] {
  const row = new Float32Array(ROW_TEXELS * 4);
  const flags: number[] = [];
  for (const woman of [false, true]) for (const cop of [false, true]) for (const hat of [null, 0]) for (const mustache of [false, true]) {
    dressRow(row, 0, cop, { woman, shirt: 0, pants: 0, hair: 0, hat, mustache });
    flags.push(row[FLAGS_AT * 4]!);
  }
  return flags;
}

/**
 * `dummyGeometry` as a driver shows through the glass: its own attributes (dress, builds and pose rows as they are) under an index of the
 * triangles some seated driver's look wears, off the legs and above the belt, the body's decimated onto its own vertices (`decimate`), the wear's coarse loft.
 */
function buildSeatedGeometry(): THREE.BufferGeometry {
  const { geometry: full, coarseWear } = dummy();
  const index = full.index!.array;
  const bones = full.getAttribute(BONES_ATTRIBUTE);
  const kinds = full.getAttribute(KINDS_ATTRIBUTE);
  const rest = full.getAttribute("position");
  const worn = seatedFlags();
  const hidden = (v: number) => LEG_BONES.includes(bones.getX(v)) || LEG_BONES.includes(bones.getY(v)) || (bones.getY(v) === TORSO && bones.getX(v) === TORSO && rest.getY(v) < BELT_BOTTOM) || !worn.some((flags) => isDrawn(kinds.getY(v), flags));
  const shown = (triangles: ArrayLike<number>, to: number, into: number[]) => {
    for (let t = 0; t < to; t += 3) if (!hidden(triangles[t]!) && !hidden(triangles[t + 1]!) && !hidden(triangles[t + 2]!)) into.push(triangles[t]!, triangles[t + 1]!, triangles[t + 2]!);
    return into;
  };
  const body = shown(index, bodyIndex().length, []);
  const vertices = [...new Set(body)];
  const local = new Map(vertices.map((v, i) => [v, i]));
  // Weld groups by colour role, from 1: `decimate` pins group 0's nose and tail (a car body's).
  const group = Uint8Array.from(vertices, (v) => kinds.getX(v) + 1);
  const at = Float32Array.from(vertices.flatMap((v) => [rest.getX(v), rest.getY(v), rest.getZ(v)]));
  const { source, tris } = decimate(at, body.map((v) => local.get(v)!), group, SEATED_BODY_VERTICES);
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(full.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(shown(coarseWear, coarseWear.length, Array.from(tris, (k) => vertices[source[k]!]!)));
  return geometry;
}

/** The seated drivers' body (`SeatedDrivers`), built on first use and shared like `dummyGeometry`, whose attributes it draws. */
export const seatedGeometry = once(buildSeatedGeometry);

