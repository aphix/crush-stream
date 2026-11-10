import { hypot2 } from "../../kernel/physics-core.js";
import { blankStrike, type FigureStrike } from "../../scenes/figure-strike.ts";
import { activeGround } from "../../world/ground.ts";
import { CASE_PHASE, SUBJECT_MODE, type CaseTable } from "./case-table.ts";
import { CRIME_STREAM, FIGHT_WARN_REACH, RESIST_CHANCE, SUBJECTS_PER_CASE, TAKEDOWN_LIFT, TAKEDOWN_SPEED, TAKEDOWN_TUMBLE, WARN_SECONDS } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import type { FootCops } from "./foot-cops.ts";
import type { FootWalkers } from "./foot-walkers.ts";
import type { OffenceSource } from "./offence-source.ts";

/**
 * How the law ends a fight (docs/OPEN_WORLD.md): a cop within `FIGHT_WARN_REACH` of a fighter warns them; when the warning is up each fighter's seeded draw says whether they stopped. The instigator is
 * arrested either way, the other only if they kept attacking, and one who kept attacking is thrown to the ground by the cop who reaches them (`takeDown`, a figure the engine throws).
 */
export class FightRules {
  private strikes: FigureStrike[] = [];
  private readonly table: CaseTable;
  private readonly cops: FootCops;
  private readonly walkers: FootWalkers;
  private readonly source: OffenceSource;
  private readonly seed: number;
  private readonly stats: { takedowns: number };

  /** `stats`: the law's counters, whose `takedowns` this counts. */
  constructor(table: CaseTable, cops: FootCops, walkers: FootWalkers, source: OffenceSource, seed: number, stats: { takedowns: number }) {
    this.stats = stats;
    this.table = table;
    this.cops = cops;
    this.walkers = walkers;
    this.source = source;
    this.seed = seed;
  }

  /** The takedowns thrown since the last call, oldest first. */
  takeStrikes(): readonly FigureStrike[] {
    if (this.strikes.length === 0) return this.strikes;
    const out = this.strikes;
    this.strikes = [];
    return out;
  }

  /** One grid step of fight case `caseIndex` at crowd second `seconds`: the phase it is in moves on. */
  step(caseIndex: number, seconds: number): void {
    const { table } = this;
    if (table.phase[caseIndex] === CASE_PHASE.open) {
      if (this.copNearFight(caseIndex)) {
        table.phase[caseIndex] = CASE_PHASE.warning;
        table.warnUntil[caseIndex] = seconds + WARN_SECONDS;
      }
      return;
    }
    if (table.phase[caseIndex] !== CASE_PHASE.warning || seconds < table.warnUntil[caseIndex]!) return;
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

  /** A fighter thrown to the ground by the cop who reached them: pushed away from the cop, lifted and tumbled. */
  takeDown(slot: number, cop: number): void {
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

  private copNearFight(caseIndex: number): boolean {
    const { table, cops } = this;
    for (let index = 0; index < SUBJECTS_PER_CASE; index++) {
      const slot = table.slotOf(caseIndex, index);
      if (!table.active(slot)) continue;
      const cop = cops.nearestOfCase(table, caseIndex, table.spotX[slot]!, table.spotZ[slot]!);
      if (cop >= 0 && cops.nearestGap <= FIGHT_WARN_REACH) return true;
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
}
