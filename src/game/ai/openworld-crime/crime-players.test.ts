import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { playerSubject } from "../civilians/civilian-constants.ts";
import { SUBJECT_MODE } from "./case-table.ts";
import { footX, harness, runFor, runUntil, type Harness, type HarnessOptions } from "./crime-fixture.test-util.ts";

const FIRST = 0;
const SECOND = 1;
const THIRD_MACHINE = 2;
/** Where each player stands on the line city (m), and the cop who sees the second one from there; the other two cops stand at x = 0, five metres from the first. */
const FIRST_AT = 5;
const SECOND_AT = 50;
const COP_AT = 40;
/** The longest the chase and the arrest take in these rows (s). */
const STAGE_LIMIT_SECONDS = 90;
/** A grid step's worth of crowd seconds, for rows that read the first step after something happens. */
const LAW_SETTLES_SECONDS = 0.2;

const strip = () => ({ cops: 0, hold: 0, left: 0 });

/** A law on the line city with both players standing on foot, past its first step so it knows whether it is the host's. */
function twoPlayersOnFoot(options: HarnessOptions = {}): Harness {
  const run = harness([COP_AT, 0, 0], options);
  run.scene.setFoot(true, FIRST_AT, 0, 1, 0, 0, FIRST);
  run.scene.setFoot(true, SECOND_AT, 0, 1, 0, 0, SECOND);
  runFor(run, LAW_SETTLES_SECONDS);
  return run;
}

/** The host's law once the second player has shoved a civilian where the cop sees him and the cop has held him the whole hold. */
function hostArrestOfSecond(): Harness {
  const host = twoPlayersOnFoot();
  host.scene.playerShoved(host.now, SECOND);
  runUntil(host, STAGE_LIMIT_SECONDS, () => host.arrested.length > 0);
  runFor(host, 1);
  return host;
}

/** A peer's law (a guest of the room, whose own player is `self`) given the host's words about the players, not yet run. */
function peerGivenHostsWord(host: Harness, self: number, options: HarnessOptions = {}): Harness {
  const peer = harness([COP_AT, 0, 0], { authority: false, self, ...options });
  peer.scene.setFoot(true, FIRST_AT, 0, 1, 0, 0, FIRST);
  peer.scene.setFoot(true, SECOND_AT, 0, 1, 0, 0, SECOND);
  for (const told of host.chased) peer.scene.hearFootChase(told.actor, told.cop, told.seconds);
  for (const told of host.arrested) peer.scene.hearFootArrest(told.actor, told.cop, told.seconds);
  return peer;
}

/** The peer run to the crowd second the host has reached. */
function peerAtHostsSecond(host: Harness, self: number): Harness {
  const peer = peerGivenHostsWord(host, self);
  runUntil(peer, STAGE_LIMIT_SECONDS, () => peer.scene.foot.seconds >= host.scene.foot.seconds);
  return peer;
}

function slotOfSecond(run: Harness): number {
  return run.scene.foot.table.slotOfSubject(playerSubject(SECOND));
}

describe("given two players on foot and a foot cop who sees the second one shove a civilian", () => {
  it("when he shoves, then the cops are after him and not after the first player", () => {
    const run = twoPlayersOnFoot();
    run.scene.playerShoved(run.now, SECOND);
    expect(run.scene.footChaseOf(strip(), SECOND), "a chase of the second").toBe(true);
    expect(run.scene.footChaseOf(strip(), FIRST), "a chase of the first").toBe(false);
  });

  it("when he shoves, then the host tells of a chase of him, with the cop who sees him first", () => {
    const run = twoPlayersOnFoot();
    run.scene.playerShoved(run.now, SECOND);
    expect(run.chased, "chases told").toHaveLength(1);
    expect(run.chased[0]?.actor, "whose").toBe(SECOND);
    expect(run.chased[0]?.cop, "the cop at x = 40").toBe(0);
  });

  it("when two seconds have passed, then the cop has closed on the second player", () => {
    const run = twoPlayersOnFoot();
    run.scene.playerShoved(run.now, SECOND);
    const before = Math.abs(footX(run, 0) - SECOND_AT);
    runFor(run, 2);
    expect(before - Math.abs(footX(run, 0) - SECOND_AT), "metres the cop closed on him").toBeGreaterThan(5);
  });

  it("when the cop has held him the whole hold, then the host's arrest names the second player once", () => {
    const host = hostArrestOfSecond();
    expect(host.arrested, "arrests told").toHaveLength(1);
    expect(host.arrested[0]?.actor, "whose").toBe(SECOND);
    expect(host.scene.footChaseOf(strip(), FIRST), "the first player was never chased").toBe(false);
  });
});

