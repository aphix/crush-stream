import { afterEach, describe, expect, it } from "vitest";
import { setGround } from "../game/world/ground.ts";
import { OPENWORLD_ID } from "../game/world/openworld/openworld-course.ts";
import { makeWorld } from "../game/world/race-world.test-util.ts";
import { showsDriveReadouts, showsRaceView } from "./drive-readouts.ts";

const DESKTOP = false;

afterEach(() => setGround(null));

/** The race HUD of the open world's free roam with the player's car seated (or left on foot, `onFoot`), after the Full menu toggle (H) is set to `fullMenu`. */
function openWorldRace(fullMenu: boolean, onFoot = false) {
  const w = makeWorld();
  w.skin = false;
  w.race.enter(false, true);
  w.race.showLobby(OPENWORLD_ID);
  w.race.seatLobby(0);
  w.race.command({ type: "fullUi", on: fullMenu });
  if (onFoot) w.away = 0;
  return { ...w.race.hud(), reel: null };
}

describe("given the player driving in the open world on a desktop", () => {
  it("when the race view is on, then the menus are hidden and the speedometer shows, with no place, lap or clock and no run timer", () => {
    const race = openWorldRace(false);
    expect(showsRaceView(race, DESKTOP), "race view, menus hidden").toBe(true);
    expect(showsDriveReadouts(race), "the drive cluster (speedometer) is up").toBe(true);
    expect(race.view?.speedKph, "speed the speedometer reads").toBeGreaterThanOrEqual(0);
    expect(race.view?.racer, "place, lap and race clock").toBeNull();
    expect(race.survival, "Survival's run timer").toBeNull();
    expect(race.view?.chase, "bust strip").toBeNull();
  });

  it("when H brings the full menu back, then the menus show and the speedometer stays", () => {
    const race = openWorldRace(true);
    expect(showsRaceView(race, DESKTOP), "race view").toBe(false);
    expect(showsDriveReadouts(race), "the drive cluster (speedometer) is up").toBe(true);
  });

  it("when he steps out of the car on foot, then no speedometer shows, in the race view or the full menu", () => {
    expect(showsDriveReadouts(openWorldRace(false, true)), "drive cluster on foot in the race view").toBe(false);
    expect(showsDriveReadouts(openWorldRace(true, true)), "drive cluster on foot under the full menu").toBe(false);
  });
});
