import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { Gait } from "./walker-gait.ts";
import { Locomotion, RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "./walker-locomotion.ts";

const FRAME = 1 / FRAME_HZ;
/** The torso's centre height standing (m): the gait seeds from it. */
const STANDING_TORSO = 1.11;
const flat = () => 0;
/** A 0.18 m step across the walker's way, 1 m on. */
const STEP_AT_Z = 1;
const stepped = (_x: number, z: number) => (z > STEP_AT_Z ? 0.18 : 0);

type Ground = (x: number, z: number) => number;

const scratch = new Float64Array(1);
const words = new Uint32Array(scratch.buffer);

/** FNV-1a over the bits of `values`, folded into `hash`. */
function fold(hash: number, values: ArrayLike<number>): number {
  let h = hash;
  for (let i = 0; i < values.length; i++) {
    scratch[0] = values[i]!;
    for (const word of words) h = Math.imul(h ^ word, 16777619) >>> 0;
  }
  return h;
}

/** The gait's whole output (joint targets, torso anchor, planted points) over a walk, a turn and a stop, as one number. */
function strideDigest(command: number, ground: Ground, oldReads: boolean): number {
  const loco = new Locomotion();
  const gait = new Gait();
  if (oldReads) {
    gait["restHeight"] = (x, z, read) => read(x, z);
    gait["clearHeight"] = (x, z, read) => read(x, z);
  }
  loco.reset(0);
  gait.seed(0, STANDING_TORSO, 0, 0, ground);
  let hash = 2166136261;
  for (let f = 0; f < 6 * FRAME_HZ; f++) {
    const second = f / FRAME_HZ;
    loco.update(FRAME, second < 2 ? 0 : Math.PI / 2, second < 4.5 ? command : 0);
    gait.update(FRAME, loco, ground);
    hash = fold(fold(fold(hash, gait.targets), gait.anchor), gait.plant);
  }
  return hash;
}

const speeds: readonly { it: string; command: number }[] = [
  { it: "when he walks, turns and stops", command: WALK_SPEED },
  { it: "when he runs, turns and stops", command: RUN_SPEED },
  { it: "when he sprints, turns and stops", command: SPRINT_SPEED },
];

describe("given a gait over flat ground", () => {
  for (const testCase of speeds) {
    it(`${testCase.it}, then every output is bit for bit the one that read the floor under the heel alone`, () => {
      expect(strideDigest(testCase.command, flat, false)).toBe(strideDigest(testCase.command, flat, true));
    });
  }
});

describe("given a gait over ground with a 0.18 m step", () => {
  it("when he walks at it, then its output differs from reading the floor under the heel alone (the digest can tell the two apart)", () => {
    expect(strideDigest(WALK_SPEED, stepped, false)).not.toBe(strideDigest(WALK_SPEED, stepped, true));
  });
});
