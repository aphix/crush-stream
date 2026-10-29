import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { StreamedDeformation } from "./streamed-deform.ts";
import { ENGINE_KILL_TRAVEL, PLATFORM_RIG, type DeformMode } from "./deform-rig.ts";
import { CRASH, crushStroke, leftoverCrumple } from "./physics-util.ts";
import { DT, MODES, assertSameDigest, assertSameNumbers, dummyGeom, mass } from "../vehicle/test-support.ts";
import { runPair } from "../contact/crash-scenarios.test-util.ts";
import { holdOnFace } from "../contact/external-contact.ts";
import { warmCrashPath } from "../engine/world-step.ts";
import { stepWreck, type WreckRig } from "./physics-util.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** ~50 km/h NCAP-style rigid barrier. */
const FRONTAL_MPS = 14;

function momentumZ(d: StreamedDeformation): number {
  return d.masses.reduce((s, m) => s + m.vel.z * m.mass, 0);
}

function spawn(
  impactX = 0,
  speed = FRONTAL_MPS,
  inward = new THREE.Vector3(0, 0, -1),
  impact?: THREE.Vector3,
  mode: DeformMode = "lattice",
): { d: StreamedDeformation; group: THREE.Group; vel: THREE.Vector3; omega: THREE.Vector3; geom: THREE.BufferGeometry } {
  const geom = dummyGeom();
  const d = new StreamedDeformation(geom);
  d.mode = mode;
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  group.updateMatrixWorld();
  const vel = new THREE.Vector3(0, 0, speed);
  const omega = new THREE.Vector3();
  d.beginCrush(impact ?? new THREE.Vector3(impactX, 0.36, 2.06), inward, Math.abs(speed), Math.abs(speed), group, vel, omega);
  return { d, group, vel, omega, geom };
}

function forModes(title: string, fn: (spawnFn: typeof spawn, mode: DeformMode) => void): void {
  for (const mode of MODES) {
    describe(`${title}, in ${mode} deform mode`, () => {
      const spawnFn: typeof spawn = (impactX, speed, inward, impact) =>
        spawn(impactX, speed, inward, impact, mode);
      fn(spawnFn, mode);
    });
  }
}

/** Contact then lattice — the order the engine uses: the body carries, the hit is fed, the structure steps. */
function stepWall(
  s: WreckRig & { geom: THREE.BufferGeometry },
  dt: number,
  overlap = 0.08,
  contactX?: number,
  n = new THREE.Vector3(0, 0, -1),
): void {
  stepWreck(s, dt, () => {
    s.d.notifyContact();
    const fl = mass(s.d, "bumperFL").world;
    const fr = mass(s.d, "bumperFR").world;
    const contact = new THREE.Vector3(
      contactX ?? (fl.x + fr.x) * 0.5,
      (fl.y + fr.y) * 0.5,
      (fl.z + fr.z) * 0.5,
    );
    const closing = Math.max(0, -s.vel.dot(n));
    s.d.feedOverlap(contact, n, overlap, closing, dt);
    const leftover = Math.max(0, closing) * 0.18;
    if (leftover > 0.3) s.d.applyImpulse(n.x, n.y, n.z, leftover * s.d.totalMass * dt * 4);
  });
  s.d.stepCrush(dt);
  s.d.update(s.geom);
}

function travel(d: StreamedDeformation, name: string): number {
  return mass(d, name).local.distanceTo(mass(d, name).rest);
}

function alongZ(d: StreamedDeformation, name: string): number {
  const m = mass(d, name);
  return m.local.z - m.rest.z;
}

describe("given the crash constants (the researched sedan barrier numbers every crash uses)", () => {
  it("when the pulse time, crush distance and friction values are read, then the pulse lasts 0.09 to 0.16 s, the crush is 0.4 to 0.85 m, sliding friction exceeds scuffing friction and peak friction is at least sliding friction", () => {
    expect(CRASH.pulseSec >= 0.09 && CRASH.pulseSec <= 0.16).toBeTruthy();
    expect(CRASH.crushMeters >= 0.4 && CRASH.crushMeters <= 0.85).toBeTruthy();
    expect(CRASH.muSlide).toBeGreaterThan(CRASH.muScuff);
    expect(CRASH.muPeak).toBeGreaterThanOrEqual(CRASH.muSlide);
  });
});

const centredImpactCases = [
  { it: "when the hit lands dead centre (0 m off the centreline), then the hit point stays within 0.22 m of the centreline, so both front corners share the crush", impactX: 0 },
  { it: "when the hit lands 0.199 m off centre, just inside the 0.2 m centre band, then the hit point still counts as centred (within 0.22 m of the centreline)", impactX: 0.199 },
  { it: "when the hit lands exactly 0.2 m off centre, at the edge of the centre band, then the hit point still counts as centred (within 0.22 m of the centreline): the pull to the nearest corner grows from there, it does not jump", impactX: 0.2 },
] as const;

const rightImpactCases = [
  { it: "when the hit lands at the right-front corner (0.62 m right of the centreline), then the hit point stays on the right, more than 0.28 m from the centreline", impactX: 0.62, minSnappedX: 0.28 },
  { it: "when the hit lands 0.3 m right of the centreline, 0.1 m past the centre band, then it counts as a right hit in full (more than 0.25 m right)", impactX: 0.3, minSnappedX: 0.25 },
] as const;

forModes("given a car hit at the front, where the hit point snaps to the centre or to the nearest front corner", (spawn) => {
  for (const testCase of centredImpactCases) {
    it(testCase.it, () => {
      const { d } = spawn(testCase.impactX);
      expect(Math.abs(d.impactLocal.x), `x=${testCase.impactX} snapped off-centre to ${d.impactLocal.x}`).toBeLessThan(0.22);
    });
  }

  for (const testCase of rightImpactCases) {
    it(testCase.it, () => {
      const { d } = spawn(testCase.impactX);
      expect(d.impactLocal.x, `x=${testCase.impactX} should snap right but landed at x=${d.impactLocal.x}`).toBeGreaterThan(testCase.minSnappedX);
    });
  }

  it("when the hit lands at the left-front corner (0.62 m left of the centreline), then the hit point stays on the left, more than 0.28 m from the centreline", () => {
    const { d } = spawn(-0.62);
    expect(d.impactLocal.x, `left hit flipped to x=${d.impactLocal.x}`).toBeLessThan(-0.28);
  });

  it("when the hit lands dead centre and both front bumpers are equally far away, then the hit point is not pulled to the left-front corner (it stays right of -0.15 m), as it would be if ties went to the first bumper", () => {
    const { d } = spawn(0);
    expect(d.impactLocal.x, `head-on became a left-corner at x=${d.impactLocal.x}`).toBeGreaterThan(-0.15);
  });

  it("when the hit lands from 0.18 m to 0.32 m right of the centreline in 1 cm steps, then its point never moves more than 5 cm between neighbours: a step at 0.2 m sent a hit 1 cm either side of it 0.2 m apart, and a sedan's T-bone crushed its nose 0.45 m or 0.74 m with the step phase", () => {
    let last = spawn(0.18).d.impactLocal.x;
    for (let cm = 19; cm <= 32; cm++) {
      const x = spawn(cm / 100).d.impactLocal.x;
      expect(Math.abs(x - last), `${cm} cm: the hit point moved ${(x - last).toFixed(3)} m from ${last.toFixed(3)}`).toBeLessThanOrEqual(0.05);
      last = x;
    }
  });

  it("when a hit armed at the right-front corner finds the pair's patch on the centreline within 15 ms, then its centre follows it to within 0.22 m of the centreline, and after 15 ms it stays at the corner", () => {
    const early = spawn(0.62).d;
    early.aimHit(new THREE.Vector3(0, 0.36, 2.06));
    expect(Math.abs(early.impactLocal.x), `followed to x=${early.impactLocal.x}`).toBeLessThan(0.22);
    const late = spawn(0.62).d;
    late.stepStructure(0.02);
    late.aimHit(new THREE.Vector3(0, 0.36, 2.06));
    expect(late.impactLocal.x, `moved to x=${late.impactLocal.x} after the window`).toBeGreaterThan(0.28);
  });

  it("when a hit armed at 10 m/s meets squarely at 13 m/s within 15 ms, then the pair's contact takes it over (the hit speed is 13, not the two summed), whereas a wall's contact then, or the pair's after 15 ms, is under 1.5 times the hit's and changes nothing", () => {
    const aslant = new THREE.Vector3(0, 0, -1);
    const squarely = new THREE.Vector3(0, 0.36, 2.06);
    const early = spawn(0, 10).d;
    early.stepStructure(0.004);
    expect(early.rearmHit(squarely, aslant, 13, 13, true), "taken over within 15 ms").toBeTruthy();
    expect(Math.abs(early.hitSpeedValue - 13), `hit speed ${early.hitSpeedValue}`).toBeLessThan(1e-9);
    const wall = spawn(0, 10).d;
    wall.stepStructure(0.004);
    expect(wall.rearmHit(squarely, aslant, 13, 13), "a wall's contact is refused").toBe(false);
    const late = spawn(0, 10).d;
    late.stepStructure(0.02);
    expect(late.rearmHit(squarely, aslant, 13, 13, true), "refused after 15 ms").toBe(false);
    expect(late.hitSpeedValue).toBe(10);
  });

  it("when a car's solver state is restored into another inside that window (a replay's keyframe), then the pair's contact takes the hit over there as it does on the live car (the hit speed is the base's and the new contact's, not all three summed) and every number of the two states is the same after", () => {
    const aslant = new THREE.Vector3(0, 0, -1);
    const squarely = new THREE.Vector3(0, 0.36, 2.06);
    const live = spawn(0, 10).d;
    live.stepStructure(0.35);
    expect(live.rearmHit(squarely, aslant, 12, 12, true), "the wreck's second hit armed after 0.3 s quiet").toBeTruthy();
    live.stepStructure(0.004);
    const state = new Float64Array(live.simSize());
    live.simState(state, false);
    const restored = spawn(0, 10).d;
    restored.simState(state, true);
    expect(live.rearmHit(squarely, aslant, 14, 14, true), "taken over on the live car").toBeTruthy();
    expect(restored.rearmHit(squarely, aslant, 14, 14, true), "taken over on the restored one").toBeTruthy();
    expect(Math.abs(live.hitSpeedValue - Math.sqrt(10 * 10 + 14 * 14)), `live hit speed ${live.hitSpeedValue}`).toBeLessThan(1e-9);
    expect(restored.hitSpeedValue, "hit speed").toBe(live.hitSpeedValue);
    for (const field of ["armedAt", "armedEbs", "armedEnd", "armedEnd2", "armedWear"] as const) expect(restored[field], field).toBe(live[field]);
    const after = (d: StreamedDeformation): Float64Array => {
      const out = new Float64Array(d.simSize());
      d.simState(out, false);
      return out;
    };
    assertSameNumbers(after(restored), after(live), "the sim state after the take-over");
  });
});

