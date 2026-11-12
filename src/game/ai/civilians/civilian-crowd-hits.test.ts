import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { describe, expect, it } from "vitest";
import { tickAt } from "./civilian-clock.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { DECISION_HZ, EVENT_KIND, EVENT_TRIPLE, FLAG, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { WRECK_LOCKOUT_SECONDS, WRECK_SPEED } from "./civilian-crowd-constants.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { historyLines } from "./civilian-mood.ts";
import { carAtWalker, FRAME_SECONDS, newCrowd, shownResident, stepUntilShown } from "./civilian-crowd.test-util.ts";
import { knockoutBlow } from "./society-activity.ts";

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
  it("when the car reaches them, then one strike is queued for the ragdoll at their feet, they are hidden at once and stay hidden, and the knock and the car's push are in the host's log", () => {
    const { crowd, resident, seconds, struck } = chase(true, true);
    expect(struck.length, "strikes").toBe(1);
    expect(struck[0]!.guard, "the civilian struck").toBe(resident);
    expect(struck[0]!.car, "the car that struck").toBe(0);
    expect(crowd.poses.shown[resident], "shown the step they were run down").toBe(0);
    expect(firstMismatch(Array.from(crowd.eventLog()).slice(-2 * EVENT_TRIPLE), [EVENT_KIND.knock, resident, seconds, EVENT_KIND.push, resident, seconds]), "the host's log ends: the knock, then the push that made it").toBeUndefined();
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

describe("given two civilians of the host's crowd in a fight that ends in a knock-out", () => {
  /** A host crowd with a fight raised between two free residents whose victim's knock-out blow is not 0; stepped until both are squared up. */
  function stagedFight() {
    for (let offset = 2; offset < 120; offset += 2) {
      const crowd = newCrowd(map);
      crowd.step(1, [], true);
      const starter = crowd.state.cast.length + offset;
      const victim = starter + 1;
      if (victim >= crowd.state.capacity) break;
      crowd.raisePair(EVENT_KIND.fight, victim, starter);
      const ints = crowd.state.ints;
      let seconds = 1;
      while (seconds < 20 && ints[victim * RESIDENT_INT_STRIDE + RESIDENT_INT.fightPartner] !== starter) crowd.step((seconds += FRAME_SECONDS), [], true);
      if (ints[victim * RESIDENT_INT_STRIDE + RESIDENT_INT.fightPartner] !== starter) continue;
      const fightTick = ints[victim * RESIDENT_INT_STRIDE + RESIDENT_INT.fightTick]!;
      const blow = knockoutBlow(crowd.state.seed, victim, fightTick);
      if (blow === 0) continue;
      return { crowd, starter, victim, seconds, landing: ints[starter * RESIDENT_INT_STRIDE + RESIDENT_INT.arriveTick]! / DECISION_HZ + 0.3 + 1.2 * (blow - 1) };
    }
    throw new Error("no pair of the fixture crowd fought to a knock-out");
  }

  // mutation: sed -i '/^      this.findPunches();/d' src/game/ai/civilians/civilian-crowd.ts
  it("when the fight reaches its victim's knock-out blow, then she is hidden, one strike with no car is queued, and the log ends knock, push, alongside her striker", () => {
    const { crowd, starter, victim, landing } = stagedFight();
    let seconds = crowd.crowdSeconds;
    crowd.takeStrikes();
    while (seconds < landing + 0.1) crowd.step((seconds += FRAME_SECONDS), [], true);
    expect(crowd.poses.shown[victim], "the victim is hidden").toBe(0);
    const strikes = crowd.takeStrikes();
    expect(strikes.length, "strikes queued").toBe(1);
    expect(strikes[0]!.car, "no car").toBe(-1);
    const tail = Array.from(crowd.eventLog()).slice(-3 * EVENT_TRIPLE);
    expect(firstMismatch([tail[0]!, tail[1]!, tail[3]!, tail[4]!, tail[6]!, tail[7]!], [EVENT_KIND.knock, victim, EVENT_KIND.push, victim, EVENT_KIND.alongside, starter]), "the log's last three entries").toBeUndefined();
  });

  // mutation: sed -i '/^      if (blow.landing <= this.blowsLanded\[victim\]!) continue;/d' src/game/ai/civilians/civilian-crowd.ts
  it("when the crowd clock runs back and over the window of the fight's first blow ten times, then that one swing counts once: the victim is still shown, no strike is queued, and the log holds no knock", () => {
    const { crowd, starter, victim } = stagedFight();
    const arrive = crowd.state.ints[starter * RESIDENT_INT_STRIDE + RESIDENT_INT.arriveTick]! / DECISION_HZ;
    crowd.takeStrikes();
    const framesOver = Math.round(0.5 / FRAME_SECONDS);
    for (let pass = 0; pass < 10; pass++) for (let frame = 0; frame < framesOver; frame++) crowd.step(arrive + 0.1 + frame * FRAME_SECONDS, [], true);
    expect(crowd.poses.shown[victim], "the victim is still shown").toBe(1);
    expect(crowd.takeStrikes().length, "strikes queued").toBe(0);
    const log = crowd.eventLog();
    let knocks = 0;
    for (let at = 0; at < log.length; at += EVENT_TRIPLE) if (log[at] === EVENT_KIND.knock && log[at + 1] === victim) knocks++;
    expect(knocks, "knocks logged for the victim").toBe(0);
  });

  // mutation: sed -i 's/^      if (by >= 0) {/      if (by >= 9e9) {/' src/game/ai/civilians/civilian-crowd.ts
  it("when a client hears a knock that names a striker, then it throws her along the blow with no car anywhere", () => {
    const { crowd, starter, victim, landing } = stagedFight();
    const client = newCrowd(map);
    client.hear(crowd.eventLog());
    client.step(landing, [], false);
    client.takeStrikes();
    const at = landing + 0.1;
    client.hear(Float64Array.of(EVENT_KIND.knock, victim, at, EVENT_KIND.push, victim, at, EVENT_KIND.alongside, starter, at));
    client.step(at + FRAME_SECONDS, [], false);
    const strikes = client.takeStrikes();
    expect(strikes.length, "one figure thrown").toBe(1);
    expect(strikes[0]!.car, "no car").toBe(-1);
    expect(strikes[0]!.guard, "the victim").toBe(victim);
    const toVictim = (client.poses.x[victim]! - client.poses.x[starter]!) * strikes[0]!.vx + (client.poses.z[victim]! - client.poses.z[starter]!) * strikes[0]!.vz;
    expect(toVictim, "thrown away from her striker").toBeGreaterThan(0);
  });
});
