import { hypot2, detSin, detCos, PART_FAMILY } from "../kernel/physics-core.js";
import * as THREE from "three";
import { EPICENTER } from "../deform/epicenter.ts";
import { BUMPER_F } from "./constants.ts";
import { lidAccel } from "./hinge-spec.ts";
import { hingePose, INTERIOR_MASSES, interiorPose } from "./part-pose.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import type { StirCar } from "../world/surfaces.ts";
import { UPRIGHT_UP_Y } from "./car-suspension.ts";
import type { MassName } from "../kernel/rig-spec.ts";
import { flutterShell, makeShell, poseShell, recentre, setPrimer, shellBox, shellReaches } from "./car-panels.ts";
import { setBare } from "./interior.ts";
import { carClass, CLASSES } from "./vehicle-classes.ts";
import { applyDents } from "./loose-dent.ts";
import { doorCardDent } from "./car-door-mesh.ts";
import { fitWheelShape, partMass, stepLoose } from "./loose-step.ts";
import type { TopMet } from "./car-air-body.ts";
import { rigidCentre } from "./car-air.ts";
import { CarGlass } from "./car-glass-break.ts";
import { BUMPER_TEAR_MPS, type DetachPart, DOOR_AJAR, DOOR_DAMP, type DoorHinge, type GlassPart, type Lamp, type PartNetState } from "./car-core.ts";
import {
  DOOR_ACC_MAX,
  DOOR_QUIET_S,
  DOOR_YAW_ACC_MAX,
  flapAmp,
  flapRate,
  flapWave,
  PANEL_FRAGILE_T,
  PANEL_SMUSH_MIN,
  swingAccel,
  windWear,
} from "./car-wear.ts";
import { LOOSE_BODIES, looseState, partState, PART_SLOTS } from "./part-state.ts";
import { PART_KIND, PartSeat, looseOnCamera, partGeometry } from "./part-geometry.ts";

const _interior = new Float64Array(4);
const DOOR_LEFT: GlassPart = "doorLeft";
const DOOR_RIGHT: GlassPart = "doorRight";

const _push = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _box = new THREE.Box3();
const _lampQ = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _doorW = new THREE.Vector3();
const _c = new THREE.Vector3();
const _com = new THREE.Vector3();
const _drawn = new THREE.Box3();
const _hoodHinge = new THREE.Vector3();
const _hoodSwung = new THREE.Vector3();
const _hoodTurn = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);

/**
 * Grows `box` by what `o` and its descendants draw, at their world matrices as they stand: a visible mesh's geometry, a part seat's `drawn`
 * part. A part seat's `geometry` is the platform part the sim measures, not where the style draws its own (`Box3.setFromObject` read it: a
 * pickup's bumper box reached 4.2 m off the bumper, and the bumper was lifted 2.6 m to clear the road under that phantom).
 */
function growDrawn(o: THREE.Object3D, box: THREE.Box3): void {
  if (!o.visible) return;
  const geometry = o instanceof PartSeat ? o.drawn : o instanceof THREE.Mesh ? (o.geometry as THREE.BufferGeometry) : null;
  if (geometry !== null) {
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    box.union(_drawn.copy(geometry.boundingBox!).applyMatrix4(o.matrixWorld));
  }
  for (let i = 0; i < o.children.length; i++) growDrawn(o.children[i]!, box);
}
const _bumpW = new THREE.Vector3();
/** A mirror the ground crushes off its car leaves with this much speed straight up (m/s, world). */
const MIRROR_POP = 0.5;
const _seatDoor = new THREE.Matrix4();
const _seatMirror = new THREE.Matrix4();
const _unitScale = new THREE.Vector3(1, 1, 1);
/** Glass against its frame's distortion (`glassDistortion`, m): the laminated windscreen cracks from a few mm of differential aperture movement, between a 35 km/h wall's frame and a 50 km/h one's. */
const GLASS_CRACK = 0.003;
/** Tempered side and rear glass bursts once its frame is about 3 cm out of true, in any direction. */
const GLASS_TEMPERED = 0.03;
/** The laminated windscreen "shatters" (extensive cracking, the bond line letting go) at about 30 mm of racking. */
const GLASS_LAMINATED = 0.03;

/** Police light bar: shears off once the roof mass under it sinks this far (m below its rest height; a
 *  56 km/h frontal sinks it ~0.07), or on any hit at or above this EBS (60 km/h, arcade: a big crash throws
 *  it). Guessed, tuned by eye. (The roof sensor's compression is no measure: a 20 km/h frontal reads 0.36.) */
const BAR_TEAR_SINK = 0.12;
const BAR_TEAR_MPS = 60 / 3.6;
/**
 * Quarter panels and arch flares hinge by the crush under them, `(crush - on) / range`, and tear off once the hinge value
 * passes `PANEL_TEAR` on a hit this fast (EBS). Tuned on the walls: the rear wing sensor peaks
 * 0.06 / 0.23 / 0.47 m on a 30 % offset rear hit at 40 / 56 / 80 km/h, the front one 0.57 / 0.92 / 1.0 m on an offset front hit
 * and 0.29 / 0.78 m on the side wall at 40 / 56.
 */
const PANEL_HINGE = { quarter: { on: 0.05, range: 0.45 }, arch: { on: 0.15, range: 0.5 } } as const;
const PANEL_TEAR = 0.8;
const PANEL_TEAR_MPS = 50 / 3.6;
/** A hood or lid crushed past this hinge value tears off (`evaluateBreakage`): the furthest a crash opens it on the car. */
const LID_TEAR_T = 0.78;
/** The angle (rad) a shown open hood stands at about its rear edge: the owner's open-hood photos, hood against belt line in their side views. */
const HOOD_SHOW_OPEN = THREE.MathUtils.degToRad(32);
/** The hood's rear-edge band (m, from its rearmost point): the vertices it hinges along. */
const HOOD_EDGE_BAND = 0.01;
/** A panel's shell stands from this hinge value. */
const PANEL_OPEN = 0.03;
/** At most `LIVE_SHELLS` of a car's torn shells are drawn: the oldest vanish (each is a draw). */
const LIVE_SHELLS = 2;
/** A bumper hung by one corner rolls about it this much at full hinge and full asymmetry (rad), and sags this far (m). */
const BUMPER_ROLL = 0.6;
const BUMPER_SAG = 0.06;
/** A door's bottom stays this far (m) above the ground under it (`liftDoor`). */
const DOOR_CLEAR = 0.04;
/** A hanging bumper's lowest point stays this far (m) above the road under it, as a door's does. */
const BUMPER_CLEAR = DOOR_CLEAR;
/** Halvings that find the roll a hanging bumper rests on the road at (0.6 rad / 2⁸ = 2 mrad, 3 mm of the free end). */
const BUMPER_REST_ITER = 8;
/** A hanging arch shell's flap drops no lower than this (m) above the road under it: it rests on the road, not through it. */
const SHELL_CLEAR = 0.005;

/** The highest ground (m) under the plan corners of world box `b`, read from its top down; `NO_FLOOR` where there is none under any. */
function groundUnderBox(b: THREE.Box3): number {
  const ground = activeGround();
  let high = NO_FLOOR;
  for (let k = 0; k < 4; k++) {
    const y = ground.heightAt(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.z : b.min.z, b.max.y);
    if (y !== NO_FLOOR && (high === NO_FLOOR || y > high)) high = y;
  }
  return high;
}
/** A hinged part below this hinge value is not worn by the wind (a shell hardly standing). */
const WEAR_MIN_T = 0.04;
/** A contact is fresh when the last was over `TOUCH_GAP` s ago and the next lands within `TOUCH_NOW` s. */
const TOUCH_GAP = 0.15;
const TOUCH_NOW = 0.03;
/** A part hinged or swung no further than this (rad, or the hinge value) is still within a shadow texel of its rest (4.7 cm). */
const FLUSH_HINGE = 0.02;
/** How fast (hinge value per s) a hinged part swings toward its target. */
const HINGE_RATE = 3.2;
/** A lid's crash hinge value runs on the tail's crush (the rear bumper cage's compression, m) from `LID_CRUSH_ON`, full `LID_CRUSH_RANGE` past it: its latch (ajar 0.2) springs at 0.2 m, past every lid car's 15 km/h rear wall and short of its 30 km/h one. */
const LID_CRUSH_ON = 0.14;
const LID_CRUSH_RANGE = 0.3;

