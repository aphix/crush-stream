import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LookRay, type Meeting } from "../ai/civilians/civilian-look.ts";
import { FRAME_HZ, MAX_TETHERS } from "../kernel/constants.ts";
import { RAPIER, TetherSet } from "../contact/tether.ts";
import { BOXES_MESH_NAME } from "../present/minigame-art.ts";
import { ROPE_FLOATS, type RopeEnd } from "../present/ragdoll-wire.ts";
import { TetherDirector } from "./engine-tether.ts";

const FRAME = 1 / FRAME_HZ;
const EYE_Y = 1.1;
/** Where the civilian and the two boxes stand (m ahead along -z), and the wall behind them. */
const AHEAD = 10;
const WALL_AHEAD = 30;
const BESIDE = 5;
const PERSON = 9;
const PERSON_SLOT = 5;
const HOST = 0;
const GUEST = 3;
/** The walker slot the room gives the guest while he is on foot. */
const GUEST_SLOT = 23;

const EYE = new THREE.Vector3(0, EYE_Y, 0);
const WALL_POINT = new THREE.Vector3(BESIDE, EYE_Y, -WALL_AHEAD);
const BOX_A = new THREE.Vector3(-3, EYE_Y, -AHEAD);
const BOX_B = new THREE.Vector3(3, EYE_Y, -AHEAD);
const PERSON_POINT = new THREE.Vector3(0, EYE_Y, -AHEAD);

type Sent = { kind: number; arg: number; eye: number[]; dir: number[] };

/** A ray from the eye through `point`. */
function rayTo(point: THREE.Vector3): LookRay {
  const dir = point.clone().sub(EYE).normalize();
  return Object.assign(new LookRay(), { eyeX: EYE.x, eyeY: EYE.y, eyeZ: EYE.z, dirX: dir.x, dirY: dir.y, dirZ: dir.z });
}

/** The dummies' world as the tether sees it: it records the ropes, cuts and winches it is told. */
function fakeRopes(dollsOut: number[]) {
  const attached: { slot: number; a: RopeEnd; b: RopeEnd }[] = [];
  return {
    attached,
    cut: [] as number[],
    reeled: [] as { on: boolean; slot: number }[],
    ropeAttach: (slot: number, a: RopeEnd, b: RopeEnd): number => attached.push({ slot, a, b }),
    ropeCut(slot: number): void {
      this.cut.push(slot);
    },
    ropeReel(on: boolean, slot = -1): void {
      this.reeled.push({ on, slot });
    },
    dollOut: (slot: number) => dollsOut.includes(slot),
    torso: (slot: number, out: THREE.Vector3): boolean => dollsOut.includes(slot) && out.copy(PERSON_POINT) === out,
    ropeReport: { command: 0, floats: new Float32Array(MAX_TETHERS * ROPE_FLOATS) },
  };
}

/** A wall `WALL_AHEAD` m ahead and two boxes `AHEAD` m ahead, side by side. */
function furnish(scene: THREE.Scene): void {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(200, 100, 0.4), new THREE.MeshBasicMaterial());
  wall.position.set(0, 0, -WALL_AHEAD);
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial(), 2);
  boxes.name = BOXES_MESH_NAME;
  boxes.setMatrixAt(0, new THREE.Matrix4().makeTranslation(BOX_A.x, BOX_A.y, BOX_A.z));
  boxes.setMatrixAt(1, new THREE.Matrix4().makeTranslation(BOX_B.x, BOX_B.y, BOX_B.z));
  scene.add(wall, boxes);
  scene.updateMatrixWorld(true);
}

