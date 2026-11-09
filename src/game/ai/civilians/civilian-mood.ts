import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { dayOf } from "./civilian-clock.ts";
import {
  AFRAID_FEAR,
  CAST_NAME_BASE,
  FLAG,
  HISTORY_FIELD,
  HISTORY_FIELDS,
  LOG_LINES,
  MOOD_NEED_LEVEL,
  NO_PLACE,
  PURPOSE,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SPECIES,
} from "./civilian-constants.ts";
import { CAST } from "./civilian-cast.ts";
import {
  EVENT_CODE,
  KIND_WORDS,
  MOOD,
  MOOD_WORDS,
  NEED_MOODS,
  moodHold,
  moodOfCode,
  PURPOSE_LABELS,
  PURPOSE_LOG_TEXT,
  VISIT_BASE,
  fullNameText,
  jobTitleText,
  packedNameText,
} from "./civilian-names.ts";
import type { CityState } from "./civilian-state.ts";
import { ageOf } from "./society-day.ts";
import { evolveNeeds, topNeed } from "./needs.ts";

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function placeName(state: CityState, place: number): string {
  return place === NO_PLACE ? "nowhere" : state.map.places[place]!.name;
}

/** A resident's mood word's index (`MOOD`): hurt in hospital, the latest event's while it lasts, afraid near a feared door, an urgent need's, else by where they are. A pure function of the row and the time. */
export function moodOf(state: CityState, resident: number, tick: number): number {
  const flags = intAt(state, resident, RESIDENT_INT.flags);
  if (flags & FLAG.hurt) return MOOD.hurt;
  const walking = tick < intAt(state, resident, RESIDENT_INT.arriveTick) && intAt(state, resident, RESIDENT_INT.pathCount) > 0;
  const place = intAt(state, resident, walking ? RESIDENT_INT.fromPlace : RESIDENT_INT.place);
  const code = intAt(state, resident, RESIDENT_INT.moodEvent);
  if (code !== EVENT_CODE.none && tick - intAt(state, resident, RESIDENT_INT.moodTick) < moodHold(code) && moodOfCode(code) !== -1) return moodOfCode(code);
  if (state.fear[state.index.doorNode[place]!]! >= AFRAID_FEAR) return MOOD.afraid;
  const current = intAt(state, resident, RESIDENT_INT.place);
  evolveNeeds(state.floats, resident * RESIDENT_FLOAT_STRIDE, intAt(state, resident, RESIDENT_INT.departTick), intAt(state, resident, RESIDENT_INT.arriveTick), tick, state.index.kindOf[current]!, state.scratchNeeds);
  const top = topNeed(state.scratchNeeds, MOOD_NEED_LEVEL);
  if (top !== -1) return NEED_MOODS[top]!;
  if (state.index.kindOf[place] === PLACE_KIND.hangout) return MOOD.happy;
  return state.index.kindOf[place] === PLACE_KIND.work ? MOOD.busy : MOOD.fine;
}

export function residentNameText(state: CityState, resident: number): string {
  return fullNameText(intAt(state, resident, RESIDENT_INT.gender), intAt(state, resident, RESIDENT_INT.firstName), intAt(state, resident, RESIDENT_INT.familyName));
}

/** The look-at line of a resident: "{name}, {age}, {job} at {workplace} - {purpose} -> {place}, feeling {mood}" (an animal: its kind in place of age and job; a child no job; in hospital, so). */
export function civilianLine(state: CityState, resident: number, tick: number): string {
  const first = intAt(state, resident, RESIDENT_INT.firstName);
  const name = residentNameText(state, resident);
  const mood = MOOD_WORDS[moodOf(state, resident, tick)]!;
  if (intAt(state, resident, RESIDENT_INT.flags) & FLAG.hurt) return `${name}, in hospital - recovering, feeling ${mood}`;
  if (intAt(state, resident, RESIDENT_INT.flags) & FLAG.custody) return `${name}, in custody, feeling ${mood}`;
  const legPurpose = intAt(state, resident, RESIDENT_INT.legPurpose);
  const purpose = legPurpose === PURPOSE.drive ? `${PURPOSE_LABELS[legPurpose]!} for ${PURPOSE_LABELS[intAt(state, resident, RESIDENT_INT.legReason)]!}` : PURPOSE_LABELS[legPurpose]!;
  const destination = placeName(state, intAt(state, resident, RESIDENT_INT.place));
  if (intAt(state, resident, RESIDENT_INT.species) !== SPECIES.person) return `${name}, ${CAST[first - CAST_NAME_BASE]?.description ?? "an animal"} - ${purpose} -> ${destination}, feeling ${mood}`;
  const age = ageOf(state, resident, dayOf(tick, state.startHour));
  const work = intAt(state, resident, RESIDENT_INT.work);
  const entry = work === NO_PLACE ? undefined : state.map.places[work]!;
  const job = entry === undefined ? "" : `, ${jobTitleText(entry.kind, entry.sector, intAt(state, resident, RESIDENT_INT.jobTitle))} at ${entry.name}`;
  return `${name}, ${age}${job} - ${purpose} -> ${destination}, feeling ${mood}`;
}

