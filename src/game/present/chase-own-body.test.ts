import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { activeGround } from "../world/ground.ts";
import { DriveCam } from "./drive-cam.ts";
import { inside, occluder, type Occluder, type Sight } from "./spectate-cam.ts";

const DT = 1 / FRAME_HZ;
/** A drag this far down (px) holds the chase's look at its lowest, the line to the car near level. */
const LOOK_LOW_PX = -200;
/** The garage's walls stand this far (m) off the car's sides, nose and tail; they are this thick and tall (m). */
const GAP_M = 0.4;
const WALL_M = 0.3;
const WALL_TOP_M = 3;
/** The car reverses this fast (m/s) from this far (m) up the garage until its tail is `GAP_M` from the back wall. */
const REVERSE_MPS = 3;
const REVERSE_FROM_M = 3;

function newCar(): DeformableCar {
  const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "car" }, new THREE.Scene());
  car.fwdFlat.set(0, 0, 1);
  return car;
}

/** A tight garage round a car at the origin facing +z, whose back wall is `GAP_M` behind its tail once it has backed in. */
function garage(car: DeformableCar): Sight {
  const h = car.frame.half;
  const side = h.x + GAP_M + WALL_M / 2;
  const end = h.z + GAP_M + WALL_M / 2;
  const occ: Occluder[] = [
    occluder(-side, 0, 0, WALL_M / 2, end + WALL_M, false, 0, WALL_TOP_M),
    occluder(side, 0, 0, WALL_M / 2, end + WALL_M, false, 0, WALL_TOP_M),
    occluder(0, -end, 0, side, WALL_M / 2, false, 0, WALL_TOP_M),
    occluder(0, end + REVERSE_FROM_M, 0, side, WALL_M / 2, false, 0, WALL_TOP_M),
  ];
  return { ground: activeGround(), path: null, wallTop: 0, rim: Infinity, occ, cars: [] };
}

/** How many frames of a chase follow put the eye inside the car's own box (floor to roof), the car at `z(t)` moving at `vz(t)`. */
function framesInBody(seconds: number, lookLow: boolean, z: (t: number) => number, vz: (t: number) => number): number {
  const car = newCar();
  const sight = garage(car);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180);
  const cam = new DriveCam();
  if (lookLow) cam.nudge(0, LOOK_LOW_PX);
  const h = car.frame.half;
  let inBody = 0;
  for (let f = 0; f * DT < seconds; f++) {
    const t = f * DT;
    car.group.position.set(0, 0, z(t));
    car.velocity.set(0, 0, vz(t));
    cam.update(camera, car, "third", DT, 0, 0, true, sight);
    const body = occluder(0, z(t), 0, h.x, h.z, false, 0, 2 * h.y);
    if (inside(body, camera.position.x, camera.position.y, camera.position.z, 0)) inBody++;
  }
  return inBody;
}

describe("given the chase camera on a car in a garage just bigger than it", () => {
  // mutation: sed -i '/^    if (view !== "first") outOfBody(camera.position, car, chase.aimUp);$/d' src/game/present/drive-cam.ts
  const cases = [
    { it: "when the scene opens with the car parked in it and the look held low, then the eye is never inside the car, from the first frame", lookLow: true, reverse: false },
    { it: "when the scene opens with the car parked in it at the chase's own look, then the eye is never inside the car", lookLow: false, reverse: false },
    { it: "when the car reverses into it and stops with the look held low, then the eye is never inside the car", lookLow: true, reverse: true },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => {
      const back = REVERSE_FROM_M / REVERSE_MPS;
      const z = (t: number) => (testCase.reverse ? Math.max(0, REVERSE_FROM_M - REVERSE_MPS * t) : 0);
      const vz = (t: number) => (testCase.reverse && t < back ? -REVERSE_MPS : 0);
      expect(framesInBody(back + 1, testCase.lookLow, z, vz), "frames with the eye inside the car's body").toBe(0);
    });
  }
});

/** The car drives out of the garage this fast (m/s) for this long (s), short of its far wall, and the eye is watched this long (s) after. */
const DRIVE_OFF_MPS = 3;
const DRIVE_OFF_S = 0.8;
const SETTLE_S = 1.5;
/** The most the eye may fall (m) in one frame: the 0.24 s let-go sheds under 7 % of the lift a frame (0.06 m measured), where the lift snapping off fell 0.85 m. */
const STEP_DOWN_MAX_M = 0.1;

describe("given the chase camera lifted over its car's roof in a garage just bigger than it", () => {
  // mutation: sed -i 's/this.bodyLift \* Math.exp(-LET_GO_OMEGA \* dt)/0/' src/game/present/drive-cam.ts
  it(`when the car drives off from its back wall, then the eye never drops more than ${STEP_DOWN_MAX_M} m in a frame`, () => {
    const car = newCar();
    const sight = garage(car);
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180);
    const cam = new DriveCam();
    cam.nudge(0, LOOK_LOW_PX);
    let last = NaN;
    let steepest = 0;
    for (let f = 0; f * DT < 1 + DRIVE_OFF_S + SETTLE_S; f++) {
      const t = Math.max(0, f * DT - 1);
      const moving = t > 0 && t < DRIVE_OFF_S;
      car.group.position.set(0, 0, DRIVE_OFF_MPS * Math.min(t, DRIVE_OFF_S));
      car.velocity.set(0, 0, moving ? DRIVE_OFF_MPS : 0);
      cam.update(camera, car, "third", DT, 0, 0, true, sight);
      if (f > 0) steepest = Math.max(steepest, last - camera.position.y);
      last = camera.position.y;
    }
    expect(steepest, `the eye's biggest fall in one frame (m): ${steepest.toFixed(3)}`).toBeLessThanOrEqual(STEP_DOWN_MAX_M);
  });
});

/** A crash spin's turn rate (rad/s), and the fastest the chase eye may swing round the car in it (rad/s): GTA's 2.5 with the springs' slack. */
const SPIN_RAD_S = 6;
const SWING_MAX_RAD_S = 3;

describe("given the chase camera behind a car standing in the open", () => {
  // mutation: sed -i 's/^const HEADING_RATE = 2.5;/const HEADING_RATE = Infinity;/' src/game/present/drive-cam.ts
  it("when the car spins on the spot at 6 rad/s for a second, then the eye swings round it no faster than 3 rad/s", () => {
    const car = newCar();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180);
    const cam = new DriveCam();
    let last = NaN;
    let fastest = 0;
    for (let f = 0; f * DT < 1.5; f++) {
      const yaw = f * DT < 0.5 ? 0 : (f * DT - 0.5) * SPIN_RAD_S;
      car.fwdFlat.set(Math.sin(yaw), 0, Math.cos(yaw));
      cam.update(camera, car, "third", DT, 0, 0);
      const bearing = Math.atan2(camera.position.x, camera.position.z);
      if (f * DT >= 0.5) fastest = Math.max(fastest, Math.abs(Math.atan2(Math.sin(bearing - last), Math.cos(bearing - last))) / DT);
      last = bearing;
    }
    expect(fastest, `the eye's fastest swing round the car (rad/s): ${fastest.toFixed(2)}`).toBeLessThan(SWING_MAX_RAD_S);
  });
});
