import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { ACTIVITY_SECONDS } from "./civilian-activity.ts";

/** Crowd time runs on one grid: a plan, an event and a society step all land on a tick of 1 / DECISION_HZ crowd seconds. */
export const DECISION_HZ = 2;
/** A crowd second is a game minute (owner: 1 game day = 24 real minutes). */
const GAME_SECONDS_PER_CROWD_SECOND = 60;
const SECONDS_PER_GAME_MINUTE = 60;
export const MINUTES_PER_GAME_HOUR = 60;
export const HOURS_PER_GAME_DAY = 24;
export const MINUTES_PER_GAME_DAY = MINUTES_PER_GAME_HOUR * HOURS_PER_GAME_DAY;
export const TICKS_PER_GAME_MINUTE = (DECISION_HZ * SECONDS_PER_GAME_MINUTE) / GAME_SECONDS_PER_CROWD_SECOND;
export const TICKS_PER_GAME_HOUR = TICKS_PER_GAME_MINUTE * MINUTES_PER_GAME_HOUR;
export const TICKS_PER_GAME_DAY = TICKS_PER_GAME_HOUR * HOURS_PER_GAME_DAY;
/** A plan for tick T is asked for at tick T - PLAN_LEAD_TICKS (2 s): a worker round trip is milliseconds, so the answer is in long before it is due. */
export const PLAN_LEAD_TICKS = 4;
/** An event at tick t changes the society at the first hour tick at least this many ticks later (6 s): a peer that hears of it this late still applies it on the same tick as the host. Over `PLAN_LEAD_TICKS`, under the shortest dwell. */
export const EVENT_LEAD_TICKS = 12;
/** Days in a week; Monday is day 0 of it, so Friday is 4 and Saturday 5. */
export const DAYS_PER_WEEK = 7;
export const FRIDAY = 4;
export const SATURDAY = 5;

