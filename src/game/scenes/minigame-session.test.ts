import { describe, expect, it } from "vitest";
import { REST_HOLD, THROWS_PER_SET, type MinigameMode } from "./minigame-constants.ts";
import { FIELD_HALF_WIDTH, SCORE_BAND_HALF_DEPTH } from "./minigame-high-jump.ts";
import type { TorsoSample } from "./minigame-high-jump.ts";
import { RING_CUPS, RING_POCKETS } from "./minigame-ring.ts";
import { MinigameSession, type MinigameBestPair, type MinigameBests, type MinigameFrame } from "./minigame-session.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const CAR_TYPE = "muscle";
const POSTS_X = 40;
const LIP_Y = 2.5;
const HIGH_JUMP_OPTIONS = { carType: CAR_TYPE, highJump: { postsX: POSTS_X, lipY: LIP_Y } };
const LONG_JUMP_OPTIONS = { carType: CAR_TYPE };
const STILL_BEFORE_REST = REST_HOLD / 2;
const FRAMES_AFTER_SCORING = 1000;
const SET_LENGTH = 3;

type RecordedScore = { mode: MinigameMode; throwsPerSet: number | null; carType: string; score: number };

/** A bests double: keeps the best pair and remembers every `record` call. */
function fakeBests(initial: MinigameBestPair = { thisCar: null, overall: null }): MinigameBests & { recorded: RecordedScore[] } {
  const recorded: RecordedScore[] = [];
  let current = initial;
  return {
    recorded,
    bestFor: () => current,
    record(mode, throwsPerSet, carType, score) {
      recorded.push({ mode, throwsPerSet, carType, score });
      current = { thisCar: Math.max(score, current.thisCar ?? 0), overall: Math.max(score, current.overall ?? 0) };
      return true;
    },
  };
}

function torsoAt(x: number, y: number, z: number, still: number): TorsoSample {
  return { x, y, z, still };
}

/** The car has stood on the hilltop this long (s) as the pedal goes down: a parked car is at rest, not moving. */
const PARKED_STILL = 5;
const PEDAL: MinigameFrame = { pedalPressed: true, thrown: false, torso: null, carStill: PARKED_STILL };
const THROW: MinigameFrame = { pedalPressed: false, thrown: true, torso: null, carStill: 0 };

function flying(torso: TorsoSample): MinigameFrame {
  return { pedalPressed: false, thrown: true, torso, carStill: 0 };
}

/** Pedal, ejection, then the torso lying still at (x, 0, z) for the rest hold: the attempt scores on the last frame. */
function throwAndRestAt(session: MinigameSession, x: number, z = 0): { scored: number } | null {
  session.step(PEDAL);
  session.step(THROW);
  session.step(flying(torsoAt(x, 0, z, STILL_BEFORE_REST)));
  return session.step(flying(torsoAt(x, 0, z, REST_HOLD)));
}

function expectScored(result: { scored: number } | null, scored: number, what: string): void {
  expect(result, `${what}: a score came out`).not.toBeNull();
  expect(result?.scored, `${what}: scored`).toBe(scored);
}

function expectRecorded(recorded: RecordedScore[], rows: RecordedScore[], what: string): void {
  expect(recorded, `${what}: rows recorded`).toHaveLength(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const got = recorded[i];
    const want = rows[i];
    if (!got || !want) throw new Error(`${what}: row ${i} missing`);
    expect(got.mode, `${what}: row ${i} mode`).toBe(want.mode);
    expect(got.throwsPerSet, `${what}: row ${i} throwsPerSet`).toBe(want.throwsPerSet);
    expect(got.carType, `${what}: row ${i} carType`).toBe(want.carType);
    expect(got.score, `${what}: row ${i} score`).toBe(want.score);
  }
}

