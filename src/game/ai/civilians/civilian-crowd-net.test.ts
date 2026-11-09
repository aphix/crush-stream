import { describe, expect, it } from "vitest";
import type { DeformableCar } from "../../vehicle/car.ts";
import { packCrowd, readCrowd } from "../../net/crowd-codec.ts";
import { CROWD_EVENT_LOG_MAX } from "../../net/net-constants.ts";
import { FLAG, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { ClientCrowdClock, type CivilianCrowd } from "./civilian-crowd.ts";
import { EVENT_LOG_CAPACITY } from "./civilian-crowd-constants.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { historyLines } from "./civilian-mood.ts";
import { stateDigest } from "./civilian-run.test-util.ts";
import { carAtWalker, CROWD_SEED, FRAME_SECONDS, newCrowd, posesDigest, shownResident, stepUntilShown } from "./civilian-crowd.test-util.ts";

const map = buildFixtureMap();
const CAR_SPEED = 14;
const RUN_UP = 6;
const AFTERMATH_SECONDS = 6;
const LATE_JOINER_SECONDS = 100;

/** A host crowd and a client crowd of one seed on one clock counted in frames (zero latency, no render delay): each frame the host steps and sends its crowd message through the wire's codec, the client hears it and steps by its clock. */
class CrowdPair {
  readonly host = newCrowd(map);
  readonly client = newCrowd(map);
  readonly hostStrikes: number[] = [];
  readonly clientStrikes: number[] = [];
  private readonly clock = new ClientCrowdClock();
  private frame = 0;
  seconds = 0;

  advance(cars: readonly DeformableCar[]): void {
    this.seconds = ++this.frame * FRAME_SECONDS;
    this.host.step(this.seconds, cars, true);
    const heard = readCrowd(packCrowd(CROWD_SEED, this.seconds, this.host.crowdSeconds, this.host.eventLog()))!;
    this.clock.hear(heard.hostTime, heard.crowdTime, this.seconds);
    this.client.hear(heard.events);
    this.client.step(this.clock.crowdSeconds(this.seconds, 0), cars, false);
    for (const strike of this.host.takeStrikes()) this.hostStrikes.push(strike.guard);
    for (const strike of this.client.takeStrikes()) this.clientStrikes.push(strike.guard);
  }

  /** Frames until the host shows a person; returns how many frames the two crowds showed different poses. */
  runUntilShown(): number {
    let apart = 0;
    while (shownResident(this.host) < 0) {
      this.advance([]);
      if (posesDigest(this.host.poses) !== posesDigest(this.client.poses)) apart++;
    }
    return apart;
  }
}

/** The pair with a car run at a civilian until the knock is in both logs and `AFTERMATH_SECONDS` have passed; frames the poses differed in. */
function runDownOnHost(pair: CrowdPair): { resident: number; apart: number } {
  pair.runUntilShown();
  const resident = shownResident(pair.host);
  const { car, place } = carAtWalker(pair.host, resident, RUN_UP, CAR_SPEED);
  let apart = 0;
  for (let travelled = FRAME_SECONDS; travelled < AFTERMATH_SECONDS; travelled += FRAME_SECONDS) {
    place(Math.min(travelled, 1));
    pair.advance([car]);
    if (posesDigest(pair.host.poses) !== posesDigest(pair.client.poses)) apart++;
  }
  return { resident, apart };
}

describe("given a host crowd and a client crowd of its seed that hears the host's crowd message", () => {
  it("when the host walks its civilians, then the client's poses are the host's at the same crowd time, frame for frame", () => {
    const pair = new CrowdPair();
    expect(pair.runUntilShown(), "frames apart before anyone is out").toBe(0);
    let apart = 0;
    for (let frame = 0; frame < 4 / FRAME_SECONDS; frame++) {
      pair.advance([]);
      if (posesDigest(pair.host.poses) !== posesDigest(pair.client.poses)) apart++;
    }
    expect(shownResident(pair.client), "the client shows someone").toBeGreaterThanOrEqual(0);
    expect(apart, "frames the poses differed").toBe(0);
  });

  it("when a car on the host runs a civilian down, then the client hides them the same frame, throws them from its own car, and the knock reaches its society", () => {
    const pair = new CrowdPair();
    const { resident, apart } = runDownOnHost(pair);
    expect(pair.hostStrikes, "the host's strikes").toEqual([resident]);
    expect(pair.clientStrikes, "the client's strikes").toEqual([resident]);
    expect(apart, "frames the poses differed").toBe(0);
    expect(pair.client.poses.shown[resident], "shown on the client").toBe(0);
    expect(Array.from(pair.client.eventLog()), "the client's log").toEqual(Array.from(pair.host.eventLog()));
    expect(pair.client.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! & FLAG.hurt, "hurt flag").toBe(FLAG.hurt);
    expect(historyLines(pair.client.state, resident)[0], "their log line").toContain("knocked down");
  });

  it("when a client joins after the knock, then replaying the host's log gives it the host's civilians, the hurt one among them", () => {
    const pair = new CrowdPair();
    const { resident } = runDownOnHost(pair);
    for (let frame = 0; frame < LATE_JOINER_SECONDS / FRAME_SECONDS; frame++) pair.advance([]);
    const late = newCrowd(map);
    late.hear(pair.host.eventLog().slice());
    late.step(pair.seconds, [], false);
    expect(posesDigest(late.poses), "poses").toBe(posesDigest(pair.host.poses));
    expect(stateDigest(late.state), "the society's rows").toBe(stateDigest(pair.host.state));
    expect(late.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! & FLAG.hurt, "hurt flag").toBe(FLAG.hurt);
  });
});

describe("given a crowd that hears the same log again with each message", () => {
  it("when the host's log grows by one event, then only that event is new, and an empty or repeated log changes nothing", () => {
    const client: CivilianCrowd = newCrowd(map);
    client.step(1, [], false);
    const log = Float64Array.of(0, 5, 1.5);
    client.hear(log);
    client.hear(log);
    client.hear(new Float64Array(0));
    expect(Array.from(client.eventLog()), "after the same log twice and an empty one").toEqual([0, 5, 1.5]);
    client.hear(Float64Array.of(0, 5, 1.5, 1, 3, 2));
    expect(Array.from(client.eventLog()), "after one more event").toEqual([0, 5, 1.5, 1, 3, 2]);
  });

  it("when the in-memory log is full, then it keeps the newest the wire's size and no more", () => {
    expect(EVENT_LOG_CAPACITY, "the crowd's log against the wire's cap").toBe(CROWD_EVENT_LOG_MAX);
    const events = Float64Array.from({ length: (EVENT_LOG_CAPACITY + 3) * 3 }, (_, at) => (at % 3 === 0 ? 1 : at % 3 === 1 ? 2 : Math.floor(at / 3) * 0.001));
    const client = newCrowd(map);
    client.hear(events);
    expect(client.eventLog().length, "numbers kept").toBe(EVENT_LOG_CAPACITY * 3);
    expect(client.eventLog()[2], "the oldest kept is the fourth heard").toBeCloseTo(0.003, 9);
  });
});