/** Lines of life log kept per resident (owner: the look-at panel shows the last few). */
export const LOG_LINES = 8;
export const HISTORY_FIELD = { code: 0, subject: 1, tick: 2 } as const;
export const HISTORY_FIELDS = 3;
export const NEED = { rest: 0, food: 1, work: 2, social: 3, errand: 4, solitude: 5 } as const;
export const NEED_COUNT = 6;
export const GENDER = { female: 0, male: 1 } as const;
export const SPECIES = { person: 0, cat: 1, dog: 2 } as const;
/** What a leg is for: a need's number, or one of the stories (`civilian-cast.ts`) or the bus out of the neighbourhood. */
export const PURPOSE = {
  salPigeons: 6,
  kowalskiBroom: 7,
  biscuitSteals: 8,
  jamalFlyers: 9,
  deeCoffee: 10,
  okaforParty: 11,
  vanRepair: 12,
  tabbyPlay: 13,
  dogChase: 14,
  mechanicOut: 15,
  partyGuest: 16,
  busAway: 17,
  coffee: 18,
  drink: 19,
  stoopSit: 20,
  stoopTalk: 21,
  argue: 22,
  loiter: 23,
  report: 24,
  flee: 25,
  shoplift: 26,
  mug: 27,
  breakIn: 28,
  fight: 29,
  lookOn: 30,
  callAmbulance: 31,
} as const;
/** What `RESIDENT_INT.flags` holds: in hospital, without a job, hurting, out of work while the workplace is closed, a named resident (no society chances, fixed age); jobless long enough to be broke, a criminal, wanted for an open crime or fight, in custody, a car owner, a coffee fan, a drinker. */
export const FLAG = { hurt: 1, jobless: 2, injured: 4, laidOff: 8, cast: 16, broke: 32, criminal: 64, wanted: 128, custody: 256, hasCar: 512, coffeeFan: 1024, drinker: 2048 } as const;
/** A resident's integer row: society fields, then the leg and dwell the crowd walks, then the life log ring (`LOG_LINES` of `HISTORY_FIELDS`). -1 in a place field: none. */
export const RESIDENT_INT = {
  /** The first 16 are what the crowd reads of every civilian every frame, in the one cache line (64 bytes) a row starts on: keep them together. */
  alive: 0,
  species: 1,
  flags: 2,
  place: 3,
  fromPlace: 4,
  departTick: 5,
  arriveTick: 6,
  nextDecisionTick: 7,
  pathCount: 8,
  legPurpose: 9,
  driveLeaveTick: 10,
  driveParkTick: 11,
  driveFirst: 12,
  driveLast: 13,
  /** The last hazard this resident saw: the tick (NEVER_TICK: none), where in centimetres, and who was hurt there (a resident, -1: none). */
  alarmTick: 14,
  /** The moment after `alarmTick` they noticed it, in `ALARM_DELAY_STEPS_PER_SECOND` steps. */
  alarmDelay: 15,
  firstName: 16,
  familyName: 17,
  gender: 18,
  birthDay: 19,
  home: 20,
  work: 21,
  jobTitle: 22,
  shiftStart: 23,
  partner: 24,
  parent: 25,
  childCount: 26,
  moodEvent: 27,
  moodTick: 28,
  favouriteFood: 29,
  favouriteHangout: 30,
  favouriteShop: 31,
  decisionCount: 32,
  storyTick: 33,
  knockX: 34,
  knockZ: 35,
  knockTick: 36,
  historyHead: 37,
  /** The place whose kerb the resident's car stands at before its trip leaves (and when it has none); -1 for none. The car is the owner's, who has FLAG.hasCar; a housemate may drive it. */
  carPlace: 38,
  /** The index in the place's `Place.seats` the resident holds; -1 for none. One holder per seat. */
  seat: 39,
  /** Who they talk or argue with while they stand at a door (a resident, -1 for none). */
  companion: 40,
  joblessDays: 41,
  wantedUntilTick: 42,
  /** The tick an open crime began (NEVER_TICK for none) and its CRIME_KIND, place and victim (a resident, or -1: the place itself); cleared by a bust or when the wanted spell ends. */
  crimeTick: 43,
  crimeKind: 44,
  crimePlace: 45,
  crimeVictim: 46,
  crimeNotBefore: 47,
  /** The tick a fight began (NEVER_TICK for none), who the other fighter is (-1: none, or a player) and where it is, in centimetres. */
  fightTick: 48,
  fightPartner: 49,
  fightX: 50,
  fightZ: 51,
  /** The way a fighter faces, in `WALKER_BEARING_STEPS` of a turn (toward the player who shoved them); `NO_BEARING` for a fight between two civilians or with a car. */
  fightBearing: 52,
  /** The owner's car trip: the place it parks at (-1: none) and the ticks its driver gets in (it leaves) and it is parked (NEVER_TICK: none); the car is away, and nobody else's to take, from the reservation to the park tick. */
  carTo: 53,
  carLeaveTick: 54,
  carParkTick: 55,
  /** A driver's leg that goes by car: whose car (-1: none, a plain walk), the path indices where he gets in and out (-1: none) and the ticks he does (NEVER_TICK: none). */
  carOwner: 56,
  alarmX: 57,
  alarmZ: 58,
  alarmVictim: 59,
  /** A leg's waits at kerbs for a walk light: how many (0 to `MAX_WAITS`), the path index of the node each is at, and its length in ticks. */
  waitCount: 60,
  waitIndex0: 61,
  waitIndex1: 62,
  waitIndex2: 63,
  waitTicks0: 64,
  waitTicks1: 65,
  waitTicks2: 66,
  history: 67,
} as const;
/** A row is a whole number of 64-byte cache lines (16 ints), so the hot fields at its start share one. */
const ROW_ALIGN_INTS = 16;
export const RESIDENT_INT_STRIDE = Math.ceil((RESIDENT_INT.history + LOG_LINES * HISTORY_FIELDS) / ROW_ALIGN_INTS) * ROW_ALIGN_INTS;
/** A resident's float row: the needs as they stood at the decision that made the leg, their rise rates (per game hour), the speed of the leg or stay they are on (m/s), their lateral offset (m) and their own walking pace (m/s: the leg's speed is this, or the drive's). */
export const RESIDENT_FLOAT = { needs: 0, rates: NEED_COUNT, speed: 2 * NEED_COUNT, lateral: 2 * NEED_COUNT + 1, pace: 2 * NEED_COUNT + 2 } as const;
export const RESIDENT_FLOAT_STRIDE = RESIDENT_FLOAT.pace + 1;
/** A tick no decision ever reaches, and no place. */
export const NEVER_TICK = 2147483647;
export const NO_PLACE = -1;
/** A first or family name at or over this indexes the cast table (`civilian-cast.ts`), a job title at or over `CAST_TITLE_BASE` too. */
export const CAST_NAME_BASE = 1000;
export const CAST_TITLE_BASE = 100;

