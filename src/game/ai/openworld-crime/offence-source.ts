/** A point on the ground. */
export type Spot = { x: number; z: number };
/** A person on the street: where, and which way they face (a unit vector on the ground). */
export type Walk = { x: number; z: number; dirX: number; dirZ: number };
/** Whether a person standing at (ax, az) sees one at (bx, bz): nothing solid between their eyes. */
export type LineOfSight = (ax: number, az: number, bx: number, bz: number) => boolean;

/** What the cops perceive with: the sight lines between people (null: open ground, every line clear) and the crossings' signals (null: no signals, nobody jaywalks). */
export type LawSenses = { lineOfSight: LineOfSight | null; signals: CrossingSignals | null };

/** The signals the zebra crossings obey. */
export interface CrossingSignals {
  /** Whether a walker on the crossing at (x, z) whose line runs along (dirX, dirZ) crosses at crowd time `seconds` while the cars it crosses have green. */
  againstSignal(x: number, z: number, dirX: number, dirZ: number, seconds: number): boolean;
}

/** What the law reads of the society, per resident: kept apart from the brain's row layout so the chase can be driven by a fixture. */
export interface OffenceSource {
  readonly residentCount: number;
  /** Whether the society holds an offence (a crime, a fight) against the resident at `tick`: not busted, not past its spell. */
  wanted(resident: number, tick: number): boolean;
  /** Names the resident's wanted spell: the tick it ends at, so a new offence has a new one. */
  spellOf(resident: number): number;
  /** The tick the resident's fight began, `NEVER_TICK` when none; and who they fight (-1: nobody, or the player). */
  fightTick(resident: number): number;
  fightPartner(resident: number): number;
  /** Where the resident stands at `seconds` (on the street, or at their place's door); false when nowhere. */
  standing(resident: number, seconds: number, out: Spot): boolean;
  /** The crowd second the resident's current walk began. */
  legDepartSeconds(resident: number): number;
  /** Where the resident is drawn on the street now and which way they face; false when they are not out on it. */
  onStreet(resident: number, out: Walk): boolean;
  /** Run down by a car and in hospital: nobody is arrested for anything while so. */
  knocked(resident: number): boolean;
}

/** What the law does to the world: the host's events, called only with authority. */
export interface LawPorts {
  bust(resident: number, seconds: number): void;
  /** A walker taken off the street for crossing against the signal. */
  jaywalked(resident: number, seconds: number): void;
  /** Foot cop `cop` run down by a car. */
  copDown(cop: number, seconds: number): void;
}
