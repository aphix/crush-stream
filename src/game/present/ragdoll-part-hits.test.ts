import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { must } from "../kernel/must.test-util.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, run, runWall, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { HIT_DOOR, HIT_HOOD, HIT_LID, HIT_MIRROR, HIT_PANEL, MIRROR_BREAK_J } from "../vehicle/car-core.ts";
import { assertSameNumbers, paint } from "../vehicle/test-support.ts";
import { PREFABS, type PrefabId } from "../world/catalog.ts";
import { activeGround, setGround } from "../world/ground.ts";
import { placeProps } from "../world/placements.ts";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { square } from "../world/track.test-util.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { fireRam, parkedStyle } from "../scenes/door-rig.test-util.ts";

/**
 * Knocked props meet a parked car's parts in the dummies' world (`LooseProxies`' stand-ins), and the sim hears each hit through the glass's
 * path (`applyHit` → `DeformableCar.hitPart`), `LAG` frames on: the car itself never feels it.
 */

const FRAME = 1 / FRAME_HZ;
/** The car's hinges swing in this many sim steps a frame, as at the fine rate. */
const SWING_STEPS = 4;
/** The speed (m/s) a crate and a cone are thrown at a mirror: the crate's 30 kg carry 135 J, the cone's 4 kg 18 J, either side of `MIRROR_BREAK_J`. */
const THROW_MPS = 3;
/** The gap (m) between a thrown prop's face and the part it is aimed at, as it is let go: room for the world to put the part's stand-in in first. */
const GAP_M = 0.6;
/** A crate let go this high (m, its bottom over the hanging panel's middle) drops onto the panel at about 3 m/s. */
const DROP_M = 0.5;
/** An open door a crate is thrown at: this far open (rad), the crate this fast (m/s) at the door's middle shuts and latches it, this slow (m/s) leaves it open. */
const DOOR_OPEN = 0.6;
const SHUT_MPS = 3;
const NUDGE_MPS = 0.8;
/** A loose part let go this far (m) from a lying crate, at this speed (m/s), slides into it; the crate moved at least this far (m) is shoved. */
const SLIDE_FROM_M = 1.5;
const SLIDE_MPS = 6;
const SHOVED_M = 0.05;
/** The owner's "a box dropped on it from a meter or two": the crate's bottom this far (m) over a sprung gate or hood shuts and latches it; this far, it stays open. */
const LID_DROP_M = 1;
const LID_NUDGE_M = 0.2;

const UP = new THREE.Vector3(0, 1, 0);

let system: RagdollSystem | null = null;

afterEach(() => {
  system?.dispose();
  system = null;
});

/** The square course's road beside its first checkpoint, and the way along it (unit, level). */
const ROAD = (() => {
  const p = new Track(parseTrack(square())).path;
  const k = 31;
  return { x: p.x[k]!, z: p.z[k]!, yaw: Math.atan2(p.tx[k]!, p.tz[k]!) };
})();

/** Where part `code` of `car` stands out of its body: its drawn box's middle (world) and its turn. */
function partAt(car: DeformableCar, code: number): { middle: THREE.Vector3; turn: THREE.Quaternion } {
  const slot = car.strikeSlot(code);
  expect(slot, `part ${code} stands out of the car`).toBeGreaterThanOrEqual(0);
  const box = new THREE.Box3();
  const object = car.partBox(slot, box);
  return { middle: box.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld), turn: object.getWorldQuaternion(new THREE.Quaternion()) };
}

type Hit = { part: number; energy: number };
type Run = { car: DeformableCar; hits: Hit[]; sys: RagdollSystem };

/** A sedan parked on the square course's road. */
function parked(): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
  launch(car, ROAD.x, ROAD.z, ROAD.yaw, 0, 0);
  return car;
}

/** A sedan on the road rear-ended at 50 km/h and left until its contact window has long closed: a wreck whose masses ride its body, frozen and asleep. */
function frozenWreck(): DeformableCar {
  const car = parked();
  car.deform.setMode("shape");
  const striker = makeCar("shape");
  const fwd = new THREE.Vector3(Math.sin(ROAD.yaw), 0, Math.cos(ROAD.yaw));
  launch(striker, ROAD.x - 6 * fwd.x, ROAD.z - 6 * fwd.z, ROAD.yaw, (50 / 3.6) * fwd.x, (50 / 3.6) * fwd.z);
  run(makeWorld([car, striker], false, false), [], 1.5);
  expect(car.deform.massActive && car.deform.quietTime() > 0.35, "the wreck is not quiet").toBe(true);
  car.deform.frozen = true;
  car.asleep = true;
  return car;
}

