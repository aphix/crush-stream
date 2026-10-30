import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeWorld, runWall, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FINE_HZ, FRAME_HZ, GRAVITY } from "../kernel/constants.ts";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { LID } from "./constants.ts";
import { paint } from "./test-support.ts";
import { must } from "../kernel/must.test-util.ts";
import type { DoorHinge } from "./car-core.ts";
import { hingePose } from "./part-pose.ts";
import { fireRam, parkedStyle } from "../scenes/door-rig.test-util.ts";

/**
 * The trunk lid, hatch, liftgate and drop gate swing on the doors' hinge model (docs/DOOR_RIG.md, "Lids"): a rear hit past the
 * latch's threshold springs it, it swings on its weight, struts and the car's surge, re-latches when shut under its slam limit,
 * and tears off at its stop, on a slam, or under a hit once open.
 */

const H = 1 / FINE_HZ;
const LIDS: readonly CarStyleId[] = ["sedan", "hatchback", "wagon", "pickup", "monster"];
/** The owner's open-hood photos, hood against belt line in their side views: a real hood stands this far up (degrees). */
const HOOD_OPEN_DEG = [27, 34] as const;
/** The hood's rear edge may rise this far (m) above its rest top as it turns (its own thickness): no visible gap at the cowl. */
const HOOD_EDGE_RISE = 0.015;
/** The rear-edge band (m, from the hood's rearmost point) read as its hinge line. */
const EDGE_BAND = 0.01;

function parked(id: CarStyleId): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.spawnFacing(0, 0, 0, 0);
  return car;
}

/** `seconds` of free swing; `az` the car's forward acceleration (m/s²). */
function swing(car: DeformableCar, seconds: number, az = 0): void {
  for (let t = 0; t < seconds - 1e-9; t += H) {
    car.velocity.addScaledVector(car.fwdFlat, az * H);
    car.swingHinges(H);
  }
}

/** The closing (or opening) rate (rad/s) at which the lid carries `share` × `energy` (J). */
const rateFor = (car: DeformableCar, share: number, energy: number): number => Math.sqrt((2 * share * energy) / car.lidHinge().spec.inertia);

describe("given a rear hit on a car with its lid shut", () => {
  for (const id of LIDS) {
    it(`when a ${id} backs into a wall at 14 km/h, then its lid stays latched; at 30 km/h its latch springs and the lid stays on`, (t) => {
      const soft = parked(id);
      runWall(14, 1, "rear", { car: soft });
      const hard = parked(id);
      runWall(30, 1, "rear", { car: hard });
      t.annotate(`${id}: 14 km/h hinge ${soft.lidAngle().toFixed(3)} rad, 30 km/h ${hard.lidAngle().toFixed(3)} rad`);
      expect(soft.lidHinge().latched, `${id} lid sprang at 14 km/h`).toBeTruthy();
      expect(!hard.lidHinge().latched && !hard.lidOff(), `${id} lid at 30 km/h: latched ${hard.lidHinge().latched}, off ${hard.lidOff()}`).toBeTruthy();
    });
  }
});

