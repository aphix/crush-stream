import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { chestMet, type LookRay, type Meeting } from "../ai/civilians/civilian-look.ts";
import { CHEST_HEIGHT } from "../ai/civilians/civilian-crowd-constants.ts";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { TetherSet } from "../contact/tether.ts";
import { FRAME_HZ, MAX_TETHERS } from "../kernel/constants.ts";
import { detCos, detSin } from "../kernel/physics-core.js";
import { InteriorSet } from "../present/interiors/interior-art.ts";
import { SIGHT_ID_CAPACITY, SightField } from "../present/openworld-sight.ts";
import { ROPE_FLOATS } from "../present/ragdoll-wire.ts";
import { planInterior } from "../world/openworld/interior-plan.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { TetherDirector } from "./engine-tether.ts";

const FRAME = 1 / FRAME_HZ;
const map = buildOpenWorldMap(layOutLots());
const coffee = map.places.find((place) => place.interior === "coffee" && place.doorNode >= 0)!;
const lone = { ...map, places: [coffee] };
/** Frames the interior set is given to build its envelope and furniture at the door. */
const BUILD_FRAMES = 200;
/** The eye stands this far (m) out from the street wall, and the civilian this far (m) in from it. */
const OUT_M = 3;
const IN_M = 1.5;
/** How far (m) above a window's top the solid wall is aimed at: its lintel. */
const LINTEL_M = 0.2;
/** The fake facade: its thickness (m) and how much taller and wider than the building it is. */
const FACADE_THICK_M = 0.3;
const FACADE_MARGIN_M = 2;
const PERSON = 0;
const PERSON_SLOT = 5;

/** The point (x, z) of the place's frame, `across` m along its width and `along` m in from the street wall, in the world. */
function inPlace(across: number, along: number): { x: number; z: number } {
  const plan = planInterior(coffee);
  const local = plan.depth / 2 - along;
  return { x: coffee.x + local * detCos(coffee.yaw) + across * detSin(coffee.yaw), z: coffee.z - local * detSin(coffee.yaw) + across * detCos(coffee.yaw) };
}

/** A coffee shop's room built at its door, a facade standing in front of it, a civilian `IN_M` inside at height `y`, and the eye `OUT_M` out at that height, aimed at her through the wall: the bodies the fire stood for her. */
function bodiesStoodFor(across: number, y: number): number {
  const set = new InteriorSet(lone);
  const crowd = createCrowdPoses(1);
  crowd.x[0] = coffee.doorX;
  crowd.z[0] = coffee.doorZ;
  crowd.shown[0] = 1;
  const sight = new SightField([], SIGHT_ID_CAPACITY);
  for (let frame = 0; frame < BUILD_FRAMES; frame++) set.update(coffee.doorX, coffee.doorZ, FRAME, sight, { poses: crowd, walker: null, others: [], closed: null });
  const scene = new THREE.Scene();
  scene.add(set.group);
  const plan = planInterior(coffee);
  const facade = new THREE.Mesh(new THREE.BoxGeometry(FACADE_THICK_M, 20, coffee.width + FACADE_MARGIN_M), new THREE.MeshBasicMaterial());
  facade.material.userData.facadeStyle = "rowbrick";
  facade.rotation.y = coffee.yaw;
  const wallAt = inPlace(0, -FACADE_THICK_M / 2);
  facade.position.set(wallAt.x, 0, wallAt.z);
  scene.add(facade);
  const inside = inPlace(across, IN_M);
  const eyeAt = inPlace(across, -OUT_M);
  const people = createCrowdPoses(1);
  people.x[0] = inside.x;
  people.z[0] = inside.z;
  people.feetY[0] = y - CHEST_HEIGHT;
  people.shown[0] = 1;
  people.look[0] = 0;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(eyeAt.x, y, eyeAt.z);
  camera.lookAt(inside.x, y, inside.z);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const stood: number[] = [];
  const ropes = { ropeAttach: () => 0, ropeCut: () => {}, ropeReel: () => {}, dollOut: () => false, torso: () => false, ropeReport: { command: 0, floats: new Float32Array(MAX_TETHERS * ROPE_FLOATS) } };
  const personMet = (ray: LookRay, reach: number, out: Meeting): Meeting => {
    chestMet(people, 1, null, ray, 0.35, reach, out, true);
    if (out.index >= 0) out.index = PERSON;
    return out;
  };
  const standPerson = (civilian: number): number => {
    if (civilian !== PERSON) return -1;
    stood.push(PERSON_SLOT);
    return PERSON_SLOT;
  };
  const director = new TetherDirector({ tethers: new TetherSet(), camera, scene, ropes, cars: () => [], movers: () => [], playerCar: () => -1, offered: () => true, chase: () => false, afoot: () => true, self: () => -1, actor: () => 0, actorSlot: () => -1, guest: () => false, sendAct: () => {}, personMet, standPerson, holdDoll: () => {} });
  director.fire();
  director.frame(FRAME);
  expect(plan.panes.length, "control: the shop has windows").toBeGreaterThan(0);
  set.dispose();
  return stood.length;
}

describe("given a coffee shop's room built, its facade in front, and a civilian inside, the eye on the sidewalk", () => {
  const pane = planInterior(coffee).panes.find((candidate) => candidate.level === 0)!;
  const across = (pane.across0 + pane.across1) / 2;

  it("when the fire is aimed at her through the shop's window, then a body is stood for her", () => {
    expect(bodiesStoodFor(across, (pane.y0 + pane.y1) / 2)).toBe(1);
  });

  it("when the fire is aimed at her through the solid wall over the window, then no body is stood for her", () => {
    expect(bodiesStoodFor(across, pane.y1 + LINTEL_M)).toBe(0);
  });
});
