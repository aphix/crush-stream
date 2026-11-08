import { hypot2, detSin, detCos, detAtan2 } from "../kernel/physics-core.js";
import { chargeBoost, clearDrive, idleDrive, topUpBoost, type DriveInput } from "../vehicle/car-drive.ts";
import { mood } from "./ai-aggression.ts";
import { AI_SKILL, BRAKE_THROTTLE, BUST, CRAWL, GUARD_BRAKE_IDX, GUARD_CONTEST_IDX, GUARD_COUNT, GUARD_DT_IDX, GUARD_GRIP_IDX, GUARD_LEAD_IDX, GUARD_NEED_IDX, GUARD_PUSH_IDX, GUARD_RISK_IDX, GUARD_RIVALS_IDX, GUARD_TURN_IDX, OFF_GAS_S, OFF_GAS_SPEED, REVERSE_THROTTLE, SKILL_SALT, SLIP_COOL, SLIP_CORNER, SLIP_RECOVER, SLIP_WINDOW, STRAIGHT_CURV, THINK_HZ, THINK_SALT, TURN_ROUND_THROTTLE, WOBBLE_K, type AiDifficulty } from "./constants.ts";
import { contests, guardContact, HORIZON } from "./contact-guard.ts";
import { DERBY_RULES, STUCK_SPEED, type AiCar } from "./derby-ai.ts";
import { personality, type Personality } from "./personality.ts";
import { PlanClock } from "./plan-clock.ts";
import { Pedals } from "./pedals.ts";
import { WreckPass } from "./wreck-pass.ts";
import { Standoff } from "./standoff.ts";
import { closingSpeed, lookDistance, SEEN_BEHIND, SEEN_CORRIDOR, SEEN_NEAR, SEEN_OFFROAD, Sighting, SIGHT_MAX, visibleStretch } from "./sight.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { SURFACE_IDS, SURFACES, type Surface } from "../world/catalog.ts";
import { blankPoint, blankProjection, pointOn, projectPath, sampleAt, type Projection, type Track, type TrackPath, type TrackPoint } from "../world/track.ts";
import { junctionsOf } from "../world/junctions.ts";
import { assists, classStats, cornerSpeed, HANDLING, rollingOver, terminalSpeed, tyreGrip, tyreRoll, type Assists, type ClassStats } from "../vehicle/vehicle-classes.ts";
import { clamp, hash01, wrapPi } from "../kernel/scalar.ts";
/** The assists' scratch (`assists` fills it): the guard reads the tyres' share of grip from it. */
const _assist: Assists = { grip: 1, slipCap: 0, catchRate: 0, scrub: 0, selfRight: 0 };

/** Steering authority on a surface: `applyDrive` scales the yaw rate by this (front-axle grip). */
function steerGrip(grip: number): number {
  return 0.45 + 0.55 * grip;
}

/** A class's full-lock yaw rate (rad/s) at `speed` on `surf` under its tyres, as `applyDrive` turns the car: less below 8 m/s, and scaled by the grip there (`steerGrip`). */
export function turnRate(cls: ClassStats, speed: number, surf: Surface): number {
  return cls.turn * (0.35 + 0.65 * Math.min(1, speed / 8)) * steerGrip(tyreGrip(cls.tyre, surf));
}

/** The fastest (m/s) a class drives the arc a pure pursuit asks for, aimed `reach` m ahead at `alpha` rad off its nose, on `surf` under its tyres (`cornerSpeed`). */
export function arcSpeed(cls: ClassStats, reach: number, alpha: number, surf: Surface): number {
  return cornerSpeed(cls, reach / (2 * Math.abs(detSin(alpha))), tyreGrip(cls.tyre, surf));
}

/** The sideways grip (m/s²) a class's tyres hold on `surf` with the assists on (`GUARD_GRIP_IDX`): what caps its yaw rate at a speed (`GRIP_YAW_CAP`). */
export function tyreHold(cls: ClassStats, surf: Surface): number {
  return cls.grip * tyreGrip(cls.tyre, surf) * assists(HANDLING.realism, _assist).grip;
}

/** The brake for a speed `excess` (m/s) over a target, by car `i`'s latch in `pedals` (on `BRAKE_ON` over, off `BRAKE_HOLD` under): 0 while the latch is off. */
export function brakeOver(pedals: Pedals, i: number, excess: number): number {
  return pedals.latch(i, excess, BRAKE_ON, -BRAKE_HOLD) ? clamp(excess / BRAKE_SPAN, BRAKE_MIN, 1) : 0;
}

/** `from`'s six fields into `to` (a brain's scratch output kept as a held input between thinks). */
export function copyDrive(from: DriveInput, to: DriveInput): void {
  to.throttle = from.throttle;
  to.steer = from.steer;
  to.brake = from.brake;
  to.ebrake = from.ebrake;
  to.boost = from.boost;
  to.neutral = from.neutral;
}

/** Corner margin: plan every turn as if this share of its radius, so a car keeps this share of its class's full-lock yaw rate and lateral grip in hand. */
export const CORNER_MARGIN = 0.8;
/**
 * The share of the class brake the AI counts on, everywhere it brakes: `plan`'s stops, the HUD's braking cue (`brakeCueAt`) and the contact guard's own
 * braking (a car ahead is taken to shed the whole class brake: `think`). One number: the plan counted on 0.5 (13 m/s²) while the guard counted on 0.72, and the cars really brake at
 * 26-28 m/s², so every stop began twice too early and undershot (12.4 m/s at four-count's 88° shortcut mouth against a 23 m/s plan). 0.72 is the guard's: a steered or
 * locked car sheds less of the brake than `applyDrive` asks (a hit at 0.9 came from braking at the limit).
 */
export const BRAKE_SHARE = 0.72;
/** Look this far (m) ahead for traffic. */
const SCAN = 18;
/** `SCAN` and `HUNT` hold at up to this speed (m/s), the field's pace they were tuned at, and stretch with speed above it. */
const PACE = 18;
/** Two cars closer than this sideways (m) share a line. */
const LINE_W = 2.4;
/** Lateral room (m) kept between the planned line and the road edge. */
const EDGE = 1.4;
/** Lane change rate (m/s). */
const LANE_RATE = 3.2;
/** Sideways bias (m, scaled by the driver's side) the planned line takes off the road's centre line. */
const LINE_SIDE_BIAS = 0.8;
/** A shortcut is chosen this far (m) before its mouth. */
const COMMIT = 45;
/** A boost burst starts only with at least this much meter (no stutter on the dregs). */
const BURST_MIN = 0.5;
/** A burst runs while the plan at the boosted top wants this much (m/s) more than the car has: boost pulls harder (and past top by `boostTop`). */
const BOOST_SHORT = 2;
/** Once a burst runs it keeps on while the plan wants this much more speed (m/s): the start margin less a band, so a plan on its edge does not end it. */
const BOOST_KEEP_SHORT = 0.5;
/** A burst starts with the car's heading this near its aim (rad; `BOOST_ALPHA_CHASE` chasing a rival) and runs on to `BOOST_ALPHA_KEEP`: boost on a tail-happy class past a wide lock slides it. */
const BOOST_ALPHA = 0.3;
const BOOST_ALPHA_CHASE = 0.45;
const BOOST_ALPHA_KEEP = 0.45;
/** A burst gives up when the meter is this empty. */
const BURST_STOP = 0.02;
/** Brake band (m/s over the target): the brake comes on above `BRAKE_ON` (the old dead band's edge) and stays on until the car is under `BRAKE_HOLD`, so a target wobbling on the edge does not pulse the lamps; the brake's least size is `BRAKE_MIN` (as it was). */
const BRAKE_ON = 1.5;
const BRAKE_HOLD = 0.5;
const BRAKE_MIN = 0.2;
/** Speed over the target (m/s) at which the brake is full. */
const BRAKE_SPAN = 6;
/** Lane change rate share added (× `LANE_RATE`) while passing stopped cars: a swerve round a wreck is a quick one (an oncoming car's is 2). */
const WRECK_SWERVE = 1;
/** A car this near on the nose (m, centre to centre: a car's length and a margin) and within this far sideways (m: a car's width) is against it. */
const NOSE_GAP = 6;
const NOSE_HALF = 1.9;
/** Seconds a standoff's back-off reverses: about a car length at the back-out's pace. */
const STANDOFF_BACKOFF_S = 1;
/** The least a pass looks ahead for stopped cars (m): a lane change needs this much room even at a crawl. */
const PASS_LOOK_FLOOR = 12;
/** A moving car's sideways drift (m/s, in our frame) is carried this many seconds ahead, at most this far (m), to where it will be as we reach it. */
const PREDICT_S = 1.5;
const PREDICT_MAX = 2.5;
/** A car whose heading is at least this sine off ours cuts across our way (a side street's traffic at a junction), not along it. */
const CROSS_SIN = 0.5;
/** Its centre and our nose are clear of a crossing this far (m) past where the two headings meet: half a car length plus half a width (3.4 m) and a metre. */
const CROSS_CLEAR = 4.5;
/** Seconds kept between a crossing car leaving the crossing and our nose reaching it, and the other way round. */
const CROSS_MARGIN_S = 0.5;
/** Round a blind stretch of a road with oncoming loop traffic the line keeps to its own half, this far (m) off the centre: our half width and half a metre (a pursuit chord cuts a corner up to 1.2 m inside its lane, so the oncoming lane's edge is no margin). */
const ONCOMING_KEEP = 1.5;
/** Cars ahead (and this far behind the nose, m) a plan weighs as holding a lane, at most; a lane is held by one within this far (m) beyond the car being passed. */
const NEAR_CARS = 10;
const HELD_TAIL = 4.5;
const HELD_BEYOND = 8;
/** A line round a car runs this far (m) sideways of its centre: a car width and a margin. */
const FLANK_GAP = LINE_W + 0.9;
/** Gap (m) a driver boxed in behind a car (both sides held) closes to before matching its speed. */
const FOLLOW_STOP_GAP = 6;
/** Pursuit look-ahead (m) at speed; a junction's turn is planned as spread over it. */
const LOOK = 18;
/** An aggressive driver hunts a rival up to this far (m) ahead within this far sideways. */
const HUNT = 25;
const HUNT_SIDE = 5;
/** A hunter with more fight than this comes up offset from its rival (a PIT tap at its rear quarter, then door to door) instead of pushing it from behind. */
const PIT_FIGHT = 0.3;
/** Lateral offset (m) from the rival's centre for a PIT tap: about half a car's width of overlap. */
const PIT_OFFSET = 1;
/** A car with a racer this near (m) when its shortcut coin is tossed stays on the loop. */
const MOUTH_GAP = 12;
/** Cars this near lengthwise (m, centre to centre) still overlap each other's flanks: their lanes stay a car width apart. */
const ABREAST = 6.5;
/** Least closing speed (m/s) while going round a car, so the pass never stalls behind a parked one. */
const PASS_CREEP = 2;
/** Lateral room (m) a crossing's other arm gives past the road's edge lanes: a wreck's clearance and a hand's breadth beyond the strand's edge. */
const CROSS_ROOM = 4.8;
/** A driver fights only above this speed (m/s), against a rival doing at least 0.6 of it. */
const FIGHT_PACE = 5;
/** Seconds a racer hunted by a cop (`BUST`) pushing at under `STUCK_SPEED` waits before backing out (else its patience + 0.4): nose against something, out at once. */
const BUST_STUCK_S = 0.3;
/** Seconds a racer blocked behind goes forward instead of reversing toward its line (a wall behind it). */
const REVERSE_LOCKOUT_S = 2;
/** A driver with this much aggression or less takes only a shove that is safe (`RaceBrain.safeShove`); above it `mood` alone decides. */
const CAREFUL = 0.5;
/** What a safe shove adds to a careful driver's mood, a quarter of the most a driver wants a fight: aggression 0.5 shoves a safe one, under 0.375 never fights. */
const SAFE_SHOVE = 0.25;
/** A shove is safe at a closing speed under this (m/s, the derby's hit speed: a nudge, not a ram), ... */
const SHOVE_SPEED = DERBY_RULES.hitSpeed;
/** A careful driver's shove swings its lane over at no more than this (m/s), so two of them shoving each other close sideways at under `SHOVE_SPEED`. */
const SHOVE_LAT = 0.5;
/** ... and with this much road (m) beyond the rival on the side it is pushed to. */
const WALL_ROOM = 2.5;
/** At the back of the field (risk 1) a racer plans corners this much faster (on top of `push`): about 0.98 of the class's limit through `CORNER_MARGIN`'s 0.89. */
const RISK_PUSH = 0.1;
/** ... and its stops on this much more of its brake: 0.94 of the class brake, against the leader's 0.72 (`BRAKE_SHARE`). */
const RISK_BRAKE = 0.3;
/** Slots of `RaceBrain.args`: the scalars `think` hands to its per-car calls. A number passed to a call V8 does not inline is heap-boxed; a slot the caller writes and the callee reads is not. */
const ARG_S_IDX = 0; // arc length (m) along the route being driven
const ARG_HALF_IDX = 1; // its half width (m) here
const ARG_LAT_IDX = 2; // the car's lateral offset (m) from its line
const ARG_FX_IDX = 3; // the car's heading, unit vector
const ARG_FZ_IDX = 4;
const ARG_ALONG_IDX = 5; // its speed along it (m/s)
const ARG_SPEED_IDX = 6; // its speed (m/s)
const ARG_TOP_IDX = 7; // the top speed (m/s) `plan` works up to
const ARG_MAIN_S_IDX = 8; // arc length (m) along the main loop
const ARG_AHEAD_IDX = 9; // arc length (m) of the point `pointAhead` returns
const ARG_DT_IDX = 10; // the step (s)
const ARG_COUNT = 11;

