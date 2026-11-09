import { describe, expect, it } from "vitest";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { CRIME_KIND, CRIME_LAG_TICKS, EVENT_KIND, EVENT_LEAD_TICKS, FLAG, JAIL_TICKS, NEVER_TICK, PURPOSE, RESIDENT_INT, RESIDENT_INT_STRIDE, WANTED_TICKS } from "./civilian-constants.ts";
import { ACTIVITY } from "./civilian-activity.ts";
import { applyIndividualEvents, applyReactionEvents, queueEvents } from "./civilian-events.ts";
import { historyLines, moodOf } from "./civilian-mood.ts";
import { EVENT_CODE, MOOD } from "./civilian-names.ts";
import { runTicks, stateDigest } from "./civilian-run.test-util.ts";
import { decideResident } from "./civilian-plan.ts";
import { ActivityReading, readActivity } from "./society-activity.ts";
import { CrimeDesk, crimeOf, isWanted } from "./society-crime.ts";
import { expireWanted } from "./society-reactions.ts";
import { newCast, societyMap, type Cast } from "./society-scenes.test-util.ts";
import { intAt, placeIn, stageResident } from "./society.test-util.ts";

const NOON = 12;
const BODEGA = placeIn(societyMap, PLACE_NAMES.bodega);
const HOME_A1 = placeIn(societyMap, "Rowhome A1-1");
const HOME_A1_NEXT = placeIn(societyMap, "Rowhome A1-2");
/** A crime scene: the criminal dwelling at the bodega with the crime due in `CRIME_LAG_TICKS`, a clerk at home, and the dwelling that ends well after the event lands. */
const CRIME_DWELL = 30;

function crimeScene(): Cast {
  const cast = newCast(NOON);
  const { state, tick } = cast;
  state.headcount[BODEGA] = 1;
  stageResident(state, cast.resident, { place: BODEGA, home: HOME_A1, tick, nextDecision: tick + CRIME_DWELL, flags: FLAG.criminal, purpose: PURPOSE.shoplift });
  stageResident(state, cast.neighbour, { place: HOME_A1_NEXT, tick, work: BODEGA, nextDecision: tick + 1000 });
  return cast;
}

function sinceCrimeDue(cast: Cast): number {
  return cast.tick + CRIME_LAG_TICKS;
}

/** The host raises the crime when it is due: posted at `post` with the tick it happened at, the one it was due. */
function raiseCrime(cast: Cast, post: number): void {
  const happened = sinceCrimeDue(cast);
  queueEvents(cast.state, post, [EVENT_KIND.crime, cast.resident, happened / 2]);
}

describe("given a criminal at a shop and the host's desk", () => {
  it("when the lag after arriving has passed, then the crime is due once, and the brain commits nothing until the host raises it", () => {
    const cast = crimeScene();
    const desk = new CrimeDesk(cast.state.capacity);
    const due = new Int32Array(cast.state.capacity);
    expect(desk.collect(cast.state, sinceCrimeDue(cast) - 1, due), "due crimes the tick before the lag").toBe(0);
    expect(desk.collect(cast.state, sinceCrimeDue(cast), due), "due crimes at the lag").toBe(1);
    expect(due[0], "who is due").toBe(cast.resident);
    expect(desk.collect(cast.state, sinceCrimeDue(cast) + 1, due), "due crimes a tick later, after it was listed").toBe(0);
    applyIndividualEvents(cast.state, sinceCrimeDue(cast) + EVENT_LEAD_TICKS);
    applyReactionEvents(cast.state, sinceCrimeDue(cast) + EVENT_LEAD_TICKS);
    expect(crimeOf(cast.state, cast.resident), "an open crime with no event").toBeNull();
  });

  it("when the victim of a mugging has gone in, then there is nothing due, and when they are out on their stoop it is", () => {
    const cast = crimeScene();
    const { state, resident, victim } = cast;
    stageResident(state, resident, { place: HOME_A1_NEXT, home: HOME_A1, tick: cast.tick, nextDecision: cast.tick + CRIME_DWELL, flags: FLAG.criminal, purpose: PURPOSE.mug });
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.crimeVictim] = victim;
    const due = new Int32Array(state.capacity);
    stageResident(state, victim, { place: HOME_A1_NEXT, tick: cast.tick, nextDecision: cast.tick + 1000 });
    expect(new CrimeDesk(state.capacity).collect(state, sinceCrimeDue(cast), due), "due while the victim is indoors").toBe(0);
    stageResident(state, victim, { place: HOME_A1_NEXT, tick: cast.tick, nextDecision: cast.tick + 1000, purpose: PURPOSE.stoopSit });
    expect(new CrimeDesk(state.capacity).collect(state, sinceCrimeDue(cast), due), "due while the victim is out on their stoop").toBe(1);
  });
});

