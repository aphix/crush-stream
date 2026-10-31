import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { PARTS } from "./ragdoll-body.ts";
import { WALKER_SLOT } from "./ragdoll-pool.ts";
import { limbThrough } from "./ragdoll-tangle.test-util.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { RUN_SPEED } from "./walker-locomotion.ts";

const FRAME = 1 / FRAME_HZ;
/** Placed in a dress, a figure's arms hang (`PARTS` as he stands). */
const DRESS = { cop: false, look: driverLook(0, 0) };
const STILL = new THREE.Vector3();
/** How long (s) a limb may stay through the other's chest, and how long it is watched: without the untangle it stays the whole watch. */
const FREED_WITHIN = 1.5;
const WATCH_SECONDS = 3;
/** How long (s) the walker's legs may stay in the chest he was stood in: found stuck in 0.15-0.27 s, then stepped out at no more than a walk. */
const WALKER_OUT_WITHIN = 0.5;
/** The fastest (m/s) any part of either may move while they part: a run; a pop flings parts faster. */
const NO_POP_SPEED = RUN_SPEED;
/** The lying dummy settles this long (s) before the walker is stood in his chest. */
const SETTLE_SECONDS = 0.6;
/** His foot's middle (m) no higher than its half height plus half a lying arm's 10 cm: down on the ground, not on an arm. */
const FOOT_ON_GROUND = PARTS[10].h[1] + 0.05;

type Pose = readonly [p: readonly [number, number, number], q: readonly [number, number, number, number]];

/**
 * A dummy lying still on the ground (`lying`, slot 0) and another placed (`placed`, slot 1, from rest) with a limb through his chest.
 * Each row's limb stays in past `FREED_WITHIN` without any one of the mechanisms its comment names.
 */
const tangleCases: readonly { it: string; lying: Pose; placed: Pose }[] = [
  {
    // The axis detection, the shared face, the half-speed-each push, the contact set aside.
    it: "one dropped with his right foot down through the chest of one lying on his back",
    lying: [[0, 0.115, 0], [0.6800757361606833, 0.1936414033348878, 0.19364140333488777, -0.6800757361606834]],
    placed: [[0.3933448400003732, 0.7474135928322682, 0.7039636752536774], [0.21059119203441407, -0.39175379476123173, -0.4202554841224212, 0.7909270776707097]],
  },
  {
    // The box's shallowest clear face (not the round shapes' nearest-or-far), left across the foot's axis.
    it: "one dropped with his left foot down through the chest of one lying on his back",
    lying: [[0, 0.115, 0], [-0.3799564861530433, 0.5963497871469665, 0.5963497871469664, 0.37995648615304334]],
    placed: [[0.6716436246816648, 0.8825752331424517, -0.5143114768409272], [0.37254626589737166, 0.6655317570034197, -0.049228613926947995, -0.6448668884015502]],
  },
  {
    // The axis detection, across the arm's axis, no face that pushes the chest into the ground (pinned), the contact set aside.
    it: "one with his right arm through the chest of one lying on his side",
    lying: [[0, 0.185, 0], [0.5150126824130341, 0.5150126824130342, 0.4845223802403054, 0.48452238024030553]],
    placed: [[-0.14961242639129574, 0.2602309626564484, -0.08492067789619734], [-0.6721250805950216, 0.48065329065890805, -0.3086372405403258, -0.4711298589195467]],
  },
];

let system: RagdollSystem;

beforeEach(async () => {
  system = await flatSystem();
  system.reset();
});

afterEach(() => {
  system.dispose();
});

function place([p, q]: Pose, slot: number): void {
  system.place(new THREE.Vector3(...p), new THREE.Quaternion(...q), STILL, STILL, Infinity, slot, DRESS);
}

/** The longest (s) any limb of slot 1 stays through slot 0's chest over `WATCH_SECONDS`. */
function longestThrough(): number {
  const [lying, placed] = system["dolls"];
  let inside = 0;
  let longest = 0;
  for (let f = 0; f < WATCH_SECONDS * FRAME_HZ; f++) {
    system.update(FRAME, [], true, true, null);
    let through = false;
    for (let k = 2; k < PARTS.length && !through; k++) through = limbThrough(placed!.bodies[k]!, k, lying!.bodies[0]!);
    inside = through ? inside + FRAME : 0;
    longest = Math.max(longest, inside);
  }
  return longest;
}

describe("given a dummy lying on the ground and another placed with a limb through his chest", () => {
  for (const tangle of tangleCases) {
    it(`when ${tangle.it}, then the limb is out of the chest within ${FREED_WITHIN} s`, () => {
      place(tangle.lying, 0);
      place(tangle.placed, 1);
      const longest = longestThrough();
      expect(longest, `the limb stayed through the chest for ${longest.toFixed(2)} s`).toBeLessThan(FREED_WITHIN);
    });
  }
});

describe("given a dummy lying on his back and the player's walker stood with both feet in his chest", () => {
  it(`when he stands there, then his legs are out of the chest within ${WALKER_OUT_WITHIN} s, no part moving faster than a run, and he is on his feet on the ground`, () => {
    place([[0, 0.12, 0], [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]], 0);
    for (let f = 0; f < SETTLE_SECONDS * FRAME_HZ; f++) system.update(FRAME, [], true, true, null);
    const lying = system["dolls"][0]!;
    const chest = lying.bodies[0]!.translation();
    system.startWalker(new THREE.Vector3(chest.x, 0, chest.z), Math.PI / 2, DRESS);
    const walker = system["dolls"][WALKER_SLOT]!;
    let inside = 0;
    let longest = 0;
    let fastest = 0;
    for (let f = 0; f < WATCH_SECONDS * FRAME_HZ; f++) {
      system.update(FRAME, [], true, true, null);
      let through = false;
      for (let k = 2; k < PARTS.length && !through; k++) through = limbThrough(walker.bodies[k]!, k, lying.bodies[0]!);
      inside = through ? inside + FRAME : 0;
      longest = Math.max(longest, inside);
      for (const doll of [walker, lying]) {
        for (const body of doll.bodies) {
          const v = body.linvel();
          fastest = Math.max(fastest, Math.hypot(v.x, v.y, v.z));
        }
      }
    }
    expect(longest, `his legs stayed in the chest for ${longest.toFixed(2)} s`).toBeLessThan(WALKER_OUT_WITHIN);
    expect(fastest, `a part moved at ${fastest.toFixed(2)} m/s`).toBeLessThan(NO_POP_SPEED);
    expect(system.walker.state, "he stepped out on his feet").toBe("stand");
    for (const k of [10, 11]) expect(walker.bodies[k]!.translation().y, "his feet came down on the ground, not on the lying dummy's arm").toBeLessThan(FOOT_ON_GROUND);
  });
});

describe("given a dummy alone in the dummies' world, its ground taken out", () => {
  it("when he falls through where it was, then looking for what his parts are inside of finds nothing and does not throw", () => {
    place([[0, 1.2, 0], [0, 0, 0, 1]], 0);
    for (const c of system["statics"]) system["world"]!.removeCollider(c, false);
    system["statics"].length = 0;
    expect(() => {
      for (let f = 0; f < FRAME_HZ; f++) system.update(FRAME, [], true, true, null);
    }).not.toThrow();
    expect(system["dolls"][0]!.bodies[0]!.translation().y, "nothing holds him up: he falls past where the ground was").toBeLessThan(-1);
  });
});
