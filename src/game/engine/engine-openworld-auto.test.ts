import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { launch, pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { tickAt } from "../ai/civilians/civilian-clock.ts";
import { newCrowd, stepUntilShown } from "../ai/civilians/civilian-crowd.test-util.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { civilianLine, historyLines } from "../ai/civilians/civilian-mood.ts";
import { SUBJECT } from "../ai/openworld-auto/auto-director.ts";
import type { AutoWorld } from "../ai/openworld-auto/auto-scan.ts";
import { AutoFollowCam } from "../present/openworld-auto-cam.ts";
import { inside, occluder, type Sight } from "../present/spectate-cam.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { FLAT_GROUND } from "../world/ground.ts";
import { OpenWorldAuto } from "./engine-openworld-auto.ts";

const SEED = 33;
const FRAME_S = 1 / 30;
const MAP = buildFixtureMap();
/** The crowd is let out for this long (crowd seconds) after the first person shows, so a good number are out. */
const MORNING_S = 40;
const SIZES = { residents: 60, cops: 0, cars: 4, events: 512 };
const DRIVING_MPS = 12;

/** A crowd on the fixture map with people out; its crowd clock at that point. */
function morning(): CivilianCrowd {
  const crowd = newCrowd(MAP, SIZES.residents);
  const start = stepUntilShown(crowd);
  for (let seconds = start; seconds < start + MORNING_S; seconds += FRAME_S) crowd.step(seconds, [], true);
  return crowd;
}

function shownResidents(crowd: CivilianCrowd): number[] {
  return Array.from({ length: crowd.poses.count }, (_, resident) => resident).filter((resident) => crowd.poses.shown[resident] === 1);
}

type Fleet = { cars: DeformableCar[]; resident: Map<number, number>; yours: Set<number> };

/** The Auto camera over `crowd` and `fleet`'s cars, no foot cops. */
function autoOver(crowd: CivilianCrowd | null, fleet: Fleet = { cars: [], resident: new Map(), yours: new Set() }): OpenWorldAuto {
  const world: AutoWorld = {
    crowd: () => crowd,
    cops: () => null,
    residentAt: (carIndex) => fleet.resident.get(carIndex) ?? -1,
    cars: () => fleet.cars,
    isPlayerCar: (carIndex) => fleet.yours.has(carIndex),
  };
  const auto = new OpenWorldAuto(world, SIZES, SEED);
  auto.begin();
  return auto;
}

function patrolCar(x: number, siren: boolean, speed = DRIVING_MPS): DeformableCar {
  const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "Patrol" }, new THREE.Scene(), null, "police");
  launch(car, x, 0, 0, 0, speed);
  car.setSirens(siren);
  return car;
}

describe("given the Auto camera over a crowd that is out on the fixture map", () => {
  it("when it picks its first subject, then the bubble is that civilian's own line and life log", () => {
    const crowd = morning();
    const auto = autoOver(crowd);
    auto.step(FRAME_S);
    const subject = auto.subject!;
    const tick = tickAt(crowd.crowdSeconds);
    expect(subject.kind, "the kind of subject").toBe(SUBJECT.civilian);
    expect(auto.text()?.title, "the bubble's title").toBe(civilianLine(crowd.state, subject.id, tick));
    expect(auto.text()?.lines.join("|"), "the bubble's lines").toBe(historyLines(crowd.state, subject.id).join("|"));
  });

  it("when one of them is fighting, then that one is the first subject", () => {
    const crowd = morning();
    const out = shownResidents(crowd);
    const fighter = out[out.length - 1]!;
    crowd.poses.activity[fighter] = ACTIVITY.swing;
    const auto = autoOver(crowd);
    auto.step(FRAME_S);
    expect(out.length, "civilians out").toBeGreaterThan(3);
    expect(auto.subject?.kind, "the kind of subject").toBe(SUBJECT.civilian);
    expect(auto.subject?.id, "the subject: the one fighting").toBe(fighter);
  });
});

