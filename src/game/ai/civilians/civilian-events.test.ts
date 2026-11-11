import { describe, expect, it } from "vitest";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { EVENT_KIND, EVENT_LEAD_TICKS, FLAG, NEVER_TICK, PURPOSE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES, TICKS_PER_GAME_DAY } from "./civilian-constants.ts";
import { applyIndividualEvents, applyReactionEvents, queueEvents } from "./civilian-events.ts";
import { buildFixtureMap, costOfWalk, placeNamed } from "./civilian-graph.test-util.ts";
import { legPositionAt, LegPose } from "./civilian-leg.ts";
import { historyLines, moodOf } from "./civilian-mood.ts";
import { EVENT_CODE, MOOD } from "./civilian-names.ts";
import { runTicks, stateDigest, tickOfHour } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { newCast, societyMap } from "./society-scenes.test-util.ts";
import { createCityState } from "./society.ts";
import { placeIn, stageResident } from "./society.test-util.ts";
import { PathFinder } from "./walk-path.ts";

const map = buildFixtureMap();
const pose = new LegPose();

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function freshCity(seed = 9): CityState {
  return createCityState(seed, map, 60);
}

/** Steps `state` until `done` says so (it is asked after each tick), or fails after `limit` ticks. */
function stepUntil(state: CityState, limit: number, done: () => boolean): void {
  for (let step = 0; step < limit; step++) {
    computeTick(state, state.nextTick);
    if (done()) return;
  }
  throw new Error("scene never came about");
}

/** A person (not a named one) on a walk with at least `ticksLeft` ticks still to go and under way for two ticks, or -1. */
function walkerWithTimeLeft(state: CityState, ticksLeft: number): number {
  for (let resident = state.cast.length; resident < state.capacity; resident++) {
    const arrives = intAt(state, resident, RESIDENT_INT.arriveTick);
    const departs = intAt(state, resident, RESIDENT_INT.departTick);
    if (intAt(state, resident, RESIDENT_INT.species) !== SPECIES.person || intAt(state, resident, RESIDENT_INT.pathCount) < 3) continue;
    if (departs <= state.nextTick - 3 && arrives - state.nextTick >= ticksLeft) return resident;
  }
  return -1;
}

/** Steps to a tick where `at` (tick mod 120 = `at`) and someone is on a walk with time left; returns who. */
function cityWithWalkerAtHourOffset(offset: number): { state: CityState; walker: number } {
  const state = freshCity();
  let walker = -1;
  stepUntil(state, 3 * TICKS_PER_GAME_DAY, () => {
    walker = state.nextTick % 120 === offset ? walkerWithTimeLeft(state, 40) : -1;
    return walker !== -1;
  });
  return { state, walker };
}

describe("given a civilian partway along a walk when a car runs them down", () => {
  const { state, walker } = cityWithWalkerAtHourOffset(30);
  const hitTick = state.nextTick;
  const seconds = hitTick / 2;
  queueEvents(state, hitTick, [EVENT_KIND.knock, walker, seconds]);

  it("when the host has told the crowd, then they are off the street from that moment and not before it", () => {
    expect(legPositionAt(state, walker, seconds - 0.4, pose), "on the street just before the hit").toBe(true);
    expect(legPositionAt(state, walker, seconds + 0.01, pose), "on the street just after the hit").toBe(false);
    expect(legPositionAt(state, walker, seconds + 30, pose), "on the street half a minute later").toBe(false);
  });

  it("when the hospital days pass, then they are home and well again at the tick half a game day after the hit and not before", () => {
    const home = intAt(state, walker, RESIDENT_INT.home);
    computeTick(state, hitTick);
    expect(intAt(state, walker, RESIDENT_INT.flags) & FLAG.hurt, "hurt flag after the hit").toBe(FLAG.hurt);
    expect(intAt(state, walker, RESIDENT_INT.place), "where they lie").toBe(home);
    expect(intAt(state, walker, RESIDENT_INT.nextDecisionTick), "tick they are back (half a game day, 1440 ticks)").toBe(hitTick + 1440);
    expect(historyLines(state, walker)[0], "the log's newest line").toContain("was knocked down outside");
    expect(moodOf(state, walker, hitTick + 1), "mood in hospital").toBe(MOOD.hurt);
    runTicks(state, 1439 - 1);
    expect(intAt(state, walker, RESIDENT_INT.flags) & FLAG.hurt, "hurt flag the tick before").toBe(FLAG.hurt);
    runTicks(state, 2);
    expect(intAt(state, walker, RESIDENT_INT.flags) & FLAG.hurt, "hurt flag at their return").toBe(0);
    expect(historyLines(state, walker).slice(0, 2), "the log's two newest lines").toContain("back from hospital");
  });
});

