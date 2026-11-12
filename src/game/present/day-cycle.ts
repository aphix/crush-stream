/**
 * The open world's day as a function of the game hour (0 to 24, the crowd's clock): how dark, how warm, whether the street lamps and the windows are lit, and how high the light stands.
 * Pure numbers; `WorldStage.setDayHour` lights the scene from them. The light's direction is moved only when it has drifted far enough to show (`sunNeedsHop`), the rest of the grade on every
 * game minute: both far coarser than the frame.
 */

/** The share of day a smoothstep gives: 0 at or under `from`, 1 at or over `to`. */
function smooth(x: number, from: number, to: number): number {
  const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
}

/** The hours the daylight comes in over at dawn, and goes out over at dusk: by the first the sun is not yet up, by the second it has set. */
const DAWN = { from: 5, to: 7.5 } as const;
const DUSK = { from: 17.5, to: 20 } as const;
/** The warm hours: the sky and the light turn toward the sunset's palette as each of these rises to its peak and falls again (`from`, `peak`, `to`). */
const WARM_MORNING = { from: 4.5, peak: 6, to: 8.5 } as const;
const WARM_EVENING = { from: 15.5, peak: 18.5, to: 21 } as const;
/** The street lamps come on as the day's share falls through these, and are fully on under the lower. */
const LAMPS_ON = { from: 0.35, to: 0.85 } as const;
/** The sun is up between these hours; it stands highest at their middle. */
const SUN_UP = { rise: 6, set: 18 } as const;

export type DayGrade = {
  /** 0 by day to 1 at the dead of night: the share of the night's darkening, sky and light. The stage scales it by its night depth. */
  night: number;
  /** 0 to 1: how far the light has turned toward the sunset's palette (dawn and dusk). */
  warm: number;
  /** 0 to 1: the street lamps' strength. */
  lamps: number;
  /** 0 to 1: the share of the sun's height over its lowest, by the clock (an arc, highest at noon); the night's moon takes over from it. */
  sunHeight: number;
};

export function makeDayGrade(): DayGrade {
  return { night: 0, warm: 0, lamps: 0, sunHeight: 0 };
}

/** The game hour wrapped into 0 to 24. */
export function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

/** `out` = the day's grade at game hour `hour`. */
export function dayGradeAt(hour: number, out: DayGrade): DayGrade {
  const h = wrapHour(hour);
  const dayShare = smooth(h, DAWN.from, DAWN.to) * (1 - smooth(h, DUSK.from, DUSK.to));
  out.night = 1 - dayShare;
  out.warm =
    smooth(h, WARM_MORNING.from, WARM_MORNING.peak) * (1 - smooth(h, WARM_MORNING.peak, WARM_MORNING.to)) +
    smooth(h, WARM_EVENING.from, WARM_EVENING.peak) * (1 - smooth(h, WARM_EVENING.peak, WARM_EVENING.to));
  out.lamps = 1 - smooth(dayShare, LAMPS_ON.from, LAMPS_ON.to);
  out.sunHeight = h > SUN_UP.rise && h < SUN_UP.set ? Math.sin((Math.PI * (h - SUN_UP.rise)) / (SUN_UP.set - SUN_UP.rise)) : 0;
  return out;
}

/**
 * Where the light stands (rad of elevation) at `grade`: the sun's arc from `low` (at either end of its day) to `noon`, handing over to the moon at `moon` as the night comes. The hand-over is made in the
 * shadow's length (its cotangent), not the angle, so a minute's step moves a shadow's tip as far at the sun's low evening elevation as at the moon's high one. The sun's own arc is the clock's: a low sun's
 * shadows really do sweep fast (a degree at 12 degrees moves a tip five times as far as at 30), which is why `sunNeedsHop` asks for a hop every minute there and every few at midday.
 */
export function lightElevation(grade: DayGrade, low: number, noon: number, moon: number): number {
  const sun = low + (noon - low) * grade.sunHeight;
  const length = 1 / Math.tan(sun) + (1 / Math.tan(moon) - 1 / Math.tan(sun)) * grade.night;
  return Math.atan(1 / length);
}

/**
 * How far (m) the tip of the shadow of a building `REFERENCE_HEIGHT` tall may be off its true place before the light moves: the sun's hop. The shadow's length is height / tan(elevation), so a
 * change of elevation `d` moves its tip `height * d / sin^2(elevation)`: a low sun needs small hops, a high one none for a long while. Picked by the stills (`day-cycle.test.ts` has the day's
 * count: about 300 hops a game day, one every few game minutes by day, every minute or two in the low evening sun).
 */
export const SUN_HOP_METRES = 0.3;
/** The building the hop is judged on: a three-storey rowhome (m). */
export const REFERENCE_HEIGHT = 10.9;

/** The change of elevation (rad) from `applied` that moves the shadow tip by `SUN_HOP_METRES`. */
export function sunHopTolerance(applied: number): number {
  const s = Math.sin(applied);
  return (s * s * SUN_HOP_METRES) / REFERENCE_HEIGHT;
}

/** Whether the light, standing at `applied` (rad of elevation), should move to `target`. */
export function sunNeedsHop(applied: number, target: number): boolean {
  return Math.abs(target - applied) >= sunHopTolerance(applied);
}
