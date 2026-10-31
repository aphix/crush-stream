import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { decodeShare } from "../hud/share-url.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { UP_DOWN_M, upDownOf } from "../vehicle/skin-stretch.test-util.ts";
import { setGround } from "../world/ground.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/** The owner's fleet capture (2026-10-30, five cars, auto slow-mo): as the cars met, crushed noses and fenders jumped up and down between frames. */
const FRAME = 1 / FRAME_HZ;
const LINK = "#scene=fleet&cars=5&smin=10&smax=32&real=0.25&squash=0.32&buckle=0.45&seed=753fbe&deform=shape&loop=0&fx=high&car=sedan&slomo=1";
/** His capture's clock, (wall s, sim s) at each trace sample: the auto slow-mo ran on his frame times, which the headless frames do not have. */
const CLOCK = [
  [0, 0], [0.25, 0.25], [0.504, 0.475], [0.754, 0.542], [1.008, 0.565], [1.258, 0.576], [1.517, 0.59], [1.792, 0.687], [2.042, 0.701],
  [2.308, 0.71], [2.575, 0.718], [2.837, 0.727], [3.108, 0.735], [3.358, 0.743], [3.617, 0.752], [3.871, 0.76], [4.125, 0.768],
  [4.387, 0.776], [4.654, 0.784], [4.921, 0.793], [5.179, 0.801], [5.442, 0.81], [5.704, 0.818], [5.966, 0.826], [6.221, 0.835],
  [6.479, 0.843], [6.733, 0.851],
] as const;
/** The end (wall s) of the window he flagged (5.52-6.60 s), the hit before it included. */
const TO_WALL_S = 6.6;
/** A car skinned on one frame of this many (the LoD's small-on-screen stride). */
const SPARSE_STRIDE = 3;
/** The crush the hit leaves the most crushed car (measured 1.0): the fixture's cars met. */
const CRUSHED = 0.5;

/** His sim time at wall `t`, linear between his samples. */
function simAt(t: number): number {
  for (let i = 1; i < CLOCK.length; i++) {
    const [ta, sa] = CLOCK[i - 1]!;
    const [tb, sb] = CLOCK[i]!;
    if (t <= tb) return sa + ((sb - sa) * (t - ta)) / (tb - ta);
  }
  return CLOCK[CLOCK.length - 1]![1];
}

/** One car's drawn body over the run: its worst up-and-down, and its worst drop on a frame one of its wheels tore loose. */
type Track = { car: DeformableCar; drawn: ArrayLike<number>; last: Float32Array; change: Float32Array; worst: { by: number; at: number }; sim: number; gone: number; tearDrop: number };

function trackOf(car: DeformableCar): Track {
  const drawn = car.body.geometry.getAttribute("position").array;
  return { car, drawn, last: Float32Array.from(drawn), change: new Float32Array(drawn.length / 3), worst: { by: 0, at: -1 }, sim: 0, gone: 0, tearDrop: 0 };
}

function goneOf(car: DeformableCar): number {
  let gone = 0;
  for (let i = 0; i < car.wheels.length; i++) if (car["looseWheels"][i]!.loose) gone |= 1 << i;
  return gone;
}

/** The farthest any drawn point fell since `last`. */
function dropOf(drawn: ArrayLike<number>, last: Float32Array): number {
  let drop = 0;
  for (let v = 1; v < last.length; v += 3) drop = Math.max(drop, last[v]! - drawn[v]!);
  return drop;
}

function follow(t: Track, sim: number): void {
  const gone = goneOf(t.car);
  if (gone & ~t.gone) t.tearDrop = Math.max(t.tearDrop, dropOf(t.drawn, t.last));
  t.gone = gone;
  const before = t.worst.by;
  upDownOf(t.drawn, t.last, t.change, t.worst);
  if (t.worst.by > before) t.sim = sim;
}

type Shot = { tracks: Track[]; crush: number };