export function surfaceAt(path: TrackPath, k: number): Surface {
  return SURFACES[SURFACE_IDS[path.surface[k]!]!];
}

/** Gravity (m/s²) and the half-span (m) a crest's vertical curvature is read over. */
const G = 9.6;
const CREST_SPAN = 6;

/**
 * Highest speed (m/s) a car stays planted over ground at heights `back`, `at`, `ahead` (m), `span` m apart: over a crest of vertical
 * curvature κ the ground falls away faster than gravity pulls the car down above √(g/κ), and an airborne car can neither steer nor brake
 * for the bend after it. Infinity in a dip or on the level.
 */
export function crestLimit(back: number, at: number, ahead: number, span = CREST_SPAN): number {
  const k = (back - 2 * at + ahead) / (span * span);
  return k < -1e-4 ? Math.sqrt(G / -k) : Infinity;
}

/** `crestLimit` over the road `s` m along `path`. */
function crestSpeed(path: TrackPath, s: number): number {
  const y = path.y;
  return crestLimit(y[sampleAt(path, s - CREST_SPAN)]!, y[sampleAt(path, s)]!, y[sampleAt(path, s + CREST_SPAN)]!);
}

type RaceAiState = {
  /** Next main checkpoint (`CarRecord.next`). */
  next: number;
  /** Completed laps. */
  lap: number;
  /** Live place, 1 leading (`CarRecord.place`); none: drives as the leader. */
  place?: number;
  /** Set once home (`CarRecord.finishTime`): nothing left to win. */
  finishTime?: number | null;
};

/**
 * Racing driver for one course, memory per car id. Built on `DerbyBrain`'s personality hash, `AiCar` snapshots and unstick idea:
 *  L0 unstick: throttle held without motion → reverse with the nose swinging toward the line
 *  L1 route: the main loop, or a designed shortcut taken on a seeded per-lap coin
 *  L2 line: inside of the next turn plus a personal offset; a slower car ahead on our line → pass on the side with room, else follow its speed.
 *     Rivals by `mood` (ai-aggression.ts): its positive part, `fight`, scales every contact move (ram, late block, door-to-door shove, hunt,
 *     PIT tap), so a field's contact grows with its aggression; its negative part, `shy`, keeps a clean driver off other cars. Up to
 *     0.5 (`CAREFUL`) a driver fights only a rival it can shove safely (`safeShove`), swinging over gently (`SHOVE_LAT`).
 *  L3 drive: pure pursuit to a point ahead on the line; speed from corner speed, grip and shortcut junctions ahead under a braking budget.
 *     Boost on a clear run while the plan at the boosted top wants more speed, from a meter that drains and refills like the player's seat (`BOOST`).
 *  L4 guard (`contact-guard.ts`): of every car it is closing on except the ones it means to hit (fight > 0), the soonest contact within
 *     1.5 s is steered clear of and braked for, so a clean driver (aggression 0) starts no contact (`race-contact.ai-long-run.ts`; `race-ai.test.ts` pins the held-drive guard).
 * Deterministic (no clock, no Math.random); no allocation per call.
 */
