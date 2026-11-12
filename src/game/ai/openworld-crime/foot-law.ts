import { hypot2 } from "../../kernel/physics-core.js";
import type { FigureStrike } from "../../scenes/figure-strike.ts";
import type { OpenWorldMap, WalkGraph } from "../../world/openworld/walk-graph.ts";
import { tickAt } from "../civilians/civilian-clock.ts";
import { ARREST_PLAYER_RESIDENT, FIGHT_PLAYER, NEVER_TICK } from "../civilians/civilian-constants.ts";
import { PathFinder } from "../civilians/walk-path.ts";
import { CASE_KIND, CASE_PHASE, CaseTable, isHeldMode, SUBJECT_MODE } from "./case-table.ts";
import { BUST_REACH, CAR_COP, COP_DOWN_SECONDS, COP_SIGHT, JAYWALK_GIVE_UP_SECONDS, COPS_PER_CASE, CRIME_STEP_SECONDS, CRIME_STREAM, FIND_CHANCE, FLEE_GIVE_UP_SECONDS, FLEE_REPLAN_STEPS, FLEE_SPEED_MIN, FLEE_SPEED_SPAN, FOOT_COP_COUNT, FOOT_COPS_PER_CASE, GRIP_SECONDS, PATROL_COPS, HIDE_ARRIVE, HIDE_SEARCH_REACH, MAX_SUBJECTS, POLL_EVERY_STEPS, SEARCH_SECONDS, SUBJECTS_PER_CASE } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import { Arrests, stationOf, type ArrestCars } from "./arrests.ts";
import { FightRules } from "./fight-rules.ts";
import { CrossingWatch } from "./crossing-watch.ts";
import { PlayerLaw } from "./player-law.ts";
import { Flight } from "./flight.ts";
import { COP_MODE, FootCops } from "./foot-cops.ts";
import type { PatrolCars } from "./patrol-cars.ts";
import { FootWalkers } from "./foot-walkers.ts";
import type { CrossingSignals, FootArrestPorts, LawPorts, LawSenses, LineOfSight, OffenceSource, OtherCopsSee, Spot, Walk } from "./offence-source.ts";

/** What the patrol cars need of the cases: to hear of them, to be let go when their case no longer needs them, and the cars themselves (null: the law is on foot) for the arrested to be driven to the station in. */
interface LawHooks {
  opened(caseIndex: number, x: number, z: number): void;
  closed(caseIndex: number): void;
  cars(): PatrolCars | null;
  /** The cars an arrest rides in: the patrol cars, or on a client the host's (`ArrestRides`); null: none. */
  rides(): ArrestCars | null;
}

/**
 * The law on foot. Cops patrol the sidewalks; when the society holds a crime or a fight against someone (`OffenceSource`) the nearest free cops are called, run to the suspect (radio keeps them on
 * the suspect's trail), and a suspect who sees a cop (a clear sight line, not through a building) runs for a hiding place; a cop who reaches one lays hands on them and, the cuffs on, takes them to the police station, where the host's bust event is raised. Fighters get a warning
 * and a draw each whether they keep attacking: the ones who do are taken down. A free cop who sees a walker cross against the signal stops and takes them off the street. Nobody a car has run down is arrested. It advances on a fixed grid of crowd time, a pure function of (seed, society rows, clock), so peers agree.
 */
export class FootLaw {
  readonly walkers: FootWalkers;
  readonly cops: FootCops;
  readonly table: CaseTable;
  readonly stats = { cases: 0, busts: 0, takedowns: 0, lost: 0, jaywalkers: 0 };
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
  private readonly lineOfSight: LineOfSight | null;
  private readonly signals: CrossingSignals | null;
  private readonly crossings: CrossingWatch;
  private readonly otherCopsSee: OtherCopsSee | null;
  /** The player on foot under the law (host and solo only). */
  readonly player: PlayerLaw;
  /** The cuffed's walk to a patrol car and the station: the player's custody (`PlayerLaw`) takes it too. */
  readonly arrests: Arrests;
  private readonly fights: FightRules;
  private readonly walk: Walk = { x: 0, z: 0, dirX: 0, dirZ: 1 };
  private readonly spot: Spot = { x: 0, z: 0 };
  private readonly partnerSpot: Spot = { x: 0, z: 0 };

