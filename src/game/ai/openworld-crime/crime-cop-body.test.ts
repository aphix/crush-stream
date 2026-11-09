import { describe, expect, it } from "vitest";
import { launch, pooledCar } from "../../contact/crash-scenarios.test-util.ts";
import { STRIDE_RADIANS_PER_METRE } from "../civilians/civilian-crowd-constants.ts";
import { COP_DOWN_SECONDS, COP_RUN_SPEED, COP_PATROL_SPEED, CRIME_STEP_SECONDS, RUN_STRIDES_PER_SECOND } from "./crime-constants.ts";
import { COP_MODE } from "./foot-cops.ts";
import { FootWalkers } from "./foot-walkers.ts";
import { harness, lineCity, runFor, STEP_SECONDS } from "./crime-fixture.test-util.ts";

const COP = 0;
const EAST = Math.PI / 2;
const CAR_SPEED = 10;
const CAR_START_X = 30;

describe("a foot cop moves like the people round him", () => {
  // mutation: in src/game/ai/openworld-crime/foot-walkers.ts carry(), change `(speed > 0 ? Math.min(STRIDE_RADIANS_PER_METRE, (2 * Math.PI * RUN_STRIDES_PER_SECOND) / speed) : STRIDE_RADIANS_PER_METRE)` to `STRIDE_RADIANS_PER_METRE`
  it("strides at the civilians' rate at a walk, and no faster than a runner's cadence at a run", () => {
    const walkers = new FootWalkers(lineCity().graph, 2);
    for (let step = 0; step < 10; step++) {
      walkers.carry(0, COP_PATROL_SPEED * CRIME_STEP_SECONDS, CRIME_STEP_SECONDS);
      walkers.carry(1, COP_RUN_SPEED * CRIME_STEP_SECONDS, CRIME_STEP_SECONDS);
    }
    expect(walkers.stride[0], "a second's walk: the civilians' stride per metre").toBeCloseTo(COP_PATROL_SPEED * STRIDE_RADIANS_PER_METRE, 6);
    expect(walkers.stride[1], "a second's run: one runner's strides").toBeCloseTo(2 * Math.PI * RUN_STRIDES_PER_SECOND, 6);
  });

  // mutation: in src/game/ai/openworld-crime/crime-scene.ts step(), change `this.drawShare = Math.min(1, Math.max(0, (crowdSeconds - this.law.seconds) * CRIME_HZ));` to `this.drawShare = 1;`
  it("is drawn partway between his last two grid steps at a frame between them, not jumping a step at a time", () => {
    const run = harness([60, 0, 0]);
    runFor(run, 1);
    const { walkers } = run.scene.foot;
    const from = walkers.drawnX(COP, 0);
    const to = walkers.drawnX(COP, 1);
    expect(Math.abs(to - from), "he moved over the last step").toBeGreaterThan(0.05);
    run.scene.step(run.now + STEP_SECONDS / 2, true, run.poses, run.cars);
    expect(run.scene.drawShare, "half a step on").toBeCloseTo(0.5, 6);
    expect(run.scene.copPoses.x[COP], "half way").toBeCloseTo((from + to) / 2, 4);
  });
});

describe("a car runs a foot cop down as it does a civilian", () => {
  /** A car driving east along the line city through a cop standing at x = 60. */
  function carThroughCop(authority: boolean) {
    const run = harness([60, 0, 0], { authority });
    const car = pooledCar(0);
    launch(car, CAR_START_X, 0, EAST, CAR_SPEED, 0);
    run.cars.push(car);
    return { run, car };
  }

  // mutation: in src/game/ai/openworld-crime/crime-scene.ts step(), delete the line `if (authority) this.findCopHits(cars, crowdSeconds);`
  it("knocks down the cop the car's path meets: thrown by that car, off the street, the host's event, and back on his beat after a while", () => {
    const { run, car } = carThroughCop(true);
    for (let step = 0; step < 50 && run.copDowns.length === 0; step++) {
      car.group.position.x = CAR_START_X + CAR_SPEED * (run.now + STEP_SECONDS);
      runFor(run, STEP_SECONDS);
    }
    expect(run.copDowns.map((down) => down.resident).join(","), "the host's event for that cop").toBe(String(COP));
    const strikes = run.scene.takeCopStrikes();
    expect(strikes.length, "one throw").toBe(1);
    expect(strikes[0]!.car, "by that car").toBe(0);
    expect(run.scene.foot.cops.mode[COP], "down").toBe(COP_MODE.down);
    runFor(run, STEP_SECONDS);
    expect(run.scene.copPoses.shown[COP], "off the street").toBe(0);
    car.group.position.x = 1000;
    runFor(run, COP_DOWN_SECONDS + 1);
    expect(run.scene.copPoses.shown[COP], "back on his beat").toBe(1);
  });

  // mutation: in src/game/ai/openworld-crime/crime-scene.ts step(), delete the line `this.applyDueCopDowns(cars);`
  it("on a client, the host's knock heard puts the cop down when the client's clock reaches it, and its own hit test raises nothing", () => {
    const { run, car } = carThroughCop(false);
    car.group.position.x = 1000;
    run.scene.hearCopDown(COP, 1.5);
    runFor(run, 1);
    expect(run.scene.copPoses.shown[COP], "before its time").toBe(1);
    runFor(run, 1);
    expect(run.scene.foot.cops.mode[COP], "down at the host's second").toBe(COP_MODE.down);
    expect(run.copDowns, "a client raises nothing").toHaveLength(0);
  });
});
