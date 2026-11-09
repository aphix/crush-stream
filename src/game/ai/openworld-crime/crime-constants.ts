import { ACTIVITY_SECONDS } from "../civilians/civilian-activity.ts";
import { POLICE_HASH } from "../civilians/civilian-crowd-constants.ts";

/** The chase runs on a fixed grid of crowd time, so every peer that steps it makes the same moves whatever its frame rate. */
export const CRIME_HZ = 10;
export const CRIME_STEP_SECONDS = 1 / CRIME_HZ;
/** A crowd time a hair under a grid line (float rounding of the sim's sum) still counts as on it. */
export const GRID_EPSILON = 1e-6;
/** One `step` call catches up at most this many grid steps: a client whose clock jumped far ahead skips the rest. */
export const MAX_STEPS_PER_CALL = 20;
/** The society's offence rows are read every this many grid steps (twice a second). */
export const POLL_EVERY_STEPS = 5;

/** Foot cops that patrol, the one more that steps out of a patrol car, cases open at once and the foot cops one case calls. */
export const PATROL_COPS = 3;
export const CAR_COP = PATROL_COPS;
export const FOOT_COP_COUNT = PATROL_COPS + 1;
export const MAX_CASES = 4;
export const FOOT_COPS_PER_CASE = 2;
/** The last of a case's cop slots is the patrol car's cop. */
export const COPS_PER_CASE = FOOT_COPS_PER_CASE + 1;
/** A crime has one subject, a fight two. */
export const SUBJECTS_PER_CASE = 2;
export const MAX_SUBJECTS = MAX_CASES * SUBJECTS_PER_CASE;
/** Residents kept out of the drawn crowd after a chase, until their next walk begins. */
export const MAX_HELD = 16;
/** Longest walk (graph nodes) a chase plans: a sidewalk lattice of this city is far shorter. */
export const MAX_ROUTE_NODES = 64;

/** A whole stride a second at most (runners take 170-180 steps a minute): past the civilians' walking stride a faster walker lengthens the stride instead of quickening it. */
export const RUN_STRIDES_PER_SECOND = 1.45;
/** A cop a car runs down is off the street this long (s), then back at his beat's start: long enough that the hit reads, short of leaving the beat empty. */
export const COP_DOWN_SECONDS = 20;
/** A cop's knock heard this late (s) or later is history: he goes down, but nobody is thrown. */
export const HEARD_COP_DOWN_LATE_SECONDS = 2;
/** Paces (m/s): a patrolling cop's walk, a cop's sprint after a suspect, and the sprint a fleeing suspect makes (a drawn share of the span per resident, always slower than the cop). */
export const COP_PATROL_SPEED = 1.4;
export const COP_RUN_SPEED = 4.8;
export const FLEE_SPEED_MIN = 3.2;
export const FLEE_SPEED_SPAN = 0.8;

