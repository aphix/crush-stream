/** A car closing on a building at this speed (m/s, 29 km/h) wrecks it: a graze or a bump at a kerb is no news, a hard hit into a stoop is. */
export const WRECK_SPEED = 8;
/** A contact within this many metres of a building's footprint is that building's: the solid's face and the contact point differ by a slice's travel. */
export const WRECK_MARGIN = 1.5;
/** A building is wrecked at most once in this many crowd seconds: a car grinding along a face is one wreck, not one a slice. */
export const WRECK_LOCKOUT_SECONDS = 30;

/** A whole walking stride (both feet) covers this many metres: the guards' and the VIP's stride (`people.ts`). */
const STRIDE_METRES = 1.5;
export const STRIDE_RADIANS_PER_METRE = (2 * Math.PI) / STRIDE_METRES;

/** A civilian's look word (`CrowdPoses.look`, written by the crowd, read by the drawing): a who-hash in bits 0-28, the woman bit (their gender) in 29, the species in 30-31 (`SPECIES` order). */
export const LOOK = { hashMask: 0x1fffffff, womanShift: 29, speciesShift: 30, salt: 0x2545f491, hashShift: 15 } as const;
/** The who-hash with every bit set is no civilian's: a foot cop's look word, which `dressOfLook` dresses in uniform. */
export const POLICE_HASH = LOOK.hashMask;

/** Residents of the playable blocks by device: a phone, a desktop, a desktop at the ultra FX tier (the plan's 60 / 150 / 300). */
export const POPULATION = [60, 150, 300] as const;
export const POPULATION_TIER = { phone: 0, desktop: 1, ultra: 2 } as const;
/** A crowd's key is its population tier above the 24-bit scene seed (the share link's seed width): one u32 on the wire, so a client builds the host's city size without a new field. */
export const CROWD_SEED_MASK = 0xffffff;
export const CROWD_TIER_SCALE = 0x1000000;

/** The host's event log in memory: the wire's cap (`CROWD_EVENT_LOG_MAX`; a test pins them equal), the newest kept. */
export const EVENT_LOG_CAPACITY = 512;
/** Knocks heard from the host that wait for the client's clock to reach them (it runs behind the host's), and how late (s) a knock may be heard and still be thrown: older ones are history. */
export const HEARD_KNOCK_QUEUE = 16;
export const HEARD_KNOCK_LATE_SECONDS = 2;
/** A client's estimate of the host clock follows the least (local - host) clock gap seen and creeps up this much (s) at each message, as the snapshot clock does (`net-play-client`). */
export const CLOCK_OFFSET_CREEP = 0.001;

/** The look-at panel: a civilian this far ahead along the eye's ray (m), within this of the ray (m), at the height of a chest (m); a building up to this tall a storey (m); recomputed this often (Hz). */
export const LOOK_REACH = 30;
export const LOOK_RADIUS = 1;
export const CHEST_HEIGHT = 1.3;
export const STOREY_HEIGHT = 3.2;
export const LOOK_HZ = 4;

/** Centres of two people stay this far apart (m): the dummy's shoulders and swung hands span 0.6 m (`PARTS`). */
export const BODY_GAP = 0.6;
/** A drawn civilian stands at most this far (m) from where the brain puts them: lanes already spread walkers by +-1 m, more would put one through a wall or into the road. */
export const MAX_OFFSET = 0.7;
/** Passes over the pair list, each moving an overlapping pair apart by half the overlap each: the overlap in a row of three falls to a quarter each pass. */
export const SEPARATION_PASSES = 8;
/** Two bodies can end within `BODY_GAP` of each other only if they start within the gap plus what both may move. */
export const PAIR_RANGE = BODY_GAP + 2 * MAX_OFFSET;
/** Two bodies closing or parting slower than this (m/s) stand still to each other: they are pushed straight apart, not stepped to each other's sides. */
export const MOVING_SPEED = 0.1;
/** Pairs each body lists as the lower of the two: a ninth neighbour inside reach is a mob, not a street. The grid's cells hash by position (a power of two). */
export const PAIRS_PER_BODY = 8;
export const SEPARATION_CELLS = 2048;
/** Players on foot the crowd makes room for. */
export const WALKER_CAPACITY = 4;
/** Bodies closer than this (m) have no direction between them: they part along +x. */
export const COINCIDENT_DISTANCE = 1e-4;

/** Brain positions this close (m) closing at least this fast (m/s) bump: the bump clip plays, at most once in the cooldown (s) for each. */
export const BUMP_DISTANCE = 0.55;
export const BUMP_CLOSING_SPEED = 0.4;
export const BUMP_COOLDOWN_SECONDS = 1.5;
/** A collision is hard when bodies are this close (m) closing this fast (m/s): head-on walkers close at 2.8, a crossing at 2. */
export const HARD_DISTANCE = 0.3;
export const HARD_CLOSING_SPEED = 2;
/** A walker on foot or a car reaches a civilian when within this of them (m) closing at least this fast (m/s). */
export const WALKER_PUSH_DISTANCE = 0.5;
export const WALKER_PUSH_CLOSING_SPEED = 0.5;
export const CAR_NUDGE_GAP = 0.5;
export const CAR_NUDGE_SPEED = 1;
/** A resident is in at most one push event per this many crowd seconds (a game hour): the log is 512 triples on the wire. */
export const PUSH_LOCKOUT_SECONDS = 60;
