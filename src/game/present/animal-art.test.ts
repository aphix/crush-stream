import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SPECIES, SPECIES_SPEED } from "../ai/civilians/civilian-constants.ts";
import { CAT_COAT, DOWNED_LIFE_SECONDS, LOOK } from "../ai/civilians/civilian-crowd-constants.ts";
import { createCrowdPoses, type CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { AnimalArt } from "./animal-art.ts";
import { ANIMAL_RIG, ANIMAL_SHAPES, animalGeometry, animalPoint, type AnimalPose, PART } from "./animal-figure.ts";
import { FEET_Y } from "./civilian-art-constants.ts";
import { FRAME_SECONDS, IN_SIGHT } from "./civilian-art.test-util.ts";

/** A person, a cat and a dog on the street, each at its own spot and facing. */
const SPOTS = [
  { species: SPECIES.person, x: 4, z: 2, yaw: 0.3 },
  { species: SPECIES.cat, x: -6, z: 3, yaw: 1.1 },
  { species: SPECIES.dog, x: 10, z: -5, yaw: -2 },
] as const;
const CAT = 1;
const DOG = 2;
/** Frames for a posture to settle (its time constant is under half a second). */
const SETTLE_FRAMES = 300;
/** A paw this far (m) off its rest spot is swinging. */
const SWING_REACH = 0.05;
/** The sitting haunch's underside stays this near (m) the ground. */
const HAUNCH_SLACK = 0.02;
const EPSILON = 1e-6;

function lookWord(species: number, who: number): number {
  return ((species << LOOK.speciesShift) | who) >>> 0;
}

function streetPoses(): CrowdPoses {
  const poses = createCrowdPoses(SPOTS.length);
  for (let resident = 0; resident < SPOTS.length; resident++) {
    const spot = SPOTS[resident]!;
    poses.shown[resident] = 1;
    poses.look[resident] = lookWord(spot.species, CAT_COAT.orange);
    poses.x[resident] = spot.x;
    poses.z[resident] = spot.z;
    poses.yaw[resident] = spot.yaw;
  }
  return poses;
}

function frames(art: AnimalArt, poses: CrowdPoses, count: number): void {
  for (let frame = 0; frame < count; frame++) art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
}

/** The first instance's pose of species `species` as the shader reads it. */
function poseOf(art: AnimalArt, species: number): AnimalPose {
  const poses = art.figuresOf(species).poses;
  return { phase: poses[0]!, gait: poses[1]!, sit: poses[2]!, lie: poses[3]! };
}

/** Where the cat's lowest vertex of `part` (a paw) is drawn in `pose`. */
function pawOf(part: number, pose: AnimalPose): THREE.Vector3 {
  const geometry = animalGeometry(SPECIES.cat);
  const position = geometry.getAttribute("position");
  const rig = geometry.getAttribute(ANIMAL_RIG);
  let lowest = -1;
  for (let vertex = 0; vertex < position.count; vertex++) if (rig.getX(vertex) === part && (lowest < 0 || position.getY(vertex) < position.getY(lowest))) lowest = vertex;
  return animalPoint(position.getX(lowest), position.getY(lowest), position.getZ(lowest), part, rig.getZ(lowest), rig.getW(lowest), pose, ANIMAL_SHAPES[SPECIES.cat]!, new THREE.Vector3());
}

describe("given the open world's cats and dogs on the street", () => {
  // mutation: sed -i 's/      if (poses.shown\[resident\] === 0 || species === SPECIES.person || dx \* dx + dz \* dz > FAR_DRAW_SQUARED) {/      if (poses.shown[resident] === 0 || dx * dx + dz * dz > FAR_DRAW_SQUARED) {/' /home/aphix/worktrees/Life/src/game/present/animal-art.ts
  it("when a frame is drawn, then each animal is one instance of its species' one draw, standing at its spot facing its way, and the person is none of them", () => {
    const art = new AnimalArt(SPOTS.length);
    frames(art, streetPoses(), 1);
    expect(art.group.children.length, "a draw per species").toBe(2);
    for (const [resident, species] of [[CAT, SPECIES.cat], [DOG, SPECIES.dog]] as const) {
      const figures = art.figuresOf(species);
      const spot = SPOTS[resident];
      expect(figures.mesh.count, `${species}: instances`).toBe(1);
      const matrix = new THREE.Matrix4().fromArray(figures.matrices);
      const expected = new THREE.Matrix4().makeRotationY(spot.yaw).setPosition(spot.x, FEET_Y, spot.z);
      for (let at = 0; at < 16; at++) expect(matrix.elements[at], `${species}: matrix ${at}`).toBeCloseTo(expected.elements[at]!, 5);
    }
  });

  // mutation: sed -i 's/      coats\[c + channel\] = kind.coats\[coat + channel\]!;/      coats[c + channel] = kind.coats[channel]!;/' /home/aphix/worktrees/Life/src/game/present/animal-art.ts
  it("when a cat's look names its coat, then it is drawn in that coat: the black cat with white socks black with white paws", () => {
    const art = new AnimalArt(SPOTS.length);
    const poses = streetPoses();
    poses.look[CAT] = lookWord(SPECIES.cat, CAT_COAT.socks);
    frames(art, poses, 1);
    const { coats, accents } = art.figuresOf(SPECIES.cat);
    expect(Math.max(coats[0]!, coats[1]!, coats[2]!), "a black coat").toBeLessThan(0.05);
    expect(Math.min(accents[0]!, accents[1]!, accents[2]!), "white socks").toBeGreaterThan(0.8);
  });

  // mutation: sed -i 's/    this.downedUntil\[slot\] = this.clock + DOWNED_LIFE_SECONDS;/    this.downedUntil[slot] = this.clock;/' /home/aphix/worktrees/Life/src/game/present/animal-art.ts
  it("when an animal is run down, then it lies on its side where it was struck until its time is up", () => {
    const art = new AnimalArt(SPOTS.length);
    const poses = streetPoses();
    poses.shown[DOG] = 0;
    art.knocked({ x: 7, z: 8, vx: 0, vz: 1 }, lookWord(SPECIES.dog, 0));
    frames(art, poses, 1);
    const figures = art.figuresOf(SPECIES.dog);
    expect(figures.mesh.count, "the downed dog").toBe(1);
    expect(figures.matrices[1], "its side down: its own x is the world's up").toBeCloseTo(1, 6);
    expect([figures.matrices[12], figures.matrices[14]], "where it was struck").toEqual([7, 8]);
    frames(art, poses, Math.ceil(DOWNED_LIFE_SECONDS / FRAME_SECONDS) + 1);
    expect(figures.mesh.count, "gone").toBe(0);
  });
});

describe("given a cat's legs", () => {
  // mutation: sed -i 's/  const swing = diagonal \* pose.gait \* LEG_SWING/  const swing = 0 * pose.gait * LEG_SWING/' /home/aphix/worktrees/Life/src/game/present/animal-figure.ts
  it("when it walks, then its diagonal paws swing opposite ways by its stride; when it stands still they rest under it", () => {
    const art = new AnimalArt(SPOTS.length);
    const poses = streetPoses();
    poses.speed[CAT] = SPECIES_SPEED[SPECIES.cat];
    poses.stride[CAT] = Math.PI / 2;
    frames(art, poses, 1);
    const walking = poseOf(art, SPECIES.cat);
    expect(walking.gait, "a full walk").toBeCloseTo(1, 6);
    const rest = { phase: 0, gait: 0, sit: 0, lie: 0 };
    const forward = pawOf(PART.frontLeft, walking).z - pawOf(PART.frontLeft, rest).z;
    expect(Math.abs(forward), "the front left paw swings").toBeGreaterThan(SWING_REACH);
    expect(Math.sign(pawOf(PART.frontRight, walking).z - pawOf(PART.frontRight, rest).z), "its partner the other way").toBe(-Math.sign(forward));
    poses.speed[CAT] = 0;
    frames(art, poses, 1);
    const still = poseOf(art, SPECIES.cat);
    expect(still.gait, "still").toBe(0);
    expect(pawOf(PART.frontLeft, { ...still, sit: 0, lie: 0 }).distanceTo(pawOf(PART.frontLeft, rest)), "the paw at rest").toBeLessThan(EPSILON);
  });

  // mutation: sed -i 's/    const lying = still \&\& poses.activityClock\[resident\]! >= LIE_AFTER_SECONDS\[species\]!;/    const lying = false;/' /home/aphix/worktrees/Life/src/game/present/animal-art.ts
  it("when it stays still, then it sits on its haunch, and after a while of rest it lies down with its belly to the ground", () => {
    const art = new AnimalArt(SPOTS.length);
    const poses = streetPoses();
    frames(art, poses, SETTLE_FRAMES);
    const sitting = poseOf(art, SPECIES.cat);
    expect(sitting.sit, "sitting").toBeGreaterThan(0.99);
    const shape = ANIMAL_SHAPES[SPECIES.cat]!;
    expect(Math.abs(animalPoint(0, shape.leg, -shape.bodyLength / 2, PART.body, 0, 0, sitting, shape, new THREE.Vector3()).y), "the haunch down on the ground").toBeLessThan(HAUNCH_SLACK);
    poses.activityClock[CAT] = 60;
    frames(art, poses, SETTLE_FRAMES);
    const lying = poseOf(art, SPECIES.cat);
    expect(lying.lie, "lying").toBeGreaterThan(0.99);
    const belly = animalPoint(0, shape.leg, 0, PART.body, 0, 0, lying, shape, new THREE.Vector3()).y;
    expect(belly, "the belly on the ground").toBeLessThan(shape.legHalf + 0.01);
  });
});
