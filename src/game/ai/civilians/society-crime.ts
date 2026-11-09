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
import { carStandsAt } from "./society-cars.ts";
import { isOutdoorPurpose } from "./society-venues.ts";

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

/** Wanted: an open crime or a fight not yet answered, until a bust or the wanted spell ends. */
export function isWanted(state: CityState, resident: number, tick: number): boolean {
  return (intAt(state, resident, RESIDENT_INT.flags) & FLAG.wanted) !== 0 && tick < intAt(state, resident, RESIDENT_INT.wantedUntilTick);
}

/** The place of the crime a resident has open, or none. */
export function crimePlaceOf(state: CityState, resident: number): number {
  return intAt(state, resident, RESIDENT_INT.crimeTick) === NEVER_TICK ? NO_PLACE : intAt(state, resident, RESIDENT_INT.crimePlace);
}

const CRIME_KIND_OF_PURPOSE = new Uint8Array(PURPOSE.fight + 1);
CRIME_KIND_OF_PURPOSE[PURPOSE.shoplift] = CRIME_KIND.theft;
CRIME_KIND_OF_PURPOSE[PURPOSE.mug] = CRIME_KIND.mugging;
CRIME_KIND_OF_PURPOSE[PURPOSE.breakIn] = CRIME_KIND.breakIn;

/** The kind of crime a leg's purpose is for, `CRIME_KIND.none` when it is for none. */
export function crimeKindOf(purpose: number): number {
  return CRIME_KIND_OF_PURPOSE[purpose] ?? CRIME_KIND.none;
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
function targetIsThere(state: CityState, criminal: number, purpose: number, tick: number): boolean {
  if (purpose === PURPOSE.shoplift) return true;
  const victim = intAt(state, criminal, RESIDENT_INT.crimeVictim);
  const place = intAt(state, criminal, RESIDENT_INT.place);
  if (victim < 0 || intAt(state, victim, RESIDENT_INT.alive) === 0) return false;
  if (purpose === PURPOSE.breakIn) return carStandsAt(state, victim, tick) === place;
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
      if (this.posted[resident] === ints[base + RESIDENT_INT.departTick] || !targetIsThere(state, resident, purpose, tick)) continue;
      this.posted[resident] = ints[base + RESIDENT_INT.departTick]!;
      out[count++] = resident;
    }
    return count;
  }
}