function historyText(state: CityState, code: number, subject: number): string {
  const place = () => placeName(state, subject);
  if (code >= VISIT_BASE) return `${PURPOSE_LOG_TEXT[code - VISIT_BASE]!} ${place()}`;
  switch (code) {
    case EVENT_CODE.arrived: return `moved into ${place()}`;
    case EVENT_CODE.born: return `was born to ${packedNameText(subject)}`;
    case EVENT_CODE.gotJob: return `got a job at ${place()}`;
    case EVENT_CODE.retired: return `retired from ${place()}`;
    case EVENT_CODE.fired: return `was fired from ${place()}`;
    case EVENT_CODE.promoted: return `was promoted at ${place()}`;
    case EVENT_CODE.relationship: return `started seeing ${packedNameText(subject)}`;
    case EVENT_CODE.breakup: return `broke up with ${packedNameText(subject)}`;
    case EVENT_CODE.married: return `married ${packedNameText(subject)}`;
    case EVENT_CODE.baby: return `had a baby: ${packedNameText(subject)}`;
    case EVENT_CODE.moved: return `moved to ${place()}`;
    case EVENT_CODE.injured: return "got hurt";
    case EVENT_CODE.cured: return "got better";
    case EVENT_CODE.knocked: return `was knocked down outside ${place()}`;
    case EVENT_CODE.backFromHospital: return "back from hospital";
    case EVENT_CODE.workplaceClosed: return `${place()} shut down after the wreck`;
    case EVENT_CODE.workplaceReopened: return `back to work at ${place()}`;
    case EVENT_CODE.lostSomeone: return `lost ${packedNameText(subject)}`;
    case EVENT_CODE.familyKnocked: return `${packedNameText(subject)} was knocked down`;
    case EVENT_CODE.stoopWrecked: return `a car was wrecked into the stoop at ${place()}`;
    case EVENT_CODE.staticComplaint: return `the TV went to static again: ${packedNameText(subject)}'s radio`;
    case EVENT_CODE.backOnBus: return `got off the bus at ${place()}`;
    case EVENT_CODE.shoplifted: return `lifted something from ${place()}`;
    case EVENT_CODE.muggedSomeone: return subject < 0 ? "mugged someone" : `mugged ${packedNameText(subject)}`;
    case EVENT_CODE.brokeIntoCar: return `broke into a car outside ${place()}`;
    case EVENT_CODE.wasMugged: return `was mugged outside ${place()}`;
    case EVENT_CODE.carBrokenInto: return `had their car broken into outside ${place()}`;
    case EVENT_CODE.shopRobbed: return `${place()} was robbed`;
    case EVENT_CODE.reportedCrime: return `called the police about trouble outside ${place()}`;
    case EVENT_CODE.fledDanger: return `ran home from trouble outside ${place()}`;
    case EVENT_CODE.arrested: return `was arrested outside ${place()}`;
    case EVENT_CODE.released: return "was let out of custody";
    case EVENT_CODE.fought: return `got into a fight with ${packedNameText(subject)}`;
    case EVENT_CODE.foughtStranger: return `squared up to a driver outside ${place()}`;
    case EVENT_CODE.foughtWalker: return `turned on someone who shoved them outside ${place()}`;
    case EVENT_CODE.jaywalkArrest: return "was arrested for crossing against the light";
    default: return "";
  }
}

/** The resident's life log, newest first, up to `LOG_LINES`. */
export function historyLines(state: CityState, resident: number): string[] {
  const base = resident * RESIDENT_INT_STRIDE;
  const head = state.ints[base + RESIDENT_INT.historyHead]!;
  const lines: string[] = [];
  for (let back = 1; back <= Math.min(head, LOG_LINES); back++) {
    const line = base + RESIDENT_INT.history + ((head - back) % LOG_LINES) * HISTORY_FIELDS;
    lines.push(historyText(state, state.ints[line + HISTORY_FIELD.code]!, state.ints[line + HISTORY_FIELD.subject]!));
  }
  return lines;
}

/** A building's line names this many people, and lists this many visits. */
const LISTED_NAMES = 4;
const LISTED_VISITS = 4;

function namesOf(state: CityState, residents: readonly number[]): string {
  const shown = residents.slice(0, LISTED_NAMES).map((resident) => residentNameText(state, resident));
  return residents.length > LISTED_NAMES ? `${shown.join(", ")} and ${residents.length - LISTED_NAMES} more` : shown.join(", ");
}

/** A building's look-at lines: its kind and name, who lives or works there, and the latest comings and goings (walks to it in the residents' logs, newest first). */
export function buildingLines(state: CityState, place: number, tick: number): { title: string; lines: string[] } {
  const entry = state.map.places[place]!;
  const people = entry.kind === PLACE_KIND.home ? RESIDENT_INT.home : RESIDENT_INT.work;
  const here: number[] = [];
  const visits: { tick: number; text: string }[] = [];
  for (let resident = 0; resident < state.capacity; resident++) {
    if (intAt(state, resident, RESIDENT_INT.alive) === 0) continue;
    if (intAt(state, resident, people) === place) here.push(resident);
    const head = intAt(state, resident, RESIDENT_INT.historyHead);
    for (let back = 1; back <= Math.min(head, LOG_LINES); back++) {
      const line = resident * RESIDENT_INT_STRIDE + RESIDENT_INT.history + ((head - back) % LOG_LINES) * HISTORY_FIELDS;
      if (state.ints[line + HISTORY_FIELD.code]! < VISIT_BASE || state.ints[line + HISTORY_FIELD.subject] !== place) continue;
      visits.push({ tick: state.ints[line + HISTORY_FIELD.tick]!, text: `${residentNameText(state, resident)} ${PURPOSE_LOG_TEXT[state.ints[line + HISTORY_FIELD.code]! - VISIT_BASE]!} ${entry.name}` });
    }
  }
  const lines: string[] = [KIND_WORDS[entry.kind]!];
  if (here.length > 0) lines.push(`${entry.kind === PLACE_KIND.home ? "lives here" : "works here"}: ${namesOf(state, here)}`);
  if (!(state.closedUntilTick[place]! <= tick)) lines.push("closed after a wreck");
  visits.sort((first, second) => second.tick - first.tick);
  for (const visit of visits.slice(0, LISTED_VISITS)) lines.push(visit.text);
  return { title: entry.name, lines };
}
