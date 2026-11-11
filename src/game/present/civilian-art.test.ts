import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { CivilianArt } from "./civilian-art.ts";
import { FAR_DRAW, FIGURE_FLOATS, NEAR_DRAW, NEAR_SLOTS, SLOTS_PER_DUMMY_MESH } from "./civilian-art-constants.ts";
import { dressOfLook } from "./civilian-dress.ts";
import { drawCalls, emptyPoses, FRAME_SECONDS, IN_SIGHT, posesAlongStreet, posesScattered } from "./civilian-art.test-util.ts";
import type { DriverLook } from "./driver-look.ts";
import { ROLE } from "./dummy-rig.ts";
import { blankStance, People, walkStance } from "./people.ts";
import { PARTS } from "./ragdoll-body.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { must } from "../kernel/must.test-util.ts";
import { DOOR, stoopStepRange } from "../world/openworld/openworld-facade-solids.ts";
import { Stoops } from "../world/openworld/openworld-stoops.ts";
import { WALK_SPEED } from "./walker-locomotion.ts";

const SCRATCH_LOOK: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
const shirtOf = (look: number): number => {
  dressOfLook(look, SCRATCH_LOOK);
  return SCRATCH_LOOK.shirt;
};
/** Inside the near line, so a crowd of any size here fills every dummy slot and has figures over. */
const CROWD_RADIUS = NEAR_DRAW * 0.75;
const NEAR_STREET = Array.from({ length: 30 }, (_, civilian) => civilian + 1);
/** x of the figure in instance `instance`. */
const figureX = (art: CivilianArt, instance: number): number => art.figures.instanceMatrix.array[instance * FIGURE_FLOATS.MATRIX + 12]!;

describe("given a street of civilians and a tier of twelve dummies, the eye at one end", () => {
  const distances = [3.5, 300, FAR_DRAW + 5, 119, 100, 60, ...[...NEAR_STREET].reverse()];
  const hiddenCivilian = 0;
  const poses = posesAlongStreet(distances);
  poses.shown[hiddenCivilian] = 0;
  const art = new CivilianArt(NEAR_SLOTS.phone, distances.length);
  art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);

  it("when it is drawn, then the twelve nearest civilians are dummies and no other is", () => {
    const hasDummy = distances.map((_, civilian) => (art.slotOfCivilian(civilian) >= 0 ? 1 : 0));
    const expected = distances.map((distance, civilian) => (civilian !== hiddenCivilian && distance <= NEAR_STREET[NEAR_SLOTS.phone - 1]! ? 1 : 0));
    expect(firstMismatch(hasDummy, expected), "civilians with a dummy").toBeUndefined();
    expect(art.nearDrawn, "dummies drawn").toBe(NEAR_SLOTS.phone);
  });

  it("when it is drawn, then every other civilian in view is a figure, and none past 120 m or hidden is drawn at all", () => {
    const expectedFigureXs = [...NEAR_STREET.slice(NEAR_SLOTS.phone), 60, 100, 119];
    const drawnFigureXs = Array.from({ length: art.farDrawn }, (_, instance) => figureX(art, instance)).sort((a, b) => a - b);
    expect(firstMismatch(drawnFigureXs, expectedFigureXs), "figure positions").toBeUndefined();
  });
});

describe("given a dummy's civilian who is then hidden", () => {
  it("when the crowd hides her, then her dummy goes and nothing of her is drawn", () => {
    const art = new CivilianArt(2, 2);
    const poses = posesAlongStreet([5, 10]);
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect(art.dummies[0]!.count, "dummies out before").toBe(2);
    poses.shown[1] = 0;
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect(art.dummies[0]!.count, "dummies out after").toBe(1);
    expect(art.slotOfCivilian(1), "her slot").toBe(-1);
    expect(art.farDrawn, "figures drawn").toBe(0);
  });
});

describe("given civilians a physical body stands for", () => {
  // mutation: sed -i 's/ || (held !== null \&\& held\[civilian\] === 1) || dx \* dx/ || dx * dx/' src/game/present/civilian-art.ts
  it("when the caller names one held, then she is drawn neither as a dummy nor as a figure, and the others are", () => {
    const art = new CivilianArt(1, 3);
    const poses = posesAlongStreet([5, 10, 60]);
    const held = Uint8Array.of(0, 1, 0);
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS, held);
    expect(art.slotOfCivilian(1), "the held one's dummy slot").toBe(-1);
    expect(art.slotOfCivilian(0), "the near one's slot").toBeGreaterThanOrEqual(0);
    expect(art.farDrawn, "figures drawn: the far one alone (the one dummy is the near one's)").toBe(1);
    held[1] = 0;
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS, held);
    expect(art.farDrawn, "let go: drawn again, as a figure (the one dummy is still the near one's)").toBe(2);
  });
});