describe("given an unlatched lid on a parked car", () => {
  it("when a pickup's tailgate is sprung, then it drops rearward onto its cables, level (90°), and never swings under", () => {
    const car = parked("pickup");
    const s = car.lidHinge().spec;
    // Where a 30 km/h rear hit springs it (`lidAngle` above): a gate barely off upright is held by its hinges' friction.
    car.setLidOpen(0.15);
    let most = 0;
    for (let k = 0; k < 2 * FINE_HZ; k++) {
      car.swingHinges(H);
      most = Math.max(most, car.lidHinge().theta);
    }
    const h = car.lidHinge();
    expect(Math.abs(s.stop - Math.PI / 2), `stop ${s.stop}`).toBeLessThan(1e-9);
    expect(h.theta).toBe(s.stop);
    expect(most, `swung to ${most}`).toBeLessThanOrEqual(s.stop);
    expect(h.load > 0 && h.load < s.tearJ && !car.lidOff(), `cables took ${h.load} J`).toBeTruthy();
  });

  for (const id of ["wagon", "hatchback"] as const) {
    it(`when a ${id}'s top-hinged gate is let go where its latch's pop leaves it, then its gas struts lift it up to its stop and hold it there; let go 1° open, its weight holds it down`, () => {
      const car = parked(id);
      car.setLidOpen(car.lidHinge().spec.taper);
      swing(car, 3);
      expect(car.lidHinge().theta, "let go at the pop (rad)").toBe(car.lidHinge().spec.stop);
      expect(!car.lidOff()).toBe(true);
      const low = parked(id);
      low.setLidOpen(0.02);
      swing(low, 3);
      expect(low.lidHinge().theta, "let go 1° open (rad)").toBeLessThanOrEqual(0.02);
    });
  }

  it("when a sedan's lid is let go, then its torsion bars lift it to its stop, a hard launch swings it down off the stop, and coasting lets it rise back", () => {
    const car = parked("sedan");
    const h = car.lidHinge();
    car.setLidOpen(0.05);
    swing(car, 2);
    expect(h.theta).toBe(h.spec.stop);
    swing(car, 0.5, 8);
    const launched = h.theta;
    swing(car, 2);
    expect(launched < h.spec.stop - 0.1 && !h.latched, `launch left it at ${launched}`).toBeTruthy();
    expect(h.theta).toBe(h.spec.stop);
  });
});

describe("given an open lid pushed shut or flung onto its stop", () => {
  it("when a solid pushes it shut at 0.9× its slam limit, then it latches; at 1.1×, then it is wrenched off", () => {
    const soft = parked("sedan");
    soft.setLidOpen(1);
    soft.shutLid(0, rateFor(soft, 0.9, soft.lidHinge().spec.slamJ));
    const hard = parked("sedan");
    hard.setLidOpen(1);
    hard.shutLid(0, rateFor(hard, 1.1, hard.lidHinge().spec.slamJ));
    expect(soft.lidHinge().latched && !soft.lidOff() && soft.lidAngle() === 0).toBeTruthy();
    expect(hard.lidOff() && hard.hasLoosePart()).toBeTruthy();
  });

  it("when it is flung onto its stop at 0.8× its hinge limit, then it holds; at 1.25×, then it tears off", () => {
    const fling = (share: number): DeformableCar => {
      const car = parked("sedan");
      car.setLidOpen(0.4);
      car.lidHinge().omega = rateFor(car, share, car.lidHinge().spec.tearJ);
      swing(car, 0.5);
      return car;
    };
    const soft = fling(0.8);
    expect(!soft.lidOff() && soft.lidHinge().theta === soft.lidHinge().spec.stop, `load ${soft.lidHinge().load}`).toBeTruthy();
    expect(fling(1.25).lidOff()).toBeTruthy();
  });
});

describe("given a rear hit on a car whose lid is already open", () => {
  it("when a sedan backs into a wall at 40 km/h and then 24 km/h, then the first springs the lid open and the second tears it off as a loose part", (t) => {
    const car = parked("sedan");
    runWall(40, 1, "rear", { car });
    const open = !car.lidHinge().latched && !car.lidOff();
    const r = runWall(24, 1, "rear", { car });
    t.annotate(`after the second hit: hinge ${r.hinge[LID.trunk]?.toFixed(3)}, detached ${r.detached.join(",")}, stop load ${car.lidHinge().load.toFixed(1)} J, ebs ${car.deform.hitSpeedValue.toFixed(2)}`);
    expect(open, "the first hit left the lid shut or tore it off").toBeTruthy();
    expect(car.lidOff() && r.detached.includes(LID.trunk) && car.hasLoosePart()).toBeTruthy();
  });
});

