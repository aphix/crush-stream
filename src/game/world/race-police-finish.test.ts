import { describe, expect, it } from "vitest";
import { setGround } from "./ground.ts";
import { FRAME, frame, makeWorld, type World } from "./race-world.test-util.ts";
import { blankPoint, type Track } from "./track.ts";
import { PoliceBrain } from "../ai/police.ts";
import { DEFAULT_RACE_OPTIONS } from "../match/types.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
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

/**
 * Seats a stored cop on the road half a lap round, woken and given up, at the first patrol beat after the finish (the brain's own `place`, `wake`
 * and `disband`; its stakeout finds no spot out of every racer's sight once the field is spread round the oval). The race's own given-up cops at
 * the finish drift with the racers' driving (seed 1: 3 before the racers knew their place, 0 after, with 4 give-ups mid-race).
 * Returns the cops seated so far (−1 before that beat).
 */
function seatGivenUpAtFinish(brain: PoliceBrain, w: World): () => number {
  const update = brain.update.bind(brain);
  const packLive = Reflect.get(brain, "packLive") as Uint8Array;
  const track = Reflect.get(brain, "track") as Track;
  const spot = Reflect.get(Reflect.get(brain, "sight") as object, "spot") as { x: number; y: number; z: number; yaw: number; s: number };
  const call = (name: string, ...args: unknown[]): unknown => Reflect.apply(Reflect.get(brain, name) as (...a: unknown[]) => unknown, brain, args);
  let seated = -1;
  brain.update = (time, dt, cars, hunt, lead, world) => {
    update(time, dt, cars, hunt, lead, world);
    if (seated >= 0 || w.race.phase !== "finished") return;
    seated = 0;
    const u = call("free") as number;
    if (u < 0) return;
    let p = 0;
    while (packLive[p]) p++;
    const pt = track.pointAt(track.length / 2, blankPoint());
    spot.x = pt.x;
    spot.y = pt.y;
    spot.z = pt.z;
    spot.yaw = Math.atan2(pt.tx, pt.tz);
    spot.s = track.length / 2;
    call("place", u, p, 0, cars, world);
    call("wake", u, 0);
    call("disband", p);
    seated = 1;
  };
  return () => seated;
}

/** A seeded police race on the oval (the player's car and seven AI), the headless camera seeing nothing, a given-up cop seated at the finish: given-up cops at the finish, and `GONE_IN` s on. */
function afterFinish(seed: number): { atFinish: number; after: number; finishedAt: number } {
  const w = makeWorld();
  w.race.enter();
  try {
    w.race.command({ type: "quit" });
    w.race.command({ type: "options", options: { ...DEFAULT_RACE_OPTIONS, trackId: TRACK_ID.oval, laps: 3, aiCount: 7, police: true, aiDifficulty: AI_EVERY_SLICE } });
    w.race.reseed(seed);
    w.race.command({ type: "start" });
    w.seat.mode = "follow";
    const brain = Reflect.get(w.race, "police");
    expect(brain, "the race has a police brain").toBeInstanceOf(PoliceBrain);
    const seated = seatGivenUpAtFinish(brain, w);
    const state = { acc: 0 };
    let n = 0;
    for (; n * FRAME < RACE_BOUND && w.race.phase !== "finished"; n++) frame(w, state);
    expect(w.race.phase, `the race did not finish in ${RACE_BOUND} s`).toBe("finished");
    const finishedAt = n * FRAME;
    for (let k = 0; seated() < 0 && k * FRAME < 1; k++) frame(w, state);
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
    t.annotate(`finished at ${finishedAt.toFixed(1)} s with ${atFinish} given-up cops out; ${after} still out ${GONE_IN} s later`);
    expect(atFinish, "no cop had given up by the finish: the test proves nothing").toBeGreaterThan(0);
    expect(after, `${after} given-up cops still drive the course ${GONE_IN} s after the finish`).toBe(0);
  });
});
