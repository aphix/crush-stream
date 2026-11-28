import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { presentingFrames } from "./headless-gl.mjs";

describe("given headless-frame's frame loop on a GL context that records its calls", () => {
  it("when two frames are asked for, then each hands the context its commands before the frame runs, as a page's present does, 1/60 s apart", async () => {
    const calls = [];
    const nextFrame = presentingFrames({ flush: () => calls.push("flush") }, 1000);
    for (let frame = 0; frame < 2; frame++) {
      nextFrame((stamp) => calls.push(Math.round(stamp * 1000) / 1000));
      await nextTurn();
    }
    expect(calls.join(","), "calls in order").toBe("flush,1016.667,flush,1033.333");
  });
});
