import { describe, expect, it } from "vitest";
import type { LookRay, Meeting } from "../ai/civilians/civilian-look.ts";
import * as THREE from "three";
import { FRAME_HZ, MAX_TETHERS } from "../kernel/constants.ts";
import { hypot3 } from "../kernel/physics-core.js";
import { RAPIER, TetherSet, WORLD } from "../contact/tether.ts";
import { ANIMAL_MESH_NAMES } from "../present/animal-figure.ts";
import { CIVILIAN_FIGURES_NAME } from "../present/civilian-figure.ts";
import { BOXES_MESH_NAME } from "../present/minigame-art.ts";
import { INTERIOR_GLASS_NAME, INTERIOR_MESH_PREFIX } from "../present/interiors/interior-constants.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import { RAGDOLLS_MESH_NAME } from "../present/ragdoll-pool.ts";
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
/** No drawn civilian along any sight line. */
const noPerson = (_ray: LookRay, reach: number, out: Meeting): Meeting => Object.assign(out, { index: -1, along: reach });

/** The dummies' world as the tether sees it: it records the ropes it is asked for. */
function fakeRopes(dollsOut: number[]) {
  const attached: Attached[] = [];
  /** Where every dummy out has his torso: as `dummy` puts him, `AHEAD` m ahead, until a row walks him. */
  const torsoAt = new THREE.Vector3(PARTS[0].c[0], PARTS[0].c[1], PARTS[0].c[2] - AHEAD);
  return {
    attached,
    torsoAt,
    /** Slots the director said it holds as a first end. */
    held: [] as number[],
    ropeAttach: (slot: number, a: RopeEnd, b: RopeEnd): number => attached.push({ slot, a, b }),
    ropeCut: () => {},
    ropeReel: () => {},
    dollOut: (slot: number) => dollsOut.includes(slot),
    torso: (slot: number, out: THREE.Vector3): boolean => dollsOut.includes(slot) && out.copy(torsoAt) === out,
    ropeReport: { command: 0, floats: new Float32Array(MAX_TETHERS * ROPE_FLOATS) },
  };
}

/** A drawn civilian with no body whose chest stands `AHEAD` m straight ahead (along -z), and the slot a body stood for her takes. */
const PERSON = 9;
const PERSON_SLOT = 5;

/** A free camera at the origin, `scene`, and a tether on it: `aimAt(point)` turns the camera, `fire()` is a fire and a frame. `person`: `PERSON` stands straight ahead. */
function rig(scene: THREE.Scene, dollsOut: number[] = [0], chase = false, person = false) {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, EYE_Y, 0);
  const ropes = fakeRopes(dollsOut);
  const tethers = new TetherSet();
  const personMet = (ray: LookRay, reach: number, out: Meeting): Meeting => (person && Math.abs(ray.dirX) < 0.01 && reach > AHEAD ? Object.assign(out, { index: PERSON, along: AHEAD }) : noPerson(ray, reach, out));
  const standPerson = (civilian: number): number => {
    if (civilian !== PERSON) return -1;
    dollsOut.push(PERSON_SLOT);
    return PERSON_SLOT;
  };
  const director = new TetherDirector({ tethers, camera, scene, ropes, cars: () => [], movers: () => [], playerCar: () => -1, offered: () => true, chase: () => chase, afoot: () => true, self: () => -1, actor: () => 0, actorSlot: () => -1, actorAfoot: () => false, guest: () => false, hostHolds: () => false, hostCables: () => 0, sendAct: () => {}, personMet, standPerson, holdDoll: (slot: number) => void ropes.held.push(slot) });
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

