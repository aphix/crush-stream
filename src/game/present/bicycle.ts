import * as THREE from "three";
import { detAtan2, hypot2 } from "../kernel/physics-core.js";
import { MAT } from "../kernel/material-ids.ts";
import { once } from "../kernel/scalar.ts";
import { box, type Piece, type PrefabPart } from "./prefab-pieces.ts";

/**
 * The bicycle locked to the street's bike rack, in the rack's frame: its middle plane stands at x = `BIKE.lane`, forward is +z. A diamond frame of thin rods, tyres as rings and the
 * spokes as one alpha-cut sprite quad a wheel (a texture painted here, one material for every bicycle): the rods and rings are the plain part's, the sprites a second part.
 */

type Joint = readonly [x: number, y: number, z: number];
type Rod = { name: string; from: Joint; to: Joint; tubeRadius: number };

/** Metres: the middle plane's x, the axles' height and the wheels' distance from the middle (a 1.04 m wheelbase), a tyre's ring radius (a 26 inch wheel) and its tube's radius. */
const BIKE = { lane: 0.1, axleHeight: 0.34, axleOffset: 0.52, tyreRadius: 0.31, tyreTube: 0.022 } as const;

const COLOUR = { frame: 0xb3322b, tyre: 0x1a1a1a, steel: 0x7a8086, saddle: 0x222222, grip: 0x111111 } as const;
/** The tube the handlebar is: its grips' colour is not the frame's. */
const HANDLEBAR = "handlebar";

/** A tyre's tube is this many sides round and this many segments about: a ring that reads round at street level in 128 triangles. */
const TYRE_SIDES = 4;
const TYRE_SEGMENTS = 16;
/** A frame tube is a five-sided rod. */
const ROD_SIDES = 5;
/** The chainring's sides, and its radius and thickness (m). */
const RING_SIDES = 12;
const RING = { radius: 0.08, halfWidth: 0.01 } as const;

const onLane = (y: number, z: number, aside = 0): Joint => [BIKE.lane + aside, y, z];

/** Where the frame's tubes meet (m): the diamond is the bottom bracket, the seat cluster, the head tube's two ends and the rear axle. */
const JOINT = {
  rearAxle: onLane(BIKE.axleHeight, -BIKE.axleOffset),
  bottomBracket: onLane(0.29, -0.1),
  seat: onLane(0.79, -0.25),
  headTop: onLane(0.79, 0.28),
  headBottom: onLane(0.66, 0.31),
  frontAxle: onLane(BIKE.axleHeight, BIKE.axleOffset),
} as const;
/** The stays and the fork's blades stand this far (m) either side of the middle plane. */
const STAY_ASIDE = 0.045;
const SEAT_STAY_ASIDE = 0.03;
const FORK_ASIDE = 0.04;
/** The stem, the bars' height and half width, the seat post's top and the saddle's size (m). */
const STEM_TOP = onLane(0.9, 0.31);
const BAR = { height: 0.92, halfWidth: 0.23, z: 0.31 } as const;
const POST_TOP = onLane(0.86, -0.27);
const SADDLE = { along: 0.26, across: 0.1, thick: 0.035, height: 0.88, z: -0.28 } as const;
const PEDAL = { x: 0.12, low: 0.2, high: 0.38, z: -0.1, size: [0.09, 0.015, 0.06] } as const;

/** Every tube of the frame, the fork, the stem, the bars and the seat post: name, ends, radius (m). */
const BIKE_RODS: readonly Rod[] = [
  { name: "top tube", from: JOINT.seat, to: JOINT.headTop, tubeRadius: 0.016 },
  { name: "down tube", from: JOINT.bottomBracket, to: JOINT.headBottom, tubeRadius: 0.018 },
  { name: "seat tube", from: JOINT.bottomBracket, to: JOINT.seat, tubeRadius: 0.016 },
  { name: "head tube", from: JOINT.headBottom, to: JOINT.headTop, tubeRadius: 0.02 },
  ...[-1, 1].map((side): Rod => ({ name: "chain stay", from: onLane(JOINT.bottomBracket[1], JOINT.bottomBracket[2], side * STAY_ASIDE), to: onLane(JOINT.rearAxle[1], JOINT.rearAxle[2], side * STAY_ASIDE), tubeRadius: 0.011 })),
  ...[-1, 1].map((side): Rod => ({ name: "seat stay", from: onLane(JOINT.seat[1], JOINT.seat[2], side * SEAT_STAY_ASIDE), to: onLane(JOINT.rearAxle[1], JOINT.rearAxle[2], side * STAY_ASIDE), tubeRadius: 0.01 })),
  ...[-1, 1].map((side): Rod => ({ name: "fork", from: onLane(JOINT.headBottom[1], JOINT.headBottom[2], side * FORK_ASIDE), to: onLane(JOINT.frontAxle[1], JOINT.frontAxle[2], side * FORK_ASIDE), tubeRadius: 0.012 })),
  { name: "stem", from: JOINT.headTop, to: STEM_TOP, tubeRadius: 0.014 },
  { name: HANDLEBAR, from: onLane(BAR.height, BAR.z, -BAR.halfWidth), to: onLane(BAR.height, BAR.z, BAR.halfWidth), tubeRadius: 0.012 },
  { name: "seat post", from: JOINT.seat, to: POST_TOP, tubeRadius: 0.014 },
];

/** An open five-sided rod of `radius` from `from` to `to`. */
function rodGeometry({ from, to, tubeRadius }: Rod): THREE.BufferGeometry {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const geometry = new THREE.CylinderGeometry(tubeRadius, tubeRadius, start.distanceTo(end), ROD_SIDES, 1, true);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize()));
  return geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
}

