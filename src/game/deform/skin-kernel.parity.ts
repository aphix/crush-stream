import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { arenaWorld, placeDerby } from "../scenes/derby-arena.test-util.ts";
import { setGround } from "../world/ground.ts";
import { fleetClass, fleetStyle, layoutFleet } from "../scenes/fleet.ts";
import { physicsSlice, sliceSpeed } from "../contact/sat.ts";
import { newWorld, settleStep, stepWorld } from "../engine/world-step.ts";
import { SkinKernel, skinKernel, type SkinDynamic } from "./skin-kernel.ts";
import { TyreSagArena } from "./tyre-sag-kernel.ts";
import { TyreSkin } from "../vehicle/car-tyre-skin.ts";
import { loadSkinKernelForTest } from "./skin-kernel.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { must } from "../kernel/must.test-util.ts";

/**
 * The WASM skin (kernels/skin) is the JS skin's exact bits. The engine's own frame loop (accumulator of fixed steps,
 * `stepWorld`, `settleStep`, then `updateSkin` per car) runs the same seeded scenario twice: with no kernel loaded
 * (every car skins in JS), then with it. Every car's body and bonnet position and normal attribute (and their versions and the skin
 * flag) is hashed each frame, and the final arrays are compared element by element. The tyre hold's plan grid and sag pass run in the kernel too.
 */

type Seen = Record<"skins" | "wrinkled" | "hubs" | "lattice" | "deep" | "held" | "sagRaised", number>;
type Scenario = {
  label: string;
  derby: boolean;
  cars: number;
  frames: number;
  /** Runs before each frame. */
  setup?: (cars: DeformableCar[], frame: number) => void;
  /** What the JS leg must have seen, or the scenario does not exercise the branch it is named for. */
  covers: (keyof Seen)[];
};
type Leg = { digests: number[]; final: Float32Array[]; seen: Seen };

const popHub = (cars: DeformableCar[], frame: number): void => {
  if (frame !== 30) return;
  for (const car of cars.slice(0, 3)) {
    const hub = car.deform.masses.find((m) => m.name === "hubFL");
    if (hub) car.deform.popHub(hub);
  }
};

const SCENARIOS: Scenario[] = [
  { label: "a 10-car fleet pile-up with the shape-matching skin and wrinkling", derby: false, cars: 10, frames: 240, covers: ["skins", "wrinkled", "held", "sagRaised"] },
  { label: "a 10-car derby", derby: true, cars: 10, frames: 300, covers: ["skins", "wrinkled", "held", "sagRaised"] },
  {
    label: "6 cars of which two are in lattice mode",
    derby: false,
    cars: 6,
    frames: 200,
    setup: (cars, frame) => {
      if (frame === 0) for (const i of [0, 3]) cars[i]!.deform.setMode("lattice");
    },
    covers: ["skins", "lattice", "held", "sagRaised"],
  },
  {
    label: "6 cars of which one is a deep-crush car that dents in both directions",
    derby: true,
    cars: 6,
    frames: 200,
    setup: (cars, frame) => {
      if (frame === 0) {
        cars[0]!.deform.deepCrush = true;
        cars[0]!.deform.bidirectional = true;
      }
    },
    covers: ["skins", "deep", "held", "sagRaised"],
  },
  { label: "6 cars of which three lose a front-left wheel hub at frame 30", derby: false, cars: 6, frames: 200, setup: popHub, covers: ["skins", "hubs", "held", "sagRaised"] },
];

const FNV = 16777619;

/** The meshes' arrays hashed and compared each frame: the body skin and the bonnet's, which the tyre hold also lifts. */
const HASHED = [
  ["body", "position"],
  ["body", "normal"],
  ["hood", "position"],
  ["hood", "normal"],
] as const;

function numberField(o: object, key: string): number {
  const v: unknown = Reflect.get(o, key);
  if (typeof v !== "number") throw new Error(`${key} is a ${typeof v}, not a number`);
  return v;
}