/** A cop sees a suspect within this many metres in a straight line and a runner at a red light within `RED_LIGHT_SIGHT`: the sidewalks' sight lines are short, and the city's walls hold the rest. */
export const COP_SIGHT = 40;
export const RED_LIGHT_SIGHT = 60;
/** The player on foot is held by a cop within this many metres of him while he moves slower than this (m/s): standing, or creeping: the bust hold of a car held slow beside a chasing cop, on foot. */
export const FOOT_HOLD_REACH = 3;
export const FOOT_HOLD_SPEED = 1;
/** A chase of the player on foot that has not held him this long (s) since it began is given up: he got away. */
export const PLAYER_CHASE_GIVE_UP_SECONDS = 45;
/** The player on foot faces the way he last moved at over this speed (m/s); standing still he keeps his last facing. */
export const FACING_SPEED = 0.3;
/** A person's eyes stand this high (m) over the ground: a sight line between two people runs at this height, over railings and parked cars, not through a building. */
export const EYE_HEIGHT = 1.6;
/** A walker within this many metres of a zebra crossing's line, and between these shares of its length (off both kerbs), is out on it. */
export const CROSSING_HALF_WIDTH = 1.5;
export const CROSSING_KERB_SHARE = 0.15;
/** A walker heading within acos of this of a crossing's line walks along it. */
export const CROSSING_ALIGNMENT = 0.7;
/** A cop stops chasing a jaywalker after this long (s): they have walked on and it was only a light. */
export const JAYWALK_GIVE_UP_SECONDS = 30;
/** A cop this close (m) lays hands on a suspect: an arm's reach plus a shoulder's width. */
export const BUST_REACH = 1.6;
/** Seconds the cuffs take (the cuffing clip's length, so the grip and the clip are one number); the bust is raised when they are on. */
export const GRIP_SECONDS = ACTIVITY_SECONDS.cuffing;
/** A cuffed suspect is led away at this walk (m/s) for at most this long (s), to the case's patrol car or this far along the street, and is gone from it within this many metres of where the cop leads her. */
export const ESCORT_SPEED = 1.2;
export const ESCORT_SECONDS = 6;
export const ESCORT_AHEAD_DISTANCE = 12;
export const ESCORT_ARRIVE = 2;
/** Led along the street, she is walked to a corner at least this far (m) from where she was cuffed, so the walk away is seen. */
export const ESCORT_MIN_DISTANCE = 6;

/** A cop this close (m) to a fight shouts at it, and the fighters have this many seconds to stop; each one keeps attacking with this chance (a seeded draw of their fight). */
export const FIGHT_WARN_REACH = 6;
export const WARN_SECONDS = 2;
export const RESIST_CHANCE = 0.35;

/** A flight is planned round the cops: a node within this many metres of one is feared (linearly less to nothing at the edge), at the path finder's weight. */
export const DANGER_RADIUS = 30;
export const DANGER_WEIGHT = 1;
/** Cops replan their run every this many grid steps (staggered by cop), a fleeing suspect theirs. */
export const COP_REPLAN_STEPS = 5;
export const FLEE_REPLAN_STEPS = 10;
/** A suspect at their hiding place's door (m) is inside; a cop this close (m) to it searches the alley. */
export const HIDE_ARRIVE = 1;
export const HIDE_SEARCH_REACH = 3;
/** A cop at the door finds the hider with this chance (one seeded draw per case); the search is given up after `SEARCH_SECONDS` of hiding, a flight with no hiding place after `FLEE_GIVE_UP_SECONDS`. */
export const FIND_CHANCE = 0.6;
export const SEARCH_SECONDS = 25;
export const FLEE_GIVE_UP_SECONDS = 90;
/** A hiding place must be this much (m) nearer the suspect than the nearest cop to be run for; else the flight takes the farthest street corner from the cops. */
export const HIDE_LEAD = 5;
/** The farthest-corner choice caps a cop gap at this many metres and charges this share of a metre of lead per metre run. */
export const FLEE_GAP_CAP = 200;
export const FLEE_TRAVEL_WEIGHT = 0.5;

/** A fighter taken down is thrown at this speed (m/s) away from the cop, lifted and tumbled: a tackle, not a car. */
export const TAKEDOWN_SPEED = 3;
export const TAKEDOWN_LIFT = 1.5;
export const TAKEDOWN_TUMBLE = 4;

