import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { detAtan2, detCos, hypot3 } from "../kernel/physics-core.js";
import { MIRROR_FOLD_MAX } from "../vehicle/car-core.ts";
import { CLASSES, carClass } from "../vehicle/vehicle-classes.ts";
import type { LidProfile } from "../vehicle/car-parts.ts";
import { bodyEdge, strikeCar, makeBox, partContact } from "../contact/external-contact.ts";
import { KPH_PER_MS } from "../kernel/constants.ts";

/**
 * The door/mirror knock scenes of `docs/door-mirror-sketch.png`, on a car parked at the origin
 * facing +Z (yaw 0, at rest):
 * - `mirror` (A): the door is shut; a ram runs rear→front past the side with a small gap to the
 *   skin and catches only the mirror.
 * - `overOpen` (B): the door is open; the ram runs rear→front into it and drives it past the stop.
 * - `shut` (C): the door is open; the ram runs front→rear into it and drives it shut.
 * - `panelPush` (D): the quarter panel stands out (a hinged, not yet fragile panel); the ram runs rear→front into it and
 *   pushes it back onto the body (it stays dented), or tears it off when hard enough.
 * - `panelPull` (E): the same panel; the ram runs front→rear into its free end and pulls it open (past its tear energy: off).
 * - `lidPop` (F): a rear ram square into the tail with the lid shut; crush past the latch's `ajar` springs it.
 * - `lidTear` (G): the same with the lid on its stop; a hard enough hit tears it off.
 * The ram is kinematic apart from the momentum it trades with the car; it is a striker box in the
 * shared contact (`external-contact.ts`): the door and mirror colliders a car running down the
 * side meets too, and the body contact if a lane reaches the skin (the stock lanes do not).
 */
export type DoorScenario = "mirror" | "overOpen" | "shut" | "panelPush" | "panelPull" | "lidPop" | "lidTear";

type RamLane = {
  /** Travel along the car: +1 rear→front, −1 front→rear. */
  dir: 1 | -1;
  /** |x| of the face's inner edge (m); a mirror or panel lane's is the car's own (`laneFor`). */
  inner: number;
  /** Face width outward from `inner` (m). */
  width: number;
  /** Face bottom and top (m above the ground). */
  bottom: number;
  top: number;
  /** Door angle (rad) when the shot starts, 0 shut and latched; for a `panel` scenario the quarter panel's hinge value (0..1); for a `lid` one the lid's angle (clamped to its stop). */
  open: number;
  /** The part the lane is for: a door and its mirror (default), the quarter panel or the trunk lid. */
  part?: "panel" | "lid";
};

/** Half the rear ram's face (m): centred on the tail, inside every car's track. */
const TAIL_HALF = 0.6;
/** The lid lanes' ram, square into the tail from behind, bumper to boot-lid height. */
const TAIL_LANE = { dir: 1, inner: -TAIL_HALF, width: 2 * TAIL_HALF, bottom: 0.3, top: 0.9, part: "lid" } as const;

export const DOOR_LANES: Readonly<Record<DoorScenario, RamLane>> = {
  // Only the mirror's top in the lane, over the belt and pillars: `laneFor` sets it on the car's own mirror.
  mirror: { dir: 1, inner: 0, width: 0.4, bottom: 0, top: 0, open: 0 },
  // Below the mirror so only the door slab is in the lane.
  overOpen: { dir: 1, inner: 0.95, width: 0.6, bottom: 0.3, top: 0.75, open: (55 * Math.PI) / 180 },
  // Outside the mirror head on the open door, so the ram meets the slab first.
  shut: { dir: -1, inner: 1.1, width: 0.6, bottom: 0.3, top: 0.75, open: (55 * Math.PI) / 180 },
  // A quarter panel standing out (hinge 0.45); `laneFor` puts the inner edge outside the car's own body.
  panelPush: { dir: 1, inner: 0, width: 0.6, bottom: 0.3, top: 0.75, open: 0.45, part: "panel" },
  panelPull: { dir: -1, inner: 0, width: 0.6, bottom: 0.3, top: 0.75, open: 0.45, part: "panel" },
  lidPop: { ...TAIL_LANE, open: 0 },
  lidTear: { ...TAIL_LANE, open: Math.PI },
};

