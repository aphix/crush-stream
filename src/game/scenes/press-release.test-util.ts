import { COMPACTOR, CompactorRig, PLATE } from "./compactor.ts";
import { makeCar } from "../contact/crash-scenarios.test-util.ts";
import { bodyHit, makeBox, strikeCar, type ContactBox } from "../contact/external-contact.ts";
import { physicsSlice } from "../contact/sat.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { applyDrive, idleDrive } from "../vehicle/car-drive.ts";
import { armKill, carClass, DEFAULT_REALISM } from "../vehicle/vehicle-classes.ts";
import { DT } from "../vehicle/test-support.ts";

/** How far (m) inboard of the hub line the plates stop, and how long (s) they hold there before they open: deep enough for a squeeze (`deepCrush`), hubs still on. */
const PAST_HUB = 0.03;
const HOLD_S = 0.4;
/** The nose plate stops this far (m) inboard of the nose bumper's rest: shallower than the tail's, so the two ends crush unequally, as a corner wreck's do. */
const FRONT_IN = 0.15;
/** The wreck sits this long (s) after the plates open (the contact window closes), then drives into a wall `WALL_Z` m ahead of the press's centre. */
const SETTLE_S = 0.9;
const WALL_Z = 3;
/** The wall is met this long (s) after its first touch, then gone: the wreck's last contact. */
const TOUCH_S = 0.12;
/** The reading runs this long (s) past the last contact: the contact window (0.4 s), the freeze after it, and the drive on. */
const AFTER_S = 1;
const THROTTLE = 0.6;

function pressed(holdS: number): CompactorRig {
  const car = makeCar("shape", 0.32, 0.45);
  armKill(car.deform, carClass(car), DEFAULT_REALISM, "derby");
  car.spawnFacing(0, 0, 0, 0);
  const rig = new CompactorRig(car);
  car.parked = true;
  const front = makeBox();
  const rear = makeBox();
  let frontFace = rig.faces.startFace;
  let rearFace = rig.faces.startFace;
  const frontStop = rig.faces.bumperZ - FRONT_IN;
  const rearStop = rig.faces.hubZ - PAST_HUB;
  const plate = (box: ContactBox, end: 1 | -1, face: number, closing: boolean): void => {
    box.y = PLATE.y;
    box.z = end * (face + PLATE.hz);
    box.hx = PLATE.hx;
    box.hy = PLATE.hy;
    box.hz = PLATE.hz;
    box.yaw = end > 0 ? Math.PI : 0;
    box.vz = closing ? -end * COMPACTOR.speed : 0;
  };
  const step = (): void => {
    const closing = [frontFace > frontStop, rearFace > rearStop] as const;
    frontFace = Math.max(frontStop, frontFace - COMPACTOR.speed * DT);
    rearFace = Math.max(rearStop, rearFace - COMPACTOR.speed * DT);
    car.integrate(DT);
    car.refreshBasis();
    plate(front, 1, frontFace, closing[0]);
    plate(rear, -1, rearFace, closing[1]);
    strikeCar(car, front, DT, true);
    if (bodyHit.touching) car.noteContactEnd(1, frontFace);
    strikeCar(car, rear, DT, true);
    if (bodyHit.touching) car.noteContactEnd(-1, rearFace);
    car.deform.stepStructure(DT, car.group.quaternion);
    car.syncPose(DT);
    car.afterContacts(DT);
    car.stepBreakage(DT);
  };
  while (frontFace > frontStop || rearFace > rearStop) step();
  for (let t = 0; t < holdS; t += DT) step();
  return rig;
}

/** How far (m) a rear bumper's distance to the cell has shortened from rest, the two bumpers' mean. */
function rearCrush(rig: CompactorRig): number {
  const d = rig.d;
  const cell = d.masses.find((m) => m.name === "cell")!;
  let sum = 0;
  for (const name of ["bumperRL", "bumperRR"]) {
    const m = d.masses.find((n) => n.name === name)!;
    sum += m.rest.distanceTo(cell.rest) - m.local.distanceTo(cell.local);
  }
  return sum / 2;
}

/** A car held `seconds` in the press at its deepest: how far its rear bumpers have crushed (m). */
export function heldRearCrush(seconds: number): number {
  return rearCrush(pressed(seconds));
}

/**
 * A car squeezed in the press, the plates opened, left to settle and then driven into a wall for `TOUCH_S` (its last contact): the most (m) a rear hub's
 * place in the car frame moves forward, into the car, in the `AFTER_S` after that contact.
 */
export function hubCreepAfterLastContact(): number {
  const rig = pressed(HOLD_S);
  const car = rig.car!;
  const hubs = rig.d.masses.filter((m) => m.hub && m.rest.z < 0);
  const world = newWorld([car]);
  const wall = makeBox();
  wall.y = PLATE.y;
  wall.hx = PLATE.hx;
  wall.hy = PLATE.hy;
  wall.hz = PLATE.hz;
  wall.z = WALL_Z + PLATE.hz;
  wall.yaw = Math.PI;
  const input = idleDrive();
  let t = 0;
  let touchedAt = -1;
  let lastContact = Infinity;
  let from: number[] = [];
  let creep = 0;
  while (t < lastContact + AFTER_S) {
    const h = physicsSlice(DT, Math.max(8, car.speed));
    input.throttle = t < SETTLE_S ? 0 : THROTTLE;
    applyDrive(car, input, h);
    if (t >= SETTLE_S && t < lastContact) {
      strikeCar(car, wall, h, true);
      if (bodyHit.touching && touchedAt < 0) touchedAt = t;
      if (touchedAt >= 0 && t >= touchedAt + TOUCH_S) {
        lastContact = t;
        from = hubs.map((m) => m.local.z);
      }
    }
    stepWorld(world, h);
    t += h;
    if (t > lastContact) for (const [i, m] of hubs.entries()) creep = Math.max(creep, m.local.z - from[i]!);
  }
  if (touchedAt < 0) throw new Error("the wreck never met the wall");
  return creep;
}
