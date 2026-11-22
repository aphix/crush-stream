import * as THREE from "three";
import { SPECIES } from "../ai/civilians/civilian-constants.ts";

/**
 * The open world's cats and dogs: one flat-shaded low-poly quadruped per species (boxes for the body, head, ears, tail and four legs with paws), instanced, its legs swung and its body sat or laid down in
 * the vertex shader from a pose per instance. `animalPoint` (`animal-figure.test-util.ts`) is the shader's arithmetic in TypeScript, so a test can check what the GPU draws.
 */

/** Which part a vertex belongs to: the legs swing and fold about their tops, the rest rides the body. */
export const PART = { body: 0, head: 1, tail: 2, frontLeft: 3, frontRight: 4, hindLeft: 5, hindRight: 6 } as const;
/** Which colour a vertex takes: the instance's coat, its accent (paws, muzzle), or the dark of a nose. */
const ROLE = { coat: 0, accent: 1, dark: 2 } as const;

/** A quadruped's build (m): leg length (the hip's height), body, head, ears, snout and tail; `stride` the metres of one whole stride (both pairs of legs) at a walk. */
export type AnimalShape = {
  leg: number;
  legHalf: number;
  legX: number;
  legZ: number;
  bodyLength: number;
  bodyHalfWidth: number;
  bodyHalfHeight: number;
  headHalf: number;
  earHalf: number;
  earHeight: number;
  floppyEars: boolean;
  snout: number;
  tailLength: number;
  tailHalf: number;
  tailLift: number;
  stride: number;
};

/** A domestic cat (~46 cm of body, ~25 cm at the shoulder, ~0.5 m a stride) and a medium dog (~62 cm of body, ~50 cm at the shoulder, ~0.9 m a stride): tuned by feel on those sizes. */
export const ANIMAL_SHAPES: Readonly<Record<number, AnimalShape>> = {
  [SPECIES.cat]: { leg: 0.17, legHalf: 0.022, legX: 0.045, legZ: 0.15, bodyLength: 0.42, bodyHalfWidth: 0.07, bodyHalfHeight: 0.07, headHalf: 0.06, earHalf: 0.022, earHeight: 0.05, floppyEars: false, snout: 0, tailLength: 0.28, tailHalf: 0.015, tailLift: 1, stride: 0.5 },
  [SPECIES.dog]: { leg: 0.3, legHalf: 0.035, legX: 0.07, legZ: 0.22, bodyLength: 0.62, bodyHalfWidth: 0.11, bodyHalfHeight: 0.1, headHalf: 0.08, earHalf: 0.035, earHeight: 0.1, floppyEars: true, snout: 0.12, tailLength: 0.3, tailHalf: 0.02, tailLift: 0.6, stride: 0.9 },
};

/** A leg's swing either way at a full walk (rad), and the folds (rad) that sit the hind legs under the haunch and stretch the legs out lying down: tuned by feel. */
export const LEG_SWING = 0.5;
export const SIT_HIND_FOLD = -1.4;
export const LIE_FRONT_FOLD = -1.45;
export const LIE_HIND_FOLD = 1.3;
/** A paw's height (m): the leg's lowest box, in the accent colour. */
const PAW_HEIGHT = 0.03;
const NOSE_HALF = 0.014;
/** The darkest of a coat, for noses (sRGB). */
const NOSE_COLOUR = 0x141414;

/** How far the body pitches up when sitting (rad, about the front legs' tops): the haunch comes down to the ground. */
export function sitPitchOf(shape: AnimalShape): number {
  return Math.asin((shape.leg - shape.legHalf) / (2 * shape.legZ));
}

const _out = new THREE.Vector3();

/** About the x axis by `angle`, around (y, z) = (`pivotY`, `pivotZ`), in place. */
export function turnAboutX(point: THREE.Vector3, angle: number, pivotY: number, pivotZ: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dy = point.y - pivotY;
  const dz = point.z - pivotZ;
  point.y = pivotY + dy * c - dz * s;
  point.z = pivotZ + dy * s + dz * c;
}

type Box = { x: number; y: number; z: number; hx: number; hy: number; hz: number; part: number; role: number; pivotY?: number; pivotZ?: number; topScale?: number; tilt?: number };
type Buffers = { position: number[]; normal: number[]; rig: number[] };