export class RaceBrain {
  readonly track: Track;
  /** Ids below this are racers; the rest (traffic) are only avoided. */
  racers: number;
  /** Ids below this are the cars a racer keeps clear of (`guardContact`): the racers and the traffic; police past it hit on purpose. */
  guarded: number;
  private readonly out: DriveInput = idleDrive();
  private readonly traits: Personality[] = [];
  private readonly aggression = new Float64Array(MAX_CARS);
  /** Per car, this step: its will to win, 0 leading (or home, or at aggression 0, the slider's clean race) up to 1 last (`placeRisk`). */
  private readonly risk = new Float64Array(MAX_CARS);
  /** Per car: class figures (sedan until `setClass`). */
  private readonly cls: ClassStats[] = Array.from({ length: MAX_CARS }, () => classStats("sedan"));
  /** Boost meter per car, 0–1 (the HUD reads it), and whether a burst is running (it runs on to empty). */
  readonly meter = new Float64Array(MAX_CARS);
  private readonly burst = new Uint8Array(MAX_CARS);
  /** Per car: the meter as it stood before this think's `charge`, to give back a boost the late guard cancelled. */
  private readonly meterWas = new Float64Array(MAX_CARS);
  private readonly seg = new Int32Array(MAX_CARS);
  /** Per car: the main-loop sample a respawn put it on (−1 none): the first projection starts there, so a spot beside a crossing keeps its own strand. */
  private readonly spotSeg = new Int32Array(MAX_CARS).fill(-1);
  private readonly route = new Int16Array(MAX_CARS);
  private readonly routeSeg = new Int32Array(MAX_CARS);
  /** Last `lap * 8 + shortcut` the shortcut coin was tossed for. */
  private readonly tossed = new Int32Array(MAX_CARS);
  private readonly lane = new Float64Array(MAX_CARS);
  private readonly stuck = new Float64Array(MAX_CARS);
  private readonly recover = new Float64Array(MAX_CARS);
  private readonly recoverSteer = new Float64Array(MAX_CARS);
  private readonly lastThrottle = new Float64Array(MAX_CARS);
  /** Per car: seconds in a row off the gas (guarded throttle 0..`BRAKE_THROTTLE`) at a crawl; past `OFF_GAS_S` it backs out. */
  private readonly idle = new Float64Array(MAX_CARS);
  /** Per car, this think: 1 when under `BUST.kph` within `BUST.near` m of a police car (about to be busted). */
  private readonly hunted = new Uint8Array(MAX_CARS);
  /** Per car: seconds left in which it goes forward, not in reverse, to turn round (it was blocked behind). */
  private readonly noReverse = new Float64Array(MAX_CARS);
  /** Per car skill multipliers rolled in `setDifficulty` (1 = hard; police and unset cars stay 1): corner speed, brake decel, steer gain, look-ahead, apex share. */
  private readonly push = new Float64Array(MAX_CARS);
  private readonly brakeK = new Float64Array(MAX_CARS);
  private readonly steerK = new Float64Array(MAX_CARS);
  private readonly lookK = new Float64Array(MAX_CARS);
  private readonly apexK = new Float64Array(MAX_CARS);
  /** Per car, from `AI_SKILL` (hard and unset cars: sway 0, mistake chance 0, multipliers 1): sway amplitude (m) and phase (rad), chance of a mistake per corner entry, and its corner-speed and braking multipliers. */
  private readonly wobble = new Float64Array(MAX_CARS);
  private readonly phase = new Float64Array(MAX_CARS);
  private readonly slipP = new Float64Array(MAX_CARS);
  private readonly slipPush = new Float64Array(MAX_CARS);
  private readonly slipBrake = new Float64Array(MAX_CARS);
  private readonly shaken = new Float64Array(MAX_CARS);
  /** Per car, `AI_SKILL.calm` (m): another car this close holds its errors (0: only one it follows or swerves for). */
  private readonly calm = new Float64Array(MAX_CARS);
  /** Per car, from `AI_SKILL`: reaction time (s) before it acts on a car that has come into view, and how many seconds of closing speed it looks ahead. */
  private readonly reaction = new Float64Array(MAX_CARS).fill(AI_SKILL.hard.react[0]);
  private readonly lookSeconds = new Float64Array(MAX_CARS).fill(AI_SKILL.hard.seconds[0]);
  /** Per car, from `AI_SKILL` (unset cars as hard): how much later (s) than a crossing rival it may reach the crossing and still contest it, at the back of the field. */
  private readonly contestS = new Float64Array(MAX_CARS).fill(AI_SKILL.hard.contest[0]);
  /** How long each car has had each other in view, and the scratch projection of a sight test. */
  private readonly sighting = new Sighting();
  private readonly seeProj = blankProjection();
  /** Per car: seconds left of the mistake in progress and of the wait before the next, whether a corner was ahead last think, and the corners rolled for. */
  private readonly slip = new Float64Array(MAX_CARS);
  private readonly cool = new Float64Array(MAX_CARS);
  private readonly wasCorner = new Uint8Array(MAX_CARS);
  private readonly rolls = new Int32Array(MAX_CARS);
  /** Mistakes each car has made since `reset` (tests and the HUD may read it). */
  readonly mistakes = new Int32Array(MAX_CARS);
  /** Per car, from its last think: a car close on its line (following, swerving or nudged). Skill errors and slips are for an open road: in traffic every tier drives like hard, so a gentle rival never runs into anyone. */
  private readonly busy = new Uint8Array(MAX_CARS);
  /** When each car plans again, and whether the guard had it in danger last step. */
  private readonly clock = new PlanClock();
  private readonly endangered = new Uint8Array(MAX_CARS);
  /** Per car, the plan its steps drive to: the lateral line (m) and the rate (m/s) the lane moves to it, the speed target (m/s) with and without boost, the speed of the car it is boxed in behind (NaN: none) and its chase share. */
  private readonly planWant = new Float64Array(MAX_CARS);
  private readonly planRate = new Float64Array(MAX_CARS);
  private readonly planTarget = new Float64Array(MAX_CARS);
  private readonly planBoosted = new Float64Array(MAX_CARS);
  private readonly planFollow = new Float64Array(MAX_CARS).fill(Number.NaN);
  private readonly planChase = new Float64Array(MAX_CARS);
  /** Every AI pedal and the wheel go through these hands. */
  private readonly pedals = new Pedals();
  /** The pass round stopped cars and wrecks in the road ahead. */
  private readonly pass = new WreckPass();
  /** Nose to nose pushing at a crawl: the count (`Standoff`), and per car whether the last plan found a car on its nose with a side free to go round it. */
  private readonly standoff = new Standoff();
  private readonly planNosed = new Uint8Array(MAX_CARS);
  /** This call: a car is on the nose, and a side is free to go round it. */
  private nosed = false;
  /** This call: a car is on the line being passed, whatever it comes to (a pass is traffic, not an open road). */
  private passing = false;
  private nosedFree = false;
  /** This call's cars within reach ahead (id, metres on the nose, lateral metres): what holds a lane while a car is passed. */
  private nearCount = 0;
  private readonly nearId = new Int16Array(NEAR_CARS);
  private readonly nearAhead = new Float64Array(NEAR_CARS);
  private readonly nearLat = new Float64Array(NEAR_CARS);
  /** This call's candidate lines (m): the wanted one, the road's two edges and both flanks of every car that holds a lane. */
  private readonly cand = new Float64Array(5 + 2 * NEAR_CARS);
  /** This step's place on the road, set by `projectRoute`: the projection and path being driven, the shortcut (−1 none), the speed along the heading, the turn limit, the surface, and whether it is on the run in to a shortcut's mouth. */
  private proj: Projection;
  private path: TrackPath;
  private routeNow = -1;
  private along = 0;
  private turnMax = 0;
  private surf: Surface;
  private toMouth = 0;
  private early = false;
  /** This step's aim: heading error (rad) to the point ahead on the lane, the yaw rate (rad/s) pure pursuit asks, and the distance (m) to the point. */
  private alpha = 0;
  private omega = 0;
  private reach = 0;
  private readonly mainProj = blankProjection();
  private readonly subProj = blankProjection();
  private readonly args = new Float64Array(ARG_COUNT);
  /** Per car id: the tune `guardContact` reads (`GUARD_*_IDX`), as of its last think. */
  private readonly tunes = Array.from({ length: MAX_CARS }, () => new Float64Array(GUARD_COUNT));
  private readonly pt: TrackPoint = blankPoint();
  /** Speed of the car we are boxed in behind this call, NaN when the way is clear. */
  private follow = Number.NaN;
  /** This call: the speed (m/s) that reaches the crossing of a car cutting across our way only once it has cleared it; Infinity when none. */
  private crossCap = Infinity;
  /** Fight (0–1) of a shove or block this call: the lane swings over faster by this much. */
  private swerve = 0;
  /** This call: a careful driver is shoving a rival, so its lane moves at no more than `SHOVE_LAT`. */
  private nudge = false;
  /** This call: a faster car or a cop is closing on our tail, so the lane swings clear of it and the gas stays down. */
  private evading = false;
  private readonly planEvade = new Uint8Array(MAX_CARS);
  /** Fight (0–1) toward the rival being hunted or rammed this call, 0 when none. */
  private chase = 0;
  /** Per car id, this call: 1 for a car the contact guard leaves alone: a rival this driver is fighting, or one it cannot see (yet). */
  private readonly hit = new Uint8Array(MAX_CARS);
  /** Per car id: the `hit` of its last think, kept for `guard` between thinks (only for drivers that hold their input). */
  private readonly hitOf = Array.from({ length: MAX_CARS }, () => new Uint8Array(MAX_CARS));
  /** This call: the shortcut being turned into (−1 none), the distance (m) to its mouth while short of it, and the turn (rad) still to make onto it. */
  private entry = -1;
  private lead = 0;
  private turnIn = 0;
  /** Main-loop arc length of each shortcut's mouth and end. */
  private readonly mouthS: number[];
  private readonly exitS: number[];
  /** Each shortcut's heading at its mouth, the turn (rad) onto it from the main loop there, and from its end back onto the loop. */
  private readonly mouthYaw: number[];
  private readonly mouthTurn: number[];
  private readonly exitTurn: number[];
  /** The lateral range (m) the line keeps to where the road ahead is blind: clear of the loop's oncoming traffic lanes (unbounded with none). */
  private readonly blindMin: number;
  private readonly blindMax: number;
  /** That oncoming traffic's speed (m/s): what it adds to our closing speed. */
  private readonly oncomingSpeed: number;

  constructor(track: Track, racers: number) {
    this.track = track;
    this.racers = racers;
    this.proj = this.mainProj;
    this.path = track.path;
    this.surf = surfaceAt(track.path, 0);
    this.guarded = racers;
    this.push.fill(1);
    const traffic = track.json.traffic;
    let lo = -Infinity;
    let hi = Infinity;
    for (const lane of traffic ? traffic.lanes.slice(0, traffic.count) : []) {
      if (lane.dir > 0) continue;
      if (lane.offset > 0) hi = -ONCOMING_KEEP;
      else lo = ONCOMING_KEEP;
    }
    this.blindMin = lo;
    this.blindMax = hi;
    this.oncomingSpeed = traffic ? traffic.speed : 0;
    this.brakeK.fill(1);
    this.steerK.fill(1);
    this.lookK.fill(1);
    this.apexK.fill(1);
    this.slipPush.fill(1);
    this.slipBrake.fill(1);
    this.shaken.fill(1);
    for (let i = 0; i < MAX_CARS; i++) this.traits.push(personality(i));
    const junctions = junctionsOf(track);
    this.mouthS = junctions.map((j) => j.mouthS);
    this.exitS = junctions.map((j) => j.exitS);
    this.mouthYaw = junctions.map((j) => j.mouthYaw);
    this.mouthTurn = junctions.map((j) => Math.abs(j.mouthTurn));
    this.exitTurn = junctions.map((j) => Math.abs(j.exitTurn));
    this.reset();
  }

  reset(): void {
    this.seg.fill(-1);
    this.spotSeg.fill(-1);
    this.route.fill(-1);
    this.routeSeg.fill(-1);
    this.tossed.fill(-1);
    this.lane.fill(0);
    this.stuck.fill(0);
    this.recover.fill(0);
    this.recoverSteer.fill(0);
    this.lastThrottle.fill(0);
    this.idle.fill(0);
    this.hunted.fill(0);
    this.noReverse.fill(0);
    this.planEvade.fill(0);
    this.meter.fill(1);
    this.burst.fill(0);
    this.clock.forgetAll();
    for (let i = 0; i < MAX_CARS; i++) this.pass.forget(i);
    this.standoff.reset();
    this.sighting.reset();
    this.planNosed.fill(0);
    this.endangered.fill(0);
    this.pedals.reset();
    this.slip.fill(0);
    this.cool.fill(0);
    this.wasCorner.fill(0);
    this.rolls.fill(0);
    this.mistakes.fill(0);
    this.busy.fill(0);
  }

  /** 0 avoids every hit … 1 rams regardless of its own state (see `mood`). */
  setAggression(id: number, a: number): void {
    this.aggression[id] = clamp(a, 0, 1);
  }

