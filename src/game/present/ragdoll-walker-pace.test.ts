import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { driverLook } from "./driver-look.ts";
import { PARTS } from "./ragdoll-body.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { SLOTS } from "./ragdoll-config.ts";
import { RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "./walker-locomotion.ts";
import { wrapAngle } from "./walker-math.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
const WALKER = SLOTS - 1;
/** The feet's parts, left then right (`PARTS`): where a foot is. */
const FEET = [10, 11] as const;
/** A walker slower than this (m/s) has stopped for the eye. */
const STOPPED_SPEED = 0.3;

type Sample = { t: number; speed: number; drawnSpeed: number; tilt: number; facing: number; torsoY: number; strength: number; planted: number[]; pivot: number[]; feet: number[]; standing: boolean; thighSwing: number };

/** The left thigh's part (`PARTS`). */
const THIGH = 6;

let system: RagdollSystem;
const drawn = new THREE.Vector3();

beforeEach(async () => {
  system = await flatSystem();
  expect(system.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) }), "the walker is placed in his slot").toBe(WALKER);
});

afterEach(() => {
  system.dispose();
});

function bodies() {
  return system["dolls"][WALKER]!.bodies;
}

/** Where each foot's sole turns on the ground (x, y, z per foot): its heel's back edge, then its toe's front edge once the weight has rolled onto it. */
function feetNow(): number[] {
  const out: number[] = [];
  for (const [f, k] of FEET.entries()) {
    const t = bodies()[k]!.translation();
    const q = bodies()[k]!.rotation();
    const edge = new THREE.Vector3(0, -PARTS[k].h[1], (system.walker.gait.pivot[f] === 0 ? -1 : 1) * PARTS[k].h[2]).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    out.push(t.x + edge.x, t.y + edge.y, t.z + edge.z);
  }
  return out;
}

/** The left thigh's swing (degrees, positive: the knee forward) about the torso's own side axis: where the thigh points, seen from the torso. */
function thighSwingDegrees(): number {
  const torso = bodies()[0]!.rotation();
  const thigh = bodies()[THIGH]!.rotation();
  const down = new THREE.Vector3(0, -1, 0).applyQuaternion(new THREE.Quaternion(thigh.x, thigh.y, thigh.z, thigh.w));
  down.applyQuaternion(new THREE.Quaternion(torso.x, torso.y, torso.z, torso.w).invert());
  return (Math.atan2(-down.z, -down.y) * -180) / Math.PI;
}

/** `seconds` of frames with the control held: one sample a frame (speeds from how far the torso, and the drawn torso, moved). */
function run(seconds: number): Sample[] {
  const samples: Sample[] = [];
  const torso = bodies()[0]!;
  let last = torso.translation();
  system.walkerTorso(drawn);
  let lastDrawn = drawn.clone();
  for (let f = 1; f <= Math.round(seconds * FRAME_HZ); f++) {
    system.walker.ask();
    system.update(FRAME, [], true, true, null);
    const p = torso.translation();
    const q = torso.rotation();
    system.walkerTorso(drawn);
    samples.push({
      t: f * FRAME,
      speed: Math.hypot(p.x - last.x, p.z - last.z) / FRAME,
      drawnSpeed: Math.hypot(drawn.x - lastDrawn.x, drawn.z - lastDrawn.z) / FRAME,
      tilt: (Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 180) / Math.PI,
      facing: Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)),
      torsoY: p.y,
      strength: system.walker.strength,
      planted: Array.from(system.walker.gait["planted"]),
      pivot: Array.from(system.walker.gait.pivot),
      feet: feetNow(),
      standing: system.walker.state === "stand",
      thighSwing: thighSwingDegrees(),
    });
    last = p;
    lastDrawn = drawn.clone();
  }
  return samples;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const std = (values: number[]) => Math.sqrt(mean(values.map((v) => (v - mean(values)) ** 2)));
const smoothed = (values: number[], width: number) => values.map((_, i) => mean(values.slice(Math.max(0, i - width), i + 1)));