/**
 * Event kinds of the host's input triples (kind, subject, crowd seconds). A knock's subject is the civilian run down; a wreck's the place; a crime's, a bust's and a jaywalk arrest's the resident; a push's and a fight's the
 * victim, followed by a triple of the same seconds naming the other party: `alongside` a civilian, `walker` a human player on foot (its subject his bearing from the victim, in `WALKER_BEARING_STEPS` of a turn); `car` a car that nudged them (its subject the bearing to it, in the same steps); none: a car with no bearing.
 * Inside the brain a civilian pair is one subject, victim + capacity * (other + 1). A `copDown` (a car knocked a foot cop down; subject: the cop) is the police's: it rides the log and the brain drops it.
 * An `ambulance` (someone run down has stayed down long enough for a call; subject: them) makes the nearest person out at a door the caller; a `danger` (a crash, or a car heading at someone; subject: the walk-graph node nearest) alarms those who see it.
 * An `ambulanceStage` (the ambulance changed state or car; subject: its car index times 4 plus its state) tells a client where the ambulance is, which it has no traffic to know: it rides the log and the brain drops it.
 * An `arrestRide` (an arrested resident and her cop got into a patrol car, which now drives off) and an `arrestAlight` (the car is at the station and they get out) are each two triples of the same seconds: the resident, then the engine's index of the car. A client reads them to seat and unseat the pair (its own law has no patrol cars); the player on foot's arrest names `ARREST_PLAYER_RESIDENT`. The brain drops both kinds.
 */
export const EVENT_KIND = { knock: 0, wreck: 1, crime: 2, bust: 3, push: 4, fight: 5, alongside: 6, walker: 7, jaywalk: 8, copDown: 9, ambulance: 10, danger: 11, ambulanceStage: 12, car: 13, arrestRide: 14, arrestAlight: 15 } as const;
/** The resident an `arrestRide` or `arrestAlight` names for the player on foot's arrest (the wire's subject is 16 bits: no resident is this). */
export const ARREST_PLAYER_RESIDENT = 65535;
/** A fight's bearing that is none (two civilians face each other; a car is not faced). */
export const NO_BEARING = -1;
/** `RESIDENT_INT.fightPartner` when the other fighter is a human player on foot (-1 is none, or a car). */
export const FIGHT_PLAYER = -2;
export const EVENT_TRIPLE = 3;
/** Society effects of a wreck or knock: what the corner is feared at, within FEAR_RADIUS metres of the spot (falling off linearly to 0 at the edge). */
export const WRECK_FEAR = 1;
export const KNOCK_FEAR = 0.8;
export const FEAR_RADIUS = 40;
/** Fear halves every game day and under FEAR_FLOOR is gone. */
export const FEAR_DAY_DECAY = 0.5;
export const FEAR_FLOOR = 0.03;
/** Path cost per metre at fear 1 is 1 + FEAR_COST_FACTOR: a walker takes a street 7 times as long over the feared one. At night the block shies from a feared corner twice as hard. */
export const FEAR_COST_FACTOR = 6;
export const NIGHT_FEAR_WEIGHT = 2;
export const NIGHT_FROM_HOUR = 20;
export const NIGHT_TO_HOUR = 5;
/** A feared door's utility is divided by 1 + FEAR_AVOID * fear. */
export const FEAR_AVOID = 4;
/** Fear at a resident's spot that turns the mood to afraid. */
export const AFRAID_FEAR = 0.2;
/** A wrecked place stays shut this many game days; a family whose stoop was wrecked stays angry this many. */
export const CLOSED_DAYS = 2;
const ANGRY_DAYS = 3;
export const ANGRY_HOLD_TICKS = ANGRY_DAYS * TICKS_PER_GAME_DAY;
/** A knocked civilian is in hospital this many game days (12 real minutes), then back home. */
const HOSPITAL_DAYS = 0.5;
export const HOSPITAL_TICKS = HOSPITAL_DAYS * TICKS_PER_GAME_DAY;
/** The needs of someone just out of hospital: tired, hungry, nothing else pressing. */
export const HOSPITAL_NEEDS = [0.5, 0.6, 0, 0.1, 0.1, 0.1] as const;
/** How long a street or society event colours a mood (game hours). */
const MOOD_HOLD_HOURS = 18;
export const MOOD_HOLD_TICKS = MOOD_HOLD_HOURS * TICKS_PER_GAME_HOUR;
/** A need at or over this reads as the mood (hungry, exhausted...). */
export const MOOD_NEED_LEVEL = 0.75;
/** A crash this close (m) to the garage's door gets the mechanic out to look, for this many game minutes. */
export const MECHANIC_REACH = 60;
export const MECHANIC_LOOK_MINUTES = 25;
/** The pirate radio comes on at this hour: the houses of the blocks it reaches (A1, A2: block numbers from 0) hear the static. */
export const RADIO_HOUR = 0;
export const RADIO_BLOCKS = [0, 1] as const;
/** The static annoys its hearers for the night (game hours), not into the next evening: 18 h of it each midnight left two blocks annoyed most of the day and sent them drinking to forget. */
export const STATIC_HOLD_TICKS = 3 * TICKS_PER_GAME_HOUR;

