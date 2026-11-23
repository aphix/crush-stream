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

/** How far (m) from where the second player stood the law may set him down on this map: his cop leads him a few metres. */
const SET_DOWN_WITHIN_M = 30;

describe("given the host's arrest of the second player of a room has run to his release", () => {
  it("when the host sets him down, then it puts the second player's car near where he was set down", () => {
    const host = hostArrestOfSecond();
    runUntil(host, STAGE_LIMIT_SECONDS, () => host.placed.length > 0);
    expect(host.footDelivered, "control: the arrest ran to its end").toHaveLength(0);
    expect(host.placed, "cars the host placed").toHaveLength(1);
    expect(host.placed[0]?.actor, "whose car").toBe(SECOND);
    expect(Math.abs(host.placed[0]!.x - SECOND_AT), "near where he was arrested").toBeLessThan(SET_DOWN_WITHIN_M);
  });

  it("when the host's own player is the one set down, then its engine places his car and the law places none", () => {
    const host = harness([COP_AT, 0, 0], { self: SECOND });
    host.scene.setFoot(true, SECOND_AT, 0, 1, 0, 0, SECOND);
    runFor(host, LAW_SETTLES_SECONDS);
    host.scene.playerShoved(host.now, SECOND);
    runUntil(host, STAGE_LIMIT_SECONDS, () => host.footDelivered.length > 0);
    expect(host.footDelivered, "his own engine set him down").toHaveLength(1);
    expect(host.placed, "the law placed no car").toHaveLength(0);
  });

  it("when a guest's law sets him down, then it places no car: the host does", () => {
    const host = hostArrestOfSecond();
    const peer = peerAtHostsSecond(host, SECOND);
    runUntil(peer, STAGE_LIMIT_SECONDS, () => peer.footDelivered.length > 0);
    expect(peer.footDelivered, "control: his machine set him down").toHaveLength(1);
    expect(peer.placed, "cars a guest placed").toHaveLength(0);
  });
});

describe("given a player on foot whose shove or fight is told to a law that is not the host's", () => {
  it("when a peer's law is told of a shove or a fight, then it opens no chase; the host's law does for each", () => {
    const peer = twoPlayersOnFoot({ authority: false });
    peer.scene.playerShoved(peer.now, SECOND);
    peer.scene.playerFought(peer.now, SECOND);
    expect(peer.scene.footChaseOf(strip(), SECOND), "a peer's chase of him").toBe(false);
    const host = twoPlayersOnFoot();
    host.scene.playerFought(host.now, SECOND);
    expect(host.scene.footChaseOf(strip(), SECOND), "the host's chase after a fight").toBe(true);
    const shover = twoPlayersOnFoot();
    shover.scene.playerShoved(shover.now, SECOND);
    expect(shover.scene.footChaseOf(strip(), SECOND), "the host's chase after a shove").toBe(true);
  });
});

describe("given the host's word of a chase with no cop named yet", () => {
  it("when a peer's law hears it, then it opens the chase with no cop of its own picking and calls one as the host does", () => {
    const peer = twoPlayersOnFoot({ authority: false });
    peer.scene.hearFootChase(SECOND, -1, peer.scene.foot.seconds);
    runFor(peer, LAW_SETTLES_SECONDS);
    const slot = slotOfSecond(peer);
    expect(slot, "the chase is open").toBeGreaterThanOrEqual(0);
    expect(peer.scene.foot.table.copAt(Math.floor(slot / 2), 0), "no cop picked in the hearing").toBe(-1);
    runFor(peer, 1);
    expect(peer.scene.foot.table.copAt(Math.floor(slot / 2), 0), "a cop called by the next poll").toBeGreaterThanOrEqual(0);
  });
});
