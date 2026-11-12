import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { makeCar, launch, FREEWHEEL } from "./crash-scenarios.test-util.ts";
import { R_STRENGTH, ROW, TetherSet, WORLD } from "./tether.ts";
import { MAX_TETHERS } from "../kernel/constants.ts";
import { newWorld, settleStep, stepWorld, type World } from "../engine/world-step.ts";
import { applyDrive } from "../vehicle/car-drive.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { setGround } from "../world/ground.ts";
import { GRAVITY, QUIET_HZ } from "../kernel/constants.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";

after(() => setGround(null));

const H = 1 / QUIET_HZ;
/** Strength (N) no test load reaches: the rows that are not about breaking never snap. */
const UNBREAKABLE = 1e12;
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;
const ORIGIN = new THREE.Vector3();

type Staged = { world: World; cars: DeformableCar[]; set: TetherSet };

/** Cars launched at (x, z, yaw, vx, vz) on the flat ground, in one world. */
function stage(placements: readonly (readonly [number, number, number, number, number])[]): Staged {
  const cars = placements.map(([x, z, yaw, vx, vz]) => {
    const car = makeCar();
    launch(car, x, z, yaw, vx, vz);
    return car;
  });
  const world = newWorld(cars);
  return { world, cars, set: world.tethers };
}

/** A cable from the world point `at` to car `car`'s centre of mass, as long as they stand apart now. */
function tieToWorld(s: Staged, car: number, at: THREE.Vector3, strength: number | null = UNBREAKABLE): number {
  const slot = s.set.open();
  const centre = s.cars[car]!.frame.centre;
  s.set.setEnd(slot, 0, WORLD, at.x, at.y, at.z);
  s.set.setEnd(slot, 1, car, centre.x, centre.y, centre.z);
  s.set.fit(slot, s.cars);
  if (strength !== null) s.set.rows[slot * ROW + R_STRENGTH] = strength;
  return slot;
}

/** A cable between the centres of mass of cars `a` and `b`, as long as they stand apart now. */
function tieCars(s: Staged, a: number, b: number): number {
  const slot = s.set.open();
  for (const [end, car] of [a, b].entries()) {
    const centre = s.cars[car]!.frame.centre;
    s.set.setEnd(slot, end, car, centre.x, centre.y, centre.z);
  }
  s.set.fit(slot, s.cars);
  s.set.rows[slot * ROW + R_STRENGTH] = UNBREAKABLE;
  return slot;
}

/** One fixed step, as the engine runs it: the cars coast (neutral), the world steps, the breakage settles. */
function step(s: Staged): void {
  for (const car of s.cars) applyDrive(car, FREEWHEEL, H);
  stepWorld(s.world, H);
  settleStep(s.cars, H, false);
}

function run(s: Staged, seconds: number, each: (s: Staged) => void = () => {}): void {
  for (let i = 0; i < Math.round(seconds * QUIET_HZ); i++) {
    step(s);
    each(s);
  }
}

const _end = new THREE.Vector3();
const _other = new THREE.Vector3();

/** Metres between cable `slot`'s two ends now. */
function span(s: Staged, slot: number): number {
  s.set.anchor(slot, 0, s.cars, _end);
  s.set.anchor(slot, 1, s.cars, _other);
  return _end.distanceTo(_other);
}

/** Every car's pose and velocity as one list of numbers. */
function stateOf(cars: readonly DeformableCar[]): number[] {
  return cars.flatMap((c) => [...c.group.position.toArray(), ...c.group.quaternion.toArray(), ...c.velocity.toArray(), ...c.angular.toArray()]);
}

