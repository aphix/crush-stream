import {
  BROKE_AFTER_DAYS,
  CRIME_KIND,
  CRIME_LAG_TICKS,
  CRIME_LEAN,
  EMPLOYED_REFORM_FACTOR,
  FLAG,
  JOB_AGE,
  NEVER_TICK,
  NO_PLACE,
  PURPOSE,
  REFORM_CHANCE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  RETIRE_AGE,
  YOUNG_AGE_MAX,
} from "./civilian-constants.ts";
import { EVENT_CODE, MOOD, moodHold, moodOfCode } from "./civilian-names.ts";
import { markDirty, type CityState } from "./civilian-state.ts";
import { isOutdoorPurpose } from "./society-venues.ts";

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

/** The two residents a push or fight subject packs (victim + capacity * (other + 1)); `other` -1 is a player's walker or car. */
export function pairOf(subject: number, capacity: number): { victim: number; other: number } {
  return { victim: subject % capacity, other: Math.floor(subject / capacity) - 1 };
}

/** Wanted: an open crime or a fight not yet answered, until a bust or the wanted spell ends. */
export function isWanted(state: CityState, resident: number, tick: number): boolean {
  return (intAt(state, resident, RESIDENT_INT.flags) & FLAG.wanted) !== 0 && tick < intAt(state, resident, RESIDENT_INT.wantedUntilTick);
}

type OpenCrime = { tick: number; kind: number; place: number; victim: number };

/** The crime a resident has open (it began at `tick` at `place`), or null. */
export function crimeOf(state: CityState, resident: number): OpenCrime | null {
  const tick = intAt(state, resident, RESIDENT_INT.crimeTick);
  if (tick === NEVER_TICK) return null;
  return { tick, kind: intAt(state, resident, RESIDENT_INT.crimeKind), place: intAt(state, resident, RESIDENT_INT.crimePlace), victim: intAt(state, resident, RESIDENT_INT.crimeVictim) };
}

const CRIME_KIND_OF_PURPOSE = new Map<number, number>([
  [PURPOSE.shoplift, CRIME_KIND.theft],
  [PURPOSE.mug, CRIME_KIND.mugging],
  [PURPOSE.breakIn, CRIME_KIND.breakIn],
]);

export function crimeKindOf(purpose: number): number {
  return CRIME_KIND_OF_PURPOSE.get(purpose) ?? CRIME_KIND.none;
}

/** Angry or annoyed from an event still colouring their mood. */
export function isAngry(state: CityState, resident: number, tick: number): boolean {
  const code = intAt(state, resident, RESIDENT_INT.moodEvent);
  if (code === EVENT_CODE.none || tick - intAt(state, resident, RESIDENT_INT.moodTick) >= moodHold(code)) return false;
  const mood = moodOfCode(code);
  return mood === MOOD.angry || mood === MOOD.annoyed;
}

/** A game day's chance of turning to crime. */
function crimeLeaning(unemployed: boolean, broke: boolean, angry: boolean, age: number): number {
  return CRIME_LEAN.base + (unemployed ? CRIME_LEAN.unemployed : 0) + (broke ? CRIME_LEAN.broke : 0) + (angry ? CRIME_LEAN.angry : 0) + (age <= YOUNG_AGE_MAX ? CRIME_LEAN.young : 0);
}

function reformChance(employed: boolean): number {
  return REFORM_CHANCE * (employed ? EMPLOYED_REFORM_FACTOR : 1);
}