function playScenario(s: Scenario): Leg {
  const scene = new THREE.Scene();
  const cars = Array.from({ length: s.cars }, (_, i) => new DeformableCar({ body: 0xc5c8ce, accent: 0x9aa0a8, name: `c${i}` }, scene, null, fleetStyle(i)));
  for (const [i, c] of cars.entries()) assignClass(c, fleetClass(i));
  if (s.derby) placeDerby(cars, 11, 12);
  else {
    let seed = 11;
    const slots = layoutFleet(s.cars, 18, 28, () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646);
    for (const [i, c] of cars.entries()) c.spawn(slots[i]!.x, slots[i]!.z, slots[i]!.speed);
  }
  const inputs: DriveInput[] = cars.map(() => ({ ...idleDrive(), throttle: 1 }));
  const world = s.derby ? arenaWorld(cars).world : newWorld(cars);
  const seen: Seen = { skins: 0, wrinkled: 0, hubs: 0, lattice: 0, deep: 0, held: 0, sagRaised: 0 };
  const digests: number[] = [];
  let acc = 0;
  for (let f = 0; f < s.frames; f++) {
    s.setup?.(cars, f);
    const vmax = sliceSpeed(cars);
    acc = Math.min(0.05, acc + 1 / FRAME_HZ);
    for (let n = 0; acc > 1e-5 && n < 8; n++) {
      const h = physicsSlice(acc, vmax);
      if (s.derby) {
        for (let i = 0; i < cars.length; i++) {
          const c = cars[i]!;
          const p = c.group.position;
          inputs[i]!.steer = c.fwdFlat.x * -p.z - c.fwdFlat.z * -p.x > 0 ? -1 : 1;
          if (c.deform.drivetrainAlive) applyDrive(c, inputs[i]!, h);
        }
      }
      stepWorld(world, h);
      settleStep(cars, h, true);
      acc -= h;
    }
    for (const c of cars) c.updateSkin();
    let hash = 0x811c9dc5;
    for (const c of cars) {
      const d = c.deform;
      if (d.skinnedThisFrame) {
        seen.skins++;
        if (numberField(d, "wrinkleAmp") * Math.min(1, numberField(d, "elapsed") * 6) > 0.02) seen.wrinkled++;
        if (d.mode === "lattice") seen.lattice++;
        if (d.deepCrush) seen.deep++;
        const hubOf: unknown = Reflect.get(d, "skinHub");
        must(hubOf instanceof Int32Array, "hubOf instanceof Int32Array");
        if (d.masses.some((m, j) => m.popped && hubOf.includes(j))) seen.hubs++;
      }
      if (c["bodyTyres"]?.["held"] || c["hoodTyres"]?.["held"]) seen.held++;
      hash = Math.imul(hash ^ (d.skinnedThisFrame ? 1 : 0), FNV);
      for (const [mesh, name] of HASHED) {
        const a = c.lookMeshes()[mesh].geometry.getAttribute(name) as THREE.BufferAttribute;
        const words = new Uint32Array(a.array.buffer, 0, a.array.length);
        for (let i = 0; i < words.length; i++) hash = Math.imul(hash ^ words[i]!, FNV);
        hash = Math.imul(hash ^ a.version, FNV);
      }
    }
    digests.push(hash >>> 0);
  }
  const final = cars.flatMap((c) => HASHED.map(([mesh, name]) => Float32Array.from(c.lookMeshes()[mesh].geometry.getAttribute(name).array)));
  setGround(null);
  return { digests, final, seen };
}

/** `playScenario` with every tyre-hold sag pass that lifted a corner counted into the leg's `seen.sagRaised`. */
function play(s: Scenario): Leg {
  const sagRaised = { count: 0 };
  const real = TyreSkin.prototype["liftSaggingTriangles"];
  TyreSkin.prototype["liftSaggingTriangles"] = function (this: TyreSkin, ...args: Parameters<typeof real>) {
    const raised = real.apply(this, args);
    if (raised) sagRaised.count++;
    return raised;
  };
  try {
    const leg = playScenario(s);
    leg.seen.sagRaised = sagRaised.count;
    return leg;
  } finally {
    TyreSkin.prototype["liftSaggingTriangles"] = real;
  }
}