/** A sedan carried forward at `speed` (m/s, steady: no acceleration) for 4 s with its lid let go on its stop: how near shut it swung, and how often it turned back over the last 2 s. */
function carriedOpen(speed: number): { nearest: number; turns: number; stop: number } {
  const car = parked("sedan");
  car.velocity.copy(car.fwdFlat).multiplyScalar(speed);
  car.setLidOpen(car.lidHinge().spec.stop);
  const h = car.lidHinge();
  let nearest = h.theta;
  let turns = 0;
  let heading = 0;
  for (let k = 0; k < 4 * FINE_HZ; k++) {
    const was = h.theta;
    car.swingHinges(H);
    nearest = Math.min(nearest, h.theta);
    const now = Math.sign(h.theta - was);
    if (k >= 2 * FINE_HZ && now !== 0 && now !== heading) turns++;
    if (now !== 0) heading = now;
  }
  return { nearest, turns, stop: h.spec.stop };
}

describe("given a sedan driven with its boot lid open on its stop", () => {
  it("when it cruises at highway speed (30 m/s), then the wind swings the lid more than halfway shut and it keeps flapping; at walking speed (1.5 m/s) it stays as it hangs", (t) => {
    const highway = carriedOpen(30);
    const walking = carriedOpen(1.5);
    t.annotate(`highway: nearest ${highway.nearest.toFixed(3)} rad of stop ${highway.stop.toFixed(3)}, ${highway.turns} turns; walking: nearest ${walking.nearest.toFixed(3)}, ${walking.turns} turns`);
    expect(highway.nearest, "highway: the lid's nearest approach to shut (rad open)").toBeLessThan(highway.stop / 2);
    expect(highway.turns, "highway: the lid's turns back over the last 2 s (flaps)").toBeGreaterThan(10);
    expect(walking.nearest, "walking: the lid's nearest approach to shut (rad open)").toBe(walking.stop);
  });
});

/** How long (s) a dropped car is followed: it lands, settles and its lid comes to rest well within it. */
const DROP_S = 3;

const dropCases = [
  { it: "when a sedan with its lid on its stop is dropped 0.3 m onto its wheels, then the lid dips and comes back to its stop, unlatched", id: "sedan", drop: 0.3, expectedLatched: false, expectedOnStop: true },
  { it: "when a sedan with its lid on its stop is dropped 2.5 m onto its wheels, then the landing swings the lid shut and it latches", id: "sedan", drop: 2.5, expectedLatched: true, expectedOnStop: false },
  { it: "when a hatchback with its gate on its stop is dropped 0.3 m onto its wheels, then the gate dips and comes back to its stop, unlatched", id: "hatchback", drop: 0.3, expectedLatched: false, expectedOnStop: true },
  { it: "when a hatchback with its gate on its stop is dropped 2 m onto its wheels, then the landing swings the gate shut and it latches", id: "hatchback", drop: 2, expectedLatched: true, expectedOnStop: false },
] as const;

describe("given a car with its boot lid popped open on its stop, dropped flat onto its wheels", () => {
  for (const testCase of dropCases) {
    it(testCase.it, (t) => {
      const car = parked(testCase.id);
      car.group.position.y += testCase.drop;
      car.airborne = true;
      car.setLidOpen(car.lidHinge().spec.stop);
      const h = car.lidHinge();
      const world = makeWorld([car], false, false, null);
      let nearest = h.theta;
      let fastestFall = 0;
      for (let f = 0; f < DROP_S * FRAME_HZ; f++) {
        tickWorld(world, 1 / FRAME_HZ);
        nearest = Math.min(nearest, h.theta);
        fastestFall = Math.min(fastestFall, car.velocity.y);
      }
      t.annotate(`${testCase.id} ${testCase.drop} m: landed at ${(-fastestFall).toFixed(2)} m/s, nearest ${nearest.toFixed(3)} rad, ends ${h.theta.toFixed(3)} of stop ${h.spec.stop.toFixed(3)}, latched ${h.latched}`);
      expect(-fastestFall, "the car's speed as it landed (m/s)").toBeGreaterThan(Math.sqrt(2 * GRAVITY * testCase.drop) * 0.8);
      expect(nearest, "the lid's nearest approach to shut (rad open)").toBeLessThan(h.spec.stop);
      expect(h.latched, "the lid latched").toBe(testCase.expectedLatched);
      expect(h.theta === h.spec.stop, "the lid back on its stop").toBe(testCase.expectedOnStop);
      expect(car.lidOff(), "the lid torn off").toBe(false);
    });
  }
});

