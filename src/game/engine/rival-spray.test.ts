import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { NO_CAR_PICK, SPRAY_PALETTE } from "../match/look-data.ts";
import { CAR_SPRAY } from "../vehicle/spray-box.ts";
import type { HighlightClip } from "../match/highlights.ts";
import { readRace, writeRace } from "../net/codec.ts";
import { encodeSaved } from "../net/reel-codec.ts";
import { lookColours } from "../present/car-look.ts";
import { RivalLooks } from "../present/rival-look.ts";
import { BARE_SPRAY } from "../present/spray.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { setGround } from "../world/ground.ts";
import { assertSameDigest } from "../vehicle/test-support.ts";
import { recordFlat, type Spawn } from "./replay-fidelity.test-util.ts";
import { TRAFFIC_NAME } from "./engine-race-field.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { rivalSeedOf } from "./rival-seed.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

/**
 * AI opponents wear rival sprays (docs/CINEMATIC.md, driver looks): through the real engine, race, campaign, netplay client, derby and
 * saved clip, a car's worn spray is read off the paint's own shader hook, the way the renderer would sample it.
 */

/** A saved clip that never reaches the highlight player ends its row here and not the run: no deadline waits for it, only this guard. */
const HANG_GUARD_MS = 30_000;
/** The race the rows run: AI racers on car 1-3, the player on car 0, traffic and police cars after them. */
const AI_COUNT = 3;
const AI_SLOTS = [1, 2, 3];
const RACERS = AI_COUNT + 1;
/** The car a netplay peer sits in during the derby row. */
const PEER_SLOT = 2;
/** The garage can's palette index the player's own spray is filled with. */
const OWN_INK = 4;
/** Longest a campaign round races before its order must have changed from the grid's (seconds of sim). */
const MAX_RACING_SECONDS = 120;
/** The saved clip's cars (x, z, heading in rad, m/s): a head-on between cars 0 and 1 with car 2 idle 1.9 m beside their line. */
const HEAD_ON: Spawn[] = [
  { x: 0, z: 0, yaw: Math.PI / 2, speed: 20, throttle: 1 },
  { x: 80, z: 0, yaw: -Math.PI / 2, speed: 20, throttle: 1 },
  { x: 40, z: 1.9, yaw: Math.PI / 2, speed: 0, throttle: 0 },
];
/** The look seed the saved clip carries: the racer's rival spray is drawn from it, not from the engine's own field. */
const CLIP_LOOK = 0x5eed1234;

const rivalsOracle = new RivalLooks();

/**
 * A spray's identity: the digest of its texels (a failed compare of two 256 KiB arrays prints a diff that eats the machine).
 * Premultiplied rgba, hashed as the bitmap holds it.
 */
const digestOf = (texels: Uint8Array): string => createHash("sha1").update(texels).digest("hex");

/** Car `car`'s worn spray texture, or null while its paint samples no spray (never worn, or the bare 1 x 1). */
function wornMap(car: DeformableCar): THREE.DataTexture | null {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "", fragmentShader: "" };
  car.lookMeshes().bodyPaint.onBeforeCompile(shader as never, undefined as never);
  const map = shader.uniforms.sprayMap?.value as THREE.DataTexture | undefined;
  return map === undefined || map === BARE_SPRAY ? null : map;
}

/** Car `car`'s worn spray digest, or null while it wears none. */
const sprayOn = (car: DeformableCar): string | null => {
  const map = wornMap(car);
  return map === null ? null : digestOf(map.image.data as Uint8Array);
};

/** The rival spray `seed` draws on `car` in `slot`, by a `RivalLooks` of the test's own. */
function rivalSprayOf(seed: number, slot: number, car: DeformableCar): string {
  return digestOf(rivalsOracle.of(seed, slot, lookColours(car, NO_CAR_PICK).body).rgba);
}

describe("given pure seeds for a derby and a race", () => {
  const race = { rivalSeed: (slot: number): number | null => (slot === 1 ? 77 : null) };
  const seated = new Set([2]);

  it("when no derby is on, then the race decides: its seed for an AI racer, none for the rest", () => {
    expect(rivalSeedOf(1, race, null)).toBe(77);
    expect(rivalSeedOf(0, race, null)).toBe(null);
  });

  it("when a derby is on, then every car but a seated peer's wears the derby's round, whatever the race says", () => {
    expect(rivalSeedOf(0, race, { round: 5, seated })).toBe(5);
    expect(rivalSeedOf(1, race, { round: 5, seated })).toBe(5);
    expect(rivalSeedOf(3, race, { round: 5, seated })).toBe(5);
    expect(rivalSeedOf(2, race, { round: 5, seated })).toBe(null);
  });
});

