import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { assignClass, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { paint } from "../vehicle/test-support.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import { CAR_SPRAY, SPRAY_FACE } from "../vehicle/spray-box.ts";
import { STROKE_BYTES } from "../vehicle/paint-scrapes.ts";
import { must } from "../kernel/must.test-util.ts";
import { FREEWHEEL, launch, makeWorld, PARKED, relaunchDamaged, runWall, tickWorld } from "./crash-scenarios.test-util.ts";

/** The pass's speed along the struck car (m/s) and the frames it runs (2 s at 60 Hz: the striker clears the parked car). */
const PASS_SPEED = 8;
const PASS_FRAMES = 120;
/** A striker's centre this far (m) out from the parked car's: a sedan's half widths and a 15 cm gap. */
const ALONGSIDE_X = -1.95;
/** It starts this far (m) behind the parked car's centre. */
const START_Z = -4;
/** Width quanta (6.5 mm each, `(q + 1)` of them): a hairline is the narrowest, 6.5 mm, a band at least 45.5 mm. */
const HAIRLINE_Q = 0;
const BAND_Q = 6;
/** Severity a steel band reaches (of 255): a painted bumper's 0.6 cut keeps a shove's nose stroke under it, the flank's paint-on-paint over it. */
const STEEL = 180;

type Stroke = { u0: number; u1: number; v0: number; v1: number; face: number; width: number; severity: number };

function strokes(car: DeformableCar): Stroke[] {
  const l = car.scratches.list;
  const out: Stroke[] = [];
  for (let k = 0; k < car.scratches.count; k++) {
    const s = k * STROKE_BYTES;
    out.push({ u0: l[s]!, u1: l[s + 1]!, v0: l[s + 2]!, v1: l[s + 3]!, face: l[s + 4]! & 7, width: l[s + 4]! >> 3, severity: l[s + 5]! });
  }
  return out;
}

const show = (ss: Stroke[]) => ss.map((s) => `f${s.face} u${s.u0}-${s.u1} v${s.v0}-${s.v1} w${s.width} s${s.severity}`).join("; ") || "none";

function car(style: "sedan" | "coupe" | "police"): DeformableCar {
  const c = new DeformableCar(paint(), new THREE.Scene(), null, style);
  assignClass(c, STYLE_CLASS[style]);
  c.deform.setMode("shape");
  return c;
}

/** Flank texel column (u on a side face) of rest z (m). */
const flankU = (z: number) => Math.floor(((z - CAR_SPRAY.min[2]) / (CAR_SPRAY.max[2] - CAR_SPRAY.min[2])) * CAR_SPRAY.faces[SPRAY_FACE.right]![2]);
/** Flank texel row (v on a side face) of rest height y (m). */
const flankV = (y: number) => Math.floor(((y - CAR_SPRAY.min[1]) / (CAR_SPRAY.max[1] - CAR_SPRAY.min[1])) * CAR_SPRAY.faces[SPRAY_FACE.right]![3]);
/** Rest z (m) of a flank texel column's middle. */
const flankZ = (u: number) => CAR_SPRAY.min[2] + ((u + 0.5) / CAR_SPRAY.faces[SPRAY_FACE.right]![2]) * (CAR_SPRAY.max[2] - CAR_SPRAY.min[2]);

type Stage = { press?: number; yaw?: number; x?: number; z?: number; speed?: number; frames?: number; onHit?: (hit: { impulse: number; contact: THREE.Vector3 }) => void };
/** How many times each car's stroke list changed over the run. */
type Run = { a: DeformableCar; b: DeformableCar; changes: [number, number] };

/** `launch` for an intact car, `relaunchDamaged` for a wreck (a spawn would repair it). */
function setOff(car: DeformableCar, x: number, z: number, yaw: number, vx: number, vz: number): void {
  if (car.crashed) return relaunchDamaged(car, x, z, yaw, vx, vz);
  launch(car, x, z, yaw, vx, vz);
  layOnGround(car);
}

/** Striker `a` set off at (x, z) heading `yaw` at `speed` m/s plus `press` m/s across toward +x, at parked `b` on the origin, for `frames` frames. */
function pass(a: DeformableCar, b: DeformableCar, { press = 0, yaw = 0, x = ALONGSIDE_X, z = START_Z, speed = PASS_SPEED, frames = PASS_FRAMES, onHit }: Stage): Run {
  setOff(a, x, z, yaw, press + speed * Math.sin(yaw), speed * Math.cos(yaw));
  setOff(b, 0, 0, 0, 0, 0);
  const w = makeWorld([a, b], false, false);
  w.pedals.set(a, FREEWHEEL);
  w.pedals.set(b, PARKED);
  const va = a.scratches.version;
  if (onHit) w.world.pairHit = (_a, _b, hit) => onHit(hit);
  const vb = b.scratches.version;
  for (let f = 0; f < frames; f++) tickWorld(w);
  return { a, b, changes: [a.scratches.version - va, b.scratches.version - vb] };
}

const maxOf = (ss: Stroke[], k: "width" | "severity") => ss.reduce((m, s) => Math.max(m, s[k]), 0);
const both = (r: Run) => [...strokes(r.a), ...strokes(r.b)];

describe("given a sedan sliding past a parked sedan's flank at 8 m/s", () => {
  it("when it slides along flank to flank, pressing in at 1 m/s, then each car's strokes lie on the touching flank only, at the door's heights, and one runs over the striker's door", () => {
    const a = car("sedan");
    const plan = a.cage.fields.planBox;
    // Alongside, 1 cm apart, its nose past the parked car's tail: the tyres hold no sideways press over a wider gap.
    const { b } = pass(a, car("sedan"), { press: 1, x: -(plan[1]! - plan[0]!) - 0.01, z: -2 });
    const sa = strokes(a);
    const sb = strokes(b);
    const door = a.style.door;
    const doorU: [number, number] = [flankU(door.hingeZ - door.length), flankU(door.hingeZ)];
    const heights: [number, number] = [flankV(door.hingeY - door.halfHeight), flankV(door.hingeY + door.halfHeight)];
    const note = `A: ${show(sa)} | B: ${show(sb)} | door u${doorU[0]}-${doorU[1]} v${heights[0]}-${heights[1]}`;
    console.log(`flank: ${note}`);
    expect(sa.length > 0 && sb.length > 0, `both cars marked: ${note}`).toBeTruthy();
    expect(sa.every((s) => s.face === SPRAY_FACE.right) && sb.every((s) => s.face === SPRAY_FACE.left), `the striker's right flank, the parked car's left: ${note}`).toBeTruthy();
    expect(both({ a, b, changes: [0, 0] }).every((s) => Math.min(s.v0, s.v1) >= heights[0] && Math.max(s.v0, s.v1) <= heights[1]), `within the door's heights: ${note}`).toBeTruthy();
    expect(sa.some((s) => Math.min(s.u0, s.u1) <= doorU[1] && Math.max(s.u0, s.u1) >= doorU[0]), `a stroke over the striker's door: ${note}`).toBeTruthy();
  });

  it("when it leans in at 0.5 m/s, presses at 1 m/s, shoves at 3 m/s, and grinds at 2 m/s along a side-crushed wreck, then the lean leaves nothing, the press thin hairlines, the shove and the grind wide steel bands", () => {
    const lean = pass(car("sedan"), car("sedan"), { yaw: Math.asin(0.5 / PASS_SPEED) });
    // Alongside, 1 cm apart, pressing in at 1 m/s for the whole slide (as row 1): set off 7° in from the alongside mark, the nose corner started 14 cm inside the parked car's flank and the spawn's overlap struck like a shove.
    const presser = car("sedan");
    const plan = presser.cage.fields.planBox;
    const press = pass(presser, car("sedan"), { press: 1, x: -(plan[1]! - plan[0]!) - 0.01, z: -1.5 });
    const shove = pass(car("sedan"), car("sedan"), { yaw: Math.asin(3 / PASS_SPEED) });
    const wreck = car("sedan");
    runWall(40, 1, "side", { car: wreck });
    const grind = pass(car("sedan"), wreck, { yaw: Math.asin(2 / PASS_SPEED) });
    const note = [lean, press, shove, grind].map((r, i) => `${["lean", "press", "shove", "grind"][i]}: ${show(both(r))}`).join("\n");
    console.log(note);
    expect(both(lean).length, `the lean: ${note}`).toBe(0);
    expect(both(press).length > 0 && maxOf(both(press), "width") <= HAIRLINE_Q, `the press, hairlines: ${note}`).toBeTruthy();
    expect(maxOf(both(shove), "width") >= BAND_Q && maxOf(both(shove), "severity") >= STEEL, `the shove, a steel band: ${note}`).toBeTruthy();
    expect(maxOf(both(grind), "width") >= BAND_Q && maxOf(both(grind), "severity") >= STEEL, `the grind, a steel band: ${note}`).toBeTruthy();
  });

  it("when it grinds along at 10 m/s for 1 s, then each car's list changes at most once per commit window and once more, and keeps at most 4 strokes a face", () => {
    const r = pass(car("sedan"), car("sedan"), { yaw: Math.asin(2 / 10), speed: 10, frames: 60 });
    const note = `changes ${r.changes.join("/")} | A: ${show(strokes(r.a))} | B: ${show(strokes(r.b))}`;
    console.log(`throttle: ${note}`);
    expect(both(r).length, `the control: they scraped: ${note}`).toBeGreaterThan(0);
    expect(Math.max(...r.changes), `list changes: ${note}`).toBeLessThanOrEqual(1 / 0.2 + 1);
    for (const c of [r.a, r.b]) for (let f = 0; f < 5; f++) expect(strokes(c).filter((s) => s.face === f).length, `face ${f}: ${note}`).toBeLessThanOrEqual(4);
  });
});

describe("given two sedans meeting square, nose to nose at 10 m/s each", () => {
  it("when they crash, then neither slides along the other and neither paint scratches for 1 s", () => {
    const a = car("sedan");
    const b = car("sedan");
    launch(a, 0, -4, 0, 0, 10);
    launch(b, 0, 4, Math.PI, 0, -10);
    layOnGround(a);
    layOnGround(b);
    const w = makeWorld([a, b], false, false);
    w.pedals.set(a, FREEWHEEL);
    w.pedals.set(b, FREEWHEEL);
    for (let f = 0; f < 60; f++) tickWorld(w);
    expect(a.crashed && b.crashed, "the control: they met").toBeTruthy();
    expect(a.scratches.count + b.scratches.count, `A: ${show(strokes(a))} | B: ${show(strokes(b))}`).toBe(0);
  });
});

describe("given a striker's nose ramming along a parked sedan's tail at 8 m/s, 52° in", () => {
  it("when the nose is a coupe's chrome bumper and then a cruiser's black one, then the chrome cuts at least twice as hard where it first meets the car", () => {
    const rub = (style: "coupe" | "police") => strokes(pass(car(style), car("sedan"), { x: -2.4, z: -4.5, yaw: 0.9 }).b);
    const chrome = rub("coupe");
    const black = rub("police");
    const note = `chrome: ${show(chrome)} | black: ${show(black)}`;
    console.log(`material: ${note}`);
    must(chrome[0] && black[0], `both struck cars marked: ${note}`);
    expect(chrome[0].severity, note).toBeGreaterThanOrEqual(2 * black[0].severity);
  });

  it("when what touches the flank is a tyre's sidewall, then it cuts nothing", () => {
    const a = car("sedan");
    const b = car("sedan");
    a.spawnFacing(-1.9, 0, 0, 0);
    b.spawnFacing(0, 0, 0, 0);
    const hub = a.frame.wheels[2];
    must(hub, "a rear wheel");
    a.group.updateMatrixWorld(true);
    const sidewall = a.group.localToWorld(new THREE.Vector3(hub[0] + Math.sign(hub[0]) * a.frame.rig.tyre.halfW, hub[1] + 0.5 * a.frame.rig.tyre.r, hub[2]));
    const cut = a.cutAt(sidewall);
    const flank = new THREE.Vector3(-0.85, 0.5, 0);
    b.scrape(flank, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 8), 0.3, 3, cut);
    b.scratches.slice(0.25);
    b.scrape(flank.setZ(0.5), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 8), 0.3, 3, cut);
    b.scratches.slice(0.25);
    b.scratches.slice(0.25);
    expect(b.scratches.count, `the sidewall's cut ${cut}: ${show(strokes(b))}`).toBe(0);
  });
});