/** Each face's corners (index = x bit + 2 y bit + 4 z bit), counter-clockwise seen from outside. */
const BOX_FACES = [
  [1, 3, 7, 5],
  [0, 4, 6, 2],
  [2, 6, 7, 3],
  [0, 1, 5, 4],
  [4, 5, 7, 6],
  [0, 2, 3, 1],
] as const;
const QUAD_TRIANGLES = [0, 1, 2, 0, 2, 3] as const;
const CORNERS = 8;

/** A box of `box`'s half sizes about its middle, its top ring scaled by `topScale` (an ear's point) and the whole turned by `tilt` about x through its back bottom (a tail's lift); flat normals. */
function addBox(into: Buffers, box: Box): void {
  const corners = Array.from({ length: CORNERS }, (_, corner) => {
    const top = (corner & 2) !== 0;
    const scale = top ? (box.topScale ?? 1) : 1;
    const point = new THREE.Vector3((corner & 1 ? 1 : -1) * box.hx * scale, (top ? 1 : -1) * box.hy, (corner & 4 ? 1 : -1) * box.hz * scale);
    if (box.tilt !== undefined) turnAboutX(point, box.tilt, -box.hy, -box.hz);
    return point.add(_out.set(box.x, box.y, box.z));
  });
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const face of BOX_FACES) {
    const normal = a.subVectors(corners[face[1]]!, corners[face[0]]!).cross(b.subVectors(corners[face[2]]!, corners[face[0]]!)).normalize().clone();
    for (const at of QUAD_TRIANGLES) {
      corners[face[at]]!.toArray(into.position, into.position.length);
      normal.toArray(into.normal, into.normal.length);
      into.rig.push(box.part, box.role, box.pivotY ?? 0, box.pivotZ ?? 0);
    }
  }
}

/** The legs, each with its paw, pivoting at the body's underside. */
function addLegs(into: Buffers, shape: AnimalShape): void {
  const legs = [
    [PART.frontLeft, -1, 1],
    [PART.frontRight, 1, 1],
    [PART.hindLeft, -1, -1],
    [PART.hindRight, 1, -1],
  ] as const;
  for (const [part, side, end] of legs) {
    const x = side * shape.legX;
    const z = end * shape.legZ;
    const pivot = { part, pivotY: shape.leg, pivotZ: z };
    const upper = shape.leg - PAW_HEIGHT;
    addBox(into, { x, y: PAW_HEIGHT + upper / 2, z, hx: shape.legHalf, hy: upper / 2, hz: shape.legHalf, role: ROLE.coat, ...pivot });
    addBox(into, { x, y: PAW_HEIGHT / 2, z: z + shape.legHalf * 0.3, hx: shape.legHalf * 1.1, hy: PAW_HEIGHT / 2, hz: shape.legHalf * 1.3, role: ROLE.accent, ...pivot });
  }
}