  /** The car's plan rate: once per 1 / (a rate rolled once in the difficulty's `THINK_HZ` band) s. */
  setDifficulty(id: number, d: AiDifficulty): void {
    const [lo, hi] = THINK_HZ[d];
    this.clock.setRate(id, lo + (hi - lo) * hash01(id, THINK_SALT));
    const k = AI_SKILL[d];
    this.push[id] = k.push[0] + (k.push[1] - k.push[0]) * hash01(id, SKILL_SALT.push);
    this.brakeK[id] = k.brake[0] + (k.brake[1] - k.brake[0]) * hash01(id, SKILL_SALT.brake);
    this.steerK[id] = k.steer[0] + (k.steer[1] - k.steer[0]) * hash01(id, SKILL_SALT.steer);
    this.lookK[id] = k.look[0] + (k.look[1] - k.look[0]) * hash01(id, SKILL_SALT.look);
    this.apexK[id] = k.apex[0] + (k.apex[1] - k.apex[0]) * hash01(id, SKILL_SALT.apex);
    this.wobble[id] = k.wobble[0] + (k.wobble[1] - k.wobble[0]) * hash01(id, SKILL_SALT.wobble);
    this.phase[id] = 2 * Math.PI * hash01(id, SKILL_SALT.phase);
    this.slipP[id] = k.slipP[0] + (k.slipP[1] - k.slipP[0]) * hash01(id, SKILL_SALT.slipP);
    this.slipPush[id] = k.slipPush;
    this.slipBrake[id] = k.slipBrake;
    this.shaken[id] = k.shaken;
    this.calm[id] = k.calm;
    this.reaction[id] = k.react[0] + (k.react[1] - k.react[0]) * hash01(id, SKILL_SALT.react);
    this.lookSeconds[id] = k.seconds[0] + (k.seconds[1] - k.seconds[0]) * hash01(id, SKILL_SALT.seconds);
    this.contestS[id] = k.contest[0] + (k.contest[1] - k.contest[0]) * hash01(id, SKILL_SALT.contest);
  }

  /** The input car `self` drives this step from its held one, after its hands: the contact guard runs every step, so a reaction to a car ahead never waits for the next plan (scratch output). `asked`: what the driver asked for when `held` is its hands' lagging take on it (`guardContact`'s `steer`). A car the guard newly finds in danger plans again next step. */
  guard(self: AiCar, others: readonly AiCar[], held: DriveInput, dt = 0, asked = held): DriveInput {
    const i = self.id;
    const tune = this.tunes[i]!;
    // A car that has not planned has no tune (`GUARD_LEAD_IDX` is never 0 once set): the guard would read zeros as a stopped leader.
    if (i >= this.racers || !self.alive || this.recover[i]! > 0 || tune[GUARD_LEAD_IDX] === 0) return held;
    const out = this.out;
    copyDrive(held, out);
    tune[GUARD_DT_IDX] = dt;
    guardContact(self, others, this.guarded, this.hitOf[i]!, tune, out, asked.steer);
    this.pedals.holdGuardBrake(i, out, dt);
    // A racer about to be busted, or crawling, keeps the gas and the boost it asked for: the guard still steers it clear, but never brakes it or holds it off the gas (reversing out stays).
    if (out.throttle >= 0 && (this.hunted[i] === 1 || hypot2(self.vx, self.vz) < CRAWL)) {
      out.brake = 0;
      out.throttle = Math.max(out.throttle, 1);
      out.boost = held.boost;
    }
    // The guarded throttle feeds the next stuck and off-the-gas tests (before the brake floor), and a boost it cancelled is given back to the meter.
    this.lastThrottle[i] = out.throttle;
    if (out.throttle <= 0) out.boost = false;
    if (held.boost && !out.boost) {
      this.meter[i] = this.meterWas[i]!;
      this.charge(i, false);
      this.pedals.stopBoost(i);
    }
    if (out.brake > 0 && out.throttle >= 0 && out.throttle < BRAKE_THROTTLE) out.throttle = BRAKE_THROTTLE;
    const danger = tune[GUARD_NEED_IDX]! > 0 || tune[GUARD_PUSH_IDX] !== 0;
    if (danger && this.endangered[i] === 0) this.clock.hurry(i);
    this.endangered[i] = danger ? 1 : 0;
    return out;
  }

  setClass(id: number, s: ClassStats): void {
    this.cls[id] = s;
  }

  /** Forget a car's route, line and recovery (after a respawn teleport); `seg` is the main-loop sample it was put on, −1 on a shortcut. */
  respawned(id: number, seg = -1): void {
    this.seg[id] = -1;
    this.spotSeg[id] = seg;
    this.route[id] = -1;
    this.routeSeg[id] = -1;
    this.lane[id] = 0;
    this.stuck[id] = 0;
    this.idle[id] = 0;
    this.hunted[id] = 0;
    this.noReverse[id] = 0;
    this.planEvade[id] = 0;
    this.recover[id] = 0;
    this.slip[id] = 0;
    this.cool[id] = 0;
    this.wasCorner[id] = 0;
    this.busy[id] = 0;
    this.clock.forget(id);
    this.pass.forget(id);
    this.standoff.forget(id);
    this.sighting.forget(id);
    this.planNosed[id] = 0;
    this.pedals.forget(id);
  }

  /** One step for `self`: plans again when due (`THINK_HZ`, staggered by car id), then drives its wheel and pedals to the plan (scratch output: apply it before the next call). */
  think(self: AiCar, others: readonly AiCar[], race: RaceAiState, dt: number): DriveInput {
    const out = clearDrive(this.out);
    const i = self.id;
    if (i < 0 || i >= MAX_CARS || !self.alive) return out;
    this.args[ARG_DT_IDX] = dt;
    if (this.recover[i]! > 0) return this.backOut(i, dt);
    this.risk[i] = this.placeRisk(i, race);
    const speed = hypot2(self.vx, self.vz);
    this.hunted[i] = this.huntedBy(self, others, speed) ? 1 : 0;
    const fresh = this.seg[i] === -1;
    this.projectMain(i, self, fresh);
    const replan = this.clock.due(i, dt);
    if (replan) this.pickRoute(i, race, self, others);
    this.projectRoute(i, self, speed);
    if (replan) this.replan(i, self, others, race);
    this.steer(i, self, speed, dt);
    this.pedal(i, speed, dt);
    this.finish(i, speed, dt, race.finishTime == null);
    return out;
  }

  /** The will to win: the share of the field ahead of car `i` (place 1 → 0, last → 1). */
  private placeRisk(i: number, race: RaceAiState): number {
    if (i >= this.racers || this.racers < 2 || this.aggression[i] === 0 || race.finishTime != null) return 0;
    return clamp(((race.place ?? 1) - 1) / (this.racers - 1), 0, 1);
  }

  /** Seconds of the back-out left for `i`: reverse with the nose swinging toward the line; it plans again when it ends. */
  private backOut(i: number, dt: number): DriveInput {
    const out = this.out;
    this.recover[i]! -= dt;
    if (this.recover[i]! <= 0) this.clock.hurry(i);
    out.throttle = REVERSE_THROTTLE;
    out.steer = this.recoverSteer[i]!;
    this.lastThrottle[i] = 0;
    this.charge(i, false);
    this.pedals.follow(i, out);
    return out;
  }

  private projectMain(i: number, self: AiCar, fresh: boolean): void {
    const half = this.track.path.half;
    const main = projectPath(this.track.path, self.x, self.z, fresh ? this.spotSeg[i]! : this.seg[i]!, this.mainProj);
    this.spotSeg[i] = -1;
    this.seg[i] = main.k;
    if (fresh) this.lane[i] = clamp(main.lateral, -half[main.k]!, half[main.k]!);
    this.args[ARG_MAIN_S_IDX] = main.s;
  }

  /** This step's place on the road: the loop or the shortcut being driven (a shortcut's end hands back to the loop), the car's heading and speed along it, and the slots of `args` a plan reads. */
  private projectRoute(i: number, self: AiCar, speed: number): void {
    const a = this.args;
    const tr = this.track;
    let route = this.route[i]!;
    let proj = this.mainProj;
    let path: TrackPath = tr.path;
    if (route >= 0) {
      const sc = tr.shortcuts[route]!;
      const sub = projectPath(sc.path, self.x, self.z, this.routeSeg[i]!, this.subProj);
      this.routeSeg[i] = sub.k;
      if (sub.s >= sc.path.length - 0.5) {
        this.route[i] = -1;
        this.routeSeg[i] = -1;
        route = -1;
      } else {
        proj = sub;
        path = sc.path;
      }
    }
    this.proj = proj;
    this.path = path;
    this.routeNow = route;
    this.surf = surfaceAt(path, proj.k);
    this.turnMax = turnRate(this.cls[i]!, speed, this.surf);
    const fx = detSin(self.yaw);
    const fz = detCos(self.yaw);
    this.along = self.vx * fx + self.vz * fz;
    this.toMouth = route >= 0 ? hypot2(self.x - path.x[0]!, self.z - path.z[0]!) : 0;
    this.early = route >= 0 && proj.s < 0.5 && this.toMouth > 4;
    a[ARG_S_IDX] = proj.s;
    a[ARG_HALF_IDX] = path.half[proj.k]!;
    a[ARG_LAT_IDX] = proj.lateral;
    a[ARG_FX_IDX] = fx;
    a[ARG_FZ_IDX] = fz;
    a[ARG_ALONG_IDX] = this.along;
    a[ARG_SPEED_IDX] = speed;
  }

  /** Re-plan car `i`: the lateral line (and the rate its lane moves to it), the speed target with and without boost, and what boxes it in. */
  private replan(i: number, self: AiCar, others: readonly AiCar[], race: RaceAiState): void {
    this.follow = Number.NaN;
    this.crossCap = Infinity;
    this.nosed = false;
    this.passing = false;
    this.nosedFree = false;
    this.chase = 0;
    this.swerve = 0;
    this.nudge = false;
    this.evading = false;
    const wanted = this.line(self, this.traits[i]!, others);
    if (this.crossCap < Infinity) this.follow = Math.min(Number.isNaN(this.follow) ? Infinity : this.follow, this.crossCap + 0.5);
    this.planWant[i] = this.routeNow < 0 ? wanted : 0;
    this.planRate[i] = this.nudge && !this.passing ? SHOVE_LAT : LANE_RATE * (1 + this.swerve);
    const clear = this.openRoad(i, self, others);
    this.busy[i] = clear ? 0 : 1;
    this.aimAtMouth(i, self, race);
    this.planSpeed(i, clear);
    this.planChase[i] = this.chase;
    this.planFollow[i] = this.follow;
    this.planNosed[i] = this.nosed && this.nosedFree ? 1 : 0;
    this.planEvade[i] = this.evading ? 1 : 0;
    if (i < this.racers) this.hitOf[i]!.set(this.hit);
    this.clock.planned(i);
  }