/** A room with the host (actor `HOST`) and a second actor (`GUEST`) on foot, a tether on the host's machine, and what it was asked. */
function room() {
  const scene = new THREE.Scene();
  furnish(scene);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.copy(EYE);
  const dollsOut: number[] = [];
  const ropes = fakeRopes(dollsOut);
  const tethers = new TetherSet();
  const state = { onFoot: new Set([HOST, GUEST]), guest: false, offered: true, sent: [] as Sent[] };
  const personMet = (ray: LookRay, reach: number, out: Meeting): Meeting => {
    const there = Math.abs(ray.dirX) < 0.01 && reach > AHEAD;
    return Object.assign(out, { index: there ? PERSON : -1, along: there ? AHEAD : reach });
  };
  const standPerson = (civilian: number): number => {
    if (civilian !== PERSON) return -1;
    dollsOut.push(PERSON_SLOT);
    return PERSON_SLOT;
  };
  const director = new TetherDirector({
    tethers,
    camera,
    scene,
    ropes,
    cars: () => [],
    movers: () => [],
    playerCar: () => -1,
    offered: () => state.offered,
    chase: () => false,
    afoot: () => state.onFoot.has(HOST),
    self: () => -1,
    actor: () => HOST,
    actorSlot: (actor) => (state.onFoot.has(actor) ? GUEST_SLOT : -1),
    guest: () => state.guest,
    sendAct: (kind, arg, eye, dir) => void state.sent.push({ kind, arg, eye: [eye.x, eye.y, eye.z], dir: [dir.x, dir.y, dir.z] }),
    personMet,
    standPerson,
    holdDoll: () => {},
  });
  const aimAt = (point: THREE.Vector3): void => {
    camera.lookAt(point);
    camera.updateMatrixWorld(true);
  };
  /** The machine's own player fires at `point`: the fire key and a frame. */
  const fireAt = (point: THREE.Vector3): void => {
    aimAt(point);
    director.fire();
    director.frame(FRAME);
  };
  /** An actor's two fires, the first holding what is at `first` and the second tying it to `second`. */
  const tie = (actor: number, first: THREE.Vector3, second: THREE.Vector3): void => {
    director.fireFor(actor, rayTo(first));
    director.fireFor(actor, rayTo(second));
  };
  return { director, tethers, ropes, state, tie, aimAt, fireAt };
}

/** Slots of the live cables `owner` fired. */
function slotsOf(tethers: TetherSet, owner: number): number[] {
  const slots: number[] = [];
  for (let slot = 0; slot < MAX_TETHERS; slot++) if (tethers.isAlive(slot) && tethers.owner(slot) === owner) slots.push(slot);
  return slots;
}

