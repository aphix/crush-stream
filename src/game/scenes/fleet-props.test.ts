import { describe, expect, it } from "vitest";
import { fleetProp, SCENE_IDS, type SceneId } from "./scene-id.ts";

/** What the user's three choices put on screen in `scene`. */
const up = (scene: SceneId, user: boolean) => ({ barrier: fleetProp(scene, "barrier", user), balls: fleetProp(scene, "balls", user), ramps: fleetProp(scene, "ramps", user) });

/** One scene's three props, each checked on its own. */
function expectUp(scene: SceneId, user: boolean, barrier: boolean, balls: boolean, ramps: boolean, what: string): void {
  const shown = up(scene, user);
  expect(shown.barrier, `${what} barrier`).toBe(barrier);
  expect(shown.balls, `${what} balls`).toBe(balls);
  expect(shown.ramps, `${what} ramps`).toBe(ramps);
}

describe("given the user's choices of fleet props (wall, balls, ramps) and the props each scene shows", () => {
  it("when the range and then the fleet are shown, then the range puts its wall up whatever the user chose, and the fleet after it shows the user's choice", () => {
    for (const user of [false, true]) {
      expect(up("range", user).barrier).toBe(true);
      expect(up("fleet", user).barrier, `fleet wall after a range visit, user ${user}`).toBe(user);
    }
  });

  it("when the user has chosen all three props or none, then the range shows the wall only (balls and ramps away) and the fleet after it shows the user's choice", () => {
    expectUp("range", true, true, false, false, "range, user on");
    expectUp("fleet", true, true, true, true, "fleet, user on");
    expectUp("fleet", false, false, false, false, "fleet, user off");
  });

  it("when the user has chosen all three props, then the derby, the race, Survival, the Lab and the rigs show none of them", () => {
    for (const scene of ["derby", "race", "survival", "lab", "press", "pistons", "doors", "corkscrew", "stack"] as const) {
      expectUp(scene, true, false, false, false, scene);
    }
  });

  it("when the user's choices are flipped in every scene, then the fleet is the only scene whose props follow the user's choice", () => {
    for (const scene of SCENE_IDS) {
      const on = up(scene, true);
      const off = up(scene, false);
      const followsUser = on.barrier !== off.barrier || on.balls !== off.balls || on.ramps !== off.ramps;
      expect(followsUser, scene).toBe(scene === "fleet");
    }
  });
});