describe("given the real engine headless", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`. The rows run in order on it.
  let engine: CrashEngine;
  let recorded: HighlightClip;
  let savedText: string;
  const store = new Map<string, string>();
  const cars = (): DeformableCar[] => engine["live"]();
  const race = () => engine["race"];
  const wornBy = (slots: readonly number[]): (string | null)[] => slots.map((slot) => sprayOn(cars()[slot]!));
  /** The player's own spray (its garage bitmap) as it is now: its digest. */
  const ownDigest = (): string => digestOf(engine["looks"].mine.carSpray.rgba);
  /** The garage bitmap filled with `OWN_INK`: its digest. */
  const ownSpray = (): string => {
    const mine = engine["looks"].mine.carSpray;
    mine.load({ texels: new Uint8Array(mine.texels.length).fill(OWN_INK), palette: SPRAY_PALETTE });
    return digestOf(mine.rgba);
  };
  /** Resolves when the engine hands the saved clip, once decoded, to the highlight player (`viewSaved`), which then holds it as the solo view. */
  const viewSavedAsked = (): Promise<void> =>
    new Promise((resolve) => {
      const highlights = engine["highlights"];
      const viewSaved = highlights.viewSaved.bind(highlights);
      highlights.viewSaved = (clip, now, back, passes) => {
        Reflect.deleteProperty(highlights, "viewSaved");
        viewSaved(clip, now, back, passes);
        resolve();
      };
    });
  const startSingle = (): void => {
    engine.raceCommand({ type: "options", options: { trackId: "city", aiCount: AI_COUNT, laps: 1, police: true, campaign: ["oval", "rally"] } });
    engine.raceCommand({ type: "start" });
  };
  /** Every AI racer's worn spray is its seed's rival spray. */
  const assertRivals = (seed: number, why: string): void => {
    for (const slot of AI_SLOTS) {
      const worn = sprayOn(cars()[slot]!);
      expect(worn, `${why}: car ${slot} wears a spray`).not.toBe(null);
      expect(worn, `${why}: car ${slot} wears its rival look`).toBe(rivalSprayOf(seed, slot, cars()[slot]!));
    }
  };

  beforeAll(async () => {
    // The crash is recorded on a flat field before the engine boots: a race's ground would tilt it out of the highlight ranking.
    setGround(null);
    recorded = recordFlat(HEAD_ON, 8, true).clip;
    // Filed on the oval under a look of its own; the bystander's name is the one a clip gives a car that is no racer.
    savedText = await encodeSaved({ ...recorded, trackId: "oval", look: CLIP_LOOK, cars: recorded.cars.map((c) => (c.slot === 2 ? { ...c, name: TRAFFIC_NAME } : c)) });
    stubBrowser();
    globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) } as Storage;
    engine = await bootEngine({ pacer: true });
  });
  afterAll(() => {
    engine.dispose();
    rivalsOracle.dispose();
    setGround(null);
  });

  it("when a single race starts, then every AI racer wears the rival spray of the field's look, and the player's car, the traffic and the police wear none", () => {
    engine.toggleRace();
    startSingle();
    runSeconds(engine, 1);
    expect(cars().length, "the city has traffic or police past the racers").toBeGreaterThan(RACERS);
    assertRivals(race().look, "single race");
    expect(sprayOn(cars()[0]!), "the player's car wears its own (blank) garage spray, no rival's").toBe(ownDigest());
    for (let slot = RACERS; slot < cars().length; slot++) expect(sprayOn(cars()[slot]!), `car ${slot} (traffic or police) stays bare`).toBe(null);
  });

  it("when the player has a garage spray and a race starts, then it stays on car 0 byte for byte while the opponents wear rival sprays, even when car 0 is itself an AI racer (spectating)", () => {
    const own = ownSpray();
    engine.raceCommand({ type: "start" });
    runSeconds(engine, 1);
    expect(sprayOn(cars()[0]!), "the player's own spray is on car 0").toBe(own);
    assertRivals(race().look, "after the player's spray");
    engine.raceCommand({ type: "options", options: { spectate: true } });
    engine.raceCommand({ type: "start" });
    runSeconds(engine, 1);
    expect(race()["entrants"][0]?.kind, "car 0 is an AI racer in a spectated race").toBe("ai");
    expect(sprayOn(cars()[0]!), "the player's own spray still wins on car 0").toBe(own);
    engine.raceCommand({ type: "options", options: { spectate: false } });
    engine["looks"].mine.carSpray.load(null);
  });

  it("when a campaign's first round ends and the next starts, then every car index wears the same spray as in round one on a reshuffled grid; a retry keeps them and a new field changes them", () => {
    engine.raceCommand({ type: "campaign" });
    const look = race().look;
    const firstGrid = [...race()["grid"]];
    for (let second = 0; second < MAX_RACING_SECONDS && race().hud().standings.every((row, place) => row.id === firstGrid[place]); second++) runSeconds(engine, 1);
    expect(race().hud().standings.map((row) => row.id).join(","), "the field's order changed on the road").not.toBe(firstGrid.join(","));
    const roundOne = wornBy(AI_SLOTS);
    assertRivals(look, "campaign round one");
    engine.raceCommand({ type: "end" });
    engine.raceCommand({ type: "next" });
    expect(race().menu, "the round is scored").toBe("standings");
    engine.raceCommand({ type: "next" });
    expect(race().menu, "round two is racing").toBe(null);
    expect(race()["grid"].join(","), "the grid reordered by the standings").not.toBe(firstGrid.join(","));
    expect(race().look, "the field's look is the campaign's").toBe(look);
    assertSameDigest(wornBy(AI_SLOTS), roundOne, "round two's opponents wear what they wore in round one");
    engine.raceCommand({ type: "retry" });
    assertSameDigest(wornBy(AI_SLOTS), roundOne, "a retry keeps them");
    engine.raceCommand({ type: "quit" });
    engine.raceCommand({ type: "start" });
    expect(race().look, "a new field rolls a new look").not.toBe(look);
    expect(wornBy(AI_SLOTS).join("|"), "and the opponents change with it").not.toBe(roundOne.join("|"));
  });

  it("when the race is left, then every car is bare again", () => {
    runSeconds(engine, 1);
    expect(wornBy(AI_SLOTS).every((spray) => spray !== null), "worn in the race").toBeTruthy();
    engine.toggleRace();
    expect(race().active).toBe(false);
    expect(wornBy(AI_SLOTS).every((spray) => spray === null), "bare in the fleet").toBeTruthy();
  });

  it("when the FX tier rises to High during a race and falls back, then the opponents' sprays are redrawn at the garage's size once, keep that size at the lower tier, each the oracle's, and the player's car keeps its own", () => {
    engine.toggleRace();
    startSingle();
    runSeconds(engine, 1);
    const own = ownDigest();
    const sides = (): string => AI_SLOTS.map((slot) => wornMap(cars()[slot]!)?.image.width).join(",");
    const sidesOf = (width: number): string => AI_SLOTS.map(() => width).join(",");
    expect(sides(), "128 a side at Minimal").toBe(sidesOf(128));
    // The Sky setting off, so the High tier fetches no sky texture (the headless page has none to give).
    engine.setSky("off");
    try {
      engine["cine"].setTier("high");
      rivalsOracle.useTier("high", "desktop");
      runSeconds(engine, 0.1);
      expect(sides(), "the garage's 256 a side at High").toBe(sidesOf(CAR_SPRAY.w));
      assertRivals(race().look, "at High");
      expect(sprayOn(cars()[0]!), "the player's own spray is as it was").toBe(own);
    } finally {
      engine["cine"].setTier("minimal");
    }
    runSeconds(engine, 0.1);
    expect(sides(), "the finer size is kept after the fall: no redraw on a step down").toBe(sidesOf(CAR_SPRAY.w));
    assertRivals(race().look, "after falling back");
    expect(sprayOn(cars()[0]!), "the player's own spray is still as it was").toBe(own);
    engine.toggleRace();
  });

  it("when a netplay client adopts the host's race state, then its AI racers wear the host's sprays on a fresh snapshot, and the player's car and the peers' stay bare", () => {
    engine.toggleRace();
    startSingle();
    runSeconds(engine, 1);
    const hostLook = race().look;
    const host = wornBy(AI_SLOTS);
    assertRivals(hostLook, "host");
    const wire = readRace(writeRace({ lobby: null, trackId: "city", look: hostLook, gate: null, next: null, snap: race().snapshot() }));
    must(wire?.snap, "the host's race state passes the client's checks");
    engine.raceCommand({ type: "quit" });
    expect(wornBy(AI_SLOTS).every((spray) => spray === null), "the client's setup field is bare").toBeTruthy();
    expect(race().look, "the client's own field has its own look").not.toBe(hostLook);
    race().look = wire.look;
    race().applySnapshot(wire.snap, RACERS + 1);
    assertSameDigest(wornBy(AI_SLOTS), host, "the client's opponents wear the host's sprays");
    expect(sprayOn(cars()[0]!), "the host's player is a peer here: no rival spray").toBe(ownDigest());
    engine.toggleRace();
  });

  it("when a derby begins with a peer seated on a car and the player has a garage spray, then the other AI cars wear the round's rival sprays and the player's car and the peer's do not", () => {
    const own = ownSpray();
    engine["netSeats"] = new Map([[PEER_SLOT, "Zed"]]);
    engine["ensureCars"](RACERS);
    engine.toggleDerby();
    const round = engine["derbyRound"];
    for (const slot of [1, 3]) expect(sprayOn(cars()[slot]!), `derby car ${slot} wears round ${round}'s rival look`).toBe(rivalSprayOf(round, slot, cars()[slot]!));
    expect(sprayOn(cars()[PEER_SLOT]!), "the seated peer's car wears nothing of ours").toBe(null);
    expect(sprayOn(cars()[0]!), "the player's own spray wins on car 0").toBe(own);
    engine["looks"].mine.carSpray.load(null);
  });

  it("when a client adopts the host's derby round, then its AI cars are re-dressed to that round's rival sprays, and leaving the derby makes them bare", () => {
    const state = engine["derbyNetState"]()!;
    const hostRound = state.round;
    const host = wornBy([1, 3]);
    engine["netSeats"] = new Map();
    engine.toggleDerby();
    engine.toggleDerby();
    expect(engine["derbyRound"], "the client's own derby is a round on").not.toBe(hostRound);
    expect(wornBy([1, 3]).join("|"), "and its cars wear that round's sprays").not.toBe(host.join("|"));
    engine["applyNetDerby"](state, -1);
    expect(engine["derbyRound"]).toBe(hostRound);
    assertSameDigest(wornBy([1, 3]), host, "the client's AI cars wear the host's round");
    engine.toggleDerby();
    expect(wornBy([1, 3]).every((spray) => spray === null), "the fleet's cars are bare").toBeTruthy();
  });

  it("when a saved clip is played alone from the setup menu, then its racers wear the sprays of the clip's look, the traffic and the player's own car do not, and bare paint is back when the clip ends", { timeout: HANG_GUARD_MS }, async () => {
    // The clip is the head-on of car 0 (this browser's own) and car 1 beside bystander 2, recorded in `before` by the engine's own recorder.
    expect(firstMismatch(recorded.cars.map((c) => c.slot), [0, 1, 2]), "the clip holds all three cars").toBeUndefined();
    const [racer, bystander] = [1, 2];
    store.set("crush.highlight.rival", savedText);
    engine.toggleRace();
    expect(race().menu, "the race menu is up on its setup screen").toBe("setup");
    const clipUp = viewSavedAsked();
    engine.raceCommand({ type: "savedPlay", key: "rival" });
    await clipUp;
    expect(engine["highlights"]["solo"], "the saved clip is up alone").not.toBe(null);
    const car = (slot: number): DeformableCar => engine["cars"][slot]!;
    expect(sprayOn(car(racer)), "the clip's racer wears the clip's look").toBe(rivalSprayOf(CLIP_LOOK, racer, car(racer)));
    expect(sprayOn(car(bystander)), "its bystander stays bare").toBe(null);
    expect(sprayOn(car(0)), "this browser's own car keeps its own spray").toBe(ownDigest());
    engine.raceCommand({ type: "reelBack" });
    expect(sprayOn(car(racer)), "the racer is bare once the clip is over").toBe(null);
  });

  it("when a saved clip is played alone on the high tier, then its racer's new paints carry the finish, as a live dress gives them", { timeout: HANG_GUARD_MS }, async () => {
    store.set("crush.highlight.rival", savedText);
    engine.setSky("off");
    engine["cine"].setTier("high");
    // The clip's dress rebuilds a car of another body: its first spray splits fresh paints, the ones the clip's dress must finish.
    const clipCar = recorded.cars.find((c) => c.slot === 1)!;
    engine.matchCar(1, clipCar.style === "pickup" ? "sedan" : "pickup", clipCar.cls);
    try {
      const clipUp = viewSavedAsked();
      engine.raceCommand({ type: "savedPlay", key: "rival" });
      await clipUp;
      expect(engine["highlights"]["solo"], "the saved clip is up alone").not.toBe(null);
      const paintKeys: string[] = [];
      engine["cars"][1]!.group.traverse((object) => {
        if (object instanceof THREE.Mesh) for (const material of [object.material].flat()) if (material.userData.carFinish !== undefined) paintKeys.push(material.customProgramCacheKey());
      });
      expect(paintKeys.length, "the racer carries finish-capable materials").toBeGreaterThan(0);
      for (const key of paintKeys) expect(key.includes("|finish-"), `key ${key}`).toBeTruthy();
    } finally {
      engine.raceCommand({ type: "reelBack" });
      engine.matchCar(1, clipCar.style, clipCar.cls);
      engine["cine"].setTier("minimal");
    }
  });
});