describe("given a long jump session", () => {
  it("when no pedal is pressed, then it stays ready, even when the ejection flag is up", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("longJump", LONG_JUMP_OPTIONS);
    session.step({ pedalPressed: false, thrown: false, torso: null, carStill: 0 });
    session.step(THROW);
    expect(session.hud().phase, "phase without a pedal press").toBe("ready");
  });

  it("when the pedal is pressed, then it runs, and when he is ejected, then it is thrown", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("longJump", LONG_JUMP_OPTIONS);
    session.step(PEDAL);
    expect(session.hud().phase, "phase after the pedal").toBe("running");
    session.step({ pedalPressed: false, thrown: false, torso: null, carStill: 0 });
    expect(session.hud().phase, "phase while driving on").toBe("running");
    session.step(THROW);
    expect(session.hud().phase, "phase after the ejection").toBe("thrown");
  });

  it("when he is flying or lying still for less than the rest hold, then nothing scores and the live value is his distance past the lip", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("longJump", LONG_JUMP_OPTIONS);
    session.step(PEDAL);
    session.step(THROW);
    expect(session.step(flying(torsoAt(30, 4, 0, 0))), "frame in flight").toBe(null);
    expect(session.hud().liveValue, "live distance in flight").toBe(30);
    for (let frame = 0; frame < FRAMES_AFTER_SCORING; frame++) {
      expect(session.step(flying(torsoAt(52, 0, 0, REST_HOLD - 0.01))), "frame just short of the rest hold").toBe(null);
    }
    expect(session.hud().phase, "phase just short of the rest hold").toBe("thrown");
    expect(session.hud().lastScore, "no score yet").toBe(null);
  });

  it("when his torso has lain still for the rest hold, then the score is its x in metres and the card shows it", () => {
    const bests = fakeBests();
    const session = new MinigameSession(bests);
    session.begin("longJump", LONG_JUMP_OPTIONS);
    const result = throwAndRestAt(session, 57.25);
    expectScored(result, 57.25, "score on the resting frame");
    const card = session.hud();
    expect(card.phase, "phase").toBe("scored");
    expect(card.lastScore, "last score").toBe(57.25);
    expect(card.liveValue, "live value once scored").toBe(null);
    expect(card.setScores, "no set in the long jump").toHaveLength(0);
    expect(card.throwsPerSet, "no set length in the long jump").toBe(null);
    expectRecorded(bests.recorded, [{ mode: "longJump", throwsPerSet: null, carType: "muscle", score: 57.25 }], "the throw is recorded");
  });

  it("when he comes to rest behind the lip, then the score is floored at 0", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("longJump", LONG_JUMP_OPTIONS);
    expectScored(throwAndRestAt(session, -3), 0, "score behind the lip");
  });

  it("when the session has scored, then a thousand more frames of any kind change nothing", () => {
    const bests = fakeBests();
    const session = new MinigameSession(bests);
    session.begin("longJump", LONG_JUMP_OPTIONS);
    throwAndRestAt(session, 20);
    const before = session.hud();
    for (let frame = 0; frame < FRAMES_AFTER_SCORING; frame++) {
      expect(session.step({ pedalPressed: frame % 2 === 0, thrown: true, torso: torsoAt(90 + frame, 9, 0, REST_HOLD + frame), carStill: frame }), "frame after scoring").toBe(null);
    }
    expect(JSON.stringify(session.hud()), "card after the idle frames").toBe(JSON.stringify(before));
    expect(bests.recorded.length, "nothing recorded again").toBe(1);
  });

  it("when retry follows a scored attempt, then the next attempt is ready and numbered 2, keeping the last score", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("longJump", LONG_JUMP_OPTIONS);
    throwAndRestAt(session, 20);
    session.retry();
    const card = session.hud();
    expect(card.phase, "phase").toBe("ready");
    expect(card.attempt, "attempt").toBe(2);
    expect(card.lastScore, "last score stays on the card").toBe(20);
    expect(throwAndRestAt(session, 25)?.scored, "the second attempt scores").toBe(25);
  });

  it("when retry comes before the attempt has scored, then it does nothing", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("longJump", LONG_JUMP_OPTIONS);
    session.retry();
    expect(firstMismatch([session.hud().phase, session.hud().attempt], ["ready", 1]), "after retry in ready").toBeUndefined();
    session.step(PEDAL);
    session.retry();
    expect(firstMismatch([session.hud().phase, session.hud().attempt], ["running", 1]), "after retry while running").toBeUndefined();
    session.step(THROW);
    session.retry();
    expect(firstMismatch([session.hud().phase, session.hud().attempt], ["thrown", 1]), "after retry while thrown").toBeUndefined();
  });

  it("when the run is reset before the throw, then it is ready again, the attempt number is unchanged and nothing is recorded", () => {
    const bests = fakeBests();
    const session = new MinigameSession(bests);
    session.begin("longJump", LONG_JUMP_OPTIONS);
    session.step(PEDAL);
    session.resetRun();
    expect(firstMismatch([session.hud().phase, session.hud().attempt], ["ready", 1]), "after the reset").toBeUndefined();
    expect(bests.recorded, "nothing recorded").toHaveLength(0);
    expect(throwAndRestAt(session, 12)?.scored, "the same attempt then scores").toBe(12);
    expect(session.hud().attempt, "attempt after scoring").toBe(1);
  });

  it("when the run is reset after the throw, then it does nothing", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("longJump", LONG_JUMP_OPTIONS);
    session.step(PEDAL);
    session.step(THROW);
    session.resetRun();
    expect(session.hud().phase, "phase after a reset once thrown").toBe("thrown");
  });

  it("when the mode's best comes from the store, then the card shows the stored pair, and after the throw the store's new pair", () => {
    const stored = { thisCar: 31, overall: 44 };
    const session = new MinigameSession(fakeBests(stored));
    session.begin("longJump", LONG_JUMP_OPTIONS);
    expect(session.hud().best.thisCar, "best before the throw, this car").toBe(31);
    expect(session.hud().best.overall, "best before the throw, overall").toBe(44);
    throwAndRestAt(session, 36);
    expect(session.hud().best.thisCar, "best after a throw that beats this car's but not the overall, this car").toBe(36);
    expect(session.hud().best.overall, "best after a throw that beats this car's but not the overall, overall").toBe(44);
  });

  describe("given the car drives and nobody is thrown", () => {
    const DRIVING: MinigameFrame = { pedalPressed: false, thrown: false, torso: null, carStill: 0 };
    const atRest = (carStill: number): MinigameFrame => ({ pedalPressed: false, thrown: false, torso: null, carStill });

    it("when the car that drove has lain still the rest hold, then the attempt is scored as a no throw: no score, nothing recorded, the earlier score and attempt kept", () => {
      const bests = fakeBests();
      const session = new MinigameSession(bests);
      session.begin("longJump", LONG_JUMP_OPTIONS);
      throwAndRestAt(session, 20);
      session.retry();
      session.step(PEDAL);
      session.step(DRIVING);
      expect(session.step(atRest(REST_HOLD - 0.01)), "a frame short of the rest hold").toBe(null);
      expect(session.hud().phase, "still running just short of it").toBe("running");
      expect(session.step(atRest(REST_HOLD)), "no score on the resting frame").toBe(null);
      const card = session.hud();
      expect(card.phase, "phase").toBe("scored");
      expect(card.noThrow, "no throw").toBe(true);
      expect(card.attempt, "attempt").toBe(2);
      expect(card.lastScore, "the earlier throw's score stays on the card").toBe(20);
      expect(bests.recorded.length, "no best recorded for the no throw").toBe(1);
    });

    it("when the car has not moved since the pedal, then resting is no attempt: it stays running however long it rests", () => {
      const session = new MinigameSession(fakeBests());
      session.begin("longJump", LONG_JUMP_OPTIONS);
      session.step(PEDAL);
      for (let frame = 0; frame < FRAMES_AFTER_SCORING; frame++) session.step(atRest(REST_HOLD + frame));
      expect(session.hud().phase).toBe("running");
    });

    it("when a car that drove rests for the hold after he was thrown, then it is the dummy's rest that scores, not a no throw", () => {
      const session = new MinigameSession(fakeBests());
      session.begin("longJump", LONG_JUMP_OPTIONS);
      session.step(PEDAL);
      session.step(DRIVING);
      session.step(THROW);
      session.step({ pedalPressed: false, thrown: true, torso: torsoAt(40, 0, 0, STILL_BEFORE_REST), carStill: REST_HOLD + 1 });
      expect(session.hud().phase, "the car's rest does not end a thrown attempt").toBe("thrown");
      expectScored(session.step({ pedalPressed: false, thrown: true, torso: torsoAt(40, 0, 0, REST_HOLD), carStill: REST_HOLD + 1 }), 40, "the dummy's rest scores it");
      expect(session.hud().noThrow, "a throw").toBe(false);
    });

    it("when a no throw is retried, then the same attempt is ready again with the card clear, and a run that is thrown scores as usual", () => {
      const session = new MinigameSession(fakeBests());
      session.begin("longJump", LONG_JUMP_OPTIONS);
      session.step(PEDAL);
      session.step(DRIVING);
      session.step(atRest(REST_HOLD));
      session.retry();
      const card = session.hud();
      expect(card.phase, "phase").toBe("ready");
      expect(card.noThrow, "the card is clear").toBe(false);
      expect(card.attempt, "a no throw uses no attempt").toBe(1);
      expect(throwAndRestAt(session, 33)?.scored, "the retried attempt scores").toBe(33);
    });

    it("when the run is reset after the car drove, then it is ready again and nothing was a no throw", () => {
      const session = new MinigameSession(fakeBests());
      session.begin("longJump", LONG_JUMP_OPTIONS);
      session.step(PEDAL);
      session.step(DRIVING);
      session.resetRun();
      session.step(PEDAL);
      session.step(atRest(REST_HOLD));
      expect(session.hud().phase, "the car that has not moved since the new pedal is no attempt").toBe("running");
    });
  });
});

