import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { agreement, recordFlat, type Spawn } from "./replay-fidelity.test-util.ts";

/**
 * A clip recorded with the epicenter activation on replays to the bit: the replay runs under the knobs the clip carries (`HighlightClip.epicenter`), so it freezes
 * and thaws each wreck at the steps the live sim did. `replay-fidelity.test.ts` holds the `whole` rows; these two stage the same derby crashes with the activation on,
 * long enough (8 s) for the wrecks to sit frozen for most of the clip.
 */
const HEAD = Math.PI / 2;
const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));

function replays(name: string, spawns: Spawn[]): void {
  loadEpicenter(EPICENTER_AT_LOAD);
  EPICENTER.on = 1;
  const rec = recordFlat(spawns, 8, true);
  loadEpicenter(EPICENTER_AT_LOAD);
  assert.ok(rec.clip.epicenter !== null && rec.clip.epicenter[0] === 1, `${name}: the clip does not carry the activation`);
  assert.ok(rec.cars.some((c) => c.deform.frozen), `${name}: no wreck was frozen at the end of the recording`);
  const a = agreement(rec);
  assert.ok(a.steps >= 100, `${name}: ${a.steps} steps compared`);
  assert.equal(a.wreckMismatch, 0, `${name}: a car is a wreck in one run and not in the other`);
  assert.deepEqual({ pose: a.pose.max, vel: a.vel.max, crush: a.crush.max }, { pose: 0, vel: 0, crush: 0 }, `${name}: a car strays from the live sim (m, m/s, m)`);
}

describe("given a derby crash recorded with the epicenter activation on", () => {
  it("when two cars 80 m apart drive head-on at 20 m/s each, then the replay matches the live sim at every step, to the bit", () =>
    replays("epicenter head-on", [
      { x: 0, z: 0, yaw: HEAD, speed: 20, throttle: 1 },
      { x: 80, z: 0, yaw: -HEAD, speed: 20, throttle: 1 },
    ]));

  it("when two head-on cars are met from behind and across by two more, then the replay matches the live sim at every step, to the bit", () =>
    replays("epicenter pile", [
      { x: 0, z: 0, yaw: HEAD, speed: 20, throttle: 1 },
      { x: 80, z: 0, yaw: -HEAD, speed: 20, throttle: 1 },
      { x: -12, z: 0.5, yaw: HEAD, speed: 20, throttle: 1 },
      { x: 40, z: 60, yaw: Math.PI, speed: 20, throttle: 1 },
    ]));
});
