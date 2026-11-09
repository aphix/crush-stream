import { describe, expect, it } from "vitest";
import { digestOf, harness, runFor, traceOf, type Harness } from "./crime-fixture.test-util.ts";

const CRIMINAL = 1;
const SECONDS = 40;

/** A crime at x = 60 with every cop at the west end: a flight, a hiding place and a search to compare. */
function chase(seed: number, authority = true): Harness {
  const run = harness([0, 0, 0], { seed, authority });
  run.offences.x[CRIMINAL] = 60;
  run.offences.commitCrime(CRIMINAL);
  return run;
}

describe("the chase is the same on every peer", () => {
  it("makes the same moves from the same seed and society, and other moves from another seed", () => {
    const first = traceOf(chase(7), SECONDS);
    expect(traceOf(chase(7), SECONDS), "the same seed").toBe(first);
    expect(traceOf(chase(8), SECONDS), "another seed").not.toBe(first);
  });

  it("moves a client's cops and suspects where the host's are, whatever the host raises", () => {
    const host = chase(7);
    const client = chase(7, false);
    expect(traceOf(client, SECONDS), "the client's chase").toBe(traceOf(host, SECONDS));
  });

  it("does not depend on the frame rate it is stepped at", () => {
    const regular = chase(7);
    runFor(regular, SECONDS);
    const irregular = chase(7);
    irregular.poses.shown.fill(1);
    irregular.poses.x[CRIMINAL] = 60;
    for (let time = 0.037; time < SECONDS; time += 0.037) irregular.scene.step(time, true, irregular.poses);
    irregular.scene.step(SECONDS, true, irregular.poses);
    expect(digestOf(irregular)).toBe(digestOf(regular));
  });
});