describe("given the host raises a crime four ticks after it happened", () => {
  const cast = crimeScene();
  const { state, resident } = cast;
  const happened = sinceCrimeDue(cast);
  raiseCrime(cast, happened + 4);

  it("when its own tick comes, then the criminal is wanted for a game day from the tick it happened, and not before", () => {
    applyIndividualEvents(state, happened + 3);
    expect(crimeOf(state, resident), "crime before the post lands").toBeNull();
    applyIndividualEvents(state, happened + 4);
    const crime = crimeOf(state, resident)!;
    expect(crime.tick, "tick the crime began").toBe(happened);
    expect(crime.kind, "kind of crime").toBe(CRIME_KIND.theft);
    expect(crime.place, "place of the crime").toBe(BODEGA);
    expect(isWanted(state, resident, happened + 5), "wanted just after").toBe(true);
    expect(isWanted(state, resident, happened + WANTED_TICKS), "wanted when the game day is up").toBe(false);
    expect(historyLines(state, resident)[0], "the criminal's newest line").toBe("lifted something from Bodega Supreme");
  });

  it("when the reaction tick comes, then the corner is feared and the shop's clerk is angry, and not before", () => {
    const door = societyMap.places[BODEGA]!.doorNode;
    applyReactionEvents(state, happened + EVENT_LEAD_TICKS - 1);
    expect(state.fear[door], "fear at the shop's door the tick before").toBe(0);
    applyReactionEvents(state, happened + EVENT_LEAD_TICKS);
    expect(state.fear[door], "fear at the shop's door").toBeGreaterThan(0.5);
    expect(historyLines(state, cast.neighbour)[0], "the clerk's newest line").toBe("Bodega Supreme was robbed");
    expect(moodOf(state, cast.neighbour, happened + EVENT_LEAD_TICKS + 1), "the clerk's mood").toBe(MOOD.angry);
  });

  it("when a game day has passed, then the wanted spell is over and the open crime with it", () => {
    expireWanted(state, happened + WANTED_TICKS - 1);
    expect(crimeOf(state, resident), "open crime the tick before").not.toBeNull();
    expireWanted(state, happened + WANTED_TICKS);
    expect(crimeOf(state, resident), "open crime when the day is up").toBeNull();
    expect(intAt(state, resident, RESIDENT_INT.flags) & FLAG.wanted, "wanted flag when the day is up").toBe(0);
  });
});

describe("given a crime heard by a host at the tick it happened and by a peer ten ticks later", () => {
  it("when both have run past the reaction, then their states are the same", () => {
    const hostScene = crimeScene();
    const peerScene = crimeScene();
    const happened = sinceCrimeDue(hostScene);
    raiseCrime(hostScene, happened);
    for (let tick = happened - 1; tick < happened + 40; tick++) {
      if (tick === happened + 10) raiseCrime(peerScene, tick);
      for (const scene of [hostScene, peerScene]) {
        applyIndividualEvents(scene.state, tick);
        applyReactionEvents(scene.state, tick);
      }
    }
    expect(stateDigest(peerScene.state), "state of the late peer past the reaction").toBe(stateDigest(hostScene.state));
    expect(crimeOf(peerScene.state, peerScene.resident), "the crime reached the peer").not.toBeNull();
  });
});

