import * as THREE from "three";
import type { DeformableCar } from "./car.ts";
import type { ExitPane } from "./car-core.ts";
import { DRIVER_SIDE } from "./constants.ts";
import { CLASSES, killClass, killTravel } from "./vehicle-classes.ts";

/** Samples per car, one per `SAMPLE` s of sim time (`SAMPLE_HZ`): 0.53 s, past `PRE`. */
const RING = 32;
/** A sample is the car's world velocity (x, y, z) and its turn rate (x, y, z, rad/s) at these offsets. */
const VELOCITY_X = 0;
const VELOCITY_Y = 1;
const VELOCITY_Z = 2;
const SPIN_X = 3;
const SAMPLE_STRIDE = 6;
const SAMPLE_HZ = 60;
const SAMPLE = 1 / SAMPLE_HZ;
/** How far back (s) "before the hit" is: the block dies 25-40 ms into a frontal hit, a derby kill up to 0.3 s after its last contact. */
const PRE = 0.35;
/** Sim s a sample stamped at the step the hit began may sit past the hit's own clock: the watch and the deform state sum their steps apart. */
const HIT_STAMP_SLACK = 1e-6;
/** A car whose centre is within this (m) of the impact point is the one that hit; none: a wall. */
const OTHER_REACH = 3.5;
/**
 * Closing speed (m/s) the disabling hit needs to throw the driver out: the peak, over the `PRE` s before the
 * drivetrain died, of how fast the striker (the nearest car to the impact point, or a wall at rest) came at this
 * car along the hit's inward normal. It tracks the contact code's own `impulse`.
 * Lane ragdoll's probe: every single-hit frontal kill closed at >= 15.6 (56 km/h wall; 2x56 head-on 31.1, 40 %
 * offset at 64 17.8). The 20 derby kills over five six-car heats were 16 tail, 4 side, 0 front; the side ones
 * peaked at 9.8, 7.9, 6.8 and 1.9 m/s here (`impulse` 7.2-10.6). 6 m/s (22 km/h) throws on every frontal kill
 * and a solid side blow, not on a car shoved into its last bit of wear.
 */
const EJECT_CLOSING = 6;

/**
 * Barrier speed (m/s) of the slowest square hit that throws the driver of a durability-1 car (a sedan): it packs the
 * block to `killTravel` at realism 1, whatever the HUD's realism. Measured into the range's barrier at the HUD's
 * defaults: lane ragdoll's probe 56 km/h, lane ragdoll-glass (1 km/h steps) 55 km/h (15.3 m/s). A class's is this ×
 * √durability (`killSpeed`): measured 58 km/h muscle, 60 truck and police, 68 monster against the root's 60, 63, 64
 * and 73, so it errs 2-5 km/h high for the tough ones.
 */
const KILL_EBS = 15.6;

/**
 * The barrier speed (m/s) at which a square hit throws `car`'s driver (`KILL_EBS` × √ its kill class's durability): the
 * sandbox's slow-mo predicts a throw by it (`throwComing`), and a running car takes a fresh hit on its nose or a door at
 * its share of the closing against it (`EjectionWatch`), as hard a blow to him as the nose-first kill.
 */
export function killSpeed(car: DeformableCar): number {
  return KILL_EBS * Math.sqrt(CLASSES[killClass(car)].durability);
}

/** The share of its `killSpeed` the closing must reach to throw a car whose drivetrain still runs (a packed block, a fresh hit on its nose or a door): drivers went out "a little too easy" when the engine did not die at 1, and nobody went out at 1.05 (owner, 2026-10-19: halfway back). */
const ALIVE_CLOSING_SHARE = 1.025;

/** The closing speed (m/s) at which a hit on `car` throws its driver: `EJECT_CLOSING` with a dead drivetrain, else its `killSpeed`, × `ALIVE_CLOSING_SHARE` outside a mini game. */
export function ejectThreshold(car: DeformableCar, minigame: boolean): number {
  if (!car.deform.drivetrainAlive) return EJECT_CLOSING;
  return minigame ? killSpeed(car) : ALIVE_CLOSING_SHARE * killSpeed(car);
}

/**
 * A hit is square on a door, for the slam throw, when its inward normal's across-the-car part is over this × its
 * along-the-car part: within 27 degrees of straight in from the side (owner, 2026-10-07: the case is a car sliding in
 * sideways). A front- or rear-quarter hit stays a frontal one's (a kill): with the side window at 45 degrees, police
 * cruisers driving into race walls 13-45 degrees off at 9-42 m/s threw 12 drivers out of a door in 10 seeded oval and
 * stunt races (main: none).
 */