describe("given the Auto camera over a street with cars and nobody on the pavement", () => {
  /** Every civilian put away but `driver`, who is at the wheel of car 1 at speed; car 0 is the viewer's own patrol car with its siren lit, car 2 a patrol car parked (or, `sirenOn`, at speed with its siren lit). */
  function street(sirenOn: boolean) {
    const crowd = morning();
    const driver = shownResidents(crowd)[0]!;
    crowd.poses.shown.fill(0);
    const own = patrolCar(0, true);
    const resident = pooledCar(1);
    launch(resident, 20, 0, 0, 0, DRIVING_MPS);
    const patrol = patrolCar(40, sirenOn, sirenOn ? DRIVING_MPS : 0);
    const fleet: Fleet = { cars: [own, resident, patrol], resident: new Map([[1, driver]]), yours: new Set([0]) };
    return { crowd, driver, fleet, auto: autoOver(crowd, fleet) };
  }

  it("when a resident drives, then the driver is the subject, never the viewer's own car whose siren is lit, and his bubble is his line, at the wheel", () => {
    const { crowd, driver, auto } = street(false);
    auto.step(FRAME_S);
    expect(auto.subject?.kind, "the kind of subject").toBe(SUBJECT.driver);
    expect(auto.subject?.id, "the subject: the resident's car, not the viewer's own patrol car, not the parked patrol car").toBe(1);
    expect(auto.text()?.title, "the driver's title").toBe(civilianLine(crowd.state, driver, tickAt(crowd.crowdSeconds)));
    expect(auto.text()?.lines[0], "the driver's first line").toBe("at the wheel");
  });

  it("when a patrol car has its siren lit, then it is the subject, with the patrol's bubble", () => {
    const { auto } = street(true);
    auto.step(FRAME_S);
    expect(auto.subject?.kind, "the kind of subject").toBe(SUBJECT.driver);
    expect(auto.subject?.id, "the subject: the patrol car").toBe(2);
    expect(auto.text()?.title, "the patrol's title").toBe("Patrol car - officer at the wheel");
    expect(auto.text()?.lines, "the patrol's line").toEqual(["siren on, answering a call"]);
  });
});

describe("given the Auto camera with nothing in the world", () => {
  it("when it is asked for a subject, then there is none, no bubble and no camera", () => {
    const auto = autoOver(null);
    expect(auto.step(FRAME_S), "a cut with no crowd").toBe(false);
    expect(auto.subject, "the subject").toBeNull();
    expect(auto.text(), "the bubble").toBeNull();
  });
});

const OPEN: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ: [] };
const SHOT = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, back: 4, height: 2, aimUp: 1.3 };
const WALL = occluder(0, -2, 0, 5, 0.5, false, 0, 10);
const REACH_TOLERANCE_M = 0.05;
/** Where the shot's rig puts the eye on open ground: behind him by the shot's distance and over his feet by its height. */
const RIG_EYE = new THREE.Vector3(0, SHOT.height, -SHOT.back);
/** A wall behind him turns or pulls the eye at least this far (m) from where the rig put it. */
const MOVED_BY_WALL_M = 1;

function framed(sight: Sight): { eye: THREE.Vector3; subject: THREE.Vector3; looksAt: number } {
  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 400);
  const cam = new AutoFollowCam();
  cam.cut(0);
  cam.update(camera, SHOT, sight, FRAME_S);
  const subject = new THREE.Vector3(SHOT.x, SHOT.y + SHOT.aimUp, SHOT.z);
  const toSubject = subject.clone().sub(camera.position).normalize();
  return { eye: camera.position.clone(), subject, looksAt: camera.getWorldDirection(new THREE.Vector3()).dot(toSubject) };
}

describe("given the Auto camera framing a person facing +z on open ground", () => {
  it("when it cuts to him, then the eye stands behind and over him at the shot's distance and looks at him", () => {
    const { eye, subject, looksAt } = framed(OPEN);
    expect(eye.z, "the eye's z: behind him").toBeCloseTo(SHOT.z - SHOT.back, 6);
    expect(eye.y, "the eye's height").toBeCloseTo(SHOT.y + SHOT.height, 6);
    expect(eye.distanceTo(subject), "the eye's distance from his chest (m)").toBeGreaterThan(SHOT.back - REACH_TOLERANCE_M);
    expect(looksAt, "how squarely the view looks at him").toBeGreaterThan(0.999);
  });

  it("when a wall stands behind him, then the eye is turned or pulled off the rig's spot behind the wall and is never inside the wall", () => {
    const { eye } = framed({ ...OPEN, occ: [WALL] });
    expect(eye.distanceTo(RIG_EYE), "how far the wall moved the eye (m)").toBeGreaterThan(MOVED_BY_WALL_M);
    expect(inside(WALL, eye.x, eye.y, eye.z, 0), "the eye inside the wall").toBe(false);
  });
});
