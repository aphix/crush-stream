import * as THREE from "three";
import { FIGURE_ATTRIBUTE, FIGURE_DARK, FIGURE_FLOATS, FIGURE_HAIR, FIGURE_HAND, FIGURE_ROLE, FIGURE_SHOULDER_FLARE, FIGURE_TAPER } from "./civilian-art-constants.ts";
import { writeLinearColour } from "./civilian-dress.ts";
import { blankStance, walkStance } from "./people.ts";
import { JOINTS, PARTS, SHOULDER_Y } from "./ragdoll-body.ts";

/** A tapered box standing on `bottomY` up to `topY` about (x, z): the far figure's one shape. */
type Frustum = {
  x: number;
  z: number;
  bottomY: number;
  topY: number;
  bottomHalfX: number;
  bottomHalfZ: number;
  topHalfX: number;
  topHalfZ: number;
  role: number;
  swing: number;
  pivotY: number;
};

const CORNER_COUNT = 8;
/** A frustum's corners: its bottom ring then its top ring, each from (-x, -z) round to (-x, +z). */
const CORNER_SIGNS = [
  [-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
] as const;
/** Its faces (+z, -z, +x, -x, top, bottom) by corner, each wound counter-clockwise seen from outside. */
const FACES = [
  [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4], [7, 6, 5, 4], [0, 1, 2, 3],
] as const;
const QUAD_TRIANGLES = [[0, 1, 2], [0, 2, 3]] as const;
const LEFT_SIDE = 1;
const SWING_PHASE_AT_WIDEST = Math.PI / 2;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _corners = Array.from({ length: CORNER_COUNT }, () => new THREE.Vector3());

type FigureVertices = { position: number[]; normal: number[]; rig: number[] };

function addFrustum(into: FigureVertices, part: Frustum): void {
  for (let corner = 0; corner < CORNER_COUNT; corner++) {
    const [signX, signZ, top] = CORNER_SIGNS[corner]!;
    _corners[corner]!.set(part.x + signX * (top ? part.topHalfX : part.bottomHalfX), top ? part.topY : part.bottomY, part.z + signZ * (top ? part.topHalfZ : part.bottomHalfZ));
  }
  for (const face of FACES) {
    _a.subVectors(_corners[face[1]]!, _corners[face[0]]!);
    _b.subVectors(_corners[face[2]]!, _corners[face[0]]!);
    _c.crossVectors(_a, _b).normalize();
    for (const triangle of QUAD_TRIANGLES) {
      for (const vertex of triangle) {
        _corners[face[vertex]!]!.toArray(into.position, into.position.length);
        _c.toArray(into.normal, into.normal.length);
        into.rig.push(part.role, part.swing, part.pivotY);
      }
    }
  }
}

/** Both sides' limbs: a leg and its shoe from the hip, an arm and its hand from the shoulder, swung as `walkStance` swings the dummy's. */
function addLimbs(into: FigureVertices): void {
  const widestStride = walkStance(SWING_PHASE_AT_WIDEST, false, blankStance());
  const hipY = JOINTS[5][3];
  const ankleY = JOINTS[9][3];
  const thigh = PARTS[6];
  const foot = PARTS[10];
  const upperArm = PARTS[2];
  const forearmEndY = PARTS[3].c[1] - PARTS[3].h[1];
  for (let side = 0; side <= LEFT_SIDE; side++) {
    const sign = side * 2 - 1;
    const legX = sign * Math.abs(thigh.c[0]);
    const armX = sign * Math.abs(upperArm.c[0]);
    const leg = { swing: widestStride.thigh[side]!, pivotY: hipY };
    const arm = { swing: widestStride.arm[side]!, pivotY: SHOULDER_Y };
    addFrustum(into, { x: legX, z: 0, bottomY: ankleY, topY: hipY, bottomHalfX: thigh.h[0] * FIGURE_TAPER.leg, bottomHalfZ: thigh.h[2] * FIGURE_TAPER.leg, topHalfX: thigh.h[0], topHalfZ: thigh.h[2], role: FIGURE_ROLE.TROUSERS, ...leg });
    addFrustum(into, { x: legX, z: foot.c[2], bottomY: foot.c[1] - foot.h[1], topY: foot.c[1] + foot.h[1], bottomHalfX: foot.h[0], bottomHalfZ: foot.h[2], topHalfX: foot.h[0], topHalfZ: foot.h[2], role: FIGURE_ROLE.DARK, ...leg });
    addFrustum(into, { x: armX, z: 0, bottomY: forearmEndY, topY: SHOULDER_Y, bottomHalfX: upperArm.h[0] * FIGURE_TAPER.arm, bottomHalfZ: upperArm.h[2] * FIGURE_TAPER.arm, topHalfX: upperArm.h[0], topHalfZ: upperArm.h[2], role: FIGURE_ROLE.SHIRT, ...arm });
    addFrustum(into, { x: armX, z: 0, bottomY: forearmEndY - FIGURE_HAND.length, topY: forearmEndY, bottomHalfX: FIGURE_HAND.half, bottomHalfZ: FIGURE_HAND.half, topHalfX: FIGURE_HAND.half, topHalfZ: FIGURE_HAND.half, role: FIGURE_ROLE.SKIN, ...arm });
  }
}

/** The torso, head and hair, standing still, then the limbs. */
function figureVertices(): FigureVertices {
  const into: FigureVertices = { position: [], normal: [], rig: [] };
  const torso = PARTS[0];
  const head = PARTS[1];
  const still = { swing: 0, pivotY: 0 };
  addFrustum(into, { x: 0, z: 0, bottomY: torso.c[1] - torso.h[1], topY: torso.c[1] + torso.h[1], bottomHalfX: torso.h[0] - FIGURE_SHOULDER_FLARE, bottomHalfZ: torso.h[2], topHalfX: torso.h[0] + FIGURE_SHOULDER_FLARE, topHalfZ: torso.h[2], role: FIGURE_ROLE.SHIRT, ...still });
  addFrustum(into, { x: 0, z: 0, bottomY: head.c[1] - head.h[1], topY: head.c[1] + head.h[1], bottomHalfX: head.h[0] * FIGURE_TAPER.head, bottomHalfZ: head.h[2] * FIGURE_TAPER.head, topHalfX: head.h[0], topHalfZ: head.h[2], role: FIGURE_ROLE.SKIN, ...still });
  const hairBottom = head.c[1] + head.h[1] - FIGURE_HAIR.rise;
  addFrustum(into, { x: 0, z: 0, bottomY: hairBottom, topY: head.c[1] + head.h[1] + FIGURE_HAIR.margin, bottomHalfX: head.h[0] + FIGURE_HAIR.margin, bottomHalfZ: head.h[2] + FIGURE_HAIR.margin, topHalfX: head.h[0] + FIGURE_HAIR.margin, topHalfZ: head.h[2] + FIGURE_HAIR.margin, role: FIGURE_ROLE.DARK, ...still });
  addLimbs(into);
  return into;
}

/** The far figure: one flat-shaded low-poly person, its vertices tagged with the role (which colour), the swing (rad at the widest stride) and the pivot height of the limb they belong to. */
export function civilianFigureGeometry(): THREE.BufferGeometry {
  const buffers = figureVertices();
  return new THREE.BufferGeometry()
    .setAttribute("position", new THREE.Float32BufferAttribute(buffers.position, 3))
    .setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normal, 3))
    .setAttribute(FIGURE_ATTRIBUTE.RIG, new THREE.Float32BufferAttribute(buffers.rig, 3));
}