/** A person's hand closing a boot lid or bonnet: a steady push (N) at its free edge, a few tens of newtons (guessed: a palm pressing down, not a slam). */
const HAND_N = 50;
/** A push (N) too light to beat the struts: a fingertip's. */
const FINGER_N = 10;

/** A firm hand closing a liftgate against its gas struts (N): inside the 60-150 N latch-engagement range in `.extraResearch/perplexity/2026-10-30-liftgate-gas-struts.md`. */
const LIFTGATE_N = 120;

/** The lightest of the 2 km/h steps of the sedan's front wall hit that springs its hood (42 km/h leaves it latched). */
const HOOD_POP_KPH = 44;
/** A safety catch lets the sprung hood's nose rise this far (m) at most above its crash pose: real catches hold it 2-5 cm up. */
const CATCH_MAX_M = 0.05;
/** The fastest a swing may carry a lid's free edge past its crash pose in a crash (m/s): a strut-lifted hatch peaks near 3 (measured 2.8), a pose set in one step runs at tens. */
const SWING_EDGE_MAX_MPS = 5;

/** `seconds` of `newtons` held down on the free edge of the lid on hinge `h` while it swings; the hand lets go once it latches. */
function press(car: DeformableCar, h: DoorHinge, newtons: number, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += H) {
    if (!h.latched) h.omega -= ((newtons * h.spec.length) / h.spec.inertia) * H;
    car.swingHinges(H);
  }
}

/** A car of style `id` whose shut boot lid a rear ram (Doors scene F, 12 km/h with 100 kg) has sprung: it rises on its torsion bars or struts to its stop. */
function lidPopped(id: CarStyleId): DeformableCar {
  const car = parkedStyle(id);
  fireRam(car, "lidPop", { kph: 12, kg: 100 });
  return car;
}

/** A sedan whose hood a front wall hit at `HOOD_POP_KPH` has sprung: it sits up on its safety catch. */
function hoodPopped(): DeformableCar {
  const car = parked("sedan");
  runWall(HOOD_POP_KPH, 1, "front", { car });
  return car;
}

const _pose = new Float64Array(7);
/** The angle (rad) the car's `hinge` lid is drawn turned from rest: with its swing (`swing`) or by the crash alone. */
function drawnTurn(car: DeformableCar, hinge: "cowl" | "tail", swing: boolean): number {
  const p = car["parts"].find((q) => q.hinge === hinge);
  must(p, `${hinge} lid`);
  hingePose(p, car.deform, _pose, 0, swing);
  return Math.abs(2 * Math.atan2(_pose[3]!, _pose[6]!));
}

/** A wall hit on a fresh `id` with the drawn angle of its `hinge` lid read after every step: the fastest its free edge moved past what the crash's fold moved it (m/s). */
function swingEdgeRate(id: CarStyleId, kph: number, approach: "front" | "rear", hinge: "cowl" | "tail"): { car: DeformableCar; rate: number } {
  const car = parked(id);
  const length = (hinge === "cowl" ? car.hoodHinge() : car.lidHinge()).spec.length;
  let drawn = 0;
  let crash = 0;
  let rate = 0;
  const step = car.stepBreakage.bind(car);
  car.stepBreakage = (dt: number): void => {
    step(dt);
    const d = drawnTurn(car, hinge, true);
    const c = drawnTurn(car, hinge, false);
    if (dt > 0) rate = Math.max(rate, (Math.abs(d - drawn - (c - crash)) * length) / dt);
    drawn = d;
    crash = c;
  };
  runWall(kph, 1, approach, { car });
  return { car, rate };
}

