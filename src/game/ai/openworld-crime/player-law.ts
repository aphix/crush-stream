import { tickAt } from "../civilians/civilian-clock.ts";
import { CASE_KIND, SUBJECT_MODE } from "./case-table.ts";
import { CRIME_STEP_SECONDS, COPS_PER_CASE, FOOT_HOLD_REACH, FOOT_HOLD_SPEED, PLAYER_CHASE_GIVE_UP_SECONDS } from "./crime-constants.ts";
import type { CrossingWatch } from "./crossing-watch.ts";
import type { FootLaw } from "./foot-law.ts";
import type { CrossingSignals, FootBody, Walk } from "./offence-source.ts";

/**
 * The player on foot under the law, like a resident but with no row or drawing of the law's (his walker is where he is): an offence a cop sees, or a fight he started, sets the foot cops on him, and one beside him while
 * he stands (or creeps, under `FOOT_HOLD_SPEED`) runs the bust hold as a driver's does. A full hold puts him in that cop's custody (`arrest`). Only the peer whose walker it is judges him (`FootBody.present`).
 */
export class PlayerLaw {
  readonly body: FootBody = { present: false, x: 0, z: 0, dirX: 0, dirZ: 1, speed: 0 };
  private readonly law: FootLaw;
  private readonly crossings: CrossingWatch;
  private readonly signals: CrossingSignals | null;
  private readonly bustSeconds: number;
  private readonly walk: Walk = { x: 0, z: 0, dirX: 0, dirZ: 1 };
  private caseIndex = -1;
  private since = 0;
  private heldFor = 0;
  /** The crossing walks he has begun, and the one he was stopped on (one walk across is stopped once). */
  private onCrossing = false;
  private walks = 0;
  private stoppedWalk = -1;
  /** Whether a cop has him in custody (his case's first subject slot runs `Arrests`), and whether the engine has been told a patrol car has him aboard. */
  private arrested = false;
  private taken = false;

  constructor(law: FootLaw, crossings: CrossingWatch, signals: CrossingSignals | null, bustSeconds: number) {
    this.law = law;
    this.crossings = crossings;
    this.signals = signals;
    this.bustSeconds = bustSeconds;
  }

  /** Where the player on foot stands now, from the engine; `present` false while he is in a car or is not this peer's. */
  set(present: boolean, x: number, z: number, dirX: number, dirZ: number, speed: number): void {
    const { body } = this;
    body.present = present;
    body.x = x;
    body.z = z;
    body.dirX = dirX;
    body.dirZ = dirZ;
    body.speed = speed;
  }

  /** Whether a chase of him is open. */
  get chasing(): boolean {
    return this.caseIndex >= 0;
  }

  /** Twice a second: a walk across a crossing against the signal a free cop sees is an offence; so is the walk that began since he left the last one. */
  poll(seconds: number): void {
    const { body } = this;
    if (!body.present) return;
    this.walk.x = body.x;
    this.walk.z = body.z;
    this.walk.dirX = body.dirX;
    this.walk.dirZ = body.dirZ;
    const crossing = this.crossings.crossingOf(this.walk);
    if (crossing < 0) {
      this.onCrossing = false;
      return;
    }
    if (!this.onCrossing) this.walks++;
    this.onCrossing = true;
    if (this.caseIndex >= 0 || this.signals === null || this.stoppedWalk === this.walks) return;
    if (!this.signals.againstSignal(body.x, body.z, this.crossings.dirX[crossing]!, this.crossings.dirZ[crossing]!, seconds)) return;
    const cop = this.law.copWhoSees(body.x, body.z);
    if (cop >= 0 && this.open(seconds, cop)) this.stoppedWalk = this.walks;
  }

  /** He shoved someone at crowd second `seconds`: a cop who sees it comes for him. */
  shoved(seconds: number): void {
    const { body } = this;
    if (!body.present || this.caseIndex >= 0 || !this.law.copSeesSpot(body.x, body.z)) return;
    this.open(seconds, this.law.cops.nearestFree(body.x, body.z));
  }

  /** A fight he started has been seen or reported: the cops come for him as for the one he fought. */
  fightKnown(seconds: number): void {
    const { body } = this;
    if (!body.present || this.caseIndex >= 0) return;
    this.open(seconds, this.law.cops.nearestFree(body.x, body.z));
  }

