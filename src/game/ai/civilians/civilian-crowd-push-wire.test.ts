import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { must } from "../../kernel/must.test-util.ts";
import { packCrowd, readCrowd } from "../../net/crowd-codec.ts";
import { EVENT_TRIPLE } from "./civilian-constants.ts";
import { POPULATION, POPULATION_TIER } from "./civilian-crowd-constants.ts";
import { PACE, people, pushesIn, sendAlong, streetEdge } from "./civilian-crowd-contact.test-util.ts";
import { CROWD_SEED, FRAME_SECONDS, newCrowd } from "./civilian-crowd.test-util.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";

const map = buildFixtureMap();
const EDGE = streetEdge(map, 20);
/** The crowd message's subject is 16 bits. */
const WIRE_SUBJECT_MAX = 0xffff;
const AFTER_PASSING_SECONDS = 3;
const HOST_CLOCK = 1000;

describe("given a host crowd of the biggest tier, two civilians from the end of its list walking into each other", () => {
  const crowd = newCrowd(map, POPULATION[POPULATION_TIER.ultra]);
  const [first, second] = people(crowd, 2, true) as [number, number];
  sendAlong(crowd, first, EDGE, EDGE.from, EDGE.to);
  sendAlong(crowd, second, EDGE, EDGE.to, EDGE.from);
  for (let seconds = FRAME_SECONDS; seconds < EDGE.length / (2 * PACE) + AFTER_PASSING_SECONDS; seconds += FRAME_SECONDS) crowd.step(seconds, [], true);
  const log = crowd.eventLog().slice();
  const heard = readCrowd(packCrowd(CROWD_SEED, HOST_CLOCK, crowd.crowdSeconds, log));

  it("when the host's log goes through the crowd message, then it arrives as it was, every subject within the wire's 16 bits", () => {
    must(heard, "the crowd message the host's log was packed in");
    expect(crowd.poses.count * (Math.max(first, second) + 1), "what one subject holding victim and pusher would be").toBeGreaterThan(WIRE_SUBJECT_MAX);
    expect(firstMismatch(heard.events, log), "events after the round trip").toBeUndefined();
    let largest = 0;
    for (let at = 1; at < log.length; at += EVENT_TRIPLE) largest = Math.max(largest, log[at]!);
    expect(largest, "largest subject in the log").toBeLessThanOrEqual(WIRE_SUBJECT_MAX);
  });

  it("when the message is read, then it holds one push, with the victim and the pusher of the two civilians intact", () => {
    must(heard, "the crowd message the host's log was packed in");
    const pushes = pushesIn(heard.events).filter((push) => push.victim === first || push.victim === second);
    expect(pushes.length, "pushes between them").toBe(1);
    expect(Math.min(pushes[0]!.victim, pushes[0]!.pusher), "lower of the two").toBe(Math.min(first, second));
    expect(Math.max(pushes[0]!.victim, pushes[0]!.pusher), "higher of the two").toBe(Math.max(first, second));
  });

  it("when a client hears the message, then its log is the host's", () => {
    must(heard, "the crowd message the host's log was packed in");
    const client = newCrowd(map, POPULATION[POPULATION_TIER.ultra]);
    client.hear(heard.events);
    client.step(crowd.crowdSeconds, [], false);
    expect(firstMismatch(client.eventLog(), log), "the client's log").toBeUndefined();
  });
});
