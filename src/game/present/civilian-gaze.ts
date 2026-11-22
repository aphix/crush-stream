import { ALARM_DELAY_JITTER_SHARE, ALARM_DELAY_MAX_SECONDS, ALARM_DELAY_MIN_SECONDS } from "../ai/civilians/civilian-constants.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { neuroticismOf } from "../ai/civilians/civilian-temperament.ts";
import {
  ALIGN_MASK,
  ALIGN_SHIFT,
  CAR_LOOK_HEIGHT_M,
  COOLDOWN_BYPASS,
  EYE_HEIGHT_M,
  FACE_HEIGHT_M,
  FOV_COS,
  GAZE_RANGE_M,
  HASH16,
  hash16,
  HEAD_ALIGN_MIN,
  HEAD_LATENCY_S,
  HEAD_OMEGA,
  HEAD_YAW_LIMIT,
  HEAD_YAW_RATE,
  HEARD_SHARE,
  KIND_HOLD_MIN,
  KIND_HOLD_SPAN,
  LOOK_COOLDOWN_S,
  LOOK_WORDS,
  LOS_FREE_M,
  LOS_PER_FRAME,
  PARTNER_GLANCE_FACTOR,
  PITCH_LIMIT,
  PITCH_RATE,
  POLL_MASK,
  PREEMPT_MARGIN,
  REACT_FLOOR,
  SCRATCH,
  SCRATCH_SLOTS,
  SEEN_ONLY,
  STIMULUS,
  TORSO_JOIN,
  TORSO_OMEGA,
  TORSO_RATE,
  TORSO_YAW_LIMIT,
  TOUCH_M,
  WALK_LOOK_DOWN,
} from "./civilian-gaze-constants.ts";
import { WALKING_ABOVE } from "./civilian-anim.ts";
import { chooseLook, CrowdGrid } from "./civilian-gaze-poll.ts";
import { addPulse, blankSenses, createStimuli, refreshStimuli, type GazeSenses, type GazeStimuli } from "./civilian-gaze-table.ts";

export { STIMULUS } from "./civilian-gaze-constants.ts";

/** Eased channels per civilian: her whole turn toward the target (rad, toward her +x positive), the head's pitch (down positive), the torso's share of the turn. */
const YAW = 0;
const PITCH = 1;
const TORSO = 2;
const EASED = 3;
const OMEGA = Float64Array.of(HEAD_OMEGA, HEAD_OMEGA, TORSO_OMEGA);
const RATE = Float64Array.of(HEAD_YAW_RATE, PITCH_RATE, TORSO_RATE);
/** A frame this long (s) or longer is taken as this long: after a stall heads ease on, they don't jump. */
const LONGEST_FRAME_S = 0.1;
/** A target nearer than this (m) across the ground keeps her head where it is: the angle to it flips with a hair's move. */
const AIM_HELD_M = 0.3;
const TWO_PI = 2 * Math.PI;
/** Salts for a pulse's draws (who reacts, how late) and a look's length. */
const SALT = { react: 11, jitter: 12, hold: 13 } as const;
/** Someone knocked down draws looks at this salience while they lie. */
const DOWN_SALIENCE = 1;
const NO_PENDING = -1;

/**
 * Where the drawn civilians look, each frame, on the main thread: local presentation, never the brain's or the wire's. Each person re-chooses every 8 frames
 * (`chooseLook`: cars by speed and closing, the player, sirens, crashes, someone down, a passer-by, idle glances), holds a look 0.5-4 s and then refuses ambient
 * ones for 4 s (reVC); a pulse (`pulse`) turns most heads in its radius after a latency scaled by each one's neuroticism; `attend` is an outside request.
 * The head eases toward the target (critically damped, rate-capped), the torso joining past `TORSO_JOIN`. Outputs, per civilian and relative to her facing:
 * `headYaw` (from the torso), `headPitch` (down positive) and `torsoTwist`. Typed arrays sized at construction; `update` allocates nothing.
 */
