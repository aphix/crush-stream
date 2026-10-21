import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import { clipBytes } from "../net/reel-codec.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { agreement, recordField } from "./replay-fidelity.test-util.ts";

/**
 * A recorded race crash replayed headless (docs/HIGHLIGHTS.md), over many seeded races: the harness of
 * `engine-replay.ai-long-run.ts` (a race is ~10 s of headless sim, a seed with its clips 12-20 s: a sweep of 64 seeds is four
 * shards of 16, each `SEEDS=17,18,... node --experimental-strip-types --test engine-replay.ai-long-run.ts`).
 */

/** A ramming field (aggression 1) of 12 on the city course: crashes come in the first lap. */
const FIELD = { trackId: "city", laps: 1, aiCount: 11, noReset: false, aggression: 1 };
/** Race seconds recorded (the first lap's crashes), and the clips wanted from them. */
const RACE_S = 75;
const CLIPS = 5;

/**
 * A race with no clip by this race second gets a hit of its own: the player rams the field (`ram`). A seed whose AI field races
 * a clean lap leaves nothing to replay otherwise (seed 14 of 1-64; seed 6 once the cage's arch moved).
 */
const SCRIPTED_AT = 12;
/** Plan gap (m) the rammer starts behind its target, centre to centre: at `RAM_SPEED` it closes in over `REHIT_S`, so a car it just touched still counts as a fresh impact. */
const RAM_GAP = 15;
/** The rammer's closing speed (m/s) on its target: well over `IMPACT_MIN`, so the hit is an impact whatever the target's pedals do in the run-up. */
const RAM_SPEED = 25;
/** Least plan speed (m/s) of a car to ram: its velocity points along the road it came down, which is where the rammer is put. */
const RAM_MOVING = 5;

/**
 * Puts `cars[0]` `RAM_GAP` behind the nearest other car driving at least `RAM_MOVING`, on its line and `RAM_SPEED` faster: a
 * player sent straight ahead can meet a wall at a glance, under the impact bar, and grind along it for the rest of the race.
 */
function ram(cars: readonly DeformableCar[]): void {
  const player = cars[0]!;
  const { x, z } = player.group.position;
  let target: DeformableCar | null = null;
  for (const c of cars) {
    if (c === player || Math.hypot(c.velocity.x, c.velocity.z) < RAM_MOVING) continue;
    if (!target || Math.hypot(c.group.position.x - x, c.group.position.z - z) < Math.hypot(target.group.position.x - x, target.group.position.z - z)) target = c;
  }
  assert.ok(target, `no car drives at ${RAM_MOVING} m/s or more at ${SCRIPTED_AT} s for the player to ram`);
  const v = Math.hypot(target.velocity.x, target.velocity.z);
  const dx = target.velocity.x / v;
  const dz = target.velocity.z / v;
  player.spawnFacing(target.group.position.x - dx * RAM_GAP, target.group.position.z - dz * RAM_GAP, Math.atan2(dx, dz), v + RAM_SPEED);
}

/**
 * One test per seed: its race's crashes recorded, then each clip replayed and held to the live sim: every car of it, every
 * step of it, to the bit (the pedals are on the 8-bit grid in the sim itself, so a clip holds what the sim ran). The seeds
 * of a sweep (`SEEDS=14,28 node ...` runs just those) must between them leave clips to hold: a test whose races recorded
 * nothing proves nothing.
 */
export function sweepSeeds(list: readonly number[]): void {
  const seeds = process.env.SEEDS ? process.env.SEEDS.split(",").map(Number) : list;
  const total = { clips: 0, steps: 0 };
  describe(`given highlight replays of the crashes in seeded races, seeds ${seeds[0]} to ${seeds[seeds.length - 1]}`, () => {
    for (const seed of seeds) it(`when seed ${seed}'s race is recorded and each clip it kept is replayed headless, then every car matches the live sim at every step, to the bit`, (t) => {
      const w = makeWorld();
      w.race.enter();
      try {
        const recs = recordField(w, {
          options: FIELD,
          seed,
          before: () => {
            if (w.race.recorder.now >= SCRIPTED_AT && w.race.recorder.ledger.kept.length === 0 && w.seat.mode !== "drive") {
              ram(w.cars);
              w.seat.mode = "drive";
              w.seat.carIndex = 0;
              w.seat.intent.gas = 1;
            }
          },
          done: () => w.race.recorder.ledger.kept.length >= CLIPS,
          maxFrames: RACE_S * 60,
        });
        assert.ok(recs.length >= 1, `seed ${seed}: no clip in ${RACE_S} s of a ramming field and a flat-out player: the recorder or the ledger saw no crash`);
        const rows: string[] = [];
        for (const rec of recs) {
          const { clip } = rec;
          const a = agreement(rec, () => w.race.resetProps());
          rows.push(
            `${clip.cars.length} cars, ${(clipBytes(clip) / 1024).toFixed(0)} KB, ${clip.keyStep.length} keyframes, score ${clip.score.toFixed(1)}, ${clip.firstB < 0 ? "wall" : "pair"} impact at ${clip.firstImpact.toFixed(2)} s: ` +
              `${a.steps} steps, worst pose ${a.pose.max} m, velocity ${a.vel.max} m/s, crush ${a.crush.max} m, wreck flags differ ${a.wreckMismatch}`,
          );
          total.steps += a.steps;
          assert.ok(a.steps >= 100, `seed ${seed}: only ${a.steps} steps compared\n${rows.join("\n")}`);
          assert.deepEqual({ pose: a.pose.max, vel: a.vel.max, crush: a.crush.max, wreck: a.wreckMismatch }, { pose: 0, vel: 0, crush: 0, wreck: 0 }, `seed ${seed}: a car strays from the live sim\n${rows.join("\n")}`);
        }
        total.clips += recs.length;
        t.diagnostic(rows.join("\n"));
      } finally {
        w.race.exit();
        setGround(null);
      }
    });
    it(`when all the seeds have been replayed, then they together produced at least one clip per seed and compared some steps`, () => {
      assert.ok(total.clips >= seeds.length && total.steps > 0, `${total.clips} clips and ${total.steps} steps over ${seeds.length} seeds`);
    });
  });
}
