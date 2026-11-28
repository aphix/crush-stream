import type { AmbientScene, UiName } from "../present/game-audio.ts";
import type { RacePhase, TimeOfDay } from "../match/types.ts";
import { TIME_OF_DAY } from "../match/types.ts";
import { BIOME, TRACK_ID } from "../world/constants.ts";
import type { SoundMat } from "../present/hit-sound.ts";
import { DERBY_BOXES, DERBY_PROP, type DerbyPropKind } from "../scenes/derby-ground.ts";

/** The game hour a race's light stands for, and the hour of the scenes with no clock. */
const RACE_HOUR: Record<TimeOfDay, number> = { [TIME_OF_DAY.day]: 13, [TIME_OF_DAY.sunset]: 19, [TIME_OF_DAY.night]: 23 };
const DAY_HOUR = 13;
const MINUTES_PER_HOUR = 60;

/** The ambient bed's place when a course says nothing else. */
export const DEFAULT_PLACE: AmbientScene["place"] = "track";

/** The ambient bed's place for a race course: its city streets or its dirt. */
const COURSE_PLACE: Readonly<Record<string, AmbientScene["place"]>> = {
  [TRACK_ID.city]: BIOME.city,
  havana: BIOME.city,
  [TRACK_ID.nationalMall]: BIOME.city,
  [TRACK_ID.rally]: BIOME.dirt,
  [TRACK_ID.breakerYard]: BIOME.dirt,
  [TRACK_ID.damSpine]: BIOME.dirt,
  [TRACK_ID.razorShelf]: BIOME.dirt,
};

export function coursePlace(courseId: string | null): AmbientScene["place"] {
  return (courseId !== null ? COURSE_PLACE[courseId] : undefined) ?? DEFAULT_PLACE;
}

/** What each kind of derby arena prism sounds like when a car hits it. */
const DERBY_SOUND: Record<DerbyPropKind, SoundMat> = {
  [DERBY_PROP.wall]: "concrete",
  [DERBY_PROP.container]: "steel",
  [DERBY_PROP.rail]: "concrete",
  [DERBY_PROP.pad]: "concrete",
  [DERBY_PROP.tyres]: "rubber",
};

/** The material of derby arena prism `index` (an index into `DERBY_BOXES`, as `DerbyGround.contact` reports it). */
export function derbyBoxMat(index: number): SoundMat {
  return DERBY_SOUND[DERBY_BOXES[index]!.kind];
}

/** The game hour (0..24): the open world's clock minute, else the race's light, else midday. */
export function hourOfDay(minute: number | null, light?: TimeOfDay): number {
  if (minute !== null) return minute / MINUTES_PER_HOUR;
  return light !== undefined ? RACE_HOUR[light] : DAY_HOUR;
}

/**
 * The UI sounds the game itself raises: the countdown's tick at each whole second to green, go, finish, the player's car wrecked, and a weapon taken in hand.
 * Menu cues (select, confirm, back, open, close) are played by the menus.
 */
export class UiCues {
  private readonly play: (name: UiName) => void;
  private phase: RacePhase | null = null;
  private tick = 0;
  private wrecked = false;
  private weapon: string | null = null;

  constructor(play: (name: UiName) => void) {
    this.play = play;
  }

  /** Once a frame: the race `phase` (null: none runs) and clock `time` (s, negative until green), whether the player's car is `wrecked`, and the `weapon` in his hand (null: none). */
  frame(phase: RacePhase | null, time: number, wrecked: boolean, weapon: string | null): void {
    if (phase === "countdown") {
      const tick = Math.ceil(-time);
      if (tick >= 1 && tick !== this.tick) {
        this.tick = tick;
        this.play("countdown");
      }
    } else this.tick = 0;
    if (this.phase === "countdown" && phase === "racing") this.play("go");
    if (phase === "finished" && this.phase !== null && this.phase !== "finished") this.play("finish");
    if (wrecked && !this.wrecked) this.play("wrecked");
    if (weapon !== null && this.weapon !== null && weapon !== this.weapon) this.play("equip");
    this.phase = phase;
    this.wrecked = wrecked;
    this.weapon = weapon;
  }
}
