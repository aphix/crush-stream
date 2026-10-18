/**
 * The High jump's model: where the posts stand, how tall the frame is, the height boards and signs, the cardboard box piles and the net,
 * and the peak that reads the score. Station-local frame: +x is the throw direction, x = 0 the ramp's lip, z = 0 the lane centre,
 * y from the pad (world y = 0). Heights scored and drawn on boards are measured from the lip (y = lipY), lip = 0.
 * Every layout number derives from a measurement (`HighJumpMeasured`) the sizing lane takes; none is committed here.
 */

/** Height boards (the slats between the posts, each a ragdoll collider) stand every this many metres above the lip, all the way up the frame. */
export const BOARD_STEP = 5;
/** A big labelled board stands at every multiple of this many metres above the lip (a multiple of `BOARD_STEP`). */
export const MAJOR_BOARD_EVERY_METRES = 50;
/** The frame's top is the best measured height times this, rounded up to a board: a perfect run falls well short of it. */
export const FRAME_HEADROOM_FACTOR = 1.3;
/**
 * The posts stand this far (m) past the lip, always: the slowest class's 70% run lands 12.0 m out in the sizing table, so the
 * posts are the frame every run climbs beside (the score does not need a run to cross them: it is the highest point he reaches).
 */
export const POSTS_DISTANCE = 11;
/** The net hangs this far (m) past the posts. */
const NET_DISTANCE_PAST_POSTS = 30;
/** The net is at least this tall (m), and at least this share of the best height: the descent in the piles is that high. */
const NET_MIN_HEIGHT = 30;
const NET_HEIGHT_SHARE = 0.5;

/** Half the distance (m) between the two posts. */
export const POST_HALF_SPAN = 3;
/** A post's square cross-section side (m): 0.25 m whatever the frame's height. */
export const POST_THICKNESS = 0.25;
/** A slat's, and a sign's, square cross-section side (m): thinner than a post, so a dummy catches on it and tumbles through. */
export const SLAT_THICKNESS = 0.1;
/**
 * A height sign stands on the slat at every multiple of this many metres above the lip (a multiple of `BOARD_STEP`): a panel as wide
 * as the gap between the posts, `SIGN_HEIGHT` tall and `SLAT_THICKNESS` deep, solid to the dummy like a slat.
 */
export const SIGN_EVERY_METRES = 10;
/** A sign fills the room between its slat and the next, less this clearance (m) so it never touches the slat above. */
const SIGN_CLEARANCE = 0.2;
export const SIGN_HEIGHT = BOARD_STEP - SLAT_THICKNESS - SIGN_CLEARANCE;

/** The landing field (the box piles, the net) reaches this far (m) beside the posts: a dummy does not have to fly between them. */
const FIELD_MARGIN_BESIDE_POSTS = 3;
export const FIELD_HALF_WIDTH = POST_HALF_SPAN + FIELD_MARGIN_BESIDE_POSTS;

/** How many cardboard boxes the landing piles hold (the art's box pool is sized from this same number). */
export const BOX_COUNT = 48;
/** Smallest box edge (m): boxes are sized between this and `BOX_SIZE_MAX`, about dummy-sized (a lying dummy is 2.0 x 0.6 m) so he reads as landing among boxes, not on crates beside 200 m posts. */
export const BOX_SIZE_MIN = 1.6;
/** Largest box edge (m): also sets `BOX_CELL_PITCH`, the room one stack needs. */
export const BOX_SIZE_MAX = 2.6;
/** The piles start this far (m) before the posts, and end this far past the measured landing, never nearer the net than `BOX_NET_CLEARANCE`. */
export const BOX_PILE_LEAD = 3;
export const BOX_PILE_TRAIL = 4;
export const BOX_NET_CLEARANCE = 3;
/** The piles reach this far (m) either side of the lane centre: as wide as the landing field. */
export const BOX_PILE_HALF_WIDTH = FIELD_HALF_WIDTH;
/** Boxes are stacked about this many high; fewer cells than that need force taller stacks. */
const BOX_STACK_LAYERS_TARGET = 2;
/** Square cell (m) one stack stands in: the bounding diameter of the largest box at any yaw, so no two stacks can touch. */
export const BOX_CELL_PITCH = BOX_SIZE_MAX * Math.SQRT2;
/** A box wanders from its cell's centre by this share of the room its bounding circle leaves in the cell. */
const BOX_JITTER_SHARE = 0.5;

