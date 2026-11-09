import { describe, expect, it } from "vitest";
import { EVENT_KIND, EVENT_TRIPLE } from "../ai/civilians/civilian-constants.ts";
import { FRAME_SECONDS, newCrowd, stepUntilShown } from "../ai/civilians/civilian-crowd.test-util.ts";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { AMBULANCE } from "../ai/openworld-traffic/ambulance.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { AmbulanceStages } from "./engine-openworld-ambulance.ts";

/** Two crowds of one seed and map, the host's and a client's, run for the same game seconds. */
const MAP = buildFixtureMap();
const SEED = 5;
const SECONDS = 90;
const CAR = 7;

describe("given the ambulance's stages in the crowd's event log", () => {
  function hostCrowd(note: boolean) {
    const crowd = newCrowd(MAP, 60, SEED);
    let seconds = stepUntilShown(crowd);
    const stages = new AmbulanceStages();
    if (note) {
      stages.note(crowd, AMBULANCE.coming, CAR);
      stages.note(crowd, AMBULANCE.loading, CAR);
      stages.note(crowd, AMBULANCE.leaving, CAR);
      stages.note(crowd, AMBULANCE.idle, CAR);
    }
    for (const end = seconds + SECONDS; seconds < end; seconds += FRAME_SECONDS) crowd.step(seconds, [], true);
    return { crowd, stages };
  }

  it("when the host notes each stage, then a guest reading the log reads the newest stage and its car", () => {
    const { crowd } = hostCrowd(true);
    const log = crowd.eventLog();
    const stagesInLog: number[] = [];
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) if (log[at] === EVENT_KIND.ambulanceStage) stagesInLog.push(log[at + 1]!);
    expect(stagesInLog.map((subject) => subject % 4).join(), "states in the log, in order: coming, loading, leaving, idle").toBe("1,2,3,0");
    const guest = new AmbulanceStages();
    guest.hear(log);
    expect(guest.state, "the guest's state: the newest, idle").toBe(AMBULANCE.idle);
    expect(guest.car, "its car with none out").toBe(-1);
    let lastStage = log.length;
    for (let at = log.length - EVENT_TRIPLE; at >= 0 && lastStage === log.length; at -= EVENT_TRIPLE) if (log[at] === EVENT_KIND.ambulanceStage) lastStage = at;
    guest.hear(log.slice(0, lastStage));
    expect(guest.state, "the guest's state with the last stage not yet heard").toBe(AMBULANCE.leaving);
    expect(guest.car, "its car while out").toBe(CAR);
  });

  it("when a guest has heard no stage, then no ambulance is out", () => {
    const guest = new AmbulanceStages();
    guest.hear(Float64Array.of(EVENT_KIND.knock, 3, 1.5));
    expect(guest.state, "state").toBe(AMBULANCE.idle);
    expect(guest.car, "car").toBe(-1);
  });

  it("when a stage is in the log, then the brain drops it: the society goes on exactly as it does without", () => {
    const withStages = hostCrowd(true).crowd.state.ints;
    const without = hostCrowd(false).crowd.state.ints;
    expect(firstMismatch(withStages, without), "the brain's ints differ at").toBeUndefined();
  });
});