describe("given a high jump session", () => {
  /** A thrown high jump attempt: the pedal pressed and the driver thrown. */
  function thrownSession(bests: MinigameBests = fakeBests()): MinigameSession {
    const session = new MinigameSession(bests);
    session.begin("highJump", HIGH_JUMP_OPTIONS);
    session.step(PEDAL);
    session.step(THROW);
    return session;
  }

  it("when he is begun without his posts and lip, then it fails loudly", () => {
    const session = new MinigameSession(fakeBests());
    expect(() => session.begin("highJump", LONG_JUMP_OPTIONS), "begin without the high jump's numbers").toThrow(/posts/);
  });

  it("when he climbs through the band and falls away, then the card shows the highest point in it so far, and the score is that point once he lies still", () => {
    const bests = fakeBests();
    const session = thrownSession(bests);
    expect(session.step(flying(torsoAt(POSTS_X - 20, LIP_Y + 18, 0, 0))), "rising, far before the band").toBe(null);
    expect(session.hud().liveValue, "live: nothing counts outside the band").toBe(0);
    expect(session.step(flying(torsoAt(POSTS_X - 1, LIP_Y + 30, 0, 0))), "in the band").toBe(null);
    expect(session.hud().liveValue, "live: the highest in the band so far").toBe(30);
    expect(session.step(flying(torsoAt(POSTS_X + 1, LIP_Y + 24, 0, 0))), "falling again, still in the band").toBe(null);
    expect(session.hud().liveValue, "live: still the highest, not where he is now").toBe(30);
    expect(session.step(flying(torsoAt(POSTS_X + 14, LIP_Y + 0.5, 0, STILL_BEFORE_REST))), "lying but not for the rest hold").toBe(null);
    expectScored(session.step(flying(torsoAt(POSTS_X + 14, LIP_Y + 0.5, 0, REST_HOLD))), 30, "scored at rest");
    expect(session.hud().phase, "phase").toBe("scored");
    expect(session.hud().lastScore, "last score").toBe(30);
    expectRecorded(bests.recorded, [{ mode: "highJump", throwsPerSet: null, carType: "muscle", score: 30 }], "the throw is recorded");
  });

  it("when he taps a post short of the plane and falls back out of the band, then he scores the height he had at the band, not 0", () => {
    const session = thrownSession();
    session.step(flying(torsoAt(POSTS_X - SCORE_BAND_HALF_DEPTH + 0.5, LIP_Y + 44, 0, 0)));
    session.step(flying(torsoAt(POSTS_X - 0.4, LIP_Y + 46, 0, 0)));
    session.step(flying(torsoAt(POSTS_X - 3, LIP_Y + 30, 0, 0)));
    session.step(flying(torsoAt(POSTS_X - 8, LIP_Y + 2, 0, 0)));
    expectScored(session.step(flying(torsoAt(POSTS_X - 9, LIP_Y + 0.5, 0, REST_HOLD))), 46, "scored at rest out in front, never having crossed the plane");
  });

  it("when he peaks before the band and drops, then he scores only what he had in the band", () => {
    const session = thrownSession();
    session.step(flying(torsoAt(POSTS_X - 12, LIP_Y + 60, 0, 0)));
    session.step(flying(torsoAt(POSTS_X - SCORE_BAND_HALF_DEPTH, LIP_Y + 35, 0, 0)));
    expectScored(session.step(flying(torsoAt(POSTS_X + 3, LIP_Y + 8, 0, REST_HOLD))), 35, "the 60 m he had before the band does not count");
  });

  it("when he passes the posts' plane in flight, then nothing is scored until he lies still", () => {
    const session = thrownSession();
    session.step(flying(torsoAt(POSTS_X - 4, LIP_Y + 18, 0, 0)));
    expect(session.step(flying(torsoAt(POSTS_X + 4, LIP_Y + 10, 0, 0))), "frame after the plane").toBe(null);
    expect(session.hud().phase, "still thrown").toBe("thrown");
  });

  it("when he flies wide of the posts inside the band, then the score is the same: any lateral position counts", () => {
    const session = thrownSession();
    session.step(flying(torsoAt(POSTS_X, LIP_Y + 12, FIELD_HALF_WIDTH + 5, 0)));
    expectScored(session.step(flying(torsoAt(POSTS_X + 9, LIP_Y, FIELD_HALF_WIDTH + 5, REST_HOLD))), 12, "scored wide of the field");
  });

  it("when he never comes inside the band, then the score is 0 at rest, however high he went", () => {
    const session = thrownSession();
    session.step(flying(torsoAt(POSTS_X - 15, LIP_Y + 50, 0, 0)));
    expectScored(session.step(flying(torsoAt(POSTS_X - 12, LIP_Y + 1, 0, REST_HOLD))), 0, "scored at rest short of the band");
  });

  it("when he never rises above the lip, then the score is 0, not negative", () => {
    const session = thrownSession();
    expectScored(session.step(flying(torsoAt(POSTS_X, LIP_Y - 1, 0, REST_HOLD))), 0, "scored at rest below the lip");
  });

  it("when retry follows, then the highest point starts again from nothing for the next throw", () => {
    const session = thrownSession();
    session.step(flying(torsoAt(POSTS_X, LIP_Y + 20, 0, 0)));
    session.step(flying(torsoAt(POSTS_X + 5, LIP_Y + 1, 0, REST_HOLD)));
    session.retry();
    session.step(PEDAL);
    session.step(THROW);
    session.step(flying(torsoAt(POSTS_X, LIP_Y + 6, 0, 0)));
    expect(session.hud().liveValue, "the live reading forgot the first throw's 20").toBe(6);
    expectScored(session.step(flying(torsoAt(POSTS_X + 5, LIP_Y + 1, 0, REST_HOLD))), 6, "score of the second throw");
  });
});

