import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DETAIL_LEVELS } from "./car-detail.ts";
import { OpenWorldCarLod, type LodCar } from "./openworld-car-lod.ts";
import { HIDE_GRACE, SightField, type SightPlayer } from "./openworld-sight.ts";
import { occluder } from "./spectate-cam.ts";

const EYE_HEIGHT_M = 1.6;
const FRAME_S = 0.1;
/** A building 20 m wide, 8 m deep and 10 m high, 30 m down the street from the camera at the origin. */
const BUILDING = occluder(0, 30, 0, 10, 4, false, 0, 10);
const street = new THREE.PerspectiveCamera(60, 1.6, 0.1, 400);
street.position.set(0, EYE_HEIGHT_M, 0);
street.lookAt(0, EYE_HEIGHT_M, 100);
/** 30 m past the building's far wall, out of every player's 40 m reach from the origin. */
const BEHIND_BUILDING = { x: 0, z: 60 };
const IN_VIEW = { x: 30, z: 60 };
const PLAYER_AT_ORIGIN: SightPlayer = { group: { position: { x: 0, z: 0 } } };
const PLAYER_NEAR_BUILDING: SightPlayer = { group: { position: { x: 0, z: 25 } } };

function carAt(spot: { x: number; z: number }) {
  return { group: { position: { ...spot }, visible: true } };
}

function ladderAt(level: number) {
  const ladder = {
    level,
    setLevel(rung: number): void {
      ladder.level = rung;
    },
  };
  return ladder;
}

/** A sight field, its switch and a clock: `run` plays frames of `FRAME_S` s over the cars. */
function openWorld(level = 0) {
  const sight = new SightField([BUILDING], 64);
  const ladder = ladderAt(level);
  const lod = new OpenWorldCarLod(sight, ladder);
  let frames = 0;
  return {
    ladder,
    lod,
    run(cars: readonly LodCar[], seconds: number, options: { players?: readonly SightPlayer[]; followed?: LodCar | null; replaying?: boolean } = {}): void {
      for (const end = frames + Math.round(seconds / FRAME_S); frames < end; frames++) {
        sight.update([street], frames * FRAME_S, options.players ?? [PLAYER_AT_ORIGIN]);
        lod.frame(cars, options.followed ?? null, options.replaying ?? false);
      }
    },
  };
}

describe("given a car parked behind a building, out of every eye's sight and every player's reach", () => {
  it("when it has been unseen for 2.9 s, then it is still drawn, and when 3 s have passed it is not", () => {
    const world = openWorld();
    const car = carAt(BEHIND_BUILDING);
    world.run([car], HIDE_GRACE - FRAME_S);
    expect(car.group.visible, "drawn just before the grace is up").toBe(true);
    world.run([car], 2 * FRAME_S);
    expect(car.group.visible, "drawn once the grace is up").toBe(false);
  });

  it("when it drives out from behind the building, then it is drawn the same frame", () => {
    const world = openWorld();
    const car = carAt(BEHIND_BUILDING);
    world.run([car], HIDE_GRACE + 1);
    car.group.position.x = IN_VIEW.x;
    world.run([car], FRAME_S);
    expect(car.group.visible, "drawn once it is seen").toBe(true);
  });

  it("when a player's car stands within 40 m of it, then it stays drawn", () => {
    const world = openWorld();
    const car = carAt(BEHIND_BUILDING);
    world.run([car], HIDE_GRACE + 1, { players: [PLAYER_NEAR_BUILDING] });
    expect(car.group.visible, "drawn with a player's car 35 m from it").toBe(true);
  });

  it("when the camera follows it, then it stays drawn", () => {
    const world = openWorld();
    const car = carAt(BEHIND_BUILDING);
    world.run([car], HIDE_GRACE + 1, { followed: car });
    expect(car.group.visible, "drawn while followed").toBe(true);
  });

  it("when the engine had hidden it, then it is never drawn by the switch, and one the switch hid and the engine shows is its own again", () => {
    const world = openWorld();
    const parked = carAt(IN_VIEW);
    parked.group.visible = false;
    const hidden = carAt(BEHIND_BUILDING);
    world.run([parked, hidden], HIDE_GRACE + 1);
    expect(parked.group.visible, "the engine's hidden car in view").toBe(false);
    expect(hidden.group.visible, "the switch's hidden car").toBe(false);
    hidden.group.visible = true;
    world.run([parked, hidden], FRAME_S);
    expect(hidden.group.visible, "the car the engine showed, within its grace again").toBe(true);
  });

  it("when a replay plays, then the cars it hid are drawn and none is hidden, and when the open world ends the cars it hid are drawn", () => {
    const world = openWorld();
    const car = carAt(BEHIND_BUILDING);
    world.run([car], HIDE_GRACE + 1);
    world.run([car], FRAME_S, { replaying: true });
    expect(car.group.visible, "drawn while a replay plays").toBe(true);
    world.run([car], HIDE_GRACE + 1);
    world.lod.stop([car]);
    expect(car.group.visible, "drawn after the stop").toBe(true);
  });
});

describe("given the ladder of distance detail", () => {
  const nearest = DETAIL_LEVELS.length - 1;

  it("when the open world runs on a desktop's first rung, then the cars draw three rungs nearer, and the rung is back when it ends", () => {
    const world = openWorld(0);
    world.run([], FRAME_S);
    expect(world.ladder.level, "rung in the open world").toBe(3);
    world.lod.stop([]);
    expect(world.ladder.level, "rung after the open world").toBe(0);
  });

  it("when it runs on a phone's rung, then the rung stops at the ladder's last", () => {
    const world = openWorld(2);
    world.run([], FRAME_S);
    expect(world.ladder.level, "rung in the open world").toBe(nearest);
  });

  it("when something else sets the rung while the open world runs, then the next frame puts the open world's back", () => {
    const world = openWorld(0);
    world.run([], FRAME_S);
    world.ladder.level = 0;
    world.run([], FRAME_S);
    expect(world.ladder.level, "rung a frame after another setting").toBe(3);
  });
});