describe("given a front hit on a sedan with its hood shut", () => {
  it(`when it noses into a wall at ${HOOD_POP_KPH - 2} km/h, then the hood stays latched; at ${HOOD_POP_KPH} km/h, then it slightly unlatches: up a few cm onto its safety catch, still on the car`, (t) => {
    const soft = parked("sedan");
    runWall(HOOD_POP_KPH - 2, 1, "front", { car: soft });
    const car = hoodPopped();
    swing(car, 3);
    const h = car.hoodHinge();
    const lift = (drawnTurn(car, "cowl", true) - drawnTurn(car, "cowl", false)) * h.spec.length;
    t.annotate(`${HOOD_POP_KPH} km/h: nose ${(lift * 100).toFixed(1)} cm over its crash pose, theta ${h.theta.toFixed(3)} rad`);
    expect(soft.hoodHinge().latched, `${HOOD_POP_KPH - 2} km/h sprang the hood`).toBe(true);
    expect(h.latched || car.hoodOff(), `${HOOD_POP_KPH} km/h: latched ${h.latched}, off ${car.hoodOff()}`).toBe(false);
    expect(lift, "the nose's rise over its crash pose (m)").toBeGreaterThan(0.01);
    expect(lift, "the nose's rise over its crash pose (m)").toBeLessThanOrEqual(CATCH_MAX_M);
  });

  const rateCases = [
    { it: "when a sedan noses into a wall at 64 km/h, folding its hood and popping its latch, then no step moves the drawn hood faster than its swing can", id: "sedan", kph: 64, approach: "front", hinge: "cowl" },
    { it: "when a hatchback backs into a wall at 30 km/h, popping its gate's latch, then no step moves the drawn gate faster than its swing can", id: "hatchback", kph: 30, approach: "rear", hinge: "tail" },
  ] as const;
  for (const testCase of rateCases) {
    it(testCase.it, (t) => {
      const { car, rate } = swingEdgeRate(testCase.id, testCase.kph, testCase.approach, testCase.hinge);
      const h = testCase.hinge === "cowl" ? car.hoodHinge() : car.lidHinge();
      t.annotate(`${testCase.id}: fastest swing edge ${rate.toFixed(2)} m/s, latched ${h.latched}, theta ${h.theta.toFixed(3)} rad`);
      expect(h.latched, "the hit sprang the latch").toBe(false);
      expect(rate, "the free edge's fastest swing past the crash's fold (m/s)").toBeLessThan(SWING_EDGE_MAX_MPS);
    });
  }
});

const handCases = [
  { it: "when a hand holds the popped boot lid's edge down with 50 N, then it swings shut and latches over its crash dent", id: "sedan", lid: "boot", newtons: HAND_N, expectedLatched: true },
  { it: "when a fingertip holds the popped boot lid's edge down with 10 N, then the torsion bars keep it up, unlatched", id: "sedan", lid: "boot", newtons: FINGER_N, expectedLatched: false },
  { it: "when a hand holds a hatchback's popped gate down with the sedan lid's 50 N, then its struts keep it up, unlatched", id: "hatchback", lid: "boot", newtons: HAND_N, expectedLatched: false },
  { it: `when a hand holds a hatchback's popped gate down with a liftgate's closing push (${LIFTGATE_N} N), then it swings shut, its weight wins over the struts' dead band, and it latches`, id: "hatchback", lid: "boot", newtons: LIFTGATE_N, expectedLatched: true },
  { it: `when a hand holds a wagon's popped gate down with a liftgate's closing push (${LIFTGATE_N} N), then it swings shut, its weight wins over the struts' dead band, and it latches`, id: "wagon", lid: "boot", newtons: LIFTGATE_N, expectedLatched: true },
  { it: "when a hand holds the popped hood's edge down with 50 N, then it swings shut and latches over its crash dent", id: "sedan", lid: "hood", newtons: HAND_N, expectedLatched: true },
  { it: "when a fingertip holds the popped hood's edge down with 10 N, then the struts keep it up on its catch, unlatched", id: "sedan", lid: "hood", newtons: FINGER_N, expectedLatched: false },
] as const;

