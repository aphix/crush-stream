import { detAtan2, hypot2 } from "../../kernel/physics-core.js";
import { describe, expect, it } from "vitest";
import { ACTIVITY, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import {
  ALARM_SIGHT,
  CALL_MINUTES,
  CENTIMETRES_PER_METRE,
  DECISION_HZ,
  EVENT_KIND,
  EVENT_LEAD_TICKS,
  FLAG,
  LOOK_ON_CRASH_MINUTES,
  LOOK_ON_DOWNED_MINUTES,
  NEED,
  NEVER_TICK,
  NO_PLACE,
  PURPOSE,
  RECOIL_STEP_METRES,
  RESIDENT_INT,
  TICKS_PER_GAME_MINUTE,
} from "./civilian-constants.ts";
import { AMBULANCE_DELAY_SECONDS } from "./civilian-crowd-constants.ts";
import { applyIndividualEvents, applyReactionEvents, queueEvents } from "./civilian-events.ts";
import { LegPose, legPose } from "./civilian-leg.ts";
import { historyLines } from "./civilian-mood.ts";
import { sendResidentTo } from "./civilian-plan.ts";
import type { CityState } from "./civilian-state.ts";
import { ActivityReading, readActivity } from "./society-activity.ts";
import { newCast, societyMap, type Cast } from "./society-scenes.test-util.ts";
import { intAt, placeIn, stageResident, withoutOtherCars } from "./society.test-util.ts";

const NOON = 12;
const HOME = placeIn(societyMap, "Rowhome A1-1");
const FAR_PLACE = placeIn(societyMap, "Taco Spot");
const BODEGA = placeIn(societyMap, "Bodega Supreme");
const CROWD_SIZE = 40;
const WALKERS = 30;
/** A hazard this far from the door (m): near enough to be seen, far enough to be faced. */
const HAZARD_NEAR: readonly [number, number] = [10, 40];
/** Ticks everyone staged out at a door has left of their dwell: past every scene. */
const DWELL_TICKS = 1000;

/** The first node of the walk graph whose distance (m) from (x, z) lies in `band`: where a hazard stands for a scene at that spot. */
function hazardNodeNear(x: number, z: number, band: readonly [number, number]): number {
  const { nodeX, nodeZ } = societyMap.graph;
  for (let node = 0; node < nodeX.length; node++) {
    const distance = hypot2(nodeX[node]! - x, nodeZ[node]! - z);
    if (distance >= band[0] && distance <= band[1]) return node;
  }
  throw new Error("the fixture has no node in the band");
}

const door = societyMap.places[HOME]!;
const HAZARD = hazardNodeNear(door.doorX, door.doorZ, HAZARD_NEAR);
const hazardX = societyMap.graph.nodeX[HAZARD]!;
const hazardZ = societyMap.graph.nodeZ[HAZARD]!;

/** The people of a scene: `count` residents from the first generated, all out at the door of `place` on the stoop (so they can see), and no car of that home's to take them anywhere. */
function outAtDoor(cast: Cast, count: number, place = HOME): number[] {
  const people = Array.from({ length: count }, (_, at) => cast.resident + at);
  withoutOtherCars(cast.state, place, people);
  for (const resident of people) stageResident(cast.state, resident, { place, home: place, tick: cast.tick, nextDecision: cast.tick + DWELL_TICKS, purpose: PURPOSE.stoopSit });
  return people;
}

/** A danger at the hazard node heard at the scene's tick, run to the tick its reaction falls on (nothing before it). */
function dangerHeard(cast: Cast, node = HAZARD): number {
  queueEvents(cast.state, cast.tick, [EVENT_KIND.danger, node, cast.tick / DECISION_HZ]);
  applyReactionEvents(cast.state, cast.tick + EVENT_LEAD_TICKS - 1);
  return cast.tick + EVENT_LEAD_TICKS;
}

function alarmedOf(state: CityState, people: readonly number[], tick: number): number[] {
  return people.filter((resident) => intAt(state, resident, RESIDENT_INT.alarmTick) === tick);
}

describe("given forty people out at a door and a danger seen from a node thirty metres off, with one more at a door across the city", () => {
  const cast = newCast(NOON);
  const people = outAtDoor(cast, CROWD_SIZE);
  const [across] = outAtDoor({ ...cast, resident: cast.resident + CROWD_SIZE }, 1, FAR_PLACE) as [number];
  const { state } = cast;
  const before = dangerHeard(cast);
  const quiet = alarmedOf(state, [...people, across], before);
  applyReactionEvents(state, before);
  const alarmed = alarmedOf(state, people, before);
  const lookingOn = alarmed.filter((resident) => intAt(state, resident, RESIDENT_INT.legPurpose) === PURPOSE.lookOn);
  const wentIn = alarmed.filter((resident) => intAt(state, resident, RESIDENT_INT.legPurpose) === NEED.rest);

  it("when the reaction tick has not come, then nobody has reacted, and when it has, then most have, none across the city", () => {
    expect(hypot2(societyMap.places[FAR_PLACE]!.doorX - hazardX, societyMap.places[FAR_PLACE]!.doorZ - hazardZ), "metres from the hazard to the door across the city").toBeGreaterThan(ALARM_SIGHT);
    expect(quiet.length, "people alarmed the tick before").toBe(0);
    expect(alarmed.length, "people alarmed at the reaction tick").toBeGreaterThan(24);
    expect(alarmed.length, "people alarmed at the reaction tick").toBeLessThan(CROWD_SIZE);
    expect(intAt(state, across, RESIDENT_INT.alarmTick), "alarm tick of someone across the city").toBe(NEVER_TICK);
  });

  it("when they have reacted, then most look on where they stand, some go in, each with a line, and the hazard and nobody hurt in their row", () => {
    expect(lookingOn.length, "people looking on").toBeGreaterThan(0);
    expect(wentIn.length, "people who went in").toBeGreaterThan(0);
    expect(lookingOn.length + wentIn.length, "people who did either").toBe(alarmed.length);
    for (const resident of lookingOn) {
      expect(intAt(state, resident, RESIDENT_INT.nextDecisionTick) - before, `ticks resident ${resident} looks on`).toBe(LOOK_ON_CRASH_MINUTES * TICKS_PER_GAME_MINUTE);
      expect(intAt(state, resident, RESIDENT_INT.alarmX), "hazard x in centimetres").toBe(Math.round(hazardX * CENTIMETRES_PER_METRE));
      expect(intAt(state, resident, RESIDENT_INT.alarmZ), "hazard z in centimetres").toBe(Math.round(hazardZ * CENTIMETRES_PER_METRE));
      expect(intAt(state, resident, RESIDENT_INT.alarmVictim), "who was hurt").toBe(NO_PLACE);
      expect(historyLines(state, resident)[0], "the newest line of their log").toContain("saw trouble outside");
    }
  });

  it("when someone looking on is drawn, then they flinch at first, a step back from the hazard and facing it, then stand looking at it where they stood", () => {
    const watcher = lookingOn[0]!;
    const reading = new ActivityReading();
    const arrive = before / DECISION_HZ;
    readActivity(state, watcher, arrive, reading);
    const [startX, startZ, startYaw] = [reading.x, reading.z, reading.yaw];
    const wanted = detAtan2(hazardX - startX, hazardZ - startZ);
    expect([reading.code, reading.placed].join("/"), "activity as it begins").toBe([ACTIVITY.recoil, true].join("/"));
    expect(startYaw, "yaw as they turn to it").toBeCloseTo(wanted, 5);
    const gapBefore = hypot2(hazardX - startX, hazardZ - startZ);
    readActivity(state, watcher, arrive + ACTIVITY_SECONDS.recoil / 2, reading);
    expect(hypot2(hazardX - reading.x, hazardZ - reading.z) - gapBefore, "metres further from it at the clip's middle").toBeCloseTo(RECOIL_STEP_METRES, 2);
    readActivity(state, watcher, arrive + ACTIVITY_SECONDS.recoil + 0.1, reading);
    expect(reading.code, "activity once the flinch is over").toBe(ACTIVITY.idle);
    expect(hypot2(reading.x - startX, reading.z - startZ), "metres from where they began").toBeLessThan(0.001);
  });
});

describe("given thirty people walking out of the same door when a danger is seen from a node thirty metres off", () => {
  const cast = newCast(NOON);
  const walkers = Array.from({ length: WALKERS }, (_, at) => cast.resident + at);
  withoutOtherCars(cast.state, HOME, walkers);
  for (const resident of walkers) {
    stageResident(cast.state, resident, { place: HOME, home: HOME, tick: cast.tick });
    sendResidentTo(cast.state, resident, cast.tick, FAR_PLACE, NEED.errand, 100);
  }
  const { state } = cast;
  const reactionTick = dangerHeard(cast);
  applyReactionEvents(state, reactionTick);
  const flinchers = alarmedOf(state, walkers, reactionTick);

  it("when the reaction tick has come, then most of them are alarmed and none looks on or goes in: a walker walks on", () => {
    expect(flinchers.length, "walkers alarmed").toBeGreaterThan(15);
    for (const resident of flinchers) expect(intAt(state, resident, RESIDENT_INT.legPurpose), "what a walker is doing").toBe(NEED.errand);
  });

  it("when one is drawn at the reaction tick, then they flinch where they stand on their walk, a step back from the hazard and facing it, and are back on the walk when it is over", () => {
    const walker = flinchers[0]!;
    const reading = new ActivityReading();
    const pose = new LegPose();
    const now = reactionTick / DECISION_HZ;
    legPose(state, walker, now + ACTIVITY_SECONDS.recoil / 2, pose);
    const [onX, onZ] = [pose.x, pose.z];
    readActivity(state, walker, now + ACTIVITY_SECONDS.recoil / 2, reading);
    expect([reading.code, reading.placed].join("/"), "activity at the clip's middle").toBe([ACTIVITY.recoil, true].join("/"));
    expect(hypot2(reading.x - onX, reading.z - onZ), "metres off the walk at the clip's middle").toBeCloseTo(RECOIL_STEP_METRES, 2);
    expect(hypot2(hazardX - reading.x, hazardZ - reading.z) - hypot2(hazardX - onX, hazardZ - onZ), "metres further from the hazard").toBeGreaterThan(0.4);
    readActivity(state, walker, now + ACTIVITY_SECONDS.recoil + 0.1, reading);
    expect([reading.code, reading.placed].join("/"), "activity once it is over").toBe([ACTIVITY.none, false].join("/"));
  });
});

/** A person at the door of `HOME` run down by a car at the scene's tick, nine more out on the stoop; the knock applied and the call due `delay` ticks on. */
function knockAndCall(withWitnesses: boolean): { cast: Cast; victim: number; people: number[]; due: number } {
  const cast = newCast(NOON);
  const victim = cast.resident + CROWD_SIZE;
  const people = withWitnesses ? outAtDoor(cast, 9) : [];
  stageResident(cast.state, victim, { place: HOME, home: HOME, tick: cast.tick, nextDecision: cast.tick + DWELL_TICKS });
  queueEvents(cast.state, cast.tick, [EVENT_KIND.knock, victim, cast.tick / DECISION_HZ]);
  applyIndividualEvents(cast.state, cast.tick);
  return { cast, victim, people, due: cast.tick + AMBULANCE_DELAY_SECONDS * DECISION_HZ };
}

describe("given someone run down at a door with nine people out at it, and the call for an ambulance twelve ticks on", () => {
  const { cast, victim, people, due } = knockAndCall(true);
  const { state } = cast;
  const calledAt = due + EVENT_LEAD_TICKS;
  queueEvents(state, due, [EVENT_KIND.ambulance, victim, due / DECISION_HZ]);
  applyReactionEvents(state, calledAt - 1);
  const noneYet = people.filter((resident) => intAt(state, resident, RESIDENT_INT.legPurpose) === PURPOSE.callAmbulance).length;
  const stillOut = people.filter((resident) => intAt(state, resident, RESIDENT_INT.legPurpose) === PURPOSE.stoopSit || intAt(state, resident, RESIDENT_INT.legPurpose) === PURPOSE.lookOn);
  applyReactionEvents(state, calledAt);
  const callers = people.filter((resident) => intAt(state, resident, RESIDENT_INT.legPurpose) === PURPOSE.callAmbulance);

  it("when the call is made, then one of those still out is on the phone from the reaction tick, with a line saying who it is for, and the rest are not", () => {
    expect(noneYet, "people on the phone the tick before").toBe(0);
    expect(callers.length, "people on the phone").toBe(1);
    expect(stillOut.length, "people still out when the call is made (the knock sent some in)").toBeGreaterThan(0);
    expect(callers[0], "who it is: all who are out stand at one door, so the lowest of them").toBe(stillOut[0]);
    expect(historyLines(state, callers[0]!)[0], "the newest line of their log").toContain("called an ambulance for ");
    expect(intAt(state, callers[0]!, RESIDENT_INT.nextDecisionTick) - calledAt, "ticks on the phone").toBe(CALL_MINUTES * TICKS_PER_GAME_MINUTE);
  });

  it("when the caller is drawn, then they stand on the phone, glancing at who is down", () => {
    const reading = new ActivityReading();
    readActivity(state, callers[0]!, calledAt / DECISION_HZ + 1, reading);
    expect([reading.code, reading.placed, reading.partner].join("/"), "activity, placed, who they look at").toBe([ACTIVITY.phoneCall, true, victim].join("/"));
  });

  it("when the call is for someone not hurt, or nobody is out to make it, then nobody is on the phone", () => {
    const quiet = knockAndCall(false);
    queueEvents(quiet.cast.state, quiet.due, [EVENT_KIND.ambulance, quiet.victim, quiet.due / DECISION_HZ]);
    applyReactionEvents(quiet.cast.state, quiet.due + EVENT_LEAD_TICKS);
    let phoning = 0;
    for (let resident = 0; resident < quiet.cast.state.capacity; resident++) if (intAt(quiet.cast.state, resident, RESIDENT_INT.legPurpose) === PURPOSE.callAmbulance) phoning++;
    expect(phoning, "people on the phone with nobody out").toBe(0);
    const unhurt = newCast(NOON);
    const bystanders = outAtDoor(unhurt, 3);
    const down = unhurt.resident + CROWD_SIZE;
    stageResident(unhurt.state, down, { place: HOME, home: HOME, tick: unhurt.tick, nextDecision: unhurt.tick + DWELL_TICKS });
    queueEvents(unhurt.state, unhurt.tick, [EVENT_KIND.ambulance, down, unhurt.tick / DECISION_HZ]);
    applyReactionEvents(unhurt.state, unhurt.tick + EVENT_LEAD_TICKS);
    expect(bystanders.filter((resident) => intAt(unhurt.state, resident, RESIDENT_INT.legPurpose) === PURPOSE.callAmbulance).length, "people on the phone for someone who is not down").toBe(0);
    expect(intAt(unhurt.state, down, RESIDENT_INT.flags) & FLAG.hurt, "hurt flag of the one called for").toBe(0);
  });
});

describe("given someone run down at a door with nine people out at it", () => {
  const { cast, victim, people } = knockAndCall(true);
  const { state } = cast;
  const reactionTick = cast.tick + EVENT_LEAD_TICKS;
  applyReactionEvents(state, reactionTick);
  const watchers = alarmedOf(state, people, reactionTick).filter((resident) => intAt(state, resident, RESIDENT_INT.legPurpose) === PURPOSE.lookOn);

  it("when the reaction tick has come, then those who look on do so until the ambulance has gone, and look at who is down", () => {
    expect(watchers.length, "people looking on").toBeGreaterThan(0);
    const reading = new ActivityReading();
    for (const resident of watchers) {
      expect(intAt(state, resident, RESIDENT_INT.nextDecisionTick) - reactionTick, "ticks they look on").toBe(LOOK_ON_DOWNED_MINUTES * TICKS_PER_GAME_MINUTE);
      expect(intAt(state, resident, RESIDENT_INT.alarmVictim), "who was hurt").toBe(victim);
      readActivity(state, resident, reactionTick / DECISION_HZ + 0.1, reading);
      expect(reading.partner, "who they look at").toBe(victim);
    }
  });
});

describe("given a crash at the bodega, and events the society cannot place", () => {
  it("when it is seen from the bodega's door, then people out there react at the reaction tick", () => {
    const cast = newCast(NOON);
    const people = outAtDoor(cast, CROWD_SIZE, BODEGA);
    queueEvents(cast.state, cast.tick, [EVENT_KIND.wreck, BODEGA, cast.tick / DECISION_HZ]);
    applyReactionEvents(cast.state, cast.tick + EVENT_LEAD_TICKS - 1);
    expect(alarmedOf(cast.state, people, cast.tick + EVENT_LEAD_TICKS).length, "people alarmed the tick before").toBe(0);
    applyReactionEvents(cast.state, cast.tick + EVENT_LEAD_TICKS);
    expect(alarmedOf(cast.state, people, cast.tick + EVENT_LEAD_TICKS).length, "people alarmed at the reaction tick").toBeGreaterThan(24);
  });

  it("when a danger names a node the map does not have, or an ambulance a resident it does not have, then nothing is queued", () => {
    const cast = newCast(NOON);
    queueEvents(cast.state, cast.tick, [EVENT_KIND.danger, cast.state.index.nodeCount, 1, EVENT_KIND.ambulance, cast.state.capacity, 1]);
    expect(cast.state.events.length, "events queued").toBe(0);
  });
});
