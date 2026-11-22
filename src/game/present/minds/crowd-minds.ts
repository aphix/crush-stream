import { HASH16, KIND_LIFE, hash16 } from "../civilian-gaze-constants.ts";
import { STIMULUS, type CrowdGaze } from "../civilian-gaze.ts";
import { NEEDLE_WEIGHTS, type FromNeedle, type ToNeedle } from "./minds-protocol.ts";
import { MindsWorld, hourKey, readGroup, readResident } from "./minds-read.ts";
import { Situation, fitsSituation, pickFallback, situationQuery, situationTools } from "./thought-situation.ts";
import { THOUGHT, Thought, VERDICT, readCall, thoughtLine } from "./thought-tools.ts";

/** The Needle worker as the Minds talk to it (a `Worker`; a test hands in a stand-in that counts). */
export type NeedleWorker = {
  postMessage(message: ToNeedle): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromNeedle>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

/** A call that has not answered in this many seconds ends the worker: the measured desktop call is 2-6 s, a loaded phone's up to ~49 s (OPEN_WORLD.md "Minds"). */
const ASK_BUDGET_S = 15;
/** After a call ran out of time, no new one for this long (s): a box that slow would only queue more. */
const SLOW_BACKOFF_S = 60;
/** How long a thought's look holds her (s), and how it ranks against her own picks (0-1): above an idle glance, under a crash's pulse (tuned by feel). */
const THOUGHT_HOLD_S = 2.5;
const THOUGHT_URGENCY = 0.5;
/** A group is the shown people within this many metres of a pulse, at most `GROUP_MAX` of them, at least `GROUP_MIN` (tuned by feel: one side of a street). */
const GROUP_METRES = 15;
const GROUP_MAX = 12;
const GROUP_MIN = 2;
/** A group's heads turn one after another: this much later per person, plus up to `STAGGER_JITTER_S` of her own (tuned by feel). */
const STAGGER_STEP_S = 0.15;
const STAGGER_JITTER_S = 0.4;
/** The stimulus table is read for new pulses this often (Hz), the look-at panel's own rate. */
const SCAN_HZ = 4;
/** A pulse of the same kind within this many metres of one already taken is the same pulse. */
const SAME_PULSE_METRES = 2;
/** Pulses a group thinks about together. */
const PULSE_KINDS: readonly number[] = [STIMULUS.crash, STIMULUS.knock, STIMULUS.gunshot];
const NO_ASK = 0;
const ASK_ONE = 1;
const ASK_GROUP = 2;
const NOT_SCHEDULED = -1;
const NO_HOUR = -1;

/** One ask of the model: who it is for (a resident or a group's members), the hour it was asked in, and the situation its answer must fit. */
class Ask {
  kind = NO_ASK;
  id = 0;
  hour = NO_HOUR;
  started = 0;
  readonly sit = new Situation();
  readonly members = new Int32Array(GROUP_MAX);
  count = 0;

  copyFrom(other: Ask): void {
    this.kind = other.kind;
    this.hour = other.hour;
    this.sit.copyFrom(other.sit);
    this.members.set(other.members);
    this.count = other.count;
  }
}

/**
 * What the residents think, singly when the look-at panel rests on one and together when a pulse (a crash, a knock, a shot) turns a group, as one panel
 * line each and a look on the gaze (`attend`). A cheap deterministic pick answers at once and always; when the Minds setting is on, Needle 2 in a worker
 * is asked once for the same moment and its answer, if it names a thought that fits, replaces the pick. Presentation only: nothing here reaches the brain or the wire.
 */
export class CrowdMinds {
  /** Per resident: the game hour her thought was had in, and the thought (tool, argument, and the purpose a "plans" thought names). */
  readonly thoughtHour: Int32Array;
  readonly thoughtTool: Uint8Array;
  readonly thoughtArg: Uint8Array;
  readonly thoughtPurpose: Int16Array;
  /** What became of the model's answers, by `VERDICT`. */
  readonly verdicts = new Int32Array(Object.keys(VERDICT).length);
  /** Milliseconds the worker took to load (-1: not loaded) and its last call took. */
  loadMs = -1;
  lastCallMs = -1;
  private readonly createWorker: () => NeedleWorker;
  private on = false;
  private worker: NeedleWorker | null = null;
  private ready = false;
  private broken = false;
  private seconds = 0;
  private backoffUntil = 0;
  private scanAcc = 0;
  private nextId = 1;
  private readonly flight = new Ask();
  private readonly queued = new Ask();
  private readonly sit = new Situation();
  private readonly pick = new Thought();
  private readonly world: MindsWorld;
  /** Looks scheduled for a group: when each turns (s on the Minds' clock, `NOT_SCHEDULED` none) and at what. */
  private readonly attendAt: Float64Array;
  private readonly attendPoint: Float32Array;
  private scheduled = 0;
  /** Pulses already taken: kind, spot and when (s). */
  private readonly pulseKind = new Uint8Array(PULSE_KINDS.length * GROUP_MAX);
  private readonly pulseX = new Float32Array(PULSE_KINDS.length * GROUP_MAX);
  private readonly pulseZ = new Float32Array(PULSE_KINDS.length * GROUP_MAX);
  private readonly pulseAt = new Float64Array(PULSE_KINDS.length * GROUP_MAX).fill(-Infinity);
  private pulseNext = 0;

  constructor(capacity: number, world: MindsWorld, createWorker: () => NeedleWorker) {
    this.world = world;
    this.createWorker = createWorker;
    this.thoughtHour = new Int32Array(capacity).fill(NO_HOUR);
    this.thoughtTool = new Uint8Array(capacity);
    this.thoughtArg = new Uint8Array(capacity);
    this.thoughtPurpose = new Int16Array(capacity);
    this.attendAt = new Float64Array(capacity).fill(NOT_SCHEDULED);
    this.attendPoint = new Float32Array(capacity * 3);
  }

  /** The Minds setting: off ends the worker and drops what was asked; on lets the next thought ask (nothing loads before then). */
  setOn(on: boolean): void {
    this.on = on;
    if (on) return;
    this.endWorker();
    this.queued.kind = NO_ASK;
  }

  /** The panel's thought line for resident `resident`, whom the eye rests on: her thought this hour, picked now (and the model asked) if she has none yet. */
  lookAt(resident: number): string | null {
    const { state, poses } = this.world;
    if (state === null || poses === null || resident < 0 || resident >= this.thoughtHour.length) return null;
    const hour = hourKey(this.world.tick);
    if (this.thoughtHour[resident] !== hour) {
      readResident(this.sit, this.world, state, poses, resident);
      pickFallback(this.sit, this.pick);
      this.keep(resident, hour, this.pick, this.sit.purpose);
      this.attendFor(resident, this.pick, this.sit);
      if (this.on) this.ask(ASK_ONE, hour, this.sit, null, 0);
    }
    return thoughtLine(this.thoughtTool[resident]!, this.thoughtArg[resident]!, this.thoughtPurpose[resident]!);
  }

  /** One frame: the scheduled looks whose time has come turn, a call over its budget ends the worker, and the gaze's table is read for new pulses at `SCAN_HZ`. Allocates nothing unless a pulse is new. */
  frame(dt: number): void {
    this.seconds += dt;
    if (this.flight.kind !== NO_ASK && this.seconds - this.flight.started > ASK_BUDGET_S) this.timeOut();
    if (this.scheduled > 0) this.turnScheduled();
    this.scanAcc += dt;
    if (this.scanAcc < 1 / SCAN_HZ) return;
    this.scanAcc = 0;
    this.scanPulses();
  }

  private keep(resident: number, hour: number, thought: Thought, purpose: number): void {
    this.thoughtHour[resident] = hour;
    this.thoughtTool[resident] = thought.tool;
    this.thoughtArg[resident] = thought.arg;
    this.thoughtPurpose[resident] = purpose;
  }

  /** Her look for a thought: at what she looks at, at the eye on her for anything else she has on her mind (she notices being looked at), none to let it go. */
  private attendFor(resident: number, thought: Thought, sit: Situation): void {
    const gaze = this.world.gaze;
    if (gaze === null || thought.tool === THOUGHT.ignore) return;
    const row = thought.tool === THOUGHT.look_at ? sit.seenRow(thought.arg) : -1;
    if (row >= 0) gaze.attend(resident, sit.seenX[row]!, sit.seenY[row]!, sit.seenZ[row]!, THOUGHT_HOLD_S, THOUGHT_URGENCY);
    else gaze.attend(resident, this.world.eyeX, this.world.eyeY, this.world.eyeZ, THOUGHT_HOLD_S, THOUGHT_URGENCY);
  }

  /** Puts an ask next in line (the newest wins the one free slot) and sends it if the model is idle. */
  private ask(kind: number, hour: number, sit: Situation, members: Int32Array | null, count: number): void {
    const next = this.queued;
    next.kind = kind;
    next.hour = hour;
    next.sit.copyFrom(sit);
    if (members !== null) next.members.set(members.subarray(0, count));
    next.count = count;
    this.send();
  }

  private send(): void {
    if (!this.on || this.broken || this.queued.kind === NO_ASK || this.flight.kind !== NO_ASK || this.seconds < this.backoffUntil) return;
    if (this.worker === null) this.startWorker();
    if (!this.ready || this.worker === null) return;
    this.flight.copyFrom(this.queued);
    this.queued.kind = NO_ASK;
    this.flight.id = this.nextId++;
    this.flight.started = this.seconds;
    this.worker.postMessage({ kind: "ask", id: this.flight.id, query: situationQuery(this.flight.sit), tools: situationTools(this.flight.sit) });
  }

  private startWorker(): void {
    const worker = this.createWorker();
    this.worker = worker;
    this.ready = false;
    worker.onmessage = (event) => this.hear(event.data);
    worker.onerror = (event) => this.fail(event.message);
    worker.postMessage({ kind: "load", url: NEEDLE_WEIGHTS.url, sha256: NEEDLE_WEIGHTS.sha256 });
  }

  private endWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.flight.kind = NO_ASK;
  }

  /** The worker could not load or run the model: the fallback answers for the rest of the session, said once in the console. */
  private fail(message: string): void {
    console.error("Crush Stream Minds: Needle is off for this session", message);
    this.broken = true;
    this.endWorker();
  }

  private timeOut(): void {
    this.verdicts[VERDICT.late]!++;
    this.endWorker();
    this.backoffUntil = this.seconds + SLOW_BACKOFF_S;
  }

  private hear(message: FromNeedle): void {
    if (message.kind === "failed") {
      this.fail(message.message);
      return;
    }
    if (message.kind === "ready") {
      this.ready = true;
      this.loadMs = message.loadMs;
      this.send();
      return;
    }
    if (message.id !== this.flight.id || this.flight.kind === NO_ASK) {
      this.verdicts[VERDICT.late]!++;
      return;
    }
    this.lastCallMs = message.ms;
    this.take(message.text);
    this.flight.kind = NO_ASK;
    this.send();
  }

  /** The model's answer for the ask in flight: kept when it names a thought tool with a closed argument that fits the moment asked about; else the fallback stands. */
  private take(text: string): void {
    const ask = this.flight;
    let verdict = readCall(text, this.pick);
    if (verdict === VERDICT.taken && !fitsSituation(ask.sit, this.pick)) verdict = VERDICT.absent;
    this.verdicts[verdict]!++;
    if (verdict !== VERDICT.taken) return;
    if (ask.kind === ASK_ONE) {
      const resident = ask.sit.resident;
      if (this.thoughtHour[resident] !== ask.hour) return;
      this.keep(resident, ask.hour, this.pick, ask.sit.purpose);
      this.attendFor(resident, this.pick, ask.sit);
      return;
    }
    this.fanOut(ask.members, ask.count, ask.hour, this.pick, ask.sit);
  }

  /** A group's thought: each member keeps it for the hour and turns in her own time, to the pulse for a look, to the next of them for a remark. */
  private fanOut(members: Int32Array, count: number, hour: number, thought: Thought, sit: Situation): void {
    for (let rank = 0; rank < count; rank++) {
      const resident = members[rank]!;
      this.keep(resident, hour, thought, -1);
      if (thought.tool === THOUGHT.ignore) continue;
      const toward = thought.tool === THOUGHT.look_at ? -1 : members[(rank + 1) % count]!;
      this.schedule(resident, rank, toward, sit);
    }
  }

  private schedule(resident: number, rank: number, toward: number, sit: Situation): void {
    const poses = this.world.poses;
    const point = this.attendPoint;
    if (toward >= 0 && poses !== null) {
      point[resident * 3] = poses.x[toward]!;
      point[resident * 3 + 1] = poses.feetY[toward]! + FACE_UP_M;
      point[resident * 3 + 2] = poses.z[toward]!;
    } else {
      point[resident * 3] = sit.seenX[0]!;
      point[resident * 3 + 1] = sit.seenY[0]!;
      point[resident * 3 + 2] = sit.seenZ[0]!;
    }
    if (this.attendAt[resident] === NOT_SCHEDULED) this.scheduled++;
    this.attendAt[resident] = this.seconds + rank * STAGGER_STEP_S + (STAGGER_JITTER_S * hash16(resident, this.nextId)) / HASH16;
  }

  private turnScheduled(): void {
    const gaze = this.world.gaze;
    const at = this.attendAt;
    const point = this.attendPoint;
    for (let resident = 0; resident < at.length && this.scheduled > 0; resident++) {
      const when = at[resident]!;
      if (when === NOT_SCHEDULED || when > this.seconds) continue;
      at[resident] = NOT_SCHEDULED;
      this.scheduled--;
      gaze?.attend(resident, point[resident * 3]!, point[resident * 3 + 1]!, point[resident * 3 + 2]!, THOUGHT_HOLD_S, THOUGHT_URGENCY);
    }
  }

  /** New crash, knock or shot pulses in the gaze's table each start a group thought. */
  private scanPulses(): void {
    const { gaze, poses } = this.world;
    if (gaze === null || poses === null) return;
    const table = gaze.stimuli;
    for (let row = 0; row < table.count; row++) {
      const kind = table.kind[row]!;
      if (!PULSE_KINDS.includes(kind) || table.life[row]! < KIND_LIFE[kind]! - 1 / SCAN_HZ - this.scanSlack() || this.knownPulse(kind, table.x[row]!, table.z[row]!)) continue;
      this.notePulse(kind, table.x[row]!, table.z[row]!);
      this.groupAround(gaze, poses, kind, table.salience[row]!, table.x[row]!, table.y[row]!, table.z[row]!);
    }
  }

  /** A frame's worth of slack on a pulse's age, so one born just after a scan is still fresh at the next. */
  private scanSlack(): number {
    return 1 / SCAN_HZ;
  }

  private knownPulse(kind: number, x: number, z: number): boolean {
    for (let at = 0; at < this.pulseKind.length; at++) {
      if (this.pulseKind[at] !== kind || this.seconds - this.pulseAt[at]! > KIND_LIFE[kind]!) continue;
      const dx = this.pulseX[at]! - x;
      const dz = this.pulseZ[at]! - z;
      if (dx * dx + dz * dz < SAME_PULSE_METRES * SAME_PULSE_METRES) return true;
    }
    return false;
  }

  private notePulse(kind: number, x: number, z: number): void {
    const at = this.pulseNext;
    this.pulseNext = (at + 1) % this.pulseKind.length;
    this.pulseKind[at] = kind;
    this.pulseX[at] = x;
    this.pulseZ[at] = z;
    this.pulseAt[at] = this.seconds;
  }

  private groupAround(gaze: CrowdGaze, poses: NonNullable<MindsWorld["poses"]>, kind: number, salience: number, x: number, y: number, z: number): void {
    const members = this.queued.members;
    let count = 0;
    let metres = 0;
    for (let resident = 0; resident < poses.count && count < GROUP_MAX; resident++) {
      if (poses.shown[resident] === 0) continue;
      const dx = poses.x[resident]! - x;
      const dz = poses.z[resident]! - z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance > GROUP_METRES) continue;
      members[count++] = resident;
      metres += distance;
    }
    if (count < GROUP_MIN || gaze !== this.world.gaze) return;
    const hour = hourKey(this.world.tick);
    readGroup(this.sit, this.world, count, kind, salience, metres / count, x, y, z);
    pickFallback(this.sit, this.pick);
    this.fanOut(members, count, hour, this.pick, this.sit);
    if (this.on) this.ask(ASK_GROUP, hour, this.sit, members, count);
  }
}

/** A face is this far over the feet (m): where a group member looks at the one beside her. */
const FACE_UP_M = 1.55;