const DOOR_SQUARE = 2;

/** The throw: out of the pane along the car's nose (its pitch too), up over his seat's own motion, and a somersault over his shoulder line (owner, 2026-10-02: arcade, set by eye). */
export const THROW_OUT = 3;
const THROW_UP = 3.5;
const TUMBLE = 3;
/** Roll (rad/s) every thrown driver leaves with about his line of flight (presentation, `RagdollSystem.launch`): 240° or more of it before the range throw's first touch, his limbs dropping as he turns (owner: a barrel roll he can see in the slow-mo). */
export const EJECT_ROLL = 16;
/** Head centre above the torso's, once he leans out (m): the dummy's `PARTS` head 0.52 m over the torso. */
const HEAD_UP = 0.52;
/** Head first out of the pane, superman style: 80 degrees from upright toward the exit, chest down. */
const LEAN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (80 * Math.PI) / 180);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * A driver thrown out of a car: where and how, enough to launch the same dummy again (the live ragdoll, a highlight
 * replay, a netplay peer). Every number is f32-exact (`Math.fround`), so the copy that crossed the wire or sat in a
 * saved clip is the one the host launched. When it happened is its holder's stamp (a clip's step, a message's clock).
 */
export type Ejection = {
  /** Car slot (index into the live cars). */
  car: number;
  exit: ExitPane;
  /** A police driver (his uniform). */
  cop: boolean;
  /** The torso's centre as he leaves, in the world and in the car's frame. */
  pos: THREE.Vector3;
  local: THREE.Vector3;
  /** Unit vector out of the pane, in the world. */
  dir: THREE.Vector3;
  /** The torso's orientation, leaning out head first. */
  quat: THREE.Quaternion;
  /** His velocity relative to the car (world axes, m/s), and the car's own that step: his own is their sum. */
  rel: THREE.Vector3;
  carVel: THREE.Vector3;
  /** The somersault (world rad/s). */
  spin: THREE.Vector3;
};

/** A fresh event record (decoders fill it). */
export function blankEjection(): Ejection {
  return {
    car: 0,
    exit: "windshield",
    cop: false,
    pos: new THREE.Vector3(),
    local: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    rel: new THREE.Vector3(),
    carVel: new THREE.Vector3(),
    spin: new THREE.Vector3(),
  };
}

/** The dummy's launch velocity (world, m/s) from an event: the car's plus his own. */
export function ejectionVelocity(e: Ejection, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(e.carVel).add(e.rel);
}

const _qx = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _out = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _pre = new THREE.Vector3();
const _seat = new THREE.Vector3();
const _spin = new THREE.Vector3();
const NONE: readonly Ejection[] = [];

const f32 = (v: THREE.Vector3): THREE.Vector3 => v.set(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));

/** Car `i`'s driver leaving through `exit`, as the sim has the car now, with his seat's motion at the hit: the car's centre velocity `v` and turn rate `w` (world) then. */
function launch(car: DeformableCar, i: number, exit: ExitPane, v: THREE.Vector3, w: THREE.Vector3): Ejection {
  const e = blankEjection();
  const g = car.group;
  e.car = i;
  e.exit = exit;
  e.cop = car.style.id === "police";
  // The way out: z out of the pane (a side throw is the windshield's turned a quarter about the car's up). Leaning
  // out along it, his shoulders stay level, so they fit the side window's height.
  const side = exit === "windshield" ? 0 : exit === "doorL" ? -1 : 1;
  _qx.setFromAxisAngle(Y, (side * Math.PI) / 2).multiply(LEAN);
  e.quat.copy(g.quaternion).multiply(_qx);
  e.quat.set(Math.fround(e.quat.x), Math.fround(e.quat.y), Math.fround(e.quat.z), Math.fround(e.quat.w));
  _out.set(side, 0, side === 0 ? 1 : 0).applyQuaternion(g.quaternion);
  e.dir.copy(_out);
  f32(e.dir);
  // Car-local: on the pane's height (a windshield's on the driver's side, `DRIVER_SIDE`), the torso down the lean behind it,
  // so he leaves through the opening, clear of the bonnet or door below and the roof above.
  car.glassWorld(exit, _p).sub(g.position).applyQuaternion(_inv.copy(g.quaternion).invert());
  const paneY = _p.y;
  if (side === 0) _p.x += DRIVER_SIDE * 0.25;
  _p.addScaledVector(_up.set(0, 1, 0).applyQuaternion(_qx), -HEAD_UP);
  _p.y = paneY;
  e.local.copy(_p);
  f32(e.local);
  e.pos.copy(_p).applyQuaternion(g.quaternion).add(g.position);
  f32(e.pos);
  // Tumble: a somersault over his shoulder line (the car's x axis out of the windshield, its z axis out of a side).
  e.spin.set(side === 0 ? 1 : 0, 0, side === 0 ? 0 : -side).applyQuaternion(g.quaternion).multiplyScalar(TUMBLE);
  f32(e.spin);
  f32(e.carVel.copy(car.velocity));
  // His seat's velocity: the car's centre's plus its turn about it, so a nose rocking up as it hits lifts him.
  _v.crossVectors(w, _seat.copy(e.pos).sub(g.position)).add(v).addScaledVector(_out, THROW_OUT);
  _v.y += THROW_UP;
  f32(e.rel.copy(_v).sub(e.carVel));
  return e;
}

