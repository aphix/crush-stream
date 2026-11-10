import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { gameHourAtMinute } from "./civilian-clock.ts";
import { HOURS_PER_GAME_DAY, STREAM, TICKS_PER_GAME_MINUTE } from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import type { CityState } from "./civilian-state.ts";

/** Chance a household has 1, 2, 3 or 4 people, cumulative: chosen for the look (owner's brief), nothing measured. */
const HOUSEHOLD_SIZE_CUMULATIVE = [0.25, 0.6, 0.8, 1] as const;
/** A member's bedtime is drawn through this curve (chance of being in bed by the hour after it): most are in bed by midnight, a few owls stay up to three. Hours past 24 are the next morning's small hours. */
const BEDTIME_CHANCES = [0, 0.15, 0.45, 0.68, 0.86, 0.95, 0.98, 1] as const;
const BEDTIME_HOURS = [20.5, 21, 22, 23, 24, 25, 26, 27] as const;
/** Evenings are busy: each member comes home between these hours, and some go out again for a while. */
const ARRIVE_FROM_HOUR = 16.5;
const ARRIVE_SPAN_HOURS = 3.5;
const OUTING_CHANCE = 0.3;
const OUTING_FROM_HOUR = 18;
const OUTING_START_SPAN_HOURS = 3;
const OUTING_MIN_HOURS = 1;
const OUTING_EXTRA_HOURS = 2;
/** Mornings: each member wakes between these hours and is gone to work or school some time after. */
const WAKE_FROM_HOUR = 5;
const WAKE_SPAN_HOURS = 2.5;
const MORNING_MIN_HOURS = 0.75;
const MORNING_EXTRA_HOURS = 1.25;
/** An hour before this belongs to the evening before: the small hours count on from 24. */
const EVENING_ENDS_HOUR = 12;
const MAX_HOUSEHOLD = HOUSEHOLD_SIZE_CUMULATIVE.length;

/** The hour (counted on past 24 for the small hours) at which a draw `chance` in [0, 1) of a member's bedtimes falls. */
function bedtimeAt(chance: number): number {
  let from = 1;
  while (BEDTIME_CHANCES[from]! < chance) from++;
  const share = (chance - BEDTIME_CHANCES[from - 1]!) / (BEDTIME_CHANCES[from]! - BEDTIME_CHANCES[from - 1]!);
  return BEDTIME_HOURS[from - 1]! + share * (BEDTIME_HOURS[from]! - BEDTIME_HOURS[from - 1]!);
}

/** The people nobody simulates: every home has a household of one to four from the seed and its place, the same on every peer; a home's simulated residents are some of its people, and the household is the rest. */
export class ImaginedHouseholds {
  private readonly startHour: number;
  private readonly homes: Int32Array;
  private readonly size: Uint8Array;
  private readonly first: Int32Array;
  private readonly wake: Float32Array;
  private readonly leave: Float32Array;
  private readonly arrive: Float32Array;
  private readonly bed: Float32Array;
  private readonly outFrom: Float32Array;
  private readonly outTo: Float32Array;

  constructor(state: CityState) {
    this.startHour = state.startHour;
    const { placeCount, kindOf } = state.index;
    const homes: number[] = [];
    for (let place = 0; place < placeCount; place++) if (kindOf[place] === PLACE_KIND.home) homes.push(place);
    this.homes = Int32Array.from(homes);
    this.size = new Uint8Array(placeCount);
    this.first = new Int32Array(placeCount);
    const members = homes.length * MAX_HOUSEHOLD;
    this.wake = new Float32Array(members);
    this.leave = new Float32Array(members);
    this.arrive = new Float32Array(members);
    this.bed = new Float32Array(members);
    this.outFrom = new Float32Array(members);
    this.outTo = new Float32Array(members);
    let next = 0;
    for (const place of homes) {
      const sizeDraw = residentDraws(state.seed, place, STREAM.household, 0)();
      this.size[place] = 1 + HOUSEHOLD_SIZE_CUMULATIVE.findIndex((chance) => sizeDraw < chance);
      this.first[place] = next;
      for (let member = 0; member < this.size[place]!; member++) this.drawMember(residentDraws(state.seed, place, STREAM.household, member + 1), next++);
    }
  }

  private drawMember(draw: () => number, at: number): void {
    this.wake[at] = WAKE_FROM_HOUR + draw() * WAKE_SPAN_HOURS;
    this.leave[at] = this.wake[at]! + MORNING_MIN_HOURS + draw() * MORNING_EXTRA_HOURS;
    this.arrive[at] = ARRIVE_FROM_HOUR + draw() * ARRIVE_SPAN_HOURS;
    this.bed[at] = bedtimeAt(draw());
    const goesOut = draw() < OUTING_CHANCE;
    const outStart = OUTING_FROM_HOUR + draw() * OUTING_START_SPAN_HOURS;
    this.outFrom[at] = goesOut ? outStart : 0;
    this.outTo[at] = goesOut ? outStart + OUTING_MIN_HOURS + draw() * OUTING_EXTRA_HOURS : 0;
  }

  /** Adds to `out[place]` the imagined people awake at home in every home at `tick`, whoever else is there. */
  fill(tick: number, out: Uint8Array): void {
    const hour = gameHourAtMinute(tick / TICKS_PER_GAME_MINUTE, this.startHour);
    const evening = hour < EVENING_ENDS_HOUR ? hour + HOURS_PER_GAME_DAY : hour;
    for (let at = 0; at < this.homes.length; at++) {
      const place = this.homes[at]!;
      let awake = 0;
      const end = this.first[place]! + this.size[place]!;
      for (let member = this.first[place]!; member < end; member++) {
        const inMorning = hour >= this.wake[member]! && hour < this.leave[member]!;
        const inEvening = evening >= this.arrive[member]! && evening < this.bed[member]! && !(evening >= this.outFrom[member]! && evening < this.outTo[member]!);
        if (inMorning || inEvening) awake++;
      }
      out[place] = Math.min(255, out[place]! + awake);
    }
  }
}