describe("given the one dummy of a tier held by a civilian 10 m away", () => {
  const poses = posesAlongStreet([10, 20]);
  const art = new CivilianArt(1, 2);
  art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);

  it("when another civilian comes to 9.5 m, then the holder keeps the dummy", () => {
    poses.x[1] = 9.5;
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect(art.slotOfCivilian(0), "holder's slot").toBe(0);
    expect(art.slotOfCivilian(1), "newcomer's slot").toBe(-1);
  });

  it("when the other comes to 8 m, then she takes the dummy and the first becomes a figure", () => {
    poses.x[1] = 8;
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect(art.slotOfCivilian(1), "newcomer's slot").toBe(0);
    expect(art.slotOfCivilian(0), "former holder's slot").toBe(-1);
    expect(art.farDrawn, "figures drawn").toBe(1);
  });
});

describe("given a civilian near enough for a dummy", () => {
  const poses = emptyPoses(1);
  poses.x[0] = 5;
  const art = new CivilianArt(1, 1);
  art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
  const slotShirt = (): number => art.dummies[0]!.colourOf(0, ROLE.SHIRT, new THREE.Color()).getHex();

  it("when she is drawn, then her dummy wears the shirt her look dresses her in", () => {
    expect(slotShirt(), "dummy's shirt").toBe(new THREE.Color().setHex(shirtOf(poses.look[0]!)).getHex());
  });

  it("when her look changes, then her dummy is dressed again", () => {
    let other = poses.look[0]! + 1;
    while (shirtOf(other) === shirtOf(poses.look[0]!)) other++;
    poses.look[0] = other;
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect(slotShirt(), "dummy's shirt").toBe(new THREE.Color().setHex(shirtOf(other)).getHex());
  });
});

describe("given the desktop tier's forty dummies and forty civilians within 20 m", () => {
  it("when they are drawn, then forty dummies are posed, more than one dummy mesh can track", () => {
    const art = new CivilianArt(NEAR_SLOTS.desktop, NEAR_SLOTS.desktop);
    const poses = posesAlongStreet(Array.from({ length: NEAR_SLOTS.desktop }, (_, civilian) => 1 + civilian * 0.5));
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    const posedByMesh = art.dummies.map((mesh) => mesh.count);
    expect(art.nearDrawn, "dummies drawn").toBe(NEAR_SLOTS.desktop);
    expect(firstMismatch(posedByMesh, [SLOTS_PER_DUMMY_MESH, NEAR_SLOTS.desktop - SLOTS_PER_DUMMY_MESH]), "slots each dummy mesh draws").toBeUndefined();
  });
});

describe("given a civilian at a stride phase of a quarter turn with a dummy", () => {
  const shinPointZ = (speed: number): number => {
    const poses = emptyPoses(1);
    poses.x[0] = 5;
    poses.stride[0] = Math.PI / 2;
    poses.speed[0] = speed;
    const art = new CivilianArt(1, 1);
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    const standingShin = PARTS[7]!.c;
    return art.dummies[0]!.partPoint(0, 7, new THREE.Vector3(standingShin[0], standingShin[1], standingShin[2]), new THREE.Vector3()).z;
  };

  it("when she walks, then her shin swings off the vertical", () => {
    expect(Math.abs(shinPointZ(1)), "shin's z while walking").toBeGreaterThan(0.1);
  });

  it("when she stands still, then her shin hangs where it stands", () => {
    expect(Math.abs(shinPointZ(0)), "shin's z while standing").toBeLessThan(0.01);
  });
});

describe("given two civilians in figure range, one walking east and one standing", () => {
  const poses = emptyPoses(2);
  poses.x[0] = 60;
  poses.yaw[0] = Math.PI / 2;
  poses.stride[0] = 1.25;
  poses.speed[0] = WALK_SPEED;
  poses.x[1] = 70;
  poses.stride[1] = 2;
  const art = new CivilianArt(0, 2);
  art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
  const gait = art.figures.geometry.getAttribute("gait");

  it("when they are drawn, then the walker's figure faces +x like a dummy facing yaw 90 degrees", () => {
    const matrix = art.figures.instanceMatrix.array;
    expect(matrix[8]!, "forward axis x").toBeCloseTo(1, 5);
    expect(matrix[10]!, "forward axis z").toBeCloseTo(0, 5);
  });

  it("when they are drawn, then the walker swings at her stride and the standing one does not swing", () => {
    expect(gait.getX(0), "walker's phase").toBeCloseTo(1.25, 5);
    expect(gait.getY(0), "walker's swing").toBe(1);
    expect(gait.getY(1), "standing figure's swing").toBe(0);
  });
});