describe("given a car running away from a world anchor 10 m behind it at 12 m/s", () => {
  const stretchOf = (tethered: boolean, speed = 12): { worst: number; reach: number } => {
    const s = stage([[10, 0, EAST, speed, 0]]);
    const slot = tethered ? tieToWorld(s, 0, ORIGIN) : -1;
    let worst = 0;
    run(s, 3, () => {
      if (tethered) worst = Math.max(worst, span(s, slot) / 10 - 1);
    });
    return { worst, reach: s.cars[0]!.group.position.x };
  };

  it("when its cable is taut, then the cable stretches under 2 % and the car stays within its length", () => {
    const { worst, reach } = stretchOf(true);
    assert.ok(worst < 0.02, `stretch ${(worst * 100).toFixed(2)} %`);
    assert.ok(reach < 10.5, `car at ${reach.toFixed(2)} m`);
  });

  it("when the cable is fitted to a car already at 25 m/s, then it stretches under 2 % from the first slice on", () => {
    const { worst } = stretchOf(true, 25);
    assert.ok(worst < 0.02, `stretch ${(worst * 100).toFixed(2)} %`);
  });

  it("when it has no cable, then it runs far past that length", () => {
    assert.ok(stretchOf(false).reach > 25, "the untethered car stayed near the anchor");
  });
});

describe("given a car rolling 8 m/s away from a world anchor 6 m behind it", () => {
  /** The cable is fitted with the car `fitSpan` m out, then the anchor moves up to 6 m behind it. */
  const slackStage = (fitSpan: number): Staged => {
    const s = stage([[fitSpan, 0, EAST, 8, 0]]);
    const slot = tieToWorld(s, 0, ORIGIN);
    s.set.setEnd(slot, 0, WORLD, fitSpan - 6, 0, 0);
    return s;
  };

  it("when the cable is 20 m long and stays slack, then the car moves exactly as a car with no cable moves", () => {
    const tied = slackStage(20);
    const free = stage([[20, 0, EAST, 8, 0]]);
    run(tied, 1);
    run(free, 1);
    assertSameNumbers(stateOf(tied.cars), stateOf(free.cars), "a slack cable's car against a free one", 0);
  });

  it("when the cable is only 8 m long, then it comes taut at speed with under 0.5 % stretch and the car no longer moves as a free one does", () => {
    const tied = slackStage(8);
    const free = stage([[8, 0, EAST, 8, 0]]);
    let worst = 0;
    run(tied, 1, () => {
      worst = Math.max(worst, span(tied, 0) / 8 - 1);
    });
    run(free, 1);
    assert.ok(worst < 0.005, `stretch ${(worst * 100).toFixed(3)} %`);
    assert.ok(Math.abs(tied.cars[0]!.group.position.x - free.cars[0]!.group.position.x) > 1, "the short cable changed nothing");
  });
});

describe("given a sedan 30 m from a world anchor, its cable as long", () => {
  it("when the retract is held for 3 s, then the sedan has come to within 6 m and the anchor has not moved", () => {
    const s = stage([[30, 0, EAST, 0, 0]]);
    const slot = tieToWorld(s, 0, ORIGIN);
    s.set.reeling = true;
    let nearest = Infinity;
    run(s, 3, () => {
      nearest = Math.min(nearest, span(s, slot));
    });
    s.set.anchor(slot, 0, s.cars, _end);
    assert.ok(nearest < 6, `nearest ${nearest.toFixed(2)} m`);
    assert.equal(_end.lengthSq(), 0, "the world anchor stayed where it was fixed");
  });

  it("when the retract is not held, then the sedan stays where it was", () => {
    const s = stage([[30, 0, EAST, 0, 0]]);
    tieToWorld(s, 0, ORIGIN);
    run(s, 3);
    assert.ok(Math.abs(s.cars[0]!.group.position.x - 30) < 0.01, `sedan at ${s.cars[0]!.group.position.x.toFixed(3)} m`);
  });
});

