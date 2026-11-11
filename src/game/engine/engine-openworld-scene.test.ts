import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { homeModes, pickScene, sceneInPlay, scenesFor } from "../../components/scene-picks.ts";
import { CROWD_TIER_SCALE, POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
import { decodeShare, encodeShare } from "../hud/share-url.ts";
import { HudStore, INITIAL_HUD, type LookAtHud } from "../hud/hud-store.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { OWN_FIELD_SCENES, SEEDED_SCENES, SOLO_SCENES } from "../scenes/scene-id.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-course.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { parseTrack } from "../world/track-schema.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, pressKey, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";

/** The seed a link pins (hex): the crowd of this run. */
const LINK_SEED = 0xbeef;
/** Seconds the car holds the throttle: long enough to leave its spawn, short of any wall. */
const DRIVE_S = 2;
/** The car must have left its spawn by this much (m). */
const MOVED_M = 3;

describe("given the scene picker", () => {
  it("when the dock and the Home sheet list their scenes, then Open World is on both, in a room too", () => {
    expect(scenesFor(false).some((scene) => scene.id === "openworld" && scene.label === "Open World"), "the dock").toBe(true);
    expect(homeModes(false).some((scene) => scene.id === "openworld"), "the Home sheet").toBe(true);
    expect(scenesFor(true).some((scene) => scene.id === "openworld"), "a room keeps it").toBe(true);
  });

  it("when the scene's rules are read, then it has its own field, a seeded crowd and is not single-player", () => {
    expect(OWN_FIELD_SCENES.openworld, "its own field").toBe(true);
    expect(SEEDED_SCENES.openworld, "the crowd's seed rides the link").toBe(true);
    expect(SOLO_SCENES.openworld, "a room may be in it").toBeUndefined();
  });

  it("when the HUD starts, then the open world is not the scene in play", () => {
    expect(INITIAL_HUD.openworld).toBe(false);
    expect(sceneInPlay(INITIAL_HUD)).toBe("fleet");
  });
});

// One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
let engine: CrashEngine;
let hud: HudStore;
const car = () => engine["live"]()[0]!;

beforeAll(async () => {
  stubBrowser();
  globalThis.location.hash = `#scene=openworld&seed=${LINK_SEED.toString(16)}`;
  hud = new HudStore();
  engine = await bootEngine({ hud });
  runSeconds(engine, 0.5);
});
afterAll(() => {
  engine.dispose();
  setGround(null);
});

describe("given the real engine booted on #scene=openworld with a seed", () => {
  it("when the page opens, then it is the free roam on the city's course, not the first menu course, with no session and no hunters", () => {
    expect(OPENWORLD_ID, "control: the city is not the menu's first course").not.toBe(parseTrack(TRACKS[0]).id);
    expect(engine["sceneId"], "the scene").toBe("openworld");
    expect(engine["race"].active, "race mode carries it").toBe(true);
    expect(engine["race"].free, "the lobby's free roam").toBe(true);
    expect(engine["race"].courseId, "the course").toBe(OPENWORLD_ID);
    expect(engine["race"].phase, "no session").toBe(null);
    expect(engine["race"]["police"], "no hunters").toBe(null);
  });

  it("when the page has opened, then the HUD and the scene buttons name the open world", () => {
    expect(hud.get().openworld, "the HUD flag").toBe(true);
    expect(sceneInPlay(hud.get()), "the scene in play").toBe("openworld");
  });

  it("when the throttle is held, then the player's car, car 0 under the driver's seat, leaves its spawn", () => {
    expect(engine["seat"].mode, "the seat drives").toBe("drive");
    expect(engine["seat"].carIndex, "car 0").toBe(0);
    const spawn = car().group.position.clone();
    engine["keys"].add("KeyW");
    runSeconds(engine, DRIVE_S);
    engine["keys"].delete("KeyW");
    expect(car().group.position.distanceTo(spawn), "metres driven").toBeGreaterThan(MOVED_M);
  });

  it("when the share state is read, then it names the scene and the seed, and the link reads back to both", () => {
    const state = engine["shareState"]();
    expect(state.scene, "scene").toBe("openworld");
    expect(state.seed, "seed").toBe(LINK_SEED);
    const link = decodeShare(encodeShare(state));
    expect(link.scene, "scene after the link").toBe("openworld");
    expect(link.seed, "seed after the link").toBe(LINK_SEED);
  });
});

describe("given the open world in play on the real engine", () => {
  it("when the eye rests on something, then the HUD carries the panel's text, and nothing again when it rests on nothing", () => {
    expect(hud.get().lookAt, "nothing is looked at before the crowd exists").toBe(null);
    const seen: LookAtHud = { title: "Rosa Kim, 34", lines: ["cook at Sal's Diner", "left home"] };
    engine["lookAtText"] = () => seen;
    runSeconds(engine, 0.5);
    expect(hud.get().lookAt?.title, "the panel's title").toBe(seen.title);
    expect(firstMismatch(hud.get().lookAt?.lines, seen.lines), "the panel's lines").toBeUndefined();
    engine["lookAtText"] = () => null;
    runSeconds(engine, 0.5);
    expect(hud.get().lookAt, "back to nothing").toBe(null);
  });

  it("when the open world is up with its map, then netplay has the crowd's link to send and hear through, on this run's key (a client hears the host's crowd through it before it has one)", () => {
    expect(engine.net["game"].crowdLink()?.seed, "the link's key: this device's tier above the seed").toBe(POPULATION_TIER.phone * CROWD_TIER_SCALE + LINK_SEED);
  });

  it("when the Fleet button is pressed, then race mode and the lobby are left, the HUD flag drops and the sandbox's field is back", () => {
    pickScene({ current: engine }, sceneInPlay(hud.get()), "fleet");
    expect(engine["sceneId"], "the scene").toBe("fleet");
    expect(engine["race"].active, "race mode").toBe(false);
    expect(engine["race"].free, "the lobby").toBe(false);
    expect(hud.get().openworld, "the HUD flag").toBe(false);
    expect(engine["carCount"], "the sandbox's cars").toBe(engine["sandboxCars"]);
    expect(engine.net["game"].crowdLink(), "no crowd link outside the open world").toBe(null);
  });

  it("when a room takes the lobby over from the solo scene, then the scene is the room's, still on the city, and the HUD still flags the open world", () => {
    engine["setScene"]("openworld");
    expect(engine["sceneId"], "control: the solo scene").toBe("openworld");
    engine.net["game"].enterRace(false, true);
    expect(engine["sceneId"], "the room's scene").toBe("race");
    expect(engine["race"].courseId, "still the city").toBe(OPENWORLD_ID);
    runSeconds(engine, 0.3);
    expect(hud.get().openworld, "the flag follows the course").toBe(true);
  });
});

describe("given the number pad's plus and minus in the open world", () => {
  /** The hour the stage lights the open world by, and the crowd's own clock. */
  const lightHour = (): number => engine["stage"]["dayHour"]!;
  const crowdSeconds = (): number => engine["openWorld"].crowdTime();
  const HOURS_PER_DAY = 24;
  /** A game hour is sixty game minutes, a crowd second each. */
  const SECONDS_PER_HOUR = 60;
  const EPSILON = 1e-9;
  /** The owner's keys, as the browser names them: the number pad's plus and minus, and H. */
  const NUMPAD_PLUS = "NumpadAdd";
  const NUMPAD_MINUS = "NumpadSubtract";
  const KEY_H = "KeyH";

  // mutation: sed -i 's/  dayForward: "NumpadAdd",/  dayForward: "NumpadMultiply",/' src/game/engine/engine-keys.ts
  it("when plus is pressed in solo, then the stage's light and the crowd's clock stand on the next whole game hour at once; minus is the hour before, a day on; and H still opens the race view and leaves the hour alone", () => {
    runSeconds(engine, 1.5);
    const before = lightHour();
    const seconds = crowdSeconds();
    expect(before, "the light follows the crowd's hour").not.toBeNull();
    pressKey(engine, NUMPAD_PLUS);
    const forward = lightHour();
    expect(((forward - (Math.floor(before) + 1)) % HOURS_PER_DAY + HOURS_PER_DAY) % HOURS_PER_DAY, "the next whole hour").toBeLessThan(EPSILON);
    const skipped = crowdSeconds() - seconds;
    expect(skipped, "the crowd's clock is on, to the hour's start").toBeGreaterThan(0);
    expect(skipped, "by under an hour (a crowd second is a game minute)").toBeLessThanOrEqual(SECONDS_PER_HOUR);
    pressKey(engine, NUMPAD_MINUS);
    const back = lightHour();
    expect(((forward - 1 - back) % HOURS_PER_DAY + HOURS_PER_DAY) % HOURS_PER_DAY, "an hour back from a whole hour").toBeLessThan(EPSILON);
    expect(crowdSeconds() - seconds, "the hour before is a day's other hours on").toBe(skipped + (HOURS_PER_DAY - 1) * SECONDS_PER_HOUR);
    const full = engine["race"].fullUi;
    pressKey(engine, KEY_H);
    expect(engine["race"].fullUi, "H toggles the race view").toBe(!full);
    expect(lightHour(), "H leaves the hour alone").toBe(back);
    pressKey(engine, KEY_H);
    expect(engine["race"].fullUi, "H again").toBe(full);
  });

  // mutation: sed -i 's/      inRoom: () => this.net.role !== "off",/      inRoom: () => false,/' src/game/engine/engine.ts
  it("when the engine is in a room, then plus and minus move neither the light nor the crowd's clock", () => {
    const light = lightHour();
    const seconds = crowdSeconds();
    engine.net.role = "host";
    try {
      pressKey(engine, NUMPAD_PLUS);
      pressKey(engine, NUMPAD_MINUS);
    } finally {
      engine.net.role = "off";
    }
    expect(lightHour(), "the light").toBe(light);
    expect(crowdSeconds(), "the crowd's clock").toBe(seconds);
  });
});

describe("given the open world up on Auto, with no match running", () => {
  // mutation: sed -i 's/const matching = this.showOpenWorld || (/const matching = (/' src/game/engine/engine-input.ts
  it("when a frame reaches the render-scale and detail governors, then both are told a match is running, so a phone's pixel ratio can step down", () => {
    expect(engine["showOpenWorld"], "control: the city is up").toBe(true);
    expect(engine["autoFx"].auto, "control: Auto is on").toBe(true);
    const told: boolean[] = [];
    const scale = vi.spyOn(engine["quality"], "govern").mockImplementation((_a, _b, _c, _d, matching) => (told.push(matching), false));
    const detail = vi.spyOn(engine["detailGov"], "frame").mockImplementation((_a, _b, _c, _d, _e, matching) => (told.push(matching), null));
    engine["fxFrame"](0.025, 0);
    scale.mockRestore();
    detail.mockRestore();
    expect(told.join(","), "detail then scale").toBe("true,true");
  });
});