function animalVertices(shape: AnimalShape): Buffers {
  const into: Buffers = { position: [], normal: [], rig: [] };
  const bodyY = shape.leg + shape.bodyHalfHeight;
  const bodyTop = bodyY + shape.bodyHalfHeight;
  const front = shape.bodyLength / 2;
  addBox(into, { x: 0, y: bodyY, z: 0, hx: shape.bodyHalfWidth, hy: shape.bodyHalfHeight, hz: front, part: PART.body, role: ROLE.coat });
  const headY = bodyTop + shape.headHalf * 0.3;
  const headZ = front + shape.headHalf * 0.6;
  addBox(into, { x: 0, y: headY, z: headZ, hx: shape.headHalf, hy: shape.headHalf, hz: shape.headHalf, part: PART.head, role: ROLE.coat });
  const muzzleZ = headZ + shape.headHalf + shape.snout / 2;
  if (shape.snout > 0) addBox(into, { x: 0, y: headY - shape.headHalf * 0.4, z: muzzleZ, hx: shape.headHalf * 0.5, hy: shape.headHalf * 0.45, hz: shape.snout / 2, part: PART.head, role: ROLE.accent });
  const noseZ = shape.snout > 0 ? muzzleZ + shape.snout / 2 : headZ + shape.headHalf;
  addBox(into, { x: 0, y: headY - (shape.snout > 0 ? shape.headHalf * 0.2 : shape.headHalf * 0.3), z: noseZ, hx: NOSE_HALF, hy: NOSE_HALF, hz: NOSE_HALF, part: PART.head, role: ROLE.dark });
  for (const side of [-1, 1]) {
    if (shape.floppyEars) addBox(into, { x: side * (shape.headHalf + shape.earHalf * 0.5), y: headY - shape.earHeight * 0.2, z: headZ, hx: shape.earHalf * 0.5, hy: shape.earHeight / 2, hz: shape.earHalf, part: PART.head, role: ROLE.coat });
    else addBox(into, { x: side * shape.headHalf * 0.55, y: headY + shape.headHalf + shape.earHeight / 2, z: headZ, hx: shape.earHalf, hy: shape.earHeight / 2, hz: shape.earHalf * 0.6, part: PART.head, role: ROLE.coat, topScale: 0.15 });
  }
  addBox(into, { x: 0, y: bodyTop - shape.tailHalf * 2, z: -front - shape.tailLength / 2, hx: shape.tailHalf, hy: shape.tailHalf, hz: shape.tailLength / 2, part: PART.tail, role: ROLE.coat, tilt: -shape.tailLift });
  addLegs(into, shape);
  return into;
}

/** The vertex attribute of each vertex's part, role and leg pivot (y, z). */
export const ANIMAL_RIG = "animalRig";
/** The instance attributes: pose (phase, gait, sit, lie), coat and accent colours (linear). */
const ANIMAL_POSE = "animalPose";
const ANIMAL_COAT = "animalCoat";
const ANIMAL_ACCENT = "animalAccent";
export const POSE_FLOATS = 4;
export const COLOUR_FLOATS = 3;
export const MATRIX_FLOATS = 16;

/** The figure of `species` (`SPECIES.cat` or `dog`) at rest, standing, +z forward, its feet on y = 0. */
export function animalGeometry(species: number): THREE.BufferGeometry {
  const buffers = animalVertices(ANIMAL_SHAPES[species]!);
  return new THREE.BufferGeometry()
    .setAttribute("position", new THREE.Float32BufferAttribute(buffers.position, 3))
    .setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normal, 3))
    .setAttribute(ANIMAL_RIG, new THREE.Float32BufferAttribute(buffers.rig, 4));
}

/** `animalPoint` in GLSL, the same turns in the same order (a test of the TypeScript checks what is drawn): the turn, then the leg's and the body's angles, read before the normal and the position are posed. */
const ANIMAL_TURN = /* glsl */ `
vec2 animalTurn(vec2 yz, float angle, vec2 pivot) {
  vec2 d = yz - pivot;
  return pivot + vec2(d.x * cos(angle) - d.y * sin(angle), d.x * sin(angle) + d.y * cos(angle));
}`;
const ANIMAL_ANGLES = /* glsl */ `
float animalPart = ${ANIMAL_RIG}.x;
float animalRest = max(${ANIMAL_POSE}.z, ${ANIMAL_POSE}.w);
float animalDiagonal = (abs(animalPart - ${PART.frontLeft}.0) < 0.5 || abs(animalPart - ${PART.hindRight}.0) < 0.5) ? 1.0 : -1.0;
float animalFront = step(animalPart, ${PART.frontRight}.5);
float animalLeg = step(${PART.frontLeft}.0 - 0.5, animalPart) * (animalDiagonal * ${ANIMAL_POSE}.y * ${LEG_SWING.toFixed(3)} * sin(${ANIMAL_POSE}.x) * (1.0 - animalRest)
  + animalFront * ${ANIMAL_POSE}.w * ${LIE_FRONT_FOLD.toFixed(3)} + (1.0 - animalFront) * (${ANIMAL_POSE}.z * ${SIT_HIND_FOLD.toFixed(3)} + ${ANIMAL_POSE}.w * ${LIE_HIND_FOLD.toFixed(3)}));
float animalBody = (abs(animalPart - ${PART.frontLeft}.0) < 0.5 || abs(animalPart - ${PART.frontRight}.0) < 0.5) ? 0.0 : -${ANIMAL_POSE}.z * animalShape.x;`;

