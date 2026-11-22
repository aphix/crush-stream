import { PURPOSE_LABELS } from "../../ai/civilians/civilian-names.ts";
import { THINK, THOUGHT, Thought, EVENT_IDS, NEED_IDS, STIMULUS_IDS, isArgOf, thoughtTools } from "./thought-tools.ts";

/** At most this many stimuli and recent events go into a situation (the nearest and freshest); a short list keeps the prompt short. */
const SEEN_MAX = 4;
const HEARD_MAX = 3;

/**
 * What a resident's mind has to go on at one moment, read from the brain's row, the gaze's stimulus table and the event log, into fixed arrays.
 * One person (`resident` >= 0: `who` her name and age, `feeling` her mood's word) or a group (`size` people around a pulse).
 */
export class Situation {
  resident = -1;
  size = 1;
  who = "";
  feeling = "";
  hour = 0;
  purpose = -1;
  walking = false;
  hasWork = false;
  hasCompany = false;
  /** Her most pressing need over the mood's level (-1: none) and its level 0-1. */
  topNeed = -1;
  topLevel = 0;
  seen = 0;
  readonly seenKind = new Uint8Array(SEEN_MAX);
  readonly seenSalience = new Float32Array(SEEN_MAX);
  readonly seenMetres = new Float32Array(SEEN_MAX);
  readonly seenX = new Float32Array(SEEN_MAX);
  readonly seenY = new Float32Array(SEEN_MAX);
  readonly seenZ = new Float32Array(SEEN_MAX);
  heard = 0;
  readonly heardKind = new Uint8Array(HEARD_MAX);
  /** Game minutes since each event. */
  readonly heardAge = new Float32Array(HEARD_MAX);

  clear(): void {
    this.resident = -1;
    this.size = 1;
    this.who = "";
    this.feeling = "";
    this.purpose = -1;
    this.walking = false;
    this.hasWork = false;
    this.hasCompany = false;
    this.topNeed = -1;
    this.topLevel = 0;
    this.seen = 0;
    this.heard = 0;
  }

  /** This situation becomes a copy of `other` (an ask keeps its own, so the next read does not change what the answer is checked against). */
  copyFrom(other: Situation): void {
    this.resident = other.resident;
    this.size = other.size;
    this.who = other.who;
    this.feeling = other.feeling;
    this.hour = other.hour;
    this.purpose = other.purpose;
    this.walking = other.walking;
    this.hasWork = other.hasWork;
    this.hasCompany = other.hasCompany;
    this.topNeed = other.topNeed;
    this.topLevel = other.topLevel;
    this.seen = other.seen;
    this.seenKind.set(other.seenKind);
    this.seenSalience.set(other.seenSalience);
    this.seenMetres.set(other.seenMetres);
    this.seenX.set(other.seenX);
    this.seenY.set(other.seenY);
    this.seenZ.set(other.seenZ);
    this.heard = other.heard;
    this.heardKind.set(other.heardKind);
    this.heardAge.set(other.heardAge);
  }

  /** Notes a stimulus, keeping the `SEEN_MAX` most salient for their distance. */
  see(kind: number, salience: number, metres: number, x: number, y: number, z: number): void {
    const weight = lookWeight(salience, metres);
    let at = this.seen < SEEN_MAX ? this.seen++ : -1;
    if (at < 0) {
      let weakest = 0;
      for (let row = 1; row < SEEN_MAX; row++) if (lookWeight(this.seenSalience[row]!, this.seenMetres[row]!) < lookWeight(this.seenSalience[weakest]!, this.seenMetres[weakest]!)) weakest = row;
      if (lookWeight(this.seenSalience[weakest]!, this.seenMetres[weakest]!) >= weight) return;
      at = weakest;
    }
    this.seenKind[at] = kind;
    this.seenSalience[at] = salience;
    this.seenMetres[at] = metres;
    this.seenX[at] = x;
    this.seenY[at] = y;
    this.seenZ[at] = z;
  }

  /** Notes an event `ageMinutes` old; the caller gives them newest first, and only the first of a kind counts. */
  hear(kind: number, ageMinutes: number): void {
    if (this.heard >= HEARD_MAX) return;
    for (let row = 0; row < this.heard; row++) if (this.heardKind[row] === kind) return;
    this.heardKind[this.heard] = kind;
    this.heardAge[this.heard] = ageMinutes;
    this.heard++;
  }

  /** The row of the seen stimulus of `kind`, or -1. */
  seenRow(kind: number): number {
    for (let row = 0; row < this.seen; row++) if (this.seenKind[row] === kind) return row;
    return -1;
  }

  heardRow(kind: number): number {
    for (let row = 0; row < this.heard; row++) if (this.heardKind[row] === kind) return row;
    return -1;
  }
}

/** A stimulus's pull falls off with distance: half at this many metres (tuned by feel: a crash across the street still wins over a car beside her). */
const LOOK_HALF_METRES = 10;

function lookWeight(salience: number, metres: number): number {
  return salience / (1 + metres / LOOK_HALF_METRES);
}

