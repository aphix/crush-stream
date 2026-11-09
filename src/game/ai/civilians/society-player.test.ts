import { describe, expect, it } from "vitest";
import { ACTIVITY } from "./civilian-activity.ts";
import { EVENT_KIND, EVENT_LEAD_TICKS, FIGHT_PLAYER, FLAG, JAYWALK_CUSTODY_TICKS, NEVER_TICK, NO_BEARING, RESIDENT_INT } from "./civilian-constants.ts";
import { WALKER_BEARING_STEPS } from "./civilian-crowd-constants.ts";
import { applyIndividualEvents, applyReactionEvents, queueEvents } from "./civilian-events.ts";
import { historyLines, moodOf } from "./civilian-mood.ts";
import { MOOD } from "./civilian-names.ts";
import { ActivityReading, WalkerStrike, findWalkerStrike, readActivity } from "./society-activity.ts";
import { newCast, societyMap, type Cast } from "./society-scenes.test-util.ts";
import { intAt, placeIn, stageResident } from "./society.test-util.ts";

const NOON = 12;
const HOME_A1 = placeIn(societyMap, "Rowhome A1-1");
const HOME_A1_NEXT = placeIn(societyMap, "Rowhome A1-2");
/** The player stands to the victim's +x side: a quarter turn from +z, in the wire's steps. */
const EAST = WALKER_BEARING_STEPS / 4;
const PUSHES = 400;
/** The calm push-to-fight share band (the roll is 0.12). */
const CALM_SHARE: readonly [number, number] = [0.06, 0.2];

type ShoveTally = { fights: number; withPlayer: number; facingHim: number; wanted: number };

/** `PUSHES` pushes on a calm resident at their door, each the triples `logOf` gives at its tick; what the fights they made were. */
function tallyPushes(logOf: (victim: number, seconds: number) => number[]): ShoveTally {
  const cast = newCast(NOON);
  const { state, resident } = cast;
  const tally = { fights: 0, withPlayer: 0, facingHim: 0, wanted: 0 };
  for (let push = 0; push < PUSHES; push++) {
    const tick = cast.tick + 4 * push;
    stageResident(state, resident, { place: HOME_A1, tick });
    state.events.length = 0;
    queueEvents(state, tick, logOf(resident, tick / 2));
    applyReactionEvents(state, tick + EVENT_LEAD_TICKS);
    if (intAt(state, resident, RESIDENT_INT.fightTick) === NEVER_TICK) continue;
    tally.fights++;
    if (intAt(state, resident, RESIDENT_INT.fightPartner) === FIGHT_PLAYER) tally.withPlayer++;
    if (intAt(state, resident, RESIDENT_INT.fightBearing) === EAST) tally.facingHim++;
    if ((intAt(state, resident, RESIDENT_INT.flags) & FLAG.wanted) !== 0) tally.wanted++;
  }
  return tally;
}

describe("given 400 nudges by a car coming from the east on a calm resident, and the same pushes with no bearing", () => {
  const nudged = tallyPushes((victim, seconds) => [EVENT_KIND.push, victim, seconds, EVENT_KIND.car, EAST, seconds]);
  const bare = tallyPushes((victim, seconds) => [EVENT_KIND.push, victim, seconds]);

  it("when they are rolled, then the same seeded fights happen, each facing the car, with no civilian and no player as the other fighter, and not wanted for it", () => {
    expect(nudged.fights, "fights from the nudges").toBe(bare.fights);
    expect(nudged.facingHim, "fighters facing the car").toBe(nudged.fights);
    expect(nudged.withPlayer, "fights with the player").toBe(0);
    expect(nudged.wanted, "fighters wanted for it").toBe(0);
    expect(bare.facingHim, "fighters facing a way when the car gave none").toBe(0);
  });

  it("when one of them is drawn at the fight, then they swing at the car: facing east, and no swing lands on the player", () => {
    const cast = newCast(NOON);
    const { state, resident } = cast;
    stageResident(state, resident, { place: HOME_A1, tick: cast.tick, nextDecision: cast.tick + 1000 });
    queueEvents(state, cast.tick, [EVENT_KIND.fight, resident, cast.tick / 2, EVENT_KIND.car, EAST, cast.tick / 2]);
    applyReactionEvents(state, cast.tick + EVENT_LEAD_TICKS);
    const arrive = (cast.tick + EVENT_LEAD_TICKS) / 2;
    const seen = new ActivityReading();
    readActivity(state, resident, arrive + 0.3, seen);
    expect([seen.code, seen.placed].join("/"), "activity and placed").toBe([ACTIVITY.swing, true].join("/"));
    expect(seen.yaw, "the way they face").toBeCloseTo(Math.PI / 2, 5);
    expect(intAt(state, resident, RESIDENT_INT.fightPartner), "who they fight").toBe(-1);
    expect(findWalkerStrike(state, arrive + 0.2, arrive + 0.4, 0, 0, new WalkerStrike()), "a swing on the player").toBe(false);
  });
});

