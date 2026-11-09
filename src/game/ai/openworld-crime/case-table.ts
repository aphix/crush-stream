import { COPS_PER_CASE, MAX_CASES, MAX_HELD, MAX_SUBJECTS, SUBJECTS_PER_CASE } from "./crime-constants.ts";

export const CASE_KIND = { crime: 1, fight: 2 } as const;
/** A fight case warns the fighters, then seizes the ones to arrest. */
export const CASE_PHASE = { free: 0, open: 1, warning: 2, seizing: 3 } as const;
/** Where a suspect stands in a case: free slot, still about their day (not yet running), running, hiding, a fighter a cop is closing on, in a cop's hands, or let go. */
export const SUBJECT_MODE = { free: 0, atLarge: 1, fleeing: 2, hidden: 3, seizing: 4, gripped: 5, spared: 6 } as const;

/** Every case and suspect the law holds, and the residents it keeps out of the drawn crowd: typed arrays sized once. A case owns subject slots `caseIndex * SUBJECTS_PER_CASE` and the next. */
export class CaseTable {
  readonly phase = new Uint8Array(MAX_CASES);
  readonly kind = new Uint8Array(MAX_CASES);
  /** The tick of the crime or fight the case answers. */
  readonly offenceTick = new Int32Array(MAX_CASES);
  readonly warnUntil = new Float64Array(MAX_CASES);
  /** 1 once a cop at the hiding door has searched (one draw per case). */
  readonly searched = new Uint8Array(MAX_CASES);
  /** Foot cop numbers per case, -1 for none; the last slot is the patrol car's cop. */
  readonly cops = new Int8Array(MAX_CASES * COPS_PER_CASE).fill(-1);

  readonly resident = new Int32Array(MAX_SUBJECTS).fill(-1);
  readonly mode = new Uint8Array(MAX_SUBJECTS);
  readonly since = new Float64Array(MAX_SUBJECTS);
  readonly fleeSpeed = new Float64Array(MAX_SUBJECTS);
  readonly hideNode = new Int32Array(MAX_SUBJECTS).fill(-1);
  /** The cop a suspect is in the hands of. */
  readonly holder = new Int8Array(MAX_SUBJECTS).fill(-1);
  /** A fighter who keeps attacking is taken down; the takedown is thrown once. */
  readonly forced = new Uint8Array(MAX_SUBJECTS);
  readonly tookDown = new Uint8Array(MAX_SUBJECTS);
  /** Where the suspect was last seen. */
  readonly spotX = new Float64Array(MAX_SUBJECTS);
  readonly spotZ = new Float64Array(MAX_SUBJECTS);

  /** Per resident: the subject slot they hold, -1 none; the crime and fight tick last taken up. */
  readonly subjectOf: Int32Array;
  readonly crimeHandled: Int32Array;
  readonly fightHandled: Int32Array;

  /** Residents kept hidden since a crowd second, until their next walk begins. */
  readonly heldResident = new Int32Array(MAX_HELD).fill(-1);
  readonly heldSince = new Float64Array(MAX_HELD);
  private heldNext = 0;

  constructor(residentCount: number) {
    this.subjectOf = new Int32Array(residentCount).fill(-1);
    this.crimeHandled = new Int32Array(residentCount).fill(-1);
    this.fightHandled = new Int32Array(residentCount).fill(-1);
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

  /** Keeps `resident` out of the drawn crowd from crowd second `seconds` until their next walk begins; the oldest hold is dropped when full. */
  hold(resident: number, seconds: number): void {
    this.heldResident[this.heldNext] = resident;
    this.heldSince[this.heldNext] = seconds;
    this.heldNext = (this.heldNext + 1) % MAX_HELD;
  }
}
