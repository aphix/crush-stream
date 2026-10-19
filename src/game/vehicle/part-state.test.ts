import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeformableCar } from "./car.ts";
import type { LooseShape } from "./car-core.ts";
import { idleDrive, applyDrive } from "./car-drive.ts";
import { makeCar } from "./ground-probe.test-util.ts";
import { boxShape, newLooseShape } from "./loose-step.ts";
import { LOOSE_STATE_MAX } from "./part-state.ts";
import { assertSameNumbers } from "./test-support.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { QUIET_HZ } from "../kernel/constants.ts";
import { makeCarFrame } from "../net/codec.ts";
import { carLayout } from "../net/car-pose.ts";

const SLICE_S = 1 / QUIET_HZ;
const IDLE = idleDrive();
const ARCH = "archFL";
/** The arch tears while the nose hit is still crushing the body, which crushes on for the slices after. */
const TEAR_SLICE = 10;
const AFTER_SLICES = 60;

/** A sedan hit on the nose, its front-left arch torn at `TEAR_SLICE`, stepped on until it has flown `AFTER_SLICES` slices. */
function wreckWithTornArch(): DeformableCar {
  const car = makeCar("sedan");
  car.spawnFacing(0, 0, 0, 0);
  car.group.updateMatrixWorld(true);
  car.updateSkin();
  car.applyImpact(car.group.position.clone().addScaledVector(car.forward, 2.05), car.forward.clone().negate(), 0.5, 0.5);
  const world = newWorld([car], null);
  const arch = car["parts"].find((p) => p.name === ARCH)!;
  for (let slice = 0; slice < TEAR_SLICE + AFTER_SLICES; slice++) {
    if (slice === TEAR_SLICE) car["detachPart"](arch, 20);
    applyDrive(car, IDLE, SLICE_S);
    stepWorld(world, SLICE_S);
    car.stepBreakage(SLICE_S);
    car.updateSkin();
  }
  return car;
}

/** A twin of `car` as a keyframe restores it: the net state (which throws the torn arch off its own skin), then the loose block. */
function twinFromKeyframe(car: DeformableCar): DeformableCar {
  const frame = makeCarFrame(carLayout(car));
  car.deform.readNetState(frame.deform);
  car.readPartNetState(frame.parts);
  const loose = new Float64Array(LOOSE_STATE_MAX);
  car.looseState(loose, false);
  const twin = makeCar("sedan");
  twin.spawnFacing(car.group.position.x, car.group.position.z, car.yaw, 0);
  twin.writeNetState(frame.deform, frame.parts);
  twin.looseState(loose, true);
  return twin;
}

describe("given a wreck whose arch flare tore off while its body was still crushing, and a twin rebuilt from its keyframe's net state and loose block", () => {
  it("when the twin's arch is put back where the wreck's lies, then it flies as the box the wreck's was measured as when it tore, not as its shell drawn on the twin's skin now", () => {
    const car = wreckWithTornArch();
    const arch = car["parts"].find((p) => p.name === ARCH)!;
    assert.ok(arch.detached && arch.shape.count > 0, "the arch tore and flew");
    const twin = twinFromKeyframe(car);
    const twinArch = twin["parts"].find((p) => p.name === ARCH)!;
    const drawnNow = newLooseShape();
    boxShape(drawnNow, twinArch.object);
    assert.notEqual(drawnNow.reach, arch.shape.reach, "the control: the twin's shell, drawn on the skin as it is now, is the box of another size");
    const [twinBox, liveBox] = [twinArch.shape, arch.shape].map((s) => [s.count, s.reach, ...s.centre.toArray(), ...s.invI.toArray(), ...s.points.subarray(0, 3 * s.count)]);
    assertSameNumbers(twinBox!, liveBox!, "the twin's arch box");
  });
});