  /** One grid step of his chase `caseIndex`: the cops aim where he is and the hold runs while one stands beside him and he is slow; it ends in his arrest, his escape or his getting into a car. In custody: the cop's lead of him. */
  step(caseIndex: number, seconds: number): void {
    const { body } = this;
    const { table, cops } = this.law;
    if (this.arrested) {
      this.stepCustody(table.slotOf(caseIndex, 0));
      return;
    }
    if (!body.present || seconds - this.since > PLAYER_CHASE_GIVE_UP_SECONDS) {
      this.close();
      return;
    }
    const slot = table.slotOf(caseIndex, 0);
    table.spotX[slot] = body.x;
    table.spotZ[slot] = body.z;
    let nearest = Infinity;
    let nearestCop = -1;
    for (let index = 0; index < COPS_PER_CASE; index++) {
      const cop = table.copAt(caseIndex, index);
      if (cop < 0 || !cops.onStreet(cop)) continue;
      cops.aimX[cop] = body.x;
      cops.aimZ[cop] = body.z;
      const gap = cops.gapTo(cop, body.x, body.z);
      if (gap >= nearest) continue;
      nearest = gap;
      nearestCop = cop;
    }
    this.heldFor = nearest <= FOOT_HOLD_REACH && body.speed < FOOT_HOLD_SPEED ? this.heldFor + CRIME_STEP_SECONDS : 0;
    if (this.heldFor < this.bustSeconds) return;
    this.arrest(caseIndex, slot, nearestCop, seconds);
  }

  /** Held the whole hold by cop `cop`: he leads the player to a patrol car and the station as he leads a suspect, and the engine hears it. */
  private arrest(caseIndex: number, slot: number, cop: number, seconds: number): void {
    const { table, stats, arrests, arrestPorts } = this.law;
    stats.busts++;
    arrestPorts?.busted(seconds);
    this.arrested = true;
    this.heldFor = 0;
    table.holder[slot] = cop;
    table.carOf[slot] = -1;
    table.tookDown[slot] = 0;
    arrests.escort(caseIndex, slot, seconds);
  }

  /** Once a grid step in custody: the engine is told where his cop leads him, then that a patrol car has him aboard; the case ends once the law has set him down. */
  private stepCustody(slot: number): void {
    const { table, walkers, arrestPorts } = this.law;
    const mode = table.mode[slot]!;
    if (mode === SUBJECT_MODE.free) {
      this.close();
      return;
    }
    if (mode !== SUBJECT_MODE.conveyed) {
      const walker = this.law.walkerOf(slot);
      arrestPorts?.led(walkers.x[walker]!, walkers.z[walker]!);
      return;
    }
    if (this.taken) return;
    this.taken = true;
    arrestPorts?.taken(this.law.carIndexOf(table.carOf[slot]!));
  }

  /** His custody is over (the patrol car brought him to the station, the cop walked him to its door, or a car ran the cop down): the engine sets him down where his cop stood with him. */
  deliver(slot: number): void {
    const { walkers, arrestPorts } = this.law;
    const walker = this.law.walkerOf(slot);
    arrestPorts?.delivered(walkers.x[walker]!, walkers.z[walker]!, walkers.yaw[walker]!);
  }

  /** The chase as the pursuit strip shows it: the cops after him and the hold run so far; false with no chase open. */
  chaseOf(out: { cops: number; hold: number; left: number }): boolean {
    if (this.caseIndex < 0 || this.arrested) return false;
    const { table, cops } = this.law;
    let count = 0;
    for (let index = 0; index < COPS_PER_CASE; index++) {
      const cop = table.copAt(this.caseIndex, index);
      if (cop >= 0 && cops.onStreet(cop)) count++;
    }
    out.cops = Math.max(1, count);
    out.hold = Math.min(1, this.heldFor / this.bustSeconds);
    out.left = Math.max(0, this.bustSeconds - this.heldFor);
    return true;
  }

  /** Opens his chase with cop `cop` (-1: the nearest free one comes with the call): false with no room or no cop free. */
  private open(seconds: number, cop: number): boolean {
    const caseIndex = this.law.beginCase(CASE_KIND.player, tickAt(seconds));
    if (caseIndex < 0) return false;
    const { table, cops } = this.law;
    const slot = table.slotOf(caseIndex, 0);
    table.spotX[slot] = this.body.x;
    table.spotZ[slot] = this.body.z;
    this.caseIndex = caseIndex;
    this.since = seconds;
    this.heldFor = 0;
    if (cop >= 0) {
      cops.assign(cop, caseIndex);
      table.setCop(caseIndex, 0, cop);
    }
    return true;
  }

  private close(): void {
    const caseIndex = this.caseIndex;
    this.caseIndex = -1;
    this.heldFor = 0;
    this.arrested = false;
    this.taken = false;
    this.law.closeCase(caseIndex);
  }
}