describe("given a room with the host and a second actor on foot, a civilian 10 m ahead and a wall 30 m ahead", () => {
  it("when the second actor fires at the civilian and then at the wall, then the host holds her on a cable the second actor owns", () => {
    const { director, tethers, ropes } = room();
    expect(director.fireFor(GUEST, rayTo(PERSON_POINT)), "the first fire holds her").toBe(true);
    expect(director.fireFor(GUEST, rayTo(WALL_POINT)), "the second ties her to the wall").toBe(true);
    expect(tethers.count, "cables out").toBe(1);
    expect(tethers.owner(0), "the cable's owner").toBe(GUEST);
    expect(tethers.endCar(0, 0), "the first end is in the dummies' world").toBe(RAPIER);
    expect(ropes.attached[0]!.a.kind === "doll" && ropes.attached[0]!.a.id, "the first end is her body's dummy").toBe(PERSON_SLOT);
    expect(ropes.attached[0]!.b.kind, "the second end").toBe("world");
  });

  it("when the host fires the same two fires with his own hook, then the cable is the host's, through the same functions", () => {
    const { tethers, ropes, fireAt } = room();
    fireAt(PERSON_POINT);
    fireAt(WALL_POINT);
    expect(tethers.count, "cables out").toBe(1);
    expect(tethers.owner(0), "the cable's owner").toBe(HOST);
    expect(ropes.attached[0]!.a.kind === "doll" && ropes.attached[0]!.a.id, "the first end is her body's dummy").toBe(PERSON_SLOT);
  });

  it("when the host holds one box and the second actor another, then each ties his own first end to the other box: one cable each", () => {
    const { director, tethers } = room();
    director.fireFor(HOST, rayTo(BOX_A));
    director.fireFor(GUEST, rayTo(BOX_B));
    director.fireFor(HOST, rayTo(BOX_B));
    director.fireFor(GUEST, rayTo(BOX_A));
    expect(slotsOf(tethers, HOST), "the host's cable").toHaveLength(1);
    expect(slotsOf(tethers, GUEST), "the second actor's cable").toHaveLength(1);
    expect(tethers.thing(slotsOf(tethers, HOST)[0]!, 0), "the host's first end is the box he held").not.toBe(tethers.thing(slotsOf(tethers, GUEST)[0]!, 0));
  });

  it("when the second actor is not on foot, then his fire holds nothing and attaches nothing; on foot, the same ray holds her", () => {
    const { director, tethers, ropes, state } = room();
    state.onFoot.delete(GUEST);
    expect(director.fireFor(GUEST, rayTo(PERSON_POINT)), "not on foot").toBe(false);
    expect(director.fireFor(GUEST, rayTo(WALL_POINT)), "not on foot").toBe(false);
    expect([tethers.count, ropes.attached.length], "cables and ropes").toEqual([0, 0]);
    state.onFoot.add(GUEST);
    director.fireFor(GUEST, rayTo(PERSON_POINT));
    director.fireFor(GUEST, rayTo(WALL_POINT));
    expect(tethers.count, "on foot: the cable is out").toBe(1);
  });

  it("when the host is not on foot, then his own fire does nothing", () => {
    const { tethers, state, fireAt } = room();
    state.onFoot.delete(HOST);
    fireAt(PERSON_POINT);
    fireAt(WALL_POINT);
    expect(tethers.count).toBe(0);
  });
});

describe("given the host and a second actor, each on a cable between the two boxes", () => {
  function twoCables() {
    const r = room();
    r.tie(HOST, BOX_A, BOX_B);
    r.tie(GUEST, BOX_B, BOX_A);
    return { ...r, hostSlot: slotsOf(r.tethers, HOST)[0]!, guestSlot: slotsOf(r.tethers, GUEST)[0]! };
  }

  it("when the second actor's winch is on, then only his rope is told to reel and the host's cable does not reel", () => {
    const { director, tethers, ropes, hostSlot, guestSlot } = twoCables();
    director.reelFor(GUEST, true);
    director.frame(FRAME);
    expect(tethers.reels(guestSlot), "his cable reels").toBe(true);
    expect(tethers.reels(hostSlot), "the host's cable").toBe(false);
    expect(ropes.reeled, "winch commands").toHaveLength(1);
    expect(ropes.reeled[0]!.slot, "his rope reels").toBe(guestSlot);
    expect(ropes.reeled[0]!.on, "on").toBe(true);
  });

  it("when the host's own winch is held and the second actor's is off, then only the host's rope reels", () => {
    const { director, ropes, hostSlot } = twoCables();
    director.holdReel(true);
    director.frame(FRAME);
    expect(ropes.reeled, "winch commands").toHaveLength(1);
    expect(ropes.reeled[0]!.slot, "the host's rope reels").toBe(hostSlot);
    expect(ropes.reeled[0]!.on, "on").toBe(true);
  });

  it("when the second actor cuts, then only his cable and rope go and the host's stays", () => {
    const { director, tethers, ropes, hostSlot, guestSlot } = twoCables();
    director.cutFor(GUEST);
    expect(tethers.isAlive(guestSlot), "his cable").toBe(false);
    expect(tethers.isAlive(hostSlot), "the host's cable").toBe(true);
    expect(ropes.cut, "the ropes cut").toHaveLength(1);
    expect(ropes.cut[0], "the second actor's rope").toBe(guestSlot);
  });

  it("when the host cuts with his own key, then only the host's cable goes", () => {
    const { director, tethers, hostSlot, guestSlot } = twoCables();
    director.cut();
    expect(tethers.isAlive(hostSlot), "the host's cable").toBe(false);
    expect(tethers.isAlive(guestSlot), "the second actor's cable").toBe(true);
  });

  it("when the second actor stops being on foot, then his cable is cut at the next frame and the host's stays", () => {
    const { director, tethers, state, hostSlot, guestSlot } = twoCables();
    state.onFoot.delete(GUEST);
    director.frame(FRAME);
    expect(tethers.isAlive(guestSlot), "his cable").toBe(false);
    expect(tethers.isAlive(hostSlot), "the host's cable").toBe(true);
  });

  it("when the second actor's winch is on and he fires a new cable, then the new cable reels too", () => {
    const { director, tethers, tie } = twoCables();
    director.reelFor(GUEST, true);
    director.cutFor(GUEST);
    director.reelFor(GUEST, true);
    tie(GUEST, BOX_A, BOX_B);
    expect(tethers.reels(slotsOf(tethers, GUEST)[0]!)).toBe(true);
  });
});

