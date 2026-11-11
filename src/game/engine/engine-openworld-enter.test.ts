import * as THREE from "three";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import { blankEjection } from "../vehicle/ejection.ts";
import { idleDrive } from "../vehicle/car-drive.ts";
import { NO_CAR_PICK } from "../match/look-data.ts";
import { ownLook } from "../present/driver-look.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

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
    const before = JSON.stringify(ragdolls.carDriverLook(target));
    expect(before, "before: that car's driver is another person (the check can fail)").not.toBe(own);
    rig.getOut();
    rig.walkToDoor(rig.cars()[target]!);
    rig.press("Enter");
    rig.run(1);
    expect(rig.engine["seat"].carIndex, "he is in the other car").toBe(target);
    expect(JSON.stringify(ragdolls.carDriverLook(target)), "the driver drawn in it").toBe(own);
    const thrown = ragdolls["dressingOf"]({ car: target, cop: false } as Parameters<(typeof ragdolls)["dressingOf"]>[0], null);
    expect(JSON.stringify(thrown.look), "the driver thrown from it").toBe(own);
    rig.getOut();
    rig.run(0.5);
    expect(JSON.stringify(ragdolls.carDriverLook(target)), "and still his once he is out of it").toBe(own);
  });

  // mutation: sed -i 's/    t.cop = this.uniformOn(e.car, e.cop);/    t.cop = e.cop;/' src/game/present/ragdoll-throw.ts
  it("when he is thrown from a car whose own driver wears the uniform, then the man thrown wears no uniform and is him", () => {
    const ragdolls = rig.engine["ragdolls"];
    const target = rig.engine["seat"].carIndex;
    const car = rig.cars()[target]!;
    expect(ragdolls.uniformOn(target, true), "a patrol car he drives: no uniform").toBe(false);
    expect(ragdolls.uniformOn(target + 1, true), "a patrol car nobody took: its driver's uniform").toBe(true);
    const e = blankEjection();
    e.car = target;
    e.cop = true;
    e.dir.set(0, 0, 1).applyQuaternion(car.group.quaternion);
    e.pos.copy(car.group.position).addScaledVector(THREE.Object3D.DEFAULT_UP, 1.3).addScaledVector(e.dir, 0.6);
    e.quat.copy(car.group.quaternion);
    e.rel.copy(e.dir).multiplyScalar(3).addScaledVector(THREE.Object3D.DEFAULT_UP, 6);
    e.carVel.copy(car.velocity);
    const dressed: { cop: boolean; look: unknown }[] = [];
    const dressingOf = ragdolls["dressingOf"].bind(ragdolls);
    ragdolls["dressingOf"] = (t, given) => {
      const out = dressingOf(t, given);
      if (t.car === target) dressed.push({ cop: t.cop, look: out.look });
      return out;
    };
    try {
      ragdolls.launch(e, rig.cars());
    } finally {
      ragdolls["dressingOf"] = dressingOf;
    }
    expect(dressed.length, "his throw was dressed").toBeGreaterThan(0);
    expect(dressed[0]!.cop, "no uniform on the man thrown").toBe(false);
    expect(JSON.stringify(dressed[0]!.look), "the man thrown is him").toBe(JSON.stringify(ownLook(rig.engine["looks"].mine.person)));
  });

  // mutation: sed -i 's/    t.cop = this.uniformOn(e.car, e.cop);/    t.cop = false;/' src/game/present/ragdoll-throw.ts
  it("when a patrol car nobody took ejects its driver, then the man thrown wears the uniform", () => {
    const ragdolls = rig.engine["ragdolls"];
    const other = rig.engine["seat"].carIndex + 1;
    const car = rig.cars()[other]!;
    const e = blankEjection();
    e.car = other;
    e.cop = true;
    e.dir.set(0, 0, 1).applyQuaternion(car.group.quaternion);
    e.pos.copy(car.group.position).addScaledVector(THREE.Object3D.DEFAULT_UP, 1.3).addScaledVector(e.dir, 0.6);
    e.quat.copy(car.group.quaternion);
    e.rel.copy(e.dir).multiplyScalar(3).addScaledVector(THREE.Object3D.DEFAULT_UP, 6);
    e.carVel.copy(car.velocity);
    const dressed: boolean[] = [];
    const dressingOf = ragdolls["dressingOf"].bind(ragdolls);
    ragdolls["dressingOf"] = (t, given) => {
      if (t.car === other) dressed.push(t.cop);
      return dressingOf(t, given);
    };
    try {
      ragdolls.launch(e, rig.cars());
    } finally {
      ragdolls["dressingOf"] = dressingOf;
    }
    expect(dressed.length, "his throw was dressed").toBeGreaterThan(0);
    expect(dressed[0], "the uniform on the man thrown").toBe(true);
  });

  // mutation: sed -i 's/    const car = this.cars\[this.ownCar()\];/    const car = this.cars[this.drivenCar()];/' src/game/engine/engine-share.ts
  it("when he has got into a kerb car and his look is restyled, then that car keeps its own body and colour and his own car keeps his paint", () => {
    const target = nearestEmptyCar();
    const engine = rig.engine;
    const picked = 0x336699;
    engine["looks"].mine.car = { ...NO_CAR_PICK, body: picked };
    engine["restyle"]();
    const own = rig.cars()[0]!;
    expect(own.lookMeshes().bodyPaint.color.getHex(), "his own car wears his pick").toBe(picked);
    const kerb = rig.cars()[target]!;
    rig.getOut();
    rig.walkToDoor(kerb);
    rig.press("Enter");
    rig.run(1);
    expect(engine["seat"].carIndex, "he is in the kerb car").toBe(target);
    const kerbPaint = kerb.lookMeshes().bodyPaint.color.getHex();
    const kerbBody = kerb.style.id;
    engine["restyle"]();
    expect(kerb.lookMeshes().bodyPaint.color.getHex(), "the kerb car keeps its own colour").toBe(kerbPaint);
    expect(kerb.style.id, "and its own body").toBe(kerbBody);
    expect(own.lookMeshes().bodyPaint.color.getHex(), "his own car keeps his paint").toBe(picked);
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

  // mutation: sed -i '/^    this.swingDoor(wallDt);/d' src/game/engine/engine-onfoot.ts
  it("when he gets out in the open world, then his driver's door swings open and shuts once he has walked off; when he gets back in, it opens and shuts behind him", () => {
    const car = rig.cars()[rig.engine["seat"].carIndex]!;
    const widestOver = (frames: number): number => {
      let widest = 0;
      for (let f = 0; f < frames; f++) {
        rig.run(FRAME);
        widest = Math.max(widest, Math.abs(car.doorAngle(DRIVER_SIDE)));
      }
      return widest;
    };
    rig.press("Enter");
    expect(widestOver(54), "the door's widest angle while he got out (rad)").toBeGreaterThan(0.5);
    expect(rig.phase(), "he is out").toBe("onFoot");
    rig.walkTo(rig.beside(car, 6.5, 0), 1, 15);
    rig.run(1);
    expect(Math.abs(car.doorAngle(DRIVER_SIDE)), "shut once he has walked off").toBeLessThan(0.02);
    rig.walkToDoor(car);
    rig.press("Enter");
    expect(widestOver(42), "the door's widest angle while he got in").toBeGreaterThan(0.5);
    rig.run(1);
    expect(rig.phase(), "he is in").toBe("inCar");
    expect(Math.abs(car.doorAngle(DRIVER_SIDE)), "shut behind him").toBeLessThan(0.02);
  });
});
