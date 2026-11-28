import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { HitEvent } from "../present/hit-sound.ts";
import { setGround } from "../world/ground.ts";
import { simDigest } from "./engine-bench-headless.test-util.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
const CRASH_SECONDS = 10;
/** Speed (m/s) of the head-on pair and of the car sent at the slab. */
const HEAD_ON_SPEED = 12;
const SLAB_RUN_SPEED = 14;
/** How far (m) the head-on cars start from each other's meeting point, and from the slab. */
const HEAD_ON_START = 6;
const SLAB_RUN_START = 14;
/** The head-on pair meets this far (m) along z from the slab, which stands at the origin. */
const PAIR_Z = -40;

export interface CrashRun {
  hits: HitEvent[];
  scrapes: number;
  digest: string;
}

/** The fleet sandbox with cars 0 and 1 head-on far from the slab and car 2 driven at the slab, run for `CRASH_SECONDS`; with `audioOn` the audio's hit and scrape calls are recorded. */
export async function runCrash(audioOn: boolean): Promise<CrashRun> {
  stubBrowser();
  const engine = await bootEngine({ pacer: true });
  engine.pace.pin = true;
  engine["looping"] = false;
  engine.audioOn = audioOn;
  const run: CrashRun = { hits: [], scrapes: 0, digest: "" };
  engine["audio"].hit = (e) => void run.hits.push({ ...e });
  engine["audio"].scrape = () => void run.scrapes++;
  const cars = engine["live"]();
  for (const [k, car] of cars.entries()) {
    car.spawnFacing(8 * k - 16, 60 + 8 * k, 0, 0);
    car.speed = 0;
    car.spawnSpeed = 0;
  }
  engine.toggleBarrier();
  const slab = engine["barrier"].group.position;
  for (const k of [0, 1]) {
    const dir = k === 0 ? 1 : -1;
    const car = cars[k]!;
    car.spawnFacing(-dir * HEAD_ON_START, PAIR_Z, (dir * Math.PI) / 2, 0);
    car.velocity.set(dir * HEAD_ON_SPEED, 0, 0);
    car.speed = HEAD_ON_SPEED;
    car.spawnSpeed = HEAD_ON_SPEED;
  }
  const runner = cars[2]!;
  runner.spawnFacing(slab.x - SLAB_RUN_START, slab.z, Math.PI / 2, 0);
  runner.velocity.set(SLAB_RUN_SPEED, 0, 0);
  runner.speed = SLAB_RUN_SPEED;
  runner.spawnSpeed = SLAB_RUN_SPEED;
  for (let f = 0; f < CRASH_SECONDS * FRAME_HZ; f++) engine.advance(FRAME, { frameDt: FRAME });
  run.digest = simDigest(engine);
  engine.dispose();
  setGround(null);
  return run;
}
