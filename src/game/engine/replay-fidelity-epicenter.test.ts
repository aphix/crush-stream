import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { agreement, atClipStart, recordFlat, type Spawn } from "./replay-fidelity.test-util.ts";

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

describe("given a clip whose first keyframe finds a wreck frozen (the activation on)", () => {
  it("when a second crash 9 s in lands beside two wrecks that froze 5 s before it, then the replay from that keyframe matches the live sim at every step, to the bit", () => {
    loadEpicenter(EPICENTER_AT_LOAD);
    EPICENTER.on = 1;
    // Cars 0 and 1 meet at x = 40 at about 3 s and freeze; cars 2 and 3 meet 12 m beside them at about 9 s: the clip of that crash (the one that starts latest) holds the first pair as bystanders.
    const rec = recordFlat(
      [
        { x: 0, z: 0, yaw: HEAD, speed: 12, throttle: 1 },
        { x: 80, z: 0, yaw: -HEAD, speed: 12, throttle: 1 },
        { x: 40, z: -300, yaw: 0, speed: 18, throttle: 1 },
        { x: 40, z: 324, yaw: Math.PI, speed: 18, throttle: 1 },
      ],
      14,
      true,
      [],
      undefined,
      null,
      true,
    );
    loadEpicenter(EPICENTER_AT_LOAD);
    const frozenAtStart = [0, 1].filter((slot) => atClipStart(rec, slot).frozen);
    assert.ok(rec.clip.cars.some((c) => c.slot === 2) && frozenAtStart.length > 0, `the clip must open on frozen bystanders (clip cars ${rec.clip.cars.map((c) => c.slot).join()}, frozen at its start: ${frozenAtStart.join() || "none"}): the row proves nothing`);
    const a = agreement(rec);
    assert.ok(a.steps >= 100, `${a.steps} steps compared`);
    assert.equal(a.wreckMismatch, 0, "a car is a wreck in one run and not in the other");
    assert.deepEqual({ pose: a.pose.max, vel: a.vel.max, crush: a.crush.max }, { pose: 0, vel: 0, crush: 0 }, "a car strays from the live sim (m, m/s, m)");
  });

  it("when that wreck drives on frozen at 36 m/s (sideswiped 1.5 s in, its drivetrain alive) into a parked car, then the replay from that keyframe matches the live sim at every step, to the bit", () => {
    loadEpicenter(EPICENTER_AT_LOAD);
    EPICENTER.on = 1;
    // Cars 0 and 1 sideswipe at about 1.5 s and drive on frozen; car 0 meets the parked car 2 at about 7 s, and that clip (the one that starts latest) opens on car 0 frozen at speed.
    const rec = recordFlat(
      [
        { x: 0, z: 0, yaw: HEAD, speed: 14, throttle: 1 },
        { x: 60, z: 1.6, yaw: -HEAD, speed: 10, throttle: 1 },
        { x: 250, z: -36.8, yaw: 0, speed: 0, throttle: 0 },
      ],
      12,
      false,
      [],
      undefined,
      null,
      true,
    );
    loadEpicenter(EPICENTER_AT_LOAD);
    const start = atClipStart(rec, 0);
    assert.ok(
      rec.clip.cars.some((c) => c.slot === 0) && start.wreck && start.frozen && start.speed > 20 && rec.cars[0]!.deform.drivetrainAlive,
      `the clip must open on car 0 frozen and driving (clip cars ${rec.clip.cars.map((c) => c.slot).join()}, at its start ${JSON.stringify(start)}): the row proves nothing`,
    );
    const a = agreement(rec);
    assert.ok(a.steps >= 100, `${a.steps} steps compared`);
    assert.equal(a.wreckMismatch, 0, "a car is a wreck in one run and not in the other");
    assert.deepEqual({ pose: a.pose.max, vel: a.vel.max, crush: a.crush.max }, { pose: 0, vel: 0, crush: 0 }, "a car strays from the live sim (m, m/s, m)");
  });
});