/**
 * A car (`make`, else `parked`) on the square course's road (`prep` sets its parts up), one knockable `prefab` with its middle at the point `aim`
 * gives and knocked at its velocity, then `seconds` of frames: the dummies' world, and the car's hinges swinging as its slices would.
 */
async function strike(prefab: PrefabId, prep: (car: DeformableCar) => void, aim: (car: DeformableCar) => { at: THREE.Vector3; v: THREE.Vector3 }, seconds: number, make = parked): Promise<Run> {
  const track = new Track(parseTrack(square({ props: [{ prefab, x: 0, z: 0, yaw: 0, scale: 1 }] })));
  setGround(track.ground());
  const car = make();
  prep(car);
  const { at, v } = aim(car);
  const placed = placeProps(track).map((p) => ({ ...p, x: at.x, y: at.y - PREFABS[prefab].size[1] / 2, z: at.z }));
  const sys = (system = new RagdollSystem(new THREE.Scene(), () => {}, () => {}));
  await sys.preload();
  sys.setCourse(track, placed, null);
  const hits: Hit[] = [];
  sys.onPartHit = (_car, part, energy) => hits.push({ part, energy });
  sys.update(FRAME, [car], true, false, null);
  sys.knockProp(0, -1, v.x, v.y, v.z);
  for (let f = 0; f < seconds * FRAME_HZ; f++) {
    sys.update(FRAME, [car], true, false, null);
    for (let k = 0; k < SWING_STEPS; k++) car.swingHinges(FRAME / SWING_STEPS);
  }
  return { car, hits, sys };
}

/**
 * A `prefab` thrown level at part `code` along its `out` way (in the part's own frame) from `GAP_M` off its face, at `mps`, its middle `lift` m
 * over the part's, lifted to fall no lower on its way.
 */
const thrownAt =
  (prefab: PrefabId, code: number, out: THREE.Vector3, mps: number, lift = 0) =>
  (car: DeformableCar): { at: THREE.Vector3; v: THREE.Vector3 } => {
    const { middle, turn } = partAt(car, code);
    const way = out.clone().applyQuaternion(turn);
    way.y = 0;
    way.normalize();
    const t = GAP_M / mps;
    return { at: middle.addScaledVector(way, GAP_M + PREFABS[prefab].size[0] / 2).addScaledVector(UP, lift), v: way.multiplyScalar(-mps).addScaledVector(UP, (9.81 * t) / 2) };
  };
const LEFT = new THREE.Vector3(-1, 0, 0);
/** A cone meets the mirror with its base plate, its widest: its middle half its height less the plate's 4 cm over the mirror's. */
const CONE_LIFT = PREFABS.cone.size[1] / 2 - 0.04;

/** The car's sim state a prop must not reach: its masses, pose, velocities, its sleep and its contact clock. */
function simState(car: DeformableCar): number[] {
  const n: number[] = [];
  for (const m of car.deform.masses) n.push(m.world.x, m.world.y, m.world.z, m.vel.x, m.vel.y, m.vel.z, m.local.x, m.local.y, m.local.z);
  const p = car.group.position;
  const q = car.group.quaternion;
  n.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w, car.velocity.x, car.velocity.y, car.velocity.z, car.angular.x, car.angular.y, car.angular.z);
  n.push(car.asleep ? 1 : 0, car.deform.quietTime(), car.deform.frozen ? 1 : 0);
  return n;
}

