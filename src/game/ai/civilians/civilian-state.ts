import { hypot2 } from "../../kernel/physics-core.js";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import {
  HISTORY_FIELD,
  HISTORY_FIELDS,
  LOG_LINES,
  MAX_PATH_NODES,
  NEED_COUNT,
  NO_PLACE,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SPECIES,
} from "./civilian-constants.ts";
import { LegPose } from "./civilian-leg.ts";
import type { MapIndex } from "./civilian-map-index.ts";
import { packName } from "./civilian-names.ts";
import { castHomesOf, newAppointmentSlot, type ResolvedMember } from "./civilian-story.ts";
import { buildVenueIndex, type VenueIndex } from "./society-venues.ts";
import { PathFinder } from "./walk-path.ts";

/** A host event waiting for its ticks (`bearing`: the way to the player who shoved, `NO_BEARING` for none): the civilian it hit (or the place) changes at `individualTick`, everyone drawn into it at `reactionTick` (`EVENT_LEAD_TICKS` after it, as late as a peer may hear it) and the society at `societyTick`. */
type PendingEvent = { kind: number; subject: number; seconds: number; bearing: number; individualTick: number; reactionTick: number; societyTick: number; individualDone: boolean; reactionDone: boolean };

/** The whole society and crowd of the city as typed arrays; the worker and the main thread each hold one and keep it equal by the same pure steps. */
export class CityState {
  readonly seed: number;
  readonly map: OpenWorldMap;
  readonly index: MapIndex;
  readonly venues: VenueIndex;
  /** The named residents, resident id = position; the rest of the rows are generated. */
  readonly cast: readonly ResolvedMember[];
  readonly castHomes: ReadonlySet<number>;
  /** Game hour of crowd time 0, and the weekday (Monday 0) of game day 0: from the seed. */
  readonly startHour: number;
  readonly startWeekday: number;
  readonly capacity: number;
  /** People (not animals) the society keeps the city near: deaths are replaced down to it, births may lift it a little. */
  targetPopulation = 0;
  /** The next tick to step: every tick is stepped once, in order. */
  nextTick = 0;
  readonly ints: Int32Array;
  readonly floats: Float32Array;
  /** Each resident's leg: node ids, and the metres walked at each from the first. */
  readonly pathNodes: Uint16Array;
  readonly pathDistance: Float32Array;
  /** A civilian run down is off the street from their knock's tick to their return (set at once by the event, never by an answer). */
  readonly hiddenFromTick: Int32Array;
  readonly hiddenUntilTick: Int32Array;
  readonly closedUntilTick: Int32Array;
  /** Who holds each seat (`VenueIndex.seatBase` + seat), -1 for none: derived from the residents' `seat` rows. */
  readonly seatOwner: Int32Array;
  readonly occupants: Uint16Array;
  readonly headcount: Uint16Array;
  readonly fear: Float32Array;
  /** People alive (animals are not counted). */
  alive = 0;
  readonly events: PendingEvent[] = [];
  readonly dirty: Int32Array;
  readonly dirtyMark: Uint8Array;
  dirtyCount = 0;
  readonly closureChanges: Int32Array;
  closureCount = 0;
  fearDirty = false;
  /** Search scratch: no fear (for walking-time estimates), a path, and the needs of the resident being decided. */
  readonly finder: PathFinder;
  readonly noFear: Float32Array;
  readonly scratchPath: Uint16Array;
  readonly scratchNeeds: Float32Array;
  readonly appointment = newAppointmentSlot();
  readonly pose = new LegPose();
  /** Where the decision in hand chose to go, and for what (a need, a story or the bus). */
  chosenPlace = NO_PLACE;
  chosenPurpose = 0;
  /** The interaction row that chose it (-1: a need did), and the neighbour or victim it brings in (-1: none); `scratchPartner` is the candidate row's before it wins. */
  chosenRow = -1;
  chosenPartner = NO_PLACE;
  scratchPartner = NO_PLACE;