/** A mirror or panel lane's inner edge stands at least this far (m) outside the body's edge at the striker's heights: past the cage field's last node, half a lattice step out. */
const BODY_LANE_GAP = 0.03;
/** The mirror lane's inner edge stands at most this far (m) outside the mirror's base: well inside its reach, so the cap folds onto its stop. */
const MIRROR_LANE_GAP = 0.03;
/** A short mirror's lane stands no further out than this share of the cap's sideways reach at its fold stop, so the cap is still in the lane when it gets there. */
const MIRROR_LANE_STOP_SHARE = 0.75;
/** The mirror lane's bottom stands this far (m) under the drawn mirror's top: clear of the belt and pillars under it, which a taller ram would dent. */
const MIRROR_LANE_CATCH = 0.02;
/** The mirror lane runs from just under the drawn mirror's top up this far (m): a head over the cap, never down onto the belt and the door below. */
const MIRROR_LANE_TALL = 0.6;
/** G's head starts this far (m) under the lowest point of the open trunk lid, and stands this tall: it meets the lid where it hangs. */
const LID_LANE_BITE = 0.03;
const LID_LANE_TALL = 0.4;
/** G's head runs this far (m) over the deck a lid that opens up stands on. */
const LID_LANE_DECK_CLEAR = 0.02;

/** A head's shape on a lane: a car-shaped striker for docs/CONTACT_PARITY.md. */
export type RamShape = Partial<Pick<RamLane, "bottom" | "top" | "width">>;

/**
 * `scenario`'s lane beside side `side` of `car` for a head of `shape`, at the heights the world draws it (the style's own heights over the class's lift): a mirror
 * lane on that car's own mirror (its top in the lane, its base `mirrorLaneGap` in), a panel lane on its body; neither inside the body at the head's own heights, which would be a body hit.
 * G's head stands at the open lid where it hangs (`hangingLidHeights`).
 */
export function laneFor(scenario: DoorScenario, car: DeformableCar, side: -1 | 1, shape: RamShape | null = null): RamLane {
  const lift = CLASSES[carClass(car)].lift;
  let lane = { ...DOOR_LANES[scenario], bottom: DOOR_LANES[scenario].bottom + lift, top: DOOR_LANES[scenario].top + lift };
  if (scenario === "mirror") {
    const bottom = car.mirrorSpanY[1] - MIRROR_LANE_CATCH + lift;
    lane = { ...lane, inner: car.mirrorBaseX + mirrorLaneGap(car), bottom, top: bottom + MIRROR_LANE_TALL };
  }
  if (scenario === "lidTear") lane = { ...lane, ...hangingLidHeights(car, lift) };
  if (shape) lane = { ...lane, ...shape };
  if (scenario !== "mirror" && lane.part !== "panel") return lane;
  const clear = bodyEdge(car, side, lane.bottom, lane.top) + BODY_LANE_GAP;
  return { ...lane, inner: scenario === "mirror" ? Math.max(lane.inner, clear) : clear };
}

function mirrorLaneGap(car: DeformableCar): number {
  return Math.min(MIRROR_LANE_GAP, MIRROR_LANE_STOP_SHARE * car.style.door.mirrorReach * detCos(MIRROR_FOLD_MAX));
}

const _lidShut: LidProfile = { hingeY: 0, hingeZ: 0, edgeY: 0, edgeZ: 0, halfWidth: 0 };
const _lidOpen: LidProfile = { hingeY: 0, hingeZ: 0, edgeY: 0, edgeZ: 0, halfWidth: 0 };

/** The heights (m, over the class's `lift`) G's head runs at: the open lid's lowest point to `LID_LANE_TALL` above it; a lid that opens up stands over the deck, which the head clears by `LID_LANE_DECK_CLEAR` so it meets the lid and not the tail under it. */
function hangingLidHeights(car: DeformableCar, lift: number): Pick<RamLane, "bottom" | "top"> {
  const hinge = car.lidHinge().spec;
  const open = car.lidProfile(_lidOpen, hinge.stop);
  const shut = car.lidProfile(_lidShut, 0);
  const lowest = Math.min(open.hingeY, open.edgeY) - LID_LANE_BITE;
  const deck = Math.max(shut.hingeY, shut.edgeY) + LID_LANE_DECK_CLEAR;
  const bottom = (hinge.dir > 0 ? Math.max(lowest, deck) : lowest) + lift;
  return { bottom, top: bottom + LID_LANE_TALL };
}

export const RAM_DEFAULTS = { kph: 12, kg: 300 } as const;

export const RAM = {
  /** Head length along its travel (m). */
  length: 0.5,
  /** The face starts this far behind the car's centre along its travel (m)... */
  start: 2.8,
  /** ...and the run ends once it is this far past it. */
  end: 3.4,
  /** Contact substep (s): 8 mm per step at 60 km/h. */
  substep: 0.0005,
  /** Hold after the ram stops or runs past, so a swinging door can latch or reach its stop (s). */
  settle: 1.5,
} as const;

