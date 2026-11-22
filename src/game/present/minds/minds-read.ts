import { dayOf, hourOfDay } from "../../ai/civilians/civilian-clock.ts";
import { EVENT_TRIPLE, MOOD_NEED_LEVEL, NO_PLACE, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, TICKS_PER_GAME_HOUR } from "../../ai/civilians/civilian-constants.ts";
import { moodOf, residentNameText } from "../../ai/civilians/civilian-mood.ts";
import { MOOD_WORDS } from "../../ai/civilians/civilian-names.ts";
import type { CityState } from "../../ai/civilians/civilian-state.ts";
import type { CrowdPoses } from "../../ai/civilians/crowd-poses.ts";
import { evolveNeeds, topNeed } from "../../ai/civilians/needs.ts";
import { EVENT_KINDS } from "../../ai/civilians/resident-spine.ts";
import { ageOf } from "../../ai/civilians/society-day.ts";
import type { CrowdGaze } from "../civilian-gaze.ts";
import { NEWS_MINUTES, type Situation } from "./thought-situation.ts";
import { THOUGHT, isArgOf } from "./thought-tools.ts";

/** What the Minds read of the open world, refreshed by its owner each frame (one object, no allocation): the brain, the drawn crowd, the gaze, the host's event log, the clock and the eye. */
export class MindsWorld {
  state: CityState | null = null;
  poses: CrowdPoses | null = null;
  gaze: CrowdGaze | null = null;
  events: Float64Array = new Float64Array(0);
  tick = 0;
  /** Crowd seconds: one is a game minute. */
  crowdSeconds = 0;
  eyeX = 0;
  eyeY = 0;
  eyeZ = 0;
}

/** A thought lasts the game hour it was had in: the key of `tick`'s hour since the crowd began. */
export function hourKey(tick: number): number {
  return Math.floor(tick / TICKS_PER_GAME_HOUR);
}

/** A resident senses gaze stimuli this near (m): a block's width, about as far as a face can be read in a street (tuned by feel). */
const SENSE_METRES = 40;
/** Remarkable event kinds, one byte per kind (the spine's rows with a remark). */
const REMARKABLE = Uint8Array.from(Object.values(EVENT_KINDS), (row) => (row.remark === null ? 0 : 1));

/** The lookable stimuli within `SENSE_METRES` of (x, z), into `sit`: a thought looks only at what `look_at` can name. */
function senseAround(sit: Situation, gaze: CrowdGaze | null, x: number, z: number): void {
  if (gaze === null) return;
  const table = gaze.stimuli;
  for (let row = 0; row < table.count; row++) {
    const kind = table.kind[row]!;
    if (!isArgOf(THOUGHT.look_at, kind)) continue;
    const dx = table.x[row]! - x;
    const dz = table.z[row]! - z;
    const metres = Math.sqrt(dx * dx + dz * dz);
    if (metres <= SENSE_METRES) sit.see(kind, table.salience[row]!, metres, table.x[row]!, table.y[row]!, table.z[row]!);
  }
}

/** The host's remarkable events of the last `NEWS_MINUTES`, newest first, into `sit`. */
function hearLately(sit: Situation, events: Float64Array, crowdSeconds: number): void {
  for (let at = events.length - EVENT_TRIPLE; at >= 0; at -= EVENT_TRIPLE) {
    const age = crowdSeconds - events[at + 2]!;
    if (age > NEWS_MINUTES) return;
    const kind = events[at]!;
    if (age >= 0 && REMARKABLE[kind] === 1) sit.hear(kind, age);
  }
}

/** Resident `resident`'s situation now: who and how she feels, where she is off to, her most pressing need, what is around her and what happened lately. */
export function readResident(sit: Situation, world: MindsWorld, state: CityState, poses: CrowdPoses, resident: number): void {
  sit.clear();
  const base = resident * RESIDENT_INT_STRIDE;
  const ints = state.ints;
  const tick = world.tick;
  sit.resident = resident;
  sit.who = `${residentNameText(state, resident)}, ${ageOf(state, resident, dayOf(tick, state.startHour))}`;
  sit.feeling = MOOD_WORDS[moodOf(state, resident, tick)] ?? "";
  sit.hour = hourOfDay(tick, state.startHour);
  sit.purpose = ints[base + RESIDENT_INT.legPurpose]!;
  sit.walking = tick < ints[base + RESIDENT_INT.arriveTick]! && ints[base + RESIDENT_INT.pathCount]! > 0;
  sit.hasWork = ints[base + RESIDENT_INT.work] !== NO_PLACE;
  sit.hasCompany = poses.partner[resident]! >= 0;
  const current = ints[base + RESIDENT_INT.place]!;
  evolveNeeds(state.floats, resident * RESIDENT_FLOAT_STRIDE, ints[base + RESIDENT_INT.departTick]!, ints[base + RESIDENT_INT.arriveTick]!, tick, state.index.kindOf[current]!, state.scratchNeeds);
  sit.topNeed = topNeed(state.scratchNeeds, MOOD_NEED_LEVEL);
  sit.topLevel = sit.topNeed < 0 ? 0 : state.scratchNeeds[sit.topNeed]!;
  senseAround(sit, world.gaze, poses.x[resident]!, poses.z[resident]!);
  hearLately(sit, world.events, world.crowdSeconds);
}

/** A group of `size` around a pulse of `kind` at (x, y, z), standing `metres` from it on average: what they all see and have heard. */
export function readGroup(sit: Situation, world: MindsWorld, size: number, kind: number, salience: number, metres: number, x: number, y: number, z: number): void {
  sit.clear();
  sit.size = size;
  sit.hour = world.state === null ? 0 : hourOfDay(world.tick, world.state.startHour);
  sit.see(kind, salience, metres, x, y, z);
  hearLately(sit, world.events, world.crowdSeconds);
}
