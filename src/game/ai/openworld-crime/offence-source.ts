/** A point on the ground. */
export type Spot = { x: number; z: number };

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
}

/** What the law does to the world: the host's bust event, called only with authority. */
export interface LawPorts {
  bust(resident: number, seconds: number): void;
}
