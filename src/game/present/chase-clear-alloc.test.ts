import * as THREE from "three";
import { afterAll, describe, expect, it } from "vitest";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet, type Within } from "../kernel/alloc-sample.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { detCos, detSin } from "../kernel/physics-core.js";
import { DeformableCar } from "../vehicle/car.ts";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { placeProps } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { ChaseSolids } from "./chase-solids.ts";
import { DriveCam } from "./drive-cam.ts";
import { raceSight } from "./spectate-cam.ts";

const DT = 1 / FRAME_HZ;
/** The car circles this far (m) round a point this far (m) out from a building's front, at this speed (m/s): its chase eye keeps running into the building. */
const CIRCLE_M = 2.5;
const OUT_FROM_FRONT_M = 4.5;
const SPEED_MPS = 3;
/** Other cars parked round it, their boxes in the chase's sight. */
const PARKED = 6;
/** Frames before the first read (past V8's tier-up), the frames a read spans, and the bar (B a frame). */
const WARM_FRAMES = 6000;
const WINDOW_FRAMES = 2000;
const BOUND_B = 16;

const track = new Track(parseTrack(openWorldCourse(layOutLots())));
const placed = placeProps(track);
const course = raceSight(track, placed);
setGround(track.ground());
afterAll(() => setGround(null));

const building = placed.find((prop) => prop.prefab === PREFAB.buildingShell || prop.prefab === PREFAB.building)!;
const frontX = detCos(building.yaw);
const frontZ = -detSin(building.yaw);
const reach = (PREFABS[building.prefab].size[0] * building.sx) / 2 + OUT_FROM_FRONT_M;
const middleX = building.x + frontX * reach;
const middleZ = building.z + frontZ * reach;
const paint = { body: 0x808080, accent: 0x404040, name: "car" };
const car = new DeformableCar(paint, new THREE.Scene());
const cars = [car, ...Array.from({ length: PARKED }, () => new DeformableCar(paint, new THREE.Scene()))];
for (let k = 1; k < cars.length; k++) cars[k]!.group.position.set(middleX + 6 * detCos(k), 0, middleZ + 6 * detSin(k));
const solids = new ChaseSolids(() => {});
const cam = new DriveCam();
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 400);
let frames = 0;

/** One frame: the car moves on round its circle, the chase's sight is rebuilt and the chase camera frames it. */
function frame(): void {
  const angle = (frames++ * DT * SPEED_MPS) / CIRCLE_M;
  car.group.position.set(middleX + CIRCLE_M * detSin(angle), 0, middleZ + CIRCLE_M * detCos(angle));
  car.fwdFlat.set(detCos(angle), 0, -detSin(angle));
  car.velocity.set(car.fwdFlat.x * SPEED_MPS, 0, car.fwdFlat.z * SPEED_MPS);
  cam.update(camera, car, "third", DT, 0, 0, false, solids.frame(course, false, cars, car));
}

/** Bytes a frame made under calls of `within` over a window of frames. */
function windowPerFrame(within: Within): number {
  return (
    allocatedBytes(() => {
      for (let f = 0; f < WINDOW_FRAMES; f++) frame();
    }, within) / WINDOW_FRAMES
  );
}

describe("given the chase camera on a car circling in front of an open-world building, other cars parked round it", () => {
  const parts = [
    // mutation: sed -i 's/^  let kept = 0;$/  _near.length = 0;\n  let kept = 0;/' src/game/present/spectate-cam.ts
    { it: "gathering the solids near the eye's line", within: { fn: "gather", file: "spectate-cam.ts" } },
    // mutation: sed -i 's/^    this.carClear = reach;$/    this.carClear = reach;\n    Object.assign(this, { asked: [reach] });/' src/game/present/eye-clear.ts
    { it: "testing the other cars' boxes on the eye's line", within: { fn: "carReach", file: "eye-clear.ts" } },
  ] as const;
  for (const part of parts) {
    it(`when a window of frames is run, then ${part.it} allocates no more than ${BOUND_B} bytes a frame`, () => {
      for (let f = 0; f < WARM_FRAMES; f++) frame();
      const perFrame = untilQuiet(() => windowPerFrame(part.within), BOUND_B);
      if (process.env.ALLOC_PRINT) console.log(`chase-clear-alloc ${part.within.fn}: ${perFrame.toFixed(2)} B/frame`);
      expect(perFrame, `${perFrame.toFixed(1)} B a frame > ${BOUND_B} in every window for ${COMPILE_WAIT_S} s: ${part.it} allocates`).toBeLessThanOrEqual(BOUND_B);
    });
  }
});

// After the row above, with a loop of its own: a second callee at the measured loop's call site would cost the rig its optimized code.
describe("given the allocation measure", () => {
  it("when a frame makes a vector, then it reads over the bar", () => {
    const kept: THREE.Vector3[] = [];
    const perFrame =
      allocatedBytes(() => {
        for (let f = 0; f < WINDOW_FRAMES; f++) kept[f % 8] = new THREE.Vector3();
      }) / WINDOW_FRAMES;
    expect(perFrame, `${perFrame.toFixed(1)} B a frame for a vector a frame: the measure sees nothing`).toBeGreaterThan(BOUND_B);
  });
});
