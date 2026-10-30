import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ, GRAVITY } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { FREEWHEEL, launch, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { DeformableCar } from "../vehicle/car.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { paint } from "../vehicle/test-support.ts";
import type { LooseBody } from "../vehicle/car-core.ts";
import { PART_SLOTS } from "../vehicle/part-state.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { type Doll, PARTS } from "./ragdoll-body.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { SLOTS } from "./ragdoll-config.ts";
import { WALK_SPEED } from "./walker-locomotion.ts";

const FRAME = 1 / FRAME_HZ;
const WALKER = SLOTS - 1;
const TORSO = 0;
const HEAD = 1;
/** The walker stands this many frames before the part is let go, and the run is this many after. */
const SETTLE_FRAMES = FRAME_HZ;
const FRAMES = 2.5 * FRAME_HZ;
/**
 * The part is let go level, high enough to fall to the height aimed at as it reaches him, from this far (m) along +z, or from where it
 * flies `FLIGHT_S` (s) to him when that is nearer (a slow part let go 1.5 m off would fall metres onto him), and never closer than its own
 * half depth plus his torso's and `CLEAR_GAP_M`.
 */
const THROW_FROM_M = 1.5;
const FLIGHT_S = 0.15;
const CLEAR_GAP_M = 0.05;
/**
 * Speeds (m/s, to the ground and so to a standing dummy) parts leave a crash at since they leave at their seat's velocity, measured: a
 * popped wheel 9.4 (2 × 80 km/h sedan head-on), a front bumper 1.6 (the same; mostly falling, 0.4-0.6 across the ground), a mirror 6.9 and
 * 12.7 (50 and 80 km/h t-bones); no quarter panel tore in those runs, so it takes the arch flare's 0.76 (100 km/h wall), the panel nearest it.
 */
const LEAVE_MPS = { wheel: 9.4, bumperF: 1.6, quarterL: 0.76, mirrorL: 12.7 } as const;
/** One speed (m/s) every part is thrown at, about a wheel's: what the part alone then decides. */
const SHARED_MPS = 10;
/** A tyre to the face, slower and faster (m/s): his torso is carried 1.36, 1.42, 1.46, 1.56 and 1.74 m at 15, 20, 25, 30 and 40 (measured). */
const FACE_MPS = [15, 30] as const;
/** Heights (m) aimed at: his torso's middle and his head's (standing, `PARTS`). */
const TORSO_Y = PARTS[TORSO].c[1];
const HEAD_Y = PARTS[HEAD].c[1];
/** A walker whose head has come down below this (m) is knocked over; standing, his head is at 1.63. */
const KNOCKED_HEAD_M = 1;
const STANDING_HEAD_M = 1.4;
/** A bump: his torso moved at least this fast (m/s; untouched he stands at under 0.001), went no farther than this (m) and his lowest part never this far (m) off the ground. */
const BUMP_MPS = 0.02;
const BUMP_TRAVEL_M = 0.15;
const GROUNDED_M = 0.12;
/** The faster tyre to the face carries his torso at least this much (m) farther than the slower. */
const FARTHER_M = 0.1;
/** Never through: no corner of his parts' boxes deeper than this (m) in the part; the solver's own give (a foot lands 5-6 cm into the ground). */
const THROUGH_M = 0.08;

type Kind = "wheel" | "bumperF" | "mirrorL" | "quarterL" | "doorL";
/** A part off a car in a sim of its own: the car, the part, and one frame of that sim. */
type Loose = { car: DeformableCar; body: LooseBody; step: () => void };

/** A walker's run under a throw: his head's lowest, his torso's farthest plan travel from where he stood and its fastest, his lowest point at its highest (off the ground), and the part's middle every frame. */
type Reading = { lowestHead: number; travel: number; fastest: number; airborne: number; path: number[] };

let system: RagdollSystem | null = null;

afterEach(() => {
  system?.dispose();
  system = null;
});

/** A car of body `style` parked 40 m off in a sim of its own, `kind` torn or popped off it, its middle let go at `at` with velocity `v`, turned `turn` (else as on the car). */
function looseOff(kind: Kind, at: THREE.Vector3, v: THREE.Vector3, turn?: THREE.Quaternion, style: CarStyleId = "sedan"): Loose {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, style);
  car.deform.setMode("shape");
  launch(car, 40, 40, 0, 0, 0);
  const w = makeWorld([car], false, false, FREEWHEEL);
  let index: number;
  if (kind === "wheel") {
    car["dropWheel"](0, "hubFL");
    index = PART_SLOTS;
  } else {
    index = car["parts"].findIndex((p) => p.name === kind);
    car["detachPart"](car["parts"][index]!, 0, new THREE.Vector3());
  }
  // The step that measures its shape.
  tickWorld(w);
  const body = car.looseBody(index);
  if (body === null) throw new Error(`${kind} is not loose`);
  if (turn) body.object.quaternion.copy(turn);
  body.object.position.copy(at).sub(body.shape.centre.clone().applyQuaternion(body.object.quaternion));
  body.velocity.copy(v);
  body.angular.set(0, 0, 0);
  return { car, body, step: () => tickWorld(w) };
}