/** `play` with every `SkinKernel.run`, tyre sag pass and kernel-built plan grid counted, and `mutate` (a deliberately wrong input) applied before each skin run. */
function playOnKernel(s: Scenario, mutate?: (d: SkinDynamic) => void): { leg: Leg; runs: number; tyreCalls: { sagPasses: number; planGrids: number } } {
  const real = SkinKernel.prototype.run;
  const realSag = TyreSagArena.prototype.sagPass;
  const realPlan = TyreSagArena.prototype.planGrid;
  let runs = 0;
  const tyreCalls = { sagPasses: 0, planGrids: 0 };
  SkinKernel.prototype.run = function (this: SkinKernel, ...args: Parameters<SkinKernel["run"]>) {
    runs++;
    mutate?.(args[1]);
    return real.apply(this, args);
  };
  TyreSagArena.prototype.sagPass = function (this: TyreSagArena, ...args: Parameters<TyreSagArena["sagPass"]>) {
    tyreCalls.sagPasses++;
    return realSag.apply(this, args);
  };
  TyreSagArena.prototype.planGrid = function (this: TyreSagArena, ...args: Parameters<TyreSagArena["planGrid"]>) {
    const grid = realPlan.apply(this, args);
    if (grid) tyreCalls.planGrids++;
    return grid;
  };
  try {
    return { leg: play(s), runs, tyreCalls };
  } finally {
    SkinKernel.prototype.run = real;
    TyreSagArena.prototype.sagPass = realSag;
    TyreSagArena.prototype.planGrid = realPlan;
  }
}

describe("given the WASM skin kernel (the compiled skin and normals maths), loaded after the JS skin has played each scenario", () => {
  const js = new Map<Scenario, Leg>();
  beforeAll(async () => {
    expect(skinKernel(), "the JS legs run before the kernel loads").toBe(null);
    for (const s of SCENARIOS) js.set(s, play(s));
    await loadSkinKernelForTest();
    expect(skinKernel(), "the kernel loaded").toBeTruthy();
  });

  for (const s of SCENARIOS) {
    it(`when it plays ${s.label}, then every frame's skin, bonnet and normals are bit-for-bit the JS skin's`, () => {
      const ref = js.get(s)!;
      for (const key of s.covers) expect(ref.seen[key], `the scenario never skinned with ${key}`).toBeGreaterThan(0);
      const { leg, runs, tyreCalls } = playOnKernel(s);
      expect(runs, `${runs} kernel runs for ${ref.seen.skins} skinned car-frames: some skins stayed in JS`).toBeGreaterThanOrEqual(ref.seen.skins);
      expect(tyreCalls.sagPasses >= ref.seen.sagRaised && tyreCalls.planGrids > 0, `${tyreCalls.sagPasses} sag passes and ${tyreCalls.planGrids} plan grids built in the kernel: the hold stayed in JS`).toBeTruthy();
      expect(leg.seen.held, "car-frames with a tyre hold that moved the skin").toBe(ref.seen.held);
      expect(leg.seen.sagRaised, "sag passes that lifted a corner").toBe(ref.seen.sagRaised);
      assertSameNumbers(leg.digests, ref.digests, "per-frame digest");
      expect(leg.final.length).toBe(ref.final.length);
      for (const [i, a] of leg.final.entries()) assertSameNumbers(a, ref.final[i]!, `car ${Math.floor(i / HASHED.length)} ${HASHED[i % HASHED.length]!.join(" ")}`);
    });
  }

  it("when the kernel is told to drop one parameter (the deformation mode), then at least one frame's digest differs from the JS skin's, so the comparison can fail", () => {
    const s = SCENARIOS[0]!;
    const { leg } = playOnKernel(s, (d) => {
      d.params[8] = 0;
    });
    expect(leg.digests.some((h, f) => h !== js.get(s)!.digests[f]), "a kernel reading the lattice branch in shape mode must not match").toBeTruthy();
  });

  it("when the sag pass is handed tyres a fifth larger than the car's, then at least one frame's digest differs from the JS hold's, so the hold comparison can fail", () => {
    const s = SCENARIOS[0]!;
    const real = TyreSagArena.prototype.sagPass;
    TyreSagArena.prototype.sagPass = function (this: TyreSagArena, skin, pos, wheel, tyre) {
      return real.call(this, skin, pos, wheel, { r: tyre.r * 1.2, halfW: tyre.halfW });
    };
    try {
      const { leg } = playOnKernel(s);
      expect(leg.digests.some((h, f) => h !== js.get(s)!.digests[f]), "a sag pass over larger tyres must not match").toBeTruthy();
    } finally {
      TyreSagArena.prototype.sagPass = real;
    }
  });
});
