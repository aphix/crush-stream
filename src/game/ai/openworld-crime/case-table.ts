import { COPS_PER_CASE, MAX_CASES, MAX_HELD, MAX_SUBJECTS, SUBJECTS_PER_CASE } from "./crime-constants.ts";

/** A crime or a fight the society holds against someone, a walk across a crossing against the signal a cop saw (the law's own, no society event), or the player on foot chased for one (no suspect slot: `PlayerLaw` keeps it). */
export const CASE_KIND = { crime: 1, fight: 2, jaywalk: 3, player: 4 } as const;
/** A fight case warns the fighters, then seizes the ones to arrest. */
export const CASE_PHASE = { free: 0, open: 1, warning: 2, seizing: 3 } as const;
/** Where a suspect stands in a case: free slot, still about their day (not yet running), running, hiding, a fighter a cop is closing on, in a cop's hands, let go, cuffed and led away, or cuffed and driven to the station in the case's patrol car. */
export const SUBJECT_MODE = { free: 0, atLarge: 1, fleeing: 2, hidden: 3, seizing: 4, gripped: 5, spared: 6, escorted: 7, conveyed: 8 } as const;
/** Where a cuffed suspect is led: along the street a few metres (a map with no police station), to the case's patrol car, or on foot to the station's door. */
export const ESCORT_TO = { street: 0, car: 1, station: 2 } as const;

/** Every case and suspect the law holds, and the residents it keeps out of the drawn crowd: typed arrays sized once. A case owns subject slots `caseIndex * SUBJECTS_PER_CASE` and the next. */
export class CaseTable {
  readonly phase = new Uint8Array(MAX_CASES);
  readonly kind = new Uint8Array(MAX_CASES);
  /** The wanted spell the case answers (the first suspect's): its draws key on it. */
  readonly offenceTick = new Int32Array(MAX_CASES);
  readonly warnUntil = new Float64Array(MAX_CASES);
  /** 1 once a cop at the hiding door has searched (one draw per case). */
  readonly searched = new Uint8Array(MAX_CASES);
  /** Whether the case's patrol car has come, and where its cop stepped out (a cuffed suspect is led to it). */
  readonly carHere = new Uint8Array(MAX_CASES);
  readonly carX = new Float64Array(MAX_CASES);
  readonly carZ = new Float64Array(MAX_CASES);
  /** Foot cop numbers per case, -1 for none; the last slot is the patrol car's cop. */
  readonly cops = new Int8Array(MAX_CASES * COPS_PER_CASE).fill(-1);

  readonly resident = new Int32Array(MAX_SUBJECTS).fill(-1);
  readonly mode = new Uint8Array(MAX_SUBJECTS);
  readonly since = new Float64Array(MAX_SUBJECTS);
  readonly fleeSpeed = new Float64Array(MAX_SUBJECTS);
  readonly hideNode = new Int32Array(MAX_SUBJECTS).fill(-1);
  /** The corner a suspect with no hiding place runs for, kept until reached or a cop is near it (-1: none yet). */
  readonly fleeNode = new Int32Array(MAX_SUBJECTS).fill(-1);
  /** Where each led-away suspect's cop is leading her (`ESCORT_TO`). */
  readonly escortTo = new Uint8Array(MAX_SUBJECTS);
  /** The cop a suspect is in the hands of. */
  readonly holder = new Int8Array(MAX_SUBJECTS).fill(-1);
  /** A fighter who keeps attacking is taken down; the takedown is thrown once. */
  readonly forced = new Uint8Array(MAX_SUBJECTS);
  readonly tookDown = new Uint8Array(MAX_SUBJECTS);
  /** Where the suspect was last seen. */
  readonly spotX = new Float64Array(MAX_SUBJECTS);
  readonly spotZ = new Float64Array(MAX_SUBJECTS);

  /** Per resident: the subject slot they hold, -1 none; the wanted spell last taken up. */
  readonly subjectOf: Int32Array;
  readonly handledSpell: Int32Array;
  /** Per resident: the crowd second the walk began on which they were last stopped for jaywalking, so one walk is stopped once. */
  readonly jaywalkWalk: Float64Array;
  /** Per resident: the wanted spell a witness's call was seen for, and the tick that call ends: the case opens then. */
  readonly reportSpell: Int32Array;
  readonly reportDue: Int32Array;