forModes("given a car meeting a wall at 20 m/s or more for the first time, where a bad contact solver could fling it off the map", (spawn, mode) => {
  it("when a wall overlaps it by 25 cm for ten 1/60 s steps at 20 m/s head-on, then every body particle stays finite, under the maximum particle speed and within 8 m sideways, 12 m along and 4 m up, and the car as a whole stays within 6 m and under that speed", () => {
    const s = spawn(0, 20);
    for (let i = 0; i < 10; i++) stepWall(s, DT, 0.25);
    for (const m of s.d.masses) {
      expect(Number.isFinite(m.world.x + m.vel.x), `${m.name} went NaN [${mode}]`).toBeTruthy();
      expect(m.vel.length(), `${m.name} vel ${m.vel.length().toFixed(1)} [${mode}]`).toBeLessThan(CRASH.maxMassMps + 0.1);
      expect(Math.abs(m.world.x) < 8 && Math.abs(m.world.z) < 12 && m.world.y < 4, `${m.name} at ${m.world.x.toFixed(1)},${m.world.y.toFixed(1)},${m.world.z.toFixed(1)}`).toBeTruthy();
    }
    expect(s.group.position.length(), `group flew to ${s.group.position.toArray()} [${mode}]`).toBeLessThan(6);
    expect(s.vel.length(), `group vel ${s.vel.length()} [${mode}]`).toBeLessThan(CRASH.maxMassMps + 0.1);
  });

  it("when the wall hits it 0.7 m off centre at 22 m/s with a 30 cm overlap for twelve steps, then its passenger cell (the stiff middle of the car) stays within 10 m of the start and under the maximum particle speed", () => {
    const s = spawn(0.7, 22);
    for (let i = 0; i < 12; i++) stepWall(s, DT, 0.3, mass(s.d, "bumperFR").world.x);
    const cell = mass(s.d, "cell");
    expect(cell.world.length(), `cell ${cell.world.toArray()} [${mode}]`).toBeLessThan(10);
    expect(cell.vel.length()).toBeLessThan(CRASH.maxMassMps + 0.1);
  });
});

forModes("given a car driving straight into a rigid wall at about 50 km/h (14 m/s)", (spawn, mode) => {
  it("when the impact pulse plays out over 12 steps, then the nose crushes in gradually, not all at once (shape mode: it moves over 4 cm; lattice mode: it is folding by 50 ms, keeps growing, never springs back and ends between 12 cm and the 14 m/s barrier crush distance)", () => {
    const s = spawn(0);
    const samples: number[] = [];
    for (let i = 0; i < 12; i++) {
      stepWall(s, DT, 0.1);
      samples.push((-alongZ(s.d, "bumperFL") + -alongZ(s.d, "bumperFR")) * 0.5);
    }
    if (mode === "shape") {
      const moved = (travel(s.d, "bumperFL") + travel(s.d, "bumperFR")) * 0.5;
      expect(moved, `shape nose never moved ${moved}`).toBeGreaterThan(0.04);
    } else {
      expect(samples[2]!, "should have started folding by ~50ms").toBeGreaterThan(0.02);
      expect(samples[2]!, "crush should grow across the pulse, not pop").toBeGreaterThan(samples[0]!);
      // B1: a 14 m/s hit crushes to its equivalent-barrier stroke, then holds — no spring-back.
      expect(samples[11]!, `nose sprang back: ${samples[2]} → ${samples[11]}`).toBeGreaterThanOrEqual(samples[2]! - 0.01);
      expect(samples[11]!, `nose crush too small: ${samples[11]}`).toBeGreaterThan(0.12);
      expect(samples[11]!, `crush past the 14 m/s stroke: ${samples[11]}`).toBeLessThanOrEqual(crushStroke(FRONTAL_MPS, 0.4) + 0.01);
    }
  });

  it("when the wall crushes the nose for 24 steps, then the rear bumper is not pushed out backward by more than 16 cm nor sucked forward by more than 20 cm", () => {
    const s = spawn(0);
    for (let i = 0; i < 24; i++) stepWall(s, DT, 0.1);
    const rear = (alongZ(s.d, "bumperRL") + alongZ(s.d, "bumperRR")) * 0.5;
    expect(rear, `rear extruded backward by ${-rear}m`).toBeGreaterThan(-0.16);
    expect(rear, `rear sucked forward by ${rear}m`).toBeLessThan(0.2);
  });

  it("when 3 steps (50 ms) of the impact have passed, then the rear axle is still moving at least 1.5 m/s faster than the bumpers and above 35 % of the impact speed, so the rear keeps piling into the stopped nose", () => {
    const s = spawn(0, FRONTAL_MPS);
    for (let i = 0; i < 3; i++) stepWall(s, DT, 0.12);
    const rear = mass(s.d, "axleR").vel.z;
    const nose = (mass(s.d, "bumperFL").vel.z + mass(s.d, "bumperFR").vel.z) * 0.5;
    expect(rear, `rear ${rear.toFixed(2)} should still be piling into nose ${nose.toFixed(2)}`).toBeGreaterThan(nose + 1.5);
    expect(rear, `rear lost all speed too fast: ${rear}`).toBeGreaterThan(FRONTAL_MPS * 0.35);
  });

  it("when the wall crushes the front for 18 steps, then the bumper crushes most, the frame rail less than the bumper but at least 40 % as far as the passenger cell (the stiff middle of the car), and the cell less than the bumper (shape mode: the bumper moves over 4 cm and the cell at most 8 cm more than it)", () => {
    const s = spawn(0);
    for (let i = 0; i < 18; i++) stepWall(s, DT, 0.1);
    const nose = travel(s.d, "bumperFL");
    const rail = travel(s.d, "railL");
    const cell = travel(s.d, "cell");
    if (mode === "shape") {
      expect(nose, `shape bumper never crushed ${nose}`).toBeGreaterThan(0.04);
      expect(cell, "passenger cell collapsed more than the bumper").toBeLessThanOrEqual(nose + 0.08);
    } else {
      expect(nose, `bumper ${nose} should crush more than rail ${rail}`).toBeGreaterThan(rail);
      expect(rail, `rails disconnected from crush (rail ${rail}, cell ${cell})`).toBeGreaterThanOrEqual(cell * 0.4);
      expect(cell, "passenger cell should not collapse as much as the bumper").toBeLessThan(nose);
    }
  });

  it("when the wall crush plays out over 30 steps, then the car stays on the road instead of lofting: the body ends under 22 cm up, the cabin never climbs past 1.15 m and ends falling slower than 8 m/s", () => {
    const s = spawn(0);
    let maxY = 0;
    for (let i = 0; i < 30; i++) {
      stepWall(s, DT, 0.12);
      maxY = Math.max(maxY, s.group.position.y, mass(s.d, "cell").world.y);
    }
    expect(s.group.position.y, `group lofted to ${s.group.position.y.toFixed(3)}`).toBeLessThan(0.22);
    expect(maxY, `cabin world.y climbed to ${maxY.toFixed(3)}`).toBeLessThan(1.15);
    expect(mass(s.d, "cell").vel.y, `cell slammed down at ${mass(s.d, "cell").vel.y.toFixed(2)}`).toBeGreaterThan(-8);
  });

  it("when it has not been crushed yet, then its whole crumple zone is still left (over 1.2 m of remaining crush travel) and the leftover-crumple share reads 1, not 0", () => {
    const { d } = spawn(0);
    const travelLeft = d.crumpleTravel();
    expect(travelLeft, `rest crumpleTravel ${travelLeft} looks like already-crushed`).toBeGreaterThan(1.2);
    expect(leftoverCrumple(travelLeft)).toBe(1);
  });

  it("when it closes on the wall at the graze speed (a scrape, not a crash) for 10 steps, then the crush stays under 35 cm instead of being treated as a crash (shape mode: the car does not lift above 22 cm)", () => {
    const s = spawn(0, CRASH.grazeMps);
    for (let i = 0; i < 10; i++) stepWall(s, DT, 0.02);
    const crush = -alongZ(s.d, "bumperFL");
    if (mode === "shape") {
      expect(s.group.position.y, `graze lofted to ${s.group.position.y}`).toBeLessThan(0.22);
    } else {
      expect(crush, `graze crushed ${crush}m — treated as a crash`).toBeLessThan(0.35);
    }
  });

  it("when one car's squash slider (how soft the body is) is 0.9 and an identical car's is 0.2 over the same 14-step pulse, then the 0.9 car's bumper crushes at least 12 % more", () => {
    const lo = spawn(0);
    lo.d.squash = 0.2;
    const hi = spawn(0);
    hi.d.squash = 0.9;
    for (let i = 0; i < 14; i++) {
      stepWall(lo, DT, 0.1);
      stepWall(hi, DT, 0.1);
    }
    const a = -alongZ(lo.d, "bumperFL");
    const b = -alongZ(hi.d, "bumperFL");
    expect(b, `squash 0.9 crushed ${b.toFixed(3)} vs 0.2 → ${a.toFixed(3)}`).toBeGreaterThan(a * 1.12);
  });
});