/** Speed of a planted foot over the ground, mean and 95th percentile (m/s), taken where it was planted in two frames running. */
function plantedFootSpeeds(samples: Sample[]): { mean: number; p95: number; count: number } {
  const speeds: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    for (let f = 0; f < 2; f++) {
      if (!samples[i]!.planted[f] || !samples[i - 1]!.planted[f] || samples[i]!.pivot[f] !== samples[i - 1]!.pivot[f]) continue;
      speeds.push(Math.hypot(samples[i]!.feet[f * 3]! - samples[i - 1]!.feet[f * 3]!, samples[i]!.feet[f * 3 + 2]! - samples[i - 1]!.feet[f * 3 + 2]!) / FRAME);
    }
  }
  speeds.sort((a, b) => a - b);
  return { mean: mean(speeds), p95: speeds[Math.floor(speeds.length * 0.95)] ?? 0, count: speeds.length };
}

const goCases: readonly {
  it: string;
  command: number;
  expectedMinSpeed: number;
  expectedMaxSpeed: number;
  expectedMaxSecondsTo90: number;
  expectedMaxJitter: number;
  expectedMaxTilt: number;
  expectedMaxFootSlide: number;
  expectedMaxFootSlide95: number;
}[] = [
  { it: "when he is asked to walk, then he walks at 1.5 m/s in a third of a second, his drawn speed steady to 0.15 m/s", command: WALK_SPEED, expectedMinSpeed: 1.35, expectedMaxSpeed: 1.65, expectedMaxSecondsTo90: 0.5, expectedMaxJitter: 0.15, expectedMaxTilt: 15, expectedMaxFootSlide: 0.1, expectedMaxFootSlide95: 0.2 },
  { it: "when he is asked to run, then he runs at 3.5 m/s in half a second, his drawn speed steady to 0.18 m/s", command: RUN_SPEED, expectedMinSpeed: 3.3, expectedMaxSpeed: 3.7, expectedMaxSecondsTo90: 0.65, expectedMaxJitter: 0.18, expectedMaxTilt: 25, expectedMaxFootSlide: 0.1, expectedMaxFootSlide95: 0.5 },
  { it: "when he is asked to sprint, then he sprints at 7 m/s inside 1.3 s without tipping past 30 degrees, his drawn speed steady to 0.2 m/s", command: SPRINT_SPEED, expectedMinSpeed: 6.6, expectedMaxSpeed: 7.4, expectedMaxSecondsTo90: 1.3, expectedMaxJitter: 0.2, expectedMaxTilt: 30, expectedMaxFootSlide: 0.2, expectedMaxFootSlide95: 0.5 },
];

describe("given a walker standing on open ground", () => {
  for (const testCase of goCases) {
    it(testCase.it, () => {
      run(1);
      system.walker.heading = 0;
      system.walker.command = testCase.command;
      const samples = run(8);
      const steady = samples.slice(-240);
      const speed = mean(steady.map((s) => s.speed));
      const track = smoothed(samples.map((s) => s.speed), 5);
      const seconds = samples[track.findIndex((v) => v >= 0.9 * speed)]!.t;
      const jitter = std(steady.map((s) => s.drawnSpeed));
      const slide = plantedFootSpeeds(steady);
      expect(samples.every((s) => s.standing), "never went down").toBeTruthy();
      expect(speed >= testCase.expectedMinSpeed && speed <= testCase.expectedMaxSpeed, `steady speed ${speed.toFixed(2)} m/s within ${testCase.expectedMinSpeed}-${testCase.expectedMaxSpeed}`).toBeTruthy();
      expect(seconds, `90 % of it in ${seconds.toFixed(2)} s within ${testCase.expectedMaxSecondsTo90}`).toBeLessThanOrEqual(testCase.expectedMaxSecondsTo90);
      expect(jitter, `drawn speed varies by ${jitter.toFixed(3)} m/s within ${testCase.expectedMaxJitter}`).toBeLessThanOrEqual(testCase.expectedMaxJitter);
      expect(Math.max(...samples.map((s) => s.tilt)), `worst tilt ${Math.max(...samples.map((s) => s.tilt)).toFixed(1)} degrees`).toBeLessThanOrEqual(testCase.expectedMaxTilt);
      expect(slide.count, `${slide.count} planted-foot readings (a gait that never plants proves nothing)`).toBeGreaterThan(20);
      expect(slide.mean <= testCase.expectedMaxFootSlide && slide.p95 <= testCase.expectedMaxFootSlide95, `a planted foot slides ${slide.mean.toFixed(2)} m/s on average, ${slide.p95.toFixed(2)} at the 95th percentile`).toBeTruthy();
    });
  }
});

