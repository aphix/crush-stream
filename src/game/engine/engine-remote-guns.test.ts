import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { hypot3 } from "../kernel/physics-core.js";
import { FRAME_HZ } from "../kernel/constants.ts";
import { BODY_POSTURE, WEAPON_SLOTS } from "../net/body-codec.ts";
import { weaponAt } from "./engine-onfoot-arms.ts";
import { RemoteGuns } from "./engine-remote-guns.ts";
import { OpenWorldPlayers } from "./openworld-players.ts";

const PLAYER = 3;
const PISTOL_SLOT = 1;
const FRAME_S = 1 / FRAME_HZ;
const TORSO = { x: 40, y: 1.1, z: -25 };
const BODY_HAND = { x: 40.4, y: 1.2, z: -24.6 };
/** The most (m) a figure's gun may be held from its torso, and the least. */
const FIGURE_HAND_MAX_M = 0.6;
const FIGURE_HAND_MIN_M = 0.2;
const PLAYER_COUNT = 1000;

/** A table that has player `PLAYER` standing at `TORSO` facing north-east, holding weapon slot `slot`. */
function tableWith(slot: number, posture: number = BODY_POSTURE.stand): OpenWorldPlayers {
  const table = new OpenWorldPlayers(PLAYER_COUNT);
  table.armsSeen[PLAYER] = 1;
  table.armsWeapon[PLAYER] = slot;
  Object.assign(table.armsPlace[PLAYER]!, { ...TORSO, heading: Math.PI / 4, posture });
  return table;
}

function gunsWith(hand: THREE.Vector3 | null): RemoteGuns {
  const guns = new RemoteGuns(new THREE.MeshBasicMaterial(), (_car, out) => hand !== null && out.copy(hand) === out, () => {});
  guns.dt = FRAME_S;
  return guns;
}

describe("given the arms' weapon list and the wire's count of weapon slots", () => {
  it("when the slot past the wire's count is read as a weapon, then the last slot is a weapon of the list and the next is fists: the two agree", () => {
    expect(weaponAt(WEAPON_SLOTS - 1), "the last weapon slot").toBe("hook");
    expect(weaponAt(WEAPON_SLOTS), "past the list").toBe("fists");
  });
});

describe("given another player on foot in a table the host's frame filled", () => {
  it("when his body carries his hand, then the pistol's grip is laid at that hand", () => {
    const guns = gunsWith(new THREE.Vector3(BODY_HAND.x, BODY_HAND.y, BODY_HAND.z));
    guns.frame(tableWith(PISTOL_SLOT));
    const e = guns["meshes"][PLAYER]!.matrix.elements;
    expect(hypot3(e[12]! - BODY_HAND.x, e[13]! - BODY_HAND.y, e[14]! - BODY_HAND.z), "metres from his hand to the grip").toBeLessThan(1e-4);
  });

  it("when he is drawn as a figure, then the pistol is held 0.2 to 0.6 m from his torso", () => {
    const guns = gunsWith(null);
    guns.frame(tableWith(PISTOL_SLOT));
    const e = guns["meshes"][PLAYER]!.matrix.elements;
    const held = hypot3(e[12]! - TORSO.x, e[13]! - TORSO.y, e[14]! - TORSO.z);
    expect(held, "metres from his torso to the grip").toBeGreaterThanOrEqual(FIGURE_HAND_MIN_M);
    expect(held, "metres from his torso to the grip").toBeLessThanOrEqual(FIGURE_HAND_MAX_M);
  });

  it("when he holds fists, or lies, then no gun is drawn; and when he stands with the pistol again, it is", () => {
    const guns = gunsWith(null);
    guns.frame(tableWith(PISTOL_SLOT));
    const mesh = guns["meshes"][PLAYER]!;
    expect(mesh.visible, "control: the pistol is drawn").toBe(true);
    guns.frame(tableWith(0));
    expect(mesh.visible, "fists").toBe(false);
    guns.frame(tableWith(PISTOL_SLOT, BODY_POSTURE.down));
    expect(mesh.visible, "lying").toBe(false);
    guns.frame(tableWith(PISTOL_SLOT));
    expect(mesh.visible, "standing with the pistol").toBe(true);
  });
});