/**
 * Watches every car for a hit that throws its driver out. A disabling hit (the drivetrain dying, `drivetrainAlive`:
 * derby engine-kill and wreck, race DNF by damage; or the block packed as far as kills it at the realistic end of the
 * slider, whatever the slider) throws him when it closed fast enough (`EJECT_CLOSING`), head-on or from the side, never
 * from behind. A running car's fresh hit on its nose, or square on a door (`DOOR_SQUARE`), throws him out of that pane
 * when its share of the closing by the other's mass (all of it into a wall) reaches the alive bar (`ejectThreshold`):
 * the closing is the blow to him, the block's travel only the drivetrain's (owner, 2026-10-19: a police car nose-first at
 * 160 km/h into a parked car, and the car it T-boned, both stayed in). A side blow never packs the block (owner,
 * 2026-10-07: a handbrake slide sideways into a wall). A car trading doors at speed with a car alongside stays in. The
 * decision is SIM state: `step` runs once per fixed step, at the end of `stepWorld`, on the step's own dt, and reads
 * only the cars' deform state, poses and velocities, so the same steps give the same ejections on every run at every
 * frame rate. A hit that throws sets `car.driverOut` (until the car is put back: `resetVisual`) and queues an
 * `Ejection` for `take`. Clients never run it: the flag rides the snapshot, the event its own message. Either way the
 * hit is a fresh one on that car, begun (`beginCrush`, a re-armed `rearmHit`) at most `PRE` s ago: a drivetrain that
 * dies with no new hit, long after the one whose normal is still in its deform state, is a damaged car on a crest or a
 * bank, not a throw, and so is a graze that only touched it.
 */
export class EjectionWatch {
  /** Kill context (`armKill`'s): a derby's limits or anywhere else's; the engine sets it per scene. */
  ctx: "derby" | "default" = "default";
  /** A mini game's run: the long jump is built around its barrier throw, so a running car keeps the bare `killSpeed` bar. */
  minigame = false;
  private cap = 0;
  private vel = new Float32Array(0);
  /** Each sample's time on the watch's clock (sim s). */
  private stamp = new Float64Array(0);
  private head = new Int32Array(0);
  private count = new Int32Array(0);
  /** Each car's orientation (x, y, z, w) at the last step, and its turn rate (world rad/s) over that step: the eased pitch and roll as well as the yaw. */
  private turn = new Float64Array(0);
  private spin = new Float64Array(0);
  /** -1 unseen, 0 disabled, 1 intact. */
  private alive = new Int8Array(0);
  private acc = 0;
  private clock = 0;
  private pending: Ejection[] = [];

  private grow(n: number): void {
    this.cap = n;
    this.vel = new Float32Array(n * RING * SAMPLE_STRIDE);
    this.stamp = new Float64Array(n * RING);
    this.head = new Int32Array(n);
    this.count = new Int32Array(n);
    this.turn = new Float64Array(n * 4);
    this.spin = new Float64Array(n * 3);
    this.alive = new Int8Array(n).fill(-1);
  }

  /** A new run (a race start, a scene reset): no history, no pending events. */
  reset(): void {
    this.head.fill(0);
    this.count.fill(0);
    this.alive.fill(-1);
    this.acc = 0;
    this.pending = [];
  }

