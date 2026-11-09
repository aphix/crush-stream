import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { EVENT_KIND } from "../ai/civilians/civilian-constants.ts";
import { CROWD_TIER_SCALE, POPULATION_TIER, WRECK_SPEED } from "../ai/civilians/civilian-crowd-constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { fixtureLots } from "../world/openworld/openworld-lots.test-util.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { OFF_MENU } from "../world/tracks/index.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";

/** The fixture layout's walls, m from the outermost streets: the layout the builders' rows run on stands in for the real one. */
const WALL_REACH = 8;
const LINK_SEED = 0xbeef;
const RUN_SECONDS = 3;

const lots = fixtureLots(WALL_REACH);
const map = buildOpenWorldMap(lots);
const course = openWorldCourse(lots);
let engine: CrashEngine;

beforeAll(async () => {
  (OFF_MENU as unknown[]).push(course);
  stubBrowser();
  globalThis.location.hash = `#scene=openworld&seed=${LINK_SEED.toString(16)}`;
  engine = await bootEngine({ hud: new HudStore() });
  engine.startOpenWorld(map);
  runSeconds(engine, RUN_SECONDS);
});
afterAll(() => {
  engine.dispose();
  setGround(null);
  (OFF_MENU as unknown[]).splice((OFF_MENU as unknown[]).indexOf(course), 1);
});

const director = () => engine["openWorld"];
/** The crowd's drawing (the engine makes a `CivilianArt`): its group. */
const drawnCrowd = () => director()["art"] as unknown as { group: { parent: unknown } } | null;

describe("given the real engine booted on the open world's course with a map given", () => {
  it("when it has run a few seconds, then the crowd is up on the run's seed, stepped with the sim, and drawn", () => {
    const crowd = director()["crowd"];
    expect(crowd, "the crowd").not.toBeNull();
    expect(director().crowdTime(), "crowd seconds").toBeGreaterThan(RUN_SECONDS / 2);
    expect(engine.net["game"].crowdLink()?.seed, "the crowd link's key: this device's tier above the seed").toBe(POPULATION_TIER.phone * CROWD_TIER_SCALE + LINK_SEED);
    expect(drawnCrowd()?.group.parent, "the drawn crowd is in the scene").toBe(engine["scene"]);
  });

  it("when the course reports a car's hard hit on a building, then the crowd logs a wreck, and the race's own wall-hit hook still ran", () => {
    const house = map.places.find((place) => place.doorNode >= 0)!;
    const recorded: number[] = [];
    const heard = engine["race"].recorder.wallHit.bind(engine["race"].recorder);
    engine["race"].recorder.wallHit = (car, closing, x, z) => {
      recorded.push(closing);
      heard(car, closing, x, z);
    };
    engine["race"].onWallHit(0, WRECK_SPEED, house.x, house.z);
    expect(firstMismatch(Array.from(director().eventLog()).slice(0, 2), [EVENT_KIND.wreck, map.places.indexOf(house)]), "the crowd's first event: a wreck at some place").toBeUndefined();
    expect(firstMismatch(recorded, [WRECK_SPEED]), "closing speeds the recorder heard").toBeUndefined();
  });

  it("when the scene is left for the sandbox, then the crowd, its drawing and the link are gone", () => {
    const art = drawnCrowd()!;
    engine.fadeScenes = false;
    engine["setScene"]("fleet");
    runSeconds(engine, 0.2);
    expect(director()["crowd"], "the crowd").toBeNull();
    expect(art.group.parent, "the drawn crowd's parent").toBeNull();
    expect(engine.net["game"].crowdLink(), "the crowd link").toBeNull();
  });
});
