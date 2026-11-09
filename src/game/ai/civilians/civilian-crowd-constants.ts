/** A car closing on a building at this speed (m/s, 29 km/h) wrecks it: a graze or a bump at a kerb is no news, a hard hit into a stoop is. */
export const WRECK_SPEED = 8;
/** A contact within this many metres of a building's footprint is that building's: the solid's face and the contact point differ by a slice's travel. */
export const WRECK_MARGIN = 1.5;
/** A building is wrecked at most once in this many crowd seconds: a car grinding along a face is one wreck, not one a slice. */
export const WRECK_LOCKOUT_SECONDS = 30;

/** A whole walking stride (both feet) covers this many metres: the guards' and the VIP's stride (`people.ts`). */
const STRIDE_METRES = 1.5;
export const STRIDE_RADIANS_PER_METRE = (2 * Math.PI) / STRIDE_METRES;

/**
 * The look word a civilian is drawn from (`CrowdPoses.look`), written by the crowd and read by the drawing: a hash of who they are in bits 0-28, the woman bit (the resident's gender, so a drawn name and body agree) in bit 29,
 * the species in bits 30-31 (`SPECIES` order: person 0, cat 1, dog 2). The hash mixes the resident's identity with the city's seed, `salt` keeping it apart from their other draws.
 */
export const LOOK = { hashMask: 0x1fffffff, womanShift: 29, speciesShift: 30, salt: 0x2545f491, hashShift: 15 } as const;

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
