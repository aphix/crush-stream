import { launch, pooledCar } from "../../contact/crash-scenarios.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { describe, expect, it } from "vitest";
import type { DeformableCar } from "../../vehicle/car.ts";
import { EVENT_KIND, EVENT_TRIPLE } from "./civilian-constants.ts";
import { AMBULANCE_DELAY_SECONDS, CRASH_LOCKOUT_SECONDS, DANGER_CONFIRM_SECONDS, DANGER_LOCKOUT_SECONDS, WRECK_SPEED } from "./civilian-crowd-constants.ts";
import { carAtWalker, FRAME_SECONDS, newCrowd, shownResident, stepUntilShown } from "./civilian-crowd.test-util.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";

const map = buildFixtureMap();
const FAST = 14;
const SLOW = 5;
const BEHIND = 12;
/** A car passes 4 m to one side of the civilian: well clear of them, and still heading within a quarter turn of where they stand. */
const BESIDE = 4;
const FAR_BESIDE = 12;
const WATCH_SECONDS = 2;
const CAR_RUN_UP = 6;

type Triple = { kind: number; subject: number; seconds: number };

function triplesOf(crowd: CivilianCrowd, kind: number): Triple[] {
  const log = crowd.eventLog();
  const found: Triple[] = [];
  for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) if (log[at] === kind) found.push({ kind, subject: log[at + 1]!, seconds: log[at + 2]! });
  return found;
}