  /**
   * Before the world moves the cars: a car with no history yet (just placed or put back) gets its launch velocity as its
   * one sample, so a kill within its first step still has a pre-hit closing speed (the post-hit velocity is already slowed).
   */
  seed(cars: readonly DeformableCar[]): void {
    const n = cars.length;
    if (n > this.cap) this.grow(n);
    for (let i = 0; i < n; i++) {
      if (this.count[i]! > 0) continue;
      const car = cars[i]!;
      const o = i * RING * SAMPLE_STRIDE;
      this.vel.fill(0, o, o + SAMPLE_STRIDE);
      this.vel[o + VELOCITY_X] = car.velocity.x;
      this.vel[o + VELOCITY_Y] = car.velocity.y;
      this.vel[o + VELOCITY_Z] = car.velocity.z;
      this.stamp[i * RING] = this.clock;
      const q = car.group.quaternion;
      const t = i * 4;
      this.turn[t] = q.x;
      this.turn[t + 1] = q.y;
      this.turn[t + 2] = q.z;
      this.turn[t + 3] = q.w;
      this.spin.fill(0, i * 3, i * 3 + 3);
      this.head[i] = 1;
      this.count[i] = 1;
    }
  }

  /**
   * Throws car `index`'s driver out of the windshield now, whatever the car has hit (a scene that stages the throw, a ramp's lip):
   * the launch is `judge`'s, from his seat's motion now (no look-back). A car that is falling, vaporized or already thrown out
   * gives nothing, so a second call is a no-op until the car is put back (`resetVisual`).
   */
  throwDriverNow(cars: readonly DeformableCar[], index: number): void {
    const car = cars[index]!;
    if (car.falling || car.vaporized || car.driverOut !== null) return;
    if (cars.length > this.cap) this.grow(cars.length);
    car.driverOut = "windshield";
    this.pending.push(launch(car, index, "windshield", _pre.copy(car.velocity), _spin.fromArray(this.spin, index * 3)));
    car.smashGlass("windshield");
  }

