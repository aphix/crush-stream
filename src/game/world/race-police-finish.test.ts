import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "./ground.ts";
import { FRAME, frame, makeWorld, type World } from "./race-world.test-util.ts";
import { PoliceBrain } from "../ai/police.ts";
import { DEFAULT_RACE_OPTIONS } from "../match/types.ts";
import { TRACK_ID } from "./constants.ts";

/** A three-lap oval race finishes in about 65 s, before any cop on the road has been out long enough to be old. */
const RACE_BOUND = 120;
/** Seconds after the finish a given-up cop out of every view has to be gone in. */
const GONE_IN = 30;

/** Police cars out driving with no racer to chase (given up), by the brain's public reads. */
function givenUp(brain: PoliceBrain, w: World): number {
  let n = 0;
  for (let id = brain.first; id < brain.first + brain.count; id++) if (brain.drives(id)) n++;
  for (let i = 0; i < w.race.racers.length; i++) n -= brain.copsOn(i);
  return n;
}

/** A seeded police race on the oval (the player's car and seven AI), the headless camera seeing nothing: given-up cops at the finish, and `GONE_IN` s on. */
function afterFinish(seed: number): { atFinish: number; after: number; finishedAt: number } {
  const w = makeWorld();
  w.race.enter();
  try {
    w.race.command({ type: "quit" });
    w.race.command({ type: "options", options: { ...DEFAULT_RACE_OPTIONS, trackId: TRACK_ID.oval, laps: 3, aiCount: 7, police: true } });
    w.race.reseed(seed);
    w.race.command({ type: "start" });
    w.seat.mode = "follow";
    const brain = Reflect.get(w.race, "police");
    assert.ok(brain instanceof PoliceBrain, "the race has a police brain");
    const state = { acc: 0 };
    let n = 0;
    for (; n * FRAME < RACE_BOUND && w.race.phase !== "finished"; n++) frame(w, state);
    assert.equal(w.race.phase, "finished", `the race did not finish in ${RACE_BOUND} s`);
    const finishedAt = n * FRAME;
    const atFinish = givenUp(brain, w);
    for (let k = 0; k * FRAME < GONE_IN; k++) frame(w, state);
    return { atFinish, after: givenUp(brain, w), finishedAt };
  } finally {
    w.race.exit();
    setGround(null);
  }
}

describe("given a seeded three-lap police race on the oval that finishes with given-up cops still driving the course", () => {
  it(`when the race is over and no player can see them, then every one is put away within ${GONE_IN} s of the finish`, (t) => {
    const { atFinish, after, finishedAt } = afterFinish(1);
    t.diagnostic(`finished at ${finishedAt.toFixed(1)} s with ${atFinish} given-up cops out; ${after} still out ${GONE_IN} s later`);
    assert.ok(atFinish > 0, "no cop had given up by the finish: the test proves nothing");
    assert.equal(after, 0, `${after} given-up cops still drive the course ${GONE_IN} s after the finish`);
  });
});