describe("given a Ring Fling session", () => {
  const cupCentre = (index: number) => ({ x: RING_CUPS[index]!.centreX, z: RING_CUPS[index]!.centreZ });

  it("when he comes to rest in a cup, a pocket or off the board, then the score is that zone's", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("ringFling", { carType: CAR_TYPE, throwsPerSet: 10 });
    const expectations: { at: { x: number; z: number }; score: number }[] = [
      ...RING_CUPS.map((cup) => ({ at: { x: cup.centreX, z: cup.centreZ }, score: cup.score })),
      ...RING_POCKETS.map((pocket) => ({ at: { x: pocket.centreX, z: pocket.centreZ }, score: pocket.score })),
      { at: { x: -50, z: 0 }, score: 0 },
    ];
    for (const { at, score } of expectations) {
      expect(throwAndRestAt(session, at.x, at.z)?.scored, `score at (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`).toBe(score);
      session.retry();
    }
  });

  it("when he lies over a cup short of the rest hold, then the live value is the zone under him and nothing scores", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("ringFling", { carType: CAR_TYPE });
    session.step(PEDAL);
    session.step(THROW);
    const { x, z } = cupCentre(2);
    expect(session.step(flying(torsoAt(x, 1, z, STILL_BEFORE_REST))), "frame short of the rest hold").toBe(null);
    expect(session.hud().liveValue, "live zone").toBe(RING_CUPS[2]!.score);
  });

  it("when the session is begun, then the set length is the default and the card says attempt 1 of it", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("ringFling", { carType: CAR_TYPE });
    const card = session.hud();
    expect(card.attempt, "fresh set attempt").toBe(1);
    expect(card.throwsPerSet, "fresh set length").toBe(THROWS_PER_SET.default);
    expect(card.setTotal, "fresh set total").toBe(0);
    expect(card.setComplete, "fresh set complete").toBe(false);
  });

  it("when a set of three is thrown, then attempts count 1 to 3, the total sums the scores, and only the finished set's total is recorded", () => {
    const bests = fakeBests();
    const session = new MinigameSession(bests);
    session.begin("ringFling", { carType: CAR_TYPE, throwsPerSet: SET_LENGTH });
    const SET_SCORES_AFTER_THROW = ["10", "10,40", "10,40,100"];
    const scoresInOrder = [RING_CUPS[0]!, RING_CUPS[3]!, RING_POCKETS[0]!];
    for (let throwIndex = 0; throwIndex < SET_LENGTH; throwIndex++) {
      const zone = scoresInOrder[throwIndex]!;
      throwAndRestAt(session, zone.centreX, zone.centreZ);
      const card = session.hud();
      expect(card.attempt, `attempt number after throw ${throwIndex + 1}`).toBe(throwIndex + 1);
      expect(card.setComplete, `set complete after throw ${throwIndex + 1}`).toBe(throwIndex === SET_LENGTH - 1);
      expect(card.setScores.join(","), `set scores after throw ${throwIndex + 1}`).toBe(SET_SCORES_AFTER_THROW[throwIndex]);
      if (throwIndex < SET_LENGTH - 1) {
        expect(bests.recorded, "no best recorded before the set is complete").toHaveLength(0);
        session.retry();
      }
    }
    expect(session.hud().setTotal, "set total").toBe(10 + 40 + 100);
    expectRecorded(bests.recorded, [{ mode: "ringFling", throwsPerSet: 3, carType: "muscle", score: 150 }], "set total recorded under its set length");
  });

  it("when retry follows the set's last throw, then a new set starts: attempt 1, no scores, total 0", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("ringFling", { carType: CAR_TYPE, throwsPerSet: 1 });
    throwAndRestAt(session, RING_CUPS[0]!.centreX, RING_CUPS[0]!.centreZ);
    expect(session.hud().setComplete, "the one-throw set is complete").toBe(true);
    session.retry();
    const card = session.hud();
    expect(card.phase, "new set phase").toBe("ready");
    expect(card.attempt, "new set attempt").toBe(1);
    expect(card.setScores, "new set scores").toHaveLength(0);
    expect(card.setTotal, "new set total").toBe(0);
    expect(card.setComplete, "new set complete").toBe(false);
  });

  it("when the run is reset mid-set, then the attempt number is unchanged and no score is recorded", () => {
    const bests = fakeBests();
    const session = new MinigameSession(bests);
    session.begin("ringFling", { carType: CAR_TYPE, throwsPerSet: SET_LENGTH });
    throwAndRestAt(session, RING_CUPS[0]!.centreX, RING_CUPS[0]!.centreZ);
    session.retry();
    session.step(PEDAL);
    session.resetRun();
    const card = session.hud();
    expect(firstMismatch([card.phase, card.attempt, card.setScores.length], ["ready", 2, 1]), "after the reset").toBeUndefined();
    expect(bests.recorded, "nothing recorded").toHaveLength(0);
  });

  it("when the set length is out of range, then it is clamped to the min and max, and a new length starts a new set", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("ringFling", { carType: CAR_TYPE, throwsPerSet: 4 });
    throwAndRestAt(session, RING_CUPS[0]!.centreX, RING_CUPS[0]!.centreZ);
    session.retry();
    session.setThrowsPerSet(THROWS_PER_SET.max + 7);
    let card = session.hud();
    expect(card.throwsPerSet, "above the max: clamped").toBe(THROWS_PER_SET.max);
    expect(card.attempt, "above the max: new set").toBe(1);
    expect(card.setScores.length, "above the max: no scores").toBe(0);
    expect(card.phase, "above the max: ready").toBe("ready");
    session.setThrowsPerSet(0);
    expect(session.hud().throwsPerSet, "below the min: clamped").toBe(THROWS_PER_SET.min);
    session.begin("ringFling", { carType: CAR_TYPE, throwsPerSet: -5 });
    card = session.hud();
    expect(card.throwsPerSet, "begin clamps the same way").toBe(THROWS_PER_SET.min);
  });

  it("when the set length is set to what it already is, then the set carries on", () => {
    const session = new MinigameSession(fakeBests());
    session.begin("ringFling", { carType: CAR_TYPE, throwsPerSet: 4 });
    throwAndRestAt(session, RING_CUPS[0]!.centreX, RING_CUPS[0]!.centreZ);
    session.setThrowsPerSet(4);
    expect(firstMismatch([session.hud().attempt, session.hud().setScores.length, session.hud().phase], [1, 1, "scored"]), "same length").toBeUndefined();
  });

  it("when the set length changes, then the bests shown are those of the new length", () => {
    const asked: (number | null)[] = [];
    const bests: MinigameBests = {
      bestFor: (_mode, throwsPerSet) => {
        asked.push(throwsPerSet);
        return { thisCar: null, overall: null };
      },
      record: () => false,
    };
    const session = new MinigameSession(bests);
    session.begin("ringFling", { carType: CAR_TYPE, throwsPerSet: 4 });
    session.setThrowsPerSet(6);
    expect(firstMismatch(asked, [4, 6]), "set lengths the bests were read for").toBeUndefined();
  });
});