describe("given both players on foot shove a civilian where a cop sees each", () => {
  it("when both shove, then each is chased by a cop of his own and the host tells of both", () => {
    const run = twoPlayersOnFoot();
    run.scene.playerShoved(run.now, FIRST);
    run.scene.playerShoved(run.now, SECOND);
    expect(firstMismatch(run.chased.map((told) => told.actor), [FIRST, SECOND]), "the players told of, in order").toBeUndefined();
    const [first, second] = run.chased;
    expect(first?.cop, "the first's cop is on the street").toBeGreaterThanOrEqual(0);
    expect(second?.cop, "the second's cop is on the street").toBeGreaterThanOrEqual(0);
    expect(first?.cop, "two chases, two different cops").not.toBe(second?.cop);
  });
});

describe("given a peer's law that applies the host's word of the second player's chase and arrest", () => {
  it("when it reaches the second the host's arrest was told at, then it holds the same arrest of the same player", () => {
    const host = hostArrestOfSecond();
    const peer = peerAtHostsSecond(host, THIRD_MACHINE);
    const hostSlot = slotOfSecond(host);
    const peerSlot = slotOfSecond(peer);
    expect(hostSlot, "the host holds his arrest").toBeGreaterThanOrEqual(0);
    expect(peerSlot, "the peer holds his arrest").toBeGreaterThanOrEqual(0);
    expect(peer.scene.foot.table.mode[peerSlot], "led away").toBe(host.scene.foot.table.mode[hostSlot]);
    expect(peer.scene.foot.table.holder[peerSlot], "by the same cop").toBe(host.scene.foot.table.holder[hostSlot]);
    expect(peer.scene.foot.table.actorOfSlot(peerSlot), "of the second player").toBe(SECOND);
    expect(peer.scene.foot.table.slotOfSubject(playerSubject(FIRST)), "and nobody else's").toBe(-1);
  });

  it("when it hears the arrest with no word of the chase, then he is led away all the same", () => {
    const host = hostArrestOfSecond();
    const peer = harness([COP_AT, 0, 0], { authority: false, self: THIRD_MACHINE });
    peer.scene.setFoot(true, SECOND_AT, 0, 1, 0, 0, SECOND);
    for (const told of host.arrested) peer.scene.hearFootArrest(told.actor, told.cop, told.seconds);
    runUntil(peer, STAGE_LIMIT_SECONDS, () => peer.scene.foot.seconds >= host.scene.foot.seconds);
    expect(peer.scene.foot.table.mode[slotOfSecond(peer)], "led away").toBe(SUBJECT_MODE.escorted);
  });

  it("when the arrest it hears is older than a chase lasts, then nobody is arrested, and a recent one is", () => {
    const peer = harness([COP_AT, 0, 0], { authority: false, self: THIRD_MACHINE });
    peer.scene.setFoot(true, SECOND_AT, 0, 1, 0, 0, SECOND);
    runFor(peer, 100);
    peer.scene.hearFootArrest(SECOND, 0, 1);
    runFor(peer, LAW_SETTLES_SECONDS);
    expect(slotOfSecond(peer), "an old arrest is history").toBe(-1);
    peer.scene.hearFootArrest(SECOND, 0, peer.scene.foot.seconds);
    runFor(peer, LAW_SETTLES_SECONDS);
    expect(slotOfSecond(peer), "a recent one is not").toBeGreaterThanOrEqual(0);
  });
});

const machines = [
  { it: "when the host arrests the second player, then the host's own machine is told nothing of it", machine: "host", self: FIRST, expectedBusts: 0, expectedLed: false },
  { it: "when the host arrests the second player, then the machine of a player the cops are not after is told nothing of it", machine: "guest", self: THIRD_MACHINE, expectedBusts: 0, expectedLed: false },
  { it: "when the host arrests the second player, then his own machine is told he is busted and where his cop leads him", machine: "guest", self: SECOND, expectedBusts: 1, expectedLed: true },
] as const;

for (const testCase of machines) {
  describe("given the host's arrest of the second player of a room", () => {
    it(testCase.it, () => {
      const host = hostArrestOfSecond();
      const run = testCase.machine === "host" ? host : peerAtHostsSecond(host, testCase.self);
      expect(run.footBusts, "told of the arrest").toHaveLength(testCase.expectedBusts);
      expect(run.footLed.length > 0, "told where his cop leads him").toBe(testCase.expectedLed);
    });
  });
}

describe("given the second player's own machine, a guest's, applying the host's word to the end of his arrest", () => {
  it("when his cop has led him as far as the law takes him, then he is set down once and the cops are done with him", () => {
    const host = hostArrestOfSecond();
    const peer = peerAtHostsSecond(host, SECOND);
    runUntil(peer, STAGE_LIMIT_SECONDS, () => peer.footDelivered.length > 0);
    runFor(peer, LAW_SETTLES_SECONDS);
    expect(peer.footDelivered, "set down on his own machine").toHaveLength(1);
    expect(slotOfSecond(peer), "the case is closed").toBe(-1);
  });
});