/** Patrol cars at most; one that comes to a scene stops this far (m) from it and its cop steps out; a car chase is given up after this long (s) or when the runner is this far (m) off for `CAR_LOST_SECONDS`. */
export const MAX_PATROL_CARS = 2;
export const CAR_ARRIVE_DISTANCE = 14;
export const CAR_CHASE_GIVE_UP_SECONDS = 60;
export const CAR_LOST_DISTANCE = 220;
export const CAR_LOST_SECONDS = 10;
/** A patrol car aims this many seconds ahead of the car it chases (at most). */
export const CAR_LEAD_SECONDS = 2;
/** A cop car comes to a stop `CAR_STOP_GAP` m short of what it drives at, braking at `CAR_STOP_DECEL` (m/s2). */
export const CAR_STOP_GAP = 8;
export const CAR_STOP_DECEL = 6;
/** The headings (rad) a patrol car tries off the straight one when a solid is in its way, in turn to either side, and the metres of clear run a radian of bend costs: the hunters' own. */
export const AVOID_TURNS = [0.3, 0.6, 0.9, 1.25, 1.6, 2.2, Math.PI] as const;
export const AVOID_TURN_COST = 6;
/** A patrol car starts from a kerb space about this far (m) from the scene: out of sight of most of a play area 409 m across. */
export const PATROL_START_DISTANCE = 110;
/** A car that runs this many civilians down within `HEAT_SECONDS` has a patrol car sent after it. */
export const HEAT_KNOCKS = 3;
export const HEAT_SECONDS = 60;
/** Cars the heat counts: the engine's list is no longer than this. */
export const HEAT_CARS = 32;
/** This share of patrol runs is a hothead's (seeded per run from the host's seed): he drives straight at the scene at full speed round only what he sees in time, so a cop wrecking himself on a tree stays possible and funny, just not every time. Every other run takes the streets. */
export const HOTHEAD_RUN_SHARE = 0.2;
/** A careful patrol car closes on a car it chases at no more than this (m/s, about 32 km/h, a city street's pace it can steer round the street's furniture at) once within `CLOSE_PURSUIT_DISTANCE` m. */
export const CAREFUL_PURSUIT_SPEED = 9;
export const CLOSE_PURSUIT_DISTANCE = 30;
/** A careful chase hands the wheel back to the traffic's trip once the offender is this far (m) off again, so it does not flip at the close-in edge. */
export const CHASE_RESUME_DISTANCE = 45;
/** A chase's street trip is re-aimed this often (s), at the kerb space nearest where the offender will be this many seconds on. */
export const REDIRECT_SECONDS = 2;
export const CHASE_LEAD_SECONDS = 2;
/** The patrol driver brakes for any car this far ahead (m) within this half-width (m) of its line (two car half-widths and a margin), to stop this far (m) behind it: the traffic's `FOLLOW_GAP` less a car's length. */
export const CAR_AVOID_LOOK = 25;
export const CAR_AVOID_SWATH = 2.2;
export const CAR_AVOID_GAP = 5;
/** The patrol driver plans its stop behind a car with this deceleration (m/s2): the traffic's own comfortable stop (`STOP_BRAKE`), which the brake's ramp reaches without overshooting the gap. */
export const CAR_AVOID_DECEL = 3.2;
/** Wanting to stand still under this speed (m/s), the patrol car holds the brake: the race brake's latch does not bite within about 1.5 m/s of its target, so a car would coast on. */
export const HOLD_BRAKE_SPEED = 2.5;
/** A patrol car's siren makes a traffic car it is within this many metres of pull over, and stop. */
export const YIELD_DISTANCE = 35;
/** A busted driver's car stays stopped this long (s) before the traffic has it back. */
export const IMPOUND_SECONDS = 10;
/** A patrol car whose case is over waits this long (s), sirens off, before it is let go. */
export const CAR_LINGER_SECONDS = 8;

/** Seeded draw streams: one per kind of choice, so adding one never moves another. */
export const CRIME_STREAM = { patrolStart: 1, patrolTurn: 2, flee: 3, find: 4, resist: 5, hothead: 6 } as const;
/** A draw's hash input: the seed's low bits, the stream and the index scaled apart so no two choices share an input. */
export const DRAW_SEED_MASK = 0xffff;
export const DRAW_SEED_SCALE = 0.01;
export const DRAW_STREAM_SCALE = 17;
export const DRAW_INDEX_SCALE = 0.61;

/** The look word of a foot cop: the who-hash the drawing dresses as police. */
export const COP_LOOK = POLICE_HASH;
/** Within this many metres of its aim a cop leaves the sidewalk graph and closes in straight. */
export const STRAIGHT_APPROACH = 6;
/** A cop this close (m) to its patrol car gets back in. */
export const CAR_COP_BACK_REACH = 2;
/** A flight with no hiding place to run for goes to the street corner farthest from the cops within this many metres. */
export const FLEE_REACH = 80;