  constructor(map: OpenWorldMap, source: OffenceSource, ports: LawPorts, hooks: LawHooks, seed: number, senses: LawSenses, playerBustSeconds: number) {
    const finder = new PathFinder(map.graph);
    this.walkers = new FootWalkers(map.graph, FOOT_COP_COUNT + MAX_SUBJECTS, senses.lineOfSight);
    this.cops = new FootCops(this.walkers, map.graph, finder, seed);
    this.table = new CaseTable(source.residentCount);
    this.flight = new Flight(map, this.walkers, finder, this.table);
    this.graph = map.graph;
    this.source = source;
    this.ports = ports;
    this.hooks = hooks;
    this.seed = seed;
    this.lineOfSight = senses.lineOfSight;
    this.signals = senses.signals;
    this.crossings = new CrossingWatch(map.graph);
    this.otherCopsSee = senses.otherCopsSee;
    this.player = new PlayerLaw(this, this.crossings, senses.signals, playerBustSeconds);
    this.arrests = new Arrests(this.walkers, this.cops, this.table, map.graph, stationOf(map), {
      raise: (caseIndex, slot) => this.raiseArrest(caseIndex, slot),
      cars: () => hooks.rides(),
      rode: (slot, carIndex) => this.noteRide(slot, carIndex, true),
      alighted: (slot, carIndex) => this.noteRide(slot, carIndex, false),
    });
    this.fights = new FightRules(this.table, this.cops, this.walkers, source, seed, this.stats);
  }

  /** The foot walker of subject slot `slot`. */
  walkerOf(slot: number): number {
    return FOOT_COP_COUNT + slot;
  }

