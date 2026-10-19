import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import type { HighlightClip } from "../match/highlights.ts";
import { WHEEL_POS } from "../vehicle/car-mesh.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { CRASH_GAP, CRASH_SPEED } from "./engine-bench-replay.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
const RULES = { trackId: TRACK_ID.city, laps: 1, aiCount: 3, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false };
const HUBS = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;
/** The second car's offset (m) to the first's right: an offset head-on pops the struck corners' hubs (C4); a full-width one stops at the packed stroke, short of them. */
const CRASH_OFFSET = 0.8;
/** The longest a round takes to go green and the staged head-on to be filed (s). */
const GREEN_WAIT_S = 20;
const CLIP_WAIT_S = 20;
/** A thrown wheel leaves its hub at 1.2 m/s out and 1 m/s up over the hub's own speed (`dropWheel`): from this long after (sim s) it is off the hub's seat. */
const CLEAR_S = 0.3;
/** A lost wheel never drawn farther than this from its seat on the car, along the ground (m), stayed on its hub: one re-seated each step reads 2 cm, the head-on's thrown wheels 34 cm and more. */
const LEFT_SEAT_M = 0.1;
/** The solo view's hold after a clip's last frame (`SOLO_HOLD`, s): a pass is the clip's wall time and this. */
const SOLO_HOLD_S = 1.5;
/** The batch's matrices are float32: a wheel's place a few hundred metres out is stored within this (m). */
const FLOAT32_SLACK = 1e-3;

/** What the drawn frames showed: the wheels seen lost (`car:wheel`, the car by its place in the field), the farthest each was drawn from its seat after `CLEAR_S`, and every frame whose batch drew a wheel twice or where no shown wheel is. */
type Frames = { frames: number; lost: Set<string>; farthest: Map<string, number>; faults: string[] };

/** Where the car seats wheel `k` (`followHubs`): its hub along the car (its rest seat while the car is rigid), at the rest ride's height, in world. */
function seatOf(car: DeformableCar, k: number, out: THREE.Vector3): THREE.Vector3 {
  const rest = WHEEL_POS[k]!;
  if (car.deform.massActive) {
    const hub = car.deform.massLocal(HUBS[k]!);
    out.set(hub.x, rest[1], hub.z);
  } else out.set(rest[0], rest[1], rest[2]);
  return car.group.localToWorld(out);
}

/**
 * Reads every drawn frame of the engine's own scene: the wheel batch packed as the renderer's pre-draw hook packs it, each instance
 * matched to the one shown wheel drawn there, and per lost wheel of `cars()` (timed by the sim clock `now()`) how near its seat it is drawn.
 */