  constructor(seed: number, map: OpenWorldMap, index: MapIndex, cast: readonly ResolvedMember[], startHour: number, startWeekday: number, capacity: number) {
    this.seed = seed;
    this.map = map;
    this.index = index;
    this.venues = buildVenueIndex(map);
    this.seatOwner = new Int32Array(this.venues.seatTotal).fill(NO_PLACE);
    this.cast = cast;
    this.castHomes = castHomesOf(cast);
    this.startHour = startHour;
    this.startWeekday = startWeekday;
    this.capacity = capacity;
    this.ints = new Int32Array(capacity * RESIDENT_INT_STRIDE);
    this.floats = new Float32Array(capacity * RESIDENT_FLOAT_STRIDE);
    this.pathNodes = new Uint16Array(capacity * MAX_PATH_NODES);
    this.pathDistance = new Float32Array(capacity * MAX_PATH_NODES);
    this.hiddenFromTick = new Int32Array(capacity);
    this.hiddenUntilTick = new Int32Array(capacity);
    this.closedUntilTick = new Int32Array(this.index.placeCount);
    this.occupants = new Uint16Array(this.index.placeCount);
    this.headcount = new Uint16Array(this.index.placeCount);
    this.fear = new Float32Array(this.index.nodeCount);
    this.dirty = new Int32Array(capacity);
    this.dirtyMark = new Uint8Array(capacity);
    this.closureChanges = new Int32Array(this.index.placeCount * 2);
    this.finder = new PathFinder(map.graph);
    this.noFear = new Float32Array(this.index.nodeCount);
    this.scratchPath = new Uint16Array(MAX_PATH_NODES);
    this.scratchNeeds = new Float32Array(NEED_COUNT);
  }
}

/** Takes a resident's row off the derived counters (people alive, home's and workplace's headcounts): call before changing it, `commitResident` after. */
export function retractResident(state: CityState, resident: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  const { ints } = state;
  if (ints[base + RESIDENT_INT.alive] === 0 || ints[base + RESIDENT_INT.species] !== SPECIES.person) return;
  const home = ints[base + RESIDENT_INT.home]!;
  const work = ints[base + RESIDENT_INT.work]!;
  state.alive--;
  if (home !== NO_PLACE) state.occupants[home]!--;
  if (work !== NO_PLACE) state.headcount[work]!--;
}

export function commitResident(state: CityState, resident: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  const { ints } = state;
  if (ints[base + RESIDENT_INT.alive] === 0 || ints[base + RESIDENT_INT.species] !== SPECIES.person) return;
  const home = ints[base + RESIDENT_INT.home]!;
  const work = ints[base + RESIDENT_INT.work]!;
  state.alive++;
  if (home !== NO_PLACE) state.occupants[home]!++;
  if (work !== NO_PLACE) state.headcount[work]!++;
}

/** The row is changed in this step: it goes to the peers in the step's answer. */
export function markDirty(state: CityState, resident: number): void {
  if (state.dirtyMark[resident]) return;
  state.dirtyMark[resident] = 1;
  state.dirty[state.dirtyCount++] = resident;
}

export function setClosedUntil(state: CityState, place: number, tick: number): void {
  state.closedUntilTick[place] = tick;
  for (let slot = 0; slot < state.closureCount; slot++) {
    if (state.closureChanges[slot * 2] !== place) continue;
    state.closureChanges[slot * 2 + 1] = tick;
    return;
  }
  state.closureChanges[state.closureCount * 2] = place;
  state.closureChanges[state.closureCount * 2 + 1] = tick;
  state.closureCount++;
}

/** Adds a line to a resident's life log ring (the newest overwrites the oldest after `LOG_LINES`). */
export function logHistory(state: CityState, resident: number, code: number, subject: number, tick: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  const { ints } = state;
  const head = ints[base + RESIDENT_INT.historyHead]!;
  const line = base + RESIDENT_INT.history + (head % LOG_LINES) * HISTORY_FIELDS;
  ints[line + HISTORY_FIELD.code] = code;
  ints[line + HISTORY_FIELD.subject] = subject;
  ints[line + HISTORY_FIELD.tick] = tick;
  ints[base + RESIDENT_INT.historyHead] = head + 1;
}

/** Mood is coloured by the latest event for `MOOD_HOLD_TICKS` (the event's code and tick). */
export function setMoodEvent(state: CityState, resident: number, code: number, tick: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  state.ints[base + RESIDENT_INT.moodEvent] = code;
  state.ints[base + RESIDENT_INT.moodTick] = tick;
}

/** Metres walked at each node of a resident's path from its first; returns the whole walk. */
export function measurePath(state: CityState, resident: number): number {
  const { nodeX, nodeZ } = state.map.graph;
  const first = resident * MAX_PATH_NODES;
  const count = state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.pathCount]!;
  let walked = 0;
  for (let step = 0; step < count; step++) {
    if (step > 0) {
      const before = state.pathNodes[first + step - 1]!;
      const here = state.pathNodes[first + step]!;
      walked += hypot2(nodeX[here]! - nodeX[before]!, nodeZ[here]! - nodeZ[before]!);
    }
    state.pathDistance[first + step] = walked;
  }
  return walked;
}

/** A resident's name as one integer, for a life log line that must outlive the slot. */
export function residentName(state: CityState, resident: number): number {
  const base = resident * RESIDENT_INT_STRIDE;
  return packName(state.ints[base + RESIDENT_INT.gender]!, state.ints[base + RESIDENT_INT.firstName]!, state.ints[base + RESIDENT_INT.familyName]!);
}
