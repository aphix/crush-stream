import { describe, expect, it } from "vitest";
import { LIGHT, lightPhase, lightState, SIGNAL_PHASE } from "./traffic-lights.ts";
import { CYCLE_SECONDS } from "./traffic-world.test-util.ts";

const JUNCTIONS = 16;
const SAMPLE_STEP = 0.25;
const PHASES = [SIGNAL_PHASE.northSouthThrough, SIGNAL_PHASE.northSouthLeft, SIGNAL_PHASE.eastWestThrough, SIGNAL_PHASE.eastWestLeft];

describe("given the signals of the open world's junctions", () => {
  // mutation: sed -i 's/(seconds + junction \* LIGHT_STAGGER_SECONDS) % CYCLE_SECONDS/(seconds + junction * LIGHT_STAGGER_SECONDS) % (CYCLE_SECONDS + 0.5)/' src/game/ai/openworld-traffic/traffic-lights.ts
  it("when the crowd clock runs a whole cycle on, then every junction shows the phase it showed (a pure function of the clock)", () => {
    const cycle = CYCLE_SECONDS;
    for (let junction = 0; junction < JUNCTIONS; junction++) {
      for (let seconds = 0; seconds < 3 * cycle; seconds += SAMPLE_STEP) {
        expect(lightPhase(junction, seconds + cycle), `junction ${junction} at ${seconds} s`).toBe(lightPhase(junction, seconds));
      }
    }
  });

  // mutation: sed -i 's/if (Math.floor(packed \/ STAGE_COUNT) !== phase) return LIGHT.red;/if (Math.floor(packed \/ STAGE_COUNT) % 2 !== phase % 2) return LIGHT.red;/' src/game/ai/openworld-traffic/traffic-lights.ts
  it("when any instant is read, then at most one of a junction's four phases is green and every phase is green for a while", () => {
    const cycle = CYCLE_SECONDS;
    for (let junction = 0; junction < JUNCTIONS; junction++) {
      const greenSeconds = [0, 0, 0, 0];
      for (let seconds = 0; seconds < cycle; seconds += SAMPLE_STEP) {
        const green = PHASES.filter((phase) => lightState(junction, phase, seconds) === LIGHT.green);
        expect(green.length, `junction ${junction} at ${seconds} s: green phases ${green.join()}`).toBeLessThanOrEqual(1);
        for (const phase of green) greenSeconds[phase]! += SAMPLE_STEP;
      }
      for (const phase of PHASES) expect(greenSeconds[phase]!, `junction ${junction} phase ${phase} green seconds`).toBeGreaterThan(5);
    }
  });

  // mutation: sed -i 's/LIGHT_STAGGER_SECONDS = 19/LIGHT_STAGGER_SECONDS = 0/' src/game/ai/openworld-traffic/traffic-constants.ts
  it("when two neighbouring junctions are read together, then they are not on the same phase all the time (the stagger)", () => {
    const cycle = CYCLE_SECONDS;
    let apart = 0;
    for (let seconds = 0; seconds < cycle; seconds += SAMPLE_STEP) if (lightPhase(0, seconds) !== lightPhase(1, seconds)) apart++;
    expect(apart).toBeGreaterThan((cycle / SAMPLE_STEP) * 0.5);
  });
});
