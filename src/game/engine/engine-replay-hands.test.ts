import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import { blankPoint, blankProjection, Track } from "../world/track.ts";
import oval from "../world/tracks/oval.json" with { type: "json" };
import { INPUT_BYTES } from "../match/highlights.ts";
import { agreement, recordField } from "./replay-fidelity.test-util.ts";

/**
 * The racing AI's hands (`ai/input-fade.ts`) and the contact guard's hold keep state no keyframe carries, and a clip can start in the middle of either. A replay applies the pedals the
 * live sim ran (`CrashRecorder`'s `inputs`, kept after the hands and the guard), so that state is not needed: clips that start with the wheel moving replay to the bit.
 * The crash is staged (two racers put head-on), so a clip is cut on every seed whatever the field's own crashes do.
 */
const FIELD = { trackId: "oval", laps: 3, aiCount: 11, noReset: false, aggression: 1, police: false, spectate: true };
const SEEDS = [1, 2];
/** Race second the head-on is staged at: the clip's pre-roll then holds the field driving off the grid, and every seed still has two racers unwrecked. */
const STAGE_S = 4;
/** Race seconds after the staging the staged crash's clip must be kept within (it closes 1.5 s after its last impact). */
const KEEP_S = 30;
/** Steps in which a wheel running mid-corner has moved (a step is 1/240 to 1/80 s). */
const LOOK = 30;

describe("given a driven oval field with two racers put head-on 4 s into the race, its clips kept from then on", () => {
  for (const seed of SEEDS) {
    it(`when seed ${seed}'s clips are replayed, then each starts with a wheel in motion and every car is where the live sim had it at every step`, (t) => {
      const w = makeWorld();
      w.race.enter();
      const track = new Track(oval);
      const pt = blankPoint();
      const proj = blankProjection();
      try {
        const headOn: number[] = [];
        const recs = recordField(w, {
          options: FIELD,
          seed,
          before: () => {
            if (headOn.length > 0 || w.race.time < STAGE_S) return;
            // The opening pile-up's clips go, so the staged crash's ranks.
            w.race.recorder.ledger.clear();
            for (let i = 0; i < w.race.racers.length && headOn.length < 2; i++) if (!w.cars[i]!.crashed) headOn.push(i);
            assert.equal(headOn.length, 2, `seed ${seed}: two racers unwrecked at ${STAGE_S} s`);
            const c = w.cars[headOn[0]!]!.group.position;
            const s = track.project(c.x, c.z, -1, proj).s;
            for (const [k, slot] of headOn.entries()) {
              track.pointAt(s + 8 * k, pt);
              w.cars[slot]!.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz) + k * Math.PI, 20);
            }
          },
          done: () => headOn.length > 0 && w.race.recorder.ledger.kept.length > 0,
          maxFrames: (STAGE_S + KEEP_S) * 60,
        });
        assert.ok(recs.length > 0, `seed ${seed}: no clip kept in the ${KEEP_S} s after the staged head-on`);
        for (const rec of recs) {
          const { clip } = rec;
          const n = clip.cars.length;
          const steer = (step: number, j: number): number => (clip.inputs[(step * n + j) * INPUT_BYTES + 1]! << 24) >> 24;
          let moving = 0;
          for (let j = 0; j < n; j++) if (steer(0, j) !== 0 && steer(0, j) !== steer(LOOK, j)) moving++;
          assert.ok(moving > 0, `seed ${seed}: no wheel is moving in the clip's first ${LOOK} steps (${n} cars)`);
          const a = agreement(rec, () => w.race.resetProps());
          t.annotate(`${n} clip cars, ${moving} wheels moving at its start, impact at ${clip.firstImpact.toFixed(2)} s: ${a.steps} steps, worst pose ${a.pose.max} m, velocity ${a.vel.max} m/s`);
          assert.ok(a.steps >= 100, `${a.steps} steps compared`);
          assert.deepEqual({ pose: a.pose.max, vel: a.vel.max, crush: a.crush.max, wreck: a.wreckMismatch }, { pose: 0, vel: 0, crush: 0, wreck: 0 }, `seed ${seed}: a car strays from the live sim (m, m/s, m)`);
        }
      } finally {
        w.race.exit();
        setGround(null);
      }
    });
  }
});