/** The walk: speed (m/s) by species is a person's brisk pace, a cat's trot and a dog's lope, each with +-15 % per resident; lateral offsets of +-1 m keep walkers apart, fading in over the first and last 3 m of a path. */
export const SPECIES_SPEED = [1.4, 2.2, 2.6] as const;
export const WALK_SPEED_SPREAD = 0.15;
export const LATERAL_MAX = 1;
export const LATERAL_FADE_DISTANCE = 3;
/** Longest path (nodes) a leg may hold; a longer one is not walked. */
export const MAX_PATH_NODES = 128;
/** A zebra crossing costs as many extra metres in a path (a wait at the kerb). */
export const CROSSING_COST = 6;
/** A story leaves this many ticks (3 s) earlier than the walk needs so that a longer route round fear still arrives on time. */
export const SCHEDULE_SLACK_TICKS = 6;

/** The nine blocks, three by three: A1 is the north-west one; numbers run west to east, letters north to south. A story sends a walker to one block a day, stepping this many blocks a day (coprime with 9: every block in nine days). */
export const BLOCK_COLUMNS = 3;
export const BLOCK_ROWS = 3;
export const BLOCK_COUNT = BLOCK_COLUMNS * BLOCK_ROWS;
export const BLOCK_DAY_STEP = 4;
/** North is toward lower z on the map (the planner's convention: row A is where z is least). */
export const NORTH_IS_LOW_Z = true;

/** Society size: spare slots over the start population for births and arrivals, and the most the population may grow over its target by births. */
export const GROWTH_HEADROOM = 0.15;
export const MIN_SPARE_SLOTS = 6;
export const BIRTH_CAP_SHARE = 0.1;
export const MOVE_IN_AGE_MIN = 18;
export const MOVE_IN_AGE_MAX = 45;
/** Start population: adults 18-70; a couple in half of the households of two or more; the rest of a family are children under 16. */
export const ADULT_AGE_MIN = 18;
export const ADULT_AGE_MAX = 70;
export const ADULT_AGE_RANGE = ADULT_AGE_MAX - ADULT_AGE_MIN;
export const CHILD_AGE_LIMIT = 16;
export const COUPLE_SHARE = 0.5;
/** The share of people who are women. */
export const FEMALE_SHARE = 0.5;
export const PARENT_AGE_MIN = 22;
export const PARENT_AGE_MAX = 55;
export const PARTNER_AGE_GAP = 8;
/** A home takes this many people before a mover looks elsewhere. */
export const HOME_CAPACITY = 6;
/** Jobs: from this age; the share of adults employed at the start; retirement; a floor area per job (m2, a counter or a desk) and the least and most a place employs. */
export const JOB_AGE = 16;
export const EMPLOYMENT_RATE = 0.75;
export const RETIRE_AGE = 65;
export const AREA_PER_JOB = 45;
export const MIN_JOBS = 2;
export const MAX_JOBS = 80;
/** Shifts start between these hours (inclusive). */
export const SHIFT_START_MIN = 6;
export const SHIFT_START_SPAN = 6;
/** A favourite is one of this many nearest places of its kind. */
export const FAVOURITE_POOL = 3;

