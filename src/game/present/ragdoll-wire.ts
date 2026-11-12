import * as THREE from "three";
import type { TrackJson } from "../world/track-schema.ts";
import type { SceneryArm } from "../world/constants.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { PARTS } from "./ragdoll-body.ts";
import type { FloorBox } from "./walker-floor.ts";

const _push = new THREE.Vector3();
const _inverse = new THREE.Quaternion();

/**
 * What the main thread and the dummies' world (a Web Worker, `ragdoll-worker.ts`) say to each other. The world's answer to
 * frame `n` that the sim cares about (a pane a torso struck, the cars it wants fitted) is held until the main thread posts
 * frame `n + LAG`, and the sim does not run a frame before that answer is in (`RagdollRemote.behind`): the sim hears of it
 * at the same step whatever the worker's speed.
 */
export const LAG = 2;
/** The cars' wanted-fit test looks this many frames of travel further out than a proxy's own, so a fit asked for arrives before the car is touched. */
export const FIT_AHEAD = LAG + 2;
/** A car's `wanted` when a knocked prop or an awake carton may reach it within `FIT_AHEAD` frames: its parts that stand out of its body are recorded for them to meet (`recordLoose`). */
export const WANT_PARTS = 2;

/** A frame's car record, floats: the group's pose, its class body's pose in it, its velocity, speed, flags, glass state. */
export const CAR_FLOATS = 20;
export const CAR_POSITION = 0;
export const CAR_QUATERNION = 3;
export const CAR_LIFT_POSITION = 7;
export const CAR_LIFT_QUATERNION = 10;
export const CAR_VELOCITY = 14;
export const CAR_SPEED = 17;
export const CAR_FLAGS = 18;
export const CAR_GLASS = 19;
export const FLAG_FALLING = 1;
export const FLAG_VAPORIZED = 2;
export const FLAG_LIFT = 4;

/** A dummy's record in a result, floats: a header, then each part's pose before the last step and after it. */
export const DOLL_LIVE = 0;
export const DOLL_RIDES = 1;
export const DOLL_CAR = 2;
export const DOLL_STILL = 3;
export const DOLL_SETTLED = 4;
export const DOLL_VELOCITY = 5;
export const DOLL_HEADER = 8;
export const DOLL_FLOATS = DOLL_HEADER + 2 * PARTS.length * 7;
/** A knocked prop's pose in a result: its index, the art's base position and rotation. */
export const PROP_FLOATS = 8;

type Triple = readonly [number, number, number];
type Quad = readonly [number, number, number, number];

interface ThrowMessage {
  type: "throw";
  id: number;
  car: number;
  position: Triple;
  rotation: Quad;
  velocity: Triple;
  spin: Triple;
  cop: boolean;
  rides: boolean;
  purse: boolean;
  armsDown: boolean;
  loose: boolean;
  lookSeed: number;
  /** Sim seconds he lies about, when the throw names its own (`Throw.life`). */
  life?: number;
}

/** A car's cage as the dummies' world fits a proxy to it (`CageView`), sent when it changes. */
export interface CageMessage {
  type: "cage";
  slot: number;
  /** Which car is in the slot: a new one gets a new world-side car. */
  car: number;
  style: CarStyleId;
  classLift: number;
  serial: number;
  top: Float32Array;
  covered: Uint8Array;
  plan: Float32Array;
  planBox: Float64Array;
  heightMax: number;
  nu: number;
  nv: number;
  u0: number;
  v0: number;
  step: number;
}

interface FrameMessage {
  type: "frame";
  seq: number;
  epoch: number;
  dt: number;
  authority: boolean;
  sandbox: boolean;
  lookSeed: number;
  count: number;
  cars: Float64Array;
  /** The loose bodies, asleep or not, with their velocity and mass (`recordLoose`), `LOOSE_FLOATS` each. */
  loose: Float64Array;
}

/** A fixed box's record in a `boxes` message, floats: x0, z0, x1, z1 (m, world) then its foot y0 and top y1. */
const BOX_FLOATS = 6;

/** `boxes` as the one transferred array a message carries. */
export function packBoxes(boxes: readonly FloorBox[]): Float64Array {
  const packed = new Float64Array(boxes.length * BOX_FLOATS);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    packed.set([b.x0, b.z0, b.x1, b.z1, b.y0, b.y1], i * BOX_FLOATS);
  }
  return packed;
}

