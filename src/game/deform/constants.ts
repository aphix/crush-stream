/** Quantities several deform files share. */

/** A wreck whose spin inertia about its centroid (Σ m·r², kg·m²) is below this has no turn to hold or resist. */
export const MIN_INERTIA = 1e-9;
/** A mass whose impact weight (crumple face × corner) is below this is outside the hit. */
export const MIN_IMPACT_ZONE = 0.04;
/** A sum of weights below this weights nothing: the weighted mean falls back. */
export const MIN_WEIGHT_SUM = 1e-6;
/** A sum of masses (kg) below this is no body to average a momentum over. */
export const MIN_MASS_SUM = 1e-8;
/** Two bodies' inverse masses (1/kg) summed below this: neither can take a share of a correction. */
export const MIN_INV_MASS = 1e-8;
/** A sliding speed (m/s) below this is no slide: friction has no direction to oppose. */
export const MIN_SLIDE = 1e-6;
/** A point whose rest position projects on the hit's inward direction beyond this (m) lies on the far side of a one-ended hit. */
export const FAR_SIDE_DOT = 0.18;
/** A hit this far (m) off the car's centre line or less crushes the whole width alike; further out it crushes its own side more (`cornerWeight`). */
export const CORNER_CENTRED = 0.2;
/** The distance (m) past `CORNER_CENTRED` over which a hit's own side takes over from the whole width, in full beyond it. */
export const CORNER_BLEND = 0.1;
/** The crush reach (m) a hit's stroke gains per unit of the squash setting (on top of its 0.5 m base). */
export const SQUASH_REACH = 1.15;
/** Physics slice (s) the per-call contact shares (feedOverlap nibble and inbound-speed kill) were tuned at: a calibration reference, kept when the sim's own fine floor moves. */
export const CONTACT_REF_SLICE = 1 / 240;
/** The squash and buckle settings a fresh rig starts at, and the HUD starts its sliders at. */
export const DEFAULT_SQUASH = 0.32;
export const DEFAULT_BUCKLE = 0.45;
/** The contact window (s): how long after its last contact a crashed car's shape matching and mass step stay live (`DeformSolve.live`), and the time over which its tyres' grip comes back after a hit (`DeformSolve.settledShare`). */
export const CONTACT_WINDOW = 0.35;
/** How far (m) a hub may stand from its pin (`rest` + shove, car frame, plan): a freeze keeps a place this far off (`Car.integrateWreck`), and a planted hub (its wheel where the world holds it) is drawn back to within it (`DeformSolve.tetherHub`). A quiet planted wreck stands 2 cm off; one carried over its planted wheels at 1 m/s stood 0.37 m off in 0.15 s. */
export const HUB_PIN_MAX = 0.3;
/** The farthest (m) a planted hub is drawn toward its pin in one clamp (`DeformSolve.tetherHub`): three clamps a slice at 240 Hz are 3 cm, inside the 5 cm a slice of the zip bound; also the slack a freeze allows past `HUB_PIN_MAX` before it keeps a hub's pin (`Car.integrateWreck`). */
export const HUB_PULL_STEP = 0.01;