/** Reference doTime chances per game day (`societymeta.js`: rolls of 5000 for fired 30, promoted 30, injured 25 + age, cured 50, moved 8, died age or 2 x age); the courtship band is its roll 1500-2500 of 5000 for women over 16. A game day is one doTime step: a person ages a year a day. */
export const ROLL_RANGE = 5000;
export const FIRE_CHANCE = 30 / ROLL_RANGE;
export const PROMOTION_CHANCE = 30 / ROLL_RANGE;
export const INJURY_BASE = 25;
export const CURE_CHANCE = 50 / ROLL_RANGE;
export const MOVE_CHANCE = 8 / ROLL_RANGE;
export const DEATH_PER_YEAR = 1 / ROLL_RANGE;
export const INJURED_DEATH_FACTOR = 2;
export const COURTSHIP_ROLL_MIN = 1500;
export const COURTSHIP_ROLL_MAX = 2500;
export const COURTSHIP_CENTRE = 2000;
/** The reference's `diff` (half the distance of the roll from the centre): a baby under BABY_DIFF_BASE - age / 2, a relationship under RELATIONSHIP_DIFF, a break-up over it. */
export const BABY_DIFF_BASE = 70;
export const RELATIONSHIP_DIFF = 100;
/** The share of new parents who marry (the reference's 7 in 10). */
export const MARRY_SHARE = 0.7;
/** The share of the jobless working age who find a job on a day. */
export const JOB_FIND_CHANCE = 0.5;
/** A partner is looked for among this many residents from a drawn start. */
export const PARTNER_SCAN = 64;

/** Need rise per game hour: a day awake fills rest in 16 h, food in 5, work in 10, social in 9, errand in 22, solitude in 14; each resident's own rate is within +-RATE_SPREAD of it. */
export const NEED_RATE_PER_HOUR = [1 / 16, 1 / 5, 1 / 10, 1 / 9, 1 / 22, 1 / 14] as const;
export const RATE_SPREAD = 0.3;
/** A start need is a draw up to this. */
export const START_NEED_MAX = 0.5;
/** Need relief per game minute spent dwelling at a place of each kind (rows: PLACE_KIND order home, work, food, shop, hangout, hide, transit; columns: NEED order): a night's rest at home in 5 h, a meal in 22 min, a shift of 7.5 h, an errand in 12 min, about two hours of company, solitude in 35 min. */
export const RELIEF_PER_MINUTE = [
  [1 / 300, 0, 0, 0, 0, 1 / 700],
  [0, 0, 1 / 450, 0, 0, 0],
  [0, 1 / 22, 0, 1 / 200, 0, 0],
  [0, 0, 0, 0, 1 / 12, 0],
  [0, 0, 0, 1 / 110, 0, 0],
  [1 / 600, 0, 0, 0, 0, 1 / 35],
  [0, 0, 0, 0, 1 / 9, 0],
] as const;
/** The least and most game minutes a dwell lasts per place kind (home, work, food, shop, hangout, hide, transit): the least is over `EVENT_LEAD_TICKS`, so a civilian run down between two legs is still on the one the event found them on. */
export const DWELL_MINUTES = [
  [180, 540],
  [420, 540],
  [25, 55],
  [10, 35],
  [60, 180],
  [30, 90],
  [8, 20],
] as const;
/** Away on the bus: the only way out of the neighbourhood; a bus stop that is the way out holds a visitor this long (game minutes), and an errand takes it this share of the time. */
export const AWAY_MINUTES = [90, 300] as const;
export const EXIT_STOP_SHARE = 0.3;
/** With no need worth a walk a resident stays where they are this long (game minutes). */
export const STAY_MINUTES = 30;
/** The least utility worth leaving for. */
export const STAY_UTILITY = 0.12;
/** Utility = urgency x time-of-day weight / (1 + metres / DISTANCE_SCALE); a drawn jitter of +-DECISION_JITTER spreads equal choices. */
export const DISTANCE_SCALE = 120;
export const DECISION_JITTER = 0.1;
/** The favourite of a kind is chosen over the nearest open one this share of the time. */
export const FAVOURITE_CHANCE = 0.5;
/** First decisions fall within this many ticks of the start. */
export const INITIAL_SPREAD_TICKS = 240;
/** Place kinds that employ people. */
export const WORKPLACE_KINDS = [PLACE_KIND.work, PLACE_KIND.food, PLACE_KIND.shop, PLACE_KIND.hangout, PLACE_KIND.transit] as const;
/** Work is chosen only in the hours from one before a shift starts to four after it (leaving for work late in a shift is not worth it); other hours weigh WORK_OFF_SHIFT. */
export const SHIFT_HOURS_BEFORE = 1;
export const SHIFT_HOURS_AFTER = 4;
export const WORK_OFF_SHIFT = 0.05;
/** On a Friday evening this share of those wanting company go to the Okafors' rooftop deck, from the first to the last hour. */
export const PARTY_INVITE_SHARE = 0.3;
export const PARTY_FIRST_HOUR = 19;
export const PARTY_LAST_HOUR = 23;
/** Weight of each need by hour of the day (rows: NEED order, 24 hours from midnight): rest at night, meals at 7-9, 12-14 and 18-20, company late afternoon to night, errands in shop hours; work is by shift. */
export const HOUR_WEIGHTS = [
  [1, 1, 1, 1, 1, 1, 0.8, 0.4, 0.15, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.8, 1, 1],
  [0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.9, 0.9, 0.5, 0.35, 0.6, 1, 1, 0.6, 0.35, 0.4, 0.7, 1, 1, 0.8, 0.5, 0.3, 0.2],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0.1, 0.05, 0, 0, 0, 0, 0, 0.1, 0.2, 0.3, 0.4, 0.4, 0.5, 0.5, 0.5, 0.6, 0.8, 1, 1, 1, 1, 1, 0.8, 0.4],
  [0, 0, 0, 0, 0, 0, 0.1, 0.4, 0.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8, 0.5, 0.2, 0.1, 0, 0],
  [0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.5, 0.4, 0.3],
] as const;
/** A place with opening hours weighs this much outside them. */
export const CLOSED_HOURS_WEIGHT = 0.1;

