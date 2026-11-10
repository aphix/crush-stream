import { PLACE_NAMES } from "../../world/openworld/openworld-programme.ts";
import { PLACE_KIND, type OpenWorldMap, type Place } from "../../world/openworld/walk-graph.ts";
import { NEVER_TICK } from "../civilians/civilian-constants.ts";
import { createCrowdPoses, type CrowdPoses } from "../civilians/crowd-poses.ts";
import { CRIME_HZ, FOOT_COP_COUNT } from "./crime-constants.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { CrimeScene, type CrimePorts } from "./crime-scene.ts";
import { FakeStreet } from "./crime-street.test-util.ts";
import type { LineOfSight, Spot, Walk } from "./offence-source.ts";

/** Nodes of the line city, 10 m apart from x = 0 to x = 120 on z = 0. */
export const LINE_NODES = 13;
export const NODE_SPACING = 10;
export const WEST_HIDE = 0;
export const EAST_HIDE = LINE_NODES - 1;
/** The street between these two corners (x = 60 to 70) is a zebra crossing. */
export const CROSSING_WEST_NODE = 6;
export const CROSSING_EAST_NODE = 7;
/** The corner a fixture's police station (when it has one) has its door at. */
export const STATION_NODE = 10;
/** Residents in the fixture society. */
export const RESIDENTS = 4;
/** A wanted spell that outlasts every row (ticks). */
export const FAR_TICK = 1_000_000;
/** Crowd seconds per fixture step. */
export const STEP_SECONDS = 1 / CRIME_HZ;

function placeAt(kind: Place["kind"], name: string, node: number): Place {
  const x = node * NODE_SPACING;
  return { kind, name, doorNode: node, doorX: x, doorZ: 0, yaw: 0, x, z: 8, width: 8, depth: 8, storeys: 2, style: "rowbrick", sector: "" };
}

/** One street of thirteen corners in a line with a hiding place at each end and one zebra crossing, and a police station at `STATION_NODE` when asked: the simplest city a flight can be read in. */
export function lineCity(withStation = false): OpenWorldMap {
  const nodeX = Float32Array.from({ length: LINE_NODES }, (_, node) => node * NODE_SPACING);
  const nodeZ = new Float32Array(LINE_NODES);
  const edgeStart = new Int32Array(LINE_NODES + 1);
  const edgeTo: number[] = [];
  const crossing: number[] = [];
  const isCrossing = (from: number, to: number): number => (Math.min(from, to) === CROSSING_WEST_NODE && Math.max(from, to) === CROSSING_EAST_NODE ? 1 : 0);
  for (let node = 0; node < LINE_NODES; node++) {
    for (const to of [node - 1, node + 1]) {
      if (to < 0 || to >= LINE_NODES) continue;
      edgeTo.push(to);
      crossing.push(isCrossing(node, to));
    }
    edgeStart[node + 1] = edgeTo.length;
  }
  const graph = { nodeX, nodeZ, edgeStart, edgeTo: Int32Array.from(edgeTo), edgeLength: new Float32Array(edgeTo.length).fill(NODE_SPACING), edgeCrossing: Uint8Array.from(crossing) };
  const places = [placeAt(PLACE_KIND.hide, "West alley", WEST_HIDE), placeAt(PLACE_KIND.hide, "East alley", EAST_HIDE)];
  if (withStation) places.push(placeAt(PLACE_KIND.work, PLACE_NAMES.policeStation, STATION_NODE));
  return { graph, places, portals: new Int32Array(0), halfX: 120, halfZ: 20 };
}

/** The society's rows as the law reads them, set by the row and cleared by the bust the way the brain clears them. */
export class FixtureOffences {
  readonly residentCount = RESIDENTS;
  readonly wantedUntil = new Int32Array(RESIDENTS);
  readonly fightAt = new Int32Array(RESIDENTS).fill(NEVER_TICK);
  readonly partner = new Int32Array(RESIDENTS).fill(-1);
  readonly x = new Float64Array(RESIDENTS);
  readonly present = new Uint8Array(RESIDENTS).fill(1);
  readonly departSeconds = new Float64Array(RESIDENTS);
  /** The tick each resident's offence is reported by (a witness's call ends then): `NEVER_TICK` while nobody phones it in. */
  readonly reportedAt = new Int32Array(RESIDENTS).fill(NEVER_TICK);
  /** Which way along the street each resident faces (+1 east, -1 west), and whether a car has run them down. */
  readonly facing = new Float64Array(RESIDENTS).fill(1);
  readonly hurt = new Uint8Array(RESIDENTS);