/**
 * What the sizing measurement gives: the best run's (best class, full throttle) score, the highest point his torso reaches above the
 * lip (`HighJumpPeak`), and the largest landing distance (m past the lip) over every class's best run.
 */
export type HighJumpMeasured = { bestHeight: number; landingDistance: number };

type HeightBoard = { heightAboveLip: number; y: number; major: boolean };

/** A height sign: the height it names (above the lip) and where its middle stands (m above the pad). */
export type HeightSign = { heightAboveLip: number; y: number };

/** One cardboard box: `y` is the centre height above the pad, `yaw` turns about the vertical. */
export type BoxPlacement = { x: number; y: number; z: number; yaw: number; width: number; height: number; depth: number };

export type HighJumpLayout = {
  postsX: number;
  /** Height of the frame's top above the lip. */
  frameTop: number;
  boards: readonly HeightBoard[];
  /** The height signs: solid panels between the posts, each carrying its height. */
  signs: readonly HeightSign[];
  netX: number;
  /** Height of the catching net above the pad: tall enough for a dummy coming down anywhere in the piles. */
  netHeight: number;
  boxes: readonly BoxPlacement[];
};

/** Each box property reads a different irrational's multiples, so the properties do not follow one another. */
const WIDTH_BASIS = Math.sqrt(2);
const HEIGHT_BASIS = Math.sqrt(3);
const DEPTH_BASIS = Math.sqrt(5);
const YAW_BASIS = Math.sqrt(7);
const JITTER_X_BASIS = Math.sqrt(11);
const JITTER_Z_BASIS = Math.sqrt(13);

function deterministicFraction(boxIndex: number, irrationalBasis: number): number {
  const scaled = (boxIndex + 1) * irrationalBasis;
  return scaled - Math.floor(scaled);
}

function boxSide(boxIndex: number, irrationalBasis: number): number {
  return BOX_SIZE_MIN + deterministicFraction(boxIndex, irrationalBasis) * (BOX_SIZE_MAX - BOX_SIZE_MIN);
}

/** The frame's top above the lip: the best height times the headroom (and never under one board over it), on a board's height. */
function frameTopFor(bestHeight: number): number {
  return Math.ceil(Math.max(bestHeight * FRAME_HEADROOM_FACTOR, bestHeight + BOARD_STEP) / BOARD_STEP) * BOARD_STEP;
}

/** One board per height from the lip line up to, not including, the frame top. */
function heightBoards(frameTop: number, lipY: number): HeightBoard[] {
  const boards: HeightBoard[] = [];
  for (let heightAboveLip = 0; heightAboveLip < frameTop; heightAboveLip += BOARD_STEP) {
    boards.push({ heightAboveLip, y: lipY + heightAboveLip, major: heightAboveLip % MAJOR_BOARD_EVERY_METRES === 0 });
  }
  return boards;
}

/** A sign standing on every `SIGN_EVERY_METRES`-th board (the lip line's included), centred in the room its slat leaves under the next. */
function heightSigns(boards: readonly HeightBoard[]): HeightSign[] {
  return boards
    .filter((board) => board.heightAboveLip % SIGN_EVERY_METRES === 0)
    .map((board) => ({ heightAboveLip: board.heightAboveLip, y: board.y + SLAT_THICKNESS / 2 + SIGN_HEIGHT / 2 }));
}

/**
 * Box piles over the footprint from `pileStartX` to `pileEndX`: a grid of stacks, each in its own cell, spread evenly through the cells. A
 * cell a post (at `postsX`, `POST_HALF_SPAN` either side of the lane) stands in over any part of holds no stack: a post is a ragdoll
 * collider, and a box laid on one would be shoved out of the world.
 */