describe("given a knock and a wreck three ticks before an hour and a peer who hears of them ten ticks late", () => {
  it("when both have run past the hour after, then their states are the same", () => {
    const { state: host, walker } = cityWithWalkerAtHourOffset(117);
    const hitTick = host.nextTick;
    const peer = freshCity();
    runTicks(peer, hitTick);
    const told = [EVENT_KIND.knock, walker, hitTick / 2, EVENT_KIND.wreck, placeNamed(map, PLACE_NAMES.bodega), hitTick / 2];
    queueEvents(host, hitTick, told);
    runTicks(host, 10);
    runTicks(peer, 10);
    queueEvents(peer, hitTick + 10, told);
    runTicks(host, 130);
    runTicks(peer, 130);
    expect(stateDigest(peer), "state of the late peer past the hour").toBe(stateDigest(host));
    expect(EVENT_LEAD_TICKS, "lead that makes the two agree is over the lateness").toBeGreaterThan(10);
  });
});

/** The places walks set out for, counted over `ticks` ticks of a city stepped with `events`. */
function walksTo(place: number, fromTick: number, toTick: number, events: Map<number, number[]>): number {
  const state = freshCity();
  let walks = 0;
  while (state.nextTick < toTick) {
    const tick = state.nextTick;
    const posted = events.get(tick);
    if (posted !== undefined) queueEvents(state, tick, posted);
    const answer = computeTick(state, tick);
    for (const resident of answer.residents) {
      if (tick >= fromTick && intAt(state, resident, RESIDENT_INT.species) === SPECIES.person && intAt(state, resident, RESIDENT_INT.place) === place && intAt(state, resident, RESIDENT_INT.departTick) === tick && intAt(state, resident, RESIDENT_INT.pathCount) > 0) walks++;
    }
  }
  return walks;
}

/** The place that is no home with the most people working at it in the city as it starts. */
function busiestWorkplace(): number {
  const state = freshCity();
  let busiest = -1;
  for (let place = 0; place < map.places.length; place++) if (map.places[place]!.kind !== PLACE_KIND.home && (busiest === -1 || state.headcount[place]! > state.headcount[busiest]!)) busiest = place;
  return busiest;
}

describe("given a car wrecked into the busiest workplace five ticks before the nine o'clock hour on the second day", () => {
  const bodega = busiestWorkplace();
  const probe = freshCity();
  const hour = tickOfHour(probe, 1, 9);
  const wreck = new Map([[hour - 5, [EVENT_KIND.wreck, bodega, (hour - 5) / 2]]]);
  const wrecked = freshCity();
  runTicks(wrecked, hour - 5);
  queueEvents(wrecked, hour - 5, [EVENT_KIND.wreck, bodega, (hour - 5) / 2]);

  it("when the hour comes, then the workplace is still open, and an hour on it has shut for two game days", () => {
    runTicks(wrecked, 6);
    expect(wrecked.closedUntilTick[bodega], "closed-until at the hour of the wreck").toBe(0);
    runTicks(wrecked, 120);
    expect(wrecked.closedUntilTick[bodega], "closed-until an hour on (two game days of 2880 ticks)").toBe(hour + 120 + 2 * 2880);
  });

  it("when its second day shut passes (the fear has halved), then nobody sets out for it, while with no wreck people keep going", () => {
    const from = hour + 120 + TICKS_PER_GAME_DAY;
    const to = hour + 120 + 2 * TICKS_PER_GAME_DAY - 60;
    expect(walksTo(bodega, from, to, wreck), "walks to the wrecked workplace on its second day shut").toBe(0);
    expect(walksTo(bodega, from, to, new Map()), "walks to the workplace on a day with no wreck").toBeGreaterThan(0);
  });

  it("when the staff are asked, then they are laid off with a line in their log, and back at work when it reopens", () => {
    const staff: number[] = [];
    for (let resident = 0; resident < wrecked.capacity; resident++) if (intAt(wrecked, resident, RESIDENT_INT.work) === bodega && intAt(wrecked, resident, RESIDENT_INT.alive) === 1) staff.push(resident);
    expect(staff.length, "people working at the workplace").toBeGreaterThan(0);
    for (const resident of staff) {
      expect(intAt(wrecked, resident, RESIDENT_INT.flags) & FLAG.laidOff, "laid-off flag").toBe(FLAG.laidOff);
      expect(historyLines(wrecked, resident).join("|"), "log of someone laid off").toContain(`${map.places[bodega]!.name} shut down after the wreck`);
    }
    runTicks(wrecked, 2 * TICKS_PER_GAME_DAY);
    expect(wrecked.closedUntilTick[bodega], "closed-until after reopening").toBe(0);
    for (const resident of staff) if (intAt(wrecked, resident, RESIDENT_INT.alive) === 1) expect(intAt(wrecked, resident, RESIDENT_INT.flags) & FLAG.laidOff, "laid-off flag after it reopens").toBe(0);
  });
});