forModes("given a car whose front corner hits a rigid wall 0.62 m off the centreline", (spawn, mode) => {
  it("when the right-front corner takes the hit for 20 steps, then it crushes more than the left-front corner (lattice mode: over 1.25 times as far and over 8 cm; shape mode: at least 90 % as far, or over 4 cm)", () => {
    const s = spawn(0.62);
    for (let i = 0; i < 20; i++) stepWall(s, DT, 0.12, mass(s.d, "bumperFR").world.x);
    const right = -alongZ(s.d, "bumperFR");
    const left = -alongZ(s.d, "bumperFL");
    if (mode === "shape") {
      const rMove = travel(s.d, "bumperFR");
      const lMove = travel(s.d, "bumperFL");
      expect(rMove >= lMove * 0.9 || rMove > 0.04, `expected right-front to move more, R=${rMove.toFixed(3)} L=${lMove.toFixed(3)}`).toBeTruthy();
    } else {
      expect(right > left * 1.25 && right > 0.08, `expected right-front crush, got R=${right.toFixed(3)} L=${left.toFixed(3)}`).toBeTruthy();
    }
  });

  it("when the right-front corner takes the hit for 22 steps, then the hit corner tucks in but the nose does not fold over itself: the right-front bumper stays more than 0.7 m to the right of the left-front one", () => {
    const s = spawn(0.62);
    for (let i = 0; i < 22; i++) stepWall(s, DT, 0.12, mass(s.d, "bumperFR").world.x);
    const r = mass(s.d, "bumperFR").local.x;
    const l = mass(s.d, "bumperFL").local.x;
    expect(r, `no banana: FL.x=${l.toFixed(3)} FR.x=${r.toFixed(3)}`).toBeGreaterThan(l + 0.7);
  });

  it("when the left-front corner takes the hit for 20 steps, then it crushes more than the right-front corner, not the other way round (lattice mode: over 1.2 times as far; shape mode: at least 90 % as far)", () => {
    const s = spawn(-0.62);
    for (let i = 0; i < 20; i++) stepWall(s, DT, 0.12, mass(s.d, "bumperFL").world.x);
    const left = -alongZ(s.d, "bumperFL");
    const right = -alongZ(s.d, "bumperFR");
    if (mode === "shape") {
      const lMove = travel(s.d, "bumperFL");
      const rMove = travel(s.d, "bumperFR");
      expect(lMove, `inverted: L=${lMove.toFixed(3)} R=${rMove.toFixed(3)}`).toBeGreaterThanOrEqual(rMove * 0.9);
    } else {
      expect(left, `inverted: L=${left.toFixed(3)} R=${right.toFixed(3)}`).toBeGreaterThan(right * 1.2);
    }
  });

  it("when the right-front corner takes the hit for 18 steps, then the left-front corner takes under 40 % of the struck corner's crush in lattice mode (shape mode: no more than 5 % above it)", () => {
    const s = spawn(0.62);
    for (let i = 0; i < 18; i++) stepWall(s, DT, 0.12, mass(s.d, "bumperFR").world.x);
    const hit = -alongZ(s.d, "bumperFR");
    const opp = -alongZ(s.d, "bumperFL");
    if (mode === "shape") {
      const hitM = travel(s.d, "bumperFR");
      const oppM = travel(s.d, "bumperFL");
      expect(hitM).toBeGreaterThan(0.03);
      expect(oppM, `opposite leaked ${oppM.toFixed(3)} vs hit ${hitM.toFixed(3)}`).toBeLessThanOrEqual(hitM * 1.05);
    } else {
      expect(hit).toBeGreaterThan(0.05);
      expect(opp, `opposite leaked ${opp.toFixed(3)} vs hit ${hit.toFixed(3)} — 0.22 floor on impactWeight?`).toBeLessThan(hit * 0.4);
    }
  });
});

forModes("given a car receiving an impulse (a sudden change of momentum) from a wall or another car", (spawn) => {
  it("when two mirror-image cars, one driving each way at 12 m/s, each take a 600 N·s impulse against their motion, then their momentum changes are equal and opposite (within 8 N·s), each over 200 N·s", () => {
    const a = spawn(0, 12);
    const b = spawn(0, 12);
    for (const m of b.d.masses) {
      m.vel.z *= -1;
      m.world.z *= -1;
    }
    b.vel.z = -12;
    const pA0 = momentumZ(a.d);
    const pB0 = momentumZ(b.d);
    const j = 600;
    a.d.applyImpulse(0, 0, -1, j);
    b.d.applyImpulse(0, 0, 1, j);
    const dA = momentumZ(a.d) - pA0;
    const dB = momentumZ(b.d) - pB0;
    expect(Math.abs(dA + dB), `ΔP not opposite: ${dA} vs ${dB}`).toBeLessThan(8);
    expect(dA < -200 && dB > 200, `impulse signs wrong dA=${dA} dB=${dB}`).toBeTruthy();
  });

  it("when an 800 N·s impulse hits the front, then the bumper's speed drops at least 0.4 m/s more than the passenger cell's (the stiff middle of the car), so the impulse lands on the crumple face and the cabin keeps coming", () => {
    const s = spawn(0, 14);
    const bumper0 = mass(s.d, "bumperFL").vel.z;
    const cell0 = mass(s.d, "cell").vel.z;
    s.d.applyImpulse(0, 0, -1, 800);
    const dBumper = mass(s.d, "bumperFL").vel.z - bumper0;
    const dCell = mass(s.d, "cell").vel.z - cell0;
    expect(dBumper, `cabin took the hit (bumper Δv ${dBumper.toFixed(3)}, cell ${dCell.toFixed(3)})`).toBeLessThan(dCell - 0.4);
  });

  it("when a zero impulse is applied, and then (after a reset, before any new crash starts) a 900 N·s impulse is applied, then neither changes the bumper's speed", () => {
    const s = spawn(0, 10);
    const z0 = mass(s.d, "bumperFL").vel.z;
    s.d.applyImpulse(0, 0, -1, 0);
    expect(mass(s.d, "bumperFL").vel.z).toBe(z0);
    s.d.reset();
    mass(s.d, "bumperFL").vel.z = 10;
    s.d.applyImpulse(0, 0, -1, 900);
    expect(mass(s.d, "bumperFL").vel.z, "impulse applied while massActive=false").toBe(10);
  });

  it("when a 700 N·s impulse is applied along a horizontal wall normal (the direction the wall pushes), then it adds no vertical momentum to the car (below 0.000001)", () => {
    const s = spawn(0, 14);
    const y0 = s.d.masses.reduce((sum, m) => sum + m.vel.y * m.mass, 0);
    s.d.applyImpulse(0, 0, -1, 700);
    const y1 = s.d.masses.reduce((sum, m) => sum + m.vel.y * m.mass, 0);
    expect(Math.abs(y1 - y0), `planar impulse leaked ΔPy=${y1 - y0}`).toBeLessThan(1e-6);
  });

  it("when a 500 N·s impulse is applied along the axis, then the car's total momentum changes by exactly that amount (within 0.001 N·s), however the impulse is shared between its parts", () => {
    const s = spawn(0, 14);
    const p0 = momentumZ(s.d);
    const j = 500;
    s.d.applyImpulse(0, 0, -1, j);
    const dp = momentumZ(s.d) - p0;
    expect(Math.abs(dp + j), `ΔP ${dp} vs -j ${-j} — weights not unit-sum`).toBeLessThan(1e-3);
  });
});

// A 25 m/s hit: its energy reaches far past ENGINE_KILL_TRAVEL, so the counted travel is the block's own
// (updateDrivetrain caps a nose hit's travel at what its energy-equivalent stroke reaches).
forModes("given a car whose drivetrain (engine and driven wheels) is working", (spawn) => {
  it("when a 25 m/s wall hit has pushed the engine block back past the distance that kills it (forced 5 cm past it if the crash fell short), then the drivetrain is dead", () => {
    const s = spawn(0, 25);
    expect(s.d.drivetrainAlive).toBe(true);
    for (let i = 0; i < 24; i++) stepWall(s, DT, 0.14);
    const eng = Math.max(travel(s.d, "engineL"), travel(s.d, "engineR"));
    if (eng > ENGINE_KILL_TRAVEL) {
      expect(s.d.drivetrainAlive).toBe(false);
    } else {
      mass(s.d, "engineL").local.z -= ENGINE_KILL_TRAVEL + 0.05;
      s.d.updateDrivetrain();
      expect(s.d.drivetrainAlive).toBe(false);
    }
  });

  it("when the drivetrain is dead and the drive is cut for 0.05 s, then the wheel hubs slow down but the passenger cell (the stiff middle of the car) keeps its forward speed exactly", () => {
    const s = spawn(0, 14);
    s.d.drivetrainAlive = false;
    const cell0 = mass(s.d, "cell").vel.z;
    const hub0 = mass(s.d, "hubFL").vel.z;
    s.d.cutDrive(0.05);
    expect(mass(s.d, "cell").vel.z).toBe(cell0);
    expect(mass(s.d, "hubFL").vel.z, "hubs should lose driven traction").toBeLessThan(hub0);
  });

  it("when the drive is cut for 0.05 s while the drivetrain is still alive, then the wheel hubs keep their speed", () => {
    const s = spawn(0, 14);
    expect(s.d.drivetrainAlive).toBe(true);
    const hub0 = mass(s.d, "hubFL").vel.z;
    s.d.cutDrive(0.05);
    expect(mass(s.d, "hubFL").vel.z).toBe(hub0);
  });

  it("when the engine block is pushed back 1 cm short of the distance that kills it and then 1 cm past it, then the drivetrain is still alive at first and dead after", () => {
    const s = spawn(0, 25);
    const eng = mass(s.d, "engineL");
    eng.local.copy(eng.rest);
    eng.local.z -= ENGINE_KILL_TRAVEL - 0.01;
    s.d.updateDrivetrain();
    expect(s.d.drivetrainAlive, `${(ENGINE_KILL_TRAVEL - 0.01).toFixed(3)} m is not yet wrecked`).toBe(true);
    eng.local.z = eng.rest.z - (ENGINE_KILL_TRAVEL + 0.01);
    s.d.updateDrivetrain();
    expect(s.d.drivetrainAlive).toBe(false);
  });

  // CrushCalibration's seed-7 derby: live cars ran with the block 0.25 m back, because a side- or
  // rear-classed later hit made updateDrivetrain return early or measure the other way.
  it("when an earlier nose hit pushed the engine block back 3 cm past the distance that kills it and the latest hit comes from the side or from behind, then the drivetrain is still dead and its health is 0", () => {
    for (const inward of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
      const s = spawn(0);
      const eng = mass(s.d, "engineL");
      eng.local.z = eng.rest.z - (ENGINE_KILL_TRAVEL + 0.03);
      s.d.impactInward.copy(inward);
      s.d.updateDrivetrain();
      expect(s.d.drivetrainAlive, `block ${(ENGINE_KILL_TRAVEL + 0.03).toFixed(2)} m back survived a hit along ${inward.toArray().join(",")}`).toBe(false);
      expect(s.d.drivetrainHealth).toBe(0);
    }
  });

  it("when both engine mounts are stretched 0.35 m forward of their rest position while the passenger cell is at rest, then the drivetrain is still alive, because a forward stretch is not a crushed engine block", () => {
    const s = spawn(0);
    for (const name of ["engineL", "engineR"]) {
      const eng = mass(s.d, name);
      eng.local.copy(eng.rest);
      eng.local.z += 0.35;
    }
    s.d.updateDrivetrain();
    expect(s.d.drivetrainAlive, "forward stretch is not a dead block").toBe(true);
  });
});