/** The hinge value above which a part counts as folding (hung open, crushed, flapping), by hinge kind. */
function foldAt(p: DetachPart): number {
  if (p.hinge === "two-point") return p.bumper ? 0.04 : 0.08;
  if (p.hinge === "cowl" || p.hinge === "tail") return 0.06;
  if (p.hinge === "door") return 0.08;
  if (p.hinge === "bar") return 0.05;
  return p.region ? PANEL_OPEN : Infinity;
}

/** The bumpers' masses `posePart` reads, and the signature of a pose being built (`poseInputsChanged`; a car has at most 20 attached parts). */
const POSE_BUMPERS = ["bumperFL", "bumperFR", "bumperRL", "bumperRR"] as const;
const _poseSig = new Float64Array(7 * 20 + 20);
/** An input moved less than this (m, rad or the unit of the value) from what the parts were last posed at is no change: a resting wreck's masses are re-derived through the frame's inverse each slice and differ by 1e-13. A nanometre moves no pixel; a slow creep is seen once it adds up, as the comparison is against the last pose, not the last slice. */
const POSE_EPSILON = 1e-9;
const _hinge = new Float64Array(7);
/** The road under an arch shell in its body's frame (`shellFloor`, `poseShell`'s `floor`), and the world point and normal it is read at. */
const _floor = new Float64Array(4);
const _floorAt = new THREE.Vector3();
const _floorN = new THREE.Vector3();

/** The showcase's and landing shots' poses of a car: as built, every door and lid open, every part off. */
export type CarPose = "intact" | "open" | "stripped";

/**
 * Detachable parts: attached-part posing, door hinges and mirrors, glass following, breakage and detaching,
 * loose parts and wheels, and their netplay state.
 */
export abstract class CarParts extends CarGlass {
  /** The car's torn shells, oldest first. */
  private readonly liveShells: DetachPart[] = [];
  /** Each mirror's box on its rest seat in the car's frame (`mirrorRestBox`), built when first asked. */
  private readonly mirrorRestBoxes: THREE.Box3[] = [];
  /**
   * Per loose body (a part by its slot, then a popped wheel by its hub, `LOOSE_BODIES`): the slices of the step `stepWorld` last ran in which a stir woke it from sleep (bit i: slice i; `stepLoose`).
   * A replay without the car that stirred it wakes it there (`wakeBody`); the recorder keeps it (`HighlightClip.partStirs`). `stepWorld` clears it each step.
   */
  readonly stirredBodies = new Uint8Array(LOOSE_BODIES);
  /** Whether `stirredBodies` holds a stir: the recorder reads nothing otherwise. */
  anyBodyStirred = false;
  /** The bit of the slice `stepWorld` is running (`stirredBodies`); 0 outside a world step, where nothing is kept. */
  sliceBit = 0;
  /** The flap clock (rad) turns with speed and shakes every hinged panel and bumper (`flapAngle`). Cosmetic: no rule reads it. */
  flapClock = 0;
  flapSpeed = 0;
  /** Seconds since the last contact, as of the last frame: tells a fresh touch from a continuing one (`evaluateBreakage`). */
  quietPrev = 0;
  /** The car's velocity (x, z) and yaw rate at the last door-swing sample: their change is the pendulum's drive. */
  readonly motion = new Float64Array(3);
  /** Pendulum drive, car frame: acceleration right, acceleration forward (m/s²), yaw rate (rad/s), yaw acceleration (rad/s²). */
  readonly swingDrive = new Float64Array(4);
  /**
   * Once a frame, with the skin: an undamaged car casts its sun shadow from `restCaster` alone (body and every flush part
   * at rest as one decimated shell, one draw per style), so overhanging parts are not missing from it. Once the car has been hit or a part has hinged,
   * swung or come off, the caster stops and the body, hood, boot lid, doors and bumpers cast, one draw each.
   */
  protected settleCasters(): void {
    let flush = !this.crashed;
    for (let i = 0; i < this.parts.length && flush; i++) {
      const p = this.parts[i]!;
      flush = !p.detached && p.hingeT <= FLUSH_HINGE && (p.swing === null || p.swing.theta <= FLUSH_HINGE);
    }
    this.body.castShadow = !flush;
    this.restCasts = flush;
    for (let i = 0; i < this.flushCasters.length; i++) this.flushCasters[i]!.castShadow = !flush;
  }

  protected syncAttachedParts(dt: number): void {
    this.advanceFlap(dt);
    const ix = this.deform.impactInward.x;
    const iz = this.deform.impactInward.z;
    const parts = this.parts;
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi]!;
      if (p.detached) continue;
      const left = this.deform.sensorCompression(p.attachL);
      const right = this.deform.sensorCompression(p.attachR);
      const crush = Math.max(left, right, this.deform.partCompression(p.cage));
      const local = Math.min(left, right);
      const onHit = this.partOnHit(p);

      let target = 0;
      if (p.mirror) {
        // C3: the mirror folds with the door skin under it (sensors 6/7 and 4/5), on its own side only.
        if (onHit) target = THREE.MathUtils.clamp((Math.max(left, right) - 0.04) / 0.3, 0, 1);
      } else if (p.hinge === "door") {
        const open = THREE.MathUtils.clamp((Math.max(local, crush) - 0.08) / 0.5, 0, 1);
        const endOn = !this.deform.bidirectional && Math.abs(ix) <= Math.abs(iz);
        if (onHit) target = open;
        else if (endOn && (crush > 0.16 || local > 0.12)) target = Math.min(open, DOOR_AJAR);
      } else if (p.hinge === "bar") {
        target = Math.min(this.barLoad(), 0.95);
      } else if (onHit) {
        if (p.hinge === "two-point") target = THREE.MathUtils.clamp((crush - 0.04) / 0.55, 0, 1);
        else if (p.hinge === "cowl") target = THREE.MathUtils.clamp((crush - 0.1) / 0.6, 0, 1);
        else if (p.hinge === "tail") target = THREE.MathUtils.clamp((this.deform.partCompression("bumperRear") - LID_CRUSH_ON) / LID_CRUSH_RANGE, 0, 1);
        else if (p.region) target = THREE.MathUtils.clamp((crush - PANEL_HINGE[p.region.kind].on) / PANEL_HINGE[p.region.kind].range, 0, 1);
      }
      p.hingeT = Math.min(p.hingeMax, Math.max(p.hingeT, Math.min(target, p.hingeT + Math.max(dt * HINGE_RATE, 0.012))));
      // `folding` is read by the net state and the recorder's keyframes at every step, so it is set here, not in the frame's pose.
      p.folding = p.hingeT > foldAt(p);
      if ((p.hinge === "door" || p.hinge === "tail") && onHit) this.springSwing(p);
    }
    this.partsDirty = true;
  }

  /**
   * Set when `syncAttachedParts` moved a part's state; `poseParts` (once per rendered frame, from `updateSkin`) writes the
   * poses. A pose is presentation only and a step is 1/240 s: writing it every step cost 10 % of a crowded crash race.
   */
  protected partsDirty = false;

