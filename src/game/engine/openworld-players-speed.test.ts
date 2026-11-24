import { describe, expect, it } from "vitest";
import { BODY_POSTURE, makeFootRecord } from "../net/body-codec.ts";
import { OpenWorldPlayers } from "./openworld-players.ts";

const GUEST = 1;
const CAPACITY = 8;
/** The wall seconds between two of a guest's foot messages (a 15 Hz message), and the metres he sprints between them (7 m/s). */
const STEP_S = 1 / 15;
const SPRINT_STEP_M = 7 * STEP_S;

/** Guest `GUEST`'s foot record `n` heard at wall second `n` steps: he runs along +x, and reports `reportedVx` as his velocity. */
function heard(players: OpenWorldPlayers, n: number, reportedVx: number): void {
  const foot = makeFootRecord();
  foot.seq = n;
  foot.x = SPRINT_STEP_M * n;
  foot.vx = reportedVx;
  foot.crowdTime = n * STEP_S;
  foot.posture = BODY_POSTURE.stand;
  players.hearFoot(GUEST, foot, n * STEP_S);
}

/** Records heard before a speed is seen: the host measures over a quarter second, four 15 Hz steps and one more. */
const RECORDS_FOR_A_SPEED = 6;

describe("given a guest on foot whose positions move 7 m/s along the host's clock", () => {
  it("when he reports a velocity of 0, then the host's seen speed of him is still 7 m/s once a quarter second of his records is heard; after his first record it is 0", () => {
    const players = new OpenWorldPlayers(CAPACITY);
    heard(players, 1, 0);
    expect(players.seenSpeedOf(GUEST), "after one record (m/s)").toBe(0);
    for (let n = 2; n <= RECORDS_FOR_A_SPEED; n++) heard(players, n, 0);
    expect(players.seenSpeedOf(GUEST), "his seen speed (m/s)").toBeCloseTo(7, 3);
  });

  it("when every record of his is sent twice, the copy a millisecond later with a new number and the same place, then his seen speed is still 7 m/s", () => {
    const players = new OpenWorldPlayers(CAPACITY);
    for (let n = 1; n <= 2 * RECORDS_FOR_A_SPEED; n++) {
      const foot = makeFootRecord();
      foot.seq = 2 * n;
      foot.x = SPRINT_STEP_M * n;
      foot.posture = BODY_POSTURE.stand;
      players.hearFoot(GUEST, foot, n * STEP_S);
      foot.seq = 2 * n + 1;
      players.hearFoot(GUEST, foot, n * STEP_S + 0.001);
    }
    expect(players.seenSpeedOf(GUEST), "his seen speed (m/s)").toBeCloseTo(7, 1);
  });

  it("when his records jump 100 m in a third of a second, then the host's seen speed is capped at twice a sprint", () => {
    const players = new OpenWorldPlayers(CAPACITY);
    heard(players, 1, 0);
    const jump = makeFootRecord();
    jump.seq = 2;
    jump.x = 100;
    jump.crowdTime = 6 * STEP_S;
    players.hearFoot(GUEST, jump, 6 * STEP_S);
    expect(players.seenSpeedOf(GUEST), "his seen speed (m/s)").toBeCloseTo(14, 3);
  });
});
