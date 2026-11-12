import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ, MAX_TETHERS } from "../kernel/constants.ts";
import { RAPIER, TetherSet, WORLD } from "../contact/tether.ts";
import { BOXES_MESH_NAME } from "../present/minigame-art.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import { ROPE_FLOATS, ROPE_JOINED, type RopeEnd } from "../present/ragdoll-wire.ts";
import { TetherDirector } from "./engine-tether.ts";

const FRAME = 1 / FRAME_HZ;
/** The camera's height (m) and where the things stand in front of it (m along -z). */
const EYE_Y = 1.1;
const AHEAD = 10;
const WALL_AHEAD = 30;
/** The pitch (rad) a camera's field of view is 60° tall, for working out where a ray through a point above the middle of the view goes. */
const HALF_FOV = Math.PI / 6;
/** The knockable prop is index 7 of the course's placements; the second instance is not knockable. */
const KNOCKABLE = 7;
/** Where (m to the side) the second fire aims on the wall: off the line through the dummy. */
const BESIDE = 10;

type Attached = { slot: number; a: RopeEnd; b: RopeEnd };

/** The dummies' world as the tether sees it: it records the ropes it is asked for. */
function fakeRopes(dollsOut: readonly number[]) {
  const attached: Attached[] = [];
  return {
    attached,
    ropeAttach: (slot: number, a: RopeEnd, b: RopeEnd): number => attached.push({ slot, a, b }),
    ropeCut: () => {},
    ropeReel: () => {},
    dollOut: (slot: number) => dollsOut.includes(slot),
    ropeReport: { command: 0, floats: new Float32Array(MAX_TETHERS * ROPE_FLOATS) },
  };
}

/** A free camera at the origin, `scene`, and a tether on it: `aimAt(point)` turns the camera, `fire()` is a fire and a frame. */
function rig(scene: THREE.Scene, dollsOut: readonly number[] = [0], chase = false) {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, EYE_Y, 0);
  const ropes = fakeRopes(dollsOut);
  const tethers = new TetherSet();
  const director = new TetherDirector({ tethers, camera, scene, ropes, cars: () => [], movers: () => [], playerCar: () => -1, offered: () => true, chase: () => chase, afoot: () => true, self: () => -1 });
  const aimAt = (point: THREE.Vector3): void => {
    camera.lookAt(point);
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
  };
  const fire = (): void => {
    director.fire();
    director.frame(FRAME);
  };
  return { director, tethers, ropes, aimAt, fire, camera };
}

/** A wall `WALL_AHEAD` m ahead, wide enough to catch every ray the rows cast. */
function wall(scene: THREE.Scene): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(200, 100, 0.4), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 0, -WALL_AHEAD);
  scene.add(mesh);
  return mesh;
}

/** An instanced mesh of two 2 m cubes `AHEAD` m ahead, side by side. */
function cubes(scene: THREE.Scene, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial(), 2);
  mesh.name = name;
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-3, EYE_Y, -AHEAD));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, EYE_Y, -AHEAD));
  scene.add(mesh);
  return mesh;
}

/** Dummy slot 0 standing `AHEAD` m ahead; his torso's middle. */
function dummy(scene: THREE.Scene): THREE.Vector3 {
  const mesh = new DummyMesh(1);
  const none = new THREE.Quaternion();
  for (const [k, part] of PARTS.entries()) mesh.pose(0, k, new THREE.Vector3(part.c[0], part.c[1], part.c[2] - AHEAD), none);
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  return new THREE.Vector3(PARTS[0].c[0], PARTS[0].c[1], PARTS[0].c[2] - AHEAD);
}

/** The first end of the only rope asked for. */
function firstEnd(ropes: ReturnType<typeof fakeRopes>): RopeEnd {
  expect(ropes.attached.length, "ropes asked for").toBe(1);
  return ropes.attached[0]!.a;
}

describe("given the free camera over a dummy standing out, with a wall behind him", () => {
  it("when it fires at him and then at the wall, then the cable is a rope: its first end is the dummy at the point the ray touched", () => {
    const scene = new THREE.Scene();
    const torso = dummy(scene);
    wall(scene);
    const { aimAt, fire, ropes, tethers } = rig(scene);
    aimAt(torso);
    fire();
    aimAt(new THREE.Vector3(BESIDE, EYE_Y, -WALL_AHEAD));
    fire();
    const end = firstEnd(ropes);
    expect(end.kind).toBe("doll");
    expect(end.kind === "doll" ? end.id : -1, "the dummy's slot").toBe(0);
    expect(end.kind === "doll" && new THREE.Vector3(...end.at).distanceTo(torso) < 0.5, "the hook is on his torso").toBeTruthy();
    expect(ropes.attached[0]!.b.kind, "the other end").toBe("world");
    expect(tethers.endCar(0, 0), "the cable's first end").toBe(RAPIER);
    expect(tethers.isRapier(0), "the sim leaves the cable to the dummies' world").toBe(true);
  });

  it("when he is not out (put away), then the ray passes through him and the cable hooks the wall", () => {
    const scene = new THREE.Scene();
    const torso = dummy(scene);
    wall(scene);
    const { director, aimAt, fire, tethers } = rig(scene, []);
    aimAt(torso);
    fire();
    expect(tethers.count, "cables out after one fire").toBe(0);
    expect(tethers.isAlive(0)).toBe(false);
    expect(director["heldCar"], "what the first fire holds: the wall, not the dummy").toBe(WORLD);
  });
});

