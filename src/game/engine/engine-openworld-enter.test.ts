import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import { idleDrive } from "../vehicle/car-drive.ts";
import { ownLook } from "../present/driver-look.ts";
import { OnFootRig } from "./engine-onfoot.test-util.ts";

const LINK = "#scene=openworld&seed=beef";
/** Seconds the traffic needs to stand its first kerb cars (its first passes show every space in reach). */
const SETTLE_S = 3;
/** How far a held car may creep (m). */
const HELD_CREEP_M = 0.5;
const MINUTE_S = 60;
const DRIVE_S = 2;
const DROVE_OFF_M = 3;

describe("given the real engine in the open world, its player out of his car with a kerb car near", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  const world = () => rig.engine["openWorld"];

  /** The nearest car (to the player's own car) the open world says is empty, other than car 0. */
  function nearestEmptyCar(): number {
    const own = rig.cars()[0]!;
    let best = -1;
    let bestGap = Infinity;
    for (let index = 1; index < rig.cars().length; index++) {
      const car = rig.cars()[index]!;
      if (!world().canEnter(index) || !car.group.visible) continue;
      const gap = hypot2(car.group.position.x - own.group.position.x, car.group.position.z - own.group.position.z);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = index;
    }
    return best;
  }

  beforeAll(async () => {
    rig = await OnFootRig.boot(LINK);
    rig.run(SETTLE_S);
  });
  beforeEach(() => {
    rig.engine["onFoot"].reset();
    rig.engine["ragdolls"].reset();
    rig.engine["race"].adoptCar(0);
    rig.sit(0);
    rig.run(0.2);
  });
  afterAll(() => rig.dispose());

  // mutation: sed -i 's/      if (index !== this.flow.car \&\& this.host.enterable(index) \&\& doorInReach(cars\[index\]!, _torso, this.speed)) return index;/      continue;/' src/game/engine/engine-onfoot.ts
  it("when he gets out, walks to an empty kerb car's driver door and presses Enter, then he is at its wheel: the seat and the lobby's own car are it", () => {
    const target = nearestEmptyCar();
    expect(target, "an empty car stands near").toBeGreaterThan(0);
    rig.getOut();
    rig.walkToDoor(rig.cars()[target]!);
    rig.press("Enter");
    rig.run(1);
    expect(rig.phase(), "the climb is over").toBe("inCar");
    expect(rig.engine["seat"].carIndex, "the seat has the kerb car").toBe(target);
    expect(rig.engine["seat"].mode, "he drives").toBe("drive");
    expect(rig.engine["race"].self, "it is the car this browser drives").toBe(target);
  });

  // mutation: sed -i 's/  isEmptyCar(id: number): boolean {/  isEmptyCar(id: number): boolean {\n    return true;/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when the car at the door has a driver on a trip of the traffic's, then Enter does nothing: he stays out and is told it is not his", () => {
    const target = nearestEmptyCar();
    const traffic = world()["traffic"]!;
    const from = traffic.nearestSpot(rig.cars()[target]!.group.position.x, rig.cars()[target]!.group.position.z);
    const held = traffic.spawnDrivenCar(-1, from, traffic.nearestSpot(rig.cars()[0]!.group.position.x + 80, rig.cars()[0]!.group.position.z), { urgent: false })!;
    held.driver = () => ({ ...idleDrive(), brake: 1 });
    rig.getOut();
    rig.walkToDoor(rig.cars()[held.index]!);
    rig.press("Enter");
    rig.run(1);
    expect(rig.phase(), "he is still out").toBe("onFoot");
    expect(rig.engine["seat"].carIndex, "the seat is still on his own car").toBe(0);
    expect(rig.engine["race"].self, "this browser still drives car 0").toBe(0);
  });

  // mutation: sed -i 's/    if (id < 0 || id >= MAX_CARS || humans\[id\] === 1) return -1;/    if (id < 0 || id >= MAX_CARS) return -1;\n    if (id >= 0) return -1;/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when he has taken a kerb car, then it stays his for a minute (traffic does not put it away or stand it anew) and he drives it off", () => {
    const target = nearestEmptyCar();
    rig.getOut();
    rig.walkToDoor(rig.cars()[target]!);
    rig.press("Enter");
    rig.run(1);
    rig.run(MINUTE_S);
    const car = rig.cars()[target]!;
    expect(car.group.visible && !car.stored, "still on the street, not put away").toBe(true);
    const before = car.group.position.clone();
    rig.hold("KeyW", DRIVE_S);
    expect(hypot2(car.group.position.x - before.x, car.group.position.z - before.z), "he drove it off").toBeGreaterThan(DROVE_OFF_M);
  });

  // mutation: sed -i 's/    if (adopted !== null && this.race?.free === true && this.race.self === adopted) return adopted;/    void adopted;/' src/game/engine/engine-core.ts
  it("when he has got into another car, then he is the same person in it: the driver drawn in it and the one thrown from it are his, not the seed's driver of that car", () => {
    const target = nearestEmptyCar();
    const ragdolls = rig.engine["ragdolls"];
    const own = JSON.stringify(ownLook(rig.engine["looks"].mine.person));
    const before = JSON.stringify(ragdolls.carDriverLook(target, false));
    expect(before, "before: that car's driver is another person (the check can fail)").not.toBe(own);
    rig.getOut();
    rig.walkToDoor(rig.cars()[target]!);
    rig.press("Enter");
    rig.run(1);
    expect(rig.engine["seat"].carIndex, "he is in the other car").toBe(target);
    expect(JSON.stringify(ragdolls.carDriverLook(target, false)), "the driver drawn in it").toBe(own);
    const thrown = ragdolls["dressingOf"]({ car: target, cop: false } as Parameters<(typeof ragdolls)["dressingOf"]>[0], null);
    expect(JSON.stringify(thrown.look), "the driver thrown from it").toBe(own);
    rig.getOut();
    rig.run(0.5);
    expect(JSON.stringify(ragdolls.carDriverLook(target, false)), "and still his once he is out of it").toBe(own);
  });

  // mutation: sed -i 's/    if (id < this.first || this.context.humans\[id\] === 1 || car.driverOut !== null) return true;/    if (this.context.humans[id] === 1 || car.driverOut !== null) return true;/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when he has got into another car, then the one he left stands where it was, empty, and he can walk back and get into it again", () => {
    const target = nearestEmptyCar();
    const own = rig.cars()[0]!;
    const left = own.group.position.clone();
    rig.getOut();
    rig.walkToDoor(rig.cars()[target]!);
    rig.press("Enter");
    rig.run(1);
    expect(rig.engine["seat"].carIndex, "he is in the other car").toBe(target);
    rig.run(5);
    expect(own.group.position.distanceTo(left), "his old car stood still").toBeLessThan(HELD_CREEP_M);
    expect(world().canEnter(0), "and it is an empty car anyone may take").toBe(true);
    rig.getOut();
    rig.walkToDoor(own);
    rig.press("Enter");
    rig.run(1);
    expect(rig.engine["seat"].carIndex, "he is back in his first car").toBe(0);
    expect(rig.engine["race"].self).toBe(0);
    expect(world().canEnter(target), "the kerb car he left is empty again").toBe(true);
  });
});
