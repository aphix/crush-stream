import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { DeformableCar } from "./car.ts";
import { idleDrive, applyDrive } from "./car-drive.ts";
import { makeCar } from "./ground-probe.test-util.ts";
import { boxShape, newLooseShape } from "./loose-step.ts";
import { PART_KIND, PartSeat, partGeometry } from "./part-geometry.ts";
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

describe("given a parked sedan whose front bumper tore off and flew, and a twin rebuilt from its keyframe's net state and loose block", () => {
  it("when the twin's bumper is put back where the sedan's lies, then it flies as the same shell points (a torn bumper is a U in plan, not its box), not as its box", () => {
    const car = makeCar("sedan");
    car.spawnFacing(0, 0, 0, 0);
    const world = newWorld([car]);
    const bumper = car["parts"].find((p) => p.name === "bumperF")!;
    car["detachPart"](bumper, 0);
    for (let slice = 0; slice < AFTER_SLICES; slice++) stepWorld(world, SLICE_S);
    assert.ok(bumper.shape.count > 0 && !bumper.shape.box, `the bumper flew as its shell's points: count ${bumper.shape.count}, box ${bumper.shape.box}`);
    const twin = twinFromKeyframe(car);
    const twinBumper = twin["parts"].find((p) => p.name === "bumperF")!;
    const [twinShape, liveShape] = [twinBumper.shape, bumper.shape].map((s) => [s.count, s.box ? 1 : 0, s.reach, ...s.centre.toArray(), ...s.half.toArray(), ...s.invI.toArray(), ...s.points.subarray(0, 3 * s.count)]);
    assertSameNumbers(twinShape!, liveShape!, "the twin's bumper shape");
  });
});

// A torn seat flies as drawn (owner ruling); host and client each measure it from the same style tables.
describe("given a sedan whose front bumper, carrying the style's own drawn grille, tore off, and a netplay client's twin that tears it from the net state alone", () => {
  it("when each measures the torn bumper's loose shape, then the client's is the host's to the bit, and its grille flies as the style draws it, not as the platform grille", () => {
    const car = makeCar("sedan");
    car.spawnFacing(0, 0, 0, 0);
    car.group.updateMatrixWorld(true);
    car.updateSkin();
    const bumper = car["parts"].find((p) => p.name === "bumperF")!;
    car["detachPart"](bumper, 0);
    boxShape(bumper.shape, bumper.object);
    const frame = makeCarFrame(carLayout(car));
    car.deform.readNetState(frame.deform);
    car.readPartNetState(frame.parts);
    const twin = makeCar("sedan");
    twin.spawnFacing(car.group.position.x, car.group.position.z, car.yaw, 0);
    twin.writeNetState(frame.deform, frame.parts);
    const twinBumper = twin["parts"].find((p) => p.name === "bumperF")!;
    assert.ok(twinBumper.detached, "the client's bumper tore from the net state alone");
    boxShape(twinBumper.shape, twinBumper.object);
    const [client, host] = [twinBumper.shape, bumper.shape].map((s) => [s.count, s.reach, ...s.centre.toArray(), ...s.invI.toArray(), ...s.points.subarray(0, 3 * s.count)]);
    assertSameNumbers(client!, host!, "the client's torn bumper shape");

    const seats: PartSeat[] = [];
    bumper.object.traverse((o) => {
      if (o instanceof PartSeat && o.kind === PART_KIND.grille) seats.push(o);
    });
    assert.equal(seats.length, 1, "the bumper carries one grille seat");
    const loose = seats[0]!.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
    const flies = loose.geometry.boundingBox!;
    const drawn = new THREE.Box3().setFromBufferAttribute(loose.geometry.getAttribute("position") as THREE.BufferAttribute);
    assert.ok(flies.equals(drawn), `the torn grille's box ${flies.min.toArray()} .. ${flies.max.toArray()} is not its drawn vertices' ${drawn.min.toArray()} .. ${drawn.max.toArray()}`);
    const platform = partGeometry(PART_KIND.grille);
    if (platform.boundingBox === null) platform.computeBoundingBox();
    assert.ok(!platform.boundingBox!.equals(flies), "the control: the sedan's drawn grille is the platform grille's box");
  });
});