describe("given a wanted criminal busted by the police", () => {
  const cast = crimeScene();
  const { state, resident } = cast;
  const happened = sinceCrimeDue(cast);
  raiseCrime(cast, happened + 4);
  applyIndividualEvents(state, happened + 4);
  const bustAt = happened + 8;
  queueEvents(state, bustAt, [EVENT_KIND.bust, resident, bustAt / 2]);

  it("when the bust is queued, then they are off the street at once for the jail's length", () => {
    expect(state.hiddenFromTick[resident], "tick they leave the street").toBe(bustAt);
    expect(state.hiddenUntilTick[resident], "tick they are back").toBe(bustAt + JAIL_TICKS);
  });

  it("when its tick comes, then they are in custody, no longer wanted, the crime cleared, until the jail time is up, and then home with a line saying so", () => {
    applyIndividualEvents(state, bustAt);
    expect(intAt(state, resident, RESIDENT_INT.flags) & FLAG.custody, "custody flag").toBe(FLAG.custody);
    expect(intAt(state, resident, RESIDENT_INT.flags) & FLAG.wanted, "wanted flag").toBe(0);
    expect(intAt(state, resident, RESIDENT_INT.crimeTick), "crime tick").toBe(NEVER_TICK);
    expect(intAt(state, resident, RESIDENT_INT.nextDecisionTick), "tick they are let out").toBe(bustAt + JAIL_TICKS);
    expect(historyLines(state, resident)[0], "the newest line").toBe("was arrested outside Bodega Supreme");
    decideResident(state, resident, bustAt + JAIL_TICKS);
    expect(intAt(state, resident, RESIDENT_INT.flags) & FLAG.custody, "custody flag after the release").toBe(0);
    expect(historyLines(state, resident), "lines after the release").toContain("was let out of custody");
  });
});

describe("given a bust raised for someone who is not wanted", () => {
  it("when its tick comes, then nothing happens to them and they are back on the street", () => {
    const cast = newCast(NOON);
    const { state, resident } = cast;
    stageResident(state, resident, { place: HOME_A1, tick: cast.tick });
    queueEvents(state, cast.tick, [EVENT_KIND.bust, resident, cast.tick / 2]);
    expect(state.hiddenFromTick[resident], "tick they were hidden from while the bust is queued").toBe(cast.tick);
    applyIndividualEvents(state, cast.tick);
    expect(state.hiddenFromTick[resident], "tick they are hidden from after").toBe(NEVER_TICK);
    expect(intAt(state, resident, RESIDENT_INT.flags) & FLAG.custody, "custody flag").toBe(0);
  });
});

/** The share of `pushes` pushes between two residents at a door that became a fight, the pair calm or angry. */
function fightShare(pushes: number, angry: boolean): number {
  const cast = newCast(NOON);
  const { state, resident, neighbour } = cast;
  let fights = 0;
  for (let push = 0; push < pushes; push++) {
    const tick = cast.tick + 4 * push;
    for (const person of [resident, neighbour]) stageResident(state, person, { place: HOME_A1, tick, moodEvent: angry ? EVENT_CODE.stoopWrecked : 0 });
    state.events.length = 0;
    queueEvents(state, tick, [EVENT_KIND.push, resident, tick / 2, EVENT_KIND.alongside, neighbour, tick / 2]);
    applyReactionEvents(state, tick + EVENT_LEAD_TICKS);
    if (intAt(state, resident, RESIDENT_INT.fightTick) !== NEVER_TICK) fights++;
  }
  return fights / pushes;
}

describe("given pushes between two residents, and a day of the city with none", () => {
  const PUSHES = 400;

  it("when 400 pushes between calm residents are rolled, then about an eighth of them become a fight", () => {
    const share = fightShare(PUSHES, false);
    expect(share, "share that became a fight").toBeGreaterThan(0.06);
    expect(share, "share that became a fight").toBeLessThan(0.2);
  });

  it("when the same pushes are between angry residents, then about half of them do", () => {
    const share = fightShare(PUSHES, true);
    expect(share, "share that became a fight").toBeGreaterThan(0.35);
    expect(share, "share that became a fight").toBeLessThan(0.6);
  });

  it("when a city lives a game day and a half with no push, knock or fight raised, then nobody is in a fight", () => {
    const state = newCast(NOON).state;
    runTicks(state, 3600);
    let fighters = 0;
    for (let resident = 0; resident < state.capacity; resident++) if (intAt(state, resident, RESIDENT_INT.fightTick) !== NEVER_TICK) fighters++;
    expect(fighters, "residents in a fight").toBe(0);
  });
});