  /** The events since the last call, oldest first (a shared empty array when there are none). */
  take(): readonly Ejection[] {
    if (this.pending.length === 0) return NONE;
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** One fixed step of `dt` sim seconds, after the world moved the cars. */
  step(cars: readonly DeformableCar[], dt: number): void {
    const n = cars.length;
    if (n > this.cap) this.grow(n);
    this.acc += dt;
    this.clock += dt;
    const sample = this.acc >= SAMPLE;
    if (sample) this.acc %= SAMPLE;
    for (let i = 0; i < n; i++) this.turnRate(cars[i]!, i, dt);
    for (let i = 0; i < n; i++) {
      const car = cars[i]!;
      if (car.falling || car.vaporized) continue;
      // Disabled, or the block packed past the context's kill travel at the realistic end (the sourced 0.15 m x
      // durability, x the derby scale in one). At the HUD's default realism (0.25) a fleet sedan dies only at 0.45 m
      // and one head-on tops out at 0.36 m from 2x24 m/s up: without this no race or sandbox car is ever disabled by one hit.
      const now = car.deform.drivetrainAlive && car.deform.engineTravel < killTravel(killClass(car), 1, this.ctx) ? 1 : 0;
      const was = this.alive[i]!;
      this.alive[i] = now;
      if (car.driverOut !== null || car.deform.sinceHit() > PRE + dt) continue;
      const ix = Math.abs(car.deform.impactInward.x);
      const iz = car.deform.impactInward.z;
      if (was === 1 && now === 0) this.judge(cars, i, true);
      else if (now === 1 && car.deform.massActive && (ix > DOOR_SQUARE * Math.abs(iz) || -iz >= ix)) this.judge(cars, i, false);
    }
    if (!sample) return;
    for (let i = 0; i < n; i++) {
      const s = i * RING + this.head[i]!;
      const o = s * SAMPLE_STRIDE;
      this.vel[o + VELOCITY_X] = cars[i]!.velocity.x;
      this.vel[o + VELOCITY_Y] = cars[i]!.velocity.y;
      this.vel[o + VELOCITY_Z] = cars[i]!.velocity.z;
      this.vel[o + SPIN_X] = this.spin[i * 3]!;
      this.vel[o + SPIN_X + 1] = this.spin[i * 3 + 1]!;
      this.vel[o + SPIN_X + 2] = this.spin[i * 3 + 2]!;
      this.stamp[s] = this.clock;
      this.head[i] = (this.head[i]! + 1) % RING;
      this.count[i] = Math.min(RING, this.count[i]! + 1);
    }
  }

  /** Car i's turn since the last step, q · q₀⁻¹, as a world rate over `dt`: twice its vector part over dt, the shorter way round. */
  private turnRate(car: DeformableCar, i: number, dt: number): void {
    const q = car.group.quaternion;
    const t = i * 4;
    const bx = -this.turn[t]!;
    const by = -this.turn[t + 1]!;
    const bz = -this.turn[t + 2]!;
    const bw = this.turn[t + 3]!;
    const w = q.w * bw - q.x * bx - q.y * by - q.z * bz;
    const k = (w < 0 ? -2 : 2) / dt;
    this.spin[i * 3] = (q.w * bx + q.x * bw + q.y * bz - q.z * by) * k;
    this.spin[i * 3 + 1] = (q.w * by - q.x * bz + q.y * bw + q.z * bx) * k;
    this.spin[i * 3 + 2] = (q.w * bz + q.x * by - q.y * bx + q.z * bw) * k;
    this.turn[t] = q.x;
    this.turn[t + 1] = q.y;
    this.turn[t + 2] = q.z;
    this.turn[t + 3] = q.w;
  }

  /** Car i's velocity and turn rate into `_pre` and `_spin` as its hit began: the newest sample from before it (the oldest kept if none is). */
  private atHit(car: DeformableCar, i: number): void {
    const began = this.clock - car.deform.sinceHit() + HIT_STAMP_SLACK;
    let k = 1;
    while (k < this.count[i]! && this.stamp[i * RING + ((this.head[i]! - k + RING) % RING)]! > began) k++;
    const o = (i * RING + ((this.head[i]! - k + RING) % RING)) * SAMPLE_STRIDE;
    _pre.set(this.vel[o + VELOCITY_X]!, this.vel[o + VELOCITY_Y]!, this.vel[o + VELOCITY_Z]!);
    _spin.set(this.vel[o + SPIN_X]!, this.vel[o + SPIN_X + 1]!, this.vel[o + SPIN_X + 2]!);
  }

  /** Car i was just disabled (`killed`), or runs on in a fresh hit on its nose or square on a door: was that hit head-on or from the side, and hard enough (`ejectThreshold`)? */
  private judge(cars: readonly DeformableCar[], i: number, killed: boolean): void {
    const car = cars[i]!;
    // The struck end: inward points from the contact into the car.
    const ix = car.deform.impactInward.x;
    const iz = car.deform.impactInward.z;
    let exit: ExitPane;
    if (Math.abs(ix) > Math.abs(iz)) exit = ix > 0 ? "doorL" : "doorR";
    else if (iz < 0) exit = "windshield";
    else return;
    if (this.peakClosing(cars, i, killed) < ejectThreshold(car, this.minigame)) return;
    car.driverOut = exit;
    this.atHit(car, i);
    this.pending.push(launch(car, i, exit, _pre, _spin));
    car.smashGlass(exit);
  }

  /** The closing speed of car i's hit, peak over the `PRE` s before it: a kill's is the pair's; a running car's is its own share of it by the other's mass (all of it into a wall), the barrier speed `killSpeed` is. */
  private peakClosing(cars: readonly DeformableCar[], i: number, killed: boolean): number {
    const car = cars[i]!;
    _n.copy(car.deform.impactInward).applyQuaternion(car.group.quaternion);
    let other = -1;
    _hit.copy(car.deform.impactLocal).applyQuaternion(car.group.quaternion).add(car.group.position);
    let best = OTHER_REACH;
    for (let j = 0; j < cars.length; j++) {
      if (j === i) continue;
      const d = cars[j]!.group.position.distanceTo(_hit);
      if (d < best) {
        best = d;
        other = j;
      }
    }
    const share = killed || other < 0 ? 1 : CLASSES[killClass(cars[other]!)].mass / (CLASSES[killClass(car)].mass + CLASSES[killClass(cars[other]!)].mass);
    // Peak over the samples since PRE s back: the cars were still closing (or speeding up into it) until contact.
    const back = Math.min(this.count[i]!, other >= 0 ? this.count[other]! : RING, Math.round(PRE / SAMPLE));
    let closing = -Infinity;
    for (let k = 1; k <= back; k++) {
      const a = (i * RING + ((this.head[i]! - k + RING) % RING)) * SAMPLE_STRIDE;
      let c = -(this.vel[a + VELOCITY_X]! * _n.x + this.vel[a + VELOCITY_Z]! * _n.z);
      if (other >= 0) {
        const b = (other * RING + ((this.head[other]! - k + RING) % RING)) * SAMPLE_STRIDE;
        c = share * (c + this.vel[b + VELOCITY_X]! * _n.x + this.vel[b + VELOCITY_Z]! * _n.z);
      }
      if (c > closing) closing = c;
    }
    // A running car with no car at the hit (a wall, a prop it knocks aside, nothing): the blow is only the speed it lost into the hit.
    if (!killed && other < 0) return Math.min(closing, closing + car.velocity.x * _n.x + car.velocity.z * _n.z);
    return closing;
  }
}
