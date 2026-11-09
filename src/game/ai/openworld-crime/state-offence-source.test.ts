import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "../civilians/civilian-graph.test-util.ts";
import { newCrowd } from "../civilians/civilian-crowd.test-util.ts";
import { CRIME_KIND, NEVER_TICK, PURPOSE, RESIDENT_INT, RESIDENT_INT_STRIDE, WITNESS_RADIUS } from "../civilians/civilian-constants.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { StateOffenceSource } from "./state-offence-source.ts";

const map = buildFixtureMap();
const CRIMINAL = 0;
const NEAR_CALLER = 1;
const FAR_CALLER = 2;
const CRIME_TICK = 10;
const CALL_STARTS = 12;
const CALL_ENDS = 20;

/** Row `field` of resident `resident` in the society's rows. */
function setInt(ints: Int32Array, resident: number, field: number, value: number): void {
  ints[resident * RESIDENT_INT_STRIDE + field] = value;
}

/** The society with resident 0 a criminal who robbed place 0 at tick 10, and a witness at that place phoning it in from tick 12 to tick 20. */
function robbery() {
  const crowd = newCrowd(map);
  const { ints } = crowd.state;
  const { placeX, placeZ } = crowd.state.index;
  const scene = 0;
  let far = -1;
  for (let place = 0; place < map.places.length; place++) {
    if (map.places[place]!.doorNode >= 0 && hypot2(placeX[place]! - placeX[scene]!, placeZ[place]! - placeZ[scene]!) > WITNESS_RADIUS) far = place;
  }
  expect(far, "the fixture has a place out of a witness's reach").toBeGreaterThan(0);
  setInt(ints, CRIMINAL, RESIDENT_INT.crimeTick, CRIME_TICK);
  setInt(ints, CRIMINAL, RESIDENT_INT.crimeKind, CRIME_KIND.theft);
  setInt(ints, CRIMINAL, RESIDENT_INT.crimePlace, scene);
  setInt(ints, NEAR_CALLER, RESIDENT_INT.legPurpose, PURPOSE.report);
  setInt(ints, NEAR_CALLER, RESIDENT_INT.place, scene);
  setInt(ints, NEAR_CALLER, RESIDENT_INT.departTick, CALL_STARTS);
  setInt(ints, NEAR_CALLER, RESIDENT_INT.nextDecisionTick, CALL_ENDS);
  setInt(ints, FAR_CALLER, RESIDENT_INT.legPurpose, PURPOSE.report);
  setInt(ints, FAR_CALLER, RESIDENT_INT.place, far);
  setInt(ints, FAR_CALLER, RESIDENT_INT.departTick, CALL_STARTS);
  setInt(ints, FAR_CALLER, RESIDENT_INT.nextDecisionTick, CALL_ENDS - 5);
  return { crowd, ints, source: new StateOffenceSource(crowd, map), far };
}

describe("the law reads a witness's call off the society's rows", () => {
  // mutation: in src/game/ai/openworld-crime/state-offence-source.ts reportDoneTick(), delete the line `if (hypot2(placeX[at]! - this.scratch.x, placeZ[at]! - this.scratch.z) > WITNESS_RADIUS) continue;`
  it("takes the end of the call of a witness near the crime and ignores one who phones from beyond sight of it", () => {
    const { source } = robbery();
    expect(source.reportDoneTick(CRIMINAL), "the near witness's call ends").toBe(CALL_ENDS);
  });

  // mutation: in src/game/ai/openworld-crime/state-offence-source.ts reportDoneTick(), change `|| this.int(caller, RESIDENT_INT.departTick) < since` to `|| false`
  it("ignores a call that began before the crime, and says none when nobody phones", () => {
    const { source, ints } = robbery();
    setInt(ints, NEAR_CALLER, RESIDENT_INT.departTick, CRIME_TICK - 1);
    expect(source.reportDoneTick(CRIMINAL), "an old call").toBe(NEVER_TICK);
    setInt(ints, NEAR_CALLER, RESIDENT_INT.departTick, CALL_STARTS);
    setInt(ints, NEAR_CALLER, RESIDENT_INT.legPurpose, PURPOSE.report + 1);
    expect(source.reportDoneTick(CRIMINAL), "no one phoning").toBe(NEVER_TICK);
  });

  it("says none for a resident with no offence", () => {
    const { source } = robbery();
    expect(source.reportDoneTick(NEAR_CALLER)).toBe(NEVER_TICK);
  });
});
