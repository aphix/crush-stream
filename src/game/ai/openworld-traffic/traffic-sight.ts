/** What traffic asks of the open world's sight field (`present/openworld-sight.ts`, which satisfies this shape; the ai layer cannot name it). */
export type TrafficSight = {
  /** Seconds a thing stays drawn after no eye saw it. */
  readonly hideGrace: number;
  /** Reserves `count` consecutive ids for this caller; returns the first. */
  claim(count: number): number;
  /** Whether any local eye sees a body of `radius` m at (x, z); stamps the id as seen when so. */
  observe(id: number, x: number, z: number, radius: number): boolean;
  /** Seconds since `id` was last seen (0 before it was ever observed). */
  unseenFor(id: number): number;
  reset(id: number): void;
  /** Gives back the ids `first` to `first + count - 1` of a claim, for the next claim to reuse. */
  release(first: number, count: number): void;
  /** Whether a player's car is within `radius` m of (x, z). */
  near(x: number, z: number, radius: number): boolean;
};

/** Residents on a drive leg right now, filled by the society each tick: `count` entries of resident, the place they set out from, the place they drive to and the crowd second they are due there. */
type DriveLegs = { count: number; resident: Int32Array; fromPlace: Int32Array; toPlace: Int32Array; arriveSeconds: Float64Array };

/** Residents' cars standing at a place's kerb (those not on a drive leg), filled by the society each tick. */
export type ParkedResidentCars = { count: number; resident: Int32Array; place: Int32Array };

/** What the society tells traffic of its residents' cars. */
export type CommuterFeed = { legs: DriveLegs; parked: ParkedResidentCars };