/** Salts of the draw streams (`residentDraws`): one per kind of choice, so adding a draw to one never moves another. */
export const STREAM = { create: 1, day: 2, decision: 3, arrival: 4, birth: 5, clock: 6, week: 7, block: 8, seat: 9, crime: 10, fight: 11, trait: 12, alarm: 13, cross: 14, household: 15, punch: 16 } as const;
/** Odd multipliers that scramble (seed, resident, salt, index) into a mulberry32 seed. */
export const MIX_RESIDENT = 0x9e3779b9;
export const MIX_SALT = 0x85ebca6b;
export const MIX_INDEX = 0xc2b2ae35;

/** Centimetres per metre: a knock's spot is kept in whole centimetres in the integer row. */
export const CENTIMETRES_PER_METRE = 100;

/** What a crime is, in `RESIDENT_INT.crimeKind` (0 none). */
export const CRIME_KIND = { none: 0, theft: 1, mugging: 2, breakIn: 3 } as const;
export const NO_SEAT = -1;

/**
 * A drive: a trip of at least `DRIVE_MIN_BLOCKS` blocks (a block's walk is about `BLOCK_WALK_METRES`: the grid's pitch is 123 m along its long side and 75 m along the short) is made by car when one of the household's, standing
 * within `CAR_WALK_METRES` of where the resident is, is free: they walk to it, drive at `DRIVE_SPEED` (m/s of the walk graph's metres, stop and go through the lights, under a car's own pace so it is parked in time),
 * the car takes `PARK_SECONDS` to park, and they walk in from where it stands.
 */
const DRIVE_MIN_BLOCKS = 3;
const BLOCK_WALK_METRES = 100;
export const DRIVE_MIN_METRES = DRIVE_MIN_BLOCKS * BLOCK_WALK_METRES;
export const CAR_WALK_METRES = 150;
export const DRIVE_SPEED = 6;
const PARK_SECONDS = 8;
export const PARK_TICKS = PARK_SECONDS * DECISION_HZ;
/** Getting in and out are stationary clips at the car's node: the driver stands there this long before the car leaves and after it is parked. */
export const CAR_IN_TICKS = Math.ceil(ACTIVITY_SECONDS.carIn * DECISION_HZ);
export const CAR_OUT_TICKS = Math.ceil(ACTIVITY_SECONDS.carOut * DECISION_HZ);
/** A leg that goes by no car: its drive indices. */
export const NO_INDEX = -1;
/** Shares of adults who own a car, are coffee fans, are drinkers (traits drawn once, from their own stream). */
export const CAR_SHARE = 0.35;
export const COFFEE_FAN_SHARE = 0.6;
export const DRINKER_SHARE = 0.5;

