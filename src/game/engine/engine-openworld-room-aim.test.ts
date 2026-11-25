import * as THREE from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CHEST_HEIGHT } from "../ai/civilians/civilian-crowd-constants.ts";
import { POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { SPECIES, RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import { pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { detAtan2, hypot2, hypot3 } from "../kernel/physics-core.js";
import { ACT, NAMED, Named } from "../net/act-codec.ts";
import { BODY_POSTURE, type BodyMotion } from "../net/body-codec.ts";
import { FRAME_MS, Hub } from "../net/net-hub.test-util.ts";
import { NetPlay } from "../net/net-play.ts";
import { worldGame } from "../net/net-world-game.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { activeGround } from "../world/ground.ts";
import { fixtureLots } from "../world/openworld/openworld-lots.test-util.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { OFF_MENU } from "../world/tracks/index.ts";
import { BAY_WIDTH, SHOPFRONT } from "../world/openworld/interior-kinds.ts";
import type { Place } from "../world/openworld/walk-graph.ts";
import { frame, makeWorld } from "../world/race-world.test-util.ts";
import { TORSO_ABOVE_FEET } from "./body-follow.ts";
import { WEAPONS } from "./engine-onfoot-arms.ts";
import { OpenWorldDirector } from "./engine-openworld.ts";
import { OpenWorldActs } from "./engine-openworld-acts.ts";
import type { ActorPlace } from "./engine-openworld-law.ts";
import { FakeBodyHost } from "./openworld-bodies.test-util.ts";
import { idleCullPorts, idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";

const SEED = 0x1234;
const lots = fixtureLots(8);
const map = buildOpenWorldMap(lots);
const course = openWorldCourse(lots);
const SIM_STEP = 1 / FRAME_HZ;
const HOST_CAR = 0;
const GUEST_CAR = 1;
/** Frames the host's crowd runs before civilians are out (150 crowd seconds), and the net frame's seconds. */
const MORNING_FRAMES = 150 * 30;
const FRAME_S = FRAME_MS / 1000;
/** The room's links are slowed until the guest's picture of the host is this old (s): the interpolation delay, a 15 Hz foot message and about 0.1 s of link. */
const VIEW_AGE_S = 0.25;
/** Each way, the link's delay (ms) that puts the guest's view at `VIEW_AGE_S`: found by measuring the age of the guest's crowd (the interpolation delay is in the rest). */
const LINK_DELAY_MS = 120;
const SHOTS = 30;
/** Net frames between two shots (the pistol's cooldown is 0.25 s) and the shot of each trial's own moving target. */
const SHOT_GAP_FRAMES = 12;
const SPRINT_MPS = 7;
const CAR_MPS = 20;
/** The open ground the player and the car cross: far from every building, and how far the guest stands from the line they cross (m). */
const OPEN_AT = { x: 200, z: 200 };
const SHOOTER_AWAY_M = 15;
/** A target runs along its line for this long (s) before the shot, and the shot comes this long into it. */
const RUN_S = 1.5;
const COLUMN = { radius: 0.3, height: 1.8 };
/** The height of a car's body box's middle over its origin (m), and the lag (s) the guest's picture of a target may have behind the host's: the interpolation delay and the link, 0.2 to 0.4 s. */
const CAR_CENTRE_Y = pooledCar(0).frame.half.y;
const MIN_LAG_S = 0.2;
const MAX_LAG_S = 0.4;
/** Net frames the host takes to hear a guest's foot message over the slowed link, and the eye's height over the torso (m). */
const HEAR_FRAMES = 20;
const EYE_UP_M = 0.3;
/** The civilians' trials: the pace (m/s) of a walk across, and the frames to look for them. */
const WALK_MPS = [1.3, 1.6] as const;
const MAX_SEARCH_FRAMES = 6000;
const PISTOL_SLOT = 1;
/** A car this far (m) past the open ground's middle is 40 m from the shooter, past what a car can have moved in the oldest honest view. */
const MODIFIED_CAR_AWAY_M = 25;
/** The roof row: how far past the parked car the person stands (m), how far over its roof the named point is (m), and the height of the person the line aims at (m, under the dummy's 1.8). */
const BEHIND_CAR_M = 3;
const AIR_ABOVE_ROOF_M = 0.2;
const PERSON_TOP_HIT_M = 1.7;
/** The hook rows: the run-up of the sprint (m), the camera's height over the torso (m), how far behind the torso the camera's ray starts (m: the focus's lag 0.84 and the pivot's 0.7 across the way he runs), and the two bounds (m) the host's line test lies between. */
const SPRINT_RUN_UP_M = 30;
const CAMERA_UP_M = 0.65;
const HOOK_BEHIND_M = 1.54;
const SHOT_RAY_REACH_M = 2.9;
const HOOK_RAY_REACH_M = 4.1;

beforeAll(() => void (OFF_MENU as unknown[]).push(course));
afterAll(() => void (OFF_MENU as unknown[]).splice((OFF_MENU as unknown[]).indexOf(course), 1));

type Path = { x0: number; z0: number; vx: number; vz: number; t0: number };
type Side = {
  director: OpenWorldDirector;
  car: DeformableCar;
  fake: FakeBodyHost | null;
  eye: { x: number; z: number };
  walk: { path: Path | null };
  struck: number[];
  sparks: { count: number };
};

/** The walker on `path` at crowd second `seconds` into `out`. */
function walkerAt(path: Path | null, seconds: number, out: BodyMotion): boolean {
  if (path === null) return false;
  const since = seconds - path.t0;
  out.x = path.x0 + path.vx * since;
  out.z = path.z0 + path.vz * since;
  out.y = activeGround().heightAt(out.x, out.z) + TORSO_ABOVE_FEET;
  out.vx = path.vx;
  out.vy = 0;
  out.vz = path.vz;
  out.heading = detAtan2(path.vx, path.vz);
  out.posture = BODY_POSTURE.stand;
  return true;
}

/** Where along `ray` (to `range`) it enters the vertical column at (x, z), into `out`; Infinity when it misses. */
function hitColumn(ray: LookRay, x: number, z: number, range: number, out: { along: number; x: number; y: number; z: number }): void {
  const flat = hypot2(ray.dirX, ray.dirZ);
  if (flat < 1e-6) return;
  const along = ((x - ray.eyeX) * ray.dirX + (z - ray.eyeZ) * ray.dirZ) / (flat * flat);
  const gap = hypot2(ray.eyeX + ray.dirX * along - x, ray.eyeZ + ray.dirZ * along - z);
  if (along <= 0 || along >= range || gap > COLUMN.radius) return;
  const y = ray.eyeY + ray.dirY * along;
  if (y < 0 || y > COLUMN.height || along >= out.along) return;
  Object.assign(out, { along, x: ray.eyeX + ray.dirX * along, y, z: ray.eyeZ + ray.dirZ * along });
}

/** Where along `ray` (to `range`) it enters the box of `car` (its frame's half extents about its centre, in the car's own axes), into `out`. */
function hitCar(ray: LookRay, car: DeformableCar, range: number, out: { along: number; x: number; y: number; z: number }): void {
  car.group.updateMatrixWorld(true);
  const eye = car.group.worldToLocal(new THREE.Vector3(ray.eyeX, ray.eyeY, ray.eyeZ));
  const dir = new THREE.Vector3(ray.dirX, ray.dirY, ray.dirZ).applyQuaternion(car.group.quaternion.clone().invert());
  const { half } = car.frame;
  let near = 0;
  let far = range;
  for (const [from, along, low, high] of [[eye.x, dir.x, -half.x, half.x], [eye.y, dir.y, 0, 2 * half.y], [eye.z, dir.z, -half.z, half.z]] as const) {
    if (Math.abs(along) < 1e-9) {
      if (from < low || from > high) return;
      continue;
    }
    near = Math.max(near, Math.min((low - from) / along, (high - from) / along));
    far = Math.min(far, Math.max((low - from) / along, (high - from) / along));
  }
  if (near > far || near >= out.along) return;
  Object.assign(out, { along: near, x: ray.eyeX + ray.dirX * near, y: ray.eyeY + ray.dirY * near, z: ray.eyeZ + ray.dirZ * near });
}

/** A host and a guest in an open-world room over a slowed link: crowd directors linked through netplay, `bodies` for dummies' worlds, the host's acts and the guest's own. */
function room(bodies: boolean) {
  const hub = new Hub();
  let now = 1000;
  hub.now = () => now;
  const hostWorld = makeWorld();
  const guestWorld = makeWorld();
  const side = (client: boolean, slot: number): Side => {
    const car = pooledCar(slot);
    car.group.position.set(5000, 0, 5000);
    const fake = bodies ? new FakeBodyHost() : null;
    const eye = { x: 0, z: 0 };
    const walk: { path: Path | null } = { path: null };
    const struck: number[] = [];
    const sparks = { count: 0 };
    const motion: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
    const director: OpenWorldDirector = new OpenWorldDirector({
      ...idleOpenWorldPorts(),
      cull: { ...idleCullPorts(), others: (out, from) => director.sightOthers(out, from) },
      inOpenWorld: () => true,
      isClient: () => client,
      seed: () => SEED,
      tier: () => POPULATION_TIER.phone,
      cars: () => [car],
      ownCarIndex: () => slot,
      footAnchor: (out) => walkerAt(walk.path, director.crowdTime(), out),
      foot: (out) => {
        if (!walkerAt(walk.path, director.crowdTime(), motion)) return false;
        out.x = motion.x;
        out.z = motion.z;
        out.velocityX = motion.vx;
        out.velocityZ = motion.vz;
        return true;
      },
      now: () => now / 1000,
      eye: (ray) => {
        ray.eyeX = eye.x;
        ray.eyeZ = eye.z;
      },
      pickDoll: (actor, ray, range, out) => {
        out.slot = -1;
        out.along = Infinity;
        const column = (dollSlot: number, x: number, z: number): void => {
          const before = out.along;
          hitColumn(ray, x, z, range, out);
          if (out.along < before) out.slot = dollSlot;
        };
        for (const [dollSlot, body] of fake?.bodies ?? []) if (body.out) column(dollSlot, body.x, body.z);
        if (slot === HOST_CAR && actor !== HOST_CAR && walkerAt(walk.path, director.crowdTime(), motion)) column(SELF_SLOT, motion.x, motion.z);
      },
      pickCar: (ray, range, out) => {
        out.car = -1;
        out.along = Infinity;
        out.pane = null;
        hitCar(ray, car, range, out);
        if (out.along < Infinity) out.car = 0;
      },
      strikeDoll: (dollSlot) => void struck.push(dollSlot),
      shotSparks: () => void sparks.count++,
      ...(fake === null
        ? {}
        : {
            bodies: fake,
            makeArt: () => ({ update: () => {}, dispose: () => {} }),
            throwFigure: () => -1,
          }),
    });
    director.startOpenWorld(map);
    return { director, car, fake, eye, walk, struck, sparks };
  };
  const host = side(false, HOST_CAR);
  const guest = side(true, GUEST_CAR);
  /** The host's last view of the guest on foot, as the acts asked for it. */
  const seen: ActorPlace = { x: 0, y: 0, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };
  const place = (s: Side, actor: number, out: ActorPlace): boolean => {
    const motion: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
    if (s === host && actor !== HOST_CAR) {
      const known = host.director.playerPlace(actor, out);
      if (known) Object.assign(seen, out);
      return known;
    }
    if (!walkerAt(s.walk.path, s.director.crowdTime(), motion)) return false;
    Object.assign(out, { x: motion.x, y: motion.y, z: motion.z, heading: motion.heading, velocityX: motion.vx, velocityZ: motion.vz });
    return true;
  };
  const hooks: { actor: number; eyeX: number }[] = [];
  const resolver = (s: Side, self: number, guestSide: boolean, send: (kind: number, arg: number, eye: Point, dir: Point, name?: Named | null) => void) =>
    new OpenWorldActs(
      {
        actorPlace: (actor, out) => place(s, actor, out),
        now: () => now / 1000,
        self: () => self,
        guest: () => guestSide,
        face: () => {},
        layGun: () => false,
        sendAct: send,
        seatedCar: () => -1,
        getIn: () => 0,
        getOut: () => 0,
        hookFire: (actor, ray) => void hooks.push({ actor, eyeX: ray.eyeX }),
        hookCut: () => {},
        hookReel: () => {},
      },
      s.director,
    );
  const hostActs = resolver(host, HOST_CAR, false, () => {});
  const hostNet = new NetPlay(worldGame(hostWorld, "Ann", () => host.director.link(), (actor, act) => hostActs.hear(actor, act)).game, { connect: hub.connect, now: () => now });
  const guestNet = new NetPlay(worldGame(guestWorld, "Zed", () => guest.director.link()).game, { connect: hub.connect, now: () => now });
  const names = { on: true };
  const guestActs = resolver(guest, GUEST_CAR, true, (kind, arg, eye, dir, name) => guestNet.sendAct(kind, arg, eye, dir, names.on ? (name ?? null) : null));
  hostNet.hostRoom({ kind: "openworld", code: "R", tx: "bc", minPlayers: 1, course: "", playlist: [], autoNext: true });
  guestNet.join("R", "bc");
  hub.setDelay(hostNet["transport"]!.selfId, guestNet["transport"]!.selfId, LINK_DELAY_MS);
  const worldClock = { acc: 0 };
  return {
    host,
    guest,
    hostActs,
    guestActs,
    names,
    hooks,
    seen,
    nets: [hostNet, guestNet],
    /** `n` net frames of 1/30 s. */
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        now += FRAME_MS;
        for (let sim = 0; sim < 2; sim++) {
          frame(hostWorld, worldClock);
          host.director.step(SIM_STEP);
          host.director.frame(SIM_STEP);
          host.fake?.advance(SIM_STEP);
        }
        hostNet.frame(FRAME_S);
        guestNet.frame(FRAME_S);
        hub.flush();
        guest.director.frame(FRAME_S);
        guest.fake?.advance(FRAME_S);
      }
    },
  };
}

type Room = ReturnType<typeof room>;
const SELF_SLOT = 99;
const open: NetPlay[] = [];
afterEach(() => {
  for (const net of open.splice(0)) net.leave();
});

/** A started room whose crowd has run its morning. */
function started(bodies: boolean, morning = 0): Room {
  const r = room(bodies);
  open.push(...r.nets);
  r.step(60 + morning);
  return r;
}

type Point = { x: number; y: number; z: number };

/** A LookRay from `from` to `to`. */
function rayTo(from: Point, to: Point): LookRay {
  const length = hypot3(to.x - from.x, to.y - from.y, to.z - from.z);
  return Object.assign(new LookRay(), { eyeX: from.x, eyeY: from.y, eyeZ: from.z, dirX: (to.x - from.x) / length, dirY: (to.y - from.y) / length, dirZ: (to.z - from.z) / length });
}

/** `shooter`'s player stands at (x, z) on foot and nobody else does; both machines look from there, and the host has heard it. */
function standAt(r: Room, shooter: "guest" | "host", x: number, z: number): void {
  r.host.walk.path = null;
  r.guest.walk.path = null;
  r[shooter].walk.path = { x0: x, z0: z, vx: 0, vz: 0, t0: r[shooter].director.crowdTime() };
  for (const side of [r.host, r.guest]) {
    side.eye.x = x;
    side.eye.z = z;
  }
  r.step(HEAR_FRAMES);
}

/** The shooter's eye over his torso at (x, z). */
const eyeAt = (x: number, z: number): Point => ({ x, y: activeGround().heightAt(x, z) + TORSO_ABOVE_FEET + EYE_UP_M, z });

/** Hits and shots of a run. */
type Tally = { hits: number; shots: number };

/** The host's civilians the guest's shots reached, one entry per civilian a shot took: the host's crowd does nothing with a shot (the civilian stays), so one civilian serves many shots. */
function takenCivilians(r: Room): number[] {
  const taken: number[] = [];
  vi.spyOn(r.host.director["crowd"]!, "shoot").mockImplementation((resident) => void taken.push(resident));
  return taken;
}

/** Whether civilian `c` is shown on both machines walking at 1.3 to 1.6 m/s. */
function isWalking(r: Room, c: number): boolean {
  const guest = r.guest.director["crowd"]!;
  const poses = guest.poses;
  if (poses.shown[c] === 0 || r.host.director["crowd"]!.poses.shown[c] === 0 || poses.activity[c] !== ACTIVITY.none) return false;
  return poses.speed[c]! >= WALK_MPS[0] && poses.speed[c]! <= WALK_MPS[1] && guest.state.ints[c * RESIDENT_INT_STRIDE + RESIDENT_INT.species] === SPECIES.person;
}

/** Whether no wall stands between `eye` and civilian `c`'s chest, on either machine's picture of her. */
function seesChest(r: Room, eye: Point, c: number): boolean {
  const guest = r.guest.director["crowd"]!.poses;
  const host = r.host.director["crowd"]!.poses;
  const chest = guest.feetY[c]! + CHEST_HEIGHT;
  return !r.guest.director.wallBetween(eye.x, eye.y, eye.z, guest.x[c]!, chest, guest.z[c]!) && !r.host.director.wallBetween(eye.x, eye.y, eye.z, host.x[c]!, chest, host.z[c]!);
}

/** An eye `SHOOTER_AWAY_M` from civilian `c`, across her way, with nothing between it and her; null when walls stand on both sides. */
function eyeAcross(r: Room, c: number): Point | null {
  const guest = r.guest.director["crowd"]!.poses;
  for (const side of [1, -1]) {
    const eye = eyeAt(guest.x[c]! + side * Math.cos(guest.yaw[c]!) * SHOOTER_AWAY_M, guest.z[c]! - side * Math.sin(guest.yaw[c]!) * SHOOTER_AWAY_M);
    if (seesChest(r, eye, c)) return eye;
  }
  return null;
}

/** The first civilian walking across that is none of `used`, with the eye to shoot her from; null for none. */
function nextTarget(r: Room, used: Set<number>): { c: number; eye: Point } | null {
  for (let c = 0; c < r.guest.director["crowd"]!.poses.count; c++) {
    if (used.has(c) || !isWalking(r, c)) continue;
    used.add(c);
    const eye = eyeAcross(r, c);
    if (eye !== null) return { c, eye };
  }
  return null;
}

/** `SHOTS` pistol shots, each at a civilian walking at 1.3 to 1.6 m/s, 15 m off, across her way, aimed at where `side`'s own crowd draws her (once the shooter has walked there and the host has heard it, she is still walking in sight); hits are the shots that took the civilian aimed at. */
function shootCivilians(r: Room, side: "guest" | "host"): Tally {
  const taken = takenCivilians(r);
  const used = new Set<number>();
  const poses = (side === "guest" ? r.guest : r.host).director["crowd"]!.poses;
  const tally = { hits: 0, shots: 0 };
  for (let frames = 0; frames < MAX_SEARCH_FRAMES && tally.shots < SHOTS; frames++) {
    const target = nextTarget(r, used);
    if (target === null) {
      r.step(1);
      continue;
    }
    const { c, eye } = target;
    standAt(r, side, eye.x, eye.z);
    if (!isWalking(r, c) || !seesChest(r, eye, c)) continue;
    const before = taken.length;
    (side === "guest" ? r.guestActs : r.hostActs).shootLocal(rayTo(eye, { x: poses.x[c]!, y: poses.feetY[c]! + CHEST_HEIGHT, z: poses.z[c]! }), WEAPONS.pistol);
    r.step(SHOT_GAP_FRAMES);
    tally.shots++;
    if (taken.slice(before).includes(c)) tally.hits++;
  }
  return tally;
}

/** A target that runs along +x at `speed` for `RUN_S` and is shot at the end of it: `hostAt(x)` puts it at x on the host and `drawnAt(x)` where the guest draws it. Hits are `counted()` more than before; `lag()` is how far (m) the guest's picture of it is behind the host's. */
type Runner = { start(x0: number): void; hostAt(x: number): void; drawnAt(x: number): void; aim(side: "guest" | "host"): Point | null; counted(): number; lag(): number };

/** `SHOTS` shots from `side` at the runner, each at where `side` draws it at the end of a run. The guest's picture is as old as his crowd (the host's crowd clock less his), and that lag is checked against the target's speed at every shot. */
function shootRunner(r: Room, side: "guest" | "host", speed: number, runner: Runner): Tally {
  const tally = { hits: 0, shots: 0 };
  const from = eyeAt(OPEN_AT.x, OPEN_AT.z + SHOOTER_AWAY_M);
  standAt(r, side, from.x, from.z);
  const acts = side === "guest" ? r.guestActs : r.hostActs;
  for (let shot = 0; shot < SHOTS; shot++) {
    const t0 = r.host.director.crowdTime();
    runner.start(OPEN_AT.x);
    const frames = Math.round(RUN_S * 30);
    for (let f = 0; f < frames; f++) {
      const t = r.host.director.crowdTime() - t0;
      const age = side === "guest" ? r.host.director.crowdTime() - r.guest.director.crowdTime() : 0;
      runner.hostAt(OPEN_AT.x + speed * t);
      runner.drawnAt(OPEN_AT.x + speed * Math.max(0, t - age));
      r.step(1);
    }
    const target = runner.aim(side);
    const before = runner.counted();
    if (side === "guest") expect(runner.lag() / speed, "seconds the guest's picture of the target is behind the host's").toBeGreaterThanOrEqual(MIN_LAG_S);
    if (side === "guest") expect(runner.lag() / speed, "seconds the guest's picture of the target is behind the host's").toBeLessThanOrEqual(MAX_LAG_S);
    if (target !== null) acts.shootLocal(rayTo(from, target), WEAPONS.pistol);
    tally.shots++;
    for (let f = 0; f < SHOT_GAP_FRAMES; f++) {
      runner.hostAt(OPEN_AT.x + speed * (r.host.director.crowdTime() - t0));
      r.step(1);
    }
    if (runner.counted() > before) tally.hits++;
  }
  return tally;
}

/** Car `car` stands at (x, z) with its long axis along +x, moving at `speed` m/s along it. */
function placeCar(car: DeformableCar, x: number, z: number, speed: number): void {
  car.group.position.set(x, 0, z);
  car.group.rotation.set(0, Math.PI / 2, 0);
  car.group.updateMatrixWorld(true);
  car.velocity.set(speed, 0, 0);
}

/** The car crossing the open ground at `speed`: the host's car, and the guest's picture of it. */
function carRunner(r: Room, speed: number): Runner {
  return {
    start: (x0) => {
      placeCar(r.host.car, x0, OPEN_AT.z, speed);
      placeCar(r.guest.car, x0, OPEN_AT.z, speed);
    },
    hostAt: (x) => placeCar(r.host.car, x, OPEN_AT.z, speed),
    drawnAt: (x) => placeCar(r.guest.car, x, OPEN_AT.z, speed),
    aim: (side) => ({ x: (side === "guest" ? r.guest : r.host).car.group.position.x, y: CAR_CENTRE_Y, z: OPEN_AT.z }),
    counted: () => r.host.sparks.count,
    lag: () => r.host.car.group.position.x - r.guest.car.group.position.x,
  };
}

/** The host's own player sprinting across the open ground, drawn on the guest by a dummy that follows the host's record. */
function playerRunner(r: Room): Runner {
  const drawn = (): number => {
    for (const body of r.guest.fake!.bodies.values()) if (body.out) return body.x;
    return NaN;
  };
  return {
    start: (x0) => void (r.host.walk.path = { x0, z0: OPEN_AT.z, vx: SPRINT_MPS, vz: 0, t0: r.host.director.crowdTime() }),
    hostAt: () => {},
    drawnAt: () => {},
    aim: () => {
      for (const body of r.guest.fake!.bodies.values()) if (body.out) return { x: body.x, y: COLUMN.height / 2, z: body.z };
      return null;
    },
    counted: () => r.host.struck.filter((slot) => slot === SELF_SLOT).length,
    lag: () => {
      const path = r.host.walk.path!;
      return path.x0 + path.vx * (r.host.director.crowdTime() - path.t0) - drawn();
    },
  };
}

describe("given the guest's view of the host's world", () => {
  it("when the link is slowed, then the guest's crowd is 0.2 to 0.3 s behind the host's", () => {
    const r = started(false);
    r.step(30);
    const age = r.host.director.crowdTime() - r.guest.director.crowdTime();
    expect(age, "seconds the guest's crowd is behind the host's").toBeGreaterThan(VIEW_AGE_S - 0.05);
    expect(age, "seconds the guest's crowd is behind the host's").toBeLessThan(VIEW_AGE_S + 0.05);
  });
});

/** A guest whose act names nothing (what an act was before it named) is the control of each row below: the most of 30 shots that may hit then. */
const MOST_MISS = 3;

describe("given a guest 15 m from the open ground a car crosses at 20 m/s, over a link that puts his view 0.25 s behind", () => {
  it("when he fires 30 pistol shots at the car where his machine draws it, then none of them hit when his act names nothing, and the host's own player's rate (30 of 30) is his when it names the car", () => {
    const r = started(false);
    const hostOwn = shootRunner(r, "host", CAR_MPS, carRunner(r, CAR_MPS));
    r.names.on = false;
    const unnamed = shootRunner(r, "guest", CAR_MPS, carRunner(r, CAR_MPS));
    r.names.on = true;
    const named = shootRunner(r, "guest", CAR_MPS, carRunner(r, CAR_MPS));
    expect(hostOwn.hits, "the host's own shots that hit").toBe(SHOTS);
    expect(unnamed.hits, "shots that hit, the act naming nothing").toBeLessThanOrEqual(MOST_MISS);
    expect(named.hits, "shots that hit, the act naming the car").toBe(SHOTS);
  });

  it("when a modified client names a car that stands 40 m from the line it sends, then the shot goes along the line it sent and does not hit it; named honestly it hits", () => {
    const r = started(false);
    const from = eyeAt(OPEN_AT.x, OPEN_AT.z + SHOOTER_AWAY_M);
    standAt(r, "guest", from.x, from.z);
    placeCar(r.host.car, OPEN_AT.x, OPEN_AT.z - MODIFIED_CAR_AWAY_M, CAR_MPS);
    placeCar(r.guest.car, OPEN_AT.x, OPEN_AT.z - MODIFIED_CAR_AWAY_M, CAR_MPS);
    const name = Object.assign(new Named(), { kind: NAMED.car, id: 0, x: 0, y: CAR_CENTRE_Y, z: 0 });
    r.nets[1]!.sendAct(ACT.shot, PISTOL_SLOT, from, { x: 1, y: 0, z: 0 }, name);
    r.step(SHOT_GAP_FRAMES);
    expect(r.host.sparks.count, "hits on the car from a line that points away from it").toBe(0);
    const honest = rayTo(from, { x: OPEN_AT.x, y: CAR_CENTRE_Y, z: OPEN_AT.z - MODIFIED_CAR_AWAY_M });
    r.nets[1]!.sendAct(ACT.shot, PISTOL_SLOT, from, { x: honest.dirX, y: honest.dirY, z: honest.dirZ }, name);
    r.step(SHOT_GAP_FRAMES);
    expect(r.host.sparks.count, "hits on the car from a line aimed at it").toBe(1);
  });

  it("when a modified client names a parked car with a point in the air above its roof, on the line to a person standing 3 m past it, then the shot flies no farther than that point and the person is not hit", () => {
    const r = started(false);
    const from = eyeAt(OPEN_AT.x, OPEN_AT.z + SHOOTER_AWAY_M);
    standAt(r, "guest", from.x, from.z);
    for (const side of [r.host, r.guest]) placeCar(side.car, OPEN_AT.x, OPEN_AT.z, 0);
    r.host.walk.path = { x0: OPEN_AT.x, z0: OPEN_AT.z - BEHIND_CAR_M, vx: 0, vz: 0, t0: r.host.director.crowdTime() };
    r.step(HEAR_FRAMES);
    const top = 2 * r.host.car.frame.half.y;
    const name = Object.assign(new Named(), { kind: NAMED.car, id: 0, x: 0, y: top + AIR_ABOVE_ROOF_M, z: 0 });
    const aim = rayTo(from, { x: OPEN_AT.x, y: PERSON_TOP_HIT_M, z: OPEN_AT.z - BEHIND_CAR_M });
    r.nets[1]!.sendAct(ACT.shot, PISTOL_SLOT, from, { x: aim.dirX, y: aim.dirY, z: aim.dirZ }, name);
    r.step(SHOT_GAP_FRAMES);
    expect(r.host.struck.length, "hits on the person past the car").toBe(0);
    r.nets[1]!.sendAct(ACT.shot, PISTOL_SLOT, from, { x: aim.dirX, y: aim.dirY, z: aim.dirZ }, null);
    r.step(SHOT_GAP_FRAMES);
    expect(r.host.struck.length, "control: the same line, naming nothing, hits her").toBe(1);
  });
});

describe("given a guest 15 m from the open ground the host's player sprints across at 7 m/s", () => {
  it("when he fires 30 pistol shots at the dummy his machine draws for him, then none hit when his act names nothing, and all hit when it names the player", () => {
    const r = started(true);
    standAt(r, "guest", OPEN_AT.x, OPEN_AT.z + SHOOTER_AWAY_M);
    r.step(30);
    r.names.on = false;
    const unnamed = shootRunner(r, "guest", SPRINT_MPS, playerRunner(r));
    r.names.on = true;
    const named = shootRunner(r, "guest", SPRINT_MPS, playerRunner(r));
    expect(unnamed.hits, "shots that hit, the act naming nothing").toBeLessThanOrEqual(MOST_MISS);
    expect(named.hits, "shots that hit, the act naming the player").toBe(SHOTS);
  });
});

/** A civilian standing still, shown on both machines, with an eye 15 m from her that nothing blocks (the guest stands there and the host has heard it). */
function standingCivilianInSight(r: Room): { c: number; eye: Point } {
  const poses = r.host.director["crowd"]!.poses;
  const guest = r.guest.director["crowd"]!;
  for (let frames = 0; frames < MAX_SEARCH_FRAMES; frames++, r.step(1)) {
    for (let c = 0; c < poses.count; c++) {
      const idle = poses.shown[c] === 1 && guest.poses.shown[c] === 1 && poses.speed[c] === 0 && poses.activity[c] === ACTIVITY.none;
      const eye = idle && guest.state.ints[c * RESIDENT_INT_STRIDE + RESIDENT_INT.species] === SPECIES.person ? eyeAcross(r, c) : null;
      if (eye === null) continue;
      standAt(r, "guest", eye.x, eye.z);
      if (poses.shown[c] === 1 && poses.speed[c] === 0) return { c, eye };
    }
  }
  throw new Error("no standing civilian in sight");
}

/** The range cap's person row: the named point is this far (m) beside the civilian's axis, outside her 0.35 m chest radius, and a person stands this far (m) past the point. */
const BESIDE_AXIS_M = 0.48;
const BEHIND_PERSON_M = 2;

describe("given a guest 15 m from civilians walking across at 1.3 to 1.6 m/s, over the slowed link", () => {
  it("when he fires 30 pistol shots, one at each civilian where his crowd draws her, then none hit when his act names nothing, and nearly all hit when it names her (a civilian stepping in front takes the rest), as the host's own do", () => {
    const r = started(false, MORNING_FRAMES);
    const hostOwn = shootCivilians(r, "host");
    r.names.on = false;
    const unnamed = shootCivilians(r, "guest");
    r.names.on = true;
    const named = shootCivilians(r, "guest");
    expect(hostOwn.hits, "the host's own shots that hit").toBeGreaterThanOrEqual(SHOTS - 1);
    expect(unnamed.hits, "shots that hit, the act naming nothing").toBeLessThanOrEqual(MOST_MISS);
    expect(named.hits, "shots that hit, the act naming her").toBeGreaterThanOrEqual(SHOTS - 3);
  });

  it("when a modified client names a standing civilian with a point 0.48 m beside her axis, outside her chest, on the line to a person 2 m past that point, then the shot flies no farther than the point and the person behind is not hit; the same line naming nothing hits the person behind", () => {
    const r = started(false, MORNING_FRAMES);
    const taken = takenCivilians(r);
    const { c, eye } = standingCivilianInSight(r);
    const poses = r.host.director["crowd"]!.poses;
    const her = { x: poses.x[c]!, z: poses.z[c]! };
    const chest = poses.feetY[c]! + CHEST_HEIGHT;
    const along = hypot2(her.x - eye.x, her.z - eye.z);
    const side = { x: (-(her.z - eye.z) / along) * BESIDE_AXIS_M, z: ((her.x - eye.x) / along) * BESIDE_AXIS_M };
    const point = { x: her.x + side.x, y: chest, z: her.z + side.z };
    const aim = rayTo(eye, point);
    const reach = hypot3(point.x - eye.x, point.y - eye.y, point.z - eye.z) + BEHIND_PERSON_M;
    r.host.walk.path = { x0: eye.x + aim.dirX * reach, z0: eye.z + aim.dirZ * reach, vx: 0, vz: 0, t0: r.host.director.crowdTime() };
    r.step(HEAR_FRAMES);
    const name = Object.assign(new Named(), { kind: NAMED.civilian, id: c, x: side.x, y: chest - activeGround().heightAt(her.x, her.z), z: side.z });
    r.nets[1]!.sendAct(ACT.shot, PISTOL_SLOT, eye, { x: aim.dirX, y: aim.dirY, z: aim.dirZ }, name);
    r.step(SHOT_GAP_FRAMES);
    expect(r.host.struck.length, "hits on the person behind, the act naming her").toBe(0);
    expect(taken.includes(c), "she is hit, the point being outside her chest").toBe(false);
    r.nets[1]!.sendAct(ACT.shot, PISTOL_SLOT, eye, { x: aim.dirX, y: aim.dirY, z: aim.dirZ }, null);
    r.step(SHOT_GAP_FRAMES);
    expect(r.host.struck.length, "hits on the person behind, the act naming nothing").toBe(1);
  });
});

/** The guest sprints at 7 m/s along +x with the hook in hand; his camera's ray runs along +z from `behind` m behind his torso (as he is in his own view) and 0.65 m over it. The host's hook fires after the act has crossed the link; how far (m) its view of his torso is from the ray. */
function sprintingHookFire(behind: number): { fires: number; gap: number } {
  const r = started(false);
  r.guest.walk.path = { x0: OPEN_AT.x - SPRINT_RUN_UP_M, z0: OPEN_AT.z, vx: SPRINT_MPS, vz: 0, t0: r.guest.director.crowdTime() };
  for (const side of [r.host, r.guest]) {
    side.eye.x = OPEN_AT.x;
    side.eye.z = OPEN_AT.z;
  }
  r.step(HEAR_FRAMES);
  const torso: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
  walkerAt(r.guest.walk.path, r.guest.director.crowdTime(), torso);
  const eye = { x: torso.x - behind, y: torso.y + CAMERA_UP_M, z: torso.z };
  r.nets[1]!.sendAct(ACT.hookFire, 0, eye, { x: 0, y: 0, z: 1 }, null);
  r.step(SHOT_GAP_FRAMES);
  const seen = r.seen;
  return { fires: r.hooks.length, gap: hypot2(seen.x - eye.x, seen.y - eye.y) };
}

describe("given a guest sprinting at 7 m/s with the hook in hand, his camera over his shoulder behind him", () => {
  it("when his camera's ray passes 3 to 4 m from where the host sees his torso, as the host's lead and the camera's lag make it, then the host fires his hook; and when it passes more than 4.1 m from it, then it does not", () => {
    const near = sprintingHookFire(HOOK_BEHIND_M);
    expect(near.gap, "control: metres from the host's torso to the ray, more than a shot's bound").toBeGreaterThan(SHOT_RAY_REACH_M);
    expect(near.gap, "metres from the host's torso to the ray").toBeLessThan(HOOK_RAY_REACH_M);
    expect(near.fires, "hook fires the host made").toBe(1);
    const far = sprintingHookFire(HOOK_BEHIND_M + HOOK_RAY_REACH_M);
    expect(far.gap, "control: this ray passes farther than the hook's bound").toBeGreaterThan(HOOK_RAY_REACH_M);
    expect(far.fires, "hook fires the host made").toBe(0);
  });
});

/** The fixture's places have no rooms, so no street doorways: one gets an office's (a 1.5 m door at the middle of its street face) for `body`, and is a plain wall again after. */
function withOfficeDoor<T>(body: (place: Place, world: (lx: number, lz: number) => { x: number; z: number }, door: number) => T): T {
  const place = map.places.find((p) => p.doorNode >= 0)!;
  place.interior = "office";
  try {
    const cos = Math.cos(place.yaw);
    const sin = Math.sin(place.yaw);
    const bays = Math.max(1, Math.round(place.width / BAY_WIDTH));
    const door = SHOPFRONT.office[0].centre - ((bays - 1) / 2) * BAY_WIDTH;
    return body(place, (lx, lz) => ({ x: place.x + lx * cos + lz * sin, z: place.z - lx * sin + lz * cos }), door);
  } finally {
    place.interior = undefined;
  }
}

/** The room's guest fires a pistol along the sidewalk (`along`, a unit vector) from a tip 0.7 m ahead of his torso; how many shots the host carried out after the act crossed the slowed link. */
function pistolAlong(r: Room, torso: BodyMotion, along: { x: number; z: number }): number {
  const fired = vi.spyOn(r.host.director, "shotFired");
  const eye = { x: torso.x + 0.7 * along.x, y: torso.y + EYE_UP_M, z: torso.z + 0.7 * along.z };
  r.nets[1]!.sendAct(ACT.shot, PISTOL_SLOT, eye, { x: along.x, y: 0, z: along.z }, null);
  r.step(SHOT_GAP_FRAMES);
  return fired.mock.calls.length;
}

/** A guest stands inside an office, `DOOR_RUN_UP_M` m from where the line he sprints at 7 m/s along meets the door, `angle` rad off the door's axis toward +across; he sprints out through the door, turns along the sidewalk (toward `turn` along the face) once he is `outM` m past the face, and fires `after` s later; how many shots the host carried out, over the slowed link. */
function doorwayShot(after: number, outM: number, angle: number, turn: 1 | -1): number {
  return withOfficeDoor((place, world, door) => {
    const r = started(false);
    const cos = Math.cos(place.yaw);
    const sin = Math.sin(place.yaw);
    const start = world(place.depth / 2 - DOOR_RUN_UP_M * Math.cos(angle), door - DOOR_RUN_UP_M * Math.sin(angle));
    r.guest.walk.path = { x0: start.x, z0: start.z, vx: 0, vz: 0, t0: r.guest.director.crowdTime() };
    for (const side of [r.host, r.guest]) {
      side.eye.x = place.x;
      side.eye.z = place.z;
    }
    r.step(HEAR_FRAMES);
    // His exit line in the plan's frame (x out through the face, z along it), then in the world's.
    const exit = { x: SPRINT_MPS * Math.cos(angle), z: SPRINT_MPS * Math.sin(angle) };
    r.guest.walk.path = { x0: start.x, z0: start.z, vx: exit.x * cos + exit.z * sin, vz: -exit.x * sin + exit.z * cos, t0: r.guest.director.crowdTime() };
    const torso: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
    while (walkerAt(r.guest.walk.path, r.guest.director.crowdTime(), torso) && (torso.x - place.x) * cos - (torso.z - place.z) * sin < place.depth / 2 + outM) r.step(1);
    r.guest.walk.path = { x0: torso.x, z0: torso.z, vx: turn * SPRINT_MPS * sin, vz: turn * SPRINT_MPS * cos, t0: r.guest.director.crowdTime() };
    const turned = r.guest.director.crowdTime();
    while (r.guest.director.crowdTime() - turned < after) r.step(1);
    walkerAt(r.guest.walk.path, r.guest.director.crowdTime(), torso);
    return pistolAlong(r, torso, { x: turn * sin, z: turn * cos });
  });
}

/** A guest standing still `DOOR_INSIDE_M` m inside an office's street face, 2 m along it from the door, fires out along the face from a tip that is outside it; how many shots the host carried out. */
function insideShot(): number {
  return withOfficeDoor((place, world, door) => {
    const r = started(false);
    const sin = Math.sin(place.yaw);
    const cos = Math.cos(place.yaw);
    const spot = world(place.depth / 2 - DOOR_INSIDE_M, door + 2);
    r.guest.walk.path = { x0: spot.x, z0: spot.z, vx: 0, vz: 0, t0: r.guest.director.crowdTime() };
    for (const side of [r.host, r.guest]) {
      side.eye.x = place.x;
      side.eye.z = place.z;
    }
    r.step(HEAR_FRAMES);
    const torso: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
    walkerAt(r.guest.walk.path, r.guest.director.crowdTime(), torso);
    return pistolAlong(r, torso, { x: cos, z: -sin });
  });
}

/** The doorway rows: the run-up inside the office (m), how far inside its face the still guest stands (m), and where the turn and the shot come (m past the face, s after the turn). */
const DOOR_RUN_UP_M = 3;
const DOOR_INSIDE_M = 0.5;
const TURNS_OUT_M = [0.05, 1] as const;
/** The angles (rad off the door's axis) he leaves at: straight out, 30 and 45 degrees. */
const EXIT_ANGLES = [0, Math.PI / 6, Math.PI / 4] as const;
const SHOTS_AFTER_S = [0.1, 0.2, 0.3] as const;

describe("given a guest in a room over the slowed link, an office's street face with its door beside him", () => {
  // The 30 and 45 degree exits were added to a row that already passed: they pin behaviour that was already right.
  it("when he sprints out through the door at 7 m/s straight out, at 30 or at 45 degrees, turns along the sidewalk either way 0.05 or 1 m out and fires 0.1, 0.2 or 0.3 s later, then the host carries every shot out (guard)", () => {
    for (const angle of EXIT_ANGLES) for (const turn of [1, -1] as const) for (const outM of TURNS_OUT_M) for (const after of SHOTS_AFTER_S) {
      expect(doorwayShot(after, outM, angle, turn), `shots carried out, exit ${Math.round((angle * 180) / Math.PI)} degrees, turned ${turn > 0 ? "away from" : "back toward"} the door ${outM} m out, fired ${after} s later`).toBe(1);
    }
  });

  it("when he stands still inside the face, away from the door, and fires out along it from a tip outside it, then the host refuses the shot: the wall is solid", () => {
    expect(insideShot(), "shots carried out through the wall").toBe(0);
  });
});