function nearestNodeTo(x: number, z: number): number {
  const { nodeX, nodeZ } = map.graph;
  let best = -1;
  let bestDistance = Infinity;
  for (let node = 0; node < nodeX.length; node++) {
    const distance = hypot2(nodeX[node]! - x, nodeZ[node]! - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

/** A car `behind` m back along the way `resident` walks and `beside` m to one side, driving the same way at `mps` m/s: `place` puts it where it is `seconds` on. */
function passingCar(crowd: CivilianCrowd, resident: number, behind: number, beside: number, mps: number, slot: number): { car: DeformableCar; place: (seconds: number) => void } {
  const { x, z, yaw } = crowd.poses;
  const dirX = Math.sin(yaw[resident]!);
  const dirZ = Math.cos(yaw[resident]!);
  const car = pooledCar(slot);
  const startX = x[resident]! - dirX * behind + dirZ * beside;
  const startZ = z[resident]! - dirZ * behind - dirX * beside;
  launch(car, startX, startZ, yaw[resident]!, dirX * mps, dirZ * mps);
  return { car, place: (seconds) => car.group.position.set(startX + dirX * mps * seconds, car.group.position.y, startZ + dirZ * mps * seconds) };
}

/** A crowd with a civilian out, a car passing them at `mps` (`beside` m to the side, `behind` m back at first) for `WATCH_SECONDS`: the crowd, the civilian, and the time and place of the civilian when each new danger event came. */
function watchPass(authority: boolean, mps: number, beside: number, behind = BEHIND): { crowd: CivilianCrowd; resident: number; start: number; seen: { seconds: number; node: number }[] } {
  const crowd = newCrowd(map);
  let seconds = stepUntilShown(crowd);
  const resident = shownResident(crowd);
  const { car, place } = passingCar(crowd, resident, behind, beside, mps, 0);
  const seen: { seconds: number; node: number }[] = [];
  const first = seconds;
  while (seconds - first < WATCH_SECONDS) {
    place(seconds - first + FRAME_SECONDS);
    seconds += FRAME_SECONDS;
    const before = triplesOf(crowd, EVENT_KIND.danger).length;
    crowd.step(seconds, [car], authority);
    if (triplesOf(crowd, EVENT_KIND.danger).length > before) seen.push({ seconds, node: nearestNodeTo(crowd.poses.x[resident]!, crowd.poses.z[resident]!) });
  }
  return { crowd, resident, start: first, seen };
}

describe("given a host crowd and a car passing a civilian at fourteen metres a second, four metres to the side", () => {
  const { crowd, resident, start, seen } = watchPass(true, FAST, BESIDE);

  it("when the car has gone by without hitting them, then one danger event is in the log, for the street node nearest them, no sooner than the confirming time after the car was first seen", () => {
    const events = triplesOf(crowd, EVENT_KIND.danger);
    expect(events.length, "danger events in the log").toBe(1);
    expect(seen.length, "frames a danger event came in").toBe(1);
    expect(events[0]!.subject, "node of the danger").toBe(seen[0]!.node);
    expect(events[0]!.seconds, "crowd second of the danger").toBe(seen[0]!.seconds);
    expect(crowd.poses.shown[resident], "the civilian is still out").toBe(1);
    expect(triplesOf(crowd, EVENT_KIND.knock).length, "knocks").toBe(0);
    expect(events[0]!.seconds - start, "seconds from the first frame to the event").toBeGreaterThanOrEqual(DANGER_CONFIRM_SECONDS);
  });
});

describe("given a car that is slow, or heads elsewhere, or a client's crowd that sees the fast one pass", () => {
  it("when the car is at five metres a second, then nothing is logged", () => {
    expect(triplesOf(watchPass(true, SLOW, BESIDE).crowd, EVENT_KIND.danger).length, "danger events").toBe(0);
  });

  it("when the car is twelve metres to the side, heading nowhere near them, then nothing is logged", () => {
    expect(triplesOf(watchPass(true, FAST, FAR_BESIDE).crowd, EVENT_KIND.danger).length, "danger events").toBe(0);
  });

  it("when the crowd is a client's, then nothing is logged", () => {
    expect(triplesOf(watchPass(false, FAST, BESIDE).crowd, EVENT_KIND.danger).length, "danger events").toBe(0);
  });

  it(`when a second car comes at them within ${DANGER_LOCKOUT_SECONDS} s of the first danger, then it is not logged again`, () => {
    const { crowd, resident } = watchPass(true, FAST, BESIDE);
    const again = passingCar(crowd, resident, BEHIND, BESIDE, FAST, 1);
    let seconds = crowd.crowdSeconds;
    const start = seconds;
    while (seconds - start < WATCH_SECONDS) {
      again.place(seconds - start + FRAME_SECONDS);
      seconds += FRAME_SECONDS;
      crowd.step(seconds, [again.car], true);
    }
    expect(triplesOf(crowd, EVENT_KIND.danger).length, "danger events after a second car").toBe(1);
  });
});

describe("given a car driving straight at a civilian, who is run down", () => {
  it("when it hits them within the confirming time, then the log holds the knock and no danger, and an ambulance call a few seconds on, for them, at where they lay", () => {
    const crowd = newCrowd(map);
    const calls: { x: number; z: number; seconds: number }[] = [];
    crowd.onAmbulanceCall = (x, z, seconds) => calls.push({ x, z, seconds });
    let seconds = stepUntilShown(crowd);
    const resident = shownResident(crowd);
    const { car, place } = carAtWalker(crowd, resident, CAR_RUN_UP, FAST);
    let travelled = 0;
    while (crowd.takeStrikes().length === 0 && travelled < WATCH_SECONDS) {
      travelled += FRAME_SECONDS;
      place(travelled);
      seconds += FRAME_SECONDS;
      crowd.step(seconds, [car], true);
      if (triplesOf(crowd, EVENT_KIND.knock).length > 0) break;
    }
    const hitSeconds = seconds;
    const [spotX, spotZ] = [crowd.poses.x[resident]!, crowd.poses.z[resident]!];
    expect(triplesOf(crowd, EVENT_KIND.knock).length, "knocks in the log").toBe(1);
    expect(triplesOf(crowd, EVENT_KIND.danger).length, "danger events in the log").toBe(0);
    crowd.step(hitSeconds + AMBULANCE_DELAY_SECONDS - FRAME_SECONDS, [], true);
    expect([triplesOf(crowd, EVENT_KIND.ambulance).length, calls.length].join("/"), "calls in the log and made a frame before the delay is up").toBe("0/0");
    crowd.step(hitSeconds + AMBULANCE_DELAY_SECONDS, [], true);
    const logged = triplesOf(crowd, EVENT_KIND.ambulance);
    expect(logged.length, "calls in the log once it is up").toBe(1);
    expect([logged[0]!.subject, logged[0]!.seconds].join("/"), "who the call is for, and when it was made").toBe([resident, hitSeconds + AMBULANCE_DELAY_SECONDS].join("/"));
    expect(calls.length, "calls made to whoever sends the ambulance").toBe(1);
    expect([calls[0]!.x, calls[0]!.z, calls[0]!.seconds].join("/"), "where they lay and when it was made").toBe([spotX, spotZ, hitSeconds + AMBULANCE_DELAY_SECONDS].join("/"));
    crowd.step(hitSeconds + 3 * AMBULANCE_DELAY_SECONDS, [], true);
    expect(triplesOf(crowd, EVENT_KIND.ambulance).length, "calls in the log long after").toBe(1);
  });
});

describe("given a host crowd and a car meeting a solid at a street corner", () => {
  const corner = 0;
  const x = map.graph.nodeX[corner]!;
  const z = map.graph.nodeZ[corner]!;

  function hostCrowd(): CivilianCrowd {
    const crowd = newCrowd(map);
    crowd.step(1, [], true);
    return crowd;
  }

  it("when it is at the wreck speed and no building's, then a danger is logged for the corner, once in the crash lockout", () => {
    const crowd = hostCrowd();
    crowd.noteWallHit(WRECK_SPEED, x, z);
    const first = triplesOf(crowd, EVENT_KIND.danger);
    expect([first.length, first[0]!.subject, first[0]!.seconds].join("/"), "danger events, their node and time").toBe([1, corner, 1].join("/"));
    crowd.step(1 + CRASH_LOCKOUT_SECONDS - 1, [], true);
    crowd.noteWallHit(WRECK_SPEED, x, z);
    expect(triplesOf(crowd, EVENT_KIND.danger).length, "danger events inside the lockout").toBe(1);
    crowd.step(1 + CRASH_LOCKOUT_SECONDS + 1, [], true);
    crowd.noteWallHit(WRECK_SPEED, x, z);
    expect(triplesOf(crowd, EVENT_KIND.danger).length, "danger events after it").toBe(2);
  });

  it("when it is slower than the wreck speed, or the crowd is a client's, then nothing is logged", () => {
    const crowd = hostCrowd();
    crowd.noteWallHit(WRECK_SPEED - 0.5, x, z);
    expect(crowd.eventLog().length, "host log after a slow hit").toBe(0);
    const client = newCrowd(map);
    client.step(1, [], false);
    client.noteWallHit(WRECK_SPEED + 5, x, z);
    expect(client.eventLog().length, "client log").toBe(0);
  });
});
