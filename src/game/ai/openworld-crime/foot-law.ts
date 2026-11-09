import { hypot2 } from "../../kernel/physics-core.js";
import { blankStrike, type FigureStrike } from "../../scenes/figure-strike.ts";
import { activeGround } from "../../world/ground.ts";
import type { OpenWorldMap, WalkGraph } from "../../world/openworld/walk-graph.ts";
import { tickAt } from "../civilians/civilian-clock.ts";
import { NEVER_TICK } from "../civilians/civilian-constants.ts";
import { PathFinder } from "../civilians/walk-path.ts";
import { CASE_KIND, CASE_PHASE, CaseTable, SUBJECT_MODE } from "./case-table.ts";
import { BUST_REACH, CAR_COP, COP_SIGHT, COPS_PER_CASE, CRIME_STEP_SECONDS, CRIME_STREAM, FIGHT_WARN_REACH, FIND_CHANCE, FLEE_GIVE_UP_SECONDS, FLEE_REPLAN_STEPS, FLEE_SPEED_MIN, FLEE_SPEED_SPAN, FOOT_COP_COUNT, FOOT_COPS_PER_CASE, GRIP_SECONDS, HIDE_ARRIVE, HIDE_SEARCH_REACH, MAX_SUBJECTS, POLL_EVERY_STEPS, RESIST_CHANCE, SEARCH_SECONDS, SUBJECTS_PER_CASE, TAKEDOWN_LIFT, TAKEDOWN_SPEED, TAKEDOWN_TUMBLE, WARN_SECONDS } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import { Flight } from "./flight.ts";
import { COP_MODE, FootCops } from "./foot-cops.ts";
import { FootWalkers } from "./foot-walkers.ts";
import type { LawPorts, OffenceSource, Spot } from "./offence-source.ts";

/** What the patrol cars need to hear of the cases. */
interface LawHooks {
  opened(caseIndex: number, x: number, z: number): void;
  closed(caseIndex: number): void;
}

/**
 * The law on foot. Cops patrol the sidewalks; when the society holds a crime or a fight against someone (`OffenceSource`) the nearest free cops are called, run to the suspect (radio keeps them on
 * the suspect's trail), and a suspect who sees a cop runs for a hiding place; a cop who reaches one lays hands on them and, the cuffs on, the host's bust event is raised. Fighters get a warning
 * and a draw each whether they keep attacking: the ones who do are taken down. It advances on a fixed grid of crowd time, a pure function of (seed, society rows, clock), so peers agree.
 */
export class FootLaw {
  readonly walkers: FootWalkers;
  readonly cops: FootCops;
  readonly table: CaseTable;
  readonly stats = { cases: 0, busts: 0, takedowns: 0, lost: 0 };
  seconds = 0;
  /** Whether this peer raises the host's events. */
  authority = false;
  private stepIndex = 0;
  private readonly source: OffenceSource;
  private readonly ports: LawPorts;
  private readonly hooks: LawHooks;
  private readonly seed: number;
  private readonly flight: Flight;
  private readonly graph: WalkGraph;
  private readonly spot: Spot = { x: 0, z: 0 };
  private readonly partnerSpot: Spot = { x: 0, z: 0 };
  private strikes: FigureStrike[] = [];
  private nearestGap = Infinity;

  constructor(map: OpenWorldMap, source: OffenceSource, ports: LawPorts, hooks: LawHooks, seed: number) {
    const finder = new PathFinder(map.graph);
    this.walkers = new FootWalkers(map.graph, FOOT_COP_COUNT + MAX_SUBJECTS);
    this.cops = new FootCops(this.walkers, map.graph, finder, seed);
    this.table = new CaseTable(source.residentCount);
    this.flight = new Flight(map, this.walkers, finder, this.table);
    this.graph = map.graph;
    this.source = source;
    this.ports = ports;
    this.hooks = hooks;
    this.seed = seed;
  }

  /** The foot walker of subject slot `slot`. */
  walkerOf(slot: number): number {
    return FOOT_COP_COUNT + slot;
  }