/** Standard lighting, each vertex coloured by its role from the instance's coat, its legs and body posed by the instance's pose (`animalShape`: the sitting pitch, the lying drop, the shoulder's y and z). */
function animalMaterial(shape: AnimalShape): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const nose = new THREE.Color(NOSE_COLOUR);
  const shapeUniform = { value: new THREE.Vector4(sitPitchOf(shape), shape.leg - shape.legHalf, shape.leg, shape.legZ) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.animalShape = shapeUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform vec4 animalShape;\nattribute vec4 ${ANIMAL_RIG};\nattribute vec4 ${ANIMAL_POSE};\nattribute vec3 ${ANIMAL_COAT};\nattribute vec3 ${ANIMAL_ACCENT};\nvarying vec3 vAnimalColour;${ANIMAL_TURN}`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `${ANIMAL_ANGLES}
#include <beginnormal_vertex>
objectNormal.yz = animalTurn(objectNormal.yz, animalLeg, vec2(0.0));
objectNormal.yz = animalTurn(objectNormal.yz, animalBody, vec2(0.0));`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
transformed.yz = animalTurn(transformed.yz, animalLeg, ${ANIMAL_RIG}.zw);
transformed.yz = animalTurn(transformed.yz, animalBody, animalShape.zw);
transformed.y -= ${ANIMAL_POSE}.w * animalShape.y;
vAnimalColour = ${ANIMAL_RIG}.y < ${ROLE.coat}.5 ? ${ANIMAL_COAT} : ${ANIMAL_RIG}.y < ${ROLE.accent}.5 ? ${ANIMAL_ACCENT} : vec3(${nose.r.toFixed(5)}, ${nose.g.toFixed(5)}, ${nose.b.toFixed(5)});`,
      );
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vAnimalColour;").replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vAnimalColour;");
  };
  material.customProgramCacheKey = () => "animal-figure";
  return material;
}

/** One species' draw and the buffers its caller rewrites each frame (matrix, pose, coat, accent): `uploads` are the attributes to flag after a rewrite. */
export type AnimalFigures = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  matrices: Float32Array;
  poses: Float32Array;
  coats: Float32Array;
  accents: Float32Array;
  uploads: readonly THREE.InstancedBufferAttribute[];
};

function instanceBuffer(capacity: number, floats: number): { array: Float32Array; attribute: THREE.InstancedBufferAttribute } {
  const array = new Float32Array(capacity * floats);
  return { array, attribute: new THREE.InstancedBufferAttribute(array, floats).setUsage(THREE.DynamicDrawUsage) };
}

/** The names of the cats' and dogs' instanced meshes: the hook's sight line passes them, as it passes the crowd's far figures. */
export const ANIMAL_MESH_NAMES = { cat: "openworld-cats", dog: "openworld-dogs" } as const;

/** `capacity` figures of `species` in one draw, none shown yet. */
export function animalFigures(species: number, capacity: number): AnimalFigures {
  const geometry = animalGeometry(species);
  const mesh = new THREE.InstancedMesh(geometry, animalMaterial(ANIMAL_SHAPES[species]!), capacity);
  const matrices = instanceBuffer(capacity, MATRIX_FLOATS);
  const poses = instanceBuffer(capacity, POSE_FLOATS);
  const coats = instanceBuffer(capacity, COLOUR_FLOATS);
  const accents = instanceBuffer(capacity, COLOUR_FLOATS);
  mesh.instanceMatrix = matrices.attribute;
  geometry.setAttribute(ANIMAL_POSE, poses.attribute).setAttribute(ANIMAL_COAT, coats.attribute).setAttribute(ANIMAL_ACCENT, accents.attribute);
  mesh.name = species === SPECIES.cat ? ANIMAL_MESH_NAMES.cat : ANIMAL_MESH_NAMES.dog;
  mesh.frustumCulled = false;
  // The sun's depth pass would draw the unposed figure (a sitting cat's shadow standing): no shadow, as the far figures.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.count = 0;
  mesh.visible = false;
  return { mesh, matrices: matrices.array, poses: poses.array, coats: coats.array, accents: accents.array, uploads: [matrices.attribute, poses.attribute, coats.attribute, accents.attribute] };
}
