/** The id of the Open World course: its `trackId` and the key `RaceField.load` finds it by. */
export const OPENWORLD_ID = "openworld";
export const OPENWORLD_NAME = "Open World";
export const OPENWORLD_BLURB = "A city of rowhomes, shops and a park at golden hour, and the people walking to where they are going.";

/** Corner radius (m) of the perimeter road loop: bigger than the road's half width so the loop's own turn check passes. */
export const LOOP_CORNER_RADIUS = 10;
/** Nodes per loop corner arc: a quarter turn in 6 steps of 15 degrees. */
export const LOOP_ARC_STEPS = 6;
/** Distances (m) from an arc's end where a straight gets its first nodes: a centripetal spline needs close collinear points to leave a straight straight. */
export const LOOP_END_RUN = [3, 9] as const;
/** Along the rest of a straight a node stands at least this often (m). */
export const LOOP_STRAIGHT_STEP = 24;
/** Checkpoints spread round the loop (the schema asks for at least 3). */
export const LOOP_CHECKPOINTS = 4;

/** The invisible wall: pieces of this length (m) so no collider is long enough to slow a broad-phase, thick enough that no car steps through, tall enough that no car or ragdoll clears it. */
export const WALL_PIECE_LENGTH = 12;
export const WALL_THICKNESS = 2;
export const WALL_HEIGHT = 12;

/** Street lamps: every 32 m (30-45 m residential) at 0.46 m from the curb. */
export const LAMP_SPACING = 32;
export const LAMP_FROM_CURB = 0.46;
/** Street trees: every 9 m (7.5-12 m), in the furniture strip. */
export const TREE_SPACING = 9;
/** No tree stands nearer than this (m) to a lamp: 1.5 m. */
export const TREE_LAMP_CLEARANCE = 1.5;
/** Parked cars: one per 6.0 m of curb, 6 m clear at each corner, a share of spaces empty. */
export const PARKING_SPACE = 6;
export const PARKING_CORNER_GAP = 6;
export const PARKING_EMPTY_SHARE = 0.3;
/** Seed of the parked cars' choices (which spaces, which model): fixed so every peer parks alike. */
export const PARKING_SEED = 0x0b10c4;

/** Course look: a city at golden hour. */
export const COURSE_LOOK = {
  sky: "#f2c08a",
  fog: 0.0016,
  far: 1400,
  sun: "#ffb46b",
  sunIntensity: 2.6,
  hemi: "#c6d4e6",
  fill: "#ffd7ae",
} as const;

/** Interior street id prefixes. */
export const ROUTE_ID = { columnStreet: "street-x", rowStreet: "street-z" } as const;

/** Spawn: abreast on the first interior east-west street's west reach, the cops queued behind. */
export const SPAWN_LATERAL_SHIFT = 2;
export const SPAWN_FORMATION_BACK = 11;
export const SPAWN_FORMATION_STEP = 5.5;
export const SPAWN_FORMATION_LATERAL = 2.6;
export const SPAWN_FORMATION_COUNT = 5;

/** Yaw of a prefab whose front (local +x) faces each way: north is -z. */
export const FACING = { north: Math.PI / 2, south: -Math.PI / 2, west: Math.PI, east: 0 } as const;
