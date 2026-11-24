import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { hypot3 } from "../kernel/physics-core.js";
import { FRAME_HZ } from "../kernel/constants.ts";
import { BODY_POSTURE, SHOT_COUNT_MASK, WEAPON_SLOTS } from "../net/body-codec.ts";
import { WEAPONS, weaponAt } from "./engine-onfoot-arms.ts";
import { RemoteGuns } from "./engine-remote-guns.ts";
import { OpenWorldPlayers } from "./openworld-players.ts";

const PLAYER = 3;
const PISTOL_SLOT = 1;
const FRAME_S = 1 / FRAME_HZ;
const RIFLE_SLOT = 3;
const HOOK_SLOT = 4;
/** The way a body's forearm points in the rows below (up and away), and the most (degrees) the gun at rest may lie off it: the bore sits a few centimetres over the grip, tipping the barrel by a fraction of a degree at 25 m. */
const FOREARM = new THREE.Vector3(0.3, 0.2, 0.9).normalize();
const REST_GAP_DEG = 1;
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

function gunsWith(hand: THREE.Vector3 | null, raised: boolean[] = [], heard: string[] = []): RemoteGuns {
  const guns = new RemoteGuns(
    new THREE.MeshBasicMaterial(),
    (_car, at, forearm) => hand !== null && at.copy(hand) === at && forearm.copy(FOREARM) === forearm,
    (_car, held) => void raised.push(held),
    (weapon) => void heard.push(weapon),
  );
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

  it("when his body's forearm points up and away, then the pistol at rest lies along it to within a degree", () => {
    const guns = gunsWith(new THREE.Vector3(BODY_HAND.x, BODY_HAND.y, BODY_HAND.z));
    guns.frame(tableWith(PISTOL_SLOT));
    const e = guns["meshes"][PLAYER]!.matrix.elements;
    const barrel = new THREE.Vector3(-e[4]!, -e[5]!, -e[6]!);
    expect((barrel.angleTo(FOREARM) * 180) / Math.PI, "degrees between the barrel and his forearm").toBeLessThanOrEqual(REST_GAP_DEG);
  });

  it("when his record says the rifle, the hook, fists or a lying body, then his body's arm is told to be held out for the first two and to hang for the others", () => {
    const raised: boolean[] = [];
    const guns = gunsWith(null, raised);
    for (const [slot, posture] of [[RIFLE_SLOT, BODY_POSTURE.stand], [HOOK_SLOT, BODY_POSTURE.stand], [0, BODY_POSTURE.stand], [RIFLE_SLOT, BODY_POSTURE.down]] as const) guns.frame(tableWith(slot, posture));
    expect(raised[0], "rifle").toBe(true);
    expect(raised[1], "hook").toBe(true);
    expect(raised[2], "fists").toBe(false);
    expect(raised[3], "lying").toBe(false);
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

/** The rifle's interval between shots (s), from the arms' table. */
const RIFLE_EVERY_S = WEAPONS.rifle.every;
/** Shots drawn from a counter that steps every 1/60 s for a second (the first frame's, then one every 7 frames), and from an honest stream (one every 0.12 s, the first at 0.12): the rifle fires 8.3 a second. */
const MOST_IN_A_SECOND = 9;
const HONEST_IN_A_SECOND = 8;

describe("given a record whose shot counter the table reads every drawn frame, the rifle in his hand", () => {
  /** Shots drawn in `seconds` of frames, the counter stepping when `steps(seconds so far, frames so far)` says so. */
  function drawnIn(seconds: number, steps: (time: number, frame: number) => boolean): number {
    const heard: string[] = [];
    const guns = gunsWith(null, [], heard);
    const table = tableWith(RIFLE_SLOT);
    guns.frame(table);
    for (let frame = 1; frame <= Math.round(seconds * FRAME_HZ); frame++) {
      if (steps(frame * FRAME_S, frame)) table.armsShots[PLAYER] = (table.armsShots[PLAYER]! + 1) & SHOT_COUNT_MASK;
      guns.frame(table);
    }
    return heard.length;
  }

  it("when the counter steps every frame for a second, then no more flashes are drawn than the rifle can fire in a second: 8 or 9, not 60", () => {
    const drawn = drawnIn(1, () => true);
    expect(drawn, "shots drawn: the first frame's, then one every 7 frames (0.117 s, past 0.9 of the rifle's 0.12 s)").toBe(MOST_IN_A_SECOND);
  });

  it("when the counter steps at the rifle's own rate for a second, then every shot is drawn", () => {
    let next = RIFLE_EVERY_S;
    const drawn = drawnIn(1, (time) => {
      if (time < next) return false;
      next += RIFLE_EVERY_S;
      return true;
    });
    expect(drawn, "shots drawn").toBe(HONEST_IN_A_SECOND);
  });

  it("when two shots reach the table one 15 Hz frame apart (67 ms, sooner than the rifle's 120 ms), then both are drawn: the second waits its turn", () => {
    const drawn = drawnIn(0.5, (_time, frame) => frame === 1 || frame === 5);
    expect(drawn, "shots drawn").toBe(2);
  });
});