describe("given the room's cables are full", () => {
  it("when the host and the second actor fire seven cables in turn, then six remain, three of each, the oldest gone", () => {
    const { tethers, tie } = room();
    for (let k = 0; k < MAX_TETHERS + 1; k++) tie(k % 2 === 0 ? HOST : GUEST, BOX_A, BOX_B);
    expect(tethers.count, "cables").toBe(MAX_TETHERS);
    expect([slotsOf(tethers, HOST).length, slotsOf(tethers, GUEST).length], "cables of the host and of the second actor").toEqual([3, 3]);
  });
});

describe("given a guest's machine, the hook in hand and a civilian 10 m ahead", () => {
  function guestRoom() {
    const r = room();
    r.state.guest = true;
    return r;
  }

  it("when he fires, then one act of kind 2 goes to the host along his sight line and no cable or rope is made here", () => {
    const { tethers, ropes, state, fireAt } = guestRoom();
    fireAt(PERSON_POINT);
    expect(state.sent, "acts sent").toHaveLength(1);
    const act = state.sent[0]!;
    expect(act.kind, "the act's kind").toBe(2);
    expect(act.eye[1], "the eye's height").toBe(EYE_Y);
    expect(act.eye[0]! + act.eye[2]!, "the eye's x and z").toBe(0);
    expect(act.dir[0]!, "the direction's x").toBeCloseTo(0, 5);
    expect(act.dir[2]!, "the direction's z").toBeCloseTo(-1, 5);
    expect([tethers.count, ropes.attached.length], "cables and ropes here").toEqual([0, 0]);
  });

  it("when the hook is not on offer, then a fire sends nothing", () => {
    const { state, fireAt } = guestRoom();
    state.offered = false;
    fireAt(PERSON_POINT);
    expect(state.sent).toHaveLength(0);
  });

  it("when he holds the retract and lets go, then one act of kind 4 goes and then one of kind 5; held across frames sends no more", () => {
    const { director, state } = guestRoom();
    director.holdReel(true);
    director.frame(FRAME);
    director.frame(FRAME);
    director.holdReel(false);
    director.frame(FRAME);
    expect(state.sent.map((act) => act.kind)).toEqual([4, 5]);
  });

  it("when he cuts on foot, then one act of kind 3 goes; the host's own cut sends none", () => {
    const g = guestRoom();
    g.director.cut();
    expect(g.state.sent.map((act) => act.kind), "a guest's cut").toEqual([3]);
    const h = room();
    h.director.cut();
    expect(h.state.sent, "the host's cut").toHaveLength(0);
  });

  it("when he asks the host's functions to carry out a fire for an actor, then nothing is held here", () => {
    const { director, tethers } = guestRoom();
    expect(director.fireFor(GUEST, rayTo(BOX_A))).toBe(false);
    expect(tethers.count).toBe(0);
  });
});