describe("given a boot lid sprung by a rear hit or a sedan's hood by a front hit, off its latch", () => {
  for (const testCase of handCases) {
    it(testCase.it, (t) => {
      const car = testCase.lid === "boot" ? lidPopped(testCase.id) : hoodPopped();
      const h = testCase.lid === "boot" ? car.lidHinge() : car.hoodHinge();
      swing(car, 2);
      const popped = h.theta;
      expect(h.latched, "the hit left it latched").toBe(false);
      expect(popped, "how far the sprung part stood open (rad)").toBeGreaterThan(0);
      const newtons = testCase.newtons;
      press(car, h, newtons, 3);
      // Then half a second of the crash rules on the dented car: an old dent does not spring a latch again.
      for (let k = 0; k < FINE_HZ / 2; k++) car.stepBreakage(H);
      t.annotate(`${testCase.id} ${testCase.lid} ${newtons.toFixed(1)} N: from ${popped.toFixed(3)} rad to ${h.theta.toFixed(3)}, latched ${h.latched}`);
      expect(h.latched, "latched after the push and the crash rules' half second").toBe(testCase.expectedLatched);
      if (testCase.expectedLatched) expect(h.theta, "open after the push (rad)").toBeLessThan(0.1);
      else expect(h.theta, "where the push left it (rad), against where the hit had it").toBeGreaterThan(popped - 0.01);
      expect(testCase.lid === "boot" ? car.lidOff() : car.hoodOff(), "torn off").toBe(false);
    });
  }

  it("when the Doors scene's G ram strikes the sprung boot lid on its stop with 35 J, then it holds; with 555 J, then it tears off as a loose part", () => {
    const soft = lidPopped("sedan");
    fireRam(soft, "lidTear", { kph: 3, kg: 100 });
    const hard = lidPopped("sedan");
    const torn = fireRam(hard, "lidTear", { kph: 12, kg: 100 });
    expect(soft.lidOff(), "35 J tore the lid off").toBe(false);
    expect(torn.detached.includes("trunk") && hard.hasLoosePart(), `555 J left the lid on: [${torn.detached}]`).toBe(true);
  });

  it("when the sprung hood is flung onto its stop with 0.8× its hinge's tear energy, then it holds; with 1.25×, then it tears off as a loose part", () => {
    const fling = (share: number): DeformableCar => {
      const car = hoodPopped();
      const h = car.hoodHinge();
      // From below its stop: a part already resting on its stop takes no strap load from a push.
      h.theta = h.spec.stop / 2;
      h.omega = Math.sqrt((2 * share * h.spec.tearJ) / h.spec.inertia);
      swing(car, 0.5);
      return car;
    };
    const soft = fling(0.8);
    const hard = fling(1.25);
    expect(soft.hoodOff(), `0.8×: stop load ${soft.hoodHinge().load} J`).toBe(false);
    expect(soft.hoodHinge().theta, "0.8×: the hood on its stop (rad)").toBe(soft.hoodHinge().spec.stop);
    expect(hard.hoodOff() && hard.hasLoosePart(), "1.25× left the hood on").toBe(true);
  });
});

/** The rear pane's first vertex in the world (m). */
function rearPaneAt(car: DeformableCar): THREE.Vector3 {
  const mesh = car["glassPanes"].find((g) => g.name === "rear")!.mesh;
  car.group.updateMatrixWorld(true);
  return new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position") as THREE.BufferAttribute, 0).applyMatrix4(mesh.matrixWorld);
}