describe("given 400 shoves by the player's walker on a calm resident, and the same pushes from a car", () => {
  const byWalker = tallyPushes((victim, seconds) => [EVENT_KIND.push, victim, seconds, EVENT_KIND.walker, EAST, seconds]);
  const byCar = tallyPushes((victim, seconds) => [EVENT_KIND.push, victim, seconds]);

  it("when the walker's are rolled, then about an eighth become a fight, every one with the player, facing him, the resident wanted for it", () => {
    expect(byWalker.fights / PUSHES, "share that became a fight").toBeGreaterThan(CALM_SHARE[0]);
    expect(byWalker.fights / PUSHES, "share that became a fight").toBeLessThan(CALM_SHARE[1]);
    expect(byWalker.withPlayer, "fights with the player").toBe(byWalker.fights);
    expect(byWalker.facingHim, "fighters facing the way he stood").toBe(byWalker.fights);
    expect(byWalker.wanted, "fighters wanted for it").toBe(byWalker.fights);
  });

  it("when the car's are rolled, then the same seeded roll makes the same number of fights, none with the player, none facing anyone", () => {
    expect(byCar.fights, "fights from the car's pushes").toBe(byWalker.fights);
    expect(byCar.withPlayer, "fights with the player").toBe(0);
    expect(byCar.facingHim, "fighters facing a way").toBe(0);
  });
});

/** The host forces a fight between a resident at their door and the player standing east of them; the resident's arrival at the fight in crowd seconds. */
function fightWithPlayer(): { cast: Cast; arrive: number; spotX: number; spotZ: number } {
  const cast = newCast(NOON);
  const { state, resident } = cast;
  stageResident(state, resident, { place: HOME_A1, tick: cast.tick, nextDecision: cast.tick + 1000 });
  queueEvents(state, cast.tick, [EVENT_KIND.fight, resident, cast.tick / 2, EVENT_KIND.walker, EAST, cast.tick / 2]);
  applyReactionEvents(state, cast.tick + EVENT_LEAD_TICKS);
  const door = societyMap.places[HOME_A1]!;
  return { cast, arrive: (cast.tick + EVENT_LEAD_TICKS) / 2, spotX: door.doorX, spotZ: door.doorZ };
}

describe("given a resident who has turned on the player standing east of them", () => {
  const { cast, arrive, spotX, spotZ } = fightWithPlayer();
  const { state, resident } = cast;
  const reading = new ActivityReading();
  const strike = new WalkerStrike();

  it("when they are drawn, then they swing at him and block, facing east, at their spot, with no civilian partner", () => {
    readActivity(state, resident, arrive + 0.3, reading);
    expect(reading.code, "activity in the first swing").toBe(ACTIVITY.swing);
    expect(reading.placed, "the brain places them").toBe(true);
    expect(reading.yaw, "the way they face").toBeCloseTo(Math.PI / 2, 5);
    expect(reading.partner, "civilian partner").toBe(-1);
    expect(Math.hypot(reading.x - spotX, reading.z - spotZ), "metres from their spot").toBeLessThan(0.01);
    readActivity(state, resident, arrive + 0.9, reading);
    expect(reading.code, "activity after the first swing").toBe(ACTIVITY.block);
  });

  it("when the player is a metre east, then a swing lands on him half way through each swing, pushing him east, and not while they block", () => {
    expect(findWalkerStrike(state, arrive + 0.2, arrive + 0.4, spotX + 1, spotZ, strike), "a swing lands in the first swing's middle").toBe(true);
    expect(strike.dirX, "push east").toBeCloseTo(1, 2);
    expect(strike.dirZ, "push north or south").toBeCloseTo(0, 2);
    expect(findWalkerStrike(state, arrive + 0.4, arrive + 0.8, spotX + 1, spotZ, strike), "a swing lands after the first one, while blocking").toBe(false);
    expect(findWalkerStrike(state, arrive + 1.4, arrive + 1.6, spotX + 1, spotZ, strike), "the second swing lands").toBe(true);
  });

  it("when the player has stepped three metres away, then no swing reaches him", () => {
    expect(findWalkerStrike(state, arrive + 0.2, arrive + 0.4, spotX + 3, spotZ, strike), "a swing lands three metres off").toBe(false);
  });
});