/** Two doors whose plain walk passes through `corner` with it neither the start nor the end, and that can go round it under `fear`; and that plain walk. */
function walkPassingThrough(corner: number, fear: Float32Array): { from: number; to: number; straight: number[] } {
  const finder = new PathFinder(map.graph);
  const calm = new Float32Array(map.graph.nodeX.length);
  const out = new Uint16Array(128);
  for (const first of map.places) {
    for (const second of map.places) {
      if (first.doorNode < 0 || second.doorNode < 0) continue;
      const straight = Array.from(out.subarray(0, finder.find(first.doorNode, second.doorNode, calm, 1, out, 0, 128)));
      if (straight.indexOf(corner) <= 0 || straight.indexOf(corner) >= straight.length - 1) continue;
      const around = finder.find(first.doorNode, second.doorNode, fear, 1, out, 0, 128);
      if (!Array.from(out.subarray(0, around)).includes(corner)) return { from: first.doorNode, to: second.doorNode, straight };
    }
  }
  throw new Error("no walk passes through the corner");
}

describe("given a car wrecked at the bus stop on the west street", () => {
  const stop = placeNamed(map, PLACE_NAMES.busStop);
  const state = freshCity();
  const hour = tickOfHour(state, 1, 8);
  runTicks(state, hour - 5);
  queueEvents(state, hour - 5, [EVENT_KIND.wreck, stop, (hour - 5) / 2]);
  runTicks(state, 130);
  const door = map.places[stop]!.doorNode;

  it("when the hour after has come, then the stop's corner is feared and a street across the city is not", () => {
    expect(state.fear[door], "fear at the stop").toBeGreaterThan(0.9);
    expect(state.fear[map.graph.nodeX.length - 1], "fear at the far corner").toBe(0);
  });

  it("when a walk through the corner is priced, then it costs more than going round it", () => {
    const through = walkPassingThrough(door, state.fear);
    const out = new Uint16Array(128);
    const around = state.finder.find(through.from, through.to, state.fear, 1, out, 0, 128);
    expect(Array.from(out.subarray(0, around)), "the walk with fear").not.toContain(door);
    expect(costOfWalk(map.graph, through.straight, state.fear, 1), "cost of the plain walk under fear").toBeGreaterThan(state.finder.lastCost);
  });

  it("when a game day goes by, then the fear has fallen by about half", () => {
    runTicks(state, TICKS_PER_GAME_DAY);
    expect(state.fear[door], "fear at the stop a day later").toBeLessThan(0.6);
    expect(state.fear[door], "fear at the stop a day later").toBeGreaterThan(0.3);
  });
});

describe("given a car wrecked outside the garage while the mechanic is at work", () => {
  const garage = placeNamed(map, PLACE_NAMES.garage);
  const neighbour = placeNamed(map, "Rowhome C2-1");
  const state = freshCity();
  const hector = state.cast.findIndex((resolved) => resolved.member.key === "hector");
  stepUntil(state, 3 * TICKS_PER_GAME_DAY, () => intAt(state, hector, RESIDENT_INT.place) === garage && intAt(state, hector, RESIDENT_INT.arriveTick) <= state.nextTick - 1 && intAt(state, hector, RESIDENT_INT.nextDecisionTick) > state.nextTick + 10);

  it("when the crash is reported, then the mechanic comes out of the garage to the wreck", () => {
    const tick = state.nextTick;
    expect(intAt(state, hector, RESIDENT_INT.legPurpose), "what he was doing before").not.toBe(PURPOSE.mechanicOut);
    queueEvents(state, tick, [EVENT_KIND.wreck, neighbour, tick / 2]);
    computeTick(state, tick);
    expect(intAt(state, hector, RESIDENT_INT.fromPlace), "where he came from").toBe(garage);
    expect(intAt(state, hector, RESIDENT_INT.place), "where he is going").toBe(neighbour);
    expect(intAt(state, hector, RESIDENT_INT.legPurpose), "what he is going for").toBe(PURPOSE.mechanicOut);
    expect(intAt(state, hector, RESIDENT_INT.pathCount), "nodes on his walk").toBeGreaterThan(1);
  });
});

