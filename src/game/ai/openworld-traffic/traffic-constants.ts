/** Cars that drive the open world's streets (the pool, past the seated cars): desktop 12, phone 6. */
export const MOVER_CARS = { desktop: 12, phone: 6 } as const;
/** Of the mover cars, the last of these are police cruisers (a light bar), leased only to patrols. */
export const PATROL_CARS = { desktop: 2, phone: 1 } as const;
/** Cars that stand parked as scenery near the players: real cars at the kerb, taken from a second pool that never drives. */
export const KERB_CARS = { desktop: 10, phone: 4 } as const;

/** Signal cycle: four phases (north-south through, north-south left, east-west through, east-west left), each its green then a yellow and an all-red clearance. */
export const THROUGH_GREEN_SECONDS = 16;
export const LEFT_GREEN_SECONDS = 7;
/** A yellow of 3 s suits streets of 25 mph (ITE: 3.0-4.0 s). */
export const YELLOW_SECONDS = 3;
/** Every approach red for 1.5 s between phases so a car that ran the yellow clears the box. */
export const ALL_RED_SECONDS = 1.5;
/** Junction `j`'s cycle starts `j * LIGHT_STAGGER_SECONDS` in, so neighbours are not green together. */
export const LIGHT_STAGGER_SECONDS = 19;

/** Cruise speed (m/s): 25 mph, the usual limit of a residential street. */
export const CRUISE_SPEED = 11;
/** A car in a hurry (a patrol car out to a call) drives this fast (m/s) and ignores signals. */
export const URGENT_SPEED = 20;
/** Comfortable deceleration (m/s²) a car plans a stop at a red with; follows use `FOLLOW_BRAKE`. */
export const STOP_BRAKE = 3.2;
/** Deceleration (m/s²) a car follows a slower car with: the same gentle 4 m/s² traffic uses. */
export const FOLLOW_BRAKE = 4;
/** On a yellow a car stops only when `STOP_BRAKE_YELLOW` m/s² is enough to stop at the bar, else it goes through. */
export const STOP_BRAKE_YELLOW = 4.5;
/** Centre-to-centre gap (m) a car keeps to what is stopped ahead: a 4.6 m car and 2.4 m of air. */
export const FOLLOW_GAP = 7;
/** From the car's centre to its nose (m): a stop at the bar is the centre this much short of it. */
export const NOSE_OVERHANG = 2.5;
/** Seconds ahead a car looks for traffic in its path, and the least distance (m) it does. */
export const LOOK_SECONDS = 2.5;
export const LOOK_MINIMUM = 18;
/** Sideways reach (m) from a route point in which a car is in our way: both half widths and 0.2 m. */
export const PATH_REACH = 2.2;
/** Spacing (m) of the route points sampled for traffic ahead. */
export const PATH_SAMPLE_STEP = 3;
/** Speed caps (m/s) through a turn: a right turn's radius is 4 m, a left's 7 m. */
export const RIGHT_TURN_SPEED = 4.5;
export const LEFT_TURN_SPEED = 6;
/** Speed cap (m/s) while pulling into or out of a space. */
export const PARK_SPEED = 3;
/** Distance (m) a car takes to swing between the lane and a space, one smooth step of its lateral offset. */
export const PARK_SWING = 7;
/** Route points sampled round a turn's curve (quadratic between the lane ends). */
export const TURN_STEPS = 6;
/** Dijkstra penalty (m) of a turn, so trips prefer fewer. */
export const TURN_PENALTY = 12;
/** Looking ahead, the look-ahead point is this far (m): short at a crawl, longer at speed. */
export const PURSUIT_SHORT = 6;
export const PURSUIT_LONG = 14;

