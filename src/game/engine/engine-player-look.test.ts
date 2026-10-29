import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { blankEjection } from "../vehicle/ejection.ts";
import type { PersonPick } from "../match/look-data.ts";
import { driverLook, ownLook, type DriverLook } from "../present/driver-look.ts";
import type { SprayBitmap } from "../present/spray.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The player's saved driver (the garage's picks, over the garage's own driver) on every throw of the player's car, whatever
 * the scene's look seed rolls: Fleet loops, long-jump retries, races, Survival, a clip's seed; a peer's car's driver in the
 * peer's; an AI driver in the seed's.
 */

const FRAME = 1 / FRAME_HZ;
const THROTTLE_KEY = "KeyW";
/** Sim seconds a long jump may take from the pedal to its score. */
const THROW_TIMEOUT_S = 60;
/** The owner's case: a shirt, a cap and a moustache picked, the Build, trousers and hair left as the garage shows them (unpicked), and a spray. */
const PLAYER: PersonPick = { woman: null, shirt: 0x123456, pants: null, hair: null, hat: 0xabcdef, mustache: true };
/** The ink the player sprays over his whole driver. */
const SPRAY_INK = 3;
const PEER: PersonPick = { woman: true, shirt: 0x0f0f0f, pants: 0xf0f0f0, hair: 0x00ff00, hat: 0xff0000, mustache: false };
const PLAYER_CAR = 0;
const AI_CAR = 1;
const PEER_CAR = 2;
/** A look seed no scene of this run rolls: a clip recorded under another race's field. */
const CLIP_SEED = 0xc11b5e;

type Worn = { car: number; look: DriverLook; spray: SprayBitmap | null };

describe("given the real engine and a player who customized his driver in the garage", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const worn: Worn[] = [];
  const mine = () => engine["looks"].mine;

  beforeAll(async () => {
    stubBrowser();
    const store = new Map<string, string>();
    globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) } as Storage;
    engine = await bootEngine({ pacer: true });
    await engine["ragdolls"].preload();
    spyDressing(engine, worn);
    engine.setPersonPick(PLAYER);
    const spray = mine().personSpray;
    spray.load({ texels: new Uint8Array(spray.texels.length).fill(SPRAY_INK), palette: spray.palette });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  /** Throws car `car`'s driver out of its windshield and returns how he was dressed. */
  const throwOut = (car: number): Worn => {
    worn.length = 0;
    engine["ragdolls"].launch(ejectionOf(engine["live"](), car), engine["live"]());
    expect(worn.length, `car ${car}'s driver was dressed once`).toBe(1);
    return worn[0]!;
  };
  const assertPlayer = (w: Worn, why: string): void => {
    expect(dressOf(w.look), `${why}: the player's driver wears his saved look`).toBe(dressOf(ownLook(PLAYER)));
    expect(w.spray, `${why}: and his saved spray`).toBe(mine().personSpray);
  };
  const assertAi = (w: Worn, why: string): void => {
    expect(dressOf(w.look), `${why}: an AI driver wears his seat's drawn look`).toBe(dressOf(driverLook(engine["ragdolls"].lookSeed, w.car)));
    expect(w.spray, `${why}: and no spray`).toBe(null);
  };

  it("when the Fleet loops 3 times, then every thrown player driver wears the saved look, an AI driver his seed's, and a peer's car's driver the peer's", () => {
    engine["setScene"]("fleet");
    const seeds = new Set<number>();
    for (let loop = 0; loop < 3; loop++) {
      engine["randomizeAndReset"]();
      runSeconds(engine, 0.2);
      seeds.add(engine["ragdolls"].lookSeed);
      assertPlayer(throwOut(PLAYER_CAR), `loop ${loop}`);
      assertAi(throwOut(AI_CAR), `loop ${loop}`);
      engine["looks"].wear(PEER_CAR, { ...engine["looks"].data(), person: PEER });
      expect(dressOf(throwOut(PEER_CAR).look), `loop ${loop}: the peer's driver wears the peer's look`).toBe(dressOf(ownLook(PEER)));
      engine["looks"].drop(PEER_CAR);
    }
    expect(seeds.size, "each loop rolled a look seed of its own").toBe(3);
  });

  it("when the long jump is thrown 3 times (a Retry after each score), then each real throw's driver wears the saved look", () => {
    engine["setScene"]("range");
    runSeconds(engine, 1);
    engine.startMinigame("longJump");
    expect(engine["minigameMode"], "the long jump is on").toBe("longJump");
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) engine.retryMinigame();
      worn.length = 0;
      throwLongJump(engine);
      const thrown = worn.filter((w) => w.car === PLAYER_CAR);
      expect(thrown.length, `attempt ${attempt}: the driver was thrown once`).toBe(1);
      assertPlayer(thrown[0]!, `attempt ${attempt}`);
    }
    engine.exitMinigame();
  });

  it("when a race and a Survival run start, then the player's thrown driver wears the saved look and an AI racer's driver his field's", () => {
    engine.toggleRace();
    engine.raceCommand({ type: "options", options: { trackId: "oval", aiCount: 3, laps: 1, police: false } });
    engine.raceCommand({ type: "start" });
    runSeconds(engine, 0.2);
    assertPlayer(throwOut(PLAYER_CAR), "race");
    assertAi(throwOut(AI_CAR), "race");
    engine.toggleSurvival();
    engine.raceCommand({ type: "start" });
    runSeconds(engine, 0.2);
    assertPlayer(throwOut(PLAYER_CAR), "Survival");
  });

  it("when a clip recorded under another field's seed plays, then its player's driver still wears the saved look", () => {
    engine["ragdolls"].lookSeed = CLIP_SEED;
    assertPlayer(throwOut(PLAYER_CAR), "clip");
    assertAi(throwOut(AI_CAR), "clip");
  });
});