  /** Whether a foot cop out on the street within `range` m of (x, z) sees it. */
  copSees(x: number, z: number, range: number): boolean {
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
      if (this.cops.onStreet(cop) && this.cops.gapTo(cop, x, z) <= range && this.sees(cop, x, z)) return true;
    }
    return false;
  }

  /** Whether any cop, on foot or in a patrol car, within `COP_SIGHT` m of (x, z) sees it. */
  copSeesSpot(x: number, z: number): boolean {
    return this.copSees(x, z, COP_SIGHT) || (this.otherCopsSee?.(x, z, COP_SIGHT) ?? false);
  }

  /** The host's word to the engine about the player on foot in custody (`PlayerLaw`); null on a peer that raises no events. */
  get arrestPorts(): FootArrestPorts | null {
    return this.authority ? this.ports.footArrest : null;
  }

  /** Patrol car `carSlot`'s place in the engine's list of cars, -1 when the law has no cars. */
  carIndexOf(carSlot: number): number {
    return this.hooks.cars()?.carIndexOf(carSlot) ?? -1;
  }

  /** Whether nothing solid stands between cop `cop`'s eyes and a person at (x, z). */
  private sees(cop: number, x: number, z: number): boolean {
    return this.lineOfSight === null || this.lineOfSight(this.walkers.x[cop]!, this.walkers.z[cop]!, x, z);
  }

  /** Whether a cop of case `caseIndex` within `COP_SIGHT` m of (x, z) sees it. */
  private caseCopSees(caseIndex: number, x: number, z: number): boolean {
    for (let index = 0; index < COPS_PER_CASE; index++) {
      const cop = this.table.copAt(caseIndex, index);
      if (cop < 0 || !this.cops.onStreet(cop)) continue;
      if (this.cops.gapTo(cop, x, z) <= COP_SIGHT && this.sees(cop, x, z)) return true;
    }
    return false;
  }

  /** The takedowns thrown since the last call, oldest first: the engine throws them as figures. */
  takeStrikes(): readonly FigureStrike[] {
    return this.fights.takeStrikes();
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
    this.walkers.snapshot();
    this.stepIndex++;
    this.seconds = this.stepIndex * CRIME_STEP_SECONDS;
    if (this.stepIndex % POLL_EVERY_STEPS === 0) this.poll();
    for (let caseIndex = 0; caseIndex < this.table.phase.length; caseIndex++) {
      if (this.table.phase[caseIndex] !== CASE_PHASE.free) this.stepCase(caseIndex);
    }
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) this.cops.step(cop, this.stepIndex);
    this.arrests.step(this.seconds);
    this.releaseHeld();
  }

  /** A car ran cop `cop` down at crowd second `seconds`: he is off the street for `COP_DOWN_SECONDS`, out of his case, and a suspect in his hands walks free. */
  knockCop(cop: number, seconds: number): void {
    const { table } = this;
    for (let slot = 0; slot < table.mode.length; slot++) {
      const mode = table.mode[slot]!;
      if (table.holder[slot] === cop && (isHeldMode(mode) && mode !== SUBJECT_MODE.conveyed)) this.letGo(slot);
    }
    for (let caseIndex = 0; caseIndex < table.phase.length; caseIndex++) {
      for (let index = 0; index < COPS_PER_CASE; index++) if (table.copAt(caseIndex, index) === cop) table.setCop(caseIndex, index, -1);
    }
    this.cops.knockDown(cop, seconds + COP_DOWN_SECONDS);
  }

  /** The cop slot of case `caseIndex` the patrol car's cop fills, once the car has come. */
  carCopArrived(caseIndex: number, x: number, z: number): void {
    if (this.table.phase[caseIndex] === CASE_PHASE.free) return;
    this.cops.emerge(x, z, caseIndex);
    this.table.setCop(caseIndex, COPS_PER_CASE - 1, CAR_COP);
    this.table.carHere[caseIndex] = 1;
    this.table.carX[caseIndex] = x;
    this.table.carZ[caseIndex] = z;
  }

  private poll(): void {
    const tick = tickAt(this.seconds);
    const { source, table } = this;
    for (let resident = 0; resident < source.residentCount; resident++) {
      if (table.subjectOf[resident] !== -1 || !source.wanted(resident, tick)) continue;
      const spell = source.spellOf(resident);
      if (spell === table.handledSpell[resident] || !this.witnessed(resident, spell, tick)) continue;
      const brawling = source.fightTick(resident) !== NEVER_TICK && source.fightPartner(resident) >= 0;
      if (brawling ? this.openFight(resident, spell) : this.openCrime(resident, spell)) table.handledSpell[resident] = spell;
    }
    if (this.signals !== null) this.watchCrossings(this.signals);
    this.keepHomeCars();
    this.player.poll(this.seconds);
    for (let caseIndex = 0; caseIndex < table.phase.length; caseIndex++) {
      if (table.phase[caseIndex] !== CASE_PHASE.free) this.callCops(caseIndex);
    }
  }

  /** Each patrolling cop has his own patrol car, parked at the kerb nearest his beat's start (leased as the pool allows). */
  private keepHomeCars(): void {
    const cars = this.hooks.cars();
    if (cars === null) return;
    const { nodeX, nodeZ } = this.graph;
    for (let cop = 0; cop < PATROL_COPS; cop++) {
      const node = this.cops.homeNode(cop);
      cars.keepHome(cop, nodeX[node]!, nodeZ[node]!, this.seconds);
    }
  }

  /** Whether a cop saw the offence of wanted `resident` (who stands in sight of one now) or a witness's call about it has ended: the police do not come for what nobody has seen or told them of. */
  private witnessed(resident: number, spell: number, tick: number): boolean {
    const { source, table } = this;
    if (table.reportSpell[resident] !== spell) {
      const done = source.reportDoneTick(resident);
      if (done !== NEVER_TICK) {
        table.reportSpell[resident] = spell;
        table.reportDue[resident] = done;
      }
    }
    if (table.reportSpell[resident] === spell && tick >= table.reportDue[resident]!) return true;
    return source.standing(resident, this.seconds, this.spot) && this.copSeesSpot(this.spot.x, this.spot.z);
  }

  /** False when there is no room for the case yet (the poll tries again); true when it was taken up or can never be. */
  private openCrime(resident: number, spell: number): boolean {
    const caseIndex = this.table.freeCase();
    if (caseIndex < 0) return false;
    if (!this.source.standing(resident, this.seconds, this.spot)) return true;
    this.startCase(caseIndex, CASE_KIND.crime, spell);
    this.takeSubject(this.table.slotOf(caseIndex, 0), resident, this.spot);
    this.hooks.opened(caseIndex, this.spot.x, this.spot.z);
    if (this.source.fightPartner(resident) === FIGHT_PLAYER) this.player.fightKnown(this.seconds);
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

  /** A free case of `kind` for the wanted spell `spell`, opened with no suspect or cop: its index, -1 with no room. */
  beginCase(kind: number, spell: number): number {
    const caseIndex = this.table.freeCase();
    if (caseIndex >= 0) this.startCase(caseIndex, kind, spell);
    return caseIndex;
  }

  private startCase(caseIndex: number, kind: number, spell: number): void {
    const { table } = this;
    table.phase[caseIndex] = CASE_PHASE.open;
    table.kind[caseIndex] = kind;
    table.offenceTick[caseIndex] = spell;
    table.searched[caseIndex] = 0;
    table.carHere[caseIndex] = 0;
    for (let index = 0; index < COPS_PER_CASE; index++) table.setCop(caseIndex, index, -1);
    this.stats.cases++;
  }

  /** Takes up `resident` last seen at `spot`, running at a pace drawn from their own seed. */
  private takeSubject(slot: number, resident: number, spot: Spot): void {
    this.table.take(slot, resident, this.seconds, spot.x, spot.z);
    this.table.fleeSpeed[slot] = FLEE_SPEED_MIN + FLEE_SPEED_SPAN * crimeDraw(this.seed, CRIME_STREAM.flee, resident, 0);
  }

  /** The case's first subject's spot is where its foot cops are called to. */
  /** Every walker out on a crossing against the signal whom a free cop sees: a jaywalk case with that cop, once per walk. */
  private watchCrossings(signals: CrossingSignals): void {
    const { source, table, walk, crossings } = this;
    for (let resident = 0; resident < source.residentCount; resident++) {
      if (table.subjectOf[resident] !== -1 || source.knocked(resident) || !source.onStreet(resident, walk)) continue;
      const crossing = crossings.crossingOf(walk);
      if (crossing < 0 || !signals.againstSignal(walk.x, walk.z, crossings.dirX[crossing]!, crossings.dirZ[crossing]!, this.seconds)) continue;
      const walkBegan = source.legDepartSeconds(resident);
      if (table.jaywalkWalk[resident] === walkBegan) continue;
      const cop = this.copWhoSees(walk.x, walk.z);
      const caseIndex = table.freeCase();
      if (cop < 0 || caseIndex < 0) continue;
      table.jaywalkWalk[resident] = walkBegan;
      this.startCase(caseIndex, CASE_KIND.jaywalk, tickAt(this.seconds));
      this.takeSubject(table.slotOf(caseIndex, 0), resident, walk);
      this.cops.assign(cop, caseIndex);
      table.setCop(caseIndex, 0, cop);
    }
  }

  /** The patrolling cop nearest (x, z) within `COP_SIGHT` m who sees it, the lower number on a tie; -1 with none. */
  copWhoSees(x: number, z: number): number {
    let best = -1;
    let bestGap = COP_SIGHT;
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
      if (this.cops.mode[cop] !== COP_MODE.patrol || this.cops.caseOf[cop] !== -1) continue;
      const gap = this.cops.gapTo(cop, x, z);
      if (gap > bestGap || (gap === bestGap && best >= 0) || !this.sees(cop, x, z)) continue;
      bestGap = gap;
      best = cop;
    }
    return best;
  }

  /** A jaywalk case keeps the one cop who saw it, and a case with every suspect caught calls no more; the others call the nearest free ones. */
  private callCops(caseIndex: number): void {
    if (this.table.kind[caseIndex] === CASE_KIND.jaywalk || this.table.allCaught(caseIndex)) return;
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
    if (table.kind[caseIndex] === CASE_KIND.player) {
      this.player.step(caseIndex, this.seconds);
      return;
    }
    this.spareKnocked(caseIndex);
    if (!table.arresting(caseIndex) && this.offenceCleared(caseIndex)) {
      this.closeCase(caseIndex);
      return;
    }
    this.refreshSpots(caseIndex);
    this.aimCops(caseIndex);
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) this.stepSubject(caseIndex, table.slotOf(caseIndex, index));
    if (table.phase[caseIndex] === CASE_PHASE.free) return;
    if (table.kind[caseIndex] === CASE_KIND.fight) this.fights.step(caseIndex, this.seconds);
    if (!table.active(table.slotOf(caseIndex, 0)) && !table.active(table.slotOf(caseIndex, 1))) this.closeCase(caseIndex);
  }

  /** The society holds nothing against any suspect of the case any more (the host's bust was heard, or the spell passed). A fight that ends before the law is done with it goes on as a pursuit of the fighters still wanted. */
  private offenceCleared(caseIndex: number): boolean {
    const { table, source } = this;
    if (table.kind[caseIndex] === CASE_KIND.jaywalk) return !table.active(table.slotOf(caseIndex, 0));
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

  /** A suspect a car ran down is in hospital: they are let go (the society has them), never arrested for it. */
  private spareKnocked(caseIndex: number): void {
    const { table } = this;
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const slot = table.slotOf(caseIndex, index);
      if (table.active(slot) && this.source.knocked(table.resident[slot]!)) this.letGo(slot);
    }
  }

  /** The crowd ran down `resident` just now: a suspect of the law's is let go at once, as `spareKnocked` lets her go once the society has her; till then the law would draw her in her cop's hands again and the car would run her down every step. */
  spare(resident: number): void {
    const slot = this.table.subjectOf[resident] ?? -1;
    if (slot >= 0 && this.table.active(slot)) this.letGo(slot);
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
      if (cop < 0 || cops.mode[cop] === COP_MODE.grip || cops.mode[cop] === COP_MODE.escort) continue;
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
        if (this.seconds - this.table.since[slot]! >= GRIP_SECONDS) this.completeBust(caseIndex, slot);
        break;
      default:
    }
  }

  /** A suspect going about their day: a cop at arm's length takes them, a cop who has them in sight sends a criminal running. */
  private stepAtLarge(caseIndex: number, slot: number): void {
    const { table } = this;
    const kind = table.kind[caseIndex]!;
    if (kind === CASE_KIND.fight) return;
    if (kind === CASE_KIND.jaywalk && (this.seconds - table.since[slot]! > JAYWALK_GIVE_UP_SECONDS || !this.source.onStreet(table.resident[slot]!, this.walk))) {
      this.letGo(slot);
      return;
    }
    const cop = this.cops.nearestOfCase(this.table, caseIndex, table.spotX[slot]!, table.spotZ[slot]!);
    if (cop < 0) return;
    if (this.cops.nearestGap <= BUST_REACH) {
      this.placeAtSpot(slot);
      this.startGrip(slot, cop);
    } else if (kind === CASE_KIND.crime && this.caseCopSees(caseIndex, table.spotX[slot]!, table.spotZ[slot]!)) this.startFlee(caseIndex, slot);
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
      walkers.place(walker, this.graph.nodeX[hide]!, this.graph.nodeZ[hide]!);
      return;
    }
    if (!walkers.hasRoute(walker) || (this.stepIndex + slot) % FLEE_REPLAN_STEPS === 0) this.flight.plan(caseIndex, slot);
    walkers.advance(walker, table.fleeSpeed[slot]! * CRIME_STEP_SECONDS, CRIME_STEP_SECONDS);
    const cop = this.cops.nearestOfCase(this.table, caseIndex, walkers.x[walker]!, walkers.z[walker]!);
    if (cop >= 0 && this.cops.nearestGap <= BUST_REACH) this.startGrip(slot, cop);
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
    const cop = this.cops.nearestOfCase(this.table, caseIndex, table.spotX[slot]!, table.spotZ[slot]!);
    if (cop < 0 || this.cops.nearestGap > BUST_REACH) return;
    this.placeAtSpot(slot);
    if (table.forced[slot] === 1 && table.tookDown[slot] === 0) this.fights.takeDown(slot, cop);
    this.startGrip(slot, cop);
  }

  private placeAtSpot(slot: number): void {
    this.walkers.place(this.walkerOf(slot), this.table.spotX[slot]!, this.table.spotZ[slot]!);
  }

  private startGrip(slot: number, cop: number): void {
    this.arrests.grip(slot, cop, this.seconds);
  }

  /** The cuffs are on: the cop leads the suspect away (a fighter thrown down is taken off the street at once). The host's arrest is raised at the station where the map has one, else here. */
  private completeBust(caseIndex: number, slot: number): void {
    const resident = this.table.resident[slot]!;
    if (this.table.kind[caseIndex] === CASE_KIND.jaywalk) this.stats.jaywalkers++;
    else this.stats.busts++;
    const escorted = this.table.tookDown[slot] === 0;
    if (!escorted || !this.arrests.endsAtStation) this.raiseArrest(caseIndex, slot);
    if (escorted) {
      this.arrests.escort(caseIndex, slot, this.seconds);
      return;
    }
    this.table.hold(resident, this.seconds);
    this.table.free(slot);
  }

  /** The host's arrest of the suspect of subject slot `slot`: a jaywalker's or a bust; for the player on foot, the end of his custody. */
  private raiseArrest(caseIndex: number, slot: number): void {
    if (!this.authority) return;
    const resident = this.table.resident[slot]!;
    const kind = this.table.kind[caseIndex];
    if (kind === CASE_KIND.player) this.player.deliver(slot);
    else if (kind === CASE_KIND.jaywalk) this.ports.jaywalked(resident, this.seconds);
    else this.ports.bust(resident, this.seconds);
  }

  /** The host's word that the arrested of subject slot `slot` and her cop got into (`boarding`) or out of patrol car `carIndex`; the player on foot is named `ARREST_PLAYER_RESIDENT`. */
  private noteRide(slot: number, carIndex: number, boarding: boolean): void {
    if (!this.authority) return;
    const resident = this.table.isPlayerSlot(slot) ? ARREST_PLAYER_RESIDENT : this.table.resident[slot]!;
    if (boarding) this.ports.rode(resident, carIndex, this.seconds);
    else this.ports.alighted(resident, carIndex, this.seconds);
  }

  /** Patrol car `carSlot` has come to the station: its riders get out at its door. */
  carDelivered(carSlot: number): void {
    this.arrests.alight(carSlot, this.seconds);
  }

  /** The suspect walks on: no arrest, nobody kept off the street. The player on foot is set down where his cop stood with him. */
  private letGo(slot: number): void {
    this.stats.lost++;
    if (this.table.isPlayerSlot(slot)) this.player.deliver(slot);
    this.table.free(slot);
  }

  private lose(slot: number): void {
    this.stats.lost++;
    this.table.hold(this.table.resident[slot]!, this.seconds);
    this.table.free(slot);
  }

  /** Cops go back to patrol; suspects still out are held off the street; spared ones carry on. */
  closeCase(caseIndex: number): void {
    const { table } = this;
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const slot = table.slotOf(caseIndex, index);
      const mode = table.mode[slot]!;
      if (mode === SUBJECT_MODE.fleeing || mode === SUBJECT_MODE.hidden || mode === SUBJECT_MODE.gripped || isHeldMode(mode)) table.hold(table.resident[slot]!, this.seconds);
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
