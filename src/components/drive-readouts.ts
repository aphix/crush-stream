import type { RaceHud } from "@/game/match/types";

/** The race's readouts are up: a car to read (a race's, once it has begun, or one roaming the open world) and no results reel (its cameras ride replayed wrecks). */
export function showsDriveReadouts(race: Pick<RaceHud, "view" | "reel">): boolean {
  return race.view !== null && race.reel === null;
}

/** The race view: the race's panels alone over the 3D view, the sandbox HUD hidden until the Full menu toggle (H). A phone has no toggle, so its race is always the race view. */
export function showsRaceView(race: Pick<RaceHud, "fullUi"> | null, touch: boolean): boolean {
  return race !== null && (touch || !race.fullUi);
}
