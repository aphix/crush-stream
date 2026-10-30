import * as THREE from "three";
import { DerbyMatch, heatLimit, snapshotAiCar } from "../match/derby.ts";
import { arenaWorld, placeDerby } from "../scenes/derby-arena.test-util.ts";
import { setGround } from "../world/ground.ts";
import { applyAiDrive } from "./input-fade.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { massCentroid } from "../vehicle/test-support.ts";
import { applyDrive, carRuns, COAST } from "../vehicle/car-drive.ts";
import { EjectionWatch } from "../vehicle/ejection.ts";
import { physicsSlice } from "../contact/sat.ts";
import { settleStep, stepWorld } from "../engine/world-step.ts";
import { armKill, assignClass, carClass, HANDLING } from "../vehicle/vehicle-classes.ts";
import { INITIAL_HUD } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { zipBound } from "../contact/zip-bound.test-util.ts";
import { SPIN_RATE_BAR, verticalTurn } from "./vertical-turn.test-util.ts";

export type Field = {
  seed: number;
  deaths: number[];
  contactSpins: string[];
  freeSpins: string[];
  /** Peak heading rate over any 0.1 s inside 0.5 s of a pair contact, in the first 2 min. */
  contactPeak: { rate: number; note: string };
  zips: string[];
  /** Largest zip, in metres (0 when none). */
  zipMax: number;
};


/** A watcher on a heat: `step` after every physics slice of `h` s at match time `t`, `pair` on every car pair in contact. */
export type FieldWatch = {
  step?: (cars: DeformableCar[], t: number, h: number) => void;
  pair?: (a: number, b: number) => void;
};

/**
 * A derby of `n` AI cars through the engine's stack (`stepWorld` then `settleStep` each slice, with the derby's hit credit, arena and ejection watch,
 * cars dressed as `dressCar` does at the game's defaults), at the default slider, to the end of the heat or to match second `until`.
 * Spins: turn rate about the vertical (`verticalTurn`) > `SPIN_RATE_BAR` for > 0.2 s in the first 2 min, split by a contact in the 0.5 s before it was counted: a car, or a prop or wall of the arena (a crash's spin, not the AI's own driving).
 * Zips: a live mass centroid moving more than 3·v·h + 5 cm in a step.
 */
export function runField(n: number, seed: number, on?: FieldWatch, until = Infinity): Field {
  try {
    return runFieldHeat(n, seed, on, until);
  } finally {
    setGround(null);
  }
}