describe("given a sedan whose front was crushed into a wall at 50 km/h", () => {
  it("when it grinds its nose along a parked sedan's flank, then every stroke on its flank lands ahead of its door and ahead of every contact's drawn place: on the fender's paint where it sat before the crush", () => {
    const crushed = car("sedan");
    runWall(50, 1, "front", { car: crushed });
    expect(crushed.crashed, "the control: crushed").toBe(true);
    const at = new THREE.Vector3();
    const rests: string[] = [];
    let drawnMax = -Infinity;
    const r = pass(crushed, car("sedan"), {
      yaw: Math.asin(2 / PASS_SPEED),
      onHit: (hit) => {
        const drawn = crushed.group.worldToLocal(at.copy(hit.contact)).z;
        drawnMax = Math.max(drawnMax, drawn);
        rests.push(`${drawn.toFixed(2)}>${crushed.restPointOf(hit.contact, at).z.toFixed(2)}`);
      },
    });
    const ss = strokes(r.a).filter((s) => s.face === SPRAY_FACE.right);
    const door = crushed.style.door;
    const crush = crushed.deform.masses.reduce((m, mass) => Math.max(m, mass.rest.z - mass.local.z), 0);
    const note = `${show(strokes(r.a))} | rest z of flank ends ${ss.map((s) => `${flankZ(s.u0).toFixed(2)}..${flankZ(s.u1).toFixed(2)}`).join(" ")} | door front ${door.hingeZ.toFixed(2)} | deepest mass crush ${crush.toFixed(2)} m | contact z drawn>rest ${rests.slice(0, 40).join(" ")}`;
    console.log(`fender: ${note}`);
    expect(crush, `the control: the front crushed back over 20 cm: ${note}`).toBeGreaterThan(0.2);
    const rearEnd = (s: Stroke) => Math.min(flankZ(s.u0), flankZ(s.u1));
    expect(ss.length, `its flank scraped: ${note}`).toBeGreaterThan(0);
    expect(ss.every((s) => rearEnd(s) >= door.hingeZ), `ahead of the door: ${note}`).toBeTruthy();
    expect(ss.every((s) => rearEnd(s) > drawnMax), `ahead of the farthest drawn contact (z ${drawnMax.toFixed(2)}): ${note}`).toBeTruthy();
  });
});
