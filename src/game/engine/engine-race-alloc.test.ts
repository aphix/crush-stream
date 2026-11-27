import { beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";
import type { CrashEngine } from "./engine.ts";

stubBrowser();
globalThis.location.hash = "#scene=race&track=figure-8&ai=21&seed=5";

/** Seconds of race before the first read: past the grid and most of V8's tier-up (cold code boxes every double). */
const WARM_SECONDS = 12;
/** Seconds of frames one read spans; it is repeated until one is quiet, as the box's load moves how long cold code lasts. */
const READ_SECONDS = 2;
/** Measured at 2.4 MB a frame with the cage point loop boxing the plan box it asks the surfaces about, 0.16 MB without. */
const BOUND_KB = 500;

describe("given the figure-8 race with 21 rivals on the real engine, warmed up", () => {
  let engine: CrashEngine;
  beforeAll(async () => {
    engine = await bootEngine({ pacer: true });
    runSeconds(engine, WARM_SECONDS);
  }, 120_000);

  // mutation: sed -i 's/^  return PLAN_BOX\[BOX_TOP\]! < limit;/  return Number(`${PLAN_BOX[BOX_TOP]!}`) < limit;/' src/game/world/surfaces.ts
  it(`when a window of frames is stepped, then a frame allocates at most ${BOUND_KB} KB (the cage points ask the surfaces about boxes by the thousand a frame)`, () => {
    const kb = untilQuiet(() => allocatedBytes(() => runSeconds(engine, READ_SECONDS)) / (READ_SECONDS * FRAME_HZ) / 1024, BOUND_KB);
    expect(kb, `${kb.toFixed(0)} KB a frame > ${BOUND_KB} in every window for ${COMPILE_WAIT_S} s: a per-point read allocates again`).toBeLessThanOrEqual(BOUND_KB);
  }, 300_000);
});