const swingCases: readonly { it: string; command: number; expectedMinSwing: number; expectedMaxSwing: number }[] = [
  { it: "when he walks, then his thigh swings 30-45 degrees peak to peak seen from the torso, as a person's does", command: WALK_SPEED, expectedMinSwing: 30, expectedMaxSwing: 45 },
  { it: "when he runs, then his thigh swings 50-70 degrees peak to peak seen from the torso", command: RUN_SPEED, expectedMinSwing: 50, expectedMaxSwing: 70 },
  { it: "when he sprints, then his thigh swings 50-70 degrees peak to peak seen from the torso", command: SPRINT_SPEED, expectedMinSwing: 50, expectedMaxSwing: 70 },
];

describe("given a walker going at a steady pace", () => {
  for (const testCase of swingCases) {
    it(testCase.it, () => {
      run(1);
      system.walker.heading = 0;
      system.walker.command = testCase.command;
      const swing = run(8).slice(-240).map((s) => s.thighSwing);
      const peakToPeak = Math.max(...swing) - Math.min(...swing);
      expect(peakToPeak >= testCase.expectedMinSwing && peakToPeak <= testCase.expectedMaxSwing, `thigh swing ${peakToPeak.toFixed(1)} degrees within ${testCase.expectedMinSwing}-${testCase.expectedMaxSwing}`).toBeTruthy();
    });
  }
});

const stopCases: readonly { it: string; command: number; expectedMaxSeconds: number; expectedMaxMetres: number }[] = [
  { it: "when a run is let go, then he is down to a crawl inside half a second and 0.6 m", command: RUN_SPEED, expectedMaxSeconds: 0.5, expectedMaxMetres: 0.6 },
  { it: "when a sprint is let go, then he is down to a crawl inside 1.1 s and 3.6 m", command: SPRINT_SPEED, expectedMaxSeconds: 1.1, expectedMaxMetres: 3.6 },
];

describe("given a walker at speed", () => {
  for (const testCase of stopCases) {
    it(testCase.it, () => {
      run(1);
      system.walker.command = testCase.command;
      run(7);
      system.walker.command = 0;
      const after = run(4);
      const still = smoothed(after.map((s) => s.speed), 5).findIndex((v) => v < STOPPED_SPEED);
      expect(still, "he stopped").toBeGreaterThanOrEqual(0);
      const travelled = after.slice(0, still + 1).reduce((sum, s) => sum + s.speed * FRAME, 0);
      expect(after[still]!.t, `under ${STOPPED_SPEED} m/s after ${after[still]!.t.toFixed(2)} s within ${testCase.expectedMaxSeconds}`).toBeLessThanOrEqual(testCase.expectedMaxSeconds);
      expect(travelled, `${travelled.toFixed(2)} m to a stop within ${testCase.expectedMaxMetres}`).toBeLessThanOrEqual(testCase.expectedMaxMetres);
      expect(travelled > 0.1 && after.every((s) => s.standing), "he travelled and stayed on his feet").toBeTruthy();
    });
  }
});