  /** Whether a foot cop out on the street stands within `range` m of (x, z). */
  copWithin(x: number, z: number, range: number): boolean {
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
      if (this.cops.mode[cop] !== COP_MODE.off && this.cops.gapTo(cop, x, z) <= range) return true;
    }
    return false;
  }

  /** The takedowns thrown since the last call, oldest first: the engine throws them as figures. */
  takeStrikes(): readonly FigureStrike[] {
    if (this.strikes.length === 0) return this.strikes;
    const out = this.strikes;
    this.strikes = [];
    return out;
  }

  /** Grid steps taken so far. */
  get steps(): number {
    return this.stepIndex;
  }

  /** Skips to grid step `stepIndex` without simulating the steps between (a client whose clock jumped). */
  fastForward(stepIndex: number): void {
    this.stepIndex = stepIndex;
    this.seconds = stepIndex * CRIME_STEP_SECONDS;
  }

  /** One grid step. */
  advance(): void {
    this.stepIndex++;
    this.seconds = this.stepIndex * CRIME_STEP_SECONDS;
    if (this.stepIndex % POLL_EVERY_STEPS === 0) this.poll();
    for (let caseIndex = 0; caseIndex < this.table.phase.length; caseIndex++) {
      if (this.table.phase[caseIndex] !== CASE_PHASE.free) this.stepCase(caseIndex);
    }
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) this.cops.step(cop, this.stepIndex);
    this.releaseHeld();
  }

  /** The cop slot of case `caseIndex` the patrol car's cop fills, once the car has come. */
  carCopArrived(caseIndex: number, x: number, z: number): void {
    if (this.table.phase[caseIndex] === CASE_PHASE.free) return;
    this.cops.emerge(x, z, caseIndex);
    this.table.setCop(caseIndex, COPS_PER_CASE - 1, CAR_COP);
  }

  private poll(): void {
    const tick = tickAt(this.seconds);
    const { source, table } = this;
    for (let resident = 0; resident < source.residentCount; resident++) {
      if (table.subjectOf[resident] !== -1 || !source.wanted(resident, tick)) continue;
      const spell = source.spellOf(resident);
      if (spell === table.handledSpell[resident]) continue;
      const brawling = source.fightTick(resident) !== NEVER_TICK && source.fightPartner(resident) >= 0;
      if (brawling ? this.openFight(resident, spell) : this.openCrime(resident, spell)) table.handledSpell[resident] = spell;
    }
    for (let caseIndex = 0; caseIndex < table.phase.length; caseIndex++) {
      if (table.phase[caseIndex] !== CASE_PHASE.free) this.callCops(caseIndex);
    }
  }

  /** False when there is no room for the case yet (the poll tries again); true when it was taken up or can never be. */
  private openCrime(resident: number, spell: number): boolean {
    const caseIndex = this.table.freeCase();
    if (caseIndex < 0) return false;
    if (!this.source.standing(resident, this.seconds, this.spot)) return true;
    this.startCase(caseIndex, CASE_KIND.crime, spell);
    this.takeSubject(this.table.slotOf(caseIndex, 0), resident, this.spot);
    this.hooks.opened(caseIndex, this.spot.x, this.spot.z);
    return true;
  }

  /** As `openCrime`, for a fight: both fighters are taken up in one case. */
  private openFight(resident: number, spell: number): boolean {
    const partner = this.source.fightPartner(resident);
    const { table } = this;
    const caseIndex = table.freeCase();
    if (caseIndex < 0 || table.subjectOf[partner] !== -1) return false;
    table.handledSpell[partner] = this.source.spellOf(partner);
    if (!this.source.standing(resident, this.seconds, this.spot) || !this.source.standing(partner, this.seconds, this.partnerSpot)) return true;
    this.startCase(caseIndex, CASE_KIND.fight, spell);
    this.takeSubject(table.slotOf(caseIndex, 0), resident, this.spot);
    this.takeSubject(table.slotOf(caseIndex, 1), partner, this.partnerSpot);
    this.hooks.opened(caseIndex, this.spot.x, this.spot.z);
    return true;
  }

  private startCase(caseIndex: number, kind: number, spell: number): void {
    const { table } = this;
    table.phase[caseIndex] = CASE_PHASE.open;
    table.kind[caseIndex] = kind;
    table.offenceTick[caseIndex] = spell;
    table.searched[caseIndex] = 0;
    for (let index = 0; index < COPS_PER_CASE; index++) table.setCop(caseIndex, index, -1);
    this.stats.cases++;
  }

  /** Takes up `resident` last seen at `spot`, running at a pace drawn from their own seed. */
  private takeSubject(slot: number, resident: number, spot: Spot): void {
    this.table.take(slot, resident, this.seconds, spot.x, spot.z);
    this.table.fleeSpeed[slot] = FLEE_SPEED_MIN + FLEE_SPEED_SPAN * crimeDraw(this.seed, CRIME_STREAM.flee, resident, 0);
  }

  /** The case's first subject's spot is where its foot cops are called to. */
  private callCops(caseIndex: number): void {
    const focus = this.table.slotOf(caseIndex, 0);
    for (let index = 0; index < FOOT_COPS_PER_CASE; index++) {
      if (this.table.copAt(caseIndex, index) >= 0) continue;
      const cop = this.cops.nearestFree(this.table.spotX[focus]!, this.table.spotZ[focus]!);
      if (cop < 0) return;
      this.cops.assign(cop, caseIndex);
      this.table.setCop(caseIndex, index, cop);
    }
  }

  private stepCase(caseIndex: number): void {
    const { table } = this;
    if (this.offenceCleared(caseIndex)) {
      this.closeCase(caseIndex);
      return;
    }
    this.refreshSpots(caseIndex);
    this.aimCops(caseIndex);
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) this.stepSubject(caseIndex, table.slotOf(caseIndex, index));
    if (table.phase[caseIndex] === CASE_PHASE.free) return;
    if (table.kind[caseIndex] === CASE_KIND.fight) this.stepFight(caseIndex);
    if (!table.active(table.slotOf(caseIndex, 0)) && !table.active(table.slotOf(caseIndex, 1))) this.closeCase(caseIndex);
  }

  /** The society holds nothing against any suspect of the case any more (the host's bust was heard, or the spell passed). A fight that ends before the law is done with it goes on as a pursuit of the fighters still wanted. */
  private offenceCleared(caseIndex: number): boolean {
    const { table, source } = this;
    const tick = tickAt(this.seconds);
    let brawling = false;
    let wanted = false;
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const resident = table.resident[table.slotOf(caseIndex, index)]!;
      if (resident < 0) continue;
      brawling = brawling || source.fightTick(resident) !== NEVER_TICK;
      wanted = wanted || source.wanted(resident, tick);
    }
    if (table.kind[caseIndex] === CASE_KIND.fight && !brawling && wanted) table.kind[caseIndex] = CASE_KIND.crime;
    return !wanted && !brawling;
  }

  private refreshSpots(caseIndex: number): void {
    const { table } = this;
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const slot = table.slotOf(caseIndex, index);
      const mode = table.mode[slot]!;
      if (mode !== SUBJECT_MODE.atLarge && mode !== SUBJECT_MODE.seizing) continue;
      if (!this.source.standing(table.resident[slot]!, this.seconds, this.spot)) continue;
      table.spotX[slot] = this.spot.x;
      table.spotZ[slot] = this.spot.z;
    }
  }

  /** Each cop of the case is aimed at a suspect still to deal with, the cops sharing them out by their place. */
  private aimCops(caseIndex: number): void {
    const { table, cops, walkers } = this;
    const { nodeX, nodeZ } = this.graph;
    for (let index = 0; index < COPS_PER_CASE; index++) {
      const cop = table.copAt(caseIndex, index);
      if (cop < 0 || cops.mode[cop] === COP_MODE.grip) continue;
      for (let offset = 0; offset < SUBJECTS_PER_CASE; offset++) {
        const slot = table.slotOf(caseIndex, (index + offset) % SUBJECTS_PER_CASE);
        if (!table.active(slot)) continue;
        const mode = table.mode[slot]!;
        const hide = table.hideNode[slot]!;
        if (mode === SUBJECT_MODE.fleeing || mode === SUBJECT_MODE.gripped) {
          cops.aimX[cop] = walkers.x[this.walkerOf(slot)]!;
          cops.aimZ[cop] = walkers.z[this.walkerOf(slot)]!;
        } else if (mode === SUBJECT_MODE.hidden && hide >= 0) {
          cops.aimX[cop] = nodeX[hide]!;
          cops.aimZ[cop] = nodeZ[hide]!;
        } else {
          cops.aimX[cop] = table.spotX[slot]!;
          cops.aimZ[cop] = table.spotZ[slot]!;
        }
        break;
      }
    }
  }

  private stepSubject(caseIndex: number, slot: number): void {
    switch (this.table.mode[slot]) {
      case SUBJECT_MODE.atLarge:
        this.stepAtLarge(caseIndex, slot);
        break;
      case SUBJECT_MODE.fleeing:
        this.stepFleeing(caseIndex, slot);
        break;
      case SUBJECT_MODE.hidden:
        this.stepHidden(caseIndex, slot);
        break;
      case SUBJECT_MODE.seizing:
        this.stepSeizing(caseIndex, slot);
        break;
      case SUBJECT_MODE.gripped:
        if (this.seconds - this.table.since[slot]! >= GRIP_SECONDS) this.completeBust(slot);
        break;
      default:
    }
  }

  /** A suspect going about their day: a cop at arm's length takes them, a cop in sight sends a criminal running. */
  private stepAtLarge(caseIndex: number, slot: number): void {
    const { table } = this;
    if (table.kind[caseIndex] !== CASE_KIND.crime) return;
    const cop = this.nearestCop(caseIndex, table.spotX[slot]!, table.spotZ[slot]!);
    if (cop < 0) return;
    if (this.nearestGap <= BUST_REACH) {
      this.placeAtSpot(slot);
      this.startGrip(slot, cop);
    } else if (this.nearestGap <= COP_SIGHT) this.startFlee(caseIndex, slot);
  }

  private startFlee(caseIndex: number, slot: number): void {
    this.placeAtSpot(slot);
    this.table.mode[slot] = SUBJECT_MODE.fleeing;
    this.table.since[slot] = this.seconds;
    this.flight.plan(caseIndex, slot);
  }

  private stepFleeing(caseIndex: number, slot: number): void {
    const { table, walkers } = this;
    const walker = this.walkerOf(slot);
    const hide = table.hideNode[slot]!;
    if (hide >= 0 && hypot2(this.graph.nodeX[hide]! - walkers.x[walker]!, this.graph.nodeZ[hide]! - walkers.z[walker]!) <= HIDE_ARRIVE) {
      table.mode[slot] = SUBJECT_MODE.hidden;
      table.since[slot] = this.seconds;
      walkers.halt(walker);
      walkers.speed[walker] = 0;
      return;
    }
    if (!walkers.hasRoute(walker) || (this.stepIndex + slot) % FLEE_REPLAN_STEPS === 0) this.flight.plan(caseIndex, slot);
    walkers.advance(walker, table.fleeSpeed[slot]! * CRIME_STEP_SECONDS, CRIME_STEP_SECONDS);
    const cop = this.nearestCop(caseIndex, walkers.x[walker]!, walkers.z[walker]!);
    if (cop >= 0 && this.nearestGap <= BUST_REACH) this.startGrip(slot, cop);
    else if (this.seconds - table.since[slot]! > FLEE_GIVE_UP_SECONDS) this.lose(slot);
  }

  /** A hider is searched for once, when the first cop reaches the door; a find brings them out into that cop's hands, else the cops give up after `SEARCH_SECONDS`. */
  private stepHidden(caseIndex: number, slot: number): void {
    const { table, walkers } = this;
    const walker = this.walkerOf(slot);
    if (table.searched[caseIndex] === 0) {
      for (let index = 0; index < COPS_PER_CASE; index++) {
        const cop = table.copAt(caseIndex, index);
        if (cop < 0 || this.cops.gapTo(cop, walkers.x[walker]!, walkers.z[walker]!) > HIDE_SEARCH_REACH) continue;
        table.searched[caseIndex] = 1;
        if (crimeDraw(this.seed, CRIME_STREAM.find, table.resident[slot]!, table.offenceTick[caseIndex]!) < FIND_CHANCE) {
          this.startGrip(slot, cop);
          return;
        }
        break;
      }
    }
    if (this.seconds - table.since[slot]! >= SEARCH_SECONDS) this.lose(slot);
  }

  /** A fighter picked for arrest: the cop comes to them; one who keeps attacking is taken down at contact. */
  private stepSeizing(caseIndex: number, slot: number): void {
    const { table } = this;
    const cop = this.nearestCop(caseIndex, table.spotX[slot]!, table.spotZ[slot]!);
    if (cop < 0 || this.nearestGap > BUST_REACH) return;
    this.placeAtSpot(slot);
    if (table.forced[slot] === 1 && table.tookDown[slot] === 0) this.takeDown(slot, cop);
    this.startGrip(slot, cop);
  }

  /** The fight: a cop near it warns the fighters; when the warning is up each fighter's draw says whether they stopped. The instigator is arrested either way, the other only if they kept attacking. */
  private stepFight(caseIndex: number): void {
    const { table } = this;
    if (table.phase[caseIndex] === CASE_PHASE.open) {
      if (this.copNearFight(caseIndex)) {
        table.phase[caseIndex] = CASE_PHASE.warning;
        table.warnUntil[caseIndex] = this.seconds + WARN_SECONDS;
      }
      return;
    }
    if (table.phase[caseIndex] !== CASE_PHASE.warning || this.seconds < table.warnUntil[caseIndex]!) return;
    table.phase[caseIndex] = CASE_PHASE.seizing;
    const instigator = this.instigatorSlot(caseIndex);
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const slot = table.slotOf(caseIndex, index);
      if (!table.active(slot)) continue;
      const keepsAttacking = crimeDraw(this.seed, CRIME_STREAM.resist, table.resident[slot]!, table.offenceTick[caseIndex]!) < RESIST_CHANCE;
      table.forced[slot] = keepsAttacking ? 1 : 0;
      table.mode[slot] = keepsAttacking || slot === instigator ? SUBJECT_MODE.seizing : SUBJECT_MODE.spared;
    }
  }

  private copNearFight(caseIndex: number): boolean {
    const { table } = this;
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const slot = table.slotOf(caseIndex, index);
      if (!table.active(slot)) continue;
      const cop = this.nearestCop(caseIndex, table.spotX[slot]!, table.spotZ[slot]!);
      if (cop >= 0 && this.nearestGap <= FIGHT_WARN_REACH) return true;
    }
    return false;
  }

  /** The fighter who began it: the earlier fight tick, the lower resident on a tie. */
  private instigatorSlot(caseIndex: number): number {
    const { table, source } = this;
    const first = table.slotOf(caseIndex, 0);
    const second = table.slotOf(caseIndex, 1);
    const firstTick = source.fightTick(table.resident[first]!);
    const secondTick = source.fightTick(table.resident[second]!);
    return firstTick < secondTick || (firstTick === secondTick && table.resident[first]! < table.resident[second]!) ? first : second;
  }

  /** The cop of the case nearest (x, z) (the lower number on a tie), its gap left in `nearestGap`; -1 with none. */
  private nearestCop(caseIndex: number, x: number, z: number): number {
    let best = -1;
    this.nearestGap = Infinity;
    for (let index = 0; index < COPS_PER_CASE; index++) {
      const cop = this.table.copAt(caseIndex, index);
      if (cop < 0 || this.cops.mode[cop] === COP_MODE.off) continue;
      const gap = this.cops.gapTo(cop, x, z);
      if (gap >= this.nearestGap) continue;
      this.nearestGap = gap;
      best = cop;
    }
    return best;
  }

  private placeAtSpot(slot: number): void {
    this.walkers.place(this.walkerOf(slot), this.table.spotX[slot]!, this.table.spotZ[slot]!);
  }

  private startGrip(slot: number, cop: number): void {
    const walker = this.walkerOf(slot);
    this.table.mode[slot] = SUBJECT_MODE.gripped;
    this.table.since[slot] = this.seconds;
    this.table.holder[slot] = cop;
    this.walkers.halt(walker);
    this.walkers.speed[walker] = 0;
    this.walkers.face(walker, this.walkers.x[cop]!, this.walkers.z[cop]!);
    this.cops.grip(cop);
    this.cops.aimX[cop] = this.walkers.x[walker]!;
    this.cops.aimZ[cop] = this.walkers.z[walker]!;
  }

  /** A fighter thrown to the ground by the cop who reached them: pushed away from the cop, lifted and tumbled. */
  private takeDown(slot: number, cop: number): void {
    const { table, walkers } = this;
    const x = table.spotX[slot]!;
    const z = table.spotZ[slot]!;
    const push = hypot2(x - walkers.x[cop]!, z - walkers.z[cop]!);
    const dirX = push > 0 ? (x - walkers.x[cop]!) / push : 0;
    const dirZ = push > 0 ? (z - walkers.z[cop]!) / push : 1;
    const strike = blankStrike();
    strike.guard = table.resident[slot]!;
    strike.car = -1;
    strike.x = Math.fround(x);
    strike.y = Math.fround(activeGround().heightAt(x, z));
    strike.z = Math.fround(z);
    strike.faceX = Math.fround(-dirX);
    strike.faceZ = Math.fround(-dirZ);
    strike.vx = Math.fround(dirX * TAKEDOWN_SPEED);
    strike.vy = Math.fround(TAKEDOWN_LIFT);
    strike.vz = Math.fround(dirZ * TAKEDOWN_SPEED);
    strike.wx = Math.fround(-dirZ * TAKEDOWN_TUMBLE);
    strike.wz = Math.fround(dirX * TAKEDOWN_TUMBLE);
    this.strikes.push(strike);
    table.tookDown[slot] = 1;
    this.stats.takedowns++;
  }

  /** The cuffs are on: the host raises the bust, every peer lets the suspect go from the street. */
  private completeBust(slot: number): void {
    const resident = this.table.resident[slot]!;
    this.stats.busts++;
    if (this.authority) this.ports.bust(resident, this.seconds);
    this.table.hold(resident, this.seconds);
    this.table.free(slot);
  }

  private lose(slot: number): void {
    this.stats.lost++;
    this.table.hold(this.table.resident[slot]!, this.seconds);
    this.table.free(slot);
  }

  /** Cops go back to patrol; suspects still out are held off the street; spared ones carry on. */
  private closeCase(caseIndex: number): void {
    const { table } = this;
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const slot = table.slotOf(caseIndex, index);
      const mode = table.mode[slot]!;
      if (mode === SUBJECT_MODE.fleeing || mode === SUBJECT_MODE.hidden || mode === SUBJECT_MODE.gripped) table.hold(table.resident[slot]!, this.seconds);
      table.free(slot);
    }
    for (let index = 0; index < COPS_PER_CASE; index++) {
      const cop = table.copAt(caseIndex, index);
      if (cop >= 0) this.cops.release(cop);
      table.setCop(caseIndex, index, -1);
    }
    table.phase[caseIndex] = CASE_PHASE.free;
    this.hooks.closed(caseIndex);
  }

  /** A held resident is shown again once a walk begins that started after the hold. */
  private releaseHeld(): void {
    const { table, source } = this;
    for (let at = 0; at < table.heldResident.length; at++) {
      const resident = table.heldResident[at]!;
      if (resident >= 0 && source.legDepartSeconds(resident) >= table.heldSince[at]!) table.heldResident[at] = -1;
    }
  }
}