  wanted(resident: number, tick: number): boolean {
    return tick < this.wantedUntil[resident]!;
  }

  spellOf(resident: number): number {
    return this.wantedUntil[resident]!;
  }

  fightTick(resident: number): number {
    return this.fightAt[resident]!;
  }

  fightPartner(resident: number): number {
    return this.partner[resident]!;
  }

  standing(resident: number, _seconds: number, out: Spot): boolean {
    out.x = this.x[resident]!;
    out.z = 0;
    return this.present[resident] === 1;
  }

  legDepartSeconds(resident: number): number {
    return this.departSeconds[resident]!;
  }

  onStreet(resident: number, out: Walk): boolean {
    out.x = this.x[resident]!;
    out.z = 0;
    out.dirX = this.facing[resident]!;
    out.dirZ = 0;
    return this.present[resident] === 1;
  }

  knocked(resident: number): boolean {
    return this.hurt[resident] === 1;
  }

  /** A car runs the resident down: in hospital, off the street. */
  knockDown(resident: number): void {
    this.hurt[resident] = 1;
    this.present[resident] = 0;
  }

  /** A crime the society holds from now: reported by a witness at once, unless `unreported`. */
  commitCrime(resident: number, unreported = false): void {
    this.wantedUntil[resident] = FAR_TICK;
    this.reportedAt[resident] = unreported ? NEVER_TICK : 0;
  }

  reportDoneTick(resident: number): number {
    return this.reportedAt[resident]!;
  }

  /** A fight between two residents (or with the player: `second` `FIGHT_PLAYER`), reported by a witness at once unless `unreported`. */
  startFight(first: number, second: number, unreported = false): void {
    this.reportedAt[first] = unreported ? NEVER_TICK : 0;
    if (second >= 0) this.reportedAt[second] = unreported ? NEVER_TICK : 0;
    this.wantedUntil[first] = FAR_TICK;
    this.fightAt[first] = 0;
    this.partner[first] = second;
    if (second < 0) return;
    this.wantedUntil[second] = FAR_TICK + 1;
    this.fightAt[second] = 0;
    this.partner[second] = first;
  }

  endFight(first: number, second: number): void {
    this.fightAt[first] = NEVER_TICK;
    this.fightAt[second] = NEVER_TICK;
    this.partner[first] = -1;
    this.partner[second] = -1;
  }

  /** What the society does with the host's bust: nothing is held against them, their fight is over. */
  applyBust(resident: number): void {
    const other = this.partner[resident]!;
    this.wantedUntil[resident] = 0;
    this.fightAt[resident] = NEVER_TICK;
    this.partner[resident] = -1;
    if (other < 0) return;
    this.fightAt[other] = NEVER_TICK;
    this.partner[other] = -1;
  }
}

export type Bust = { resident: number; seconds: number };

/** Signals that show every crossing one way: `against` true, a walker on any crossing crosses against them. */
export class FixtureSignals {
  against = false;

  againstSignal(): boolean {
    return this.against;
  }
}

export type Harness = {
  scene: CrimeScene;
  offences: FixtureOffences;
  poses: CrowdPoses;
  busts: Bust[];
  jaywalks: Bust[];
  /** Foot cops the host's hit test ran down (cop number and crowd second), and the engine's cars it tests. */
  copDowns: Bust[];
  /** The crowd seconds the player on foot was busted at. */
  footBusts: number[];
  cars: DeformableCar[];
  signals: FixtureSignals;
  playerBusts: number[];
  street: FakeStreet | null;
  now: number;
  authority: boolean;
};

/** A building standing across the street between these x (m): it blocks every sight line that passes it. */
export type Wall = { minX: number; maxX: number };

export type HarnessOptions = { seed?: number; withCars?: boolean; authority?: boolean; wall?: Wall; station?: boolean };

/** Sight lines along the line city past `wall`. */
function sightPast(wall: Wall): LineOfSight {
  return (ax, _az, bx) => Math.max(ax, bx) <= wall.minX || Math.min(ax, bx) >= wall.maxX;
}