function runFieldHeat(n: number, seed: number, on: FieldWatch | undefined, until: number): Field {
  const scene = new THREE.Scene();
  const cars = Array.from({ length: n }, (_, i) => new DeformableCar({ body: 0xc5c8ce, accent: 0x9aa0a8, name: `c${i}` }, scene, null, fleetStyle(i)));
  const match = new DerbyMatch();
  match.begin(
    cars.map((_, i) => ({ id: i, name: `c${i}` })),
    { seed },
  );
  /** Per car: the match time of its last pair hit (`contactPeak`), and of its last contact with anything solid: a car, or a prop or wall of the arena (`PropHits`). A spin within 0.5 s of the second is the crash's, not the AI's own driving. */
  const touched = new Array<number>(n).fill(-9);
  const struck = new Array<number>(n).fill(-9);
  const { world: w } = arenaWorld(cars, {
    knock: (_prop, car) => {
      struck[car] = t;
    },
    fx: () => {},
    wall: (_prop, car) => {
      struck[car] = t;
    },
  });
  const ejections = new EjectionWatch();
  ejections.ctx = "derby";
  w.ejection = ejections;
  placeDerby(cars, seed);
  for (const c of cars) {
    c.deform.squash = INITIAL_HUD.squash;
    c.deform.buckle = INITIAL_HUD.buckle;
    c.deform.setMode(INITIAL_HUD.deformMode);
    const cls = carClass(c);
    assignClass(c, cls);
    armKill(c.deform, cls, HANDLING.realism, "derby");
  }
  const out: Field = {
    seed,
    deaths: [],
    contactSpins: [],
    freeSpins: [],
    zips: [],
    zipMax: 0,
    contactPeak: { rate: 0, note: "none" },
  };
  /** Per car: its orientation one step ago, and the turn about the vertical it has made since the start (rad, unwrapped). */
  const lastTurn = cars.map((c) => c.group.quaternion.clone());
  const heading = new Array<number>(n).fill(0);
  const spinFor = new Array<number>(n).fill(0);
  /** Per car: [t, heading] pairs spanning about 0.1 s, for the contact peak. */
  const ring = cars.map((): number[] => []);
  const alive = new Array<boolean>(n).fill(true);
  // Match time: negative through the start lights, 0 at green.
  let t = match.time;
  let state = "running";
  const end = Math.min(heatLimit(n) + 1, until);
  while (t < end && state === "running") {
    let vmax = 8;
    for (const c of cars) vmax = Math.max(vmax, c.speed);
    const h = physicsSlice(1 / FRAME_HZ, vmax);
    const before = cars.map((c) => (c.deform.massActive ? massCentroid(c.deform.masses) : null));
    const speed0 = cars.map((c) => Math.hypot(c.velocity.x, c.velocity.z));
    const shove = new Array<number>(n).fill(0);
    const snaps = match.snapshots(n);
    for (const [i, c] of cars.entries()) snapshotAiCar(snaps[i]!, i, c, carRuns(c));
    for (const [i, c] of cars.entries()) {
      if (c.driverOut !== null) {
        applyDrive(c, COAST, h);
        continue;
      }
      applyAiDrive(c, match.think(snaps[i]!, snaps, h), h);
    }
    w.pairHit = (a, b, pair) => {
      on?.pair?.(a, b);
      const ca = cars[a]!;
      const cb = cars[b]!;
      touched[a] = t;
      touched[b] = t;
      struck[a] = t;
      struck[b] = t;
      shove[a] = Math.max(shove[a]!, speed0[b]!);
      shove[b] = Math.max(shove[b]!, speed0[a]!);
      const aInto = -(ca.velocity.x * pair.normal.x + ca.velocity.z * pair.normal.z);
      const bInto = cb.velocity.x * pair.normal.x + cb.velocity.z * pair.normal.z;
      match.noteHit(a, b, aInto, bInto, pair.impulse);
    };
    stepWorld(w, h);
    // The engine drains the watch's throws each step; a thrown driver's car coasts above.
    ejections.take();
    // No bleed: the engine's derby never starts the crash clock.
    settleStep(cars, h, false);
    state = match.step(
      h,
      cars.map((c, i) => ({ id: i, name: `c${i}`, alive: carRuns(c), x: c.group.position.x, z: c.group.position.z })),
    );
    on?.step?.(cars, t, h);
    for (const [i, c] of cars.entries()) {
      if (alive[i] && !c.deform.drivetrainAlive) out.deaths.push(+t.toFixed(1));
      alive[i] = c.deform.drivetrainAlive;
      const dyaw = verticalTurn(lastTurn[i]!, c.group.quaternion);
      lastTurn[i]!.copy(c.group.quaternion);
      heading[i]! += dyaw;
      if (Math.abs(dyaw) / h > SPIN_RATE_BAR) spinFor[i]! += h;
      else spinFor[i] = 0;
      if (spinFor[i]! > 0.2 && spinFor[i]! - h <= 0.2 && t < 120) {
        const note = `t=${t.toFixed(1)} c${i} ${(Math.abs(dyaw) / h).toFixed(1)} rad/s`;
        (t - struck[i]! < 0.5 ? out.contactSpins : out.freeSpins).push(note);
      }
      const rb = ring[i]!;
      rb.push(t, heading[i]!);
      while (rb.length > 4 && rb[2]! <= t - 0.1) rb.splice(0, 2);
      if (t - rb[0]! >= 0.099 && t - touched[i]! < 0.5 && t < 120) {
        const rate = Math.abs(heading[i]! - rb[1]!) / (t - rb[0]!);
        if (rate > out.contactPeak.rate) out.contactPeak = { rate, note: `c${i} ${rate.toFixed(2)} rad/s at t=${t.toFixed(1)}` };
      }
      const a = before[i];
      if (!a || !c.deform.massActive || t >= 120) continue;
      const b = massCentroid(c.deform.masses);
      const moved = Math.hypot(b.x - a.x, b.z - a.z);
      const vMax = Math.max(speed0[i]!, Math.hypot(c.velocity.x, c.velocity.z), shove[i]!);
      if (moved > zipBound(vMax, h)) {
        out.zips.push(`t=${t.toFixed(2)} c${i} ${moved.toFixed(2)} m`);
        out.zipMax = Math.max(out.zipMax, moved);
      }
    }
    t += h;
  }
  return out;
}
