import { describe, expect, it } from "vitest";
import { FOOT_COP_COUNT } from "./crime-constants.ts";
import { actorOfCopSubject, actorOfSubject, copOfCopSubject, PLAYER_ACTORS, playerCopSubject, playerSubject } from "../civilians/civilian-constants.ts";

/** The wire's event subject is 16 bits. */
const SUBJECT_LIMIT = 65536;
/** Residents are numbered from 0 and never reach this high. */
const MOST_RESIDENTS = 4000;
const NONE = -1;

describe("given the room's seats, each a player who can be arrested on foot", () => {
  it("when a seat's ride subject is made, then it names that seat and no resident, and a resident's subject names no seat", () => {
    for (let actor = 0; actor < PLAYER_ACTORS; actor++) {
      expect(actorOfSubject(playerSubject(actor)), `seat ${actor}`).toBe(actor);
      expect(playerSubject(actor), `seat ${actor} is no resident's number`).toBeGreaterThan(MOST_RESIDENTS);
      expect(playerSubject(actor), `seat ${actor} fits the wire`).toBeLessThan(SUBJECT_LIMIT);
    }
    expect(actorOfSubject(0), "the first resident").toBe(NONE);
    expect(actorOfSubject(MOST_RESIDENTS), "the last resident").toBe(NONE);
  });

  it("when a chase subject is made for each seat and each foot cop, then it names that seat and that cop, no two are alike, and none is a ride subject", () => {
    const seen = new Set<number>();
    for (let actor = 0; actor < PLAYER_ACTORS; actor++) {
      for (let cop = NONE; cop < FOOT_COP_COUNT; cop++) {
        const subject = playerCopSubject(actor, cop);
        seen.add(subject);
        expect(actorOfCopSubject(subject), `seat ${actor}, cop ${cop}: the seat`).toBe(actor);
        expect(copOfCopSubject(subject), `seat ${actor}, cop ${cop}: the cop`).toBe(cop);
        expect(actorOfSubject(subject), `seat ${actor}, cop ${cop}: not a ride subject`).toBe(NONE);
        expect(subject, `seat ${actor}, cop ${cop}: fits the wire`).toBeLessThan(SUBJECT_LIMIT);
        expect(subject, `seat ${actor}, cop ${cop}: no resident's number`).toBeGreaterThan(MOST_RESIDENTS);
      }
    }
    expect(seen.size, "distinct subjects").toBe(PLAYER_ACTORS * (FOOT_COP_COUNT + 1));
  });

  it("when a ride subject is read as a chase subject, then it names no seat", () => {
    expect(actorOfCopSubject(playerSubject(0)), "the host's ride subject").toBe(NONE);
    expect(actorOfCopSubject(playerSubject(PLAYER_ACTORS - 1)), "the last seat's ride subject").toBe(NONE);
  });
});