describe("given a car whose body is a lattice of spring beams, in lattice deform mode", () => {
  it("when the unbroken beams are followed outward from the passenger cell (the stiff middle of the car), then every body particle of the car is reached, so none is cut off", () => {
    const { d } = spawn(0, FRONTAL_MPS, new THREE.Vector3(0, 0, -1), undefined, "lattice");
    const snap = d.snapshot() as { beams: { a: string; b: string; alive: boolean }[] };
    const adj = new Map<string, string[]>();
    for (const m of d.masses) adj.set(m.name, []);
    for (const b of snap.beams) {
      if (!b.alive) continue;
      adj.get(b.a)!.push(b.b);
      adj.get(b.b)!.push(b.a);
    }
    const seen = new Set<string>(["cell"]);
    const q = ["cell"];
    while (q.length) {
      const n = q.pop()!;
      for (const k of adj.get(n) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        q.push(k);
      }
    }
    expect(seen.size, `disconnected: ${d.masses.map((m) => m.name).filter((n) => !seen.has(n))}`).toBe(d.masses.length);
  });

  it("when the engine block is pushed 12 cm back toward the cabin and one physics step runs, then the squeezed beams push it forward again (its forward speed rises)", () => {
    const s = spawn(0, FRONTAL_MPS, new THREE.Vector3(0, 0, -1), undefined, "lattice");
    const a = mass(s.d, "engineL");
    const b = mass(s.d, "railL");
    const rest = a.world.distanceTo(b.world);
    a.world.z -= 0.12;
    const vz0 = a.vel.z;
    s.d.stepStructure(DT);
    expect(a.vel.z, `no restoring spring (vz ${a.vel.z} vs ${vz0}), rest was ${rest}`).toBeGreaterThan(vz0);
  });

  it("when the squeezed engine block is already separating from its neighbouring rail (its own speed set to 2 m/s), then the beams still push on it: after one physics step its speed has changed and stays above half of 2 m/s", () => {
    const s = spawn(0, FRONTAL_MPS, new THREE.Vector3(0, 0, -1), undefined, "lattice");
    const a = mass(s.d, "engineL");
    mass(s.d, "railL");
    a.world.z -= 0.12;
    a.vel.z = 2;
    const vz0 = a.vel.z;
    s.d.stepStructure(DT);
    expect(a.vel.z, "separating compressed beam went slack").toBeGreaterThan(vz0 * 0.5);
    expect(a.vel.z, "no force at all while separating").not.toBe(vz0);
  });
});

forModes("given a car set up for a head-on crash into a wall", (spawn, mode) => {
  it("when the wall crushes the nose for 20 steps, then the rear bumper does not crumple: it moves less than 18 cm (28 cm in shape mode) and, in lattice mode, its bar keeps its rest length within 2 cm", () => {
    const s = spawn(0);
    for (let i = 0; i < 20; i++) stepWall(s, DT, 0.12);
    const rearTravel = (travel(s.d, "bumperRL") + travel(s.d, "bumperRR")) * 0.5;
    expect(rearTravel, `rear crumpled ${rearTravel.toFixed(3)} [${mode}]`).toBeLessThan((mode === "shape" ? 0.28 : 0.18));
    if (mode === "lattice") {
      const snap = s.d.snapshot() as { beams: { a: string; b: string; rest: number; plastic: number }[] };
      const rear = snap.beams.find((b) => b.a === "bumperRL" && b.b === "bumperRR");
      expect(rear).toBeTruthy();
      expect(Math.abs(rear!.plastic - rear!.rest), `rear bar plastic ${rear!.plastic} vs rest ${rear!.rest}`).toBeLessThan(0.02);
    }
  });

  it("when the front-left bumper is pressed 18 cm back from rest and three physics steps run (the spring's speed builds over the first two and moves it from the second), then it springs back toward rest in the body's frame (lattice mode: by at least 4 mm; shape mode: without overshooting rest by 20 cm)", () => {
    const s = spawn(0);
    const a = mass(s.d, "bumperFL");
    const z0 = a.local.z;
    a.world.z -= 0.18;
    a.vel.z = s.vel.z;
    stepWreck(s, DT);
    stepWreck(s, DT);
    stepWreck(s, DT);
    if (mode === "shape") {
      // Plastic shape-matching holds the dent; it must not explode outward past rest.
      expect(a.local.z, `shape exploded past rest ${a.local.z} vs ${z0}`).toBeLessThan(z0 + 0.2);
    } else {
      expect(a.local.z, `no restore [${mode}] z ${a.local.z} from ${z0 - 0.18}`).toBeGreaterThan(z0 - 0.18 + 0.004);
    }
  });
});

forModes("given a car and kickNearestHub (the call that hops only the wheel hub nearest a point, not the whole car)", (spawn) => {
  it("when the point is on the front-left hub and the upward kick strength is 26, then that hub is kicked up (its name is returned and it rises faster than 0.8 m/s) while the front-right hub and the passenger cell do not move", () => {
    const s = spawn(0);
    const p = mass(s.d, "hubFL").world.clone();
    const name = s.d.kickNearestHub(p, 26);
    expect(name).toBe("hubFL");
    expect(mass(s.d, "hubFL").vel.y).toBeGreaterThan(0.8);
    expect(Math.abs(mass(s.d, "hubFR").vel.y)).toBeLessThan(1e-6);
    expect(Math.abs(mass(s.d, "cell").vel.y)).toBeLessThan(1e-6);
  });

  it("when the point is on the engine block and the kick strength is 26, then a wheel hub is still kicked (the returned name starts with hub), never the engine", () => {
    const s = spawn(0);
    const name = s.d.kickNearestHub(mass(s.d, "engineL").world.clone(), 26);
    expect(name && name.startsWith("hub"), `kicked ${name}`).toBeTruthy();
  });

  it("when the kick strength is 0, then it returns null and the hub's vertical speed does not change", () => {
    const s = spawn(0);
    const y0 = mass(s.d, "hubFL").vel.y;
    expect(s.d.kickNearestHub(mass(s.d, "hubFL").world.clone(), 0)).toBe(null);
    expect(mass(s.d, "hubFL").vel.y).toBe(y0);
  });

  it("when the point is on the engine block, which is closer than any hub, and the kick strength is 52, then exactly one wheel hub is kicked up and the engine block itself is not", () => {
    const s = spawn(0);
    // Place the query at engineL; engine is closer than any hub in Euclidean 3D,
    // but the API is hubs-only.
    const eng = mass(s.d, "engineL").world.clone();
    s.d.kickNearestHub(eng, 52);
    expect(Math.abs(mass(s.d, "engineL").vel.y), "engine got the hub kick").toBeLessThan(1e-6);
    const hubs = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;
    const kicked = hubs.filter((h) => mass(s.d, h).vel.y > 0.1);
    expect(kicked.length, `kicked ${kicked.join(",")}`).toBe(1);
  });
});

forModes("given a car whose right-front corner is crushed against a wall 0.62 m off the centreline", (spawn) => {
  it("when the right-front corner is crushed for 18 steps, then the right-front wing's damage sensor reads over twice the left-front wing's", () => {
    const s = spawn(0.62);
    for (let i = 0; i < 18; i++) stepWall(s, DT, 0.12, mass(s.d, "bumperFR").world.x);
    expect(s.d.sensorCompression(5), "wingFR sensor should dominate wingFL").toBeGreaterThan(s.d.sensorCompression(4) * 2);
  });

  it("when the right-front corner is crushed for 18 steps, then the front bumper as a whole reads crushed (over 0.05) while the right bumper sensor reads over 1.5 times the left one's, so a corner nick does not break both headlamps", () => {
    const s = spawn(0.62);
    for (let i = 0; i < 18; i++) stepWall(s, DT, 0.12, mass(s.d, "bumperFR").world.x);
    const shared = s.d.partCompression("bumperFront");
    const leftBumper = s.d.sensorCompression(1);
    const rightBumper = s.d.sensorCompression(2);
    expect(shared, "front bumper did crush").toBeGreaterThan(0.05);
    expect(rightBumper, `left bumper sensor ${leftBumper} rode the shared part (${shared})`).toBeGreaterThan(leftBumper * 1.5);
  });

  it("when the right-front corner is crushed for 16 steps, then the left headlamp's own corner sensor stays at a graze (under 0.25, or under half the right one's) whatever the centre bumper sensor reads", () => {
    const s = spawn(0.62);
    for (let i = 0; i < 16; i++) stepWall(s, DT, 0.14, mass(s.d, "bumperFR").world.x);
    // Right-hit: sensor 0 (center) may be mid, sensor 1 (left) must stay a graze.
    expect(s.d.sensorCompression(1) < 0.25 || s.d.sensorCompression(1) < s.d.sensorCompression(2) * 0.5).toBeTruthy();
  });
});