/** Working-age residents: jobless days run up (broke after `BROKE_AFTER_DAYS`), and `roll` (a unit draw) turns them to crime or, if they are criminals, away from it. */
export function rollCrimeDay(state: CityState, resident: number, age: number, roll: number, tick: number): void {
  if (age < JOB_AGE || age >= RETIRE_AGE) return;
  const base = resident * RESIDENT_INT_STRIDE;
  const { ints } = state;
  const flagsBefore = ints[base + RESIDENT_INT.flags]!;
  const employed = ints[base + RESIDENT_INT.work] !== NO_PLACE && (flagsBefore & FLAG.laidOff) === 0;
  const daysBefore = ints[base + RESIDENT_INT.joblessDays]!;
  const days = employed ? 0 : daysBefore + 1;
  let flags = days >= BROKE_AFTER_DAYS ? flagsBefore | FLAG.broke : flagsBefore & ~FLAG.broke;
  if ((flags & FLAG.criminal) !== 0) {
    if (roll < reformChance(employed)) flags &= ~FLAG.criminal;
  } else if (roll < crimeLeaning(!employed, (flags & FLAG.broke) !== 0, isAngry(state, resident, tick), age)) flags |= FLAG.criminal;
  if (days === daysBefore && flags === flagsBefore) return;
  ints[base + RESIDENT_INT.joblessDays] = days;
  ints[base + RESIDENT_INT.flags] = flags;
  markDirty(state, resident);
}

/** Criminals at the start stand where the daily rolls settle: the share of a group is its turning chance over turning plus giving up. */
export function startingCrime(state: CityState, resident: number, age: number, unit: number): void {
  if (age < JOB_AGE || age >= RETIRE_AGE) return;
  const base = resident * RESIDENT_INT_STRIDE;
  const employed = state.ints[base + RESIDENT_INT.work] !== NO_PLACE;
  const lean = crimeLeaning(!employed, false, false, age);
  if (unit < lean / (lean + reformChance(employed))) state.ints[base + RESIDENT_INT.flags] |= FLAG.criminal;
}

/** Whether the target of a crime attempt is still there when the criminal is: a shop is, a mugging's victim must still be outdoors at the place, a car's owner must still have it parked there. */
function targetIsThere(state: CityState, criminal: number, purpose: number): boolean {
  if (purpose === PURPOSE.shoplift) return true;
  const victim = intAt(state, criminal, RESIDENT_INT.crimeVictim);
  const place = intAt(state, criminal, RESIDENT_INT.place);
  if (victim < 0 || intAt(state, victim, RESIDENT_INT.alive) === 0) return false;
  if (purpose === PURPOSE.breakIn) return intAt(state, victim, RESIDENT_INT.carPlace) === place;
  return intAt(state, victim, RESIDENT_INT.place) === place && isOutdoorPurpose(intAt(state, victim, RESIDENT_INT.legPurpose));
}

/** The host's side of crime: lists the criminals whose attempt is due once each, for the host to raise as crime events (the brain commits nothing without one, so a bust can stop it). */
export class CrimeDesk {
  private readonly posted: Int32Array;

  constructor(capacity: number) {
    this.posted = new Int32Array(capacity).fill(-1);
  }

  /** Writes the due criminals into `out` and returns how many. */
  collect(state: CityState, tick: number, out: Int32Array): number {
    let count = 0;
    for (let resident = 0; resident < state.capacity && count < out.length; resident++) {
      const base = resident * RESIDENT_INT_STRIDE;
      const { ints } = state;
      const purpose = ints[base + RESIDENT_INT.legPurpose]!;
      if (ints[base + RESIDENT_INT.alive] === 0 || crimeKindOf(purpose) === CRIME_KIND.none || ints[base + RESIDENT_INT.crimeTick] !== NEVER_TICK) continue;
      if ((ints[base + RESIDENT_INT.flags]! & (FLAG.wanted | FLAG.custody | FLAG.hurt)) !== 0) continue;
      if (tick < ints[base + RESIDENT_INT.arriveTick]! + CRIME_LAG_TICKS || tick >= ints[base + RESIDENT_INT.nextDecisionTick]!) continue;
      if (this.posted[resident] === ints[base + RESIDENT_INT.departTick] || !targetIsThere(state, resident, purpose)) continue;
      this.posted[resident] = ints[base + RESIDENT_INT.departTick]!;
      out[count++] = resident;
    }
    return count;
  }
}
