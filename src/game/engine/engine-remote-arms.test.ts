import * as THREE from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { detCos, detSin, hypot3 } from "../kernel/physics-core.js";
import { driverLook } from "../present/driver-look.ts";
import { WALKER_SLOT } from "../present/ragdoll-pool.ts";
import { activeGround } from "../world/ground.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";
import { OpenWorldPlayers } from "./openworld-players.ts";
import { BODY_KIND, makeBodyFrame, SHOT_COUNT_MASK, shotsOfArms, weaponOfArms } from "../net/body-codec.ts";

const LINK = "#scene=openworld&seed=beef";
const SETTLE_S = 3;
/** The other player's body stands in this pool slot, as this car's player. */
const OTHER_SLOT = 1;
const OTHER_CAR = 1;
const RIFLE_SLOT = 3;
const FISTS_SLOT = 0;
/** The body stands this far (m) beside the local walker. */
const ASIDE_M = 3;
/** How long (s) a held arm takes to settle. */
const ARM_SETTLE_S = 1;
/** The most (m) a body's raised hand may stand from where the local walker's own raised hand stands, relative to its torso and facing. */
const HAND_GAP_M = 0.1;
/** The least (m) the rifle's hand is higher than the hanging one, relative to the torso. */
const RAISED_OVER_HUNG_M = 0.25;
/** The hand's rest point on the arm's part, as the engine reads it (m). */
const HAND_REST = new THREE.Vector3(0.24, 0.79, 0);
const SHOT_AHEAD_M = 20;
const SHOT_UP_M = 0.4;
/** The most (degrees) the drawn barrel may lie off the line from its tip to the shot's far end, and the most (m) its drawn tip may be from the muzzle the flash sits at. */
const BORE_GAP_DEG = 0.1;
const TIP_GAP_M = 0.05;

let rig: OnFootRig;
let table: OpenWorldPlayers;

beforeAll(async () => {
  rig = await OnFootRig.boot(LINK);
  rig.run(SETTLE_S);
  rig.getOut();
  const torso = rig.torso();
  const spot = new THREE.Vector3(torso.x + ASIDE_M, 0, torso.z);
  spot.y = activeGround().heightAt(spot.x, spot.z);
  rig.engine["ragdolls"].startWalker(spot, rig.walker().heading, { cop: false, look: driverLook(1, 0) }, OTHER_SLOT);
  rig.run(1);
});
afterEach(() => {
  Reflect.deleteProperty(rig.engine["openWorld"], "playerArms");
  Reflect.deleteProperty(rig.engine["openWorld"], "playerSlot");
});
afterAll(() => rig.dispose());

/** The engine reads the other player from `table`: standing, holding weapon slot `slot`, his body in `OTHER_SLOT`. */
function otherHolds(slot: number): void {
  table = new OpenWorldPlayers(1000);
  table.armsSeen[OTHER_CAR] = 1;
  table.armsWeapon[OTHER_CAR] = slot;
  Object.defineProperty(rig.engine["openWorld"], "playerArms", { get: () => table, configurable: true });
  rig.engine["openWorld"].playerSlot = (car: number) => (car === OTHER_CAR ? OTHER_SLOT : -1);
}

/** Where the right hand of the body in `slot` is, across (right), up and ahead of its torso, turned by its facing: the same in any body's own frame. */
function handOf(slot: number, facing: number): { ahead: number; right: number; up: number } {
  const hand = rig.engine["ragdolls"].pickMesh.partPoint(slot, 5, HAND_REST, new THREE.Vector3());
  const torso = new THREE.Vector3();
  rig.engine["ragdolls"].torso(slot, torso, null);
  const dx = hand.x - torso.x;
  const dz = hand.z - torso.z;
  return { ahead: dx * detSin(facing) + dz * detCos(facing), right: dx * detCos(facing) - dz * detSin(facing), up: hand.y - torso.y };
}

/** The local walker's hand with weapon key `key` held, and the other body's with record slot `slot`, after the arms settle. */
function bothHands(key: string, slot: number) {
  rig.press(key);
  otherHolds(slot);
  rig.run(ARM_SETTLE_S);
  const ragdolls = rig.engine["ragdolls"];
  return { local: handOf(WALKER_SLOT, ragdolls.walker.facing), other: handOf(OTHER_SLOT, ragdolls.walkers[OTHER_SLOT]!.facing) };
}

describe("given the host's body on a guest's machine, the host's record naming his weapon", () => {
  it("when it names the rifle, then the body's right hand is raised to within 10 cm of where the local walker's is with the rifle in hand, relative to the torso", () => {
    const { local, other } = bothHands("Digit4", RIFLE_SLOT);
    expect(hypot3(other.ahead - local.ahead, other.right - local.right, other.up - local.up), "metres between the two hands").toBeLessThanOrEqual(HAND_GAP_M);
  });

  it("when it names fists, then the hand hangs: within 10 cm of the local walker's with fists, and at least 25 cm lower than the rifle's", () => {
    const raised = bothHands("Digit4", RIFLE_SLOT).other;
    const { local, other } = bothHands("Digit1", FISTS_SLOT);
    expect(hypot3(other.ahead - local.ahead, other.right - local.right, other.up - local.up), "metres between the two hands").toBeLessThanOrEqual(HAND_GAP_M);
    expect(raised.up - other.up, "metres the rifle's hand is higher").toBeGreaterThanOrEqual(RAISED_OVER_HUNG_M);
  });
});