describe("given two residents fighting each other with the player standing beside them", () => {
  it("when their swings come, then none lands on him", () => {
    const cast = newCast(NOON);
    const { state, resident, neighbour } = cast;
    for (const person of [resident, neighbour]) stageResident(state, person, { place: HOME_A1, tick: cast.tick });
    queueEvents(state, cast.tick, [EVENT_KIND.fight, neighbour, cast.tick / 2, EVENT_KIND.alongside, resident, cast.tick / 2]);
    applyReactionEvents(state, cast.tick + EVENT_LEAD_TICKS);
    const door = societyMap.places[HOME_A1]!;
    const arrive = (cast.tick + EVENT_LEAD_TICKS) / 2;
    expect(intAt(state, resident, RESIDENT_INT.fightPartner), "who they fight").toBe(neighbour);
    expect(intAt(state, resident, RESIDENT_INT.fightBearing), "a bearing of a civilian pair").toBe(NO_BEARING);
    expect(findWalkerStrike(state, arrive, arrive + 2, door.doorX, door.doorZ, new WalkerStrike()), "a swing on the player").toBe(false);
  });
});

describe("given the police arrest a jaywalker, and the same arrest of someone hurt", () => {
  it("when it is queued and its tick comes, then the jaywalker is off the street at once, an hour in custody, sent home, annoyed, with a line saying why", () => {
    const cast = newCast(NOON);
    const { state, resident, tick } = cast;
    stageResident(state, resident, { place: HOME_A1_NEXT, home: HOME_A1, tick, nextDecision: tick + 1000 });
    queueEvents(state, tick, [EVENT_KIND.jaywalk, resident, tick / 2]);
    expect(state.hiddenFromTick[resident], "tick they leave the street").toBe(tick);
    expect(state.hiddenUntilTick[resident], "tick they are back").toBe(tick + JAYWALK_CUSTODY_TICKS);
    applyIndividualEvents(state, tick);
    expect(intAt(state, resident, RESIDENT_INT.flags) & FLAG.custody, "custody flag").toBe(FLAG.custody);
    expect(intAt(state, resident, RESIDENT_INT.place), "where they will be").toBe(HOME_A1);
    expect(intAt(state, resident, RESIDENT_INT.nextDecisionTick), "tick they are let out").toBe(tick + JAYWALK_CUSTODY_TICKS);
    expect(historyLines(state, resident)[0], "the newest line").toBe("was arrested for crossing against the light");
    expect(moodOf(state, resident, tick + 1), "their mood").toBe(MOOD.annoyed);
  });

  it("when the one arrested is hurt, then nothing happens to them", () => {
    const cast = newCast(NOON);
    const { state, resident, tick } = cast;
    stageResident(state, resident, { place: HOME_A1, tick, nextDecision: tick + 1000, flags: FLAG.hurt });
    queueEvents(state, tick, [EVENT_KIND.jaywalk, resident, tick / 2]);
    applyIndividualEvents(state, tick);
    expect(intAt(state, resident, RESIDENT_INT.flags) & FLAG.custody, "custody flag").toBe(0);
    expect(intAt(state, resident, RESIDENT_INT.nextDecisionTick), "tick their dwell ends").toBe(tick + 1000);
  });
});