/** Dummy slot 0 standing `AHEAD` m ahead, drawn on a mesh named `name` (the pool's by default); his torso's middle. */
function dummy(scene: THREE.Scene, name = RAGDOLLS_MESH_NAME): THREE.Vector3 {
  const mesh = new DummyMesh(1);
  mesh.name = name;
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
    expect(director["holds"][0]!.car, "what the first fire holds: the wall, not the dummy").toBe(WORLD);
  });

  // mutation: sed -i 's/object.name !== RAGDOLLS_MESH_NAME || //' src/game/engine/tether-sight.ts
  it("when the man is drawn on another dummy mesh (the crowd's) whose instance is a slot out in the pool, then the ray passes through him and the cable's first end is the wall, not that slot's dummy", () => {
    const scene = new THREE.Scene();
    const torso = dummy(scene, "crowd");
    wall(scene);
    const { aimAt, fire, ropes } = rig(scene);
    aimAt(torso);
    fire();
    aimAt(new THREE.Vector3(BESIDE, EYE_Y, -WALL_AHEAD));
    fire();
    expect(ropes.attached.length, "no rope: no dummy of the pool was hooked").toBe(0);
  });
});

describe("given the free camera over a dummy standing out, held by a first fire", () => {
  // mutation: sed -i 's/      if (this.host.ropes.torso(thingIndex(hold.thing), hold.world, null)) return hold.world.add(hold.offset);/      if (this.host.ropes.dollOut(thingIndex(hold.thing))) return hold.world.copy(hold.at);/' src/game/engine/engine-tether.ts
  // mutation: sed -i '/^        this.host.holdDoll(thingIndex(aim.thing));/d' src/game/engine/engine-tether.ts
  it("when he walks 2 m to the side, then the held marker moves 2 m with him, and the second fire ties him where he is now", () => {
    const scene = new THREE.Scene();
    const torso = dummy(scene);
    wall(scene);
    const { director, aimAt, fire, ropes } = rig(scene);
    aimAt(torso);
    fire();
    expect(ropes.held, "the dummy held is kept for the second fire").toEqual([0]);
    const before = director["heldPlace"]()!.clone();
    ropes.torsoAt.x += 2;
    const after = director["heldPlace"]()!;
    expect(hypot3(after.x - before.x - 2, after.y - before.y, after.z - before.z), "the marker from where he took it (m)").toBeLessThan(1e-6);
    aimAt(new THREE.Vector3(BESIDE, EYE_Y, -WALL_AHEAD));
    fire();
    const end = firstEnd(ropes).at;
    expect(hypot3(end[0] - after.x, end[1] - after.y, end[2] - after.z), "the rope's first end from the marker (m)").toBeLessThan(1e-6);
  });
});

describe("given the free camera over a drawn civilian with no body, with a wall behind her", () => {
  // mutation: sed -i '/^      into.person = person.index;/d' src/game/engine/engine-tether.ts
  it("when it fires at her and then at the wall, then a body is stood for her and the cable's first end is that body's dummy at her chest", () => {
    const scene = new THREE.Scene();
    wall(scene);
    const { aimAt, fire, ropes } = rig(scene, [], false, true);
    aimAt(new THREE.Vector3(0, EYE_Y, -AHEAD));
    fire();
    aimAt(new THREE.Vector3(BESIDE, EYE_Y, -WALL_AHEAD));
    fire();
    const end = firstEnd(ropes);
    expect(end.kind === "doll" ? end.id : -1, "the body's slot").toBe(PERSON_SLOT);
    expect(hypot3(end.at[0], end.at[1] - EYE_Y, end.at[2] + AHEAD), "the hook from her chest (m)").toBeLessThan(1e-3);
  });
});

describe("given the free camera over a civilian drawn far off as one of the crowd's cheap figures, with a wall behind her", () => {
  // mutation: sed -i '/^    if (object.name === CIVILIAN_FIGURES_NAME) return undefined;/d' src/game/engine/engine-tether.ts
  it("when it fires at her and then at the wall, then the sight line passes her figure's front, a body is stood for her and the cable's first end is that body", () => {
    const scene = new THREE.Scene();
    wall(scene);
    // Her figure stands 2 m deep about her chest, so its front is a metre before it: past the person test's slack.
    const figure = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 2, 2), new THREE.MeshBasicMaterial(), 1);
    figure.name = CIVILIAN_FIGURES_NAME;
    figure.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, EYE_Y, -AHEAD));
    scene.add(figure);
    const { aimAt, fire, ropes } = rig(scene, [], false, true);
    aimAt(new THREE.Vector3(0, EYE_Y, -AHEAD));
    fire();
    aimAt(new THREE.Vector3(BESIDE, EYE_Y, -WALL_AHEAD));
    fire();
    const end = firstEnd(ropes);
    expect(end.kind === "doll" ? end.id : -1, "the body's slot").toBe(PERSON_SLOT);
  });
});