/** Every field a look dresses a dummy by, as text (a failing assert diffs two short strings). */
const dressOf = (l: DriverLook): string => `woman ${l.woman} shirt ${l.shirt} pants ${l.pants} hair ${l.hair} hat ${l.hat} mustache ${l.mustache} face ${l.face} portly ${l.portly} outfit ${l.outfit} shades ${l.shades} tie ${l.tie}`;

/** Every driver the dummies dress for a car (no figure or passenger with a look of his own) is pushed to `worn`. */
function spyDressing(engine: CrashEngine, worn: Worn[]): void {
  const ragdolls = engine["ragdolls"];
  const dressingOf = ragdolls["dressingOf"].bind(ragdolls);
  ragdolls["dressingOf"] = (t, dressed) => {
    const out = dressingOf(t, dressed);
    if (!dressed && !t.look && !t.cop) worn.push({ car: t.car, ...out });
    return out;
  };
}

/** Car `car`'s driver out of the windshield, 6 m/s up and 3 m/s ahead of the car. */
function ejectionOf(cars: readonly { group: THREE.Object3D; velocity: THREE.Vector3 }[], car: number) {
  const c = cars[car]!;
  const e = blankEjection();
  e.car = car;
  e.dir.set(0, 0, 1).applyQuaternion(c.group.quaternion);
  e.pos.copy(c.group.position).addScaledVector(THREE.Object3D.DEFAULT_UP, 1.3).addScaledVector(e.dir, 0.6);
  e.quat.copy(c.group.quaternion);
  e.rel.copy(e.dir).multiplyScalar(3).addScaledVector(THREE.Object3D.DEFAULT_UP, 6);
  e.carVel.copy(c.velocity);
  return e;
}

/** The player holds the throttle to the lip until the throw scores, then lets go for two frames (a held pedal never starts the next attempt). */
function throwLongJump(engine: CrashEngine): void {
  engine["keys"].add(THROTTLE_KEY);
  for (let frame = 0; frame < THROW_TIMEOUT_S * FRAME_HZ && engine["minigames"].hud().phase !== "scored"; frame++) engine.advance(FRAME, { frameDt: FRAME });
  engine["keys"].delete(THROTTLE_KEY);
  for (let frame = 0; frame < 2; frame++) engine.advance(FRAME, { frameDt: FRAME });
  expect(engine["minigames"].hud().phase, "the long jump scored").toBe("scored");
}