export class CrowdGaze {
  readonly capacity: number;
  readonly stimuli: GazeStimuli = createStimuli();
  readonly scratch = new Float64Array(SCRATCH_SLOTS);
  readonly grid: CrowdGrid;
  /** Shop windows and signs, (x, y, z) triples: idle glances land on the nearest in front. */
  attractors = new Float32Array(0);
  frame = 0;
  candidateKind: number = STIMULUS.none;
  candidateSource = -1;
  /** What each looks at now (`STIMULUS`; none: ahead, or at her partner when she has one) and its source (a car or civilian index, -1). */
  readonly lookKind: Uint8Array;
  readonly lookSource: Int32Array;
  readonly headYaw: Float32Array;
  readonly headPitch: Float32Array;
  readonly torsoTwist: Float32Array;
  private readonly lookPoint: Float32Array;
  private readonly holdLeft: Float32Array;
  private readonly lookUrgency: Float32Array;
  private readonly cooldown: Float32Array;
  private readonly pendingLeft: Float32Array;
  private readonly pendingKind: Uint8Array;
  private readonly pendingSource: Int32Array;
  private readonly pendingPoint: Float32Array;
  private readonly pendingHold: Float32Array;
  private readonly pendingUrgency: Float32Array;
  private readonly angle: Float64Array;
  private readonly velocity: Float64Array;
  private readonly nerve: Float32Array;
  private readonly align: Float32Array;
  private readonly traitLook: Uint32Array;
  private readonly traitKnown: Uint8Array;
  private readonly goal = new Float64Array(EASED);
  private readonly decay = new Float64Array(EASED);
  private pulses = 0;
  private serial = 0;
  private losLeft = 0;
  private dt = 0;
  private poses: CrowdPoses | null = null;
  private senses: GazeSenses = blankSenses();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.grid = new CrowdGrid(capacity);
    this.lookKind = new Uint8Array(capacity);
    this.lookSource = new Int32Array(capacity).fill(-1);
    this.headYaw = new Float32Array(capacity);
    this.headPitch = new Float32Array(capacity);
    this.torsoTwist = new Float32Array(capacity);
    this.lookPoint = new Float32Array(capacity * 3);
    this.holdLeft = new Float32Array(capacity);
    this.lookUrgency = new Float32Array(capacity);
    this.cooldown = new Float32Array(capacity);
    this.pendingLeft = new Float32Array(capacity).fill(NO_PENDING);
    this.pendingKind = new Uint8Array(capacity);
    this.pendingSource = new Int32Array(capacity);
    this.pendingPoint = new Float32Array(capacity * 3);
    this.pendingHold = new Float32Array(capacity);
    this.pendingUrgency = new Float32Array(capacity);
    this.angle = new Float64Array(capacity * EASED);
    this.velocity = new Float64Array(capacity * EASED);
    this.nerve = new Float32Array(capacity);
    this.align = new Float32Array(capacity);
    this.traitLook = new Uint32Array(capacity);
    this.traitKnown = new Uint8Array(capacity);
  }

  /** Once a frame, `dt` s after the last, before the crowd is drawn: the table sensed again and every shown civilian near the eye choosing and turning. */
  update(poses: CrowdPoses, dt: number, senses: GazeSenses): void {
    this.poses = poses;
    this.senses = senses;
    this.dt = Math.min(Math.max(0, dt), LONGEST_FRAME_S);
    this.frame = (this.frame + 1) | 0;
    for (let channel = 0; channel < EASED; channel++) this.decay[channel] = Math.exp(-OMEGA[channel]! * this.dt);
    this.scratch[SCRATCH.frameSeconds] = this.dt;
    this.pulses = refreshStimuli(this.stimuli, this.pulses, senses, this.scratch);
    const count = Math.min(poses.count, this.capacity);
    this.grid.build(poses, count);
    this.losLeft = LOS_PER_FRAME;
    for (let civilian = 0; civilian < count; civilian++) this.step(civilian, poses);
  }

  /**
   * Something loud at (x, y, z): it lingers in the table (`STIMULUS` kind `kind`, 0-1 `salience`) and, like a Hitman behaviour zone, turns heads within `radius` m:
   * each reacts on a share from `REACT_FLOOR` to all by her neuroticism (less when it is behind her), after the brain's alarm delay for her. A knock leaves someone down too.
   */
  pulse(kind: number, x: number, y: number, z: number, radius: number, salience: number): void {
    this.pulses = addPulse(this.stimuli, this.pulses, kind, x, y, z, salience);
    if (kind === STIMULUS.knock) this.pulses = addPulse(this.stimuli, this.pulses, STIMULUS.down, x, y, z, DOWN_SALIENCE);
    this.serial = (this.serial + 1) | 0;
    const poses = this.poses;
    if (poses === null) return;
    const count = Math.min(poses.count, this.capacity);
    for (let civilian = 0; civilian < count; civilian++) {
      if (poses.shown[civilian] === 0) continue;
      const dx = x - poses.x[civilian]!;
      const dz = z - poses.z[civilian]!;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance > radius || this.busierThan(civilian, salience)) continue;
      this.know(civilian, poses.look[civilian]!);
      const nerve = this.nerve[civilian]!;
      const seen = distance < TOUCH_M || dx * Math.sin(poses.yaw[civilian]!) + dz * Math.cos(poses.yaw[civilian]!) >= FOV_COS * distance;
      const share = (REACT_FLOOR + (1 - REACT_FLOOR) * nerve) * (seen ? 1 : HEARD_SHARE);
      if (hash16(civilian, this.serial ^ SALT.react) >= share * HASH16) continue;
      const jitter = hash16(civilian, this.serial ^ SALT.jitter) / HASH16;
      this.scratch[SCRATCH.delay] = ALARM_DELAY_MIN_SECONDS + (ALARM_DELAY_MAX_SECONDS - ALARM_DELAY_MIN_SECONDS) * ((1 - ALARM_DELAY_JITTER_SHARE) * (1 - nerve) + ALARM_DELAY_JITTER_SHARE * jitter);
      this.request(civilian, kind, x, y, z, salience);
    }
  }

  /** An outside request (the Mind lane): civilian `index` looks at (x, y, z) for `holdSeconds`, unless something more urgent (`urgency` 0-1 ranks it against her own picks) holds her. */
  attend(index: number, x: number, y: number, z: number, holdSeconds: number, urgency: number): void {
    if (index < 0 || index >= this.capacity || this.busierThan(index, urgency)) return;
    this.scratch[SCRATCH.delay] = HEAD_LATENCY_S;
    this.request(index, STIMULUS.attend, x, y, z, urgency);
    this.pendingHold[index] = holdSeconds;
  }

  /** One line for the look panel: what civilian `civilian` looks at. */
  describe(civilian: number): string {
    const kind = this.lookKind[civilian] ?? STIMULUS.none;
    const partner = this.poses?.partner[civilian] ?? -1;
    return `Looking at ${LOOK_WORDS[kind === STIMULUS.none && partner >= 0 ? STIMULUS.partner : kind]}`;
  }

  /** Whether civilian `civilian` is on, or about to be on, something at least `urgency` urgent. */
  private busierThan(civilian: number, urgency: number): boolean {
    return (this.pendingLeft[civilian]! >= 0 && this.pendingUrgency[civilian]! >= urgency) || (this.lookKind[civilian] !== STIMULUS.none && this.lookUrgency[civilian]! >= urgency);
  }

  /** Civilian `civilian` will look at (x, y, z) as a `kind` look of `urgency` after the scratch's `delay`, for her kind's hold. */
  private request(civilian: number, kind: number, x: number, y: number, z: number, urgency: number): void {
    const s = this.scratch;
    s[SCRATCH.x] = x;
    s[SCRATCH.y] = y;
    s[SCRATCH.z] = z;
    s[SCRATCH.urgency] = urgency;
    s[SCRATCH.hold] = KIND_HOLD_MIN[kind]! + (KIND_HOLD_SPAN[kind]! * hash16(civilian, this.serial ^ this.frame ^ SALT.hold)) / HASH16;
    this.offer(civilian, kind, -1);
  }

  /** Civilian `civilian` will look at the scratch's point, a `kind` look of `source` at its urgency and hold, after its delay. */
  private offer(civilian: number, kind: number, source: number): void {
    const s = this.scratch;
    this.pendingLeft[civilian] = s[SCRATCH.delay]!;
    this.pendingKind[civilian] = kind;
    this.pendingSource[civilian] = source;
    this.pendingPoint[civilian * 3] = s[SCRATCH.x]!;
    this.pendingPoint[civilian * 3 + 1] = s[SCRATCH.y]!;
    this.pendingPoint[civilian * 3 + 2] = s[SCRATCH.z]!;
    this.pendingHold[civilian] = s[SCRATCH.hold]!;
    this.pendingUrgency[civilian] = s[SCRATCH.urgency]!;
  }

  /** Her neuroticism and head-mover share, made again only when her look word changes. */
  private know(civilian: number, look: number): void {
    if (this.traitKnown[civilian] === 1 && this.traitLook[civilian] === look) return;
    this.traitKnown[civilian] = 1;
    this.traitLook[civilian] = look;
    this.nerve[civilian] = neuroticismOf(look);
    this.align[civilian] = HEAD_ALIGN_MIN + ((1 - HEAD_ALIGN_MIN) * ((look >>> ALIGN_SHIFT) & ALIGN_MASK)) / ALIGN_MASK;
  }

  /** A hidden civilian looks at nothing and comes back facing ahead. */
  private forget(civilian: number): void {
    this.lookKind[civilian] = STIMULUS.none;
    this.lookSource[civilian] = -1;
    this.pendingLeft[civilian] = NO_PENDING;
    this.cooldown[civilian] = 0;
    for (let channel = 0; channel < EASED; channel++) this.angle[civilian * EASED + channel] = this.velocity[civilian * EASED + channel] = 0;
    this.headYaw[civilian] = this.headPitch[civilian] = this.torsoTwist[civilian] = 0;
  }

  private step(civilian: number, poses: CrowdPoses): void {
    if (poses.shown[civilian] === 0) {
      this.forget(civilian);
      return;
    }
    const dx = poses.x[civilian]! - this.senses.eyeX;
    const dz = poses.z[civilian]! - this.senses.eyeZ;
    if (dx * dx + dz * dz > GAZE_RANGE_M * GAZE_RANGE_M) return;
    this.know(civilian, poses.look[civilian]!);
    this.runClocks(civilian);
    if (((this.frame + civilian) & POLL_MASK) === 0) this.poll(civilian, poses);
    this.aim(civilian, poses);
    this.ease(civilian);
    this.writeOut(civilian);
  }

  /** The look waiting to start, the one held and the refusal after it run on by the frame. */
  private runClocks(civilian: number): void {
    const dt = this.dt;
    if (this.lookKind[civilian] !== STIMULUS.none) {
      this.holdLeft[civilian] = this.holdLeft[civilian]! - dt;
      if (this.holdLeft[civilian]! <= 0) {
        this.lookKind[civilian] = STIMULUS.none;
        this.lookSource[civilian] = -1;
        this.cooldown[civilian] = LOOK_COOLDOWN_S;
      }
    }
    this.cooldown[civilian] = Math.max(0, this.cooldown[civilian]! - dt);
    if (this.pendingLeft[civilian]! < 0) return;
    this.pendingLeft[civilian] = this.pendingLeft[civilian]! - dt;
    if (this.pendingLeft[civilian]! > 0) return;
    this.pendingLeft[civilian] = NO_PENDING;
    this.lookKind[civilian] = this.pendingKind[civilian]!;
    this.lookSource[civilian] = this.pendingSource[civilian]!;
    for (let axis = 0; axis < 3; axis++) this.lookPoint[civilian * 3 + axis] = this.pendingPoint[civilian * 3 + axis]!;
    this.holdLeft[civilian] = this.pendingHold[civilian]!;
    this.lookUrgency[civilian] = this.pendingUrgency[civilian]!;
  }

  /** Her poll: the best thing to look at, taken when it beats what she does or is about to (or her refusal) and, for a thing only seen, a line of sight reaches it. */
  private poll(civilian: number, poses: CrowdPoses): void {
    const pending = this.pendingLeft[civilian]! >= 0;
    const current = this.lookKind[civilian]!;
    const free = !pending && current === STIMULUS.none && this.cooldown[civilian]! <= 0;
    chooseLook(this, civilian, poses, free ? (poses.partner[civilian]! >= 0 ? PARTNER_GLANCE_FACTOR : 1) : 0);
    const kind = this.candidateKind;
    const source = this.candidateSource;
    if (kind === STIMULUS.none || (kind === current && source >= 0 && source === this.lookSource[civilian])) return;
    const urgency = this.scratch[SCRATCH.urgency]!;
    const held = pending ? this.pendingUrgency[civilian]! : this.lookUrgency[civilian]!;
    const wins = !pending && current === STIMULUS.none ? this.cooldown[civilian]! <= 0 || urgency >= COOLDOWN_BYPASS : urgency >= held + PREEMPT_MARGIN;
    if (!wins || !this.inSight(kind)) return;
    this.scratch[SCRATCH.hold] = KIND_HOLD_MIN[kind]! + (KIND_HOLD_SPAN[kind]! * hash16(civilian, this.frame ^ SALT.hold)) / HASH16;
    this.scratch[SCRATCH.delay] = HEAD_LATENCY_S;
    this.offer(civilian, kind, source);
  }

  /** Whether the candidate (in the scratch, from where she stands) is in her line of sight: heard kinds always are, near ones are, the rest ask the buildings within the frame's budget. */
  private inSight(kind: number): boolean {
    const lineOfSight = this.senses.lineOfSight;
    if (SEEN_ONLY[kind] === 0 || lineOfSight === null) return true;
    const s = this.scratch;
    const dx = s[SCRATCH.x]! - s[SCRATCH.ownX]!;
    const dz = s[SCRATCH.z]! - s[SCRATCH.ownZ]!;
    if (dx * dx + dz * dz < LOS_FREE_M * LOS_FREE_M) return true;
    if (this.losLeft <= 0) return false;
    this.losLeft--;
    return lineOfSight(s[SCRATCH.ownX]!, s[SCRATCH.ownZ]!, s[SCRATCH.x]!, s[SCRATCH.z]!);
  }

  /** The scratch's point is where her look is now: a car or a person followed as they move, else the point it was taken at. False: she looks at nothing. */
  private target(civilian: number, poses: CrowdPoses): boolean {
    const kind = this.lookKind[civilian]!;
    const source = this.lookSource[civilian]!;
    const s = this.scratch;
    const cars = this.senses.cars;
    if (kind === STIMULUS.none) return false;
    if ((kind === STIMULUS.car || kind === STIMULUS.siren) && source >= 0 && source < cars.length) {
      const at = cars[source]!.group.position;
      s[SCRATCH.x] = at.x;
      s[SCRATCH.y] = at.y + CAR_LOOK_HEIGHT_M;
      s[SCRATCH.z] = at.z;
    } else if (kind === STIMULUS.player && this.senses.player) {
      s[SCRATCH.x] = this.senses.playerX;
      s[SCRATCH.y] = this.senses.playerY;
      s[SCRATCH.z] = this.senses.playerZ;
    } else if (kind === STIMULUS.person && source >= 0 && source < poses.count && poses.shown[source] === 1) {
      this.atFace(source, poses);
    } else {
      s[SCRATCH.x] = this.lookPoint[civilian * 3]!;
      s[SCRATCH.y] = this.lookPoint[civilian * 3 + 1]!;
      s[SCRATCH.z] = this.lookPoint[civilian * 3 + 2]!;
    }
    return true;
  }

  /** The scratch's point is civilian `other`'s face. */
  private atFace(other: number, poses: CrowdPoses): void {
    this.scratch[SCRATCH.x] = poses.x[other]!;
    this.scratch[SCRATCH.y] = poses.feetY[other]! + FACE_HEIGHT_M;
    this.scratch[SCRATCH.z] = poses.z[other]!;
  }

  /** The goal angles: toward her look, else her partner's face, else ahead (a walker's eyes on the path a little down). */
  private aim(civilian: number, poses: CrowdPoses): void {
    if (this.target(civilian, poses)) {
      this.goalTowards(civilian, poses);
      return;
    }
    const partner = poses.partner[civilian]!;
    if (partner >= 0 && partner < poses.count && poses.shown[partner] === 1) {
      this.atFace(partner, poses);
      this.goalTowards(civilian, poses);
      return;
    }
    this.goal[YAW] = 0;
    this.goal[PITCH] = poses.speed[civilian]! > WALKING_ABOVE ? WALK_LOOK_DOWN : 0;
    this.goal[TORSO] = 0;
  }

  /** The goal angles toward the scratch's point from her eyes: the turn (wrapped, kept on the side her head is on past her reach, times her head-mover share), the torso's part past `TORSO_JOIN`, the pitch. */
  private goalTowards(civilian: number, poses: CrowdPoses): void {
    const s = this.scratch;
    const dx = s[SCRATCH.x]! - poses.x[civilian]!;
    const dz = s[SCRATCH.z]! - poses.z[civilian]!;
    const across = Math.sqrt(dx * dx + dz * dz);
    if (across < AIM_HELD_M) {
      for (let channel = 0; channel < EASED; channel++) this.goal[channel] = this.angle[civilian * EASED + channel]!;
      return;
    }
    const off = Math.atan2(dx, dz) - poses.yaw[civilian]!;
    let turn = off - TWO_PI * Math.floor((off + Math.PI) / TWO_PI);
    const reach = HEAD_YAW_LIMIT + TORSO_YAW_LIMIT;
    if (Math.abs(turn) > reach) turn = this.angle[civilian * EASED + YAW]! >= 0 ? reach : -reach;
    turn *= this.align[civilian]!;
    this.goal[YAW] = turn;
    this.goal[TORSO] = Math.sign(turn) * Math.min(TORSO_YAW_LIMIT, Math.max(0, Math.abs(turn) - TORSO_JOIN));
    const drop = Math.atan2(poses.feetY[civilian]! + EYE_HEIGHT_M - s[SCRATCH.y]!, across);
    this.goal[PITCH] = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, drop));
  }

  /** Each channel one frame along a critically damped ease to its goal (exact for any frame length), its speed and its step capped at the channel's rate. */
  private ease(civilian: number): void {
    const t = this.dt;
    for (let channel = 0; channel < EASED; channel++) {
      const at = civilian * EASED + channel;
      const from = this.angle[at]!;
      const omega = OMEGA[channel]!;
      const rate = RATE[channel]!;
      const offset = from - this.goal[channel]!;
      const lead = this.velocity[at]! + omega * offset;
      const decay = this.decay[channel]!;
      const eased = this.goal[channel]! + (offset + lead * t) * decay;
      this.velocity[at] = Math.max(-rate, Math.min(rate, (lead - omega * (offset + lead * t)) * decay));
      this.angle[at] = Math.max(from - rate * t, Math.min(from + rate * t, eased));
    }
  }

  /** The drawn angles: the head's turn from the torso within its limit, the torso's, and the pitch scaled by the cosine of the turn (reVC `LookInDirection`). */
  private writeOut(civilian: number): void {
    const at = civilian * EASED;
    const turn = this.angle[at + YAW]!;
    const torso = this.angle[at + TORSO]!;
    this.headYaw[civilian] = Math.max(-HEAD_YAW_LIMIT, Math.min(HEAD_YAW_LIMIT, turn - torso));
    this.torsoTwist[civilian] = torso;
    this.headPitch[civilian] = this.angle[at + PITCH]! * Math.cos(turn);
  }
}
