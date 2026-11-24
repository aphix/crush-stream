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

describe("given a guest on foot whose positions move 7 m/s along the host's clock", () => {
  it("when he reports a velocity of 0, then the host's seen speed of him is still 7 m/s; before his second record it is 0", () => {
    const players = new OpenWorldPlayers(CAPACITY);
    heard(players, 1, 0);
    expect(players.seenSpeedOf(GUEST), "after one record (m/s)").toBe(0);
    heard(players, 2, 0);
    heard(players, 3, 0);
    expect(players.seenSpeedOf(GUEST), "his seen speed (m/s)").toBeCloseTo(7, 3);
  });

  it("when his records jump 100 m between two messages, then the host's seen speed is capped at twice a sprint", () => {
    const players = new OpenWorldPlayers(CAPACITY);
    heard(players, 1, 0);
    const jump = makeFootRecord();
    jump.seq = 2;
    jump.x = 100;
    jump.crowdTime = 2 * STEP_S;
    players.hearFoot(GUEST, jump, 2 * STEP_S);
    expect(players.seenSpeedOf(GUEST), "his seen speed (m/s)").toBeCloseTo(14, 3);
  });
});
