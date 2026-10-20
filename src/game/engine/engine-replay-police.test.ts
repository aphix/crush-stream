import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import { blankPoint, blankProjection, Track } from "../world/track.ts";
import oval from "../world/tracks/oval.json" with { type: "json" };
import { clipBytes } from "../net/reel-codec.ts";
import { agreement, recordField } from "./replay-fidelity.test-util.ts";

/**
 * The owner's rule: a replay matches the live crash it recorded, every car shown in it. A browser smoke of the oval race
 * (11 AI, police on) found a cop woken in the clip missing from its first 1.5 s (parked 5.7 km away until a later keyframe
 * put it on the road), cars drifting metres before the hit and a racer 21 m off after it. Scripted here, on any seed: the
 * race runs until a cop is put on a spot (a stakeout is parked), and the next frame two racers are put head-on on the road
 * beside it. The cop's placement is then inside the clip, and its crash is the clip's.
 */
const FIELD = { trackId: "oval", laps: 3, aiCount: 11, noReset: false, aggression: 1, police: true, spectate: true };
/** Race seconds to wait for the first stakeout (a third of the first lap in), at most. */
const WAIT_S = 120;
const SEEDS = [1, 2, 3, 4, 5];

describe("given the oval race with 11 AI and police on, where two racers are put head-on beside a cop that has just been placed on a stakeout spot", () => {
  for (const seed of SEEDS) {
    it(`when seed ${seed}'s kept clips holding a cop put on a spot are replayed, then every car is where the live sim had it at every step`, (t) => {
      const w = makeWorld();
      w.race.enter();
      const track = new Track(oval);
      const pt = blankPoint();
      const proj = blankProjection();
      try {
        const base: number[] = [];
        // Every cop the race put on a spot, the first of them the one the head-on is staged beside.
        const placed: number[] = [];
        let cop = -1;
        let armed = false;
        const headOn: number[] = [];
        const recs = recordField(w, {
          options: FIELD,
          seed,
          before: () => {
            const cops = w.cars.length - w.race.racers.length;
            if (cop >= 0 && !armed) {
              // The frame after the cop was put on its spot: two racers put head-on on the road beside it, 8 m apart at 20 m/s each, the ones the
              // race has not crashed first. The spot respawns a car whole (`spawnFacing`), so a seed whose pile-up spared fewer than two (seed 5:
              // one) stages a wreck respawned; staging only spared ones left seed 5 a lone car beside the cop and no crash to keep.
              armed = true;
              // The ledger keeps the five best clips: the pile-up's (kept and still open) are dropped as the crash is staged, so the staged
              // crash's clip ranks among the race's later ones (seed 5 kept five pile-up clips, impacts at 3.0-3.7 s, over the staged crash at 7.5 s).
              w.race.recorder.ledger.clear();
              for (const crashed of [false, true]) for (let i = 0; i < w.race.racers.length && headOn.length < 2; i++) if (w.cars[i]!.crashed === crashed) headOn.push(i);
              const c = w.cars[cop]!.group.position;
              const s = track.project(c.x, c.z, -1, proj).s;
              for (const [k, slot] of headOn.entries()) {
                track.pointAt(s + 8 * k, pt);
                w.cars[slot]!.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz) + k * Math.PI, 20);
              }
              return;
            }
            if (cops <= 0) return;
            for (let i = w.race.racers.length; i < w.cars.length; i++) {
              base[i] ??= w.cars[i]!.placements;
              if (w.cars[i]!.placements !== base[i] && !placed.includes(i)) placed.push(i);
            }
            if (cop < 0 && placed.length > 0) cop = placed[0]!;
          },
          done: () => armed && w.race.recorder.ledger.kept.some((k) => k.cars.some((c) => placed.includes(c.slot))),
          maxFrames: (WAIT_S + 30) * 60,
        });
        assert.ok(cop >= 0, `seed ${seed}: no cop was put on a spot in ${WAIT_S} s of the police race`);
        assert.equal(headOn.length, 2, `seed ${seed}: two racers to stage head-on beside cop ${cop}`);
        // Which cop a kept clip holds depends on the whole race (a torn part's flight moves which crashes rank), so the row takes every clip holding one the race put on a spot.
        const withCop = recs.filter((r) => r.clip.cars.some((c) => placed.includes(c.slot)));
        assert.ok(withCop.length > 0, `seed ${seed}: no kept clip holds a cop put on a spot (${placed.join(",")}; clips: ${recs.map((r) => r.clip.cars.map((c) => c.slot).join(",")).join(" | ")})`);
        for (const rec of withCop) {
          const { clip } = rec;
          const held = clip.cars.filter((c) => placed.includes(c.slot)).map((c) => c.slot);
          const a = agreement(rec, () => w.race.resetProps());
          t.diagnostic(
            `cops ${held.join(",")} put on a spot (the head-on staged beside ${cop}) of ${clip.cars.length} clip cars, ${(clipBytes(clip) / 1024).toFixed(0)} KB, ${clip.keyStep.length} keyframes, impact at ${clip.firstImpact.toFixed(2)} s: ` +
              `${a.steps} steps, worst pose ${a.pose.max} m, velocity ${a.vel.max} m/s, crush ${a.crush.max} m, wreck flags differ ${a.wreckMismatch}`,
          );
          assert.ok(a.steps >= 500, `${a.steps} steps compared`);
          assert.deepEqual({ pose: a.pose.max, vel: a.vel.max, crush: a.crush.max, wreck: a.wreckMismatch }, { pose: 0, vel: 0, crush: 0, wreck: 0 }, `seed ${seed}: a car strays from the live sim (m, m/s, m)`);
        }
      } finally {
        w.race.exit();
        setGround(null);
      }
    });
  }
});