describe("given a sedan and a monster truck 30 m apart on one cable", () => {
  const travelled = (reeling: boolean): { sedan: number; truck: number } => {
    const s = stage([
      [0, 0, EAST, 0, 0],
      [30, 0, WEST, 0, 0],
    ]);
    assignClass(s.cars[1]!, "monster");
    tieCars(s, 0, 1);
    s.set.reeling = reeling;
    run(s, 1);
    return { sedan: s.cars[0]!.group.position.x, truck: 30 - s.cars[1]!.group.position.x };
  };

  it("when the retract is held for 1 s, then the light sedan comes at least 1.8 times as far as the heavy truck", () => {
    const { sedan, truck } = travelled(true);
    assert.ok(truck > 0.3, `the truck moved ${truck.toFixed(2)} m: the retract did nothing`);
    assert.ok(sedan > 1.8 * truck, `sedan ${sedan.toFixed(2)} m, truck ${truck.toFixed(2)} m`);
  });

  it("when the retract is not held, then neither car moves", () => {
    const { sedan, truck } = travelled(false);
    assert.ok(Math.abs(sedan) < 0.01 && Math.abs(truck) < 0.01, `sedan ${sedan.toFixed(3)} m, truck ${truck.toFixed(3)} m`);
  });
});

describe("given a car released level with a world anchor 20 m up, 15 m aside, on a 15 m cable", () => {
  const ANCHOR_UP = 20;
  const ROPE = 15;
  const swing = (tethered: boolean): { bottomSpeed: number; lowest: number } => {
    const s = stage([[ROPE, 0, EAST, 0, 0]]);
    s.cars[0]!.group.position.y = ANCHOR_UP - s.cars[0]!.frame.centre.y;
    if (tethered) tieToWorld(s, 0, new THREE.Vector3(0, ANCHOR_UP, 0));
    let bottomSpeed = 0;
    let lowest = Infinity;
    run(s, 3, () => {
      const y = s.cars[0]!.group.position.y;
      if (y >= lowest) return;
      lowest = y;
      bottomSpeed = s.cars[0]!.velocity.length();
    });
    return { bottomSpeed, lowest };
  };

  it("when it swings down on the cable, then its speed at the bottom is the free-fall bound within 3 %, never above it", () => {
    const bound = Math.sqrt(2 * GRAVITY * ROPE);
    const { bottomSpeed } = swing(true);
    assert.ok(bottomSpeed <= bound * 1.03, `bottom speed ${bottomSpeed.toFixed(2)} m/s above the bound ${bound.toFixed(2)}`);
    assert.ok(bottomSpeed >= bound * 0.9, `bottom speed ${bottomSpeed.toFixed(2)} m/s: the swing lost its energy (bound ${bound.toFixed(2)})`);
  });

  it("when it has no cable, then it falls the full height instead", () => {
    assert.ok(swing(false).lowest < ANCHOR_UP - ROPE - 3, "the untethered car stayed up");
  });
});

describe("given a car running away at 15 m/s on a cable that holds 20 kN", () => {
  const afterRun = (strength: number): { alive: number; reach: number } => {
    const s = stage([[10, 0, EAST, 15, 0]]);
    tieToWorld(s, 0, ORIGIN, strength);
    run(s, 1.5);
    return { alive: s.set.count, reach: s.cars[0]!.group.position.x };
  };

  it("when the pull passes what the cable holds, then it snaps and the car runs on past its length", () => {
    const { alive, reach } = afterRun(20_000);
    assert.equal(alive, 0, "cables alive");
    assert.ok(reach > 20, `car at ${reach.toFixed(2)} m`);
  });

  it("when the cable holds what the car pulls, then it stays and the car stays within its length", () => {
    const { alive, reach } = afterRun(UNBREAKABLE);
    assert.equal(alive, 1, "cables alive");
    assert.ok(reach < 10.5, `car at ${reach.toFixed(2)} m`);
  });
});