type RamPhase = "idle" | "run" | "settle";

export type RamShot = {
  /** Parts off the car; a mirror riding its torn door counts. */
  detached: string[];
  /** Struck door's angle at the end (deg). */
  doorDeg: number;
  latched: boolean;
  mirrorFoldDeg: number;
  /** Energy the struck door's hinges took at the stop (J). */
  hingeLoadJ: number;
  /** The ram was stopped by the car rather than running past. */
  ramStopped: boolean;
  /** Largest control-particle and skinned body-vertex move since the shot began (mm). */
  bodyParticleMm: number;
  bodyVertexMm: number;
  /** The struck side's quarter panel hinge value at the end (0 flat, 1 full; kept when it is pushed back). */
  panelHinge: number;
};

const D2R = Math.PI / 180;
const _c = new THREE.Vector3();
/** A lid torn off at park leaves rearward and up (car-space m/s) so it falls clear of the tail. */
const PARK_TEAR_PUSH = new THREE.Vector3(0, 1, -2);

/** DOM-free door rig: the engine's doors scene and the tests run the same `step`. */
export class DoorRig {
  car: DeformableCar | null = null;
  scenario: DoorScenario = "mirror";
  /** −1 left door, +1 right. */
  side: -1 | 1 = 1;
  kph: number = RAM_DEFAULTS.kph;
  kg: number = RAM_DEFAULTS.kg;
  /** The trunk lid at park (share link `dlid`): 0 shut, 1 on its stop, 2 torn off. */
  lid = 0;
  phase: RamPhase = "idle";
  /** Head length along the travel (m). */
  length: number = RAM.length;
  /** Leading face along car z (m). */
  face = -RAM.start;
  /** Speed along the travel (m/s). */
  u = 0;
  /** First touch since `fire` (FX hook; cleared by the caller). */
  touched = false;
  stopped = false;
  private settled = 0;
  private particles0 = new Float64Array(0);
  private verts0 = new Float32Array(0);
  private readonly box = makeBox();
  /**
   * Frame parity (docs/CONTACT_PARITY.md): the ram stands still in the world and the car is driven into it at the shot's
   * speed, instead of the ram running along a parked car. Both are one relative motion through the same contact.
   */
  carMoves = false;

  /** A head of another shape on the scenario's lane. */
  shape: RamShape | null = null;

  get lane(): RamLane {
    if (this.car) return laneFor(this.scenario, this.car, this.side, this.shape);
    const lane = DOOR_LANES[this.scenario];
    return this.shape ? { ...lane, ...this.shape } : lane;
  }

  attach(car: DeformableCar): void {
    this.car = car;
    this.phase = "idle";
    this.u = 0;
    this.face = -this.lane.dir * RAM.start;
    this.particles0 = new Float64Array(car.deform.masses.length * 3);
    this.verts0 = new Float32Array((car.body.geometry.getAttribute("position") as THREE.BufferAttribute).array.length);
    // Every reset's `resetVisual` re-hangs the lid before the park, so its share-link state is set again here.
    if (this.lid === 1) car.setLidOpen(car.lidHinge().spec.stop);
    else if (this.lid === 2) car.ripLid(PARK_TEAR_PUSH);
  }

  /** Set the door for the scenario and launch the ram. Speed in km/h, mass in kg. */
  fire(scenario: DoorScenario, side: -1 | 1, kph = this.kph, kg = this.kg): void {
    const car = this.car;
    if (!car) return;
    this.scenario = scenario;
    this.side = side;
    this.kph = THREE.MathUtils.clamp(kph, 1, 120);
    this.kg = THREE.MathUtils.clamp(kg, 5, 5000);
    const drive = this.carMoves ? -this.lane.dir * (this.kph / KPH_PER_MS) : 0;
    car.velocity.set(car.fwdFlat.x * drive, 0, car.fwdFlat.z * drive);
    car.speed = Math.abs(drive);
    // After the velocity, so the door's pendulum starts from this motion rather than a jump to it.
    if (this.lane.part === "panel") {
      car.setDoorOpen(side, 0);
      car.setPanelOpen(side, this.lane.open);
    } else if (this.lane.part === "lid") car.setLidOpen(this.lane.open);
    else car.setDoorOpen(side, this.lane.open);
    const masses = car.deform.masses;
    for (let i = 0; i < masses.length; i++) masses[i]!.local.toArray(this.particles0, i * 3);
    this.verts0.set((car.body.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array);
    this.face = -this.lane.dir * RAM.start;
    this.u = this.kph / KPH_PER_MS;
    this.phase = "run";
    this.touched = false;
    this.stopped = false;
    this.settled = 0;
  }

  /** Ram travel, mirror and door contact, and the hinge swing, in `RAM.substep` slices. */
  step(dt: number): void {
    const car = this.car;
    if (!car) return;
    const lane = this.lane;
    const n = Math.max(1, Math.ceil(dt / RAM.substep));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      if (this.phase === "run") {
        this.face += lane.dir * this.u * h;
        this.hit(car, h, lane);
        if (this.u <= 0.01) {
          this.u = 0;
          this.stopped = true;
          this.phase = "settle";
        } else if (lane.dir * this.face - this.length > RAM.end - RAM.length) {
          this.phase = "settle";
        }
      } else if (this.phase === "settle") {
        this.settled += h;
        if (this.settled > RAM.settle) this.phase = "idle";
      }
      car.swingHinges(h);
    }
    // A dented body runs the same structure step as every other crash.
    if (car.deform.massActive) {
      car.deform.stepStructure(dt, car.group.quaternion);
      car.syncPose(dt);
    }
  }

