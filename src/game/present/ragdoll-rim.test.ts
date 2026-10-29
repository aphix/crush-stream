import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { DISC_GROUND, DISC_RADIUS, FLAT_GROUND, setGround } from "../world/ground.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { loadedRagdolls } from "./ragdoll-throws.test-util.ts";
import type { Sight } from "./spectate-cam.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
const STILL = new THREE.Vector3();
const LYING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const OPEN: () => Sight = () => ({ ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ: [] });
/** The torso's most a dummy may be under the disc's top when he is put away: the 10 mm rule at his lowest part, not 30 m down. */
const PUT_AWAY_TORSO_Y = -1.5;
const _torso = new THREE.Vector3();

async function dummies(): Promise<RagdollSystem> {
  const ragdolls = await loadedRagdolls();
  ragdolls.update(FRAME, [], true, true, null);
  return ragdolls;
}

describe("given the fleet disc's dummies, where one who falls off the rim is put away at once", () => {
  afterEach(() => setGround(null));

  it("when a dummy slides off the rim and another lies still in the middle, then the first is gone before he is 1.5 m down and the second stays out", async () => {
    setGround(DISC_GROUND);
    const ragdolls = await dummies();
    const slid = ragdolls.place(new THREE.Vector3(DISC_RADIUS - 2, 0.3, 0), LYING, new THREE.Vector3(8, 0, 0), STILL, 10, 0);
    const stayed = ragdolls.place(new THREE.Vector3(0, 0.3, 0), LYING, STILL, STILL, 10, 1);
    expect(slid >= 0 && stayed >= 0 && slid !== stayed, "both dummies are out").toBeTruthy();
    let lowestSeen = Infinity;
    let goneAt = -1;
    for (let f = 0; f < 4 * FRAME_HZ && goneAt < 0; f++) {
      ragdolls.update(FRAME, [], true, true, null);
      if (ragdolls.torso(slid, _torso, null)) lowestSeen = _torso.y;
      else goneAt = f;
    }
    expect(goneAt, `still out after 4 s, torso at ${lowestSeen.toFixed(2)} m`).toBeGreaterThanOrEqual(0);
    expect(lowestSeen, `put away with his torso ${lowestSeen.toFixed(2)} m down`).toBeGreaterThan(PUT_AWAY_TORSO_Y);
    expect(ragdolls.torso(stayed, _torso, null), "the dummy on the disc is still out").toBeTruthy();
    ragdolls.dispose();
  });

  it("when the dummy the ride-along frames falls off the rim, then the ride drops him: no shot is framed on the empty place", async () => {
    setGround(DISC_GROUND);
    const ragdolls = await dummies();
    ragdolls["spawn"]({ car: 0, p: new THREE.Vector3(DISC_RADIUS - 2, 1.2, 0), q: new THREE.Quaternion(), v: new THREE.Vector3(10, 2, 0), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
    ragdolls.follow();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180);
    let rode = 0;
    let dropped = false;
    for (let f = 0; f < 4 * FRAME_HZ && !dropped; f++) {
      ragdolls.update(FRAME, [], true, true, null);
      if (ragdolls.frameCamera(camera, FRAME, false, -1, false, 50, OPEN) === "none") dropped = true;
      else rode++;
    }
    expect(rode, `rode him ${rode} frames before he left`).toBeGreaterThan(3);
    expect(dropped, "the ride never let go of him").toBeTruthy();
    expect(ragdolls.latest(_torso), "no dummy is out").toBe(-1);
    ragdolls.dispose();
  });
});
