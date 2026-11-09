import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { POLICE_HASH } from "../ai/civilians/civilian-crowd-constants.ts";
import { CivilianArt } from "./civilian-art.ts";
import { FAR_DRAW, NEAR_DRAW, NEAR_SLOTS } from "./civilian-art-constants.ts";
import { drawCalls, emptyPoses, FRAME_SECONDS, IN_SIGHT, posesAlongStreet, posesScattered } from "./civilian-art.test-util.ts";
import { ROLE } from "./dummy-rig.ts";
import { dummyGeometry } from "./dummy-skin.ts";
import { HIDE_GRACE, type SightField } from "./openworld-sight.ts";

/** Frames timed per crowd size, after the warm-up frames. */
const TIMED_FRAMES = 200;
const WARM_FRAMES = 50;

describe("given a street of civilians and a sight field that can stop seeing them", () => {
  const distances = [5, 20, 80, FAR_DRAW + 20];
  const poses = posesAlongStreet(distances);
  let visible = true;
  let asked = 0;
  const sight: SightField = {
    seen: () => {
      asked++;
      return visible;
    },
  };
  const art = new CivilianArt(2, distances.length);
  /** Two frames of this length keep the unseen inside the grace, a third takes it out. */
  const STEP = HIDE_GRACE * 0.45;

  it("when all are seen, then the near two are dummies and the one in figure range a figure, and only the ones in range were asked about", () => {
    art.update(poses, 0, 0, sight, FRAME_SECONDS);
    expect([art.nearDrawn, art.farDrawn], "dummies and figures").toEqual([2, 1]);
    expect(asked, "civilians asked about").toBe(3);
  });

  it("when none is seen for less than the grace, then all are still drawn", () => {
    visible = false;
    art.update(poses, 0, 0, sight, STEP);
    art.update(poses, 0, 0, sight, STEP);
    expect([art.nearDrawn, art.farDrawn], "dummies and figures").toEqual([2, 1]);
  });

  it("when none has been seen for the grace, then none is drawn and the dummies are freed", () => {
    art.update(poses, 0, 0, sight, STEP);
    expect([art.nearDrawn, art.farDrawn], "dummies and figures").toEqual([0, 0]);
    expect(art.dummies[0]!.count, "dummies out").toBe(0);
    expect([art.slotOfCivilian(0), art.slotOfCivilian(1)], "their slots").toEqual([-1, -1]);
  });

  it("when they are seen again, then they are drawn on that frame", () => {
    visible = true;
    art.update(poses, 0, 0, sight, FRAME_SECONDS);
    expect([art.nearDrawn, art.farDrawn], "dummies and figures").toEqual([2, 1]);
  });
});

describe("given a crowd no one has seen yet", () => {
  it("when it is drawn, then nothing is, until a first sight of it", () => {
    const art = new CivilianArt(2, 2);
    const poses = posesAlongStreet([5, 80]);
    art.update(poses, 0, 0, { seen: () => false }, FRAME_SECONDS);
    expect([art.nearDrawn, art.farDrawn], "dummies and figures unseen").toEqual([0, 0]);
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect([art.nearDrawn, art.farDrawn], "dummies and figures seen").toEqual([1, 1]);
  });
});

describe("given a busy street, the eye at one end of it", () => {
  /** A civilian every quarter metre from 1 m, then one at 15 m: the one the owner saw drawn as a far figure. */
  const nearer = Array.from({ length: 56 }, (_, civilian) => 1 + civilian * 0.25);

  it("when it is the desktop tier, then even the fifty-seventh civilian, at 15 m, is a dummy", () => {
    const art = new CivilianArt(NEAR_SLOTS.desktop, nearer.length + 1);
    art.update(posesAlongStreet([...nearer, 15]), 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect(art.slotOfCivilian(nearer.length), "dummy slot of the civilian at 15 m").toBeGreaterThanOrEqual(0);
    expect(art.farDrawn, "figures").toBe(0);
  });

  it("when it is the phone tier, then the twentieth, at 15 m, is a dummy", () => {
    const phoneNearer = nearer.slice(0, 19);
    const art = new CivilianArt(NEAR_SLOTS.phone, phoneNearer.length + 1);
    art.update(posesAlongStreet([...phoneNearer, 15]), 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect(art.slotOfCivilian(phoneNearer.length), "dummy slot of the civilian at 15 m").toBeGreaterThanOrEqual(0);
  });

  it("when a civilian stands 55 m out and another 65 m out, then the first is a dummy and the second a figure", () => {
    const art = new CivilianArt(NEAR_SLOTS.desktop, 2);
    art.update(posesAlongStreet([55, 65]), 0, 0, IN_SIGHT, FRAME_SECONDS);
    expect([art.slotOfCivilian(0) >= 0, art.slotOfCivilian(1) >= 0], "who has a dummy").toEqual([true, false]);
    expect(art.farDrawn, "figures").toBe(1);
  });
});

describe("given a civilian whose look word is a foot cop's", () => {
  /** The colour of `role` on the dummy a civilian of look `look` is drawn as. */
  const dummyColour = (look: number, role: number): number => {
    const poses = emptyPoses(1);
    poses.x[0] = 5;
    poses.look[0] = look;
    const art = new CivilianArt(1, 1);
    art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    return art.dummies[0]!.colourOf(0, role, new THREE.Color()).getHex();
  };

  it("when her dummy is dressed, then she wears the police uniform's patch, which a civilian's shirt does not", () => {
    expect(dummyColour(POLICE_HASH, ROLE.PATCH), "cop's patch").not.toBe(dummyColour(POLICE_HASH, ROLE.SHIRT));
    const civilian = 0x1234567;
    expect(dummyColour(civilian, ROLE.PATCH), "civilian's patch is her shirt").toBe(dummyColour(civilian, ROLE.SHIRT));
  });
});

describe.each([50, 150, 300])("given a crowd of %i scattered over the near ring on the desktop tier", (count) => {
  const art = new CivilianArt(NEAR_SLOTS.desktop, count);
  const poses = posesScattered(count, NEAR_DRAW * 0.99, count);
  art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);

  it("when it is drawn, then the dummies fill the slots, the rest are figures, and the draws stay few", () => {
    expect(art.nearDrawn, "dummies").toBe(Math.min(NEAR_SLOTS.desktop, count));
    expect(art.farDrawn, "figures").toBe(count - art.nearDrawn);
    expect(drawCalls(art.group), "draw calls").toBeLessThanOrEqual(6);
    for (let frame = 0; frame < WARM_FRAMES; frame++) art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    const started = performance.now();
    for (let frame = 0; frame < TIMED_FRAMES; frame++) art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
    const milliseconds = (performance.now() - started) / TIMED_FRAMES;
    if (process.env.LOD_PRINT) {
      const dummyTriangles = dummyGeometry().index!.count / 3;
      const figureIndex = art.figures.geometry.index;
      const figureTriangles = (figureIndex === null ? art.figures.geometry.getAttribute("position").count : figureIndex.count) / 3;
      console.log(`civilian-art at ${count}: ${art.nearDrawn} dummies + ${art.farDrawn} figures, ${drawCalls(art.group)} draws, ${art.nearDrawn * dummyTriangles + art.farDrawn * figureTriangles} triangles, ${milliseconds.toFixed(3)} ms a frame`);
    }
  });
});
