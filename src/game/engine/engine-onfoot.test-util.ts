import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { tapOnFoot } from "../hud/touch-scheme.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { setGround } from "../world/ground.ts";
import type { Walker } from "../present/ragdoll-walker.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, pressKey, stubBrowser } from "./engine-headless.test-util.ts";
import { doorSpot } from "./onfoot-doors.ts";

export const FRAME = 1 / FRAME_HZ;
/** The climb out and the climb in (`OnFootFlow`), plus a frame's slack (s). */
const CLIMB_OUT_S = 0.9;
const CLIMB_IN_S = 0.7;
/** The longest a get-up may take from lying still (s): its lie, the slowest route, and a retry's slack. */
const GET_UP_LIMIT_S = 12;
/** The walk's steering: keys are re-chosen every burst (s), and a direction counts as a key's when its share of the way is past this. */
const BURST_S = 0.2;
const KEY_SHARE = 0.38;
/** How far short of the walker the car that runs him down starts (m), how far outward of him it is aimed (m: clear of his own car's flank), and its speed (m/s). */
const RUN_UP_M = 5;
const OUTWARD_M = 0.3;
const HIT_MPS = 5;
/** How far out from his door he walks first (m), so the last stretch to it is clear of the car's body. */
const APPROACH_M = 1.5;
/** The longest walk back to his door a test allows (s): a car's blow flings him tens of metres and he walks 1.3 m/s. */
const WALK_BACK_LIMIT_S = 45;
/** The failure message lists the cars within this many metres of him. */
const NEAR_REPORT_M = 8;
/** The fleet's crash loop: car 0 counts as stopped under this speed (m/s), checked every step (s), for at most this long (sim s). */
const LOOP_STOPPED_MPS = 0.2;
const LOOP_STEP_S = 0.25;
const LOOP_STOPS_WITHIN_S = 40;

const _forward = new THREE.Vector3();
const _spot = new THREE.Vector3();

/** The real engine, headless, with the Rapier world of its dummies in, and the moves a player makes on foot. One per test file: a second `CrashEngine` in a process never resolves `ready`. */
export class OnFootRig {
  readonly engine: CrashEngine;

  private constructor(engine: CrashEngine) {
    this.engine = engine;
  }

  static async boot(): Promise<OnFootRig> {
    stubBrowser();
    const engine = await bootEngine({ pacer: true });
    engine.autoSlomo = false;
    await engine["ragdolls"].preload();
    return new OnFootRig(engine);
  }

  run(seconds: number): void {
    this.engine.advance(seconds, { frameDt: FRAME });
  }

  press(code: string): void {
    pressKey(this.engine, code);
    this.engine["keys"].delete(code);
  }

  /** `code` held for `seconds`. */
  hold(code: string, seconds: number): void {
    this.engine["keys"].add(code);
    this.run(seconds);
    this.engine["keys"].delete(code);
  }

  cars(): DeformableCar[] {
    return this.engine["live"]();
  }

  walker(): Walker {
    return this.engine["ragdolls"].walker;
  }

  /** His torso as drawn this frame (a fresh vector). */
  torso(): THREE.Vector3 {
    const at = new THREE.Vector3();
    assert.ok(this.engine["ragdolls"].walkerTorso(at), "he is out");
    return at;
  }

  phase(): string {
    return this.engine["onFoot"].flow.phase;
  }

  /** The car he left, or -1. */
  away(): number {
    return this.engine["onFoot"].away;
  }

  /** The seat takes car `index` at the wheel. */
  sit(index: number): void {
    this.engine["seat"].focus(index);
    this.engine["seat"].mode = "drive";
  }

  /** Car `index` at rest at (x, z) facing +z, and drawn: a car an earlier row drove off the disc was vaporized and hidden, which `spawnFacing` alone does not undo. */
  place(index: number, x: number, z: number): void {
    const car = this.cars()[index]!;
    car.spawnFacing(x, z, 0, 0);
    car.group.visible = true;
  }

  /**
   * The fleet's own loop as a player meets it, slow motion and all: the scene rolled again from `seed` (`engine.reset()`, which launches the cars at each other),
   * the seat on car 0, and the engine run until car 0 has stopped in the crash (the loop's slow motion makes that 5 to 20 s of wall time). The seeds are the loop's;
   * each rolls the same crash. `normalTime` ends it.
   */
  stoppedInFleetLoop(seed: number): DeformableCar {
    this.engine.autoSlomo = true;
    this.engine["pinnedSeed"] = seed;
    this.engine.reset();
    this.engine["pinnedSeed"] = null;
    this.sit(0);
    const car = this.cars()[0]!;
    for (let t = 0; t < LOOP_STOPS_WITHIN_S && car.velocity.length() > LOOP_STOPPED_MPS; t += LOOP_STEP_S) this.run(LOOP_STEP_S);
    assert.ok(car.velocity.length() <= LOOP_STOPPED_MPS, `car 0 stopped in the loop of seed ${seed}: ${car.velocity.length().toFixed(2)} m/s`);
    return car;
  }

  /** Time at its own pace, and the engine's automatic slow motion off: a crash earlier in the file does not stretch a later row's seconds. */
  normalTime(): void {
    const clock = this.engine["clock"];
    this.engine.autoSlomo = false;
    clock.userTimeScale = null;
    clock.targetScale = 1;
    clock.timeScale = 1;
    clock.phase = "approach";
  }

  /** Enter in the driving seat, then the climb: he stands on foot beside the door. */
  getOut(): void {
    this.press("Enter");
    this.run(CLIMB_OUT_S);
    assert.equal(this.phase(), "onFoot", `the climb out is over (he was told: ${this.engine["onFoot"].flow.refusal})`);
  }