describe("given a car's rear window and its lid", () => {
  const testCases = [
    { id: "hatchback", gate: true },
    { id: "wagon", gate: true },
    { id: "sedan", gate: false },
    { id: "pickup", gate: false },
  ] as const;
  for (const { id, gate } of testCases) {
    it(`when the ${id}'s lid opens to its stop and then tears off, then its rear pane ${gate ? "swings and leaves with it" : "stays on the body"}`, () => {
      const car = parked(id);
      const shut = rearPaneAt(car);
      car.setLidOpen(car.lidHinge().spec.stop);
      const moved = rearPaneAt(car).distanceTo(shut);
      car.ripLid(new THREE.Vector3());
      let up: THREE.Object3D | null = car["glassPanes"].find((g) => g.name === "rear")!.mesh;
      while (up !== null && up !== car.group) up = up.parent;
      if (gate) expect(moved > 0.1 && up === null, `${id} pane moved ${moved.toFixed(3)} m, still on the body ${up !== null}`).toBeTruthy();
      else expect(moved === 0 && up === car.group, `${id} pane moved ${moved} m, on the body ${up !== null}`).toBeTruthy();
    });
  }
});

/** The strip probed beside a gate's glass: this far (m) forward of the D-post's rear edge, in the post's share next to the glass. */
const POST_STRIP = 0.015;
/** The D-post's rear edge is found stepping forward this far (m) at a time from 5 cm behind the glass's side edge. */
const EDGE_STEP = 0.0025;
/** A body surface this near (m) to where the shut gate's was counts as left on the body. */
const NEAR = 0.03;

/**
 * The probes (car frame) of a shut roof-hinged gate's frame and spoiler: where the gate carries a share of each D-post (`boot.postShare`), a ray in from outboard at three
 * heights up each D-post, `POST_STRIP` forward of the first surface (body or gate) beside the rear glass's edge; and one down onto the spoiler behind its shut line.
 */
function gateProbes(car: DeformableCar, meshes: THREE.Object3D[]): { name: string; from: THREE.Vector3; toward: THREE.Vector3 }[] {
  const { base, top } = car.style.rearGlass;
  const spoiler = car.style.roof?.spoiler;
  const gate = spoiler?.gate;
  must(spoiler !== undefined && gate !== undefined, `${car.style.id}: its spoiler has no shut line on the gate`);
  const ray = new THREE.Raycaster();
  const out: { name: string; from: THREE.Vector3; toward: THREE.Vector3 }[] = [];
  for (const side of car.style.boot.postShare === undefined ? [] : [-1, 1]) {
    for (const t of [0.3, 0.5, 0.7]) {
      const [y, edge] = [THREE.MathUtils.lerp(base[0], top[0], t), THREE.MathUtils.lerp(base[1], top[1], t)];
      const toward = new THREE.Vector3(-side, 0, 0);
      let z = edge - 0.05;
      for (; z < edge + 0.15; z += EDGE_STEP) {
        ray.set(new THREE.Vector3(side * 3, y, z), toward);
        if (ray.intersectObjects(meshes, false).length > 0) break;
      }
      expect(z, `${car.style.id}: no D-post beside the glass at ${t} on side ${side}`).toBeLessThan(edge + 0.15);
      out.push({ name: `beside the glass at ${t} on side ${side}`, from: new THREE.Vector3(side * 3, y, z + POST_STRIP), toward });
    }
  }
  out.push({ name: "on the spoiler behind its shut line", from: new THREE.Vector3(0, 3, (spoiler.z[0] + gate) / 2), toward: new THREE.Vector3(0, -1, 0) });
  return out;
}