const cutCases: readonly { it: string; degrees: number; expectedMaxSecondsToFace: number; expectedMaxTilt: number; expectedMinSlowest: number; expectedMaxSlowest: number }[] = [
  { it: "when a sprint is turned 45 degrees, then he curves to it without tipping, losing little speed", degrees: 45, expectedMaxSecondsToFace: 0.7, expectedMaxTilt: 35, expectedMinSlowest: 4.5, expectedMaxSlowest: 7 },
  { it: "when a sprint is turned 90 degrees, then he pivots to it inside 1.2 s without falling", degrees: 90, expectedMaxSecondsToFace: 1.2, expectedMaxTilt: 35, expectedMinSlowest: 1.5, expectedMaxSlowest: 4.8 },
  { it: "when a sprint is turned 180 degrees, then he reverses inside 1.3 s without falling", degrees: 180, expectedMaxSecondsToFace: 1.3, expectedMaxTilt: 35, expectedMinSlowest: 0, expectedMaxSlowest: 2.5 },
];

describe("given a walker sprinting along +z", () => {
  for (const testCase of cutCases) {
    it(testCase.it, () => {
      run(1);
      system.walker.command = SPRINT_SPEED;
      run(5);
      const heading = (testCase.degrees * Math.PI) / 180;
      system.walker.heading = heading;
      const samples = run(4);
      const faced = samples.findIndex((s) => Math.abs(Math.atan2(Math.sin(s.facing - heading), Math.cos(s.facing - heading))) < 0.35);
      const slowest = Math.min(...smoothed(samples.map((s) => s.speed), 5).slice(0, faced + 30));
      const slide = plantedFootSpeeds(samples);
      expect(samples.every((s) => s.standing), "never went down").toBeTruthy();
      expect(faced >= 0 && samples[faced]!.t <= testCase.expectedMaxSecondsToFace, `facing the new way after ${faced < 0 ? "never" : samples[faced]!.t.toFixed(2)} s within ${testCase.expectedMaxSecondsToFace}`).toBeTruthy();
      expect(Math.max(...samples.map((s) => s.tilt)), `worst tilt ${Math.max(...samples.map((s) => s.tilt)).toFixed(1)} degrees within ${testCase.expectedMaxTilt}`).toBeLessThanOrEqual(testCase.expectedMaxTilt);
      expect(slowest >= testCase.expectedMinSlowest && slowest <= testCase.expectedMaxSlowest, `slowest ${slowest.toFixed(2)} m/s within ${testCase.expectedMinSlowest}-${testCase.expectedMaxSlowest}`).toBeTruthy();
      expect(slide.count > 10 && slide.p95 <= 3.2, `planted feet slide ${slide.p95.toFixed(2)} m/s at the 95th percentile over ${slide.count} readings`).toBeTruthy();
    });
  }
});

const leanCases: readonly { it: string; command: number; expectedMinLean: number; expectedMaxLean: number }[] = [
  { it: "when he runs steadily, then his drawn torso leans forward 6-10 degrees of vertical", command: RUN_SPEED, expectedMinLean: 6, expectedMaxLean: 10 },
  { it: "when he sprints steadily, then his drawn torso leans forward 12-18 degrees of vertical", command: SPRINT_SPEED, expectedMinLean: 12, expectedMaxLean: 18 },
];

describe("given a walker at speed along +z", () => {
  for (const testCase of leanCases) {
    it(testCase.it, () => {
      run(1);
      system.walker.command = testCase.command;
      run(5);
      const leans: number[] = [];
      for (let f = 0; f < 3 * FRAME_HZ; f++) {
        system.walker.ask();
        system.update(FRAME, [], true, true, null);
        const q = bodies()[0]!.rotation();
        leans.push((Math.atan2(2 * (q.y * q.z + q.x * q.w), 1 - 2 * (q.x * q.x + q.z * q.z)) * 180) / Math.PI);
      }
      const lean = mean(leans);
      expect(lean >= testCase.expectedMinLean && lean <= testCase.expectedMaxLean, `lean ${lean.toFixed(1)} degrees within ${testCase.expectedMinLean}-${testCase.expectedMaxLean}`).toBeTruthy();
    });
  }
});

