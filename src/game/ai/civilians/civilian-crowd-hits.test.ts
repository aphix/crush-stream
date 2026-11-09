import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { describe, expect, it } from "vitest";
import { tickAt } from "./civilian-clock.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { EVENT_KIND, FLAG, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { WRECK_LOCKOUT_SECONDS, WRECK_SPEED } from "./civilian-crowd-constants.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { historyLines } from "./civilian-mood.ts";
import { carAtWalker, FRAME_SECONDS, newCrowd, shownResident, stepUntilShown } from "./civilian-crowd.test-util.ts";

const map = buildFixtureMap();
const CAR_SPEED = 14;
/** Metres behind the walker the car starts: it closes in well under a second. */
const RUN_UP = 6;
const CHASE_SECONDS = 2;
/** After the knock the society needs its plan lead and the knock's own tick: this long is plenty. */
const AFTERMATH_SECONDS = 6;

/** A crowd with a civilian out and a car driving at them; the crowd stepped until the car meets them or `CHASE_SECONDS` pass. */
function chase(driving: boolean, authority: boolean) {
  const crowd = newCrowd(map);
  let seconds = stepUntilShown(crowd);
  const resident = shownResident(crowd);
  const { car, place } = carAtWalker(crowd, resident, driving ? RUN_UP : 400, CAR_SPEED);
  const struck = [];
  for (let travelled = FRAME_SECONDS; travelled < CHASE_SECONDS && struck.length === 0; travelled += FRAME_SECONDS) {
    place(travelled);
    seconds += FRAME_SECONDS;
    crowd.step(seconds, [car], authority);
    struck.push(...crowd.takeStrikes());
  }
  return { crowd, resident, seconds, struck };
}

describe("given a host crowd, a civilian walking out and a car driving at them", () => {
  it("when the car reaches them, then one strike is queued for the ragdoll at their feet, they are hidden at once and stay hidden, and the knock is in the host's log", () => {
    const { crowd, resident, seconds, struck } = chase(true, true);
    expect(struck.length, "strikes").toBe(1);
    expect(struck[0]!.guard, "the civilian struck").toBe(resident);
    expect(struck[0]!.car, "the car that struck").toBe(0);
    expect(crowd.poses.shown[resident], "shown the step they were run down").toBe(0);
    expect(firstMismatch(Array.from(crowd.eventLog()), [EVENT_KIND.knock, resident, seconds]), "the host's log").toBeUndefined();
    for (let later = 1; later <= AFTERMATH_SECONDS / FRAME_SECONDS; later++) crowd.step(seconds + later * FRAME_SECONDS, [], true);
    expect(crowd.poses.shown[resident], "shown later").toBe(0);
  });

  it("when the knock has been planned, then the society has them hurt with the knock in their life log", () => {
    const { crowd, resident, seconds } = chase(true, true);
    crowd.step(seconds + AFTERMATH_SECONDS, [], true);
    expect(crowd.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! & FLAG.hurt, "hurt flag").toBe(FLAG.hurt);
    expect(historyLines(crowd.state, resident)[0], "latest line of their log").toContain("knocked down");
  });

  it("when the car is far away, then nobody is run down and the log stays empty", () => {
    const { crowd, resident, struck } = chase(false, true);
    expect(struck.length, "strikes").toBe(0);
    expect(crowd.poses.shown[resident], "still out").toBe(1);
    expect(crowd.eventLog().length, "log").toBe(0);
  });

  it("when a client's crowd (no authority) has the same car meet the civilian, then it detects nothing", () => {
    const { crowd, resident, struck } = chase(true, false);
    expect(struck.length, "strikes").toBe(0);
    expect(crowd.poses.shown[resident], "still shown").toBe(1);
    expect(crowd.eventLog().length, "log").toBe(0);
  });
});

describe("given a host crowd and a bodega on the map", () => {
  const bodega = placeNamed(map, PLACE_NAMES.bodega);
  const front = map.places[bodega]!;
  /** On the bodega's face, half a metre out. */
  const faceX = front.x + front.depth / 2 + 0.5;

  function hostCrowd() {
    const crowd = newCrowd(map);
    crowd.step(1, [], true);
    return crowd;
  }

  it("when a car meets a solid at the wreck speed on the bodega's face, then a wreck event is logged for it and, once the hour comes, the place is shut", () => {
    const crowd = hostCrowd();
    crowd.noteWallHit(WRECK_SPEED, faceX, front.z);
    expect(firstMismatch(Array.from(crowd.eventLog()), [EVENT_KIND.wreck, bodega, 1]), "the log").toBeUndefined();
    const later = 1 + 70;
    for (let seconds = 2; seconds <= later; seconds++) crowd.step(seconds, [], true);
    expect(crowd.state.closedUntilTick[bodega]!, "closed until a tick after now").toBeGreaterThan(tickAt(later));
  });

  it("when the hit is slower than the wreck speed, or off every footprint, or the crowd is a client's, then nothing is logged", () => {
    const crowd = hostCrowd();
    crowd.noteWallHit(WRECK_SPEED - 0.5, faceX, front.z);
    crowd.noteWallHit(WRECK_SPEED + 5, front.x + 1000, front.z);
    expect(crowd.eventLog().length, "host log").toBe(0);
    const client = newCrowd(map);
    client.step(1, [], false);
    client.noteWallHit(WRECK_SPEED + 5, faceX, front.z);
    expect(client.eventLog().length, "client log").toBe(0);
  });

  it(`when a car grinds along the face, then one wreck is logged until ${WRECK_LOCKOUT_SECONDS} s have passed`, () => {
    const crowd = hostCrowd();
    crowd.noteWallHit(WRECK_SPEED, faceX, front.z);
    crowd.step(1 + WRECK_LOCKOUT_SECONDS - 1, [], true);
    crowd.noteWallHit(WRECK_SPEED, faceX, front.z);
    expect(crowd.eventLog().length, "numbers in the log").toBe(3);
    crowd.step(1 + WRECK_LOCKOUT_SECONDS + 1, [], true);
    crowd.noteWallHit(WRECK_SPEED, faceX, front.z);
    expect(crowd.eventLog().length, "numbers in the log").toBe(6);
  });
});