function boxPiles(pileStartX: number, pileEndX: number, postsX: number): BoxPlacement[] {
  const rowCount = Math.floor((pileEndX - pileStartX) / BOX_CELL_PITCH);
  if (rowCount < 1) {
    throw new RangeError(`the box piles' footprint (${pileEndX - pileStartX} m) is narrower than one cell (${BOX_CELL_PITCH} m)`);
  }
  const columnCount = Math.floor((2 * BOX_PILE_HALF_WIDTH) / BOX_CELL_PITCH);
  const gridStartX = pileStartX + (pileEndX - pileStartX - rowCount * BOX_CELL_PITCH) / 2;
  const cellReach = (BOX_CELL_PITCH + POST_THICKNESS) / 2;
  const cells = Array.from({ length: rowCount * columnCount }, (_, cellIndex) => ({ row: Math.floor(cellIndex / columnCount), column: cellIndex % columnCount })).filter(
    ({ row, column }) =>
      Math.abs(gridStartX + (row + 0.5) * BOX_CELL_PITCH - postsX) >= cellReach ||
      [-1, 1].every((side) => Math.abs((column + 0.5 - columnCount / 2) * BOX_CELL_PITCH - side * POST_HALF_SPAN) >= cellReach),
  );
  const cellCount = cells.length;
  const stackCount = Math.min(cellCount, Math.ceil(BOX_COUNT / BOX_STACK_LAYERS_TARGET));
  const stackTops = Array.from({ length: stackCount }, () => 0);
  return Array.from({ length: BOX_COUNT }, (_, boxIndex) => {
    const stackIndex = boxIndex % stackCount;
    const { row, column } = cells[Math.floor((stackIndex * cellCount) / stackCount)]!;
    const width = boxSide(boxIndex, WIDTH_BASIS);
    const height = boxSide(boxIndex, HEIGHT_BASIS);
    const depth = boxSide(boxIndex, DEPTH_BASIS);
    const jitterRange = ((BOX_CELL_PITCH - Math.sqrt(width * width + depth * depth)) / 2) * BOX_JITTER_SHARE;
    const y = stackTops[stackIndex] + height / 2;
    stackTops[stackIndex] += height;
    return {
      x: gridStartX + (row + 0.5) * BOX_CELL_PITCH + (2 * deterministicFraction(boxIndex, JITTER_X_BASIS) - 1) * jitterRange,
      y,
      z: (column + 0.5 - columnCount / 2) * BOX_CELL_PITCH + (2 * deterministicFraction(boxIndex, JITTER_Z_BASIS) - 1) * jitterRange,
      yaw: deterministicFraction(boxIndex, YAW_BASIS) * Math.PI,
      width,
      height,
      depth,
    };
  });
}

/** The frame, boards, signs, net and box piles for the measured best throw; `lipY` is the lip's height above the pad. */
export function highJumpLayout(measured: HighJumpMeasured, lipY: number): HighJumpLayout {
  const postsX = POSTS_DISTANCE;
  const frameTop = frameTopFor(measured.bestHeight);
  const netX = postsX + NET_DISTANCE_PAST_POSTS;
  const pileEndX = Math.min(measured.landingDistance + BOX_PILE_TRAIL, netX - BOX_NET_CLEARANCE);
  const boards = heightBoards(frameTop, lipY);
  return {
    postsX,
    frameTop,
    boards,
    signs: heightSigns(boards),
    netX,
    netHeight: Math.max(NET_MIN_HEIGHT, measured.bestHeight * NET_HEIGHT_SHARE),
    boxes: boxPiles(postsX - BOX_PILE_LEAD, pileEndX, postsX),
  };
}

/** One torso sample in the station-local frame; `still` is how long (sim s) the torso has barely moved. */
export type TorsoSample = { x: number; y: number; z: number; still: number };

/**
 * Reads the score: the highest point his torso reached above the lip, from the throw until he lies still, wherever it was (over the
 * posts, caught on a slat or a sign, beside the frame). The torso is sampled once per render frame and nothing between two samples is
 * read: a ballistic apex between frames is under a millimetre above the higher sample (g/8 times the frame's square at 60 Hz).
 */
export class HighJumpPeak {
  private peakHeight = 0;

  /** The highest point so far, metres above the lip (0 until he rises above it). */
  get height(): number {
    return this.peakHeight;
  }

  reset(): void {
    this.peakHeight = 0;
  }

  /** Takes this frame's torso; returns the highest point so far. */
  step(torso: TorsoSample, lipY: number): number {
    this.peakHeight = Math.max(this.peakHeight, torso.y - lipY);
    return this.peakHeight;
  }
}
