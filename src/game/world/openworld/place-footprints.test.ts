import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { allocatedBytes, untilQuiet } from "../../kernel/alloc-sample.test-util.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { layOutLots } from "./openworld-lots.ts";
import { PlaceFootprints } from "./place-footprints.ts";
import type { Place } from "./walk-graph.ts";

/** The bodies' margin round a footprint (m). */
const MARGIN = 0.4;
/** Seeded points read across the city and 40 m past its edge on every side. */
const POINTS = 40_000;
const PAST_EDGE_M = 40;
/** Calls a read makes: one small object a call would read far above the bound. */
const CALLS = 20_000;
/** The sampling profiler's own cost is 4-5 KB of a read. */
const BOUND_BYTES = 8192;
/** Unread rounds of asks first: cold code boxes every double it passes. */
const WARM_READS = 50;

const map = buildOpenWorldMap(layOutLots());

/** The test every body made before the grid: every place inside the walls, its footprint grown by `margin`. */
function insideAnyScanned(places: readonly Place[], x: number, z: number, margin: number): boolean {
  for (let place = 0; place < places.length; place++) {
    const entry = places[place]!;
    if (entry.doorNode < 0) continue;
    const dx = x - entry.x;
    const dz = z - entry.z;
    const cos = detCos(entry.yaw);
    const sin = detSin(entry.yaw);
    if (Math.abs(dx * cos - dz * sin) < entry.depth / 2 + margin && Math.abs(dx * sin + dz * cos) < entry.width / 2 + margin) return true;
  }
  return false;
}

/** A seeded linear congruential stream in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296;
}

describe("given the city's map", () => {
  // mutation: sed -i 's/const r1 = cellOf(z + reach\[at\]!, minZ);/const r1 = cellOf(z, minZ);/' src/game/world/openworld/place-footprints.ts
  it("when 40,000 seeded points across it and past its edges are asked whether they stand inside a building, then the grid answers as a scan of every place does, inside and out", () => {
    const grid = new PlaceFootprints(map.places, MARGIN);
    const next = seeded(20261122);
    const xs = Float32Array.from({ length: POINTS }, () => (next() * 2 - 1) * (map.halfX + PAST_EDGE_M));
    const zs = Float32Array.from({ length: POINTS }, () => (next() * 2 - 1) * (map.halfZ + PAST_EDGE_M));
    let inside = 0;
    let outside = 0;
    for (let point = 0; point < POINTS; point++) {
      const scanned = insideAnyScanned(map.places, xs[point]!, zs[point]!, MARGIN);
      expect(grid.inside(xs, zs, point), `(${xs[point]!.toFixed(2)}, ${zs[point]!.toFixed(2)})`).toBe(scanned);
      if (scanned) inside++;
      else outside++;
    }
    expect(inside, "control: points inside a building").toBeGreaterThan(POINTS / 10);
    expect(outside, "control: points on the street").toBeGreaterThan(POINTS / 10);
  });

  // mutation: sed -i 's/^    const frame = this.frame;/    const frame = this.frame.subarray(0);/' src/game/world/openworld/place-footprints.ts
  it("when the grid is asked 20,000 times, then all of the asks together allocate under 8 KB", () => {
    const grid = new PlaceFootprints(map.places, MARGIN);
    const house = map.places.find((place) => place.doorNode >= 0)!;
    // The points come from typed arrays, as the bodies' do from the crowd's poses.
    const xs = Float32Array.from({ length: CALLS }, (_, call) => house.x + (call % 7) * 0.5);
    const zs = new Float32Array(CALLS).fill(house.z);
    let hits = 0;
    const ask = (): void => {
      for (let call = 0; call < CALLS; call++) if (grid.inside(xs, zs, call)) hits++;
    };
    for (let warm = 0; warm < WARM_READS; warm++) ask();
    const bytes = untilQuiet(() => allocatedBytes(ask), BOUND_BYTES);
    expect(hits, "control: the house's middle is inside").toBeGreaterThan(0);
    expect(bytes, "bytes allocated by 20,000 asks").toBeLessThanOrEqual(BOUND_BYTES);
  });

  // mutation: sed -i 's/^  const places: Place\[\] = lots.places.map((place, index) => placeRecord(place, doorNodes\[index\]!));/  const places: Place[] = lots.places.map((place, index) => ({ ...place, doorNode: doorNodes[index]! }));/' src/game/world/openworld/openworld-map.ts
  it("when its places are read, then every one has the same fields in the same order (one shape, so a scan's number reads are not boxed), and each reads as the lots laid it at its door", () => {
    const lots = layOutLots();
    const built = buildOpenWorldMap(lots);
    const keys = new Set(built.places.map((place) => Object.keys(place).join(",")));
    expect([...keys], "field orders among the places").toHaveLength(1);
    for (let place = 0; place < built.places.length; place++) {
      const record = built.places[place]!;
      for (const [field, laid] of Object.entries(lots.places[place]!)) {
        if (field === "doorNode") continue;
        expect(Object.hasOwn(record, field), `place ${place} keeps ${field}`).toBe(true);
        expect(Reflect.get(record, field), `place ${place} ${field}`).toBe(laid);
      }
    }
  });
});