  /**
   * Onto a shortcut, until a look-ahead into it: the turn still to make onto its heading, from the car's heading and (short of the mouth,
   * `lead` m on) from the run in to the mouth. On the loop: the next mouth this lap's coin will take, planned before the coin is tossed.
   */
  private aimAtMouth(i: number, self: AiCar, race: RaceAiState): void {
    const route = this.routeNow;
    const path = this.path;
    this.entry = route;
    this.lead = this.early ? this.toMouth : 0;
    this.turnIn = route >= 0 && this.proj.s < LOOK ? Math.abs(wrapPi(this.mouthYaw[route]! - self.yaw)) : 0;
    if (this.early) this.turnIn = Math.max(this.turnIn, Math.abs(wrapPi(this.mouthYaw[route]! - detAtan2(path.x[0]! - self.x, path.z[0]! - self.z))));
    if (route < 0) this.upcoming(i, race);
  }

  /** The plan's speed targets: the road's, and (with meter in the bottle and nothing in the way) the one at the boosted top. */
  private planSpeed(i: number, clear: boolean): void {
    const a = this.args;
    const cls = this.cls[i]!;
    const top = cls.topSpeed;
    a[ARG_TOP_IDX] = top;
    let target = this.plan(i, this.path, this.routeNow);
    if (this.slipP[i]! > 0 && this.slipCheck(i, target < SLIP_CORNER * top, clear, this.clock.ageOf(i))) target = this.plan(i, this.path, this.routeNow);
    this.planTarget[i] = target;
    this.planBoosted[i] = 0;
    if (Number.isNaN(this.follow) && this.meter[i]! > BURST_STOP) {
      a[ARG_TOP_IDX] = top * cls.boostTop;
      this.planBoosted[i] = this.plan(i, this.path, this.routeNow);
    }
  }

  /** Wheel: pure pursuit to the point a look-ahead on along the lane, which moves to the plan's line at its rate. */
  private steer(i: number, self: AiCar, speed: number, dt: number): void {
    const a = this.args;
    const proj = this.proj;
    const rate = this.planRate[i]! * dt;
    this.lane[i] = this.routeNow < 0 ? this.lane[i]! + clamp(this.planWant[i]! - this.lane[i]!, -rate, rate) : 0;
    const lane = this.lane[i]!;
    const clear = this.busy[i] === 0;
    const ld = clamp(5 + 0.5 * speed, 7, LOOK) * (clear ? this.lookK[i]! : 1);
    a[ARG_AHEAD_IDX] = this.early ? 2 : proj.s + ld;
    const pt = this.pointAhead(this.path, this.routeNow);
    const tx = pt.x + pt.tz * lane;
    const tz = pt.z - pt.tx * lane;
    this.alpha = wrapPi(detAtan2(tx - self.x, tz - self.z) - self.yaw);
    this.reach = this.early ? Math.max(4, hypot2(tx - self.x, tz - self.z)) : ld;
    this.omega = (2 * Math.max(speed, 4) * detSin(this.alpha)) / this.reach;
    this.out.steer = clamp((this.omega * (clear ? this.steerK[i]! : 1)) / Math.max(0.2, this.turnMax), -1, 1);
  }

  /** Off the road, a pursuit asking for more than full lock is a corner the plan does not see: the speed the car can turn back onto the line at (Infinity: none). */
  private offRoadArc(i: number): number {
    if (Math.abs(this.proj.lateral) <= this.path.half[this.proj.k]! || Math.abs(this.omega) <= this.turnMax) return Infinity;
    return arcSpeed(this.cls[i]!, this.reach, this.alpha, this.surf);
  }

  /** Boost button: asked for on a clear run while the plan at the boosted top wants more speed, held for a minimum burst, let go at once when boxed in, braking, off the road or out of meter. */
  private boostButton(i: number, arc: number, dt: number): boolean {
    const follow = this.planFollow[i]!;
    const burst = this.burst[i] === 1;
    const evade = this.planEvade[i] === 1;
    const boosted = this.planBoosted[i]!;
    const gate = Math.max(this.planChase[i]! > 0 ? BOOST_ALPHA_CHASE : BOOST_ALPHA, burst || evade ? BOOST_ALPHA_KEEP : 0);
    const want = Number.isNaN(follow) && this.meter[i]! > (burst || evade ? BURST_STOP : BURST_MIN) && Math.abs(this.alpha) < gate && boosted > this.along + (evade ? 0 : burst ? BOOST_KEEP_SHORT : BOOST_SHORT);
    const cut = !Number.isNaN(follow) || arc < boosted || this.meter[i]! <= BURST_STOP || this.pedals.isBraking(i);
    return this.pedals.holdBoost(i, want, dt, cut);
  }

  /** Throttle and brake for the plan's speed: gas to the target itself (`applyDrive` runs to throttle × top at full rate), brake over a band, both slewed by the hands. */
  private pedal(i: number, speed: number, dt: number): void {
    const out = this.out;
    const cls = this.cls[i]!;
    const follow = this.planFollow[i]!;
    const hunted = this.hunted[i] === 1;
    const evade = this.planEvade[i] === 1 && Number.isNaN(follow);
    const arc = this.offRoadArc(i);
    const boost = hunted ? this.pedals.holdBoost(i, this.meter[i]! > BURST_STOP && Math.abs(this.alpha) < BOOST_ALPHA_CHASE, dt, this.meter[i]! <= BURST_STOP) : this.boostButton(i, arc, dt);
    out.boost = boost;
    const target = Math.min(Number.isNaN(follow) ? (boost ? this.planBoosted[i]! : this.planTarget[i]!) : Math.min(this.planTarget[i]!, Math.max(0, follow - 0.5)), arc);
    const excess = this.along - target;
    const brake = brakeOver(this.pedals, i, excess);
    this.noReverse[i] = Math.max(0, this.noReverse[i]! - dt);
    if (Math.abs(this.alpha) > 1.9 && (speed < 6 || this.along < 0)) {
      // Facing away from the line: the rear is the nearer end, so reverse with the lock toward it; blocked behind, go forward instead.
      out.throttle = this.noReverse[i]! > 0 ? TURN_ROUND_THROTTLE : REVERSE_THROTTLE;
      out.steer = Math.sign(this.alpha) || this.traits[i]!.side;
    } else if (hunted) {
      out.throttle = 1;
    } else if (brake === 0) {
      // A soft surface's drag is the drive's own: a target over its terminal is simply not reached (`plan` caps the targets at it), and one under it needs no more
      // throttle than its share of the top (the push is the full engine whenever the car is under `want`).
      out.throttle = evade ? 1 : clamp(target / (cls.topSpeed * (boost ? cls.boostTop : 1)), excess < -0.4 ? 0.35 : 0, 1);
    } else {
      out.brake = brake;
      out.throttle = BRAKE_THROTTLE;
    }
    this.pedals.shape(i, out, dt);
  }

  /** The contact guard's tune for a racer, the stuck test (throttle held without motion starts a back-out: unchanged) and the boost meter. */
  private finish(i: number, speed: number, dt: number, racing: boolean): void {
    const out = this.out;
    const p = this.traits[i]!;
    if (i < this.racers) this.tuneGuard(i, dt);
    const last = this.lastThrottle[i]!;
    if (Math.abs(last) > 0.35 && speed < STUCK_SPEED) this.stuck[i]! += dt;
    else this.stuck[i] = Math.max(0, this.stuck[i]! - dt * 2);
    // Reversing is gas: only a racer at a crawl with the gas off (or just a brake floor on) counts idle, and it resets the moment the gas is back.
    this.idle[i] = racing && i < this.racers && last >= 0 && last <= BRAKE_THROTTLE && speed < OFF_GAS_SPEED ? this.idle[i]! + dt : 0;
    // The plan's own throttle: the guard holds a clean car short of the one on its nose, and its guarded throttle is 0.
    const nosed = i < this.racers && this.standoff.watch(i, speed, out.throttle, this.planNosed[i] === 1, dt);
    const standoff = nosed || this.idle[i]! > OFF_GAS_S;
    const jammed = this.stuck[i]! > (this.hunted[i] === 1 ? BUST_STUCK_S : p.patience + 0.4);
    if (jammed && !standoff && last < 0) {
      // Stuck while reversing: something is behind it, so it turns round going forward for a while.
      this.stuck[i] = 0;
      this.noReverse[i] = REVERSE_LOCKOUT_S;
    } else if (standoff || jammed) {
      this.stuck[i] = 0;
      this.idle[i] = 0;
      this.recover[i] = standoff ? STANDOFF_BACKOFF_S : 0.9 + 0.4 * p.patience;
      this.recoverSteer[i] = Math.sign(this.alpha) || p.side;
      out.throttle = REVERSE_THROTTLE;
      out.brake = 0;
      out.boost = false;
      out.steer = this.recoverSteer[i]!;
      this.pedals.follow(i, out);
    }
    this.lastThrottle[i] = out.throttle;
    if (out.throttle <= 0 && out.boost) {
      out.boost = false;
      this.pedals.stopBoost(i);
    }
    this.meterWas[i] = this.meter[i]!;
    this.charge(i, out.boost);
  }

  /** A racer under `BUST.kph` within `BUST.near` m of a live police car (ids from `guarded` up): a bust is on the clock. */
  private huntedBy(self: AiCar, others: readonly AiCar[], speed: number): boolean {
    if (self.id >= this.racers || speed * 3.6 >= BUST.kph) return false;
    for (let j = 0; j < others.length; j++) {
      const o = others[j]!;
      if (o.id >= this.guarded && o.alive && hypot2(o.x - self.x, o.z - self.z) <= BUST.near) return true;
    }
    return false;
  }