class LostWheelWatch {
  private readonly since = new Map<THREE.Object3D, number>();
  private readonly drawn: THREE.Vector3[] = [];
  private readonly wheels: THREE.Vector3[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly seat = new THREE.Vector3();
  readonly out: Frames = { frames: 0, lost: new Set(), farthest: new Map(), faults: [] };
  private readonly engine: CrashEngine;
  private readonly cars: () => readonly DeformableCar[];
  private readonly now: () => number;

  constructor(engine: CrashEngine, cars: () => readonly DeformableCar[], now: () => number) {
    this.engine = engine;
    this.cars = cars;
    this.now = now;
  }

  frame(): void {
    this.pack();
    this.out.frames++;
    const stray = this.drawn.filter((p) => !this.wheels.some((w) => w.distanceTo(p) < FLOAT32_SLACK)).length;
    if (stray > 0 || this.drawn.length !== this.wheels.length) this.out.faults.push(`${this.drawn.length} wheels drawn for ${this.wheels.length} shown, ${stray} at no shown wheel's place`);
    const field = this.engine["live"]();
    for (const car of this.cars()) {
      if (!car.group.visible) continue;
      for (let k = 0; k < 4; k++) if (car["looseWheels"][k]!.loose && chainVisible(car.wheels[k]!)) this.lostWheel(car, `${field.indexOf(car)}:${k}`, k);
    }
  }

  /** The wheel batch packed for this frame: its instances' places in `drawn`, the shown wheels' in `wheels`. */
  private pack(): void {
    const { engine, drawn, wheels, m } = this;
    const scene = engine["scene"];
    scene.updateMatrixWorld();
    scene.onBeforeRender(engine["renderer"], scene, engine["camera"], NO_GEOMETRY, NO_MATERIAL, NO_GROUP);
    drawn.length = 0;
    for (const lane of [engine["wheels"]["near"], engine["wheels"]["far"]]) {
      for (let i = 0; i < lane.mesh.count; i++) drawn.push(new THREE.Vector3().setFromMatrixPosition(lane.mesh.getMatrixAt(i, m)));
    }
    wheels.length = 0;
    for (const car of new Set(engine["drawnCars"]())) for (const w of car.wheels) if (chainVisible(w)) wheels.push(new THREE.Vector3().setFromMatrixPosition(w.matrixWorld));
  }

  private lostWheel(car: DeformableCar, key: string, k: number): void {
    const wheel = car.wheels[k]!;
    const now = this.now();
    if (!this.since.has(wheel)) this.since.set(wheel, now);
    this.out.lost.add(key);
    if (now - this.since.get(wheel)! < CLEAR_S) return;
    const seat = seatOf(car, k, this.seat);
    const gap = Math.hypot(wheel.matrixWorld.elements[12]! - seat.x, wheel.matrixWorld.elements[14]! - seat.z);
    this.out.farthest.set(key, Math.max(gap, this.out.farthest.get(key) ?? 0));
  }
}

const NO_GEOMETRY = new THREE.BufferGeometry();
const NO_MATERIAL = new THREE.MeshBasicMaterial();
const NO_GROUP = new THREE.Group();

function chainVisible(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** No wheel was drawn twice or where no shown wheel is, and every lost wheel was drawn off its seat once it had `CLEAR_S` to leave. */
function assertNoneOnSeat(out: Frames, what: string): void {
  assert.ok(out.lost.size > 0, `the control: ${what} lost a wheel (${out.frames} frames read)`);
  assert.equal(out.farthest.size, out.lost.size, `the control: every lost wheel was read past ${CLEAR_S} s`);
  assert.deepEqual(out.faults.slice(0, 5), [], `${out.faults.length} of ${out.frames} frames drew a wheel twice or where no shown wheel is`);
  const farthest = [...out.farthest].map(([key, gap]) => `${key} ${gap.toFixed(3)} m`);
  assert.ok(
    [...out.farthest.values()].every((gap) => gap >= LEFT_SEAT_M),
    `a lost wheel stayed on its seat; farthest along the ground per wheel: ${farthest.join(", ")}`,
  );
}

describe("given the real engine and an offset head-on at the start line that throws wheels", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let watch: LostWheelWatch | null = null;
  let live: Frames;
  let clip: HighlightClip;
  const race = () => engine["race"];
  const run = async (seconds: number): Promise<void> => {
    engine.advance(seconds, { frameDt: FRAME, render: true });
    await nextTurn();
  };
  const runUntil = async (done: () => boolean, limit: number): Promise<boolean> => {
    for (let s = 0; s < limit && !done(); s += 0.25) await run(0.25);
    return done();
  };

  /** The engine with its draw stubbed: every draw of the engine's scene is a frame `watch` reads. */
  const startEngine = async (): Promise<void> => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    const scene = engine["scene"];
    Object.assign(engine["renderer"], { render: (drawn: THREE.Object3D) => drawn === scene && watch?.frame(), compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
    engine["highlights"].stepBudgetMs = Infinity;
  };

  /** The race goes green, its first two cars meet in an offset head-on, and every drawn frame is watched until the crash is filed as a clip. */
  const crashLive = async (): Promise<void> => {
    engine.toggleRace();
    engine.raceCommand({ type: "program", options: RULES });
    engine.raceCommand({ type: "start" });
    assert.ok(await runUntil(() => race().phase === "racing", GREEN_WAIT_S), "the race went green");
    assert.ok(race().crashAtStart(CRASH_GAP, CRASH_SPEED, CRASH_OFFSET), "two cars on the grid");
    watch = new LostWheelWatch(engine, () => engine["live"](), () => engine["elapsedSim"]);
    const kept = race().recorder.ledger.kept;
    assert.ok(await runUntil(() => kept.length > 0, CLIP_WAIT_S), "the crash was filed");
    live = watch.out;
    clip = kept[0]!;
    watch = null;
  };

  before(async () => {
    await startEngine();
    await crashLive();
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the head-on plays live, then each lost wheel is drawn once, where it flies, and never back on its hub", () => {
    assertNoneOnSeat(live, "the race");
  });

  it("when the filed clip is replayed, then it loses the same wheels, each drawn once, where it flies, and never back on its hub", () => {
    const highlights = engine["highlights"];
    let ended = false;
    highlights.viewSaved(clip, engine["last"] / 1000, () => (ended = true), 1);
    const shown = () => highlights["cur"]?.sim;
    watch = new LostWheelWatch(engine, () => shown()?.cars ?? [], () => shown()?.time ?? 0);
    const replay = watch.out;
    engine.advance(highlights["solo"]!.tl.wall + SOLO_HOLD_S + 1, { frameDt: FRAME, render: true });
    watch = null;
    assert.ok(ended, "the control: the clip played to its end");
    assert.equal([...replay.lost].sort().join(), [...live.lost].sort().join(), "the replay loses the wheels the race lost");
    assertNoneOnSeat(replay, "the replay");
  });
});