describe("given a cable tied to a dummy, and the dummies' world's report of its rope", () => {
  const tied = () => {
    const scene = new THREE.Scene();
    const torso = dummy(scene);
    wall(scene);
    const made = rig(scene);
    made.aimAt(torso);
    made.fire();
    made.aimAt(new THREE.Vector3(BESIDE, EYE_Y, -WALL_AHEAD));
    made.fire();
    expect(made.tethers.count, "cables out").toBe(1);
    return made;
  };

  it("when the world has not heard of the rope yet (its report is older than the command), then the cable stays", () => {
    const { director, tethers } = tied();
    director.frame(FRAME);
    expect(tethers.count, "cables out").toBe(1);
  });

  it("when the world has heard of it and holds no rope (its dummy was put away), then the cable is released", () => {
    const { director, tethers, ropes } = tied();
    ropes.ropeReport.command = ropes.attached.length;
    director.frame(FRAME);
    expect(tethers.count, "cables out").toBe(0);
  });

  it("when the world reports the rope joined, then the cable's dummy end and its length are where the world has them", () => {
    const { director, tethers, ropes } = tied();
    ropes.ropeReport.command = ropes.attached.length;
    ropes.ropeReport.floats.set([ROPE_JOINED, 1, 2, 3, 4, 5, 6, 7]);
    director.frame(FRAME);
    expect(tethers.count, "cables out").toBe(1);
    expect(tethers.point(0, 0, new THREE.Vector3()).toArray(), "the dummy's end").toEqual([1, 2, 3]);
    expect(tethers.length(0), "the rope's length").toBe(7);
  });
});

describe("given the free camera over a mesh of two instances, the first of which is a knockable prop", () => {
  it("when it fires at the knockable instance, then the rope's end is that prop's placement; at the other, the end is the world", () => {
    const scene = new THREE.Scene();
    const props = cubes(scene, "props");
    props.userData.knockOf = Int32Array.of(KNOCKABLE, -1);
    wall(scene);
    scene.updateMatrixWorld(true);
    const knock = rig(scene);
    knock.aimAt(new THREE.Vector3(-3, EYE_Y, -AHEAD));
    knock.fire();
    knock.aimAt(new THREE.Vector3(0, EYE_Y, -WALL_AHEAD));
    knock.fire();
    const end = firstEnd(knock.ropes);
    expect(end.kind).toBe("prop");
    expect("id" in end ? end.id : -1, "the prop's placement").toBe(KNOCKABLE);
    const plain = rig(scene);
    plain.aimAt(new THREE.Vector3(3, EYE_Y, -AHEAD));
    plain.fire();
    plain.aimAt(new THREE.Vector3(0, EYE_Y, -WALL_AHEAD));
    plain.fire();
    expect(plain.director["heldCar"], "a prop that cannot be knocked is a point of the world").toBe(WORLD);
    expect(plain.ropes.attached.length, "no rope for a point of the world and a point of the world").toBe(0);
  });
});

describe("given the free camera over a pile of boxes", () => {
  it("when it fires at the second box and then at the wall, then the rope's first end is box 1", () => {
    const scene = new THREE.Scene();
    cubes(scene, BOXES_MESH_NAME);
    wall(scene);
    scene.updateMatrixWorld(true);
    const { aimAt, fire, ropes } = rig(scene);
    aimAt(new THREE.Vector3(3, EYE_Y, -AHEAD));
    fire();
    aimAt(new THREE.Vector3(0, EYE_Y, -WALL_AHEAD));
    fire();
    const end = firstEnd(ropes);
    expect(end.kind).toBe("box");
    expect("id" in end ? end.id : -1, "the box's index").toBe(1);
  });
});

describe("given a camera over a wall 30 m off", () => {
  const hookHeight = (chase: boolean): { y: number; sight: number | undefined } => {
    const scene = new THREE.Scene();
    wall(scene);
    const { director, aimAt, fire } = rig(scene, [], chase);
    aimAt(new THREE.Vector3(0, EYE_Y, -WALL_AHEAD));
    fire();
    return { y: director["view"].point.y, sight: director.hud()?.sight };
  };

  it("when it is a chase camera, then the aim runs through a point 38 % from the top of the view and hits the wall higher than the middle does", () => {
    const { y, sight } = hookHeight(true);
    expect(sight, "the reticle's height").toBe(0.38);
    expect(Math.abs(y - (EYE_Y + WALL_AHEAD * 0.24 * Math.tan(HALF_FOV))) < 0.1, `hooked at ${y.toFixed(2)} m`).toBeTruthy();
  });

  it("when it is not (first person, the free camera), then the aim runs through the middle of the view", () => {
    const { y, sight } = hookHeight(false);
    expect(sight, "the reticle's height").toBe(0.5);
    expect(Math.abs(y - EYE_Y) < 0.05, `hooked at ${y.toFixed(2)} m`).toBeTruthy();
  });
});