forModes("given a car hit from behind at 14 m/s", (spawn) => {
  it("when the rear is crushed for 16 steps, then the tail's bumpers move more than 4 cm further than the nose's", () => {
    const s = spawn(0, -14, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.36, -2.06));
    const n = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 16; i++) {
      s.vel.z = -14;
      stepWall(s, DT, 0.12, 0, n);
    }
    const tail = (travel(s.d, "bumperRL") + travel(s.d, "bumperRR")) * 0.5;
    const nose = (travel(s.d, "bumperFL") + travel(s.d, "bumperFR")) * 0.5;
    expect(tail, `rear hit crushed nose ${nose.toFixed(3)} more than tail ${tail.toFixed(3)}`).toBeGreaterThan(nose + 0.04);
  });
});

forModes("given a car whose right side is pushed in at 10 m/s", (spawn) => {
  it("when the side is pushed in for 14 steps, then the right door and right-front wing crush further than the left ones (lattice mode: by over 5 %; shape mode: the right side moves over 6 cm)", () => {
    const s = spawn(0.7, 10, new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0.78, 0.5, 0.08));
    const n = new THREE.Vector3(-1, 0, 0);
    s.vel.set(10, 0, 0);
    for (let i = 0; i < 14; i++) {
      s.vel.x = 10;
      stepWreck(s, DT, () => {
        const door = mass(s.d, "doorR").world;
        s.d.notifyContact();
        s.d.feedOverlap(door, n, 0.1, 10, DT);
        s.d.applyImpulse(n.x, 0, n.z, 80);
      });
      s.d.stepCrush(DT);
      s.d.update(s.geom);
    }
    const L = travel(s.d, "doorL") + travel(s.d, "wingFL");
    const R = travel(s.d, "doorR") + travel(s.d, "wingFR");
    if (s.d.mode === "shape") {
      expect(R, `right side never moved R=${R.toFixed(3)}`).toBeGreaterThan(0.06);
    } else {
      expect(R, `side hit not local L=${L.toFixed(3)} R=${R.toFixed(3)}`).toBeGreaterThan(L * 1.05);
    }
  });
});

forModes("given a car struck at its nose or its tail", (spawn) => {
  it("when a 600 N·s frontal impulse is applied, then the bumper's speed changes by more than twice as much as the door's, so the doors do not absorb the hit like a second bumper", () => {
    const s = spawn(0, 14);
    const door0 = mass(s.d, "doorL").vel.z;
    const bump0 = mass(s.d, "bumperFL").vel.z;
    s.d.applyImpulse(0, 0, -1, 600);
    const dDoor = Math.abs(mass(s.d, "doorL").vel.z - door0);
    const dBump = Math.abs(mass(s.d, "bumperFL").vel.z - bump0);
    expect(dBump, `doors ate the frontal impulse (door ${dDoor.toFixed(3)} bumper ${dBump.toFixed(3)})`).toBeGreaterThan(dDoor * 2);
  });

  // A frontal hit's far end is the tail: its bumpers are not the facing crumple zone, so a push along the struck line
  // (`separateAlong`, a pair's or a wall's shove) carries them with the cabin. Weighted as a second face they took
  // 12 % of every push and pumped ~730 J of internal kinetic energy into a pinned wreck (derby wreck residue).
  for (const [end, nz, far] of [
    ["nose", -1, ["bumperRL", "bumperRR"]],
    ["tail", 1, ["bumperFL", "bumperFR"]],
  ] as const) {
    it(`when a push along the line of a ${end} hit moves the cabin, then the bumpers at the far end move with it by the same distance and speed, as one rigid body`, () => {
      const s = spawn(0, 14, new THREE.Vector3(0, 0, nz), new THREE.Vector3(0, 0.36, -nz * 2.06));
      const cell = mass(s.d, "cell");
      const cell0 = { z: cell.world.z, v: cell.vel.z };
      const was = far.map((n) => ({ z: mass(s.d, n).world.z, v: mass(s.d, n).vel.z }));
      s.d.separateAlong(0, 0, nz, 0.02, 2);
      for (const [i, n] of far.entries()) {
        const m = mass(s.d, n);
        expect(Math.abs(m.world.z - was[i]!.z - (cell.world.z - cell0.z)), `${n} moved ${((m.world.z - was[i]!.z) * 1000).toFixed(2)} mm, cabin ${((cell.world.z - cell0.z) * 1000).toFixed(2)} mm`).toBeLessThan(1e-9);
        expect(Math.abs(m.vel.z - was[i]!.v - (cell.vel.z - cell0.v)), `${n} dv ${(m.vel.z - was[i]!.v).toFixed(3)} m/s, cabin ${(cell.vel.z - cell0.v).toFixed(3)} m/s`).toBeLessThan(1e-9);
      }
    });
  }
});

forModes("given a car set up for a wall crash", (spawn) => {
  it("when 0.4 s of simulation pass and then a contact is reported, then its quiet time (seconds since it was last touched) is 0 at the start, 0.4 s after the wait and 0 again right after the touch", () => {
    const s = spawn(0);
    expect(s.d.quietTime()).toBe(0);
    s.d.stepStructure(0.4);
    expect(Math.abs(s.d.quietTime() - 0.4)).toBeLessThan(1e-6);
    s.d.notifyContact();
    expect(s.d.quietTime()).toBe(0);
  });
});

forModes("given a car that has never been crashed (its body simulation is idle)", (spawn, mode) => {
  // A car whose masses are idle has no contact window: `elapsed` stands still, so a touch marked then (a wall, a prop or a ramp's
  // flank below a crash) read "just touched" for good, and no keyframe carries it for a car that is no wreck (engine-replay seed 30
  // with the far-end bumper weight: the replay's bystander was quiet, the live one not, a wreck's masses met it live and not replayed).
  it("when a wall touches it, then its body simulation stays idle and its quiet time (seconds since it was last touched) stays what it was for a car never touched, over 1 s", () => {
    const d = new StreamedDeformation(dummyGeom());
    d.mode = mode;
    const untouched = d.quietTime();
    d.notifyContact();
    expect(d.massActive).toBe(false);
    expect(d.quietTime(), `an idle car touched reads ${d.quietTime()} s quiet, untouched ${untouched} s`).toBe(untouched);
    expect(d.quietTime(), `an idle car is not in a contact window: ${d.quietTime()} s`).toBeGreaterThan(1);
  });
});

forModes("given a car that has been crushed against a wall for 12 steps", (spawn) => {
  it("when it is reset, then it is back at rest: drivetrain alive, body simulation idle, front-left bumper at its rest position, sensor 0 uncompressed and the crush clock at 0", () => {
    const s = spawn(0);
    for (let i = 0; i < 12; i++) stepWall(s, DT, 0.12);
    s.d.reset();
    expect(s.d.drivetrainAlive).toBe(true);
    expect(s.d.massActive).toBe(false);
    expect(travel(s.d, "bumperFL")).toBe(0);
    expect(s.d.sensorCompression(0), "sensor 0 compression after the reset").toBeCloseTo(0, 10);
    expect(s.d.crushElapsed).toBe(0);
  });
});

forModes("given a freshly built car whose body simulation is idle", (spawn, mode) => {
  it("when its body simulation is armed for a speed bump at 8 m/s, then the simulation is on but no crush animation has started, the drivetrain is alive and the impact point is at the centre (within 1 cm)", () => {
    const geom = dummyGeom();
    const d = new StreamedDeformation(geom);
    d.mode = mode;
    const group = new THREE.Group();
    d.armMasses(group, new THREE.Vector3(0, 0, 8), new THREE.Vector3());
    expect(d.massActive).toBe(true);
    expect(d.drivetrainAlive).toBe(true);
    expect(d.crushElapsed).toBe(0);
    expect(Math.abs(d.impactLocal.x)).toBeLessThan(0.01);
  });

  it("when a crash begins with an impulse of 2 and then again with 400, then the stored impulse is raised to the minimum of 4 for the first and capped at 70 for the second", () => {
    const geom = dummyGeom();
    const d = new StreamedDeformation(geom);
    d.mode = mode;
    const group = new THREE.Group();
    d.beginCrush(new THREE.Vector3(0, 0.36, 2.06), new THREE.Vector3(0, 0, -1), 2, 2, group, new THREE.Vector3(), new THREE.Vector3());
    expect(d.impulseValue).toBe(4);
    d.beginCrush(new THREE.Vector3(0, 0.36, 2.06), new THREE.Vector3(0, 0, -1), 400, 400, group, new THREE.Vector3(), new THREE.Vector3());
    expect(d.impulseValue).toBe(70);
  });
});