/** The fallback's weights against a look's pull (0-1): a pressing need, fresh news, a plain thought, nothing (tuned by feel). */
const WORRY_WEIGHT = 0.8;
const REMARK_WEIGHT = 0.6;
const THINK_WEIGHT = 0.35;
const IGNORE_WEIGHT = 0.2;
/** News stops being worth a remark after this many game minutes (a game hour, the thought cache's span). */
export const NEWS_MINUTES = 60;
/** Night for "home soon" thoughts: from this hour to `MORNING_HOUR`. */
const EVENING_HOUR = 21;
const MORNING_HOUR = 6;
/** Morning for "work again" thoughts: from `MORNING_HOUR` to this hour. */
const WORK_START_HOUR = 10;
/** A group may look or remark, or let it go; worrying and plans are one person's. */
const GROUP_TOOLS: readonly number[] = [THOUGHT.ignore, THOUGHT.look_at, THOUGHT.remark_on];

/** Whether thought `thought` fits `sit`: a look at something present, a remark on something heard, plans while she has some, a group's kind of thought. */
export function fitsSituation(sit: Situation, thought: Thought): boolean {
  if (!isArgOf(thought.tool, thought.arg)) return false;
  if (sit.resident < 0 && !GROUP_TOOLS.includes(thought.tool)) return false;
  switch (thought.tool) {
    case THOUGHT.look_at:
      return sit.seenRow(thought.arg) >= 0;
    case THOUGHT.remark_on:
      return sit.heardRow(thought.arg) >= 0;
    case THOUGHT.think_about:
      return thought.arg === THINK.plans ? sit.purpose >= 0 : thought.arg === THINK.company ? sit.hasCompany : thought.arg === THINK.work ? sit.hasWork : true;
    default:
      return true;
  }
}

/** The cheap deterministic pick that answers whenever the model does not: the strongest of a look, a worry, a remark, a thought, or nothing, into `out`. */
export function pickFallback(sit: Situation, out: Thought): void {
  out.tool = THOUGHT.ignore;
  out.arg = 0;
  let best = IGNORE_WEIGHT;
  for (let row = 0; row < sit.seen; row++) {
    const weight = lookWeight(sit.seenSalience[row]!, sit.seenMetres[row]!);
    if (weight <= best) continue;
    best = weight;
    out.tool = THOUGHT.look_at;
    out.arg = sit.seenKind[row]!;
  }
  if (sit.heard > 0 && REMARK_WEIGHT * (1 - sit.heardAge[0]! / NEWS_MINUTES) > best) {
    best = REMARK_WEIGHT * (1 - sit.heardAge[0]! / NEWS_MINUTES);
    out.tool = THOUGHT.remark_on;
    out.arg = sit.heardKind[0]!;
  }
  if (sit.resident < 0) return;
  if (sit.topNeed >= 0 && WORRY_WEIGHT * sit.topLevel > best) {
    best = WORRY_WEIGHT * sit.topLevel;
    out.tool = THOUGHT.worry_about;
    out.arg = sit.topNeed;
  }
  if (THINK_WEIGHT > best) {
    out.tool = THOUGHT.think_about;
    out.arg = thinkingOf(sit);
  }
}

function thinkingOf(sit: Situation): number {
  if (sit.hour >= EVENING_HOUR || sit.hour < MORNING_HOUR) return THINK.home;
  if (sit.hasWork && sit.hour < WORK_START_HOUR) return THINK.work;
  if (sit.hasCompany) return THINK.company;
  return sit.purpose >= 0 ? THINK.plans : THINK.home;
}

/** The model's prompt for `sit`, one short sentence as Needle reads best (a command-like line, not a story), naming things by the tools' own words. */
export function situationQuery(sit: Situation): string {
  const who = `${sit.who}, ${sit.feeling}${sit.purpose >= 0 && sit.walking ? `, on the way to ${PURPOSE_LABELS[sit.purpose]}` : ""}`;
  const need = sit.topNeed >= 0 ? `, needs ${NEED_IDS[sit.topNeed]}` : "";
  const around = Array.from({ length: sit.seen }, (_, row) => `a ${STIMULUS_IDS[sit.seenKind[row]!]} ${Math.round(sit.seenMetres[row]!)} m away`);
  const lately = Array.from({ length: sit.heard }, (_, row) => `the ${EVENT_IDS[sit.heardKind[row]!]} ${Math.round(sit.heardAge[row]!)} minutes ago`);
  return `${who}${need}, at ${sit.hour}:00${around.length > 0 ? `; sees ${around.join(", ")}` : ""}${lately.length > 0 ? `; heard about ${lately.join(", ")}` : ""}.`;
}

/** The thought tools narrowed to what fits `sit`, as the JSON the model is given with its query. */
export function situationTools(sit: Situation): string {
  const probe = new Thought();
  return JSON.stringify(
    thoughtTools((tool, arg) => {
      probe.tool = tool;
      probe.arg = arg;
      return fitsSituation(sit, probe);
    }),
  );
}
