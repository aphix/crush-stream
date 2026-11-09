import { tickAt } from "../civilians/civilian-clock.ts";
import { CASE_KIND } from "./case-table.ts";
import { CRIME_STEP_SECONDS, COPS_PER_CASE, FOOT_HOLD_REACH, FOOT_HOLD_SPEED, PLAYER_CHASE_GIVE_UP_SECONDS } from "./crime-constants.ts";
import type { CrossingWatch } from "./crossing-watch.ts";
import type { FootLaw } from "./foot-law.ts";
import type { CrossingSignals, FootBody, Walk } from "./offence-source.ts";

/**
 * The player on foot under the law, like a resident: crossing against the signal where a cop sees him, shoving someone a cop sees (or who turns on him, reported) makes him wanted: foot cops are called and
 * run at him wherever he goes, and a cop beside him while he stands (or creeps, under `FOOT_HOLD_SPEED`) holds him: the bust hold runs as a driver's does in a car, resets when he moves off, and ends in `footBusted`
 * when it is full. He is not a resident (no row of the society's, no drawing of the law's): his own walker is where he is. Only the peer whose walker it is judges him (`FootBody.present`).
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

  /** One grid step of his chase `caseIndex`: the cops aim where he is, the hold runs while one stands beside him and he is slow, and it ends in the bust, his escape or his getting into a car. */
  step(caseIndex: number, seconds: number): void {
    const { body } = this;
    const { table, cops } = this.law;
    if (!body.present || seconds - this.since > PLAYER_CHASE_GIVE_UP_SECONDS) {
      this.close();
      return;
    }
    const slot = table.slotOf(caseIndex, 0);
    table.spotX[slot] = body.x;
    table.spotZ[slot] = body.z;
    let nearest = Infinity;
    for (let index = 0; index < COPS_PER_CASE; index++) {
      const cop = table.copAt(caseIndex, index);
      if (cop < 0 || !cops.onStreet(cop)) continue;
      cops.aimX[cop] = body.x;
      cops.aimZ[cop] = body.z;
      nearest = Math.min(nearest, cops.gapTo(cop, body.x, body.z));
    }
    this.heldFor = nearest <= FOOT_HOLD_REACH && body.speed < FOOT_HOLD_SPEED ? this.heldFor + CRIME_STEP_SECONDS : 0;
    if (this.heldFor < this.bustSeconds) return;
    this.law.footBusted();
    this.close();
  }

  /** The chase as the pursuit strip shows it: the cops after him and the hold run so far; false with no chase open. */
  chaseOf(out: { cops: number; hold: number; left: number }): boolean {
    if (this.caseIndex < 0) return false;
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
    this.law.closeCase(caseIndex);
  }
}