/** A scene on the line city whose foot cops stand at `copX` (patrol cop number by number; the rest far west), the host's bust applied to the fixture society. */
export function harness(copX: readonly number[], options: HarnessOptions = {}): Harness {
  const offences = new FixtureOffences();
  const busts: Bust[] = [];
  const jaywalks: Bust[] = [];
  const copDowns: Bust[] = [];
  const footBusts: number[] = [];
  const signals = new FixtureSignals();
  const playerBusts: number[] = [];
  const street = options.withCars ? new FakeStreet() : null;
  const ports: CrimePorts = {
    bust: (resident, seconds) => {
      busts.push({ resident, seconds });
      offences.applyBust(resident);
    },
    jaywalked: (resident, seconds) => void jaywalks.push({ resident, seconds }),
    copDown: (cop, seconds) => void copDowns.push({ resident: cop, seconds }),
    footBusted: (seconds) => void footBusts.push(seconds),
    signals,
    playerBusted: (carIndex) => void playerBusts.push(carIndex),
    cars: street,
    obstacles: null,
    playerBustSeconds: 12,
    lineOfSight: options.wall === undefined ? null : sightPast(options.wall),
  };
  const scene = new CrimeScene(lineCity(options.station ?? false), offences, ports, options.seed ?? 7);
  for (let cop = 0; cop < FOOT_COP_COUNT - 1; cop++) scene.foot.walkers.place(cop, copX[cop] ?? 0, 0);
  return { scene, offences, poses: createCrowdPoses(RESIDENTS), busts, jaywalks, copDowns, footBusts, cars: [], signals, playerBusts, street, now: 0, authority: options.authority ?? true };
}

/** Runs the harness `seconds` more: each step the crowd's poses are written where the society stands the residents (the crowd's own step), the street's cars drive, then the law steps. */
export function runFor(harnessed: Harness, seconds: number): void {
  const steps = Math.round(seconds * CRIME_HZ);
  for (let step = 0; step < steps; step++) {
    harnessed.now = Math.round((harnessed.now + STEP_SECONDS) * CRIME_HZ) / CRIME_HZ;
    for (let resident = 0; resident < RESIDENTS; resident++) {
      harnessed.poses.shown[resident] = harnessed.offences.present[resident]!;
      harnessed.poses.x[resident] = harnessed.offences.x[resident]!;
      harnessed.poses.z[resident] = 0;
    }
    harnessed.street?.step(STEP_SECONDS);
    harnessed.scene.step(harnessed.now, harnessed.authority, harnessed.poses, harnessed.cars);
  }
}

/** The residents the host busted, in the order of their numbers, comma-joined: one scalar for a row to read. */
export function bustedResidents(harnessed: Harness): string {
  return harnessed.busts
    .map((bust) => bust.resident)
    .sort((first, second) => first - second)
    .join(",");
}

/** Runs the harness until `done` or `seconds` more have passed, a grid step at a time: a row reads the moment something happens, not what is left of it later. */
export function runUntil(harnessed: Harness, seconds: number, done: () => boolean): void {
  const steps = Math.round(seconds * CRIME_HZ);
  for (let step = 0; step < steps && !done(); step++) runFor(harnessed, STEP_SECONDS);
}

/** Where a foot walker stands, for a row to read. */
export function footX(harnessed: Harness, walker: number): number {
  return harnessed.scene.foot.walkers.x[walker]!;
}

/** The first seed in 1..400 whose draw for (stream, resident, spell) is under (`below` true) or at least (false) the chance. */
export function seedWhere(draw: (seed: number) => number, chance: number, below: boolean): number {
  for (let seed = 1; seed <= 400; seed++) if (draw(seed) < chance === below) return seed;
  throw new Error("no seed in 1..400 draws that way");
}

const FNV_PRIME = 16777619;
const FNV_OFFSET = 2166136261;
/** Millimetres: a walker's place is compared to this. */
const MILLIMETRES = 1000;

/** One number for where every walker stands and what every suspect is doing: a row compares runs by it, not by deep compares. */
export function digestOf(harnessed: Harness): number {
  const { walkers, table } = harnessed.scene.foot;
  let hash = FNV_OFFSET;
  for (let walker = 0; walker < walkers.x.length; walker++) {
    hash = Math.imul(hash ^ Math.round(walkers.x[walker]! * MILLIMETRES), FNV_PRIME);
    hash = Math.imul(hash ^ Math.round(walkers.z[walker]! * MILLIMETRES), FNV_PRIME);
  }
  for (let slot = 0; slot < table.mode.length; slot++) hash = Math.imul(hash ^ table.mode[slot]!, FNV_PRIME);
  return hash >>> 0;
}

/** Runs `seconds` a second at a time and folds the digest of every second into one number. */
export function traceOf(harnessed: Harness, seconds: number): number {
  let trace = FNV_OFFSET;
  for (let second = 0; second < seconds; second++) {
    runFor(harnessed, 1);
    trace = Math.imul(trace ^ digestOf(harnessed), FNV_PRIME);
  }
  return trace >>> 0;
}