describe("given far figures walking at half, at and at three times a walk's pace, and one running past the swing's limit", () => {
  const poses = emptyPoses(3);
  for (let civilian = 0; civilian < 3; civilian++) poses.x[civilian] = 60 + civilian;
  poses.speed[0] = WALK_SPEED / 2;
  poses.speed[1] = WALK_SPEED * 3;
  poses.speed[2] = WALK_SPEED;
  const art = new CivilianArt(0, 3);
  art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
  const gait = art.figures.geometry.getAttribute("gait");
  const instanceAt = (x: number): number => Array.from({ length: art.farDrawn }, (_, instance) => instance).find((instance) => figureX(art, instance) === x) ?? -1;

  // mutation: sed -i 's|Math.min(FIGURE_MAX_GAIT, poses.speed\[civilian\]! / WALK_SPEED)|Math.min(FIGURE_MAX_GAIT, 1)|' src/game/present/civilian-art.ts
  it("when they are drawn, then each swings by her brain's pace over a walk's, never past 1.6", () => {
    expect(gait.getY(instanceAt(60)), "half a walk's pace").toBeCloseTo(0.5, 5);
    expect(gait.getY(instanceAt(61)), "three times the pace: the limit").toBeCloseTo(1.6, 5);
    expect(gait.getY(instanceAt(62)), "a walk's pace").toBeCloseTo(1, 5);
  });
});

describe("given a civilian in dummy range whose brain jumps a metre in one frame", () => {
  const torsoX = (art: CivilianArt): number => art.dummies[0]!.partPoint(0, 0, new THREE.Vector3(PARTS[0]!.c[0], PARTS[0]!.c[1], PARTS[0]!.c[2]), new THREE.Vector3()).x;

  // mutation: sed -i 's/^  smoothing.walk(civilian, pose);$/  void 0;/' src/game/present/civilian-pose.ts
  it("when the second frame is drawn, then her dummy has moved only part of the way: the drawn walk closes on the brain's", () => {
    const poses = emptyPoses(1);
    poses.x[0] = 5;
    const art = new CivilianArt(1, 1);
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    const first = torsoX(art);
    poses.x[0] = 6;
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect(torsoX(art) - first, "metres moved of the one").toBeGreaterThan(0);
    expect(torsoX(art) - first, "metres moved of the one").toBeLessThan(0.9);
  });
});

describe("given a civilian on a stoop's door spur standing on its third tread, a foot on the step", () => {
  const STEP_3 = stoopStepRange(3);
  const stoops = new Stoops([{ x: 0, z: 0, yaw: 0, depth: 10, style: "federal", storeys: 3, variant: 0 }], [0]);
  const SHIN = 7;
  const ankleOf = (stoopsOf: Stoops | null): THREE.Vector3 => {
    const poses = emptyPoses(1);
    poses.x[0] = (STEP_3.near + STEP_3.far) / 2;
    poses.z[0] = DOOR.across;
    poses.yaw[0] = Math.PI / 2;
    poses.stride[0] = Math.PI;
    poses.speed[0] = WALK_SPEED;
    poses.onSpur[0] = 1;
    const art = new CivilianArt(1, 1);
    art.stoops = stoopsOf;
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    const shin = PARTS[SHIN]!;
    return art.dummies[0]!.partPoint(0, SHIN, new THREE.Vector3(shin.c[0], shin.c[1] - shin.h[1], shin.c[2]), new THREE.Vector3());
  };

  // mutation: sed -i 's/poses, civilian, this.smoothing, this.stoops);/poses, civilian, this.smoothing, null);/' src/game/present/civilian-art.ts
  it("when she is drawn, then her ankle stands a tread's height above the street's", () => {
    const flat = ankleOf(null);
    const planted = ankleOf(stoops);
    expect(planted.y - flat.y, "ankle's rise").toBeCloseTo(STEP_3.top, 2);
    expect(planted.x, "ankle's x").toBeCloseTo(flat.x, 2);
  });
});

