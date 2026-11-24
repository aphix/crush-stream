import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { type LookRay, type Meeting } from "../ai/civilians/civilian-look.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { TetherSet } from "../contact/tether.ts";
import { FRAME_HZ, MAX_TETHERS } from "../kernel/constants.ts";
import { ACT, Act, NAMED, type Named } from "../net/act-codec.ts";
import { ROPE_FLOATS } from "../present/ragdoll-wire.ts";
import { TetherDirector } from "./engine-tether.ts";
import { OpenWorldActs } from "./engine-openworld-acts.ts";

const FRAME = 1 / FRAME_HZ;
const EYE_Y = 1.1;
const AHEAD = 10;
const CHEST = new THREE.Vector3(0.3, EYE_Y, -AHEAD);
/** A civilian at x = 0 and another a metre beside her, both `AHEAD` m ahead; a body hits within this (m) of its chest line. */
const PEOPLE = [{ index: 9, x: 0 }, { index: 11, x: 1 }];
const CHEST_RADIUS = 0.35;
const HOST = 0;
const GUEST = 1;
const TORSO = { x: 0, y: 1, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };

/** The people whose chest the ray passes within `CHEST_RADIUS`, the nearest. */
function personMet(ray: LookRay, reach: number, out: Meeting): Meeting {
  out.index = -1;
  out.along = reach;
  for (const person of PEOPLE) {
    const along = AHEAD / -ray.dirZ;
    const gap = Math.abs(ray.eyeX + ray.dirX * along - person.x);
    if (gap <= CHEST_RADIUS && along < out.along) Object.assign(out, { index: person.index, along });
  }
  return out;
}

/** A tether on a machine that is `guest` or the host, that records the people it stood bodies for and the acts it sent. */
function tether(guest: boolean, nameHook: (civilian: number, slot: number, x: number, y: number, z: number, out: Named) => void = () => {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, EYE_Y, 0);
  const stood: number[] = [];
  const sent: { kind: number; arg: number; name: Named | null | undefined }[] = [];
  const ropes = { ropeAttach: () => 0, ropeCut: () => {}, ropeReel: () => {}, dollOut: () => false, torso: () => false, ropeReport: { command: 0, floats: new Float32Array(MAX_TETHERS * ROPE_FLOATS) } };
  const director = new TetherDirector({
    tethers: new TetherSet(),
    camera,
    scene,
    ropes,
    cars: () => [],
    movers: () => [],
    playerCar: () => -1,
    offered: () => true,
    chase: () => false,
    afoot: () => true,
    self: () => -1,
    actor: () => HOST,
    actorSlot: () => -1,
    actorAfoot: () => true,
    guest: () => guest,
    hostHolds: () => false,
    hostHoldAt: () => false,
    hostCables: () => 0,
    sendAct: (kind, arg, _eye, _dir, name) => void sent.push({ kind, arg, name }),
    nameHook,
    personMet,
    standPerson: (civilian) => (stood.push(civilian), civilian),
    holdDoll: () => {},
  });
  return { director, camera, stood, sent };
}

/** The host hears a guest's hook fire from (0, 1.1, 0) aimed at `towardX` at `AHEAD` m ahead, naming civilian 11 (as `named`), who now stands at `herAt`; the civilians the host stood bodies for. */
function hostHears(towardX: number, named: number, herAt: { x: number; y: number; z: number }): number[] {
  const { director, stood } = tether(false);
  const acts = new OpenWorldActs(
    {
      actorPlace: (_actor, out) => (Object.assign(out, TORSO), true),
      now: () => 100,
      self: () => HOST,
      guest: () => false,
      face: () => {},
      layGun: () => false,
      sendAct: () => {},
      seatedCar: () => -1,
      getIn: () => 0,
      getOut: () => 0,
      hookFire: (actor, ray, sawPerson) => void director.fireFor(actor, ray, sawPerson),
      hookCut: () => {},
      hookReel: () => {},
    },
    { punch: () => {}, shoot: () => 0, meet: () => 0, wallBetween: () => false, placeNamed: (_kind, _id, _x, _y, _z, out) => (Object.assign(out, herAt), true), shotFired: () => {} },
  );
  const act = new Act();
  act.kind = ACT.hookFire;
  act.eyeY = EYE_Y;
  const length = hypot2(towardX, AHEAD);
  act.dirX = towardX / length;
  act.dirZ = -AHEAD / length;
  act.named.kind = named;
  act.named.id = 11;
  act.named.y = CHEST.y;
  acts.hear(GUEST, act);
  return stood;
}

describe("given two civilians a metre apart 10 m ahead, and a guest whose hook line passes 0.3 m from the first", () => {
  it("when his act names the second, who now stands where his reticle lit her, then the host ropes the second, not the one nearest the line", () => {
    expect(hostHears(0.3, NAMED.civilian, { x: 1, y: EYE_Y, z: -AHEAD }), "civilians the host stood a body for").toEqual([11]);
  });

  it("when his act names no one, then the host ropes no one: the reticle lit nobody", () => {
    expect(hostHears(0.3, NAMED.nothing, { x: 1, y: EYE_Y, z: -AHEAD }), "civilians the host stood a body for").toEqual([]);
  });
});

describe("given a guest whose reticle lights a civilian", () => {
  it("when he fires the hook, then the act carries her name as the director's naming made it, and its argument byte is 0", () => {
    const asked: number[][] = [];
    const { director, camera, sent } = tether(true, (civilian, slot, x, y, z, out) => {
      asked.push([civilian, slot, x, y, z]);
      Object.assign(out, { kind: NAMED.civilian, id: civilian, x: 0.1, y: 1.2, z: 0 });
    });
    camera.lookAt(CHEST);
    camera.updateMatrixWorld(true);
    director.fire();
    director.frame(FRAME);
    expect(sent.length, "acts sent").toBe(1);
    expect(sent[0]!.kind, "the act").toBe(ACT.hookFire);
    expect(sent[0]!.arg, "its argument byte").toBe(0);
    expect(asked[0]![0], "the civilian his reticle lit").toBe(9);
    expect(asked[0]![1], "no dummy").toBe(-1);
    expect(sent[0]!.name?.kind, "the name's kind").toBe(NAMED.civilian);
    expect(sent[0]!.name?.id, "the name's index").toBe(9);
  });
});