  /** Residents kept hidden since a crowd second, until their next walk begins. */
  readonly heldResident = new Int32Array(MAX_HELD).fill(-1);
  readonly heldSince = new Float64Array(MAX_HELD);
  private heldNext = 0;

  constructor(residentCount: number) {
    this.subjectOf = new Int32Array(residentCount).fill(-1);
    this.handledSpell = new Int32Array(residentCount).fill(-1);
    this.jaywalkWalk = new Float64Array(residentCount).fill(-1);
    this.reportSpell = new Int32Array(residentCount).fill(-1);
    this.reportDue = new Int32Array(residentCount);
  }

  freeCase(): number {
    for (let caseIndex = 0; caseIndex < MAX_CASES; caseIndex++) if (this.phase[caseIndex] === CASE_PHASE.free) return caseIndex;
    return -1;
  }

  /** Takes subject slot `slot` for `resident`, an at-large suspect last seen at (x, z). */
  take(slot: number, resident: number, seconds: number, x: number, z: number): void {
    this.resident[slot] = resident;
    this.mode[slot] = SUBJECT_MODE.atLarge;
    this.since[slot] = seconds;
    this.hideNode[slot] = -1;
    this.fleeNode[slot] = -1;
    this.holder[slot] = -1;
    this.forced[slot] = 0;
    this.tookDown[slot] = 0;
    this.spotX[slot] = x;
    this.spotZ[slot] = z;
    this.subjectOf[resident] = slot;
  }

  free(slot: number): void {
    const resident = this.resident[slot]!;
    if (resident >= 0) this.subjectOf[resident] = -1;
    this.resident[slot] = -1;
    this.mode[slot] = SUBJECT_MODE.free;
  }

  /** Subject slot `index` (0 .. SUBJECTS_PER_CASE - 1) of case `caseIndex`. */
  slotOf(caseIndex: number, index: number): number {
    return caseIndex * SUBJECTS_PER_CASE + index;
  }

  /** Cop slot `index` of case `caseIndex`: the foot cop's number or -1. */
  copAt(caseIndex: number, index: number): number {
    return this.cops[caseIndex * COPS_PER_CASE + index]!;
  }

  setCop(caseIndex: number, index: number, cop: number): void {
    this.cops[caseIndex * COPS_PER_CASE + index] = cop;
  }

  /** Whether a subject slot still has a suspect to deal with (running, hiding, being seized or held). */
  active(slot: number): boolean {
    const mode = this.mode[slot]!;
    return mode !== SUBJECT_MODE.free && mode !== SUBJECT_MODE.spared;
  }

  /** Whether a suspect of case `caseIndex` is in a cop's hands, being led away or driven off: the arrest runs to its end whatever the society hears meanwhile. */
  arresting(caseIndex: number): boolean {
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const mode = this.mode[this.slotOf(caseIndex, index)]!;
      if (mode === SUBJECT_MODE.gripped || mode === SUBJECT_MODE.escorted || mode === SUBJECT_MODE.conveyed) return true;
    }
    return false;
  }

  /** Whether case `caseIndex` has suspects and every one is in a cop's hands or being led or driven away, none left to catch (so its cops are not called for it and the ones not holding anyone go back); a case with no suspect slot taken (the player's) has none to catch and is not. */
  allCaught(caseIndex: number): boolean {
    let held = false;
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const mode = this.mode[this.slotOf(caseIndex, index)]!;
      if (mode === SUBJECT_MODE.atLarge || mode === SUBJECT_MODE.fleeing || mode === SUBJECT_MODE.hidden || mode === SUBJECT_MODE.seizing) return false;
      held = held || mode === SUBJECT_MODE.gripped || mode === SUBJECT_MODE.escorted || mode === SUBJECT_MODE.conveyed;
    }
    return held;
  }

  /** Keeps `resident` out of the drawn crowd from crowd second `seconds` until their next walk begins; the oldest hold is dropped when full. */
  hold(resident: number, seconds: number): void {
    this.heldResident[this.heldNext] = resident;
    this.heldSince[this.heldNext] = seconds;
    this.heldNext = (this.heldNext + 1) % MAX_HELD;
  }
}