/** Every car's drawn body from his spawn to `TO_WALL_S`, skinned on one frame of `stride`: a fresh engine, as a reset rolls a new spawn. */
async function shoot(stride: number): Promise<Shot> {
  const engine = await bootEngine({ hud: new HudStore(), pacer: true });
  // The auto slow-mo still decides its phases and its cut-ins; each frame's sim step is his.
  let slope = 1;
  Object.defineProperty(engine["clock"], "timeScale", { get: () => slope / engine["cine"].timeWarp, set: () => {}, configurable: true });
  engine["applyShare"](decodeShare(LINK), false);
  Object.assign(engine, { followedCar: () => null, skinStride: () => stride });
  const cars = engine["live"]();
  const tracks = cars.map(trackOf);
  while (engine["elapsedWall"] < TO_WALL_S) {
    slope = (simAt(engine["elapsedWall"] + FRAME) - engine["elapsedSim"]) / FRAME;
    engine.advance(FRAME, { frameDt: FRAME });
    for (const t of tracks) follow(t, engine["elapsedSim"]);
  }
  const crush = Math.max(...cars.map((c) => c.deform.crushAmount));
  engine.dispose();
  return { tracks, crush };
}

function where(t: Track): string {
  return `${(t.worst.by * 1000).toFixed(1)} mm up and down: ${t.car.paint.name} (${t.car.style.id}) vertex ${t.worst.at} at sim ${t.sim.toFixed(3)} s`;
}

function named(shot: Shot, paint: string): Track {
  const t = shot.tracks.find((k) => k.car.paint.name === paint);
  if (!t) throw new Error(`fixture: no ${paint} car in the fleet`);
  return t;
}

describe("given the owner's five-car fleet at his seed, on his slow-mo clock", () => {
  const shots = new Map<number, Promise<Shot>>();
  const shotAt = (stride: number) => shots.get(stride) ?? (shots.set(stride, shoot(stride)), shots.get(stride)!);

  beforeAll(() => stubBrowser());
  afterAll(() => setGround(null));

  it(`when every car's skin is drawn on one frame of ${SPARSE_STRIDE} through the hit and his slow-mo, then no drawn body point jumps up and back down (or down and back up)`, async () => {
    const shot = await shotAt(SPARSE_STRIDE);
    expect(shot.crush, "fixture: the cars met").toBeGreaterThan(CRUSHED);
    for (const t of shot.tracks) expect(t.worst.by, where(t)).toBeLessThanOrEqual(UP_DOWN_M);
  });

  // Oxide's fascia, driven into a tyre's front at bumper height, was lifted over the tyre for a frame.
  it("when every car's skin is drawn on every frame, then Oxide's bumper driven into a tyre's front is never thrown over it for a frame", async () => {
    const t = named(await shotAt(1), "Oxide");
    expect(t.worst.by, where(t)).toBeLessThanOrEqual(UP_DOWN_M);
  });

  // Bronze's sag lifted a crushed corner past the tyre's surface at its own place for a frame, then let it fall.
  it("when every car's skin is drawn on every frame, then Bronze's sag lifts no corner past its own target and no point jumps up and down", async () => {
    const t = named(await shotAt(1), "Bronze");
    expect(t.worst.by, where(t)).toBeLessThanOrEqual(UP_DOWN_M);
  });

  it("when a wheel tears loose under a crushed fender, then the hold over its seat fades and no drawn point drops on that frame", async () => {
    const shot = await shotAt(1);
    const torn = shot.tracks.filter((t) => t.gone !== 0);
    expect(torn.length, "fixture: a wheel tore loose").toBeGreaterThan(0);
    for (const t of torn) expect(t.tearDrop, `${t.car.paint.name}: ${(t.tearDrop * 1000).toFixed(1)} mm dropped on the frame its wheel tore`).toBeLessThanOrEqual(UP_DOWN_M);
  });
});