describe("given a crowd of a few over the dummies, 150 and 300 scattered within 30 m of the eye on the desktop tier", () => {
  /** The smallest crowd still has figures: a few more civilians than the tier has dummies. */
  const SMALL_CROWD = NEAR_SLOTS.desktop + 10;
  const callsFor = (count: number): { calls: number; near: number; far: number } => {
    const art = new CivilianArt(NEAR_SLOTS.desktop, count);
    art.update(posesScattered(count, CROWD_RADIUS, count), 0, 0, IN_SIGHT, FRAME_SECONDS);
    return { calls: drawCalls(art.group), near: art.nearDrawn, far: art.farDrawn };
  };

  it("when each is drawn, then the draw calls are the same whatever the crowd's size", () => {
    const small = callsFor(SMALL_CROWD);
    const medium = callsFor(150);
    const large = callsFor(300);
    expect([small.near > 0, medium.near > 0, large.near > 0], "a crowd has dummies").toEqual([true, true, true]);
    expect([small.far > 0, medium.far > 0, large.far > 0], "a crowd has figures").toEqual([true, true, true]);
    expect(firstMismatch([small.calls, medium.calls, large.calls], [large.calls, large.calls, large.calls]), "draw calls at the small, 150 and 300 crowds").toBeUndefined();
    expect(large.calls, "draw calls").toBeLessThanOrEqual(6);
  });
});

describe("given a civilian walking and a guard walking the same stride at the same place", () => {
  const STRIDES = [0.7, 2.1, 4, 5.5] as const;
  const LEG_EXTREMES = [Math.PI / 2, (3 * Math.PI) / 2] as const;
  const THIGHS = [6, 8] as const;
  const REST_OFFSET = new THREE.Vector3(0.03, 0.05, 0.02);
  /** Hers is a rounder walk than the guards' (a stride's bob and counter-turn, a foot that does not slide): a part is no further than this (m) from where the guard's is. */
  const LIKE_A_GUARD = 0.2;
  /** The stride's extremes are the guards' (her legs reach as far), over the ground: hers hang lower only as her hips drop. */
  const SAME_REACH = 0.005;

  it("when both are posed, then every body part of the civilian's dummy lies within a short way of the guard's", () => {
    const poses = emptyPoses(1);
    poses.x[0] = 4;
    poses.z[0] = -3;
    poses.yaw[0] = 1.1;
    poses.speed[0] = WALK_SPEED;
    const guards = new People(1);
    const guardMesh = guards.group.children.find((child): child is DummyMesh => child instanceof DummyMesh);
    must(guardMesh, "the guards' people hold a dummy mesh");
    const civilianPart = new THREE.Vector3();
    const guardPart = new THREE.Vector3();
    for (const stride of STRIDES) {
      poses.stride[0] = stride;
      const art = new CivilianArt(1, 1);
      art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
      guards.stand(0, 4, 0, -3, 1.1, walkStance(stride, false, blankStance()), false);
      for (let part = 0; part < PARTS.length; part++) {
        const rest = new THREE.Vector3(...PARTS[part]!.c).add(REST_OFFSET);
        art.dummies[0]!.partPoint(0, part, rest, civilianPart);
        guardMesh.partPoint(0, part, rest, guardPart);
        expect(civilianPart.distanceTo(guardPart), `part ${part} at stride ${stride}`).toBeLessThan(LIKE_A_GUARD);
      }
    }
  });

  it("when both are posed at the extremes of the stride, then the civilian's thighs reach as far forward and back as the guard's do", () => {
    const poses = emptyPoses(1);
    poses.speed[0] = WALK_SPEED;
    const guards = new People(1);
    const guardMesh = guards.group.children.find((child): child is DummyMesh => child instanceof DummyMesh);
    must(guardMesh, "the guards' people hold a dummy mesh");
    const civilianPart = new THREE.Vector3();
    const guardPart = new THREE.Vector3();
    for (const stride of LEG_EXTREMES) {
      poses.stride[0] = stride;
      const art = new CivilianArt(1, 1);
      art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
      guards.stand(0, 0, 0, 0, 0, walkStance(stride, false, blankStance()), false);
      for (const part of THIGHS) {
        const knee = new THREE.Vector3(...PARTS[part]!.c).add(new THREE.Vector3(0, -PARTS[part]!.h[1], 0));
        art.dummies[0]!.partPoint(0, part, knee, civilianPart);
        guardMesh.partPoint(0, part, knee, guardPart);
        expect(Math.abs(civilianPart.z - guardPart.z), `part ${part} at stride ${stride}`).toBeLessThan(SAME_REACH);
      }
    }
  });
});
