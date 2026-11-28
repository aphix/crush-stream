import { afterEach, describe, expect, it } from "vitest";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { layOnGround } from "./car-air-points.ts";
import type { DriveInput } from "./car-drive.ts";
import { assertSameNumbers } from "./test-support.ts";
import { setGround } from "../world/ground.ts";

const KPH = 1 / 3.6;
const FRAMES = 300;
const POSE_TOLERANCE = 1e-8;
const GAS: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };

afterEach(() => setGround(null));

/** A sedan driven into a wall at 50 km/h and on; `unseen` keeps `setPartsUnseen` on for every frame. */
function drive(unseen: boolean) {
  const car = makeCar("shape");
  launch(car, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
  layOnGround(car);
  const w = makeWorld([car], true, false, FREEWHEEL);
  w.pedals.set(car, GAS);
  car.setPartsUnseen(unseen);
  for (let f = 0; f < FRAMES; f++) tickWorld(w);
  return car;
}

function poses(car: ReturnType<typeof drive>): number[] {
  const out: number[] = [];
  for (const [i, o] of car.partObjects().entries()) {
    if (!car.partOn(i)) continue;
    o.position.toArray(out, out.length);
    o.quaternion.toArray(out, out.length);
    o.scale.toArray(out, out.length);
  }
  return out;
}

describe("given a wreck driven on while no camera sees it", () => {
  // mutation: sed -i 's/    if (!onRoad || !this.unseen || p.region !== null) return false;/    return false;/' src/game/vehicle/part-pose-wait.ts
  it("when it is driven, then far fewer part poses are written than when seen, and every one is owed", () => {
    const seen = drive(false);
    const hidden = drive(true);
    expect(hidden.partWrites, `${hidden.partWrites} writes against ${seen.partWrites}`).toBeLessThan(0.5 * seen.partWrites);
    expect(hidden.partsOwed, "poses left owed").toBe(true);
  });

  // mutation: sed -i 's/^    this.poseOwed();$/    this.wait.owed = false;/' src/game/vehicle/car-parts.ts
  it("when it is seen again and settled, then every part stands as in a run that was seen throughout", () => {
    const seen = drive(false);
    const hidden = drive(true);
    hidden.setPartsUnseen(false);
    hidden.settleParts();
    expect(hidden.partsOwed, "nothing owed").toBe(false);
    assertSameNumbers(poses(hidden), poses(seen), "part poses", POSE_TOLERANCE);
  });
});