describe("given the host's rifle shot on a guest's machine, 20 m ahead and 0.4 m up from his body", () => {
  it("when his shot counter steps, then the flash sits at the drawn gun's tip and the gun's bore points at the shot's far end to within a tenth of a degree", () => {
    bothHands("Digit4", RIFLE_SLOT);
    const ragdolls = rig.engine["ragdolls"];
    const facing = ragdolls.walkers[OTHER_SLOT]!.facing;
    const torso = new THREE.Vector3();
    ragdolls.torso(OTHER_SLOT, torso, null);
    table.armsFar.set([torso.x + detSin(facing) * SHOT_AHEAD_M, torso.y + SHOT_UP_M, torso.z + detCos(facing) * SHOT_AHEAD_M], 3 * OTHER_CAR);
    rig.run(FRAME);
    table.armsShots[OTHER_CAR] = 1;
    rig.run(FRAME);
    const guns = rig.engine["remoteGuns"];
    const mesh = guns["meshes"][OTHER_CAR]!;
    const muzzle = new THREE.Vector3().fromArray(guns["shots"].muzzles, 3 * OTHER_CAR);
    const far = new THREE.Vector3().fromArray(table.armsFar, 3 * OTHER_CAR);
    const e = mesh.matrix.elements;
    const barrel = new THREE.Vector3(-e[4]!, -e[5]!, -e[6]!);
    expect(guns["shots"].firing, "control: a flash is lit").toBe(true);
    expect((barrel.angleTo(far.clone().sub(muzzle)) * 180) / Math.PI, "degrees between the bore and the line from the flash to the far end").toBeLessThanOrEqual(BORE_GAP_DEG);
    const position = mesh.geometry.getAttribute("position");
    const aim = far.clone().sub(muzzle).normalize();
    const vertex = new THREE.Vector3();
    const tip = new THREE.Vector3();
    let farthest = -Infinity;
    for (let at = 0; at < position.count; at++) {
      vertex.fromBufferAttribute(position, at).applyMatrix4(mesh.matrix);
      const along = vertex.sub(muzzle).dot(aim);
      if (along <= farthest) continue;
      farthest = along;
      tip.copy(vertex).add(muzzle);
    }
    expect(tip.distanceTo(muzzle), "metres from the drawn tip to the flash").toBeLessThanOrEqual(TIP_GAP_M);
  });
});

/** The pistol's weapon slot, the metres a drawn tracer's end may stand from the far end the frame carries, and how far (m) another player's drawn gun may stand from his body's hand. */
const PISTOL_SLOT = 1;
const FAR_END_GAP_M = 0.01;
const GRIP_GAP_M = 0.05;
/** A tracer lives this long (s): the freshest is the one with the least age. */
const TRACER_LIFE_S = 0.07;

describe("given the host on foot in the real engine, the frame he writes for his guests", () => {
  /** The host's own record in the frame `writeBodies` fills now: the arms byte and the far end of his latest shot. */
  function ownRecord(): { weapon: number; shots: number; far: THREE.Vector3 } {
    const frame = makeBodyFrame();
    rig.engine["openWorld"].writeBodies(frame);
    const own = rig.engine["ownCar"]();
    for (let at = 0; at < frame.count; at++) {
      if (frame.kind[at] !== BODY_KIND.player || frame.id[at] !== own) continue;
      return { weapon: weaponOfArms(frame.arms[at]!), shots: shotsOfArms(frame.arms[at]!), far: new THREE.Vector3().fromArray(frame.armsFar, 3 * at) };
    }
    throw new Error("the host's own record is not in the frame he writes");
  }

  it("when he takes the pistol (2) and fires once, then his own record names weapon slot 1 with one more shot and the far end his own tracer was drawn to", () => {
    rig.press("Digit2");
    rig.run(ARM_SETTLE_S);
    const before = ownRecord();
    expect(before.weapon, "the weapon slot in his record with the pistol in hand").toBe(PISTOL_SLOT);
    rig.engine["onFoot"].arms.press();
    rig.engine["onFoot"].arms.release();
    const after = ownRecord();
    expect(after.shots, "his shot counter after one shot").toBe((before.shots + 1) & SHOT_COUNT_MASK);
    const tracers = rig.engine["playerShots"];
    let fresh = 0;
    for (let k = 1; k < tracers["tracerAge"].length; k++) if (tracers["tracerAge"][k]! < tracers["tracerAge"][fresh]!) fresh = k;
    expect(tracers["tracerAge"][fresh], "control: a tracer was drawn just now").toBeLessThan(TRACER_LIFE_S);
    const drawn = new THREE.Vector3().fromArray(tracers["tracerAt"], 6 * fresh + 3);
    expect(drawn.distanceTo(after.far), "metres from the tracer's end to the far end in his record").toBeLessThanOrEqual(FAR_END_GAP_M);
  });

  it("when the engine reads another car's player with the pistol, then its remote gun shows a mesh at his body's hand", () => {
    otherHolds(PISTOL_SLOT);
    rig.run(ARM_SETTLE_S);
    const hand = new THREE.Vector3();
    expect(rig.engine["bodyHand"](OTHER_CAR, hand, new THREE.Vector3()), "control: a body carries him").toBe(true);
    const mesh = rig.engine["remoteGuns"]["meshes"][OTHER_CAR];
    expect(mesh?.visible, "his gun is drawn").toBe(true);
    const e = mesh!.matrix.elements;
    expect(hypot3(e[12]! - hand.x, e[13]! - hand.y, e[14]! - hand.z), "metres from his body's hand to the grip").toBeLessThanOrEqual(GRIP_GAP_M);
  });
});