/** A tyre, a ring (not a disc) in the plane x = `BIKE.lane`, round the axle `z` m along. */
function tyreGeometry(z: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(BIKE.tyreRadius, BIKE.tyreTube, TYRE_SIDES, TYRE_SEGMENTS).rotateY(Math.PI / 2).translate(BIKE.lane, BIKE.axleHeight, z);
}

/** The frame, the tyres, the saddle, the chainring and the pedals as pieces of the plain part. */
export function bicyclePieces(): Piece[] {
  const pieces: Piece[] = BIKE_RODS.map((rod): Piece => [rodGeometry(rod), rod.name === HANDLEBAR ? COLOUR.grip : COLOUR.frame, MAT.BRACKET_STEEL]);
  for (const z of [-BIKE.axleOffset, BIKE.axleOffset]) pieces.push([tyreGeometry(z), COLOUR.tyre, MAT.TYRE]);
  pieces.push(
    [box(SADDLE.across, SADDLE.thick, SADDLE.along, BIKE.lane, SADDLE.height, SADDLE.z), COLOUR.saddle, MAT.RUBBER_SEAL],
    [new THREE.CylinderGeometry(RING.radius, RING.radius, 2 * RING.halfWidth, RING_SIDES).rotateZ(Math.PI / 2).translate(BIKE.lane - STAY_ASIDE, JOINT.bottomBracket[1], JOINT.bottomBracket[2]), COLOUR.steel, MAT.BRACKET_STEEL],
    [box(PEDAL.size[0], PEDAL.size[1], PEDAL.size[2], BIKE.lane - PEDAL.x, PEDAL.low, PEDAL.z), COLOUR.grip, MAT.RUBBER_SEAL],
    [box(PEDAL.size[0], PEDAL.size[1], PEDAL.size[2], BIKE.lane + PEDAL.x, PEDAL.high, PEDAL.z), COLOUR.grip, MAT.RUBBER_SEAL],
  );
  return pieces;
}

/** The sprite's texels a side, its spokes, the share of its radius the hub and the rim's ring take, and a spoke's half width and the edge's softness in texels. */
const SPOKE_TEXELS = 128;
const SPOKES = 18;
const HUB = 0.12;
const RIM_FROM = 0.9;
const SPOKE_HALF_TEXELS = 0.45;
const SPOKE_SOFT_TEXELS = 0.9;
const SPOKE_COLOUR = [208, 211, 214] as const;
const HUB_COLOUR = [107, 112, 117] as const;
const RIM_COLOUR = [154, 160, 166] as const;
const ALPHA_CUTOFF = 0.5;
const SPOKE_ANISOTROPY = 4;

/** The spokes' texture: a hub, `SPOKES` spokes and a rim ring, opaque on air, painted from arithmetic (no canvas). Its alpha cuts the sprite; mip levels thin the spokes with distance. */
const spokeTexture = once((): THREE.DataTexture => {
  const data = new Uint8Array(SPOKE_TEXELS * SPOKE_TEXELS * 4);
  const half = SPOKE_TEXELS / 2;
  const step = (2 * Math.PI) / SPOKES;
  for (let row = 0; row < SPOKE_TEXELS; row++) {
    for (let column = 0; column < SPOKE_TEXELS; column++) {
      const x = (column + 0.5 - half) / half;
      const y = (row + 0.5 - half) / half;
      const radius = hypot2(x, y);
      const phase = ((detAtan2(y, x) % step) + step) % step;
      const offTexels = radius * half * Math.sin(Math.min(phase, step - phase));
      const onSpoke = radius > HUB && radius < RIM_FROM ? Math.min(1, Math.max(0, 1 - (offTexels - SPOKE_HALF_TEXELS) / SPOKE_SOFT_TEXELS)) : 0;
      const isHub = radius <= HUB;
      const isRim = radius >= RIM_FROM && radius <= 1;
      const colour = isHub ? HUB_COLOUR : isRim ? RIM_COLOUR : SPOKE_COLOUR;
      const alpha = isHub || isRim ? 1 : onSpoke;
      data.set([colour[0], colour[1], colour[2], Math.round(alpha * 255)], (row * SPOKE_TEXELS + column) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, SPOKE_TEXELS, SPOKE_TEXELS, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = SPOKE_ANISOTROPY;
  texture.needsUpdate = true;
  return texture;
});

/** The two wheels' spokes: a quad each in its wheel's plane, its edge on the tyre's inner face. */
function spokeQuads(): THREE.BufferGeometry {
  const half = BIKE.tyreRadius - BIKE.tyreTube / 2;
  const quads = [-BIKE.axleOffset, BIKE.axleOffset].map((z) => new THREE.PlaneGeometry(2 * half, 2 * half).rotateY(Math.PI / 2).translate(BIKE.lane, BIKE.axleHeight, z));
  const merged = new THREE.BufferGeometry();
  const count = quads.length * 4;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index: number[] = [];
  for (const [n, quad] of quads.entries()) {
    position.set(quad.getAttribute("position").array, n * 12);
    normal.set(quad.getAttribute("normal").array, n * 12);
    uv.set(quad.getAttribute("uv").array, n * 8);
    index.push(...Array.from(quad.getIndex()!.array, (at) => at + n * 4));
    quad.dispose();
  }
  merged.setAttribute("position", new THREE.BufferAttribute(position, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  merged.setIndex(index);
  return merged;
}

/** The bicycle's second part: both wheels' spokes on one alpha-cut, double-sided sprite material (it casts no shadow: a sprite's depth shadow is its whole rectangle). */
export function spokePart(): PrefabPart {
  const material = new THREE.MeshStandardMaterial({ map: spokeTexture(), alphaTest: ALPHA_CUTOFF, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  return { geometry: spokeQuads(), material, shared: false, shadow: false };
}