/** A parked mover car pulls out after this many crowd seconds, seeded between the two. */
export const DWELL_SECONDS = { least: 25, most: 90 } as const;
/** Waiting to pull out until no car is within this far (m) behind in the lane. */
export const PULL_OUT_CLEAR = 14;
/** A wreck, or a car on its roof, is towed away after this many seconds. */
export const TOW_SECONDS = 8;
/** Seconds a car at a junction waits for a blocked box before it goes anyway (honking). */
export const BOX_PATIENCE = 6;

/** A kerb car appears within this far (m) of a player where no player can see it. */
export const KERB_REACH = 70;
/** A kerb car is put away when unseen and farther than this (m) from every player: past `KERB_REACH`, or a space just out of reach would show and hide its car in turn. */
export const KERB_KEEP = 90;
/** A pool car unseen for the grace is put away for a space this much (m) nearer a player than it is, when the pool is out. */
export const KERB_EVICT_MARGIN = 15;
/** Seconds between the kerb cars' and the movers' bookkeeping passes (spawns, departures, tows). */
export const BOOKKEEPING_SECONDS = 0.25;
/** A car's body radius (m) as the sight field is asked about it. */
export const SIGHT_RADIUS = 3.5;

/** A red-light run is raised once per car per this many seconds. */
export const RED_LIGHT_REARM_SECONDS = 8;

/** Seed of the movers' choices (spots, dwell times). */
export const TRAFFIC_SEED = 0x7a11c;

/** Route capacity: points and signals a trip holds (a trip crosses at most 14 junctions and 8 points each). */
export const ROUTE_POINTS = 160;
export const ROUTE_SIGNALS = 16;

/** Speed over its target (m/s) at which a car's brake comes on, and under which it goes off; the brake is full `BRAKE_SPAN` over (the traffic brain's figures). */
export const BRAKE_ON = 1;
export const BRAKE_OFF = 0.5;
export const BRAKE_SPAN = 4;
/** A target under this (m/s) is a stop: the brake is held on. */
export const HELD_TARGET = 0.3;
/** A stopped car's centre stands this far (m) short of where its nose meets the bar. */
export const STOP_MARGIN = 0.8;
/** Past its stop point by this much (m) a car is in the junction: the signal no longer holds it. */
export const STOP_COMMIT = 2.5;
/** Route points ahead (m) a car reads for speed caps. */
export const CAP_WINDOW = 60;
/** Margin (m) round a junction's box in which another car counts as standing in it. */
export const BOX_MARGIN = 1;
/** A car in the box slower than this (m/s) is blocking it. */
export const BOX_BLOCKING_SPEED = 2;
/** A car this close (m) to the end of its route, and slower than `ARRIVED_SPEED` (m/s), has arrived. */
export const ARRIVED_DISTANCE = 0.8;
export const ARRIVED_SPEED = 0.5;
/** Seconds a driving car may stand still before it is towed: a full red lasts at most 45 s. */
export const STUCK_SECONDS = 90;

/** No car appears within this far (m) of a player's car, seen or not: it would show up behind the camera. */
export const SPAWN_CLEAR = 30;
/** A trip goes at least this far (m) as the crow flies: a shorter one is not worth the street. */
export const MIN_TRIP_METRES = 60;
/** Bookkeeping passes after the scene starts in which cars appear whether or not an eye sees the space, so the first view is not empty. */
export const PRIME_PASSES = 12;
/** The seeded jitter of a kerb car in its space: sideways (m) and in yaw (rad). */
export const KERB_JITTER_SIDE = 0.25;
export const KERB_JITTER_YAW = 0.04;

/** A commuter's car stays standing this many crowd seconds after it parks before it may be put away unseen. */
export const COMMUTER_HOLD_SECONDS = 60;
/** A car that jumps farther than this (m) between two sim steps was put somewhere, not driven there. */
export const TELEPORT_METRES = 8;
/** Seconds between the society feed's reads. */
export const FEED_SECONDS = 0.5;

/** Where a put-away car waits, far off the course (m): car `id` stands at `x + id * step`. */
export const STORE_AT = { x: 4000, z: 4000, step: 12 } as const;