  /**
   * Last rule, for a racer (police drive this line too and hit on purpose): no car it is closing on is driven into, except the ones it means to hit (`hit`).
   * It counts on `BRAKE_SHARE` of its own brake, and a car ahead is taken to shed the car's whole class brake (what the leader really can: measured 26-28 m/s²): the leader
   * braking harder only raises the closing speed, so the follower is never counting on a gentler stop than the leader can make. `guard` runs it every step, on what the car sees now.
   */
  private tuneGuard(i: number, dt: number): void {
    const cls = this.cls[i]!;
    const g = this.tunes[i]!;
    g[GUARD_BRAKE_IDX] = cls.brake * BRAKE_SHARE;
    g[GUARD_LEAD_IDX] = cls.brake;
    g[GUARD_TURN_IDX] = this.turnMax;
    g[GUARD_GRIP_IDX] = tyreHold(cls, this.surf);
    g[GUARD_DT_IDX] = dt;
    g[GUARD_RISK_IDX] = this.risk[i]!;
    g[GUARD_RIVALS_IDX] = this.racers;
    g[GUARD_CONTEST_IDX] = this.contestS[i]! * this.risk[i]!;
  }

  /** The lane (m) round the stopped cars ahead (`WreckPass`): always on the gas, at the biggest gap when every lane is held. */
  private passRound(i: number, want: number, room: number, look: number, s: number): number {
    let lane = this.pass.choose(i, want, this.lane[i]!, room, look);
    // Every lane of the strand held: at a crossing the other arm's road lies beside it, the way round.
    if (this.pass.blockaded && this.openBeside(s, room, this.lane[i]!)) lane = this.pass.choose(i, want, this.lane[i]!, room + CROSS_ROOM, look);
    this.swerve = Math.max(this.swerve, WRECK_SWERVE);
    this.nosedFree = true;
    this.evading = true;
    return lane;
  }

  /** Whether the walls are down and road lies on both sides of the strand `PASS_LOOK_FLOOR` m on, out to `room + CROSS_ROOM`: the other arm of a crossing. A car already out there (`lane`) keeps it. */
  private openBeside(s: number, room: number, lane: number): boolean {
    if (Math.abs(lane) > room) return true;
    const path = this.track.path;
    const k = sampleAt(path, s + PASS_LOOK_FLOOR);
    if (path.wallL[k] !== 0 || path.wallR[k] !== 0) return false;
    const p = this.track.pointAt(s + PASS_LOOK_FLOOR, this.pt);
    for (let side = -1; side <= 1; side += 2) {
      const w = side * (room + CROSS_ROOM);
      projectPath(path, p.x + p.tz * w, p.z - p.tx * w, -1, this.seeProj);
      if (Math.abs(this.seeProj.lateral) > path.half[this.seeProj.k]! - EDGE) return false;
    }
    return true;
  }

  /** No car close on its line this call (`follow`, `swerve`, `nudge`) and none within `calm` m: skill errors and the skill line are for an open road. */
  private openRoad(i: number, self: AiCar, others: readonly AiCar[]): boolean {
    if (!Number.isNaN(this.follow) || this.swerve !== 0 || this.nudge || this.passing) return false;
    const calm = this.calm[i]!;
    for (let j = 0; calm > 0 && j < others.length; j++) {
      const o = others[j]!;
      if (o.id !== i && hypot2(o.x - self.x, o.z - self.z) < calm) return false;
    }
    return true;
  }

  private charge(i: number, boosting: boolean): void {
    this.meter[i] = chargeBoost(this.meter[i]!, boosting, this.args[ARG_DT_IDX]!);
    this.burst[i] = boosting ? 1 : 0;
  }

  /** A bonus onto car `i`'s meter (drafting, `DRAFT.bonus`), as `DriverSeat.addBoost` does for the player. */
  addBoost(i: number, amount: number): void {
    this.meter[i] = topUpBoost(this.meter[i]!, amount);
  }

  /** Main loop or a designed shortcut: one seeded coin per car, lap and shortcut. */
  private pickRoute(i: number, race: RaceAiState, self: AiCar, others: readonly AiCar[]): void {
    if (this.route[i]! >= 0) return;
    const mainS = this.args[ARG_MAIN_S_IDX]!;
    const tr = this.track;
    const n = tr.gates.length;
    for (let k = 0; k < tr.shortcuts.length; k++) {
      if ((tr.shortcuts[k]!.from + 1) % n !== race.next) continue;
      let ahead = this.mouthS[k]! - mainS;
      if (ahead < -tr.length * 0.5) ahead += tr.length;
      if (ahead < 0 || ahead > COMMIT) continue;
      const key = race.lap * 8 + k;
      if (this.tossed[i] === key) continue;
      this.tossed[i] = key;
      if (this.takes(i, race.lap, k) && !this.crowded(k, self, others)) {
        this.route[i] = k;
        this.routeSeg[i] = -1;
      }
      return;
    }
  }

  /** A racer already on shortcut `k` within `MOUTH_GAP` m of `self`: the narrow mouth takes one car at a time, the next stays on the loop. */
  private crowded(k: number, self: AiCar, others: readonly AiCar[]): boolean {
    for (let n = 0; n < others.length; n++) {
      const o = others[n]!;
      if (o.id !== self.id && o.id < this.racers && hypot2(o.x - self.x, o.z - self.z) < MOUTH_GAP) return true;
    }
    return false;
  }

  /** The car's seeded coin for shortcut `k` on lap `lap`: heads (take it) 0.3 + 0.4 × aggression of the time. */
  private takes(i: number, lap: number, k: number): boolean {
    return hash01(i * 31 + lap, 13 + k) < 0.3 + 0.4 * this.aggression[i]!;
  }

  /** Before the coin is tossed (just past a shortcut's from-gate, as little as 10 m short of its mouth): the next mouth this lap's coin will take, as `entry`, `lead` and `turnIn`. */
  private upcoming(i: number, race: RaceAiState): void {
    const mainS = this.args[ARG_MAIN_S_IDX]!;
    const tr = this.track;
    const n = tr.gates.length;
    for (let k = 0; k < tr.shortcuts.length; k++) {
      const from = tr.shortcuts[k]!.from;
      if (from !== race.next && (from + 1) % n !== race.next) continue;
      let ahead = this.mouthS[k]! - mainS;
      if (ahead < -tr.length * 0.5) ahead += tr.length;
      // A from-gate on the line is crossed into the next lap, so the coin is tossed for that lap.
      const lap = from === 0 && race.next === 0 ? race.lap + 1 : race.lap;
      if (ahead < 0 || this.tossed[i] === lap * 8 + k || !this.takes(i, lap, k)) continue;
      this.entry = k;
      this.lead = ahead;
      this.turnIn = this.mouthTurn[k]!;
      return;
    }
  }

  /** Point `s` m along the route being driven, running on into the main loop past a shortcut's end. */
  private pointAhead(path: TrackPath, route: number): TrackPoint {
    const s = this.args[ARG_AHEAD_IDX]!;
    if (route < 0) return this.track.pointAt(s, this.pt);
    if (s <= path.length) return pointOn(path, s, this.pt);
    return this.track.pointAt(this.exitS[route]! + (s - path.length), this.pt);
  }

  /**
   * Seeded mistake: ages car `i`'s timers by `dt` every think; on the edge where a corner comes into the plan (`corner`), with the cooldown over
   * and an open road (`roll`), rolls `slipP` (roll count and car id seed the hash: the same field slips at the same corners every run). True when one starts.
   */
  private slipCheck(i: number, corner: boolean, roll: boolean, dt: number): boolean {
    this.slip[i] = Math.max(0, this.slip[i]! - dt);
    this.cool[i] = Math.max(0, this.cool[i]! - dt);
    const edge = corner && this.wasCorner[i] === 0;
    this.wasCorner[i] = corner ? 1 : 0;
    if (!roll || !edge || this.cool[i]! > 0 || hash01(i + 64 * this.rolls[i]!++, SKILL_SALT.slipRoll) >= this.slipP[i]!) return false;
    this.slip[i] = SLIP_WINDOW + SLIP_RECOVER;
    this.cool[i] = SLIP_COOL;
    this.mistakes[i]!++;
    return true;
  }

  /** Highest speed now (up to `top`) that still makes every turn ahead within the braking budget. */
  private plan(i: number, path: TrackPath, route: number): number {
    const a = this.args;
    const s = a[ARG_S_IDX]!;
    const speed = a[ARG_SPEED_IDX]!;
    const top = a[ARG_TOP_IDX]!;
    const tr = this.track;
    const cls = this.cls[i]!;
    // A mistake (`slip`) first plans corners faster and braking later than the car can keep to (`SLIP_WINDOW`), then the driver is shaken and holds back to `shaken` x top speed (`SLIP_RECOVER`). In traffic (`busy`) the car plans as hard does.
    const open = this.busy[i] === 0;
    const slip = open ? this.slip[i]! : 0;
    const over = slip > SLIP_RECOVER;
    const risk = this.risk[i]!;
    const decel = cls.brake * BRAKE_SHARE * (1 + RISK_BRAKE * risk) * (open ? this.brakeK[i]! : 1) * (over ? this.slipBrake[i]! : 1);
    const push = (1 + RISK_PUSH * risk) * (open ? this.push[i]! : 1) * (over ? this.slipPush[i]! : 1);
    let best = slip > 0 && !over ? top * this.shaken[i]! : top;
    // A shortcut meets the loop at an angle neither path's curvature shows: the turns into its mouth and back onto the loop are corners too.
    if (this.entry >= 0) best = Math.min(best, this.junction(cls, this.turnIn, surfaceAt(tr.shortcuts[this.entry]!.path, 0), this.lead, decel));
    if (route >= 0) best = Math.min(best, this.junction(cls, this.exitTurn[route]!, surfaceAt(path, path.count - 1), this.lead + path.length - s, decel));
    const reach = (speed * speed) / (2 * decel) + 12;
    for (let d = 0; d <= reach; d += 3) {
      let pp = path;
      let ss = s + d;
      if (route >= 0 && ss > path.length) {
        pp = tr.path;
        ss = this.exitS[route]! + (ss - path.length);
      }
      const k = sampleAt(pp, ss);
      const surf = surfaceAt(pp, k);
      const curv = Math.abs(pp.curv[k]!);
      // The AI lifts over a crest it would fly, like a driver over a blind crest (`crestSpeed`); a soft surface's drag caps the straight at `terminalSpeed`.
      const corner = Math.min(top, terminalSpeed(cls, rollingOver(tyreRoll(cls.tyre, surf))), curv > STRAIGHT_CURV ? cornerSpeed(cls, CORNER_MARGIN / curv, tyreGrip(cls.tyre, surf)) * push : Infinity, crestSpeed(pp, ss));
      const allow = Math.sqrt(corner * corner + 2 * decel * d);
      if (allow < best) best = allow;
    }
    return best;
  }

