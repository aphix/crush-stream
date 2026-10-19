import * as THREE from "three";
import { BODY_VERTICES, bodyIndex } from "./dummy-bodies.ts";
import { HAND_LENGTH, KNEE_HALF_BAND, restFits, RIG_KNEE_Y } from "./dummy-fit.ts";
import { FACE_FRONT_FROM, FACE_FRONT_TO, FACE_HALF_WIDTH, FACE_SPAN, headAt, measureHead, RIM_AT } from "./dummy-head.ts";
import { scalpHairline } from "./dummy-hair.ts";
import { loft, type Lofted } from "./dummy-loft.ts";
import { BONES_ATTRIBUTE, BUILD, EVERY_BUILD, HANG_ATTRIBUTE, HEAD, KINDS_ATTRIBUTE, LEFT_ARM, LEFT_LEG, NO_PRINT, NORMAL_PORTLY_ATTRIBUTE, NORMAL_WOMAN_ATTRIBUTE, PRINT_ATTRIBUTE, RIGHT_ARM, RIGHT_LEG, ROLE, SHAPE_PORTLY_ATTRIBUTE, SHAPE_WOMAN_ATTRIBUTE, smooth, TORSO, type Fit } from "./dummy-rig.ts";
import { hangAttribute } from "./dummy-garments.ts";
import { wearFor } from "./dummy-wear.ts";

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

/** The baked bodies, plus each build's wear lofted on after. One vertex order; three position attributes. */
export function dummyGeometry(): THREE.BufferGeometry {
  const { man, woman, portly } = restFits();
  const index = Array.from(bodyIndex());
  const { bones, roleKind, print } = paintBody(man);
  const wear: Lofted = { position: [], bones: [], roleKind: [], print: [], index: [] };
  for (const [build, fit] of [[BUILD.MAN, man], [BUILD.WOMAN, woman], [BUILD.PORTLY, portly]] as const) for (const shell of wearFor(build, fit)) loft(shell, wear);
  const geometry = new THREE.BufferGeometry();
  const withWear = (body: Float32Array) => {
    const all = new Float32Array(body.length + wear.position.length);
    all.set(body);
    all.set(wear.position, body.length);
    return all;
  };
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(withWear(man.rest), 3));
  geometry.setAttribute(SHAPE_WOMAN_ATTRIBUTE, new THREE.Float32BufferAttribute(withWear(woman.rest), 3));
  geometry.setAttribute(SHAPE_PORTLY_ATTRIBUTE, new THREE.Float32BufferAttribute(withWear(portly.rest), 3));
  geometry.setAttribute(PRINT_ATTRIBUTE, new THREE.Float32BufferAttribute(print.concat(wear.print), 4));
  geometry.setAttribute(BONES_ATTRIBUTE, new THREE.Float32BufferAttribute(bones.concat(wear.bones), 3));
  geometry.setAttribute(KINDS_ATTRIBUTE, new THREE.Float32BufferAttribute(roleKind.concat(wear.roleKind), 2));
  geometry.setAttribute(HANG_ATTRIBUTE, new THREE.Float32BufferAttribute(hangAttribute(man, portly, BODY_VERTICES + wear.position.length / 3), 4));
  for (const vertex of wear.index) index.push(vertex + BODY_VERTICES);
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normalsOf = (positions: Float32Array) => {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    shape.setIndex(index);
    shape.computeVertexNormals();
    return shape.getAttribute("normal");
  };
  geometry.setAttribute(NORMAL_WOMAN_ATTRIBUTE, normalsOf(withWear(woman.rest)));
  geometry.setAttribute(NORMAL_PORTLY_ATTRIBUTE, normalsOf(withWear(portly.rest)));
  return geometry;
}