const FOOT = 0.3048;
/** How long (s) the walker is watched after the stick is pulled back: the turn and a few seconds after. */
const REVERSAL_SECONDS = 3.5;
/** A near fall: his strength (0-1) never falls under this (a hit of 4 m/s knocks him down, 2 m/s takes it to 0.7), his torso never sinks under this height (m) or tilts past this (degrees); he faces the new way to within this (rad) at the end. */
const NO_STUMBLE_STRENGTH = 0.3;
const NO_SINK_HEIGHT = 0.9;
const NO_TIP_TILT = 35;
const FACED_BACK = 0.35;
const WOMAN = { ...driverLook(0, 0), woman: true };
const LOOKS = { man: driverLook(0, 0), woman: WOMAN } as const;

const reverseCases: readonly { it: string; build: keyof typeof LOOKS; metres: number; degrees: number }[] = [
  { it: "when a woman runs 10 feet and the stick is pulled straight back, then she turns about and runs back without falling", build: "woman", metres: 10 * FOOT, degrees: 180 },
  { it: "when a woman runs 9 feet and the stick is pulled straight back, then she turns about and runs back without falling", build: "woman", metres: 9 * FOOT, degrees: 180 },
  { it: "when a woman runs 11 feet and the stick is pulled straight back, then she turns about and runs back without falling", build: "woman", metres: 11 * FOOT, degrees: 180 },
  { it: "when a woman runs 10 feet and turns about the other way, then she runs back without falling", build: "woman", metres: 10 * FOOT, degrees: -180 },
  { it: "when a man runs 10 feet and the stick is pulled straight back, then he turns about and runs back without falling", build: "man", metres: 10 * FOOT, degrees: 180 },
];

describe("given a walker running along +z", () => {
  for (const testCase of reverseCases) {
    it(testCase.it, () => {
      system.stopWalker(WALKER);
      expect(system.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: LOOKS[testCase.build] }, WALKER), "the walker is placed in his slot").toBe(WALKER);
      const heading = (testCase.degrees * Math.PI) / 180;
      system.walker.heading = 0;
      system.walker.command = RUN_SPEED;
      const samples: Sample[] = [];
      let turnedAfter = Infinity;
      for (let f = 0; f < 4 * FRAME_HZ && turnedAfter === Infinity; f++) {
        samples.push(...run(FRAME));
        const at = bodies()[0]!.translation();
        if (hypot2(at.x, at.z) >= testCase.metres) turnedAfter = samples.length * FRAME;
      }
      expect(turnedAfter, "the walker ran the distance").toBeLessThan(Infinity);
      system.walker.heading = heading;
      samples.push(...run(REVERSAL_SECONDS));
      const turned = samples.slice(Math.round(turnedAfter * FRAME_HZ));
      const fallen = turned.find((s) => !s.standing);
      expect(fallen, `fell ${(turned.findIndex((s) => !s.standing) * FRAME).toFixed(2)} s after the stick was pulled back, torso ${fallen?.torsoY.toFixed(2)} m, tilt ${fallen?.tilt.toFixed(0)} degrees`).toBe(undefined);
      const weakest = Math.min(...turned.map((s) => s.strength));
      const lowest = Math.min(...turned.map((s) => s.torsoY));
      const tipped = Math.max(...turned.map((s) => s.tilt));
      expect(weakest, `stumbled: strength fell to ${weakest.toFixed(2)}`).toBeGreaterThanOrEqual(NO_STUMBLE_STRENGTH);
      expect(lowest, `torso sank to ${lowest.toFixed(2)} m`).toBeGreaterThanOrEqual(NO_SINK_HEIGHT);
      expect(tipped, `torso tipped ${tipped.toFixed(0)} degrees`).toBeLessThanOrEqual(NO_TIP_TILT);
      expect(Math.abs(wrapAngle(turned[turned.length - 1]!.facing - heading)), "faces the way the stick points").toBeLessThan(FACED_BACK);
    });
  }
});