/** The dark brown of hair and shoes as linear GLSL floats. */
function darkColourLiteral(): string {
  const linear = new Float32Array(FIGURE_FLOATS.COLOUR);
  writeLinearColour(FIGURE_DARK, linear, 0);
  return `vec3(${linear[0]!.toFixed(5)}, ${linear[1]!.toFixed(5)}, ${linear[2]!.toFixed(5)})`;
}

const SWING_VERTEX = /* glsl */ `
float swingAngle = ${FIGURE_ATTRIBUTE.RIG}.y * ${FIGURE_ATTRIBUTE.GAIT}.y * sin(${FIGURE_ATTRIBUTE.GAIT}.x);
float swingCos = cos(swingAngle);
float swingSin = sin(swingAngle);`;

/** Standard lighting, coloured per vertex role from the instance's shirt (`instanceColor`), trousers and skin, each limb swung about its pivot by the instance's walk phase. */
function civilianFigureMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 ${FIGURE_ATTRIBUTE.RIG};
attribute vec3 ${FIGURE_ATTRIBUTE.TROUSERS};
attribute vec3 ${FIGURE_ATTRIBUTE.SKIN};
attribute vec2 ${FIGURE_ATTRIBUTE.GAIT};
varying vec3 vFigureColour;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
${SWING_VERTEX}
objectNormal = vec3(objectNormal.x, objectNormal.y * swingCos - objectNormal.z * swingSin, objectNormal.z * swingCos + objectNormal.y * swingSin);`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float fromPivot = transformed.y - ${FIGURE_ATTRIBUTE.RIG}.z;
transformed = vec3(transformed.x, ${FIGURE_ATTRIBUTE.RIG}.z + fromPivot * swingCos - transformed.z * swingSin, transformed.z * swingCos + fromPivot * swingSin);
vFigureColour = ${FIGURE_ATTRIBUTE.RIG}.x < ${FIGURE_ROLE.SKIN + 0.5} ? ${FIGURE_ATTRIBUTE.SKIN} : ${FIGURE_ATTRIBUTE.RIG}.x < ${FIGURE_ROLE.SHIRT + 0.5} ? instanceColor : ${FIGURE_ATTRIBUTE.RIG}.x < ${FIGURE_ROLE.TROUSERS + 0.5} ? ${FIGURE_ATTRIBUTE.TROUSERS} : ${darkColourLiteral()};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFigureColour;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vFigureColour;");
  };
  material.customProgramCacheKey = () => "civilian-figure";
  return material;
}

/** One per-instance buffer: its floats, and the attribute that uploads them. */
function instanceBuffer(capacity: number, floatsPerInstance: number): { array: Float32Array; attribute: THREE.InstancedBufferAttribute } {
  const array = new Float32Array(capacity * floatsPerInstance);
  return { array, attribute: new THREE.InstancedBufferAttribute(array, floatsPerInstance).setUsage(THREE.DynamicDrawUsage) };
}

/** The far figures' draw and the buffers its caller rewrites each frame (matrix, shirt, trousers, skin, gait), sized for the crowd; `uploads` are the attributes to flag after a rewrite. */
export type CivilianFigures = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  matrices: Float32Array;
  shirts: Float32Array;
  trousers: Float32Array;
  skins: Float32Array;
  gaits: Float32Array;
  uploads: readonly THREE.InstancedBufferAttribute[];
};

/** `capacity` far figures in one draw, none shown yet. */
export function civilianFigures(capacity: number): CivilianFigures {
  const geometry = civilianFigureGeometry();
  const mesh = new THREE.InstancedMesh(geometry, civilianFigureMaterial(), capacity);
  const matrices = instanceBuffer(capacity, FIGURE_FLOATS.MATRIX);
  const shirts = instanceBuffer(capacity, FIGURE_FLOATS.COLOUR);
  const trousers = instanceBuffer(capacity, FIGURE_FLOATS.COLOUR);
  const skins = instanceBuffer(capacity, FIGURE_FLOATS.COLOUR);
  const gaits = instanceBuffer(capacity, FIGURE_FLOATS.GAIT);
  mesh.instanceMatrix = matrices.attribute;
  mesh.instanceColor = shirts.attribute;
  geometry.setAttribute(FIGURE_ATTRIBUTE.TROUSERS, trousers.attribute).setAttribute(FIGURE_ATTRIBUTE.SKIN, skins.attribute).setAttribute(FIGURE_ATTRIBUTE.GAIT, gaits.attribute);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.count = 0;
  return {
    mesh,
    matrices: matrices.array,
    shirts: shirts.array,
    trousers: trousers.array,
    skins: skins.array,
    gaits: gaits.array,
    uploads: [matrices.attribute, shirts.attribute, trousers.attribute, skins.attribute, gaits.attribute],
  };
}