describe("given a roof-hinged gate's frame and spoiler (hatchback, wagon)", () => {
  for (const id of ["hatchback", "wagon"] as const) {
    it(`when the ${id}'s gate is shut, opened to its stop and torn off, then its spoiler behind the shut line (and the strip beside its glass, where it carries D-post shares) are the gate's: shut they are the lid's skin, open or torn nothing of them stays on the body`, () => {
      const ray = new THREE.Raycaster();
      const shut = parked(id);
      const lid = shut["trunk"];
      shut.group.updateMatrixWorld(true);
      const probes = gateProbes(shut, [shut.body, lid]);
      const at: THREE.Vector3[] = [];
      for (const p of probes) {
        ray.set(p.from, p.toward);
        const hit = ray.intersectObjects([shut.body, lid], false)[0];
        const met = hit === undefined ? "nothing" : hit.object === shut.body ? "the body" : "another mesh";
        expect(hit !== undefined && hit.object === lid, `${id} ${p.name}: the first hit is ${met}${hit ? ` at ${hit.point.toArray().map((v) => v.toFixed(3)).join()}` : ""}, not the gate's skin`).toBeTruthy();
        at.push(hit.point.clone());
      }
      const leaves = (car: DeformableCar, what: string): void => {
        car.group.updateMatrixWorld(true);
        for (let i = 0; i < probes.length; i++) {
          ray.set(probes[i]!.from, probes[i]!.toward);
          for (const hit of ray.intersectObject(car.body, false)) {
            const gap = hit.point.distanceTo(at[i]!);
            expect(gap, `${id} ${probes[i]!.name}, gate ${what}: the body has a surface at ${hit.point.toArray().map((v) => v.toFixed(3)).join()}, ${gap.toFixed(3)} m from where the gate's skin was (${at[i]!.toArray().map((v) => v.toFixed(3)).join()})`).toBeGreaterThanOrEqual(NEAR);
          }
        }
      };
      const open = parked(id);
      open.showPose("open");
      leaves(open, "opened to its stop");
      const torn = parked(id);
      torn.ripLid(new THREE.Vector3());
      leaves(torn, "torn off");

      // The frame and spoiler (`surround`..) skin on the rear glass's cage: the boot cage's clamp would flatten them.
      const geometry = lid.geometry;
      const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
      const surround = geometry.userData.surround;
      expect(typeof surround === "number" && surround < attr.count, `${id}: the gate's surround starts at ${String(surround)} of ${attr.count} vertices`).toBeTruthy();
      const rest = Float32Array.from(attr.array);
      shut.deform.skinPanel(geometry, rest, "glassRear", shut["trunkOrigin"], surround);
      let drift = 0;
      for (let i = surround * 3; i < rest.length; i++) drift = Math.max(drift, Math.abs(attr.array[i]! - rest[i]!));
      expect(drift, `${id}: the surround skinned on the rear glass's cage at rest moves ${drift.toExponential(1)} m`).toBeLessThan(1e-4);
    });
  }
});

describe("given every style parked and posed open for show", () => {
  it("when the hood is opened, then it stands up as far as the owner's open-hood photos show, turned about its rear edge, which stays down on the cowl", () => {
    const rows: string[] = [];
    const bad: string[] = [];
    const at = new THREE.Vector3();
    for (const id of CAR_STYLE_IDS) {
      const car = parked(id);
      car.group.updateMatrixWorld(true);
      const hood = car["parts"].find((p) => p.hinge === "cowl")!.object as THREE.Mesh;
      const pos = hood.geometry.getAttribute("position") as THREE.BufferAttribute;
      let zMin = Infinity;
      for (let i = 0; i < pos.count; i++) zMin = Math.min(zMin, pos.getZ(i));
      const edge: number[] = [];
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < zMin + EDGE_BAND) edge.push(i);
      const topY = (): number => Math.max(...edge.map((i) => at.fromBufferAttribute(pos, i).applyMatrix4(hood.matrixWorld).y));
      const restTop = topY();
      const axis = at.setFromMatrixPosition(hood.matrixWorld).y - restTop;
      car.showPose("open");
      car.group.updateMatrixWorld(true);
      const rise = topY() - restTop;
      const nose = at.set(0, 0, 1).transformDirection(hood.matrixWorld);
      const deg = THREE.MathUtils.radToDeg(Math.asin(nose.y));
      rows.push(`${id}: hinge axis ${(axis * 1000).toFixed(0)} mm over the rear edge at rest; open, the edge rises ${(rise * 1000).toFixed(0)} mm and the hood stands ${deg.toFixed(1)} deg`);
      if (rise > HOOD_EDGE_RISE || deg < HOOD_OPEN_DEG[0] || deg > HOOD_OPEN_DEG[1]) bad.push(id);
    }
    expect(bad.join(","), rows.join("\n")).toBe("");
  });
});
