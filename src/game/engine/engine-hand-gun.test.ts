import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { HandGuns } from "./engine-hand-gun.ts";

/** The hand, a target 10 m ahead of it and 2 m up (a level-ish shot with a rise, so a gun laid on its side or rolled would show), the ground almost straight under the hand (the barrel tipped onto it passes straight down), and the ground just behind the hand, which a camera looking ahead (+x) faces away from. */
const HAND = new THREE.Vector3(2, 1.3, -4);
const TARGET = new THREE.Vector3(2 + 6, 1.3 + 2, -4 + 8);
const UNDER_HAND = new THREE.Vector3(2 + 0.02, 1.3 - 1.4, -4);
const BEHIND_HAND = new THREE.Vector3(2 - 0.03, 1.3 - 1.4, -4);
const AIM_AHEAD = Object.assign(new LookRay(), { eyeX: 0, eyeY: 1.6, eyeZ: -4, dirX: 1, dirY: 0, dirZ: 0 });
const HELD = ["pistol", "shotgun", "rifle", "hook"] as const;
/** How near (m) the drawn barrel's tip must be to the point the shot leaves from: half the widest muzzle (the hook's prongs, 4 cm off its bore), and how near (rad) the drawn barrel must lie to the bullet's line. */
const TIP_GAP_M = 0.05;
const LINE_GAP_RAD = (0.1 * Math.PI) / 180;

/** `weapon` laid on `target` from `HAND` (and, with `posedAfter`, posed for one more frame with the camera looking ahead, while the lay is held for the flash): the drawn vertex farthest toward the target, the muzzle the shot leaves from, how far (m) that muzzle stands above the straight line from the hand to the target, and the drawn barrel's direction (the mesh's -y). A gun drawn upside down or on its side has its drawn tip a bore's height or more from the muzzle. */
function laid(weapon: (typeof HELD)[number], target = TARGET, posedAfter = false) {
  const mesh = new THREE.Mesh();
  const muzzles = new Float32Array(3);
  const guns = new HandGuns(mesh, muzzles);
  expect(guns.layOn(weapon, HAND, target.x, target.y, target.z), "control: the gun is laid").toBe(true);
  if (posedAfter) {
    guns.dt = 1 / FRAME_HZ;
    guns.pose(weapon, HAND, AIM_AHEAD);
  }
  const aim = target.clone().sub(HAND).normalize();
  const position = mesh.geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  const tip = new THREE.Vector3();
  let farthest = -Infinity;
  for (let at = 0; at < position.count; at++) {
    vertex.fromBufferAttribute(position, at).applyMatrix4(mesh.matrix);
    const along = (vertex.x - HAND.x) * aim.x + (vertex.y - HAND.y) * aim.y + (vertex.z - HAND.z) * aim.z;
    if (along <= farthest) continue;
    farthest = along;
    tip.copy(vertex);
  }
  const e = mesh.matrix.elements;
  const muzzle = new THREE.Vector3(muzzles[0], muzzles[1], muzzles[2]);
  const out = muzzle.clone().sub(HAND);
  return { tip, muzzle, boreAbove: out.y - out.dot(aim) * aim.y, barrel: new THREE.Vector3(-e[4]!, -e[5]!, -e[6]!) };
}

describe("given each weapon a player holds out, laid on a target 10 m ahead and 2 m up", () => {
  for (const weapon of HELD) {
    it(`when the ${weapon} is drawn, then its barrel's tip is where the shot leaves from, its bore is above the grip in his hand, and the line from that tip to the target runs down the drawn barrel`, () => {
      const gun = laid(weapon);
      expect(gun.tip.distanceTo(gun.muzzle), "metres from the drawn barrel's tip to the muzzle the shot leaves from").toBeLessThanOrEqual(TIP_GAP_M);
      expect(gun.boreAbove, "metres the muzzle stands above the straight line from the hand to the target").toBeGreaterThan(0.02);
      expect(TARGET.clone().sub(gun.muzzle).angleTo(gun.barrel), "the angle between the drawn barrel and the line from the muzzle to the target (rad)").toBeLessThanOrEqual(LINE_GAP_RAD);
    });

    it(`when the ${weapon} is fired at the ground almost straight under the hand, then the line from its tip to that spot still runs down the drawn barrel`, () => {
      const gun = laid(weapon, UNDER_HAND);
      expect(gun.tip.distanceTo(gun.muzzle), "metres from the drawn barrel's tip to the muzzle the shot leaves from").toBeLessThanOrEqual(TIP_GAP_M);
      expect(UNDER_HAND.clone().sub(gun.muzzle).angleTo(gun.barrel), "the angle between the drawn barrel and the line from the muzzle to the spot (rad)").toBeLessThanOrEqual(LINE_GAP_RAD);
    });

    it(`when the ${weapon} is fired at the ground just behind the hand while the camera looks ahead, then a frame later, the lay still held for the flash, the line from its tip to that spot still runs down the drawn barrel`, () => {
      const gun = laid(weapon, BEHIND_HAND, true);
      expect(gun.tip.distanceTo(gun.muzzle), "metres from the drawn barrel's tip to the muzzle the flash is drawn at").toBeLessThanOrEqual(TIP_GAP_M);
      expect(BEHIND_HAND.clone().sub(gun.muzzle).angleTo(gun.barrel), "the angle between the drawn barrel and the line from the muzzle to the spot (rad)").toBeLessThanOrEqual(LINE_GAP_RAD);
    });
  }
});
