/** The id of the Open World course: its `trackId` and the key `RaceField.load` finds it by. */
export const OPENWORLD_ID = "openworld";
export const OPENWORLD_NAME = "Open World";
export const OPENWORLD_BLURB = "A city of rowhomes, shops and a park at golden hour, and the people walking to where they are going.";

/** Street carriageway, curb to curb (m): 10.2-12.2, 11.0 common (two 3.0-3.3 m travel lanes and two 2.1-2.7 m parking lanes). */
const CARRIAGEWAY = 11;
/** Sidewalk, curb to property line (m): 3.0-4.3, split into a 0.6 frontage zone, a 1.8 m clear path and a 1.2 m furniture and tree strip. */
const SIDEWALK = 3.6;

/**
 * The whole grid in one table (m), values inside the ranges Philadelphia, Baltimore and Brooklyn codes and NACTO give: swapping a number here moves the lots,
 * the walk graph and the course together. The walls stand on the outer streets' far property line, half a building-face-to-building-face width from their centre line.
 */
export const LAYOUT = {
  /** The owner's 3 x 3 blocks. */
  columns: 3,
  rows: 3,
  /** 20 lots make the 112 m long side (blocks 90-150 m, Philadelphia 100-120 m common). */
  lotsPerFace: 20,
  /** Rowhome frontage: 4.9-6.1 m. */
  lotFrontage: 5.6,
  /** Lot depth: 24-30 m; a block is two lots back to back and an alley, 53 m. */
  lotDepth: 24,
  /** House depth: 12-18 m, leaving an 8.4 m rear yard (3-9 m) behind a 0.6 m setback. */
  houseDepth: 15,
  /** Front setback: 0-1.5 m (Philadelphia, Baltimore); the stoop stands in it and the frontage zone. */
  setback: 0.6,
  /** Mid-block rear alley along the long axis: 3.7-6.1 m, 4.9-5.5 m practical one-way service. */
  alley: 5,
  carriageway: CARRIAGEWAY,
  /** Travel lane: 3.0-3.4 m (Philadelphia 10 ft). */
  travelLane: 3.1,
  /** Parking lane: 2.1-2.7 m (Philadelphia 8 ft). */
  parkingLane: 2.4,
  sidewalk: SIDEWALK,
  sidewalkFrontage: 0.6,
  sidewalkClear: 1.8,
  sidewalkFurniture: 1.2,
  wallReach: (CARRIAGEWAY + 2 * SIDEWALK) / 2,
} as const;

/** Blocks of the drawn-only backdrop round the playable grid: one ring, so the walls never show an edge to the world. */
export const BACKDROP_RINGS = 1;

/** The park block (column, row): the centre one, open to all four streets, no central courtyard. */
export const PARK_BLOCK = { column: 1, row: 1 } as const;

/** The park: basketball court 28 x 15 m (FIBA), set off the cross paths; 2.4 m paths (two people abreast); N-S paths 42 m either side of the middle so the lawn opens to the street at three points a long side. */
export const PARK = { courtLength: 28, courtWidth: 15, courtOffsetX: 22, courtOffsetZ: 14, pathWidth: 2.4, crossPaths: [-42, 0, 42] } as const;

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

/** Spawn: rows of four abreast across the first interior intersection heading east, one row gap (8 m) behind its centre so three rows stand in the 23 m the parking gaps leave clear, shifted 2 m off the street's middle so four abreast at 4 m span 12 m of the 18.2 m between building faces. */
export const SPAWN_BEHIND_CENTRE = 8;
export const SPAWN_LATERAL_SHIFT = 2;
/** The cops' formation behind the anchor: two files either side of the lane's middle, 5.5 m apart nose to tail, 11 m back. */
export const SPAWN_FORMATION_BACK = 11;
export const SPAWN_FORMATION_STEP = 5.5;
export const SPAWN_FORMATION_LATERAL = 1.5;
export const SPAWN_FORMATION_COUNT = 5;

/** Yaw of a prefab whose front (local +x) faces each way: north is -z. */
export const FACING = { north: Math.PI / 2, south: -Math.PI / 2, west: Math.PI, east: 0 } as const;
