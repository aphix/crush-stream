import { mulberry32 } from "../placements.ts";
import { MAX_STOREYS, MIN_STOREYS } from "./interior-kinds.ts";

/** Where each storey count lands among the lots of a face (shares, in order of storeys 2, 3, 4, 5): a street of mostly three-storey houses with some taller and a few lower. */
const STOREY_SHARES = [0.1, 0.6, 0.25, 0.05] as const;
/** The chance a lot starts a run of low houses, and how long that run is (lots, the first included): a short row of two-storey houses now and then. */
const LOW_RUN_CHANCE = 0.08;
const LOW_RUN_MIN = 2;
const LOW_RUN_SPREAD = 3;
/** The end lot of a face is a corner house or shop, a storey taller than its row. */
const CORNER_BONUS = 1;
/** Mixes a block's row and column and its face into a face's seed (distinct primes, so no two faces share one). */
const SEED_MIX = { salt: 0x57a9e5, row: 97, column: 31, south: 7 } as const;

/** The seeded walk along one face of a block, west to east: each lot's storeys before the corners are given theirs. Pure in its arguments, and a longer walk repeats a shorter. */
export function walkOfFace(row: number, column: number, south: boolean, lotCount: number): number[] {
  const random = mulberry32(SEED_MIX.salt + row * SEED_MIX.row + column * SEED_MIX.column + (south ? SEED_MIX.south : 0));
  const storeys: number[] = [];
  let lowRun = 0;
  for (let lot = 0; lot < lotCount; lot++) {
    if (lowRun > 0) {
      storeys.push(MIN_STOREYS);
      lowRun--;
      continue;
    }
    const roll = random();
    if (roll < LOW_RUN_CHANCE) {
      lowRun = LOW_RUN_MIN - 1 + Math.floor(random() * LOW_RUN_SPREAD);
      storeys.push(MIN_STOREYS);
      continue;
    }
    let pick = random();
    let count = MIN_STOREYS;
    for (const share of STOREY_SHARES) {
      if (pick < share) break;
      pick -= share;
      count++;
    }
    storeys.push(count);
  }
  return storeys;
}

/** The storey count of the lots of one face of a block, west to east: the walk, with the lot at either end a storey taller (a corner house or shop). */
export function storeysOfFace(row: number, column: number, south: boolean, lotCount: number): number[] {
  const storeys = walkOfFace(row, column, south, lotCount);
  for (const end of [0, lotCount - 1]) storeys[end] = Math.min(MAX_STOREYS, storeys[end]! + CORNER_BONUS);
  return storeys;
}
