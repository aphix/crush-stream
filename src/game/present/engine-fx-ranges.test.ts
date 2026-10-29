import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { FxTier } from "./engine-post.ts";
import { DebrisSystem, GlassDotSystem, SparkSystem, TireSmokeSystem } from "./engine-fx.ts";
import { FountainSystem } from "./fountain-system.ts";
import { FOUNTAIN_TIER } from "./fountain-plan.ts";
import { attributesOf, drawQueued } from "./fx-uploads.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

/**
 * Every partial upload an FX pool queues (`updateRanges`, sent by three as `bufferSubData(…, array, start, count)`) lies inside its
 * attribute's array: a browser rejects one that runs past the end ("Invalid sub-length for ArrayBufferView") and the GPU keeps drawing
 * stale data. Each pool is driven past its ring's wrap and across tier changes, and read after every update, both as drawn (three
 * clears a range once it sends it) and while it is not drawn (the ranges of undrawn frames wait for the next draw).
 */

// The fx pools paint their dot sprites on a canvas; the headless run lends them one that takes any draw.
const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: "" };
const CANVAS = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const STEP = 1 / FRAME_HZ;
/** Frames each pool is driven: several turns of every ring at these spawn rates. */
const FRAMES = 900;
/** A small ring, so the drive wraps it many times. */
const RING = 37;
const TIERS: readonly FxTier[] = ["off", "minimal", "low", "high", "ultra"];
const ORIGIN = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const STILL = new THREE.Vector3();
const CAMERA = new THREE.PerspectiveCamera();
const PANE = new THREE.Vector3(0.5, 0.3, 0.05);

beforeAll(() => {
  Object.defineProperty(globalThis, "document", { value: CANVAS, configurable: true });
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, "document");
});

/** The first queued range that does not sit inside its array (whole elements, from 0 to the array's end), or null. */
function overrun(root: THREE.Object3D): string | null {
  for (const { name, attr } of attributesOf(root)) {
    for (const r of attr.updateRanges) {
      const inside = Number.isInteger(r.start) && Number.isInteger(r.count) && r.start >= 0 && r.count >= 0 && r.start + r.count <= attr.array.length;
      if (!inside) return `${name}: range ${r.start} + ${r.count} against ${attr.array.length} floats`;
    }
  }
  return null;
}

type DriveName = "debris" | "spark" | "glass" | "fountain" | "tyre smoke";

const DRIVE_CASES: readonly { name: DriveName }[] = [{ name: "debris" }, { name: "spark" }, { name: "glass" }, { name: "fountain" }, { name: "tyre smoke" }];

/** Each pool's frame driver: spawns on its own cadence, then the pool's update. */
const DRIVES: Record<DriveName, (scene: THREE.Scene) => (frame: number) => void> = {
  debris: (scene) => {
    const sys = new DebrisSystem(scene, RING);
    return (f) => {
      if (f % 5 === 0) sys.burst(ORIGIN, UP, 11 + (f % 40));
      sys.update(STEP);
    };
  },
  spark: (scene) => {
    const sys = new SparkSystem(scene, RING);
    return (f) => {
      // A tier change turns the streaks on and off (`Cinematics.setTier`).
      if (f % 45 === 0) sys.streaked = (f / 45) % 2 === 0;
      if (f % 3 === 0) sys.poof(ORIGIN, UP, 7 + (f % 50));
      sys.update(STEP);
    };
  },
  glass: (scene) => {
    const sys = new GlassDotSystem(scene, RING);
    const q = new THREE.Quaternion();
    return (f) => {
      if (f % 4 === 0) sys.burst(ORIGIN, STILL, 9 + (f % 30));
      if (f % 50 === 0) sys.shatter(ORIGIN, q, PANE, STILL, 2 * RING);
      sys.update(STEP);
    };
  },
  fountain: (scene) => {
    const sys = new FountainSystem(scene, RING);
    for (let j = 0; j < 8; j++) sys.jet(j * 2, 0, 0, j * 0.1, 1000, j < 2 ? 1.5 : 1);
    return (f) => {
      // A tier change sets the spray (`Fountains.setLook`), from nothing to the ultra show.
      if (f % 30 === 0) sys.density = FOUNTAIN_TIER[TIERS[(f / 30) % TIERS.length]!].spray * (1 + (f % 3));
      sys.update(f % 97 === 0 ? 0.25 : STEP);
    };
  },
  "tyre smoke": (scene) => {
    const sys = new TireSmokeSystem(scene, RING, true);
    return (f) => {
      if (f % 2 === 0) sys.emitAt(ORIGIN, UP, 3 + (f % 9));
      if (f % 60 === 0) sys.plume(ORIGIN, UP, 2 * RING);
      sys.update(STEP, CAMERA);
    };
  },
};

for (const { name } of DRIVE_CASES) {
  describe(`given a ${name} pool driven past its ring's wrap and across tier changes`, () => {
    it("when every frame is drawn, then every upload it queues lies inside its attribute's array", () => {
      const scene = new THREE.Scene();
      const frame = DRIVES[name](scene);
      for (let f = 0; f < FRAMES; f++) {
        frame(f);
        const bad = overrun(scene);
        expect(bad, `frame ${f}: ${bad}`).toBe(null);
        drawQueued(scene);
      }
    });

    it("when it runs undrawn for stretches, then the uploads waiting for the next draw still lie inside its arrays", () => {
      const scene = new THREE.Scene();
      const frame = DRIVES[name](scene);
      for (let f = 0; f < FRAMES; f++) {
        frame(f);
        const bad = overrun(scene);
        expect(bad, `frame ${f}: ${bad}`).toBe(null);
        if (f % 23 === 22) drawQueued(scene);
      }
    });
  });
}

describe("given a fountain pool whose spawns are not drawn for a few frames", () => {
  it("when it is drawn again, then the waiting upload covers every slot spawned since the last draw", () => {
    const scene = new THREE.Scene();
    const sys = new FountainSystem(scene, RING);
    sys.jet(0, 0, 0, 0, 1000);
    sys.update(STEP);
    drawQueued(scene);
    const from = sys["cursor"];
    for (let f = 0; f < 3; f++) sys.update(STEP);
    const spawned = sys["cursor"] - from;
    expect(spawned > 0 && from + spawned <= RING, `the control: ${spawned} slots spawned from ${from}, inside the ring`).toBeTruthy();
    const position = sys["geo"].getAttribute("position");
    must(position instanceof THREE.BufferAttribute, "position is a plain buffer");
    const covered = position.updateRanges.some((r) => r.start <= from * 3 && r.start + r.count >= (from + spawned) * 3);
    expect(covered, `ranges ${JSON.stringify(position.updateRanges)} miss slots ${from}..${from + spawned}`).toBeTruthy();
  });
});