forModes("given feedOverlap (the call that turns the wall's overlap into crush and returns the closing speed left over)", (spawn, mode) => {
  it("when a car crashing at 14 m/s is fed 8 cm of wall overlap at 14 m/s closing speed, then the leftover closing speed is between 0 and 14 m/s and below 14, because the crush absorbs some", () => {
    const s = spawn(0, 14);
    const remain = s.d.feedOverlap(mass(s.d, "bumperFL").world, new THREE.Vector3(0, 0, -1), 0.08, 14, DT);
    expect(remain >= 0 && remain <= 14).toBeTruthy();
    expect(remain, "should absorb some closing").toBeLessThan(14);
  });

  it("when a car with no crash set up is fed 20 m/s of closing speed, then the call returns the 20 m/s unchanged because nothing is absorbed", () => {
    const geom = dummyGeom();
    const d = new StreamedDeformation(geom);
    d.mode = mode;
    const r = d.feedOverlap(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 1, 20, DT);
    expect(r).toBe(20);
  });

  it("when a car crashing at 14 m/s is fed only 1 cm of overlap, then the bumper moves less than 5 cm: a nibble is not a teleport", () => {
    const s = spawn(0, 14);
    const z0 = mass(s.d, "bumperFL").world.z;
    s.d.feedOverlap(mass(s.d, "bumperFL").world.clone(), new THREE.Vector3(0, 0, -1), 0.01, 14, DT);
    const dz = Math.abs(mass(s.d, "bumperFL").world.z - z0);
    expect(dz, `nibble was a teleport (${dz}m)`).toBeLessThan(0.05);
  });

  it("when one car is fed a 1/60 s step and another car two 1/120 s steps with the same overlap, then the two half steps move the bumper less than 1.7 times as far as the one full step, because feeds scale with time, not with the number of calls", () => {
    const once = spawn(0, 14);
    const z0 = mass(once.d, "bumperFL").world.z;
    once.d.feedOverlap(mass(once.d, "bumperFL").world.clone(), new THREE.Vector3(0, 0, -1), 0.1, 14, DT);
    const d1 = Math.abs(mass(once.d, "bumperFL").world.z - z0);

    const twice = spawn(0, 14);
    const z1 = mass(twice.d, "bumperFL").world.z;
    const p = mass(twice.d, "bumperFL").world.clone();
    twice.d.feedOverlap(p, new THREE.Vector3(0, 0, -1), 0.1, 14, DT / 2);
    twice.d.feedOverlap(mass(twice.d, "bumperFL").world.clone(), new THREE.Vector3(0, 0, -1), 0.1, 14, DT / 2);
    const d2 = Math.abs(mass(twice.d, "bumperFL").world.z - z1);
    expect(d2, `half-dt×2 crushed ${d2.toFixed(4)} vs full ${d1.toFixed(4)} — per-call teleport`).toBeLessThan(d1 * 1.7);
  });
});

forModes("given a car with its total mass, the sum of the masses of all its body particles", (spawn) => {
  it("when the wall crushes it for 10 steps, then its total mass is the lumped sum of its parts (between 600 and 1200 kg, not 1) and the crush does not change it", () => {
    const s = spawn(0);
    const m0 = s.d.totalMass;
    expect(m0 > 600 && m0 < 1200, `sedan mass ${m0}`).toBeTruthy();
    for (let i = 0; i < 10; i++) stepWall(s, DT, 0.1);
    expect(s.d.totalMass).toBe(m0);
  });
});

forModes("given a car whose wheels stay on until a hard enough hit knocks them off", (spawn, mode) => {
  it("when the wall crushes the front for 22 steps at 16 m/s, then every wheel that stays on has moved less than 8 cm and every wheel that pops off has moved at least 0.45 of its radius, so the crush does not drag wheels through the wheel arch", () => {
    const s = spawn(0, 16);
    for (let i = 0; i < 22; i++) stepWall(s, DT, 0.14);
    for (const name of ["hubFL", "hubFR", "hubRL", "hubRR"] as const) {
      const h = mass(s.d, name);
      const xz = Math.hypot(h.local.x - h.rest.x, h.local.z - h.rest.z);
      if (!h.popped) {
        expect(xz, `${name} slid ${xz.toFixed(3)} without popping [${mode}]`).toBeLessThan(0.08);
      } else {
        expect(xz, `${name} popped but barely moved`).toBeGreaterThanOrEqual(h.radius * 0.5 * 0.9);
      }
    }
  });

  // C4: a wheel leaves only when a hard (≥ 54 km/h EBS) off-centre hit crushes its corner onto the tyre.
  const crushCorner = (speed: number, impactX: number, inward = new THREE.Vector3(0, 0, -1)) => {
    const s = spawn(impactX, speed, inward);
    const b = mass(s.d, "bumperFR");
    b.local.z = b.rest.z - 0.34;
    b.world.copy(b.local);
    for (const name of ["hubFL", "hubFR", "hubRL", "hubRR"] as const) {
      const h = mass(s.d, name);
      h.local.z = h.rest.z - 0.2;
      h.world.copy(h.local);
    }
    s.group.updateMatrixWorld();
    stepWreck(s, DT);
    return s;
  };
  const popped = (s: ReturnType<typeof spawn>) => (["hubFL", "hubFR", "hubRL", "hubRR"] as const).filter((n) => mass(s.d, n).popped);

  it("when a 64 km/h hit on the right-front corner has crushed that corner onto the tyre, then only the right-front wheel pops off", () => {
    expect(firstMismatch(popped(crushCorner(64 / 3.6, 0.62)), ["hubFR"])).toBeUndefined();
  });

  it("when the same corner crush happens at 50 km/h, or square on (centred) at 64 km/h, then every wheel stays on", () => {
    expect(popped(crushCorner(50 / 3.6, 0.62)), "50 km/h corner").toHaveLength(0);
    expect(popped(crushCorner(64 / 3.6, 0)), "64 km/h square").toHaveLength(0);
  });

  it("when a deep crush (walls past both wheel midpoints, so the cage may yield) is switched on and the front-left hub is moved 10 cm forward of its rest position, then the wheel stays on and the hub is not pinned back to rest (it stays over 4 cm away)", () => {
    const s = spawn(0);
    s.d.deepCrush = true;
    s.d.bidirectional = true;
    const h = mass(s.d, "hubFL");
    h.local.z = h.rest.z + 0.1;
    h.world.copy(h.local);
    s.d.followGroup(s.group, s.vel, s.omega, DT);
    expect(h.popped).toBe(false);
    expect(Math.abs(h.local.z - h.rest.z), "deepCrush pinned the hub anyway").toBeGreaterThan(0.04);
  });

  // A planted wreck's frame sits on the mean of its hubs, each held at its pin (`rest` + shove) in the car frame while its
  // world position stands wherever the world left it. A hub knocked 0.3 m off its axle stood 0.22 m off its pin in the
  // anchor's read; the hub then popping re-anchored the frame on the other three and jumped the whole wreck by the
  // difference of the means (derby seeds 25/38/61: 0.10-0.20 m in one step; 0.075 m here).
  it("when a wreck that has settled in place for 1 s has its front-left wheel knocked 30 cm off its axle, held there for 0.5 s, and that wheel then pops off, then the frame and every other body particle stay within 1 cm of where they were", () => {
    const s = spawn(0, 0);
    const settle = (n: number) => {
      for (let i = 0; i < n; i++) {
        stepWreck(s, DT);
      }
    };
    settle(60);
    expect(s.d.quietTime(), "not planted").toBeGreaterThan(0.5);
    const fl = mass(s.d, "hubFL");
    fl.world.x -= 0.3;
    settle(30);
    expect(fl.popped).toBe(false);
    const before = s.d.masses.map((m) => m.world.clone());
    const frame = s.group.position.clone();
    s.d.popHub(fl);
    settle(1);
    expect(fl.popped).toBe(true);
    expect(s.group.position.distanceTo(frame), `frame jumped ${s.group.position.distanceTo(frame).toFixed(3)} m at the pop`).toBeLessThan(0.01);
    for (const [i, m] of s.d.masses.entries()) {
      if (m !== fl) expect(m.world.distanceTo(before[i]!), `${m.name} jumped ${m.world.distanceTo(before[i]!).toFixed(3)} m at the pop`).toBeLessThan(0.01);
    }
  });

  it("when a squeezing wall face reaches 10 cm into the tread of the front-left tyre of a standing car, then the hub is shoved back over 9 cm, stays shoved on the next step and the wheel stays on", () => {
    const s = spawn(0, 0);
    s.d.bidirectional = true;
    const h = mass(s.d, "hubFL");
    // A slab square to the car (normal −z) whose near face is 0.1 m inside the tyre (hub z + radius).
    const face = h.world.z + PLATFORM_RIG.tyre.r - 0.1;
    holdOnFace(s.d, h.world.x, face + 0.5, 0.5, 0.06, Math.PI / 2, true);
    stepWreck(s, DT);
    expect(h.local.z - h.rest.z, `hub held at ${(h.local.z - h.rest.z).toFixed(3)} m: the face is inside the tyre`).toBeLessThan(-0.09);
    stepWreck(s, DT);
    expect(h.local.z - h.rest.z, "the pin pulled the hub back into the face").toBeLessThan(-0.09);
    expect(h.popped).toBe(false);
  });

  it("when a wall face shoves a standing car's front-right wheel back more than one wheel diameter, then the wheel tears off, whereas with wheel detaching switched off it stays on and moves at most one wheel diameter", () => {
    const on = spawn(0, 0);
    on.d.shoveHub(mass(on.d, "hubFR"), 0, -(2 * PLATFORM_RIG.tyre.r + 0.01));
    stepWreck(on, DT);
    expect(mass(on.d, "hubFR").popped, "a wheel diameter of shove left the wheel on").toBe(true);
    const held = spawn(0, 0);
    held.d.wheelsDetach = false;
    held.d.shoveHub(mass(held.d, "hubFR"), 0, -1);
    stepWreck(held, DT);
    const hub = mass(held.d, "hubFR");
    expect(hub.popped, "wheelsDetach off still popped the wheel").toBe(false);
    expect(Math.abs(hub.local.z - hub.rest.z), `shoved ${(hub.local.z - hub.rest.z).toFixed(3)} m past a diameter`).toBeLessThanOrEqual(2 * PLATFORM_RIG.tyre.r + 1e-6);
  });

  it("when three wheels have popped off and then the fourth does too, then the drivetrain is still alive with three gone and dead once all four are gone, like a dead engine", () => {
    const s = spawn(0, 0);
    for (const name of ["hubFL", "hubFR", "hubRL"] as const) s.d.popHub(mass(s.d, name));
    stepWreck(s, DT);
    expect(s.d.drivetrainAlive, "three wheels gone already killed it").toBe(true);
    s.d.popHub(mass(s.d, "hubRR"));
    stepWreck(s, DT);
    expect(s.d.drivetrainAlive, "no wheels and still driving").toBe(false);
  });

  it("when frame crushing is switched off (race mode) and a deep crush is requested, then deep crush reads off, and switching frame crushing back on makes the requested deep crush read on", () => {
    const s = spawn(0);
    s.d.frameCrush = false;
    s.d.deepCrush = true;
    expect(s.d.deepCrush).toBe(false);
    s.d.frameCrush = true;
    expect(s.d.deepCrush, "the squeeze was forgotten while the frame was held").toBe(true);
  });
});