/** The interaction table's thresholds: the rest need at which someone at the end of a shift is tired; a dwell at work this long (game minutes) was a shift; coffee on the way is only worth it with this many hours to the shift and a detour of at most this many metres. */
export const TIRED_REST_LEVEL = 0.45;
export const SHIFT_DWELL_MINUTES = 240;
export const COFFEE_LEAD_HOURS = 1;
export const COFFEE_DETOUR_METRES = 120;
/** A neighbour is a person at another home within this many metres; one whose dwell ends within the next ticks (12 s) is not pulled out; two who sit on stoops this close (m) talk. */
export const NEIGHBOUR_REACH = 80;
export const PULL_LEAD_TICKS = 24;
export const SITTER_CHAT_REACH = 25;
/** Someone standing at a door stands this far (m) along the frontage, by their lateral offset's share of its range. */
export const DOOR_SPREAD = 0.8;
/** A customer's dwell must be this long (game minutes) to take a seat. */
export const SEAT_MIN_DWELL_MINUTES = 10;
/**
 * Standing spots of a venue with a counter, for those who have no seat: `STAND_SPOTS` for customers in rows of `STAND_COLUMNS` along the counter, behind the lane (the counter's customer spot and the places alternately to its right and
 * left `STAND_SPACING` m apart) where those who stop to buy without a spot of their own stand, the first row `STAND_ROW_DEPTH` m back from the lane, the next as far again and `CLERK_SPOTS` for staff along the clerk's spot. They number after the venue's seats in the same owner table: one holder to each.
 */
export const STAND_SPOTS = 10;
export const CLERK_SPOTS = 3;
export const STAND_COLUMNS = 5;
export const STAND_SPACING = 0.8;
export const STAND_ROW_DEPTH = 0.8;

/** Crime: a criminal at the crime place commits it this many ticks after arriving; they wait half a game day between crimes and go for one in this share of the decisions that allow it; a crime keeps them wanted a game day, a fight six game hours; custody lasts six game hours and in this share of them they give up crime. */
export const CRIME_LAG_TICKS = 4;
export const CRIME_COOLDOWN_TICKS = TICKS_PER_GAME_DAY / 2;
export const CRIME_PER_DECISION = 0.3;
export const WANTED_TICKS = TICKS_PER_GAME_DAY;
export const FIGHT_WANTED_TICKS = 6 * TICKS_PER_GAME_HOUR;
export const JAIL_TICKS = 6 * TICKS_PER_GAME_HOUR;
export const RELEASE_REFORM_CHANCE = 0.4;
/** The corner is feared this much after a crime or a fight (see `KNOCK_FEAR`). */
export const CRIME_FEAR = 0.6;
export const FIGHT_FEAR = 0.3;
/** Witnesses are people standing at a door within this many metres of a crime or fight; this share of them report it (a minute's phone call), the rest run home (`FLEE_SPEED_FACTOR` times their pace) and stay in. */
export const WITNESS_RADIUS = 45;
export const REPORT_SHARE = 0.6;
export const REPORT_MINUTES = 4;
export const FLEE_SPEED_FACTOR = 1.8;
export const FLEE_INSIDE_MINUTES = 30;
/** A game day's chance of turning to crime (adults of working age): the base, and what being out of work, broke, angry, or young adds; the chance of giving it up (twice with a job); jobless days that make someone broke; young is under this age. */
export const CRIME_LEAN = { base: 0.003, unemployed: 0.015, broke: 0.025, angry: 0.02, young: 0.015 } as const;
export const REFORM_CHANCE = 0.2;
export const EMPLOYED_REFORM_FACTOR = 2;
export const BROKE_AFTER_DAYS = 3;
export const YOUNG_AGE_MAX = 25;
/** Fights: the chance a push puts the two at each other's throats, times this when either is angry; a fight lasts this many ticks (8 s). */
export const FIGHT_CHANCE = 0.12;
export const FIGHT_ANGRY_FACTOR = 4;
export const FIGHT_TICKS = 16;
/** The share of fights that end with someone knocked out, and the blow that does it: one of this many, from this one on. */
export const KNOCKOUT_SHARE = 0.6;
export const KNOCKOUT_MIN_BLOWS = 2;
export const KNOCKOUT_BLOW_SPAN = 4;
/** A civilian's swing lands on the player within this many metres of the fighter's spot (an arm and a lean), and pushes him at this speed (m/s), lifted by this share of the direction. */
export const PLAYER_STRIKE_REACH = 1.5;
export const PUNCH_SPEED = 4;
export const PUNCH_LIFT = 0.3;
/** The player's punch: its reach (m), the cosine of its half-arc about his facing, the seconds between punches, the seconds from the press to the blow, and the speed (m/s) it gives the body it lands on. */
export const PLAYER_PUNCH_REACH = 1.4;
export const PLAYER_PUNCH_ARC = 0.5;
export const PLAYER_PUNCH_COOLDOWN = 0.6;
export const PLAYER_PUNCH_LAND = 0.18;
export const PLAYER_PUNCH_SPEED = 3;
/** His punches on one civilian (within `PLAYER_KO_WINDOW` s of each other) and on one cop that put them down. */
export const PLAYER_KO_BLOWS = 3;
export const PLAYER_KO_WINDOW = 10;
export const COP_KO_BLOWS = 3;
/** A jaywalker arrested by the police spends a game hour in custody. */
export const JAYWALK_CUSTODY_TICKS = TICKS_PER_GAME_HOUR;