  /** Speed now that still makes a `turn` (rad) junction `d` m on, the turn spread over the pursuit's look-ahead. */
  private junction(cls: ClassStats, turn: number, surf: Surface, d: number, decel: number): number {
    if (turn < 0.05) return Infinity;
    const corner = cornerSpeed(cls, (CORNER_MARGIN * LOOK) / turn, tyreGrip(cls.tyre, surf));
    return Math.sqrt(corner * corner + 2 * decel * d);
  }

  /**
   * Whether shoving the car `ahead` m on and `side` m to the left (its lateral `oLat`) is safe: a shove, not a ram (the two cars' speeds along the road,
   * with the sideways speed they close at, come to less than `SHOVE_SPEED`), with `WALL_ROOM` m of road beyond it on the side it is pushed to, and not over a crest.
   */
  private safeShove(s: number, half: number, oLat: number, side: number, ahead: number, along: number, oAlong: number): boolean {
    // The rival may be shoving too, so the sideways closing counts twice.
    if (hypot2(along - oAlong, 2 * SHOVE_LAT) >= SHOVE_SPEED) return false;
    if (half - (side >= 0 ? oLat : -oLat) < WALL_ROOM) return false;
    return crestSpeed(this.track.path, s + ahead) > Math.max(along, oAlong);
  }

  /** Whether the car `o` (`dist` m away; `onRoute`: projected onto the road in `seeProj`; the driver at arc `s` seeing `sightArc` m of road) is in view: near, in the mirrors, or on the road within the stretch the bends leave open. */
  private inView(o: AiCar, dist: number, ahead: number, onRoute: boolean, s: number, sightArc: number): boolean {
    if (dist < SEEN_NEAR) return true;
    if (ahead <= 0) return dist < SEEN_BEHIND;
    if (!onRoute) return true;
    const path = this.path;
    const at = this.seeProj;
    if (Math.abs(at.lateral) > path.half[at.k]! + SEEN_CORRIDOR) return dist < SEEN_OFFROAD;
    let arc = at.s - s;
    if (path.closed) arc -= path.length * Math.round(arc / path.length);
    return arc <= sightArc;
  }

  /** The sideways distance (m, + = left of travel) the car `o` (projected in `seeProj`), `ahead` m on, will have moved across the road by the time we reach it, from its speed across the road now. */
  private driftBy(o: AiCar, onRoute: boolean, ahead: number, closing: number): number {
    if (!onRoute) return 0;
    const k = this.seeProj.k;
    const acrossSpeed = o.vx * this.path.tz[k]! - o.vz * this.path.tx[k]!;
    return clamp(acrossSpeed * Math.min(PREDICT_S, ahead / Math.max(closing, 1)), -PREDICT_MAX, PREDICT_MAX);
  }

  /**
   * The speed that reaches the crossing of car `o` (cutting across our way, moving at least `CRAWL`), within `look` m along our heading,
   * only after it has cleared it; Infinity when we clear it first with time to spare at `go` m/s (a trailing racer's will to win spares less), are in it already, or it is gone.
   */
  private crossingCap(self: AiCar, o: AiCar, go: number, look: number): number {
    const fx = detSin(self.yaw);
    const fz = detCos(self.yaw);
    const gx = detSin(o.yaw);
    const gz = detCos(o.yaw);
    const sin = fx * gz - fz * gx;
    const oAlong = o.vx * gx + o.vz * gz;
    if (Math.abs(sin) < CROSS_SIN || oAlong < CRAWL) return Infinity;
    // Where the two headings meet: `t` m along ours, `u` m along its.
    const dx = o.x - self.x;
    const dz = o.z - self.z;
    const t = (dx * gz - dz * gx) / sin;
    const u = (dx * fz - dz * fx) / sin;
    if (t <= CROSS_CLEAR || t > look + CROSS_CLEAR || u < -CROSS_CLEAR) return Infinity;
    const itLeaves = (u + CROSS_CLEAR) / oAlong + CROSS_MARGIN_S;
    if ((t + CROSS_CLEAR) / go + CROSS_MARGIN_S * (1 - this.risk[self.id]!) < (u - CROSS_CLEAR) / oAlong) return Infinity;
    return (t - CROSS_CLEAR) / itLeaves;
  }

  /** How many cars other than `blocker` hold `lane` (m): this call's cars ahead, up to `HELD_BEYOND` past the blocker, within a lane width of it. With `mark` it spares the traffic cars among them from the contact guard (`hit`): the racer pushes through them (a rival is always the guard's business). */
  private laneHeld(lane: number, blocker: number, blockerAhead: number, mark = false): number {
    let n = 0;
    for (let k = 0; k < this.nearCount; k++) {
      if (this.nearId[k] !== blocker && this.nearAhead[k]! < blockerAhead + HELD_BEYOND && Math.abs(this.nearLat[k]! - lane) < LINE_W + 0.4) {
        n++;
        if (mark && this.nearId[k]! >= this.racers) this.hit[this.nearId[k]!] = 1;
      }
    }
    return n;
  }

  /** Both sides of a car are held: follow it (its speed, a car's length behind), and wait for a gap. */
  private followBoxedIn(i: number, blockerAlong: number, blockerAhead: number): void {
    const decel = this.cls[i]!.brake * BRAKE_SHARE;
    this.follow = blockerAlong + Math.sqrt(2 * decel * Math.max(0, blockerAhead - FOLLOW_STOP_GAP));
  }

