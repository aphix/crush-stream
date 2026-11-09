import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { activeGround } from "../world/ground.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../world/openworld/openworld-layout.ts";
import { OnFootRig } from "./engine-onfoot.test-util.ts";

const LINK = "#scene=openworld&seed=beef";
/** Seconds the crowd needs to come out of its doors and the first kerb cars to stand. */
const SETTLE_S = 4;
/** Seconds tried (one a go) for a civilian walking over a carriageway who has a body. */
const ATTEMPTS = 120;
/** She is walking when she goes faster than this (m/s) and is on the carriageway when within this far (m) of its middle. */
const WALKING_MPS = 0.5;
const ON_ROAD_MARGIN_M = 1;
/** The car starts this far (m) behind her along her way, at this speed (m/s), and runs for this many seconds. */
const RUN_UP_M = 14;
const RUN_UP_MPS = 13;
const RUN_S = 3;
const BODY_WAIT_S = 1;
/** The first pool slot a body takes. */
const FIRST_BODY_SLOT = 4;
/** A body lying on the street has its torso within this far (m) of the ground. */
const LYING_TORSO_MAX_M = 1.5;

/** Whether the ground point (x, z) is inside the plan box of `car` as it stands. */
function insideCar(car: DeformableCar, x: number, z: number): boolean {
  const { x: qx, y: qy, z: qz, w: qw } = car.group.quaternion;
  const dx = x - car.group.position.x;
  const dz = z - car.group.position.z;
  const across = dx * (1 - 2 * (qy * qy + qz * qz)) + dz * (2 * (qx * qz - qw * qy));
  const ahead = dx * (2 * (qx * qz + qw * qy)) + dz * (1 - 2 * (qx * qx + qy * qy));
  const plan = car.cage.fields.planBox;
  return across > plan[0]! && across < plan[1]! && ahead > plan[2]! && ahead < plan[3]!;
}

describe("given the real engine in the open world and the player's car running at a civilian", () => {
  let rig: OnFootRig;
  const world = () => rig.engine["openWorld"];
  const ragdolls = () => rig.engine["ragdolls"];

  beforeAll(async () => {
    rig = await OnFootRig.boot(LINK);
    rig.sit(0);
    rig.run(SETTLE_S);
  });
  afterAll(() => rig.dispose());

  /** A civilian the manager has given a body, with the car stood near her: her index. */
  function civilianWithBody(): number {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      rig.run(1);
      const crowd = world()["crowd"]!;
      for (let resident = 0; resident < crowd.poses.count; resident++) {
        if (crowd.poses.shown[resident] === 0 || crowd.poses.activity[resident] !== ACTIVITY.none || crowd.poses.speed[resident]! < WALKING_MPS) continue;
        if (!aimCar(resident, 0)) continue;
        rig.run(BODY_WAIT_S);
        if (world()["bodies"]!.slotOf(resident) >= FIRST_BODY_SLOT && aimCar(resident, 0)) return resident;
      }
    }
    throw new Error("no civilian on a street took a body");
  }

  /** The player's car stood `RUN_UP_M` m up the street from where civilian `resident` will be when it arrives, facing along the street, going `speed`: false when she is not on a carriageway or another car is in its way. */
  function aimCar(resident: number, speed: number): boolean {
    const geometry = openWorldGeometry(LAYOUT);
    const crowd = world()["crowd"]!;
    const yaw = crowd.poses.yaw[resident]!;
    const arrival = RUN_UP_M / Math.max(speed, RUN_UP_MPS);
    const x = crowd.poses.x[resident]! + Math.sin(yaw) * crowd.poses.speed[resident]! * arrival;
    const z = crowd.poses.z[resident]! + Math.cos(yaw) * crowd.poses.speed[resident]! * arrival;
    const nearestX = geometry.streetX.reduce((best, line) => (Math.abs(line - x) < Math.abs(best - x) ? line : best));
    const nearestZ = geometry.streetZ.reduce((best, line) => (Math.abs(line - z) < Math.abs(best - z) ? line : best));
    const alongX = Math.abs(nearestZ - z) < Math.abs(nearestX - x);
    if ((alongX ? Math.abs(nearestZ - z) : Math.abs(nearestX - x)) > geometry.carriageway / 2 - ON_ROAD_MARGIN_M) return false;
    const carYaw = alongX ? Math.PI / 2 : 0;
    const startX = x - (alongX ? RUN_UP_M : 0);
    const startZ = z - (alongX ? 0 : RUN_UP_M);
    const car = rig.cars()[0]!;
    for (const [index, other] of rig.cars().entries()) {
      if (index !== 0 && !other.stored && hypot2(other.group.position.x - (startX + x) / 2, other.group.position.z - (startZ + z) / 2) < RUN_UP_M) return false;
    }
    car.spawnFacing(startX, startZ, carYaw, speed);
    car.group.position.y = activeGround().heightAt(startX, startZ, 0.5);
    layOnGround(car);
    return true;
  }

  // mutation: sed -i 's/      if (this.bodies?.knock(strike) === true) {/      if (false) {/' src/game/engine/engine-openworld.ts
  it("when the car hits her, then her own live body is knocked down and lies outside the car, and no second dummy is thrown for her", () => {
    const resident = civilianWithBody();
    const crowd = world()["crowd"]!;
    const slot = world()["bodies"]!.slotOf(resident);
    expect(ragdolls().walkers[slot]!.state, "she is on her feet before").toBe("stand");
    const thrownBefore = ragdolls().outNow().dummies.filter((out) => out.state === null).length;
    const car = rig.cars()[0]!;
    expect(aimCar(resident, RUN_UP_MPS), "the car is stood in the street, aimed").toBe(true);
    rig.hold("KeyW", RUN_S);
    expect(ragdolls().walkers[slot]!.state, "her body went down").not.toBe("stand");
    expect(ragdolls().outNow().dummies.filter((out) => out.state === null).length, "figures thrown (dummies no walker's motors hold): none more than before the hit").toBe(thrownBefore);
    const torso = { x: 0, y: 0, z: 0 };
    const dummy = ragdolls().outNow().dummies.find((out) => out.slot === slot)!;
    torso.x = dummy.x;
    torso.z = dummy.z;
    expect(insideCar(car, torso.x, torso.z), "her body is not inside the car").toBe(false);
    expect(dummy.y - activeGround().heightAt(torso.x, torso.z, 0.5), "her torso is on the ground (m over it), not under the car or in the air").toBeLessThan(LYING_TORSO_MAX_M);
    expect(dummy.y - activeGround().heightAt(torso.x, torso.z, 0.5), "and not under it").toBeGreaterThan(-LYING_TORSO_MAX_M);
    expect(crowd.poses.shown[resident], "the crowd has her down").toBe(0);
  });
});