/** What the parts were last posed from (`poseInputsChanged`): null before the first pose of a crash. */
  private poseSig: Float64Array | null = null;

  /**
   * Whether anything `posePart` reads differs from the last pose: each part's hinge, swing, flap and attach sensors, the car's own position and turn (the ground the
   * doors and bumpers clear, the world matrix), the struck direction, the bumpers' masses. The crush skin the panels bend over is the caller's check (`skinnedThisFrame`).
   * Inputs within `POSE_EPSILON` of the last pose are the same; it records the inputs it read when they differ.
   */
  private poseInputsChanged(): boolean {
    const parts = this.parts;
    const n = parts.length * 7 + 20;
    const now = _poseSig;
    let k = 0;
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi]!;
      now[k++] = p.detached ? 1 : 0;
      now[k++] = p.hingeT;
      now[k++] = p.swing === null ? 0 : p.swing.theta;
      now[k++] = p.swing === null ? 0 : p.swing.mirrorFold;
      now[k++] = this.flapAngle(p);
      now[k++] = this.deform.sensorCompression(p.attachL);
      now[k++] = this.deform.sensorCompression(p.attachR);
    }
    const g = this.group;
    now[k++] = g.position.x;
    now[k++] = g.position.y;
    now[k++] = g.position.z;
    now[k++] = g.quaternion.x;
    now[k++] = g.quaternion.y;
    now[k++] = g.quaternion.z;
    now[k++] = g.quaternion.w;
    now[k++] = this.deform.impactInward.z;
    for (let m = 0; m < 4; m++) {
      const l = this.deform.massLocal(POSE_BUMPERS[m]!);
      now[k++] = l.x;
      now[k++] = l.y;
      now[k++] = l.z;
    }
    const last = this.poseSig;
    let same = last !== null && last.length === n;
    if (same) for (let i = 0; i < n; i++) if (Math.abs(last![i]! - now[i]!) > POSE_EPSILON) same = false;
    if (!same) {
      if (last === null || last.length !== n) this.poseSig = new Float64Array(n);
      this.poseSig!.set(now.subarray(0, n));
    }
    return !same;
  }

  /** Every attached part posed from its current state, if a step moved any (`updateSkin`, before lamps, panels and glass follow). */
  protected poseParts(): void {
    if (!this.partsDirty) return;
    this.partsDirty = false;
    // A car reset since the step that set the flag has its parts back at rest: nothing to pose (and the last signature no longer describes them).
    if (!this.crashed) {
      this.poseSig = null;
      return;
    }
    if (EPICENTER.presentSkip === 1 && !this.deform.skinnedThisFrame && !this.poseInputsChanged()) return;
    const parts = this.parts;
    for (let pi = 0; pi < parts.length; pi++) if (!parts[pi]!.detached) this.posePart(parts[pi]!);
  }

  /** Counts every write of an attached part's pose (`posePart`, the reset): a car whose count has not moved has nothing new for `PoseBlend` to take. */
  partWrites = 0;

  /**
   * Rest pose plus the hinge value `hingeT` (crash) and, on doors and mirrors, the free swing. `onRoad` false poses an arch shell free of
   * the road under it, where its hinge alone puts it: a torn shell leaves from that pose (`detachPart`), which replays read.
   */
  protected posePart(p: DetachPart, onRoad = true): void {
    this.partWrites++;
    const t = p.hingeT;
    p.folding = t > foldAt(p);
    p.object.position.copy(p.restPos);
    p.object.quaternion.copy(p.restQuat);
    p.object.scale.copy(p.restScale);

    if (p.hinge === "two-point") {
      if (p.bumper) {
        const fl = this.deform.massLocal(p.name === BUMPER_F ? "bumperFL" : "bumperRL");
        const fr = this.deform.massLocal(p.name === BUMPER_F ? "bumperFR" : "bumperRR");
        p.object.position.set((fl.x + fr.x) * 0.5, (fl.y + fr.y) * 0.5, (fl.z + fr.z) * 0.5);
        const front = p.name === BUMPER_F;
        const seatZ = (front ? this.style.bumpers.front : this.style.bumpers.rear).seat.z;
        const span = Math.abs(fl.z - (front ? seatZ : -seatZ));
        p.object.scale.set(1 + t * 0.04, Math.max(0.45, 1 - t * 0.28), Math.max(0.18, 1 - span * 0.45));
        // Hangs by the corner that took less: rolls about it, the struck end drops.
        const left = this.deform.sensorCompression(p.attachL);
        const right = this.deform.sensorCompression(p.attachR);
        const asym = THREE.MathUtils.clamp((left - right) / Math.max(left, right, 0.05), -1, 1);
        const roll = t * BUMPER_ROLL * asym + (asym < 0 ? -1 : 1) * this.flapAngle(p);
        this.hangBumper(p, roll, (asym < 0 ? -0.6 : 0.6) * p.object.scale.x);
      } else {
        const side = p.name === "mirrorL" ? -1 : 1;
        p.object.rotation.z += side * t * 1.4;
        p.object.rotation.y = p.swing!.mirrorFold;
        p.object.position.y -= t * 0.12;
        p.object.position.x += side * t * 0.18;
      }
    } else if (p.hinge === "cowl" || p.hinge === "tail" || p.hinge === "bar") {
      hingePose(p, this.deform, _hinge, 0);
      p.object.position.set(_hinge[0]!, _hinge[1]!, _hinge[2]!);
      p.object.quaternion.set(_hinge[3]!, _hinge[4]!, _hinge[5]!, _hinge[6]!);
    } else if (p.hinge === "door") {
      const sign = p.name === "doorL" ? -1 : 1;
      p.object.rotation.y = -sign * Math.max(t * p.swing!.spec.jam, p.swing!.theta);
      p.object.position.x += sign * t * 0.06;
      p.object.updateWorldMatrix(true, true);
      this.liftDoor(p.object);
    } else if (p.region) {
      if (p.folding) {
        if (!p.open || p.hingeT !== p.posed) this.shellPose(p, onRoad);
        else if (!onRoad) {
          if (p.held) this.bendShell(p, null);
        } else {
          // The car moved over the road: a shell resting on it follows it, and one its drop now reaches comes to rest on it.
          const floor = this.shellFloor(p);
          if (p.held || (floor !== null && shellReaches(p.region, this.body.geometry, p.posed, p.shellFlutter, floor))) this.bendShell(p, floor);
        }
        const a = this.flapAngle(p);
        if (a > 0) flutterShell(p.region, p.object, a);
      } else if (p.open) this.closePanel(p);
    }
  }

  /**
   * `p` hung by its corner at `px` (car-frame m from its middle) and rolled `roll` about it, the struck end dropping and the whole bumper
   * sagging with its hinge value. The road is under the free end: its box stays `BUMPER_CLEAR` above the ground there, so the roll is the
   * largest one up to `roll` that lets it rest on the road (a bumper 0.16 m off the road hangs a few degrees, not 34), and a bumper crushed
   * down to the road is lifted by what it still lacks. A torn bumper leaves in this pose (`detachPart`), so it no longer starts under the road.
   * Only on its wheels is the car's up the road's (as for the doors, `posePart`): lying over, it hangs at its full roll, unfitted (lifted along
   * the car's up, an upside-down pickup's front bumper went 2.58 m the wrong way, 2.3 m into a 10° slope).
   */
  private hangBumper(p: DetachPart, roll: number, px: number): void {
    const o = p.object;
    const x0 = o.position.x;
    const y0 = o.position.y - p.hingeT * BUMPER_SAG;
    // The ancestors' matrices do not change while the roll is searched: brought up to date once, each probe then poses `o` alone.
    o.parent?.updateWorldMatrix(true, false);
    if (this.hungLack(o, x0, y0, px, roll) <= 0 || this.group.matrixWorld.elements[5]! < UPRIGHT_UP_Y) return;
    const flat = this.hungLack(o, x0, y0, px, 0);
    if (flat > 0) {
      o.position.y += flat;
      return;
    }
    let lo = 0;
    let hi = roll;
    for (let i = 0; i < BUMPER_REST_ITER; i++) {
      const mid = (lo + hi) * 0.5;
      if (this.hungLack(o, x0, y0, px, mid) > 0) hi = mid;
      else lo = mid;
    }
    this.hungLack(o, x0, y0, px, lo);
  }

  /**
   * Keeps door `o`'s bottom `DOOR_CLEAR` over the ground under it (not where there is none: off the fleet disc's rim). On its wheels it is
   * lifted along the car's up over the ground at its hinge; lying over, where that points into the ground, along the world's up in its
   * parent's frame (as `CarUnderbody.stub`) over the highest ground under its plan box (lying, it spans a metre of slope), a drawn pose only:
   * a pickup on its left side drew its jammed-out left door 25.8 cm in the slope it lay on.
   */
  private liftDoor(o: THREE.Object3D): void {
    growDrawn(o, _box.makeEmpty());
    const upright = this.group.matrixWorld.elements[5]! >= UPRIGHT_UP_Y;
    const g = _doorW.setFromMatrixPosition(o.matrixWorld);
    const gy = upright ? activeGround().heightAt(g.x, g.z, g.y) : groundUnderBox(_box);
    if (gy === NO_FLOOR || _box.min.y >= gy + DOOR_CLEAR) return;
    const lift = gy + DOOR_CLEAR - _box.min.y;
    if (upright) {
      o.position.y += lift;
      return;
    }
    // The world's up in the parent's frame: its world matrix's row 1 (the car's groups carry no scale).
    const e = o.parent!.matrixWorld.elements;
    o.position.x += lift * e[1]!;
    o.position.y += lift * e[5]!;
    o.position.z += lift * e[9]!;
  }

  /** Pose `o` rolled `r` about its corner at `px` from (`x0`, `y0`) and return how far (m) its box is under `BUMPER_CLEAR` above the ground there: positive is too low. */
  private hungLack(o: THREE.Object3D, x0: number, y0: number, px: number, r: number): number {
    o.rotation.z = r;
    o.position.x = x0 + px * (1 - detCos(r));
    o.position.y = y0 - px * detSin(r);
    o.updateWorldMatrix(false, true);
    growDrawn(o, _box.makeEmpty());
    _bumpW.setFromMatrixPosition(o.matrixWorld);
    const gy = activeGround().heightAt(_bumpW.x, _bumpW.z, _bumpW.y);
    return gy === NO_FLOOR ? 0 : gy + BUMPER_CLEAR - _box.min.y;
  }

  /** Door hinge state; `side` −1 is the left door, +1 the right. */
  doorHinge(side: number): DoorHinge {
    return this.doorParts[side < 0 ? 0 : 1]!.swing!;
  }

  /** The trunk lid's (hatch's, tailgate's) hinge state. */
  lidHinge(): DoorHinge {
    return this.lidPart.swing!;
  }

  /** Whether the trunk lid has left the car. */
  lidOff(): boolean {
    return this.lidPart.detached;
  }

  /** Whether a door, mirror or quarter panel has left the car; a mirror rides off on its torn door. */
  partOff(name: "doorL" | "doorR" | "mirrorL" | "mirrorR" | "quarterL" | "quarterR"): boolean {
    const i = name.endsWith("L") ? 0 : 1;
    if (name.startsWith(PART_FAMILY.quarter)) return this.quarterParts[i]!.detached;
    const door = this.doorParts[i]!.detached;
    return name.startsWith(PART_FAMILY.door) ? door : door || this.mirrorParts[i]!.detached;
  }

  /** Unlatch a door and leave it at rest `theta` open (rad, up to the stop); 0 shuts and latches it. */
  setDoorOpen(side: number, theta: number): void {
    this.setSwingOpen(this.doorParts[side < 0 ? 0 : 1]!, theta);
  }

  /** Unlatch the trunk lid and leave it at rest `theta` open (rad, up to its stop); 0 shuts and latches it. */
  setLidOpen(theta: number): void {
    this.setSwingOpen(this.lidPart, theta);
  }

  /**
   * Pose a car just reset (`spawnFacing`) for display, nothing stepped: "open" swings the doors and boot to their stops and the hood up on its rear edge as a real one opens;
   * "stripped" takes every part and pane off the drawn car (none handed to the world); "intact" leaves it as built. A reset (`resetVisual`) undoes it.
   */
  showPose(pose: CarPose): void {
    // A stripped part is off the car without the world holding it (`detachPart`), which only an uncrashed car's steps leave alone.
    if (this.crashed || this.deform.massActive) throw new Error("showPose: a crashed car steps its parts; pose one just reset (spawnFacing)");
    if (pose === "intact") return;
    // A door's pose reads the group's world matrix (its clearance over the ground).
    this.group.updateMatrixWorld(true);
    if (pose === "open") {
      this.setDoorOpen(-1, this.doorHinge(-1).spec.stop);
      this.setDoorOpen(1, this.doorHinge(1).spec.stop);
      this.setLidOpen(this.lidHinge().spec.stop);
      for (const p of this.parts) {
        if (p.hinge !== "cowl") continue;
        this.showHoodOpen(p);
      }
      return;
    }
    for (const p of this.parts) {
      if (p.detached) continue;
      if (p.region) this.openPanel(p);
      if (p.bare) setBare(p.bare, this.body.geometry, true);
      p.detached = true;
      p.object.visible = false;
    }
    for (const g of this.glassPanes) {
      g.state = "shattered";
      g.mesh.visible = false;
    }
  }

  /** The hood turned nose-up `HOOD_SHOW_OPEN` about its rear edge at the cowl, as a real one opens; its hinge value stays 0, so the crash's pop and the cage keep it shut. */
  private showHoodOpen(p: DetachPart): void {
    const pos = (p.object as THREE.Mesh).geometry.getAttribute("position") as THREE.BufferAttribute;
    let zMin = Infinity;
    for (let i = 0; i < pos.count; i++) zMin = Math.min(zMin, pos.getZ(i));
    let yEdge = -Infinity;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < zMin + HOOD_EDGE_BAND) yEdge = Math.max(yEdge, pos.getY(i));
    _hoodHinge.set(0, yEdge, zMin);
    _hoodTurn.setFromAxisAngle(_xAxis, -HOOD_SHOW_OPEN);
    p.object.quaternion.copy(p.restQuat).multiply(_hoodTurn);
    _hoodSwung.copy(_hoodHinge).applyQuaternion(_hoodTurn);
    p.object.position.copy(_hoodHinge).sub(_hoodSwung).applyQuaternion(p.restQuat).add(p.restPos);
    p.shown = true;
    this.partWrites++;
  }

  private setSwingOpen(p: DetachPart, theta: number): void {
    if (p.detached) return;
    const h = p.swing!;
    h.theta = THREE.MathUtils.clamp(theta, 0, h.spec.stop);
    h.omega = 0;
    h.latched = h.theta === 0;
    this.sampleMotion();
    this.posePart(p);
  }

  /** The angle (rad) door `side` is drawn open at: the free swing, or the crash's jam when that holds it further out; 0 once it is off. */
  doorAngle(side: number): number {
    return this.swingAngle(this.doorParts[side < 0 ? 0 : 1]!);
  }

  /** The trunk lid's drawn open angle (rad), as `doorAngle`. */
  lidAngle(): number {
    return this.swingAngle(this.lidPart);
  }

  private swingAngle(p: DetachPart): number {
    return p.detached ? 0 : Math.max(p.hingeT * p.swing!.spec.jam, p.swing!.theta);
  }

  /**
   * A fixed solid shuts door `side` to `angle` (rad) at closing rate `rate` (rad/s): the door swings in to it, latching at 0, and
   * a slam past its `slamJ` wrenches it off (`closeSwing`). A door the crash jammed open past `angle` cannot shut: the solid
   * tears it off. True if it tore off.
   */
  shutDoor(side: number, angle: number, rate: number): boolean {
    return this.shutSwing(this.doorParts[side < 0 ? 0 : 1]!, angle, rate);
  }

  /** A solid shuts the trunk lid to `angle` at `rate`, as `shutDoor`. */
  shutLid(angle: number, rate: number): boolean {
    return this.shutSwing(this.lidPart, angle, rate);
  }

  private shutSwing(p: DetachPart, angle: number, rate: number): boolean {
    if (p.detached) return false;
    if (p.hingeT * p.swing!.spec.jam > angle) {
      this.detachPart(p, 0, this.wrenchPush(p, 0));
      return true;
    }
    p.swing!.omega = -rate;
    const tore = this.closeSwing(p, angle);
    if (!tore) this.posePart(p);
    return tore;
  }

  /**
   * The check strap takes `energy` (J) past the stop. Once the total passes the hinge's `tearJ` the
   * door tears off with `push` (car-space m/s on top of the car's velocity). Returns whether it did.
   */
  loadDoorStop(side: number, energy: number, push: THREE.Vector3): boolean {
    return this.loadStop(this.doorParts[side < 0 ? 0 : 1]!, energy, push);
  }

  private loadStop(p: DetachPart, energy: number, push: THREE.Vector3): boolean {
    if (p.detached) return false;
    p.swing!.load += energy;
    if (p.swing!.load < p.swing!.spec.tearJ) return false;
    this.detachPart(p, 0, push);
    return true;
  }

  /** Fold a mirror about its base (rad, its `rotation.y` in door space). */
  setMirrorFold(side: number, angle: number): void {
    const m = this.mirrorParts[side < 0 ? 0 : 1]!;
    if (m.detached) return;
    m.swing!.mirrorFold = angle;
    this.posePart(m);
  }

  /** Snap a mirror off its door with `push` (car-space m/s). */
  breakMirror(side: number, push: THREE.Vector3): void {
    this.detachPart(this.mirrorParts[side < 0 ? 0 : 1]!, 0, push);
  }

  /**
   * Free swing of the doors and the trunk lid: the car's acceleration drives a door's pendulum (`swingAccel`), weight, struts and
   * the car's surge a lid's (`lidAccel`); hinge friction damps either, and it ends on its stop, on the crash jam (`hingeT`) or in
   * the latch (`closeSwing`: the ram's shut scene and the car's own swing alike).
   */
  swingHinges(dt: number): void {
    this.sampleDrive(dt);
    const doors = !this.doorParts[0]!.swing!.latched || !this.doorParts[1]!.swing!.latched;
    for (let i = 0; i < 2 && doors; i++) {
      const p = this.doorParts[i]!;
      if (p.detached || (!p.swing!.latched && this.swingStep(p, dt))) continue;
      this.posePart(p);
      const m = this.mirrorParts[i]!;
      if (!m.detached) this.posePart(m);
    }
    const lid = this.lidPart;
    if (!lid.detached && !lid.swing!.latched && !this.swingStep(lid, dt)) this.posePart(lid);
  }

  /** Whether a door or the trunk lid hangs off its latch (`swingHinges` has work). */
  protected swingFree(): boolean {
    return !this.doorParts[0]!.swing!.latched || !this.doorParts[1]!.swing!.latched || (!this.lidPart.detached && !this.lidPart.swing!.latched);
  }

  /** One step of an unlatched part's swing. True if it tore off. */
  private swingStep(p: DetachPart, dt: number): boolean {
    const h = p.swing!;
    const s = h.spec;
    // A part the crash jammed open never shuts past its jam.
    const jam = Math.min(p.hingeT * s.jam, s.stop);
    const resting = h.theta >= s.stop;
    h.omega += this.hingeAccel(p) * dt;
    const dry = s.dry * dt;
    h.omega = Math.abs(h.omega) <= dry ? 0 : h.omega - Math.sign(h.omega) * dry;
    h.theta += h.omega * dt;
    h.omega *= Math.exp(-DOOR_DAMP * dt);
    if (h.theta >= s.stop && h.omega > 0) {
      h.theta = s.stop;
      // The stop takes the free edge's blow when it arrives; the detent then holds it, and the push that keeps it there loads nothing.
      const e = resting ? 0 : 0.5 * s.inertia * h.omega * h.omega;
      this.edgeVelocity(p, _push);
      h.omega = 0;
      return e > 0 && this.loadStop(p, e, _push);
    }
    if (h.theta <= jam && h.omega < 0) return this.closeSwing(p, jam);
    if (h.theta < jam) h.theta = jam;
    return false;
  }

  /** Opening acceleration (rad/s²) of swinging part `p` now. */
  private hingeAccel(p: DetachPart): number {
    const h = p.swing!;
    const d = this.swingDrive;
    if (p.hinge === "door") return swingAccel(h.spec, p.name === "doorL" ? -1 : 1, h.theta, d[0]!, d[1]!, d[2]!, d[3]!);
    // The world's up in the car's frame (its y and z): the column of the car's rotation that turns car y.
    const q = this.group.quaternion;
    return lidAccel(h.spec, h.theta, 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z - q.w * q.x), d[1]!);
  }

  /** The free edge's velocity (car-frame m/s) as part `p` swings: what its stop takes, and what it leaves with if that tears it off. */
  private edgeVelocity(p: DetachPart, out: THREE.Vector3): THREE.Vector3 {
    const h = p.swing!;
    const s = h.spec;
    if (p.hinge === "door") return out.set((p.name === "doorL" ? -1 : 1) * detCos(h.theta), 0, detSin(h.theta)).multiplyScalar(h.omega * s.length);
    const turn = s.dir * h.theta;
    const c = detCos(turn);
    const sn = detSin(turn);
    // The chord's rate of turn: the chord turned a quarter toward opening.
    return out.set(0, -(s.uy * sn + s.uz * c), s.uy * c - s.uz * sn).multiplyScalar(s.dir * h.omega * s.length);
  }

  /** A part torn out of its hinges against its frame leaves outward (a door, rearward at its centre's swing rate `omega`) or up and back (a lid). */
  private wrenchPush(p: DetachPart, omega: number): THREE.Vector3 {
    if (p.hinge !== "door") return _push.set(0, 0.6, -1.2);
    return _push.set(p.name === "doorL" ? -1.2 : 1.2, 0.6, 0.5 * p.swing!.spec.length * omega);
  }

  /**
   * A part swung into its frame at closing rate ω < 0: the latch takes it at `jam` 0 (a crash jam above stops it there), or past
   * its `slamJ` it is wrenched off. True if it tore off.
   */
  private closeSwing(p: DetachPart, jam: number): boolean {
    const h = p.swing!;
    h.theta = jam;
    if (0.5 * h.spec.inertia * h.omega * h.omega >= h.spec.slamJ) {
      this.detachPart(p, 0, this.wrenchPush(p, h.omega));
      return true;
    }
    h.omega = 0;
    h.latched = jam === 0;
    return false;
  }

  /** A door or lid a hit has crushed past its `ajar` is off its latch: it hangs at least as far open as the crash jam (`hingeT`) and swings with the car. */
  private springSwing(p: DetachPart): void {
    const h = p.swing!;
    if (h.latched) {
      if (p.hingeT <= h.spec.ajar) return;
      h.latched = false;
      h.omega = 0;
      this.sampleMotion();
    }
    h.theta = Math.max(h.theta, Math.min(p.hingeT * h.spec.jam, h.spec.stop));
  }

  /** Remember the car's velocity and yaw rate: the next `sampleDrive` reads their change as acceleration. Call after setting either by hand. */
  sampleMotion(): void {
    this.motion[0] = this.velocity.x;
    this.motion[1] = this.velocity.z;
    this.motion[2] = this.yawRate;
  }

  /** The car-frame acceleration since the last sample, capped (`DOOR_ACC_MAX`), into `swingDrive`; zero while the car is in contact (the crash rules own that moment). */
  private sampleDrive(dt: number): void {
    const m = this.motion;
    const inv = dt > 0 ? 1 / dt : 0;
    const ax = (this.velocity.x - m[0]!) * inv;
    const az = (this.velocity.z - m[1]!) * inv;
    const d = this.swingDrive;
    const free = this.deform.quietTime() > DOOR_QUIET_S;
    d[0] = free ? THREE.MathUtils.clamp(ax * this.rightFlat.x + az * this.rightFlat.z, -DOOR_ACC_MAX, DOOR_ACC_MAX) : 0;
    d[1] = free ? THREE.MathUtils.clamp(ax * this.fwdFlat.x + az * this.fwdFlat.z, -DOOR_ACC_MAX, DOOR_ACC_MAX) : 0;
    d[2] = free ? this.yawRate : 0;
    d[3] = free ? THREE.MathUtils.clamp((this.yawRate - m[2]!) * inv, -DOOR_YAW_ACC_MAX, DOOR_YAW_ACC_MAX) : 0;
    this.sampleMotion();
  }

  /** The flap clock turns with the car's ground speed. */
  private advanceFlap(dt: number): void {
    this.flapSpeed = hypot2(this.velocity.x, this.velocity.z);
    this.flapClock += flapRate(this.flapSpeed) * dt;
  }

  /** A fresh car's flutter, contact timing and door motion sample (`resetVisual`): a reused car replays as a new one. */
  protected resetWear(): void {
    this.flapClock = 0;
    this.flapSpeed = 0;
    this.quietPrev = 0;
    this.sampleMotion();
  }

  /** The contact timing and door motion sample of a car whose state was just written (`writeNetState`): the next frame reads them as a continuing one. */
  protected restoreWear(): void {
    this.quietPrev = this.deform.quietTime();
    this.sampleMotion();
  }

  /** Flutter of `p` now (rad, ≥ 0): 0 at rest and for a part not hinged; each part beats at its own phase (its rest spot's). */
  private flapAngle(p: DetachPart): number {
    const a = flapAmp(this.flapSpeed, p.hingeT);
    return a > 0 ? a * flapWave(this.flapClock + p.restPos.x * 13.1 + p.restPos.z * 7.7) : 0;
  }

  /** Netplay client, every frame: the flap clock turns with the car's speed and hinged panels and bumpers are re-posed with it. */
  flutterParts(dt: number): void {
    this.advanceFlap(dt);
    const parts = this.parts;
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi]!;
      if (p.folding && !p.detached && (p.region || p.bumper)) this.posePart(p);
    }
  }

  /** The quarter panel on `side` (−1 left, +1 right), on the car or not. */
  quarterPanel(side: number): DetachPart {
    return this.quarterParts[side < 0 ? 0 : 1]!;
  }

  /**
   * A striker moves the quarter panel to hinge value `t`: pushed back onto the body it stays dented (`hingeMax`, and never
   * flat: `PANEL_SMUSH_MIN`), pushed out it opens up to full hinge.
   */
  bendPanel(side: number, t: number): void {
    const p = this.quarterPanel(side);
    if (p.detached) return;
    const to = THREE.MathUtils.clamp(t, Math.min(PANEL_SMUSH_MIN, p.hingeT), 1);
    if (to < p.hingeT) p.hingeMax = to;
    p.hingeT = to;
    this.posePart(p);
  }

  /** Hinge a quarter panel to `t` with no crash (the Doors scene's start), whole again. */
  setPanelOpen(side: number, t: number): void {
    const p = this.quarterPanel(side);
    if (p.detached) return;
    p.hingeMax = 1;
    p.fatigue = 0;
    p.hingeT = THREE.MathUtils.clamp(t, 0, 1);
    this.posePart(p);
  }

  /** A striker tears the quarter panel off with `push` (car-space m/s on top of the car's velocity). */
  ripPanel(side: number, push: THREE.Vector3): void {
    this.detachPart(this.quarterPanel(side), 0, push);
  }

  /** Tear the trunk lid off with `push` (car-space m/s on top of the car's velocity). */
  ripLid(push: THREE.Vector3): void {
    this.detachPart(this.lidPart, 0, push);
  }

  protected fitInterior(): void {
    if (!this.deform.massActive) {
      this.interior.scale.set(1, 1, 1);
      this.interior.position.set(0, 0, 0);
      this.cabin.fit(null);
      this.underbody?.fit(null);
      this.cabin.squeezeUnderRoof(this.deform.massLocal("roof").y);
      return;
    }
    const l = this.deform.massLocal(INTERIOR_MASSES[0]);
    const r = this.deform.massLocal(INTERIOR_MASSES[1]);
    const cell = this.deform.massLocal(INTERIOR_MASSES[2]);
    interiorPose(l.x, r.x, cell.y, cell.z, _interior);
    this.interior.scale.x = _interior[0]!;
    this.interior.position.set(_interior[1]!, _interior[2]!, _interior[3]!);
    this.cabin.fit(this.deform);
    this.underbody?.fit(this.deform);
    this.cabin.squeezeUnderRoof(this.deform.massLocal("roof").y);
    this.cabin.standOnGround();
  }

  /** Once a frame on a crashed car (`updateSkin`, after the skin): the parts' poses a step left pending are written first, door glass rides its door. */
  protected followGlass(): void {
    this.poseParts();
    const inward = this.deform.impactInward;
    for (let k = 0; k < this.glassPanes.length; k++) {
      const g = this.glassPanes[k]!;
      if (g.state === "shattered" || g.skin) continue;
      const onDoor = g.parts.includes(DOOR_LEFT) || g.parts.includes(DOOR_RIGHT);
      if (onDoor) continue;
      let nearby = 0;
      for (let q = 0; q < g.parts.length; q++) nearby = Math.max(nearby, this.deform.partCompression(g.parts[q]!));
      g.mesh.position.copy(g.restPos);
      if (nearby < 0.02) continue;
      g.mesh.position.x += inward.x * nearby * 0.32;
      g.mesh.position.y += inward.y * nearby * 0.12 - nearby * 0.08;
      g.mesh.position.z += inward.z * nearby * 0.32;
    }
  }

  /** Whether the current hit loads this part. Doors and the mirrors on them (C1/C3) take a hit only
   *  from their own side; every other part must sit on the struck end. */
  private partOnHit(p: DetachPart): boolean {
    const ix = this.deform.impactInward.x;
    const iz = this.deform.impactInward.z;
    if (this.deform.bidirectional) return Math.abs(p.restPos.z) > 0.8 || Math.abs(p.restPos.x) > 0.5;
    const side = p.cage === "doorLeft" ? -1 : p.cage === "doorRight" ? 1 : 0;
    if (side !== 0) return Math.abs(ix) > Math.abs(iz) && Math.sign(ix) === -side;
    return -(p.restPos.x * ix + p.restPos.z * iz) > 0.12;
  }

  protected evaluateBreakage(impulse: number, dt: number): void {
    for (let k = 0; k < this.glassPanes.length; k++) {
      const g = this.glassPanes[k]!;
      if (g.state === "shattered") continue;
      const distortion = this.deform.glassDistortion(g.skin ?? (g.parts.includes(DOOR_LEFT) ? DOOR_LEFT : DOOR_RIGHT));
      const laminated = g.skin === "glassFront";
      if (laminated && g.state === "intact" && distortion > GLASS_CRACK) this.crackGlass(g);
      if (distortion > (laminated ? GLASS_LAMINATED : GLASS_TEMPERED)) this.shatterGlass(g);
    }

    const ebs = this.deform.hitSpeedValue;
    // Contact resumed after a pause is a fresh touch (a wall, a car, a prop: whatever feeds `notifyContact`).
    const quiet = this.deform.quietTime();
    const touched = quiet < TOUCH_NOW && this.quietPrev > TOUCH_GAP;
    this.quietPrev = quiet;
    const parts = this.parts;
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi]!;
      if (p.detached) continue;
      if (p.mirror) {
        const side = p === this.mirrorParts[0] ? 0 : 1;
        if (!this.doorParts[side]!.detached && this.mirrorUnderGround(side)) {
          this.detachPart(p, impulse, _push.set(0, MIRROR_POP, 0).applyQuaternion(_q.copy(this.group.quaternion).invert()));
          continue;
        }
      }
      if (p.hinge === "bar") {
        const sink = this.roofRestY - this.deform.massLocal("roof").y;
        if (sink > BAR_TEAR_SINK || (ebs >= BAR_TEAR_MPS && this.deform.crushElapsed > 0.05)) this.detachPart(p, impulse);
        continue;
      }
      if ((p.region || p.bumper) && this.wornOff(p, dt, touched)) {
        this.detachPart(p, impulse);
        continue;
      }
      if (this.deform.bidirectional && p.hinge !== "door" && p.hinge !== "two-point") continue;
      if (!this.partOnHit(p)) continue;
      let should = false;
      if (p.mirror) should = p.hingeT > 0.5;
      else if (p.bumper) should = p.hingeT > 0.7 && ebs >= BUMPER_TEAR_MPS;
      else if (p.hinge === "cowl") should = p.hingeT > LID_TEAR_T;
      else if (p.hinge === "door" || p.hinge === "tail") {
        // A lid crushed this far is off whatever the speed; an open door or lid hit hard enough past its `tearT` is torn off (C1).
        const s = p.swing!.spec;
        should = (p.hinge === "tail" && p.hingeT > LID_TEAR_T) || (p.hingeT > s.tearT && (this.deform.bidirectional || ebs >= s.tearMps));
      } else if (p.region) should = p.hingeT > PANEL_TEAR && ebs >= PANEL_TEAR_MPS;
      if (should) this.detachPart(p, impulse);
    }

    for (let k = 0; k < this.lamps.length; k++) {
      const lamp = this.lamps[k]!;
      if (!lamp.intact) continue;
      let crush = 0;
      for (let q = 0; q < lamp.sensors.length; q++) crush = Math.max(crush, this.deform.sensorCompression(lamp.sensors[q]!));
      if (crush > 0.18 && this.deform.crushElapsed > 0.02) this.breakLamp(lamp);
    }
  }

  /**
   * What a hinged panel or bumper takes between hits (docs/PANEL_FLAP.md): a stretched (`PANEL_FRAGILE_T`) quarter panel or arch
   * flare goes on a fresh contact, a quarter panel also on a scrape of the ground (an arch flare's box includes the sill, which the body
   * sinks to the road on its own); a bumper never on contact timing (its hulls shape the crash, a replay could not reproduce it); any
   * hinged part goes in sustained speed (`windWear`). True once it is off.
   */
  private wornOff(p: DetachPart, dt: number, touched: boolean): boolean {
    if (p.hingeT <= WEAR_MIN_T) {
      p.fatigue = 0;
      return false;
    }
    if (p.hingeT >= PANEL_FRAGILE_T && p.region !== null && (touched || (p.hinge === "quarter" && this.scrapes(p)))) return true;
    p.fatigue = Math.max(0, p.fatigue + windWear(this.flapSpeed, p.hingeT) * dt);
    return p.fatigue >= 1;
  }

  /**
   * Whether the part's box reaches the ground under it. The panel's shell on the body's rest skin, bent to its hinge value,
   * carried by the car's pose: sim state only. The drawn shell (its skin's solve, the suspension's heave, its flutter) depends
   * on how often and where the car is drawn, and the replay of a crash drew at other times than the live sim did.
   */
  private scrapes(p: DetachPart): boolean {
    const lift = CLASSES[carClass(this)].lift; // the drawn body rides on the class's lift (`Car.ride`); the panel with it
    shellBox(p.region!, this.deform.restSkin, p.hingeT, this.group.position, this.group.quaternion, lift, _box).getCenter(_doorW);
    const g = activeGround().heightAt(_doorW.x, _doorW.z, _doorW.y);
    return g !== NO_FLOOR && _box.min.y < g;
  }

  /** Mirror `i`'s box on its rest seat (its door's, then its own on the door), in the car's frame. */
  private mirrorRestBox(i: number): THREE.Box3 {
    const cached = this.mirrorRestBoxes[i];
    if (cached) return cached;
    const door = this.doorParts[i]!;
    const mirror = this.mirrorParts[i]!;
    const geometry = partGeometry(i === 0 ? PART_KIND.mirrorL : PART_KIND.mirrorR);
    geometry.computeBoundingBox();
    _seatDoor.compose(door.restPos, door.restQuat, _unitScale);
    _seatMirror.compose(mirror.restPos, mirror.restQuat, mirror.restScale);
    const box = geometry.boundingBox!.clone().applyMatrix4(_seatDoor.multiply(_seatMirror));
    this.mirrorRestBoxes[i] = box;
    return box;
  }

  /**
   * Whether a car lying over has put mirror `i` into the ground: a mirror stands its door's `mirrorReach` out from the body side, so past `UPRIGHT_UP_Y` it is
   * lower than the body it sits on. Sim state only (the rest box on the car's pose, as `scrapes`): the drawn door swings and sinks with the frame it is drawn at.
   */
  private mirrorUnderGround(i: number): boolean {
    const q = this.group.quaternion;
    if (1 - 2 * (q.x * q.x + q.z * q.z) >= UPRIGHT_UP_Y) return false;
    const box = this.mirrorRestBox(i);
    let low = Infinity;
    for (let corner = 0; corner < 8; corner++) {
      _c.set(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z).applyQuaternion(q).add(this.group.position);
      low = Math.min(low, _c.y);
    }
    box.getCenter(_c).applyQuaternion(q).add(this.group.position);
    const g = activeGround().heightAt(_c.x, _c.z, _c.y);
    return g !== NO_FLOOR && low < g;
  }

  /** Out for good until the next reset; `LampBatch` draws it dark. */
  protected breakLamp(lamp: Lamp): void {
    lamp.intact = false;
  }

  /** Each door card rides in with the dent its door's skin has taken (`doorCardDent`): the batch draws it as one rigid shape, which a dented skin otherwise leaves standing out through it. A torn or restored door's has none. */
  protected seatDoorCards(): void {
    for (const side of [0, 1] as const) {
      const sign = side === 0 ? -1 : 1;
      const mesh = side === 0 ? this.doorMeshL : this.doorMeshR;
      const dent = this.doorParts[side]!.detached ? 0 : doorCardDent(this.doorCardFaces[side]!, sign, side === 0 ? this.doorLRest : this.doorRRest, mesh.geometry.getAttribute("position").array);
      const seat = this.partSeats[side === 0 ? PART_KIND.liningL : PART_KIND.liningR]!;
      if (seat.position.x === -sign * dent) continue;
      seat.position.x = -sign * dent;
      seat.updateMatrix();
    }
  }

  /** Hand a part to the world. `push` (car-space m/s on top of the car's velocity) replaces the
   *  crash launch: outward from the body by `impulse`, popped up by `hingeT`. */
  protected detachPart(p: DetachPart, impulse: number, push?: THREE.Vector3): void {
    if (p.detached) return;
    // The part leaves in the pose its state gives now, not the last frame's (poses are written once a frame, `poseParts`; a door
    // torn off by `swingHinges` finds none pending).
    this.posePart(p, false);
    p.detached = true;
    p.shape.count = 0;
    // ponytail: a torn door flies as its rest shell (its loose shape is sim and is read off the shell drawn, `boxShape`); flying dented moves the sim.
    if (p === this.doorParts[0]) this.restoreRest(this.doorMeshL.geometry, this.doorLRest);
    else if (p === this.doorParts[1]) this.restoreRest(this.doorMeshR.geometry, this.doorRRest);
    this.seatDoorCards();
    this.group.updateMatrixWorld();
    const wpos = new THREE.Vector3();
    const wquat = new THREE.Quaternion();
    if (p.region) this.openPanel(p);
    if (p.bare) setBare(p.bare, this.body.geometry, true);
    p.object.getWorldPosition(wpos);
    p.object.getWorldQuaternion(wquat);
    if (p.region) {
      // The shell tumbles about its middle, not the rest origin.
      recentre((p.object as THREE.Mesh).geometry, _c);
      wpos.add(_c.applyQuaternion(wquat));
    }
    this.group.remove(p.object);
    this.world.add(p.object);
    // Loose, the part is the world's, not the car's: the distance detail's cuts (`CarDetail`) took its meshes off the camera while it was on the car.
    looseOnCamera(p.object);
    if (p.region) this.trackShell(p);
    // Where the part sits about the body's centre of mass (a wreck's masses' centroid, else the box's): the car's spin carries it at ω × r, whatever else it is thrown with.
    _com.copy(rigidCentre(this)).applyQuaternion(this.group.quaternion).add(this.group.position);
    _n.crossVectors(this.angular, _n.copy(wpos).sub(_com));
    p.object.position.copy(wpos);
    p.object.quaternion.copy(wquat);
    if (push) {
      p.velocity.copy(push).applyQuaternion(this.group.quaternion).add(this.velocity).add(_n);
    } else {
      _p.copy(wpos).sub(this.group.position).setY(0);
      if (_p.lengthSq() < 1e-6) _p.set(p.restPos.x, 0, p.restPos.z).applyQuaternion(this.group.quaternion);
      _p.normalize();
      p.velocity.copy(this.velocity).add(_n);
      p.velocity.addScaledVector(_p, 2.2 + Math.min(5, impulse * 0.06));
      p.velocity.y += 2.1 + p.hingeT * 1.2;
      p.object.position.addScaledVector(_p, 0.14);
      p.object.position.y += 0.08;
    }
    // A fixed hash of the part and the hit, not Math.random: a replay throws it the same way, so its dents land the same.
    const hash = (k: number): number => {
      const s = detSin((this.parts.indexOf(p) + 1) * 12.9898 + k * 78.233 + impulse * 0.37) * 43758.5453;
      return s - Math.floor(s) - 0.5;
    };
    // It leaves turning with the car, its own tumble on top.
    p.angular.set(hash(1) * 6, hash(2) * 5, hash(3) * 6).add(this.angular);
    if (p.hinge === "door") p.angular.y += (p.name === "doorL" ? -1 : 1) * (3.2 + p.hingeT * 2.4);
    else if (p.hinge === "cowl") p.angular.x -= 3.4;
    else if (p.hinge === "tail") p.angular.x += 3.4 * p.swing!.spec.dir;
  }

  /** The roof mass's rest height (m) on this car's frame: the baseline a sinking roof is measured from. */
  get roofRestY(): number {
    return this.frame.rig.masses.find((m) => m.name === "roof")!.rest[1];
  }

  /** 0 to 1 and over: how near the roof's sinking, or a hit this fast, is to shearing the light bar's mounts (`evaluateBreakage` tears it at 1). */
  private barLoad(): number {
    return Math.max((this.roofRestY - this.deform.massLocal("roof").y) / BAR_TEAR_SINK, this.deform.hitSpeedValue / BAR_TEAR_MPS);
  }

  /** A panel's shell, built if need be and bent to its hinge value on the current skin: attached (`onRoad`), its drop rests on the road under it. */
  protected shellPose(p: DetachPart, onRoad = true): void {
    this.openPanel(p);
    p.posed = p.hingeT;
    p.shellFlutter = detSin(this.deform.crushElapsed * 22);
    this.bendShell(p, onRoad ? this.shellFloor(p) : null);
  }

  /** Bend the open shell to its last pose's hinge value and flutter, its drop held off `floor` (`poseShell`; null: free of the road). */
  private bendShell(p: DetachPart, floor: Float64Array | null): void {
    p.held = poseShell(p.region!, (p.object as THREE.Mesh).geometry, this.body.geometry, p.posed, p.shellFlutter, floor);
  }

  /**
   * The road under arch shell `p` as `poseShell`'s `floor` in the body's frame: the plane the ground's height and normal under the
   * shell's middle give, lifted `SHELL_CLEAR`. Null for a quarter panel (it never drops) and with no ground under it.
   */
  private shellFloor(p: DetachPart): Float64Array | null {
    if (p.region!.kind === "quarter") return null;
    const frame = this.body.parent!;
    frame.updateWorldMatrix(true, false);
    const e = frame.matrixWorld.elements;
    const at = _floorAt.copy(p.region!.origin).applyMatrix4(frame.matrixWorld);
    const ground = activeGround();
    const gy = ground.heightAt(at.x, at.z, at.y);
    if (gy === NO_FLOOR) return null;
    const n = ground.normalAt(at.x, at.z, _floorN, at.y);
    _floor[0] = n.x * e[0]! + n.y * e[1]! + n.z * e[2]!;
    _floor[1] = n.x * e[4]! + n.y * e[5]! + n.z * e[6]!;
    _floor[2] = n.x * e[8]! + n.y * e[9]! + n.z * e[10]!;
    _floor[3] = n.x * (e[12]! - at.x) + n.y * (e[13]! - gy) + n.z * (e[14]! - at.z) - SHELL_CLEAR;
    return _floor;
  }

  /** A torn shell counts against the car's cap: past `LIVE_SHELLS` the oldest stops being drawn. */
  private trackShell(p: DetachPart): void {
    this.liveShells.push(p);
    if (this.liveShells.length > LIVE_SHELLS) this.liveShells.shift()!.object.visible = false;
  }

  /** First hinge or tear: the panel's shell joins the car (in the body's own frame: class lift, suspension pose) and its patch of body turns to primer. */
  protected openPanel(p: DetachPart): void {
    if (p.open) return;
    p.open = true;
    const mesh = p.object as THREE.Mesh;
    if (!mesh.geometry.getAttribute("position")) mesh.geometry = makeShell(p.region!, this.body.geometry);
    setPrimer(p.region!, this.body.geometry, true);
    this.body.parent!.add(mesh);
  }

  /** The panel is back on the car (reset): the shell leaves the scene and the body is paint again. */
  protected closePanel(p: DetachPart): void {
    p.open = false;
    p.held = false;
    p.object.visible = true;
    p.object.removeFromParent();
    const at = this.liveShells.indexOf(p);
    if (at >= 0) this.liveShells.splice(at, 1);
    setPrimer(p.region!, this.body.geometry, false);
  }

  /**
   * This car's torn parts and popped wheels (`stepLoose`): rigid bodies that land on the ground, the prisms and the other cars' tops, never this car's (`slot`).
   * `roofs` (the world's `CarSurfaces`): its `partMet` hears them meet another car's top, and a sleeper wakes only for a top whose car moves (`cars`).
   * `wheels` false: the parts only (a netplay client's wheels ride the host's poses on the wire; its parts are its own, debris is per player).
   */
  protected stepLooseParts(dt: number, slot: number, roofs: { readonly partMet: TopMet | undefined; readonly cars: readonly StirCar[] } | null, wheels = true): void {
    const met = roofs?.partMet;
    const cars = roofs?.cars ?? null;
    for (let k = 0; k < this.parts.length; k++) {
      const p = this.parts[k]!;
      // A torn shell past `LIVE_SHELLS` is hidden for good (until the reset): nothing to see, nothing to move.
      if (!p.detached || !p.object.visible) continue;
      if (stepLoose(p, dt, slot, p.dent, met, partMass(p), cars)) this.noteStirred(k);
      applyDents(p.dent, p.object);
    }
    if (!wheels) return;
    for (let k = 0; k < this.looseWheels.length; k++) if (this.looseWheels[k]!.loose && stepLoose(this.looseWheels[k]!, dt, slot, undefined, met, 0, cars)) this.noteStirred(PART_SLOTS + k);
  }

  private noteStirred(body: number): void {
    this.stirredBodies[body]! |= this.sliceBit;
    this.anyBodyStirred = true;
  }

  /** Loose body `body` (`stirredBodies`' index) wakes from sleep: a replay's stir, which its own world cannot make (a car it leaves out stirred it). A body the car does not have is ignored. */
  wakeBody(body: number): void {
    const shape = body < PART_SLOTS ? this.parts[body]?.shape : this.looseWheels[body - PART_SLOTS]?.shape;
    if (shape) shape.asleep = false;
  }

  /** Forgets the stirs of the step before (`stepWorld`, as a step begins). */
  clearStirredBodies(): void {
    if (!this.anyBodyStirred) return;
    this.stirredBodies.fill(0);
    this.anyBodyStirred = false;
  }

  /** Into `out` from index `n` on: the objects this car has put in the world instead of on its group, torn parts and popped wheels (`stepLooseParts` moves them). Returns the count past the last one written. */
  freeObjects(out: THREE.Object3D[], n: number): number {
    for (let k = 0; k < this.parts.length; k++) if (this.parts[k]!.detached && this.parts[k]!.object.visible) out[n++] = this.parts[k]!.object;
    for (let k = 0; k < this.looseWheels.length; k++) if (this.looseWheels[k]!.loose) out[n++] = this.looseWheels[k]!.object;
    return n;
  }

  /** Every part's object, torn or not, in `parts` order: what `PoseBlend` draws between two poses while the part is on the car (`partOn`). */
  partObjects(): THREE.Object3D[] {
    return this.parts.map((p) => p.object);
  }

  /** Part `i` of `partObjects` is still on the car (a torn one is a `freeObjects` body). */
  partOn(i: number): boolean {
    return !this.parts[i]!.detached;
  }

  /** A popped hub's wheel leaves the car: a world object launched at the hub's speed, out and up. */
  protected dropWheel(i: number, hub: MassName): void {
    const w = this.looseWheels[i]!;
    w.loose = true;
    this.group.updateMatrixWorld();
    w.object.getWorldQuaternion(_lampQ);
    this.group.remove(w.object);
    this.world.add(w.object);
    w.object.position.copy(this.deform.massWorld(hub));
    w.object.quaternion.copy(_lampQ);
    _p.copy(w.object.position).sub(this.group.position).setY(0);
    if (_p.lengthSq() > 1e-6) _p.normalize();
    w.velocity.copy(this.deform.massVel(hub)).addScaledVector(_p, 1.2);
    w.velocity.y = Math.max(w.velocity.y, 0) + 1;
    // Rolls on about its axle (the car's x) at the hub's ground speed.
    _n.set(1, 0, 0).applyQuaternion(this.group.quaternion);
    w.angular.copy(_n).multiplyScalar(hypot2(w.velocity.x, w.velocity.z) / this.frame.rig.tyre.r);
    fitWheelShape(w);
  }

  /** Netplay: array sizes for a `PartNetState`; parts are `PART_SLOTS` on every style (one shared layout). */
  partNetSizes(): { parts: number; lamps: number; glass: number; wheels: number } {
    return { parts: PART_SLOTS, lamps: this.lamps.length, glass: this.glassPanes.length, wheels: this.wheels.length };
  }

  /** Netplay host: part, lamp and glass state, and each loose part's world pose. */
  readPartNetState(out: PartNetState): void {
    out.flags.fill(0, this.parts.length);
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]!;
      const s = p.swing;
      out.flags[i] = (p.detached ? 1 : 0) | (p.folding ? 2 : 0) | (s?.latched ? 4 : 0);
      out.hinge[i * 3] = p.hingeT;
      // Parts with no swing leave slots 1 and 2 free: they carry the host's wind wear and dent cap (`1 − hingeMax`, so 0 is "uncapped"
      // and old data reads as before), which a headless replay re-simulating from a keyframe needs to tear the same parts at the same time.
      out.hinge[i * 3 + 1] = s ? s.theta : p.fatigue;
      out.hinge[i * 3 + 2] = s ? s.mirrorFold : 1 - p.hingeMax;
    }
    let lamps = 0;
    for (let i = 0; i < this.lamps.length; i++) if (this.lamps[i]!.intact) lamps |= 1 << i;
    out.lamps = lamps;
    out.glass = this.glassBits();
    let wheels = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      if (!this.looseWheels[i]!.loose) continue;
      wheels |= 1 << i;
      this.wheels[i]!.position.toArray(out.wheels, i * 7);
      this.wheels[i]!.quaternion.toArray(out.wheels, i * 7 + 3);
    }
    out.wheelLoose = wheels;
  }

  /** A part is off the car (a torn mirror, panel or bumper): its net state rides a highlight keyframe even if the car is no wreck. */
  hasLoosePart(): boolean {
    for (let i = 0; i < this.parts.length; i++) if (this.parts[i]!.detached) return true;
    return false;
  }

  /** The parts' sim state as doubles (`part-state.ts`): the replay keyframe's. */
  partState(buf: Float64Array, write: boolean): void {
    partState(this, this.parts, buf, write);
  }

  /** The torn parts' and popped wheels' bodies as doubles (`part-state.ts`): the replay keyframe's. Returns the numbers used. */
  looseState(buf: Float64Array, write: boolean): number {
    return looseState(this.parts, this.looseWheels, buf, write);
  }
}