export function unpackBoxes(packed: Float64Array): FloorBox[] {
  const boxes: FloorBox[] = [];
  for (let o = 0; o + BOX_FLOATS <= packed.length; o += BOX_FLOATS) boxes.push({ x0: packed[o]!, z0: packed[o + 1]!, x1: packed[o + 2]!, z1: packed[o + 3]!, y0: packed[o + 4]!, y1: packed[o + 5]! });
  return boxes;
}

/** One end of a rope (the tether's cable with an end in the dummies' world): a thing held (a dummy's slot, a prop's placement index or a box's index) at a world point on it, a car at a car-frame point, or a world point. */
export type RopeEnd = { kind: "doll" | "prop" | "box" | "car"; id: number; at: Triple } | { kind: "world"; at: Triple };

/** Every message the tether sends carries the number of the command it is, so an answer says how many the world has heard. */
export type RopeMessage =
  | { type: "rope"; command: number; slot: number; a: RopeEnd; b: RopeEnd }
  | { type: "ropeCut"; command: number; slot: number }
  | { type: "ropeReel"; command: number; on: boolean };

/** A rope's record in a result, floats: its state (`ROPE_NONE`, `ROPE_PENDING`: told of but not yet joined, `ROPE_JOINED`), end a's world point, end b's, its length (m). */
export const ROPE_FLOATS = 8;
export const ROPE_STATE = 0;
export const ROPE_NONE = 0;
export const ROPE_PENDING = 1;
export const ROPE_JOINED = 2;
export const ROPE_A = 1;
export const ROPE_B = 4;
export const ROPE_LENGTH = 7;

export type ToWorker =
  | { type: "course"; json: TrackJson; arm?: SceneryArm }
  | { type: "boxes"; boxes: Float64Array }
  | { type: "reset"; epoch: number }
  | { type: "knock"; prop: number; car: number; vx: number; vy: number; vz: number }
  | ThrowMessage
  | CageMessage
  | RopeMessage
  | FrameMessage;

/** What a body in the dummies' world struck on car `car`: `HIT_PARTS[part]` (a pane a torso struck, a part a prop or carton met), the striker's energy (J) and push (world m/s: its closing velocity along the contact normal). */
export interface PartHit {
  car: number;
  part: number;
  energy: number;
  x: number;
  y: number;
  z: number;
}

/** Told of each hit the sim applied (`applyHit`), its push in the car's frame: the reel's record. */
export type PartHeard = (car: number, part: number, energy: number, push: THREE.Vector3) => void;

/** The sim applies `hit` (`DeformableCar.hitPart`), its push turned into the car's frame, and `heard` is told. */
export function applyHit(hit: PartHit, cars: readonly DeformableCar[], heard: PartHeard | null): void {
  const car = cars[hit.car];
  if (!car) return;
  _push.set(hit.x, hit.y, hit.z).applyQuaternion(_inverse.copy(car.group.quaternion).invert());
  car.hitPart(hit.part, hit.energy, _push);
  heard?.(hit.car, hit.part, hit.energy, _push);
}

export interface ResultMessage {
  type: "result";
  seq: number;
  epoch: number;
  /** One dummy record per slot the worker has built. */
  dolls: Float32Array;
  alpha: number;
  lastSlot: number;
  purses: Float32Array;
  /** Knocked props placed this frame (`PROP_FLOATS` each), after the reset if `propsReset`. */
  props: Float32Array;
  propsReset: boolean;
  spawned: { id: number; slot: number }[];
  hits: PartHit[];
  /** Per car, nonzero when a dummy, purse thing or knocked prop may reach it within `FIT_AHEAD` frames (the cars the main thread sends cages of); `WANT_PARTS` when a knocked prop or awake carton may. */
  wanted: Uint8Array;
  /** Anything is out: a dummy, a purse thing or a knocked prop. */
  active: boolean;
  /** The wall ms of the `world.step()` calls since the last result. */
  stepMs: Float64Array;
  colliders: number;
  bodies: number;
  /** `MAX_TETHERS` rope records (`ROPE_FLOATS` each) and the last rope command the world had heard when it wrote them. */
  ropes: Float32Array;
  ropeCommand: number;
}

export type FromWorker = { type: "ready" } | { type: "failed"; message: string } | ResultMessage;