describe("given the free camera over a cat or a dog, with a wall behind it", () => {
  it("when the sight line passes through its body, then the aim is on the wall behind it: an animal is no surface to hook", () => {
    for (const name of [ANIMAL_MESH_NAMES.cat, ANIMAL_MESH_NAMES.dog]) {
      const scene = new THREE.Scene();
      wall(scene);
      cubes(scene, name);
      const { aimAt, fire, director } = rig(scene);
      aimAt(new THREE.Vector3(-3, EYE_Y, -AHEAD));
      fire();
      expect(director["mine"].point.z, `${name}: where the aim lands (m along -z)`).toBeLessThan(-WALL_AHEAD + 1);
    }
  });
});

/** A building's facade `FACADE_AHEAD` m ahead (a box drawn in a facade material), and behind it, when `room` says a room is built, its glass in the window's plane and its shell's wall 0.4 m behind the facade: with a 2 m opening at the middle when `window`, solid when not. */
const FACADE_AHEAD = 5;
/** A second building's facade (no room built) stands this far (m) ahead, behind the first and in front of the civilian. */
const SECOND_AHEAD = 8;
function building(scene: THREE.Scene, room: boolean, window: boolean, ahead = FACADE_AHEAD): void {
  const facade = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 0.4), new THREE.MeshBasicMaterial());
  facade.material.userData.facadeStyle = "rowbrick";
  facade.position.set(0, 0, -ahead - 0.2);
  scene.add(facade);
  if (!room) return;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  glass.name = INTERIOR_GLASS_NAME;
  glass.position.set(0, EYE_Y, -ahead - 0.1);
  scene.add(glass);
  const shellBox = (width: number, x: number): void => {
    const shell = new THREE.Mesh(new THREE.BoxGeometry(width, 10, 0.2), new THREE.MeshBasicMaterial());
    shell.name = `${INTERIOR_MESH_PREFIX}shells`;
    shell.position.set(x, 0, -ahead - 0.6);
    scene.add(shell);
  };
  if (window) {
    shellBox(9, -5.5);
    shellBox(9, 5.5);
  } else shellBox(20, 0);
}

/** The civilian `AHEAD` m ahead, behind the building at `ahead`, fired at straight on: how many bodies the fire stood for her. */
function bodiesStoodFor(room: boolean, window: boolean, second = false): number {
  const scene = new THREE.Scene();
  wall(scene);
  building(scene, room, window);
  if (second) building(scene, false, false, SECOND_AHEAD);
  const stood: number[] = [];
  const { aimAt, fire } = rig(scene, stood, false, true);
  aimAt(new THREE.Vector3(0, EYE_Y, -AHEAD));
  fire();
  return stood.length;
}

describe("given a civilian 10 m ahead behind a building's facade 5 m ahead", () => {
  it("when a built room's window is in the way, then the sight line passes the facade and the glass and the fire stands a body for her", () => {
    expect(bodiesStoodFor(true, true)).toBe(1);
  });

  it("when a built room's solid wall is in the way, then her body is not stood: the wall stops the person test", () => {
    expect(bodiesStoodFor(true, false)).toBe(0);
  });

  it("when no room is built behind the facade, then her body is not stood: the facade is a wall", () => {
    expect(bodiesStoodFor(false, false)).toBe(0);
  });

  it("when the sight line passes a built room's window and goes on into a second building with no room built, then her body behind that second facade is not stood", () => {
    expect(bodiesStoodFor(true, true, true)).toBe(0);
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
    expect(plain.director["holds"][0]!.car, "a prop that cannot be knocked is a point of the world").toBe(WORLD);
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
    return { y: director["mine"].point.y, sight: director.hud()?.sight };
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
