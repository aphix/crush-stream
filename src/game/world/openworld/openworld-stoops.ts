import { detCos, detSin } from "../../kernel/physics-core.js";
import { DOOR, type Frontage, STOOP } from "./openworld-facade-solids.ts";

/** A riser is climbed over this long (m) of the walk, centred on the riser's edge: a person's feet follow a tread and go up to the next over a stride, not in a jump. */
const RISER_EASE = 0.14;
/** The door stands this far (m) in from the facade face and is still the landing: a door node a hair inside the wall keeps the sill's height. */
const DOOR_DEPTH = 0.3;
/** The stoop's cell (m) in the lookup grid: a stoop is 1.6 m wide and 1.6 m out, so the cell its middle stands in and its eight neighbours hold every point that is on it. */
const CELL = 4;
/** Where a stoop's middle is out from the facade (m). */
const STOOP_MIDDLE = STOOP.run / 2;
/** The grid's cells are numbered up to half this many each way from the origin (a cell is 4 m: the open world is some hundreds of metres across). */
const CELL_KEYS = 4096;
/** A walker on the sidewalk is kept this far (m) beyond a stoop's foot: half a body and the drawn walk's lag. */
const KEEP_CLEAR = 0.6;

/** The cell `column`, `row` as one number. */
function cellKey(column: number, row: number): number {
  return (column + CELL_KEYS / 2) * CELL_KEYS + (row + CELL_KEYS / 2);
}

/**
 * How high the rowhomes' stoops lift whoever walks them: from the facade out, five risers of `STOOP.rise` end in the sill at the door, each climbed over a short stretch, so a civilian who leaves her
 * door appears at the sill's height, goes down the steps with her feet following the treads and is at the street's height a step past the bottom one. Pure in the place: every peer reads the same. A stoop lifts
 * only the walker on its door's spur (`leadsToDoor`): one who passes along the sidewalk in front of it, the lane's offset taking her over its foot, stays on the street.
 * Lookups allocate nothing: they take the rows they read and write, not numbers.
 */
export class Stoops {
  private readonly cells = new Map<number, number[]>();
  private readonly frontX: Float64Array;
  private readonly frontZ: Float64Array;
  private readonly cosYaw: Float64Array;
  private readonly sinYaw: Float64Array;
  private readonly doors: Uint8Array;

  /** `frontages` are the stoops, `doorNodes` the walk graph's nodes of their doors. */
  constructor(frontages: readonly Frontage[], doorNodes: readonly number[] = []) {
    this.frontX = Float64Array.from(frontages, (frontage) => frontage.x);
    this.frontZ = Float64Array.from(frontages, (frontage) => frontage.z);
    this.cosYaw = Float64Array.from(frontages, (frontage) => detCos(frontage.yaw));
    this.sinYaw = Float64Array.from(frontages, (frontage) => detSin(frontage.yaw));
    this.doors = new Uint8Array(doorNodes.reduce((most, node) => Math.max(most, node + 1), 0));
    for (const node of doorNodes) this.doors[node] = 1;
    for (let house = 0; house < frontages.length; house++) this.register(house);
  }

  /** Whether the walk from node `from` to node `to` is the spur of a stoop's door (the door is one of its ends): the only walk a stoop lifts. */
  leadsToDoor(from: number, to: number): boolean {
    return this.doors[from] === 1 || this.doors[to] === 1;
  }

  /** `feetY[at]` = the height of the stoop under (`xs[at]`, `zs[at]`): 0 off every stoop. */
  liftFeet(xs: Float32Array, zs: Float32Array, feetY: Float32Array, at: number): void {
    const x = xs[at]!;
    const z = zs[at]!;
    const houses = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    feetY[at] = 0;
    if (houses === undefined) return;
    for (let found = 0; found < houses.length; found++) {
      const house = houses[found]!;
      const dx = x - this.frontX[house]!;
      const dz = z - this.frontZ[house]!;
      const out = dx * this.cosYaw[house]! - dz * this.sinYaw[house]!;
      const across = dx * this.sinYaw[house]! + dz * this.cosYaw[house]! - DOOR.across;
      if (Math.abs(across) > STOOP.width / 2 || out < -DOOR_DEPTH || out > STOOP.run + RISER_EASE / 2) continue;
      let lift = 0;
      for (let riser = 0; riser < STOOP.steps; riser++) {
        const climbed = Math.min(1, Math.max(0, (STOOP.run - riser * STOOP.tread + RISER_EASE / 2 - out) / RISER_EASE));
        lift += STOOP.rise * climbed * climbed * (3 - 2 * climbed);
      }
      feetY[at] = lift;
      return;
    }
  }

  /** A sidewalk walker at (`xs[at]`, `zs[at]`) who would stand on a stoop, or within `KEEP_CLEAR` of its foot, is moved straight out from the facade until she is clear. Past the stoop's sides the keep-out narrows at 45 degrees, so she slides round it. `share` (0 to 1) is how much of that move is made: a walker joining the lane from a door's spur comes into the keep-out over her first metre, not in one frame. */
  keepOut(xs: Float32Array, zs: Float32Array, at: number, share = 1): void {
    const x = xs[at]!;
    const z = zs[at]!;
    const houses = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (houses === undefined) return;
    for (let found = 0; found < houses.length; found++) {
      const house = houses[found]!;
      const dx = x - this.frontX[house]!;
      const dz = z - this.frontZ[house]!;
      const out = dx * this.cosYaw[house]! - dz * this.sinYaw[house]!;
      const across = Math.abs(dx * this.sinYaw[house]! + dz * this.cosYaw[house]! - DOOR.across);
      const need = STOOP.run + KEEP_CLEAR - Math.max(0, across - STOOP.width / 2);
      if (out < -DOOR_DEPTH || out >= need) continue;
      xs[at] = x + (need - out) * share * this.cosYaw[house]!;
      zs[at] = z - (need - out) * share * this.sinYaw[house]!;
      return;
    }
  }

  /** House `house` is listed under the cells its stoop's middle and a stoop's reach round it fall in. */
  private register(house: number): void {
    const middleX = this.frontX[house]! + this.cosYaw[house]! * STOOP_MIDDLE + this.sinYaw[house]! * DOOR.across;
    const middleZ = this.frontZ[house]! - this.sinYaw[house]! * STOOP_MIDDLE + this.cosYaw[house]! * DOOR.across;
    const column = Math.floor(middleX / CELL);
    const row = Math.floor(middleZ / CELL);
    for (let near = -1; near <= 1; near++) {
      for (let nearer = -1; nearer <= 1; nearer++) {
        const key = cellKey(column + near, row + nearer);
        const houses = this.cells.get(key);
        if (houses === undefined) this.cells.set(key, [house]);
        else houses.push(house);
      }
    }
  }
}