describe("given a sedan parked on the road and a knocked prop thrown at its left mirror", () => {
  it(`when a 30 kg crate meets it at ${THROW_MPS} m/s, then the mirror is knocked off; a 4 kg cone at the same speed hits it and it stays`, async (t) => {
    const crate = await strike("crate", () => {}, thrownAt("crate", HIT_MIRROR, LEFT, THROW_MPS), 1);
    const crateOff = crate.car.partOff("mirrorL");
    crate.sys.dispose();
    const cone = await strike("cone", () => {}, thrownAt("cone", HIT_MIRROR, LEFT, THROW_MPS, CONE_LIFT), 1);
    t.annotate(`crate hits ${JSON.stringify(crate.hits)}; cone hits ${JSON.stringify(cone.hits)}`);
    expect(crateOff, "the crate knocked the mirror off").toBe(true);
    const coneMirror = cone.hits.filter((h) => h.part === HIT_MIRROR);
    expect(coneMirror.length, "the cone met the mirror").toBeGreaterThan(0);
    expect(Math.max(...coneMirror.map((h) => h.energy)), "the cone's blow").toBeLessThan(MIRROR_BREAK_J);
    expect(cone.car.partOff("mirrorL"), "the cone left the mirror on").toBe(false);
  });

  it("when the crate knocks the mirror off a frozen, sleeping wreck, then it stays frozen and asleep with its masses, pose, velocities and contact clock bit-identical", async () => {
    let before: number[] = [];
    const run = await strike("crate", (car) => (before = simState(car)), thrownAt("crate", HIT_MIRROR, LEFT, THROW_MPS), 1, frozenWreck);
    expect(run.car.partOff("mirrorL"), "the crate knocked the mirror off").toBe(true);
    assertSameNumbers(simState(run.car), before, "the car's sim state");
  });
});

describe("given a sedan parked on the road with its left quarter panel torn and hanging", () => {
  it("when a crate drops onto the panel, then it tears the panel off", async (t) => {
    const run = await strike(
      "crate",
      (car) => car.setPanelOpen(-1, 0.6),
      (car) => ({ at: partAt(car, HIT_PANEL).middle.addScaledVector(LEFT.clone().applyQuaternion(car.group.quaternion), PREFABS.crate.size[0] / 2).addScaledVector(UP, DROP_M + PREFABS.crate.size[1] / 2), v: new THREE.Vector3() }),
      1,
    );
    t.annotate(`hits ${JSON.stringify(run.hits)}`);
    expect(run.hits.some((h) => h.part === HIT_PANEL), "the crate met the panel").toBe(true);
    expect(run.car.partOff("quarterL"), "the panel tore off").toBe(true);
  });
});

describe("given a sedan parked on the road with its left door unlatched and open", () => {
  it(`when a crate is thrown at the door's outside at ${SHUT_MPS} m/s, then it swings shut and latches; at ${NUDGE_MPS} m/s, then it stays open`, async (t) => {
    const open = (car: DeformableCar): void => car.setDoorOpen(-1, DOOR_OPEN);
    const hard = await strike("crate", open, thrownAt("crate", HIT_DOOR, LEFT, SHUT_MPS), 2);
    const shut = hard.car.doorHinge(-1).latched && !hard.car.partOff("doorL");
    const hardHits = hard.hits;
    hard.sys.dispose();
    const soft = await strike("crate", open, thrownAt("crate", HIT_DOOR, LEFT, NUDGE_MPS), 2);
    t.annotate(`${SHUT_MPS} m/s hits ${JSON.stringify(hardHits)}; ${NUDGE_MPS} m/s hits ${JSON.stringify(soft.hits)}, door at ${soft.car.doorHinge(-1).theta.toFixed(3)} rad`);
    expect(shut, "the hard throw shut and latched it").toBe(true);
    expect(soft.hits.some((h) => h.part === HIT_DOOR), "the soft throw met the door").toBe(true);
    expect(soft.car.doorHinge(-1).latched, "the soft throw left it open").toBe(false);
  });
});

/** A hatchback whose shut gate a rear ram has sprung (Doors scene F, 12 km/h with 100 kg): it rises off its latch onto its stop. A sedan whose hood a front wall hit at 44 km/h has sprung: it sits a few cm up on its safety catch. */
function lidPopped(): DeformableCar {
  const car = parkedStyle("hatchback");
  fireRam(car, "lidPop", { kph: 12, kg: 100 });
  return car;
}
function hoodPopped(): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
  car.spawnFacing(0, 0, 0, 0);
  // The wall's crash on the flat plane, as the lid-swing rows pop it, then back on the course the strike runs on.
  const course = activeGround();
  setGround(null);
  runWall(44, 1, "front", { car });
  setGround(course);
  return car;
}
/** A `prefab` let go still over the middle of part `code`, its bottom `drop` m over the part's highest point. */
const droppedOn =
  (prefab: PrefabId, code: number, drop: number) =>
  (car: DeformableCar): { at: THREE.Vector3; v: THREE.Vector3 } => {
    const box = new THREE.Box3();
    const top = box.applyMatrix4(car.partBox(car.strikeSlot(code), box).matrixWorld).max.y;
    const at = partAt(car, code).middle;
    return { at: at.setY(top + drop + PREFABS[prefab].size[1] / 2), v: new THREE.Vector3() };
  };