describe("given a car wrecked into a family's stoop", () => {
  const home = placeNamed(map, "Rowhome B2-1");
  const state = freshCity();
  const housemates: number[] = [];
  for (let resident = state.cast.length; resident < state.capacity; resident++) if (intAt(state, resident, RESIDENT_INT.home) === home && intAt(state, resident, RESIDENT_INT.species) === SPECIES.person) housemates.push(resident);
  const hour = tickOfHour(state, 1, 9);
  runTicks(state, hour - 5);
  queueEvents(state, hour - 5, [EVENT_KIND.wreck, home, (hour - 5) / 2]);
  runTicks(state, 130);

  it("when two and a half days have passed, then the family is still angry, and after four they are not", () => {
    expect(housemates.length, "people in that home").toBeGreaterThan(0);
    runTicks(state, 2 * TICKS_PER_GAME_DAY + 1000);
    for (const resident of housemates) expect(moodOf(state, resident, state.nextTick - 1), "mood two and a half days on").toBe(MOOD.angry);
    runTicks(state, 2 * TICKS_PER_GAME_DAY);
    for (const resident of housemates) expect(moodOf(state, resident, state.nextTick - 1), "mood four days on").not.toBe(MOOD.angry);
  });
});

describe("given the pirate radio comes on at midnight", () => {
  const state = freshCity();
  runTicks(state, tickOfHour(state, 1, 1));

  it("when an hour of broadcast has passed, then the houses of the north-west blocks have static on their TVs and the south-east ones do not", () => {
    let heard = 0;
    let spared = 0;
    for (let resident = state.cast.length; resident < state.capacity; resident++) {
      if (intAt(state, resident, RESIDENT_INT.alive) === 0) continue;
      const block = state.index.blockOf[intAt(state, resident, RESIDENT_INT.home)]!;
      const complained = historyLines(state, resident).some((line) => line.includes("went to static"));
      if (block === 0 || block === 1) heard += complained ? 1 : 0;
      else if (block === 8) spared += complained ? 1 : 0;
    }
    expect(heard, "residents of A1 and A2 who heard the static").toBeGreaterThan(3);
    expect(spared, "residents of C3 who heard it").toBe(0);
  });

  // mutation: sed -i 's/STATIC_HOLD_TICKS : MOOD_HOLD_TICKS;/MOOD_HOLD_TICKS : MOOD_HOLD_TICKS;/' src/game/ai/civilians/civilian-names.ts
  it("when the night is over, then the static no longer colours anyone's mood: by noon nobody it reached is annoyed by it", () => {
    const noon = tickOfHour(state, 1, 12);
    runTicks(state, noon - state.nextTick);
    let annoyedAtNight = 0;
    let stillAnnoyed = 0;
    for (let resident = state.cast.length; resident < state.capacity; resident++) {
      if (intAt(state, resident, RESIDENT_INT.alive) === 0 || intAt(state, resident, RESIDENT_INT.moodEvent) !== EVENT_CODE.staticComplaint) continue;
      if (moodOf(state, resident, intAt(state, resident, RESIDENT_INT.moodTick) + 1) === MOOD.annoyed) annoyedAtNight++;
      if (moodOf(state, resident, state.nextTick - 1) === MOOD.annoyed) stillAnnoyed++;
    }
    expect(annoyedAtNight, "residents annoyed just after the static").toBeGreaterThan(3);
    expect(stillAnnoyed, "of them, still annoyed at noon").toBe(0);
  });
});

describe("given two civilians in a fight", () => {
  // mutation: sed -i '/^      releaseFightPartner(state, event.subject);/d' src/game/ai/civilians/civilian-events.ts
  it("when a knock is applied to one of them, then neither she nor her partner is in a fight any more", () => {
    const cast = newCast(12);
    const { state, resident, neighbour } = cast;
    const home = placeIn(societyMap, "Rowhome A1-1");
    for (const person of [resident, neighbour]) stageResident(state, person, { place: home, tick: cast.tick });
    queueEvents(state, cast.tick, [EVENT_KIND.fight, neighbour, cast.tick / 2, EVENT_KIND.alongside, resident, cast.tick / 2]);
    const fought = cast.tick + EVENT_LEAD_TICKS;
    applyReactionEvents(state, fought);
    expect(intAt(state, resident, RESIDENT_INT.fightTick), "control: he is in the fight").not.toBe(NEVER_TICK);
    queueEvents(state, fought, [EVENT_KIND.knock, neighbour, fought / 2]);
    applyIndividualEvents(state, fought + EVENT_LEAD_TICKS);
    expect(intAt(state, neighbour, RESIDENT_INT.fightTick), "the one knocked").toBe(NEVER_TICK);
    expect(intAt(state, resident, RESIDENT_INT.fightTick), "her partner").toBe(NEVER_TICK);
  });
});