/** `body`'s middle in the world. */
const middle = (body: LooseBody): THREE.Vector3 => body.shape.centre.clone().applyQuaternion(body.object.quaternion).add(body.object.position);

/** A walker standing at the origin facing +z. */
async function standingWalker(): Promise<RagdollSystem> {
  system = await flatSystem();
  system.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) });
  for (let f = 0; f < SETTLE_FRAMES; f++) system.update(FRAME, [], true, true, null);
  return system;
}

/** `kind` off a `style` thrown at `mps` along +z to pass the walker's axis at height `y` (`toward`), or the other way; with no walker out (`walker` false) its path alone. */
async function throwAt(kind: Kind, mps: number, y: number, toward = true, walker = true, style: CarStyleId = "sedan"): Promise<Reading> {
  const sys = walker ? await standingWalker() : null;
  const thrown = looseOff(kind, new THREE.Vector3(), new THREE.Vector3(0, 0, toward ? -mps : mps), undefined, style);
  const { half, centre } = thrown.body.shape;
  const e = new THREE.Matrix4().makeRotationFromQuaternion(thrown.body.object.quaternion).elements;
  const halfDepth = Math.abs(e[2]!) * half.x + Math.abs(e[6]!) * half.y + Math.abs(e[10]!) * half.z;
  const from = Math.max(halfDepth + PARTS[TORSO].h[2] + CLEAR_GAP_M, Math.min(THROW_FROM_M, mps * FLIGHT_S));
  const t = from / mps;
  thrown.body.object.position.set(0, y + 0.5 * GRAVITY * t * t, from).sub(centre.clone().applyQuaternion(thrown.body.object.quaternion));
  const r: Reading = { lowestHead: Infinity, travel: 0, fastest: 0, airborne: -Infinity, path: [] };
  for (let f = 0; f < FRAMES; f++) {
    thrown.step();
    r.path.push(...middle(thrown.body).toArray());
    if (!sys) continue;
    sys.walker.ask();
    sys.update(FRAME, [thrown.car], true, true, null);
    const d = sys["dolls"][WALKER]!;
    const torso = d.bodies[TORSO]!;
    const v = torso.linvel();
    r.lowestHead = Math.min(r.lowestHead, d.bodies[HEAD]!.translation().y);
    r.travel = Math.max(r.travel, Math.hypot(torso.translation().x, torso.translation().z));
    r.fastest = Math.max(r.fastest, Math.hypot(v.x, v.y, v.z));
    r.airborne = Math.max(r.airborne, Math.min(...d.bodies.map((b) => b.translation().y - PARTS[d.bodies.indexOf(b)]!.h[1])));
  }
  return r;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** How deep (m) the deepest corner of any of `doll`'s parts' boxes is in `body` (a box, or a wheel's disk with its axle along its own x); 0 when none is in it. */
function deepestIn(doll: Doll, body: LooseBody, disk: boolean): number {
  const centre = middle(body);
  const inverse = body.object.quaternion.clone().invert();
  const h = body.shape.half;
  let deepest = 0;
  for (let k = 0; k < PARTS.length; k++) {
    const t = doll.bodies[k]!.translation();
    const r = doll.bodies[k]!.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    for (let c = 0; c < 8; c++) {
      const half = PARTS[k]!.h;
      _p.set(c & 1 ? half[0] : -half[0], c & 2 ? half[1] : -half[1], c & 4 ? half[2] : -half[2]).applyQuaternion(_q).add(t).sub(centre).applyQuaternion(inverse);
      const depth = disk ? Math.min(h.x - Math.abs(_p.x), h.y - Math.hypot(_p.y, _p.z)) : Math.min(h.x - Math.abs(_p.x), h.y - Math.abs(_p.y), h.z - Math.abs(_p.z));
      deepest = Math.max(deepest, depth);
    }
  }
  return deepest;
}

/** `kind` let down flat (its own x up) with its middle at `at` and left until it sleeps on the road. */
function lyingStill(kind: Kind, at: THREE.Vector3): Loose {
  const lying = looseOff(kind, at, new THREE.Vector3(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
  for (let f = 0; f < 5 * FRAME_HZ && !lying.body.shape.asleep; f++) lying.step();
  if (!lying.body.shape.asleep) throw new Error(`${kind} never came to rest`);
  return lying;
}

describe(`given a walker standing at the origin facing +z and a part off a car parked far off, thrown at him from up to ${THROW_FROM_M} m`, () => {
  it(`when a wheel at ${SHARED_MPS} m/s passes him by, thrown the other way, then he stands: his head stays over ${STANDING_HEAD_M} m`, async () => {
    const miss = await throwAt("wheel", SHARED_MPS, TORSO_Y, false);
    expect(miss.lowestHead, `his head never came lower than ${miss.lowestHead.toFixed(2)} m`).toBeGreaterThan(STANDING_HEAD_M);
  });

  const rows: { speed: string; kind: Kind; style?: CarStyleId; mps: number; knocked: boolean }[] = [
    { speed: "the shared", kind: "wheel", mps: SHARED_MPS, knocked: true },
    { speed: "the shared", kind: "quarterL", mps: SHARED_MPS, knocked: true },
    { speed: "its own leave", kind: "wheel", mps: LEAVE_MPS.wheel, knocked: true },
    { speed: "its own leave", kind: "quarterL", mps: LEAVE_MPS.quarterL, knocked: false },
  ];
  // Each class's torn front bumper and mirror (`ClassStats.bumperKg`, `mirrorKg`). Bumpers: at its leave speed only the monster's 80 kg steel
  // bar knocks him over (the coupe's 27 and pickup's 28 kg bars bump him, as every plastic cover does); at the shared speed every steel bar
  // and the 7 kg covers knock him over. Mirrors: only the monster's 9 kg towing mirror knocks him over, at either speed; the 2-3.5 kg ones bump.
  for (const [style, bumperAtLeave, bumperAtShared, mirror] of [
    ["sedan", false, false, false],
    ["hatchback", false, false, false],
    ["wagon", false, true, false],
    ["police", false, true, false],
    ["coupe", false, true, false],
    ["pickup", false, true, false],
    ["monster", true, true, true],
  ] as const) {
    rows.push({ speed: "its own leave", kind: "bumperF", style, mps: LEAVE_MPS.bumperF, knocked: bumperAtLeave });
    rows.push({ speed: "the shared", kind: "bumperF", style, mps: SHARED_MPS, knocked: bumperAtShared });
    rows.push({ speed: "its own leave", kind: "mirrorL", style, mps: LEAVE_MPS.mirrorL, knocked: mirror });
    rows.push({ speed: "the shared", kind: "mirrorL", style, mps: SHARED_MPS, knocked: mirror });
  }
  for (const row of rows) {
    const outcome = row.knocked
      ? `knocks him over: his head comes down below ${KNOCKED_HEAD_M} m`
      : `bumps him (his torso moves at over ${BUMP_MPS} m/s) and he stays on his feet: his torso goes under ${BUMP_TRAVEL_M} m, no part of him over ${GROUNDED_M} m off the ground, his head over ${STANDING_HEAD_M} m`;
    it(`when a ${row.style ?? "sedan"}'s ${row.kind} at ${row.speed} speed (${row.mps} m/s) reaches his torso, then it ${outcome}`, async () => {
      const hit = await throwAt(row.kind, row.mps, TORSO_Y, true, true, row.style);
      if (row.knocked) {
        expect(hit.lowestHead, `his head came down to ${hit.lowestHead.toFixed(2)} m`).toBeLessThan(KNOCKED_HEAD_M);
        return;
      }
      expect(hit.fastest, `his torso's fastest: ${hit.fastest.toFixed(3)} m/s`).toBeGreaterThan(BUMP_MPS);
      expect(hit.travel, `his torso went ${hit.travel.toFixed(3)} m`).toBeLessThan(BUMP_TRAVEL_M);
      expect(hit.airborne, `his lowest part was at most ${hit.airborne.toFixed(3)} m up`).toBeLessThan(GROUNDED_M);
      expect(hit.lowestHead, `his head came down to ${hit.lowestHead.toFixed(2)} m`).toBeGreaterThan(STANDING_HEAD_M);
    });
  }

  it(`when a wheel reaches his face at ${FACE_MPS[0]} and at ${FACE_MPS[1]} m/s, then each knocks him over and the faster carries his torso over ${FARTHER_M} m farther`, async () => {
    const slow = await throwAt("wheel", FACE_MPS[0], HEAD_Y);
    system?.dispose();
    const fast = await throwAt("wheel", FACE_MPS[1], HEAD_Y);
    expect(slow.lowestHead, `his head came down to ${slow.lowestHead.toFixed(2)} m at ${FACE_MPS[0]} m/s`).toBeLessThan(KNOCKED_HEAD_M);
    expect(fast.lowestHead, `his head came down to ${fast.lowestHead.toFixed(2)} m at ${FACE_MPS[1]} m/s`).toBeLessThan(KNOCKED_HEAD_M);
    expect(fast.travel - slow.travel, `his torso went ${slow.travel.toFixed(2)} m at ${FACE_MPS[0]} m/s, ${fast.travel.toFixed(2)} m at ${FACE_MPS[1]}`).toBeGreaterThan(FARTHER_M);
  });

  it("when it is thrown with no walker out, then it flies the same path, frame for frame, as it did into him (he does not push it back)", async () => {
    const hit = await throwAt("wheel", SHARED_MPS, TORSO_Y);
    const alone = await throwAt("wheel", SHARED_MPS, TORSO_Y, true, false);
    const bad = firstMismatch(hit.path, alone.path);
    expect(bad, `the wheel's path first differs at number ${bad?.index} (frame ${Math.floor((bad?.index ?? 0) / 3)})`).toBeUndefined();
  });
});

describe("given a part lying still on the road", () => {
  it(`when a dummy is dropped flat onto a lying door, then no corner of him goes over ${THROUGH_M} m into it`, async () => {
    system = await flatSystem();
    const door = lyingStill("doorL", new THREE.Vector3(0, 0.4, 0));
    const top = middle(door.body).y + door.body.shape.half.x;
    system["spawn"]({ car: -1, p: new THREE.Vector3(0, top + 0.4, 0), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), v: new THREE.Vector3(), w: new THREE.Vector3(), age: 0, cop: false, rides: false });
    const slot = system["dolls"].findIndex((d) => d.live);
    let deepest = 0;
    for (let f = 0; f < 2 * FRAME_HZ; f++) {
      door.step();
      system.update(FRAME, [door.car], true, true, null);
      deepest = Math.max(deepest, deepestIn(system["dolls"][slot]!, door.body, false));
    }
    expect(deepest, `his deepest corner went ${deepest.toFixed(3)} m into the door (its top at ${top.toFixed(2)} m)`).toBeLessThan(THROUGH_M);
  });

  it(`when the walker walks at ${WALK_SPEED} m/s into a wheel lying on its side in his way, then no corner of him goes over ${THROUGH_M} m into it`, async () => {
    const sys = await standingWalker();
    const wheel = lyingStill("wheel", new THREE.Vector3(0, 0.3, 1.2));
    let deepest = 0;
    for (let f = 0; f < 3 * FRAME_HZ; f++) {
      wheel.step();
      sys.walker.ask();
      sys.walker.heading = 0;
      sys.walker.command = WALK_SPEED;
      sys.update(FRAME, [wheel.car], true, true, null);
      deepest = Math.max(deepest, deepestIn(sys["dolls"][WALKER]!, wheel.body, true));
    }
    const z = sys["dolls"][WALKER]!.bodies[TORSO]!.translation().z;
    expect(deepest, `his deepest corner went ${deepest.toFixed(3)} m into the wheel; his torso ended at z ${z.toFixed(2)}`).toBeLessThan(THROUGH_M);
  });
});