describe("given the host raises a fight between two residents at a door", () => {
  const cast = newCast(NOON);
  const { state, resident, neighbour } = cast;
  for (const person of [resident, neighbour]) stageResident(state, person, { place: HOME_A1, tick: cast.tick });
  queueEvents(state, cast.tick, [EVENT_KIND.fight, neighbour, cast.tick / 2, EVENT_KIND.alongside, resident, cast.tick / 2]);
  const at = cast.tick + EVENT_LEAD_TICKS;
  applyReactionEvents(state, at);

  it("when its reaction tick comes, then both are in it, each with the other, both wanted for it, and the activity codes are a fight's", () => {
    for (const [fighter, other] of [[resident, neighbour], [neighbour, resident]]) {
      expect(intAt(state, fighter!, RESIDENT_INT.fightPartner), "who they fight").toBe(other);
      expect(intAt(state, fighter!, RESIDENT_INT.legPurpose), "what they are doing").toBe(PURPOSE.fight);
      expect(intAt(state, fighter!, RESIDENT_INT.flags) & FLAG.wanted, "wanted for assault").toBe(FLAG.wanted);
      expect(intAt(state, fighter!, RESIDENT_INT.fightTick), "tick the fight began").toBe(at);
    }
  });

  it("when they are drawn a moment into it, then the one who started swings, the other is hit, a metre apart", () => {
    const first = new ActivityReading();
    const second = new ActivityReading();
    readActivity(state, resident, at / 2 + 0.3, first);
    readActivity(state, neighbour, at / 2 + 0.3, second);
    expect(first.code, "the starter's activity").toBe(ACTIVITY.swing);
    expect(second.code, "the other's activity").toBe(ACTIVITY.hit);
    expect(first.placed && second.placed, "the brain places both").toBe(true);
    expect(Math.hypot(first.x - second.x, first.z - second.z), "metres between them").toBeCloseTo(1, 3);
  });

  it("when one is busted, then the other is let go of the fight", () => {
    queueEvents(state, at, [EVENT_KIND.bust, resident, at / 2]);
    applyIndividualEvents(state, at);
    applyReactionEvents(state, at + EVENT_LEAD_TICKS);
    expect(intAt(state, resident, RESIDENT_INT.flags) & FLAG.custody, "the busted one's custody flag").toBe(FLAG.custody);
    expect(intAt(state, neighbour, RESIDENT_INT.fightTick), "the other's fight tick").toBe(NEVER_TICK);
  });
});

describe("given a crime at the bodega with sixteen people out at doors a short walk away", () => {
  const cast = crimeScene();
  const { state } = cast;
  const witnesses = Array.from({ length: 16 }, (_, at) => cast.resident + 3 + at);
  for (const witness of witnesses) stageResident(state, witness, { place: HOME_A1, tick: cast.tick, nextDecision: cast.tick + 1000, purpose: PURPOSE.stoopSit });
  const happened = sinceCrimeDue(cast);
  raiseCrime(cast, happened);
  applyIndividualEvents(state, happened);
  applyReactionEvents(state, happened + EVENT_LEAD_TICKS);

  it("when the reaction tick has come, then some of them report it, the rest run for home, and nobody does neither", () => {
    const reported = witnesses.filter((witness) => intAt(state, witness, RESIDENT_INT.legPurpose) === PURPOSE.report);
    const fled = witnesses.filter((witness) => historyLines(state, witness)[0]!.startsWith("ran home from trouble"));
    expect(reported.length, "witnesses who reported").toBeGreaterThan(0);
    expect(fled.length, "witnesses who ran home").toBeGreaterThan(0);
    expect(reported.length + fled.length, "witnesses who did either").toBe(witnesses.length);
  });
});