  /** The touch HUD's Out / In button tapped once, and the frames after it. */
  tapOnFoot(seconds: number): void {
    tapOnFoot(this.engine.touch);
    this.run(seconds);
  }

  /** A point on the level, `out` m further out from `car`'s driver door (away from its middle) and `along` m ahead of it: somewhere to walk to that is not through the car. */
  beside(car: DeformableCar, out: number, along: number): THREE.Vector3 {
    const door = doorSpot(car, new THREE.Vector3());
    const away = door.clone().sub(car.group.position).setY(0).normalize();
    car.group.getWorldDirection(_forward);
    _forward.y = 0;
    _forward.normalize();
    return door.addScaledVector(away, out).addScaledVector(_forward, along);
  }

  /** Walks toward `target` with the driving keys in bursts until his torso is within `within` m of it on the level. */
  walkTo(target: THREE.Vector3, within: number, limitSeconds: number): void {
    const keys = this.engine["keys"];
    const eye = this.engine["camera"].position;
    const look = this.engine["view"].look;
    for (let t = 0; t < limitSeconds; t += BURST_S) {
      const at = this.torso();
      const gap = Math.hypot(target.x - at.x, target.z - at.z);
      keys.clear();
      if (gap < within) return;
      const reach = Math.hypot(look.x - eye.x, look.z - eye.z) || 1;
      const fx = (look.x - eye.x) / reach;
      const fz = (look.z - eye.z) / reach;
      const ahead = ((target.x - at.x) * fx + (target.z - at.z) * fz) / gap;
      const across = ((target.x - at.x) * -fz + (target.z - at.z) * fx) / gap;
      if (ahead > KEY_SHARE) keys.add("KeyW");
      else if (ahead < -KEY_SHARE) keys.add("KeyS");
      if (across > KEY_SHARE) keys.add("KeyD");
      else if (across < -KEY_SHARE) keys.add("KeyA");
      this.run(BURST_S);
    }
    keys.clear();
    const at = this.torso();
    const near: string[] = [];
    for (const [i, car] of this.cars().entries()) {
      const gap = Math.hypot(car.group.position.x - at.x, car.group.position.z - at.z);
      if (gap < NEAR_REPORT_M) near.push(`car ${i} ${gap.toFixed(1)} m at ${car.group.position.x.toFixed(1)}, ${car.group.position.z.toFixed(1)} going ${car.velocity.length().toFixed(1)} m/s`);
    }
    assert.fail(`he did not reach within ${within} m of (${target.x.toFixed(1)}, ${target.z.toFixed(1)}) in ${limitSeconds} s, he stands at ${at.x.toFixed(1)}, ${at.z.toFixed(1)} (${this.walker().state}); near him: ${near.join("; ") || "no car"}`);
  }

  /**
   * `hitter` is put `runUp` m short of where he stands and driven through him at `mps` along his own car's heading (`from` "behind" his car:
   * toward its nose) or against it (`from` "ahead": toward its tail, where the car's back is to a wall), a little outward of him so it clears
   * the car he left. The car must be one nobody drives, or one that holds its speed (a coasting fleet car); a car that brakes (a derby grid's) needs
   * the speed and the short run-up to reach him above `STRIKE_SPEED` still.
   */
  runDownBy(hitter: DeformableCar, own: DeformableCar, from: "behind" | "ahead" = "behind", mps = HIT_MPS, runUp = RUN_UP_M): void {
    const torso = this.torso();
    own.group.getWorldDirection(_forward);
    _forward.y = 0;
    _forward.normalize();
    const side = Math.sign((torso.x - own.group.position.x) * _forward.z - (torso.z - own.group.position.z) * _forward.x) || 1;
    const way = from === "behind" ? 1 : -1;
    const dx = _forward.x * way;
    const dz = _forward.z * way;
    _spot.set(torso.x + dz * side * OUTWARD_M - dx * runUp, 0, torso.z - dx * side * OUTWARD_M - dz * runUp);
    hitter.spawnFacing(_spot.x, _spot.z, Math.atan2(dx, dz), mps);
    hitter.group.position.y = own.group.position.y;
    hitter.group.updateMatrixWorld(true);
  }

  /** Walking controls held (his own, as ever) until he stands again after a fall; fails when he does not within `GET_UP_LIMIT_S`. */
  getUp(): void {
    const walker = this.walker();
    this.engine["keys"].add("KeyW");
    for (let t = 0; t < GET_UP_LIMIT_S && walker.state !== "stand"; t += BURST_S) this.run(BURST_S);
    this.engine["keys"].clear();
    assert.equal(walker.state, "stand", `he is up: ${walker.state}`);
  }

  /** Walks to `car`'s driver door by a point out from it, so he does not walk into the body. */
  walkToDoor(car: DeformableCar): void {
    const door = doorSpot(car, new THREE.Vector3());
    const outside = door.clone().sub(car.group.position).setY(0).normalize().multiplyScalar(APPROACH_M).add(door);
    this.walkTo(outside, 1, WALK_BACK_LIMIT_S);
    this.walkTo(door, 1.3, 10);
  }

  /** Walks to the driver's door of the car he left and presses Enter: he is in the seat and has the wheel. */
  getIn(): void {
    const index = this.away();
    this.walkToDoor(this.cars()[index]!);
    this.press("Enter");
    this.run(CLIMB_IN_S);
    assert.equal(this.phase(), "inCar", "the climb in is over");
    assert.equal(this.engine["seat"].mode, "drive", "the seat has the wheel");
    assert.equal(this.engine["seat"].carIndex, index, "his own car");
  }

  dispose(): void {
    this.engine.dispose();
    setGround(null);
  }
}
