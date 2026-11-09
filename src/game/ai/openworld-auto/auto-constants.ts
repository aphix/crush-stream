/** The owner's ask: a subject is held 5 to 10 seconds, and not a second less. */
export const HOLD_MIN_SECONDS = 5;
export const HOLD_MAX_SECONDS = 10;
/** How often the held shot is asked whether something hotter is going on (s): a scan of the crowd is a few hundred reads. */
export const SCAN_SECONDS = 1;
/** An event this interesting (0-1) may cut a shot short once it has held `HOLD_MIN_SECONDS`, if it beats what is on screen by `INTERRUPT_MARGIN`. */
export const INTERRUPT_INTEREST = 0.8;
export const INTERRUPT_MARGIN = 0.15;
/** Under this interest (0-1) nothing is worth a cut. */
export const MIN_INTEREST = 0.05;
/** A subject of the same kind as the one just left counts this share of its interest, so the view varies: from a fight to a car to a cop. */
export const SAME_KIND_FACTOR = 0.7;
/** A subject among the last `RECENT_SUBJECTS` cuts' counts this share of its interest. The one on screen and the one before it are never picked. */
export const RECENT_FACTOR = 0.5;
export const RECENT_SUBJECTS = 6;
/** The most a seeded nudge moves a subject's score, so equal events do not always go to the same one. */
export const TIE_JITTER = 0.02;
/** A hash of (seed, n) is a share of this. */
export const HASH_RANGE = 4294967296;

/** Interest (0-1) of what a civilian is doing, by `ACTIVITY` code: a brawl and an arrest are the most to watch, a stroll the least. */
export const ACTIVITY_INTEREST = [0.1, 0.12, 0.3, 0.35, 0.25, 0.2, 0.15, 0.2, 0.5, 1, 0.9, 1, 0.2, 0.9, 0.8, 0.95, 0.9] as const;
/** Interest (0-1) of a mood, by `MOOD` code: fear, anger and pain over a quiet day. */
export const MOOD_INTEREST = [0.1, 0.25, 0.25, 0.35, 0.12, 0.2, 0.5, 0.5, 0.2, 0.25, 0.2, 0.55, 0.3, 0.3] as const;
/** Interest (0-1) a host event gives its subject while it is in progress, by `EVENT_KIND`: a fight and a bust first, a push or a jaywalk least. */
export const EVENT_INTEREST = [0.85, 0.8, 0.9, 0.95, 0.55, 1, 0, 0, 0.4, 0.9] as const;
/** How long (s) an event stays in progress, by `EVENT_KIND`: its interest falls to nothing over it. */
export const EVENT_SECONDS = [12, 12, 10, 10, 6, 12, 0, 0, 8, 10] as const;
/** A wanted resident, and a criminal not yet wanted (0-1). */
export const WANTED_INTEREST = 0.75;
export const CRIMINAL_INTEREST = 0.45;
/** A foot cop at a run is in pursuit; at a walk he is on his beat (0-1), and the speed (m/s) between. */
export const COP_PURSUIT_INTEREST = 0.7;
export const COP_PATROL_INTEREST = 0.3;
export const COP_RUN_SPEED = 3;
/** A patrol car with its siren lit; a car on a trip at a crawl and at speed (0-1), and the speed (m/s) that adds the most. */
export const SIREN_INTEREST = 0.85;
export const DRIVER_BASE_INTEREST = 0.2;
export const DRIVER_SPEED_INTEREST = 0.3;
export const DRIVER_FULL_SPEED = 20;
/** A car under this speed (m/s) is parked or stopped at a light: not worth following. */
export const DRIVER_STOPPED_SPEED = 0.5;
/** Where the camera stands round a person (m): behind him, over his feet, aimed at his chest. */
export const PERSON_SHOT = { back: 3.6, height: 1.9, aimUp: 1.35 } as const;
/** Where it stands round a spot, the front of a wrecked building or where someone was knocked down (m). */
export const SPOT_SHOT = { back: 12, height: 3.2, aimUp: 2.5 } as const;