// Shape mode only (the game's default): the lattice's beams carry a wheel's speed into the body, which then moves for real.
describe("given a wreck that has just stopped being touched, in shape deform mode", () => {
  // A wheel written back every call keeps a velocity of its own, and contact impulses went on piling onto it with no
  // position to show for them (17–42 m/s against a body at 2 m/s at the plant of derby seed 65's pile). The plant freed
  // the wheels at that speed and the frame, anchored on them, followed 0.08 m a step.
  it("when the wheels carry a stale 30 m/s sideways speed and the car then sits untouched until it settles in place, then each wheel is held within 8 m/s of the body and the frame moves less than 8 m/s's worth (13 cm) per 1/60 s step, so the wheels' stale speed cannot carry the frame off", () => {
    const s = spawn(0, 0, undefined, undefined, "shape");
    const step = () => stepWreck(s, DT);
    for (let i = 0; i < 6; i++) step();
    expect(s.d.quietTime(), "already planted").toBeLessThan(0.2);
    const mean = new Float64Array(4);
    s.d.motion(mean);
    const before = mean[0]!;
    for (const m of s.d.masses) if (m.hub) m.vel.x = 30;
    s.d.motion(mean);
    s.vel.x += mean[0]! - before;
    for (let i = 0; i < 12; i++) step();
    expect(s.d.quietTime(), "never planted").toBeGreaterThan(0.25);
    for (const m of s.d.masses) if (m.hub) expect(m.vel.x - s.vel.x, `${m.name} freed at ${(m.vel.x - s.vel.x).toFixed(2)} m/s off the body`).toBeLessThanOrEqual(8 + 1e-9);
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      const before = s.group.position.clone();
      step();
      worst = Math.max(worst, s.group.position.distanceTo(before));
    }
    expect(worst, `the frame followed the wheels ${worst.toFixed(3)} m in one 1/60 s step (8 m/s: ${(8 * DT).toFixed(3)})`).toBeLessThan(8 * DT);
  });
});

forModes("given a wreck that has settled in place with its passenger cell 0.11 m off its seat in the body", (spawn) => {
  // The body seats on its cell no faster than SEAT_SPEED, so a body shoved off its cell stands off it for a while. The first hit
  // stores each mass's damage base, and the touch ends the plant in the same call: a base taken cell-relative left the offset in
  // every mass's travel, and the first live clamp dragged the whole body back by it (derby seed 19 car 6 at 80.22 s: 0.11 m in
  // one dt = 0 call, a zip).
  it("when a new hit touches it, then no body particle except the wheels jumps more than 3 cm, because the new hit does not drag the body back by how far the cabin stands off its seat", () => {
    const s = spawn(0, 0);
    for (let i = 0; i < 121; i++) stepWreck(s, DT);
    const cell = mass(s.d, "cell");
    cell.world.x += 0.11;
    stepWreck(s, 0);
    expect(s.d.quietTime(), "not planted").toBeGreaterThan(2);
    expect(cell.local.distanceTo(cell.rest), `the cell stands ${cell.local.distanceTo(cell.rest).toFixed(3)} m off its rest: nothing to drag`).toBeGreaterThan(0.05);
    const before = s.d.masses.map((m) => m.world.clone());
    expect(s.d.rearmHit(new THREE.Vector3(-0.95, 0.36, 0), new THREE.Vector3(1, 0, 0), 20, 6)).toBe(true);
    stepWreck(s, 0);
    for (const [i, m] of s.d.masses.entries()) {
      if (!m.hub) expect(m.world.distanceTo(before[i]!), `${m.name} jumped ${m.world.distanceTo(before[i]!).toFixed(3)} m at the touch`).toBeLessThan(0.03);
    }
  });
});

forModes("given a car whose hit armed at a low barrier speed, touched again before it has been quiet 0.3 s", (spawn) => {
  // Refused, the harder contact rode the first hit's short stroke: the replay's cop took 40 m/s on a 5 m/s hit, the player's
  // car 30 m/s on a 7.6 m/s side hit, and the fleet's coupe sank 0.5-0.7 m into a pickup on its door graze's 31 kN.
  it("when a contact at 40 m/s comes 0.1 s after a 5.3 m/s nose hit, then it re-arms the hit at its own barrier speed", () => {
    const s = spawn(0, 5.3, new THREE.Vector3(0.24, 0, -0.95).normalize());
    for (let i = 0; i < 6; i++) stepWreck(s, DT);
    expect(s.d.quietTime(), `quiet ${s.d.quietTime().toFixed(3)} s: the quiet time re-arms it anyway`).toBeLessThan(0.3);
    expect(s.d.rearmHit(new THREE.Vector3(0.5, 0.36, 2.0), new THREE.Vector3(-0.3, 0, -0.93).normalize(), 40, 40)).toBe(true);
    expect(s.d.hitSpeedValue, `hit speed ${s.d.hitSpeedValue.toFixed(2)} m/s`).toBeGreaterThanOrEqual(40);
  });

  it("when a contact at 30.3 m/s from the front-left comes in the same slice as a 7.6 m/s hit on the right door, then it re-arms the hit on the nose at 30.3 m/s", () => {
    const s = spawn(0, 7.6, new THREE.Vector3(-0.9, 0, 0.02).normalize(), new THREE.Vector3(0.95, 0.36, 0));
    expect(s.d.rearmHit(new THREE.Vector3(-0.7, 0.36, 2.0), new THREE.Vector3(0.69, 0, -0.67).normalize(), 30.3, 30.3)).toBe(true);
    expect(Math.abs(s.d.hitSpeedValue - 30.3), `hit speed ${s.d.hitSpeedValue.toFixed(2)} m/s`).toBeLessThan(1e-9);
  });

  it("when a contact reads 1.4 times the armed barrier speed, then it stays the armed hit's: a hit's own slices read within a few % of its first", () => {
    const s = spawn(0, 14);
    stepWreck(s, DT);
    expect(s.d.rearmHit(new THREE.Vector3(0, 0.36, 2.06), new THREE.Vector3(0, 0, -1), 14, 14 * 1.4)).toBe(false);
    expect(s.d.hitSpeedValue).toBe(14);
  });
});

forModes("given a wreck settled after a 7.6 m/s side hit, its wear counted against a 250 limit (no engine travel limit)", (spawn) => {
  it("when a 25 km/h side hit's contacts come in one slice, a 3 m/s graze and the 6.8 m/s face, then it wears as much whichever touches first, and as much again after a graze too soft to arm", () => {
    // The slice's contacts come in the order the cage's points meet the face: the graze first armed the hit and the face rode it (8 of
    // its 36 wear), or touched below the floor and shut the quiet window on the face (none), so a derby sedan's side hits never wore it out.
    const door = new THREE.Vector3(0.95, 0.36, 0);
    const inward = new THREE.Vector3(-1, 0, 0);
    const worn = (contacts: readonly number[]): string => {
      const s = spawn(0, 7.6, new THREE.Vector3(-0.9, 0, 0.02).normalize(), door);
      for (let i = 0; i < 121; i++) stepWreck(s, DT);
      expect(s.d.quietTime(), `quiet ${s.d.quietTime().toFixed(3)} s: nothing to re-arm`).toBeGreaterThan(0.3);
      s.d.wreckEnergy = 250;
      s.d.killTravel = Infinity;
      for (const ebs of contacts) {
        s.d.rearmHit(door, inward, ebs, ebs);
        s.d.notifyContact();
      }
      return `wear share ${(1 - s.d.drivetrainHealth).toFixed(6)}, hit speed ${s.d.hitSpeedValue.toFixed(4)} m/s`;
    };
    const face = worn([6.8]);
    expect(worn([3, 6.8]), "the graze touched first").toBe(face);
    expect(worn([6.8, 3]), "the face touched first").toBe(face);
    expect(worn([2.7, 6.8]), "a graze under the re-arm floor touched first").toBe(face);
  });
});

forModes("given a car driving hard into a rigid wall (16 to 20 m/s)", (spawn, mode) => {
  it("when the right-front corner hits the wall 0.62 m off centre for 24 steps, then it crushes over 1.25 times as far as the left-front corner (1.15 times in shape mode) and over 8 cm", () => {
    const s = spawn(0.62, 16);
    for (let i = 0; i < 24; i++) stepWall(s, DT, 0.16, mass(s.d, "bumperFR").world.x);
    const fl = travel(s.d, "bumperFL");
    const fr = travel(s.d, "bumperFR");
    expect(fr, `corners tied FL=${fl.toFixed(3)} FR=${fr.toFixed(3)} [${mode}]`).toBeGreaterThan(fl * (mode === "shape" ? 1.15 : 1.25));
    expect(fr, `right corner never crushed ${fr.toFixed(3)}`).toBeGreaterThan(0.08);
  });

  it("when a car-to-car-sized bite (18 cm of wall overlap per step) is taken head-on at 20 m/s for 18 steps, then the nose actually shortens by over 12 cm", () => {
    const s = spawn(0, 20);
    const z0 = (mass(s.d, "bumperFL").local.z + mass(s.d, "bumperFR").local.z) * 0.5;
    for (let i = 0; i < 18; i++) stepWall(s, DT, 0.18);
    const z1 = (mass(s.d, "bumperFL").local.z + mass(s.d, "bumperFR").local.z) * 0.5;
    expect(z0 - z1, `skin/lattice did not eat overlap Δz=${(z0 - z1).toFixed(3)} [${mode}]`).toBeGreaterThan(0.12);
  });
});