describe("given a hatchback whose gate a rear ram sprang, standing open on its struts, or a sedan whose hood a front wall hit sprang onto its safety catch, unlatched", () => {
  it(`when a crate drops ${LID_DROP_M} m onto the gate, then it swings shut and latches; dropped ${LID_NUDGE_M} m, then it stays open`, async (t) => {
    const hard = await strike("crate", () => {}, droppedOn("crate", HIT_LID, LID_DROP_M), 3, lidPopped);
    const shut = hard.car.lidHinge().latched && !hard.car.lidOff();
    const hardHits = hard.hits;
    hard.sys.dispose();
    const soft = await strike("crate", () => {}, droppedOn("crate", HIT_LID, LID_NUDGE_M), 3, lidPopped);
    t.annotate(`${LID_DROP_M} m hits ${JSON.stringify(hardHits)}; ${LID_NUDGE_M} m hits ${JSON.stringify(soft.hits)}, gate at ${soft.car.lidHinge().theta.toFixed(3)} rad`);
    expect(shut, "the 1 m drop shut and latched it").toBe(true);
    expect(soft.hits.some((h) => h.part === HIT_LID), "the low drop met the gate").toBe(true);
    expect(soft.car.lidHinge().latched, "the low drop left it open").toBe(false);
  });

  it(`when a crate drops ${LID_DROP_M} m onto the hood, then it swings shut and latches`, async (t) => {
    const run = await strike("crate", () => {}, droppedOn("crate", HIT_HOOD, LID_DROP_M), 3, hoodPopped);
    t.annotate(`hits ${JSON.stringify(run.hits)}, hood at ${run.car.hoodHinge().theta.toFixed(3)} rad`);
    expect(run.hits.some((h) => h.part === HIT_HOOD), "the crate met the hood").toBe(true);
    expect(run.car.hoodHinge().latched && !run.car.hoodOff(), "the hood shut and latched").toBe(true);
  });
});

describe("given a knocked crate lying on the road", () => {
  it(`when a torn bumper slides into it at ${SLIDE_MPS} m/s, then the crate is shoved`, async (t) => {
    const track = new Track(parseTrack(square({ props: [{ prefab: "crate", x: 0, z: 0, yaw: 0, scale: 1 }] })));
    setGround(track.ground());
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
    car.deform.setMode("shape");
    launch(car, ROAD.x + 40, ROAD.z, 0, 0, 0);
    const w = makeWorld([car], false, false, FREEWHEEL);
    const index = car["parts"].findIndex((p) => p.name === "bumperF");
    car["detachPart"](car["parts"][index]!, 0, new THREE.Vector3());
    tickWorld(w);
    const body = car.looseBody(index);
    must(body, "the bumper is not loose");
    const crateAt = new THREE.Vector3(ROAD.x, 0, ROAD.z);
    const placed = placeProps(track).map((p) => ({ ...p, x: crateAt.x, y: track.ground().heightAt(crateAt.x, crateAt.z, 1), z: crateAt.z }));
    const sys = (system = new RagdollSystem(new THREE.Scene(), () => {}, () => {}));
    await sys.preload();
    sys.setCourse(track, placed, null);
    sys.update(FRAME, [car], true, false, null);
    sys.knockProp(0, -1, 0, 0, 0);
    for (let f = 0; f < FRAME_HZ; f++) sys.update(FRAME, [car], true, false, null);
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    expect(sys.propAt(0, p, v), "the crate is out").toBe(true);
    const rest = p.clone();
    body.object.position.set(rest.x - SLIDE_FROM_M, rest.y, rest.z).sub(body.shape.centre.clone().applyQuaternion(body.object.quaternion));
    body.velocity.set(SLIDE_MPS, 0, 0);
    for (let f = 0; f < FRAME_HZ; f++) {
      tickWorld(w);
      sys.update(FRAME, [car], true, false, null);
    }
    sys.propAt(0, p, v);
    t.annotate(`crate moved ${p.distanceTo(rest).toFixed(3)} m`);
    expect(p.distanceTo(rest)).toBeGreaterThan(SHOVED_M);
  });
});
