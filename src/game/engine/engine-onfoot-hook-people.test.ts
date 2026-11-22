import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { CHEST_HEIGHT } from "../ai/civilians/civilian-crowd-constants.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { planInterior } from "../world/openworld/interior-plan.ts";
import { activeGround } from "../world/ground.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

const LINK = "#scene=openworld&seed=beef";
const SETTLE_S = 3;
/** The cop stands this far (m) from the player along +x, and the ground point the second fire ties him to is this far. */
const COP_AHEAD_M = 6;
const GROUND_AHEAD_M = 3;
/** The house the civilian is hooked in is this far from the player (m): past the 25 m the interiors hand their floors to the physics for. */
const HOUSE_NEAR_M = 30;
const HOUSE_FAR_M = 80;
/** The eye stands this far (m) from the civilian's chest, in her room. */
const EYE_FROM_CHEST_M = 2;

let rig: OnFootRig;

beforeAll(async () => {
  rig = await OnFootRig.boot(LINK);
  rig.run(SETTLE_S);
});
beforeEach(() => {
  rig.engine["onFoot"].reset();
  rig.engine["ragdolls"].reset();
  rig.engine["race"].adoptCar(0);
  rig.sit(0);
  rig.run(0.2);
});
afterAll(() => rig.dispose());

/** On foot with the hook in hand. */
function armHook(): void {
  rig.getOut();
  rig.press("Digit0");
  rig.run(FRAME);
}

/** One fire of the real tether director from `eye` at `target`: the view turned there, the fire taken at the frame. */
function fire(eye: THREE.Vector3, target: THREE.Vector3): void {
  const camera = rig.engine["camera"];
  camera.position.copy(eye);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  rig.engine.tether.fire();
  rig.engine.tether.frame(FRAME);
}

describe("given the real engine in the open world, the hook in hand and a foot cop in front of the player", () => {
  it("when he fires at the cop and then at the ground, then the cop is down at his spot and a rope holds the dummy thrown for him", () => {
    armHook();
    const torso = rig.torso();
    const ground = activeGround().heightAt(torso.x + COP_AHEAD_M, torso.z);
    const cops = rig.engine["openWorld"]["law"]!.copPoses;
    cops.shown[0] = 1;
    cops.x[0] = torso.x + COP_AHEAD_M;
    cops.z[0] = torso.z;
    cops.feetY[0] = ground;
    const eye = new THREE.Vector3(torso.x, ground + CHEST_HEIGHT, torso.z);
    fire(eye, new THREE.Vector3(torso.x + COP_AHEAD_M, ground + CHEST_HEIGHT, torso.z));
    expect(rig.engine.tether.hud()?.pending, "the first fire holds him").toBe(true);
    expect(cops.shown[0], "he is no longer drawn standing").toBe(0);
    const slot = rig.engine["openWorld"]["hookedCop"][0]!;
    expect(slot, "a dummy thrown for him").toBeGreaterThanOrEqual(0);
    fire(eye, new THREE.Vector3(torso.x + GROUND_AHEAD_M, ground, torso.z));
    rig.run(0.5);
    expect(rig.engine.tether.hud()?.count, "a cable out").toBe(1);
    expect(rig.engine["ragdolls"].dollRoped(slot), "a rope holds his dummy").toBe(true);
    const lies = new THREE.Vector3();
    rig.engine["ragdolls"].torso(slot, lies, null);
    expect(hypot2(lies.x - (torso.x + COP_AHEAD_M), lies.z - torso.z), "his dummy lies where he stood (m)").toBeLessThan(COP_AHEAD_M);
  });
});

describe("given the real engine in the open world, the hook in hand and a civilian in a rowhome 30 to 80 m from the player", () => {
  it("when he fires at her and then at the ground, then her house's floors are held for the physics before she is stood, and a rope holds her body", () => {
    armHook();
    const torso = rig.torso();
    const world = rig.engine["openWorld"];
    const house = world["map"]!.places.find((place) => place.interior === "rowhome" && place.doorNode >= 0 && hypot2(place.x - torso.x, place.z - torso.z) > HOUSE_NEAR_M && hypot2(place.x - torso.x, place.z - torso.z) < HOUSE_FAR_M);
    expect(house, "a rowhome in range").toBeDefined();
    const poses = world["crowd"]!.poses;
    let c = -1;
    for (let resident = 0; resident < poses.count && c < 0; resident++) if (poses.shown[resident] === 1 && world["bodies"]!.slotOf(resident) < 0) c = resident;
    expect(c, "a shown civilian with no body").toBeGreaterThanOrEqual(0);
    const floor = planInterior(house!).floors[0]!;
    poses.x[c] = house!.x;
    poses.z[c] = house!.z;
    poses.feetY[c] = floor;
    poses.speed[c] = 0;
    const eye = new THREE.Vector3(house!.x - EYE_FROM_CHEST_M, floor + CHEST_HEIGHT, house!.z);
    expect(rig.engine["ragdolls"]["boxList"].length, "control: no house's floors held yet").toBe(0);
    fire(eye, new THREE.Vector3(house!.x, floor + CHEST_HEIGHT, house!.z));
    expect(rig.engine.tether.hud()?.pending, "the first fire holds her").toBe(true);
    expect(rig.engine["ragdolls"]["boxList"].length, "the house's floors are held").toBeGreaterThan(0);
    const slot = world["bodies"]!.slotOf(c);
    expect(slot, "a body stands for her").toBeGreaterThanOrEqual(0);
    fire(eye, new THREE.Vector3(house!.x, floor, house!.z - GROUND_AHEAD_M));
    rig.run(0.2);
    expect(rig.engine["ragdolls"].dollRoped(slot), "a rope holds her body").toBe(true);
  });
});