  /** Ram centre (car space) for the visuals. */
  centre(out: THREE.Vector3, lane = this.lane): THREE.Vector3 {
    return out.set(
      this.side * (lane.inner + lane.width * 0.5),
      (lane.bottom + lane.top) * 0.5,
      this.face - lane.dir * this.length * 0.5,
    );
  }

  result(): RamShot {
    const car = this.car!;
    const detached: string[] = [];
    for (const p of car.snapshot().parts as { name: string; detached: boolean }[]) if (p.detached) detached.push(p.name);
    for (const name of ["mirrorL", "mirrorR"] as const) if (!detached.includes(name) && car.partOff(name)) detached.push(name);
    const door = car.doorHinge(this.side);
    let particle = 0;
    const masses = car.deform.masses;
    for (let i = 0; i < masses.length; i++) {
      const m = masses[i]!.local;
      const o = this.particles0;
      particle = Math.max(particle, hypot3(m.x - o[i * 3]!, m.y - o[i * 3 + 1]!, m.z - o[i * 3 + 2]!));
    }
    let vertex = 0;
    const now = (car.body.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < now.length; i += 3) {
      const v0 = this.verts0;
      vertex = Math.max(vertex, hypot3(now[i]! - v0[i]!, now[i + 1]! - v0[i + 1]!, now[i + 2]! - v0[i + 2]!));
    }
    return {
      detached,
      doorDeg: door.theta / D2R,
      latched: door.latched,
      mirrorFoldDeg: Math.abs(door.mirrorFold) / D2R,
      hingeLoadJ: door.load,
      ramStopped: this.stopped,
      bodyParticleMm: particle * 1000,
      bodyVertexMm: vertex * 1000,
      panelHinge: car.quarterPanel(this.side).hingeT,
    };
  }

  /**
   * The ram as a striker box riding the car's frame (its kinematic travel plus the speed it
   * keeps), through the same door, mirror and body contact every scene uses.
   */
  private hit(car: DeformableCar, h: number, lane: RamLane): void {
    const box = this.box;
    this.centre(_c, lane);
    const p = car.group.position;
    const r = car.rightFlat;
    const f = car.fwdFlat;
    box.x = p.x + r.x * _c.x + f.x * _c.z;
    box.y = p.y + _c.y;
    box.z = p.z + r.z * _c.x + f.z * _c.z;
    box.hx = lane.width * 0.5;
    box.hy = (lane.top - lane.bottom) * 0.5;
    box.hz = this.length * 0.5;
    box.yaw = detAtan2(f.x, f.z) + (lane.dir > 0 ? 0 : Math.PI);
    box.vx = car.velocity.x + f.x * lane.dir * this.u;
    box.vz = car.velocity.z + f.z * lane.dir * this.u;
    box.kg = this.kg;
    box.hardness = 1;
    const hit = partContact(car, box, h);
    if (hit.touched) this.touched = true;
    this.u = Math.max(0, this.u - hit.du);
    // G's head runs over the deck and meets the open lid (`hitLid`), not the tail under it: the body contact's plan outline has no heights to tell them apart, so it waits for the lid to be gone. F's lid, sprung by the crush, never hides the tail.
    if (this.scenario === "lidTear" && car.lidHangsOnStop()) return;
    // A lane that reaches the skin dents it through the same body contact the other rigs use.
    const taken = strikeCar(car, box, h, true);
    if (taken > 0) this.touched = true;
    this.u = Math.max(0, this.u - taken / this.kg);
  }
}