forModes("given a car driving into a rigid wall at 16 m/s (about 58 km/h)", (spawn, mode) => {
  it("when the squash slider (how soft the body is) and the buckle setting are both 0 for 18 steps, then the nose barely folds (shape mode: under 58 cm of crush)", () => {
    const s = spawn(0, 16);
    s.d.squash = 0;
    s.d.buckle = 0;
    const z0 = mass(s.d, "bumperFL").local.z;
    for (let i = 0; i < 18; i++) stepWall(s, DT, 0.16);
    const crush = z0 - mass(s.d, "bumperFL").local.z;
    if (mode === "shape") {
      expect(crush, `squash=0 still ate ${crush.toFixed(3)}m [${mode}]`).toBeLessThan(0.58);
    }
  });

  it("when one car has the squash slider (how soft the body is) at 1 and an identical car has it at 0 over the same 16-step pulse, then the squash-1 car's bumper crushes more than 8 cm further", () => {
    const lo = spawn(0, 16);
    lo.d.squash = 0;
    const hi = spawn(0, 16);
    hi.d.squash = 1;
    for (let i = 0; i < 16; i++) {
      stepWall(lo, DT, 0.14);
      stepWall(hi, DT, 0.14);
    }
    const a = -alongZ(lo.d, "bumperFL");
    const b = -alongZ(hi.d, "bumperFL");
    expect(b, `slider dead 0→${a.toFixed(3)} 1→${b.toFixed(3)} [${mode}]`).toBeGreaterThan(a + 0.08);
  });

  it("when the right-front corner is crushed 0.62 m off centre for 22 steps, then the leftover-crumple share (how much of the crumple zone is unused) drops below 1, or the struck corner has crushed over 90 % as far as the left-front one", () => {
    const s = spawn(0.62, 16);
    for (let i = 0; i < 22; i++) stepWall(s, DT, 0.16, mass(s.d, "bumperFR").world.x);
    const left = leftoverCrumple(s.d.crumpleTravelCorner());
    const fr = travel(s.d, "bumperFR");
    const fl = travel(s.d, "bumperFL");
    expect(fr > fl * 0.9 || left < 1, `corner leftover ${left.toFixed(3)} FR=${fr.toFixed(3)} FL=${fl.toFixed(3)} [${mode}]`).toBeTruthy();
  });

  it("when the wall crushes it for 30 steps, then neither the passenger cell (the stiff middle of the car) nor the car as a whole is falling faster than 4.5 m/s, so it does not free-fall after the pulse", () => {
    const s = spawn(0, 16);
    for (let i = 0; i < 30; i++) stepWall(s, DT, 0.12);
    expect(mass(s.d, "cell").vel.y, `cell vy ${mass(s.d, "cell").vel.y.toFixed(2)} [${mode}]`).toBeGreaterThan(-4.5);
    expect(s.vel.y, `car vy ${s.vel.y.toFixed(2)} [${mode}]`).toBeGreaterThan(-4.5);
  });

  it("when the wall crushes it for 20 steps, then the roof does not sag more than 12 cm below its rest height", () => {
    const s = spawn(0, 16);
    const y0 = mass(s.d, "roof").rest.y;
    for (let i = 0; i < 20; i++) stepWall(s, DT, 0.14);
    const y = mass(s.d, "roof").local.y;
    expect(y, `roof sagged to ${y.toFixed(3)} from ${y0} [${mode}]`).toBeGreaterThan(y0 - 0.12);
  });
});

const crushBySpeedCases = [
  { it: "when a 20 m/s car and a 5 m/s car take 6 steps of the same wall overlap, then the 20 m/s car's bumper crushes more than 4 cm further, so the crush grows with the speed of the hit", slowMps: 5, fastMps: 20, steps: 6, overlap: 0.1, minExtraCrush: 0.04 },
  { it: "when a 40 m/s car and a 14 m/s car take 3 steps of the same wall overlap, then the 40 m/s car's bumper crushes more than 2 cm further, so 40 m/s is a real crash, not a 14 m/s bump scaled up", slowMps: 14, fastMps: 40, steps: 3, overlap: 0.12, minExtraCrush: 0.02 },
] as const;

forModes("given a car driving into a rigid wall at a chosen speed", (spawn, mode) => {
  for (const testCase of crushBySpeedCases) {
    it(testCase.it, () => {
      const slow = spawn(0, testCase.slowMps);
      const fast = spawn(0, testCase.fastMps);
      for (let i = 0; i < testCase.steps; i++) {
        stepWall(slow, DT, testCase.overlap);
        stepWall(fast, DT, testCase.overlap);
      }
      const a = travel(slow.d, "bumperFL");
      const b = travel(fast.d, "bumperFL");
      expect(b, `${testCase.fastMps} m/s crushed ${b.toFixed(3)} vs ${testCase.slowMps} m/s ${a.toFixed(3)} [${mode}]`).toBeGreaterThan(a + testCase.minExtraCrush);
    });
  }

  it("when a 5 m/s car takes 18 steps of wall overlap, then the passenger cell (the stiff middle of the car) moves less than 12 cm, so a 5 m/s bump does not fold the cabin", () => {
    const s = spawn(0, 5);
    for (let i = 0; i < 18; i++) stepWall(s, DT, 0.12);
    expect(travel(s.d, "cell"), `cabin budged ${travel(s.d, "cell").toFixed(3)} at 5 m/s [${mode}]`).toBeLessThan(0.12);
  });
});

forModes("given a car crashing into a rigid wall at 14 to 16 m/s", (spawn, mode) => {
  it("when one car is fed eight wall contacts in fine slow-motion steps and an identical car in frame steps, then the slow-motion bumper moves less than 8 m/s faster than the normal one and under 40 m/s, so slow motion does not rocket the bumper", () => {
    const slow = spawn(0, 16);
    const fast = spawn(0, 16);
    const n = new THREE.Vector3(0, 0, -1);
    for (let i = 0; i < 8; i++) {
      stepWreck(slow, 1 / FINE_HZ, () => {
        slow.d.notifyContact();
        slow.d.feedOverlap(new THREE.Vector3(0, 0.38, 2), n, 0.1, 16, 1 / FINE_HZ);
      });
    }
    for (let i = 0; i < 8; i++) {
      stepWreck(fast, DT, () => {
        fast.d.notifyContact();
        fast.d.feedOverlap(new THREE.Vector3(0, 0.38, 2), n, 0.1, 16, DT);
      });
    }
    const vs = mass(slow.d, "bumperFL").vel.length();
    const vf = mass(fast.d, "bumperFL").vel.length();
    expect(vs, `slomo rocket ${vs.toFixed(2)} vs 1/60 ${vf.toFixed(2)} [${mode}]`).toBeLessThan(vf + 8);
    expect(vs, `slomo bumper ${vs.toFixed(2)} m/s [${mode}]`).toBeLessThan(40);
  });

  it("when the crush plays out for 24 steps and the car then coasts 12 more steps with no wall contact, then its speed stays under 16 m/s, so it does not rebound above its 14 m/s impact speed", () => {
    const s = spawn(0, 14);
    for (let i = 0; i < 24; i++) stepWall(s, DT, 0.12);
    for (let i = 0; i < 12; i++) stepWreck(s, DT);
    expect(s.vel.length(), `rebound ${s.vel.length().toFixed(2)} m/s [${mode}]`).toBeLessThan(16);
  });
});

forModes("given a car crashing at 14 m/s whose front bumper hands a share of each stopping impulse on to the passenger cell (the stiff middle of the car), depending on how far it is crushed", (spawn, mode) => {
  it("when the bumper is not crushed, then the front passes on at most 0.12 of the impulse, and when it is crushed 5 % past its maximum travel it counts as packed and passes on all of it", () => {
    const s = spawn(0, 14);
    expect(s.d.frontTransfer(), `rest transfer ${s.d.frontTransfer()}`).toBeLessThanOrEqual(0.12);
    const fl = mass(s.d, "bumperFL");
    fl.local.z = fl.rest.z - fl.bands.max * 1.05;
    fl.world.copy(fl.local);
    expect(s.d.nodePacked(fl), "travel past max should pack").toBeTruthy();
    expect(s.d.nodeTransfer(fl)).toBe(1);
  });

  it("when the bumper is crushed to the middle of its travel and then to its maximum band, then it passes on exactly 0.5 of the impulse at the middle (not 0.1 or 0.62) and 0.62, or counts as packed, at the maximum", () => {
    const s = spawn(0, 14);
    const fl = mass(s.d, "bumperFL");
    fl.local.z = fl.rest.z - fl.bands.middle;
    fl.world.copy(fl.local);
    expect(s.d.nodeTransfer(fl)).toBe(0.5);
    fl.local.z = fl.rest.z - fl.bands.max;
    fl.world.copy(fl.local);
    expect(s.d.nodeTransfer(fl) === 0.62 || s.d.nodePacked(fl), `max band ${s.d.nodeTransfer(fl)}`).toBeTruthy();
  });

  it("when both front bumper corners are crushed 5 % past their maximum travel and a 4000 N·s impulse hits, then the packed car's cabin speed changes more than twice as much as an uncrushed car's, because a packed face dumps the stopping impulse onto the cabin", () => {
    const rest = spawn(0, 14);
    const packed = spawn(0, 14);
    const fl = mass(packed.d, "bumperFL");
    const fr = mass(packed.d, "bumperFR");
    fl.local.z = fl.rest.z - fl.bands.max * 1.05;
    fr.local.z = fr.rest.z - fr.bands.max * 1.05;
    fl.world.copy(fl.local);
    fr.world.copy(fr.local);
    const cell0 = mass(rest.d, "cell").vel.z;
    rest.d.applyImpulse(0, 0, -1, 4000);
    packed.d.applyImpulse(0, 0, -1, 4000);
    const dRest = Math.abs(mass(rest.d, "cell").vel.z - cell0);
    const dPack = Math.abs(mass(packed.d, "cell").vel.z - cell0);
    expect(dPack, `rest cabin ${dRest.toFixed(3)} packed ${dPack.toFixed(3)} [${mode}]`).toBeGreaterThan(dRest * 2);
  });
});

describe("given the crash path's boot warm-up (a pre-run that compiles the crush path before the first real crash, see docs/PERF_HITCH.md)", () => {
  it("when two cars crash head-on at 48 km/h, the warm-up hits are run and the head-on is run again, then every warm-up hit crashes both cars and the second head-on is bit-identical to the first", () => {
    const before = runPair(48, 48, "head-on");
    expect(warmCrashPath(), "a warm-up hit no longer crashes both cars, so it no longer compiles the crush path").toBeTruthy();
    assertSameDigest(runPair(48, 48, "head-on"), before, "48 km/h head-on after the warm-up");
  });
});