  /** Lateral target (m, + = left of travel) on the main loop; sets `follow` when boxed in. */
  private line(self: AiCar, p: Personality, others: readonly AiCar[]): number {
    const a = this.args;
    const s = a[ARG_S_IDX]!;
    const half = a[ARG_HALF_IDX]!;
    const lat = a[ARG_LAT_IDX]!;
    const fx = a[ARG_FX_IDX]!;
    const fz = a[ARG_FZ_IDX]!;
    const along = a[ARG_ALONG_IDX]!;
    const i = self.id;
    this.pass.begin(i, this.clock.ageOf(i));
    // A car going round another does so at a creep at least: two cars stopped nose to nose have no closing speed, but each is a blocker to the other.
    const driveAlong = Math.max(along, PASS_CREEP);
    const age = this.clock.ageOf(i);
    const sightArc = this.routeNow < 0 ? visibleStretch(this.path, s, 1) : SIGHT_MAX;
    const seconds = this.lookSeconds[i]!;
    const reaction = this.reaction[i]!;
    const passLook = lookDistance(driveAlong, seconds, PASS_LOOK_FLOOR, sightArc);
    // The speed a crossing is taken at if we go first: halfway from now to the last plan's target (we pick up speed on the way).
    const goSpeed = (driveAlong + Math.max(driveAlong, this.planTarget[i]!)) / 2;
    this.nearCount = 0;
    const tr = this.track;
    const room = Math.max(0, half - EDGE);
    // Traffic distances below were tuned at `PACE`; faster, they stretch with speed (the same time ahead).
    const pace = Math.max(1, along / PACE);
    let curv = 0;
    for (let d = 10; d <= 34; d += 6) curv += tr.path.curv[sampleAt(tr.path, s + d)]!;
    curv /= 5;
    // The skill line (apex share, sway) holds on an open road only; `busy` is the last think's (this one's traffic scan is below).
    const open = this.busy[i] === 0;
    let raw = Math.sign(curv) * Math.min(1, Math.abs(curv) * 30) * half * (0.45 * (open ? this.apexK[i]! : 1)) + p.side * LINE_SIDE_BIAS;
    if (open && this.wobble[i]! !== 0) raw += this.wobble[i]! * detSin(WOBBLE_K * s + this.phase[i]!);
    let want = clamp(raw, -room, room);
    // Blind round a bend with oncoming traffic in the field (ids `racers` up to `guarded`): keep to our own half; with none there is nothing to meet.
    if (this.guarded > this.racers && this.routeNow < 0 && sightArc < (driveAlong + this.oncomingSpeed) * seconds) want = clamp(want, Math.max(-room, this.blindMin), Math.min(room, this.blindMax));
    const aggr = this.aggression[i]!;
    let blocker = -1;
    let blockerAhead = Infinity;
    let blockerSide = 0;
    let blockerAlong = 0;
    let blockerFight = 0;
    let prey = -1;
    let preyAhead = Infinity;
    let preySide = 0;
    let preyFight = 0;
    let chaseAhead = -Infinity;
    let chaseLat = 0;
    for (let n = 0; n < others.length; n++) {
      const o = others[n]!;
      if (o.id === i) continue;
      const dx = o.x - self.x;
      const dz = o.z - self.z;
      const ahead = dx * fx + dz * fz;
      // Left of travel = (fz, −fx).
      const side = dx * fz - dz * fx;
      const dist = hypot2(dx, dz);
      const onRoute = ahead > 0 && this.routeNow < 0;
      if (onRoute) projectPath(this.path, o.x, o.z, sampleAt(this.path, s + ahead), this.seeProj);
      // A car not in view (round a bend, behind a wall) or not yet noticed is nobody's business: the contact guard leaves it alone too.
      if (!this.sighting.reacts(i, o.id, this.inView(o, dist, ahead, onRoute, s, sightArc), age, reaction)) {
        this.hit[o.id] = 1;
        continue;
      }
      const oAlong = o.vx * fx + o.vz * fz;
      const closing = closingSpeed(self.vx, self.vz, o.vx, o.vz, dx, dz, dist);
      const look = lookDistance(closing, seconds, SCAN * pace, sightArc);
      if (o.id >= this.racers) this.crossCap = Math.min(this.crossCap, this.crossingCap(self, o, goSpeed, passLook));
      const predicted = ahead > 0 ? side + this.driftBy(o, onRoute, ahead, closing) : side;
      if (ahead > 0 && ahead < NOSE_GAP && Math.abs(side) < NOSE_HALF) this.nosed = true;
      const inWay = Math.abs(predicted) < LINE_W + 0.4 || Math.abs(lat + predicted - this.lane[i]!) < LINE_W;
      if (ahead > -HELD_TAIL && ahead < look && this.nearCount < NEAR_CARS) {
        this.nearId[this.nearCount] = o.id;
        this.nearAhead[this.nearCount] = ahead;
        this.nearLat[this.nearCount] = lat + predicted;
        this.nearCount++;
      }
      const rival = o.id < this.racers;
      // A rival it contests the crossing with (`contests`) is neither passed round nor followed: the car goes for the crossing.
      const contest = rival && contests(self, o, this.risk[i]!, this.contestS[i]! * this.risk[i]!);
      // A cop, a crawling or stopped racer and a dead car steer the lane choice but never slow the pass (`WreckPass` soft): they are passed at speed. Total speed, not `oAlong`: an oncoming or backing racer stays hard.
      if (!contest && oAlong < CRAWL && driveAlong > oAlong + 0.3 && ahead < passLook) this.pass.note(ahead, lat + side, o.id >= this.guarded || !o.alive || (rival && hypot2(o.vx, o.vz) < CRAWL));
      if (rival) this.pass.noteRival(o.id, ahead);
      // Rivals: fight or keep clear by mood (aggression, both cars' damage); traffic is only avoided. Only at racing pace, both
      // cars rolling on: two hungry cars that met slow or stopped brawled on a wall until both were out of the race.
      const rolling = along > FIGHT_PACE && oAlong > 0.6 * FIGHT_PACE;
      let m = rival ? mood(aggr, self.damage, o.damage) : -1;
      // A careful driver (aggression up to `CAREFUL`) fights only a rival it is on terms with and can shove safely; the others fight by `mood` alone.
      if (rival && rolling && aggr > 0 && aggr <= CAREFUL && m + SAFE_SHOVE > 0) {
        const near = ahead > -11 && ahead < HUNT * pace && Math.abs(side) < HUNT_SIDE;
        m = near && this.safeShove(s, half, lat + side, side, ahead, along, oAlong) ? m + SAFE_SHOVE : Math.min(m, 0);
      }
      const fight = rolling ? clamp(m, 0, 1) : 0;
      const shy = clamp(-m, 0, 1) * (1 - this.risk[i]!);
      this.hit[o.id] = fight > 0 ? 1 : 0;
      if (fight > 0 && aggr <= CAREFUL) this.nudge = true;
      // Whatever is ahead on our line and slower than we want to go (not only than we go now) is a blocker: the way round it is looked for, never a gap kept behind it.
      if (!contest && ahead > 0.5 && ahead < look && inWay && ahead < blockerAhead && Math.max(driveAlong, this.planTarget[i]!) > oAlong + 0.3) {
        blockerFight = fight;
        blocker = o.id;
        blockerAhead = ahead;
        blockerSide = predicted;
        blockerAlong = oAlong;
      }
      // A faster racer or a live cop behind in our lane, closing so its zone reaches us within the guard's `HORIZON`: it is the one to evade.
      const catchUp = oAlong - along;
      if (i < this.racers && (rival || o.id >= this.guarded) && o.alive && ahead < 0 && catchUp > 0.5 && Math.abs(side) < LINE_W && -ahead - NOSE_GAP < HORIZON * catchUp && ahead > chaseAhead) {
        chaseAhead = ahead;
        chaseLat = lat + side;
      }
      if (!rival) continue;
      const oLat = lat + side;
      // Both rolling and overlapping lengthwise: the lane keeps a car width off it, on the side it is on (the grid's
      // two files, 4 m stagger, all steered for the middle and met nose to tail there).
      if (rolling && Math.abs(ahead) < ABREAST && Math.abs(side) > 0.7) want = side > 0 ? Math.min(want, oLat - LINE_W - 0.9) : Math.max(want, oLat + LINE_W + 0.9);
      if (ahead < -1 && ahead > -11 && Math.abs(side) < 4.5 && oAlong > along + 0.5) {
        if (fight > 0) {
          want += (oLat - want) * Math.min(1, fight * 1.5);
          this.swerve = Math.max(this.swerve, fight);
        } else want += Math.sign(want - oLat || 1) * shy * 2;
      } else if (Math.abs(ahead) < 4 && Math.abs(side) < 4) {
        if (fight > 0) {
          want += (oLat - want) * Math.min(1, fight * 1.5);
          this.swerve = Math.max(this.swerve, fight);
        } else want -= Math.sign(side) * shy * 1.5;
      } else if (fight > 0 && ahead >= 4 && ahead < preyAhead && ahead < HUNT * pace && Math.abs(side) < HUNT_SIDE) {
        prey = o.id;
        preyAhead = ahead;
        preySide = side;
        preyFight = fight;
      }
    }
    if (chaseAhead > -Infinity) {
      // Gas on and the lane a car width clear of the chaser (the other side at a wall): `pedal`/`boostButton` read `evading`.
      this.evading = true;
      this.swerve = Math.max(this.swerve, WRECK_SWERVE);
      const away = want >= chaseLat ? 1 : -1;
      const to = chaseLat + away * (LINE_W + 0.9);
      want = Math.abs(to) <= room ? to : chaseLat - away * (LINE_W + 0.9);
    }
    if (prey >= 0) {
      // Hunting a rival ahead: onto its line to push it from behind or, with more fight, offset by `PIT_OFFSET` to the side it leans
      // to (ours by habit when dead ahead), so the nose catches its rear quarter and the car comes up door to door.
      const off = preyFight > PIT_FIGHT ? (Math.abs(preySide) > 0.3 ? Math.sign(preySide) : -p.side) * PIT_OFFSET : 0;
      const aim = lat + preySide - off;
      want += (aim - want) * Math.min(1, preyFight * 1.5);
      this.chase = preyFight;
    }
    if (blocker >= 0 && blockerFight > 0) {
      this.chase = blockerFight;
      return clamp(lat + blockerSide, -room, room);
    }
    if (blocker >= 0 && blockerAlong < 0) this.swerve = Math.max(this.swerve, 2);
    if (this.pass.blocks(want, this.lane[i]!)) return this.passRound(i, want, room, passLook, s);
    if (blocker >= 0) {
      this.passing = true;
      const oLat = lat + blockerSide;
      // The line is a gap, not a slot: the lane nearest the wanted one that the blocker and the cars about it leave clear. Its nearest candidates are the road's edges, the wanted line and a flank gap off each car.
      let n = 0;
      this.cand[n++] = want;
      this.cand[n++] = -room;
      this.cand[n++] = room;
      this.cand[n++] = oLat - FLANK_GAP;
      this.cand[n++] = oLat + FLANK_GAP;
      for (let k = 0; k < this.nearCount; k++) {
        if (this.nearId[k] === blocker || this.nearAhead[k]! >= blockerAhead + HELD_BEYOND) continue;
        this.cand[n++] = this.nearLat[k]! - FLANK_GAP;
        this.cand[n++] = this.nearLat[k]! + FLANK_GAP;
      }
      // Fewest holders first (none: free), then nearest the wanted line. A lane the blocker itself holds is no side at all.
      let best = Number.NaN;
      let bestHeld = Infinity;
      let bestCost = Infinity;
      for (let k = 0; k < n; k++) {
        const c = clamp(this.cand[k]!, -room, room);
        if (Math.abs(c - oLat) < LINE_W + 0.4) continue;
        const held = this.laneHeld(c, blocker, blockerAhead);
        // Met head-on, or on a car stopped or crawling (it closes at our whole speed, or most of it): round it on the side with more road beside it. The planned lane is no guide here: it carries the yield nudge for a faster car behind.
        const cost = Math.abs(c - want) + (blockerAlong < CRAWL && c > oLat !== oLat <= 0 ? 100 : 0);
        if (held < bestHeld || (held === bestHeld && cost < bestCost)) {
          best = c;
          bestHeld = held;
          bestCost = cost;
        }
      }
      this.nosedFree = bestHeld === 0;
      if (Number.isNaN(best)) this.followBoxedIn(i, blockerAlong, blockerAhead);
      else {
        // Every line held: the biggest gap (owner: "gas it towards the biggest gap, preferably in the right direction"), pushing through the
        // traffic that holds it (spared from the guard); a rival is still the guard's business.
        if (bestHeld > 0) {
          best = this.biggestGap(n, oLat, blocker, blockerAhead, room, want, blockerAlong < CRAWL);
          this.laneHeld(best, blocker, blockerAhead, true);
        }
        want = best;
        this.swerve = Math.max(this.swerve, WRECK_SWERVE);
        this.evading = true;
      }
    }
    return clamp(want, -room, room);
  }

  /**
   * Of the lane candidates (`cand`, `n` of them) and the midpoint between every two cars in the blocker's window, the line farthest
   * from every car (the biggest gap), none within a lane of the blocker at `oLat`; ties to the one nearest `want`, on the side
   * with more road beside a stopped or oncoming blocker (`aside`). One candidate always qualifies: the caller's pick did.
   */
  private biggestGap(n: number, oLat: number, blocker: number, blockerAhead: number, room: number, want: number, aside: boolean): number {
    let best = Number.NaN;
    let bestClear = -1;
    let bestCost = Infinity;
    for (let k = -n; k < this.nearCount; k++) {
      if (k >= 0 && (this.nearId[k] === blocker || this.nearAhead[k]! >= blockerAhead + HELD_BEYOND)) continue;
      for (let j = k + 1; j <= this.nearCount; j++) {
        if (k < 0 && j > k + 1) break;
        if (k >= 0 && (j === this.nearCount || this.nearId[j] === blocker || this.nearAhead[j]! >= blockerAhead + HELD_BEYOND)) continue;
        const c = clamp(k < 0 ? this.cand[n + k]! : (this.nearLat[k]! + this.nearLat[j]!) / 2, -room, room);
        let clear = Math.abs(c - oLat);
        if (clear < LINE_W + 0.4) continue;
        for (let m = 0; m < this.nearCount; m++) {
          if (this.nearId[m] === blocker || this.nearAhead[m]! >= blockerAhead + HELD_BEYOND) continue;
          clear = Math.min(clear, Math.abs(c - this.nearLat[m]!));
        }
        const cost = Math.abs(c - want) + (aside && c > oLat !== oLat <= 0 ? 100 : 0);
        if (clear > bestClear + 1e-6 || (clear > bestClear - 1e-6 && cost < bestCost)) {
          best = c;
          bestClear = clear;
          bestCost = cost;
        }
      }
    }
    return best;
  }
}