/**
 * Alarm: a crash, a car heading at someone or a person down is seen by those out at a door or on the street within `ALARM_SIGHT` metres (the street's length of sight). Whether a person looks up is the seeded chance
 * `NEURO_REACT_FLOOR` + (1 - `NEURO_REACT_FLOOR`) x their neuroticism (a hidden 0..1, `civilian-temperament.ts`), times the hazard's attention: a crash draws `ATTENTION_CRASH`, a person down `ATTENTION_DOWNED` (more eyes). Of those
 * at a door who do, the chance to go in is `NEURO_INDOORS_FLOOR` + `NEURO_INDOORS_SLOPE` x neuroticism; the rest look on for the hazard's game minutes (a crash, a person down till the ambulance has gone) times
 * `NEURO_LOOK_ON_FLOOR` + neuroticism: jumpy people stay rattled longer. A walker flinches and steps back `RECOIL_STEP_METRES` (the calmest `RECOIL_CALM_SHARE` of it).
 */
export const ALARM_SIGHT = 50;
export const NEURO_REACT_FLOOR = 0.2;
export const ATTENTION_CRASH = 1;
export const ATTENTION_DOWNED = 1.8;
export const NEURO_INDOORS_FLOOR = 0.05;
export const NEURO_INDOORS_SLOPE = 0.6;
export const NEURO_LOOK_ON_FLOOR = 0.5;
export const LOOK_ON_CRASH_MINUTES = 15;
export const LOOK_ON_DOWNED_MINUTES = 70;
export const RECOIL_STEP_METRES = 0.5;
export const RECOIL_CALM_SHARE = 0.4;
/**
 * A walker out on a road crossing when a hazard is seen within `EVADE_REACH` m of it does not flinch where it stands: it clears the road to the nearer kerb, at `EVADE_PACE_CALM` times its pace (a hurry) up to `EVADE_PACE_JUMPY`
 * times (a run) by its neuroticism; if that kerb is ahead it waits there for its schedule to come level, if behind it waits `EVADE_HOLD_SECONDS` for the danger to pass and runs to catch its schedule up, then walks on.
 */
export const EVADE_REACH = 30;
export const EVADE_PACE_CALM = 1.4;
export const EVADE_PACE_JUMPY = 2.8;
export const EVADE_HOLD_SECONDS = 2;
/**
 * Crossing a road at a signal: a walker waits at the kerb for the walk (the cars of the street they cross red, and still red when they are over), up to `MAX_WAITS` times in a leg, and the leg takes that much longer. Some do not: a
 * walker goes against the light with the chance `CROSS_DART_BASE` + `CROSS_DART_JUMPY` x their neuroticism, drawn once for each crossing.
 */
export const MAX_WAITS = 3;
export const CROSS_DART_BASE = 0.05;
export const CROSS_DART_JUMPY = 0.25;
/**
 * Each person who reacts to one hazard starts a moment after it, on a step of their own (the steps are `ALARM_DELAY_STEPS_PER_SECOND` a second, so no two start on one frame at the draw's 64 Hz): from
 * `ALARM_DELAY_MIN_SECONDS` for the jumpiest to `ALARM_DELAY_MAX_SECONDS` for the calmest, `ALARM_DELAY_JITTER_SHARE` of the span a seeded draw.
 */
export const ALARM_DELAY_MIN_SECONDS = 0.1;
export const ALARM_DELAY_MAX_SECONDS = 1.5;
export const ALARM_DELAY_JITTER_SHARE = 0.2;
export const ALARM_DELAY_STEPS_PER_SECOND = 64;
export const ALARM_DELAY_STEPS = Math.ceil(ALARM_DELAY_MAX_SECONDS * ALARM_DELAY_STEPS_PER_SECOND) + 1;
/** The one who calls the ambulance for someone down stays on the phone this many game minutes. */
export const CALL_MINUTES = 12;