describe("given a sedan on a cable of the strength a new cable has", () => {
  const afterRun = (speed: number): { alive: number; reach: number } => {
    const s = stage([[10, 0, EAST, speed, 0]]);
    tieToWorld(s, 0, ORIGIN, null);
    run(s, 1.5);
    return { alive: s.set.count, reach: s.cars[0]!.group.position.x };
  };

  it("when it drives off at 20 m/s, then the yank snaps the cable and it runs on past the cable's length", () => {
    const { alive, reach } = afterRun(20);
    assert.equal(alive, 0, "cables alive");
    assert.ok(reach > 20, `car at ${reach.toFixed(2)} m`);
  });

  it("when it drives off at 6 m/s, then the cable holds and the car stays within its length", () => {
    const { alive, reach } = afterRun(6);
    assert.equal(alive, 1, "cables alive");
    assert.ok(reach < 10.5, `car at ${reach.toFixed(2)} m`);
  });

  it("when it swings down from level with an anchor 20 m up, then the cable holds the whole swing", () => {
    const s = stage([[15, 0, EAST, 0, 0]]);
    s.cars[0]!.group.position.y = 20 - s.cars[0]!.frame.centre.y;
    tieToWorld(s, 0, new THREE.Vector3(0, 20, 0), null);
    run(s, 4);
    assert.equal(s.set.count, 1, "cables alive");
  });

  it("when it is reeled in from 40 m, then the cable holds the whole reel", () => {
    const s = stage([[40, 0, EAST, 0, 0]]);
    tieToWorld(s, 0, ORIGIN, null);
    s.set.reeling = true;
    run(s, 3);
    assert.equal(s.set.count, 1, "cables alive");
  });
});

describe("given a car on a cable to a wall 40 m off, the retract held", () => {
  const NEAR_WALL = 4.5;
  /** Seconds until the car is within `NEAR_WALL` m of the wall, or Infinity. */
  const arrival = (monster: boolean): number => {
    const s = stage([[40, 0, EAST, 0, 0]]);
    if (monster) assignClass(s.cars[0]!, "monster");
    const slot = tieToWorld(s, 0, ORIGIN);
    s.set.reeling = true;
    for (let i = 0; i < 4 * QUIET_HZ; i++) {
      step(s);
      if (span(s, slot) < NEAR_WALL) return (i + 1) * H;
    }
    return Infinity;
  };

  it("when the car is a sedan, then it arrives in 1.5 to 2 s", () => {
    const seconds = arrival(false);
    assert.ok(seconds >= 1.5 && seconds <= 2, `sedan arrived in ${seconds.toFixed(2)} s`);
  });

  it("when the car is a monster truck, then it arrives at least 15 % later than the sedan", () => {
    const sedan = arrival(false);
    const truck = arrival(true);
    assert.ok(truck >= 1.15 * sedan, `sedan ${sedan.toFixed(2)} s, truck ${truck.toFixed(2)} s`);
  });
});

describe("given a car on a cable to a world anchor, the cable reeled for 1 s then let go", () => {
  const trial = (): number[] => {
    const s = stage([[30, 4, EAST, 3, -1]]);
    tieToWorld(s, 0, ORIGIN);
    s.set.reeling = true;
    run(s, 1);
    s.set.reeling = false;
    run(s, 1);
    return stateOf(s.cars);
  };

  it("when the run is made twice, then both end in the same state, bit for bit", () => {
    assertSameNumbers(trial(), trial(), "the second run against the first", 0);
  });
});

describe("given two cars close enough to be in contact and a third far off, the race's lone-car rule on", () => {
  const lonersWith = (cable: boolean): number => {
    const s = stage([
      [0, 0, EAST, 1, 0],
      [4, 0, WEST, -1, 0],
      [300, 0, EAST, 5, 0],
    ]);
    s.world.lone = true;
    if (cable) tieToWorld(s, 2, new THREE.Vector3(300, 0, 20));
    step(s);
    return s.world.loners;
  };

  it("when no cable is out, then the far car runs the step as a lone car", () => {
    assert.equal(lonersWith(false), 1 << 2, "the lone mask");
  });

  it("when a cable holds the far car, then no car runs the step as a lone one", () => {
    assert.equal(lonersWith(true), 0, "the lone mask");
  });
});

describe("given a full set of cables", () => {
  it("when another is opened, then the oldest is the one dropped", () => {
    const set = new TetherSet();
    const slots = Array.from({ length: MAX_TETHERS + 1 }, () => set.open());
    assert.equal(set.count, MAX_TETHERS, "cables alive");
    assert.equal(slots[MAX_TETHERS], slots[0], "the new cable took the oldest one's slot");
    assert.ok(set.isAlive(slots[1]!), "the newer cable is still out");
  });
});
