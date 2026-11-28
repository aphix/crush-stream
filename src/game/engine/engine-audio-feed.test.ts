import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { HitEvent, SoundMat } from "../present/hit-sound.ts";
import { AudioFeed, type FeedCar, type HitSink, type PairContact } from "./engine-audio-feed.ts";

const FRAME = 1 / FRAME_HZ;

type Scrape = { id: number; speed: number; force: number; a: SoundMat; b: SoundMat };

/** A sink that keeps what it hears (the feed reuses its event, so each is copied). */
function recorder(): HitSink & { hits: HitEvent[]; scrapes: Scrape[] } {
  const hits: HitEvent[] = [];
  const scrapes: Scrape[] = [];
  return {
    hits,
    scrapes,
    hit: (e) => void hits.push({ ...e }),
    scrape: (id, speed, force, _x, _y, _z, a, b) => void scrapes.push({ id, speed, force, a, b }),
  };
}

/** A car the feed reads: `bits` are its panes' states. */
function makeCar(): FeedCar & { bits: number } {
  const car = {
    velocity: new THREE.Vector3(),
    stored: false,
    airborne: false,
    wheelsDown: 15,
    group: { position: new THREE.Vector3(), visible: true, matrixWorld: new THREE.Matrix4() },
    glassPanes: [{ name: "windshield" as const }, { name: "rear" as const }],
    bits: 0,
    glassBits: () => car.bits,
    glassWorld: (_name: string, out: THREE.Vector3) => out.set(3, 1, 4),
  };
  return car;
}

function pairHit(impulse: number): PairContact {
  return { impulse, contact: { x: 1, y: 0.5, z: 2 }, normal: { x: 1, y: 0, z: 0 } };
}

function setup() {
  const sink = recorder();
  const cars = [makeCar(), makeCar(), makeCar()];
  const feed = new AudioFeed(sink, () => cars);
  feed.frame(FRAME);
  return { sink, cars, feed };
}

describe("given two cars that meet", () => {
  it("when they hit hard, then one hit is heard at the contact with both steel and the impulse the sim gave", () => {
    const { sink, cars, feed } = setup();
    feed.pair(cars[0]!, cars[1]!, pairHit(14));
    feed.frame(FRAME);
    expect(sink.hits.length).toBe(1);
    expect([sink.hits[0]!.a, sink.hits[0]!.b], "materials").toEqual(["steel", "steel"]);
    expect([sink.hits[0]!.impulse, sink.hits[0]!.x, sink.hits[0]!.y, sink.hits[0]!.z], "impulse and place").toEqual([14, 1, 0.5, 2]);
  });

  it("when the same contact reports itself on each of six slices, then it is one hit; a touch under 1.5 m/s is none", () => {
    const { sink, cars, feed } = setup();
    for (let s = 0; s < 6; s++) feed.pair(cars[0]!, cars[1]!, pairHit(14 - s));
    feed.pair(cars[0]!, cars[2]!, pairHit(1));
    feed.frame(FRAME);
    expect(sink.hits.length).toBe(1);
  });

  it("when a pane of one of them breaks in the same frame, then the hit sounds as glass against steel", () => {
    const { sink, cars, feed } = setup();
    feed.pair(cars[0]!, cars[1]!, pairHit(20));
    cars[1]!.bits = 2;
    feed.frame(FRAME);
    const hit = sink.hits.find((h) => h.impulse === 20)!;
    expect([hit.a, hit.b]).toEqual(["glass", "steel"]);
  });
});

describe("given a car that meets a wall or prop", () => {
  it("when a hay bale is hit, then the pair is steel and the material the course gave", () => {
    const { sink, cars, feed } = setup();
    feed.wall(cars[0]!, 9, 5, 0.4, 6, "hay");
    feed.frame(FRAME);
    expect([sink.hits[0]!.a, sink.hits[0]!.b]).toEqual(["steel", "hay"]);
    expect([sink.hits[0]!.x, sink.hits[0]!.z]).toEqual([5, 6]);
  });
});

describe("given a car that lands or lies on the ground", () => {
  it("when its upward speed jumps 8 m/s in a frame on its wheels, then rubber meets the surface under it", () => {
    const { sink, cars, feed } = setup();
    cars[0]!.velocity.y = -8;
    feed.frame(FRAME);
    cars[0]!.velocity.y = 0;
    feed.frame(FRAME);
    expect(sink.hits.length).toBe(1);
    expect(sink.hits[0]!.a).toBe("rubber");
    expect(sink.hits[0]!.impulse).toBe(8);
  });

  it("when the same jump happens with a wheel off the ground, then it is the body that hits: steel", () => {
    const { sink, cars, feed } = setup();
    cars[0]!.wheelsDown = 3;
    cars[0]!.velocity.y = -8;
    feed.frame(FRAME);
    cars[0]!.velocity.y = 0;
    feed.frame(FRAME);
    expect(sink.hits[0]!.a).toBe("steel");
  });

  it("when a car is placed 50 m up (a teleport) with its speed reset, then no landing is heard", () => {
    const { sink, cars, feed } = setup();
    cars[0]!.velocity.y = -8;
    feed.frame(FRAME);
    cars[0]!.velocity.y = 0;
    cars[0]!.group.position.y = 50;
    feed.frame(FRAME);
    expect(sink.hits.length).toBe(0);
  });

  it("when a car lies on its roof sliding at 6 m/s, then its body scrapes the ground every frame, steel on the surface, and stops when it stops", () => {
    const { sink, cars, feed } = setup();
    cars[0]!.group.matrixWorld.elements[5] = -1;
    cars[0]!.velocity.set(6, 0, 0);
    for (let f = 0; f < 5; f++) feed.frame(FRAME);
    expect(sink.scrapes.length, "scrapes in five frames").toBe(5);
    expect(sink.scrapes[0]!.a).toBe("steel");
    expect(sink.scrapes[0]!.speed).toBe(6);
    cars[0]!.velocity.set(0, 0, 0);
    for (let f = 0; f < 4; f++) feed.frame(FRAME);
    const before = sink.scrapes.length;
    for (let f = 0; f < 5; f++) feed.frame(FRAME);
    expect(sink.scrapes.length, "none four frames after it stopped").toBe(before);
  });
});

describe("given cars that slide along each other or a wall", () => {
  it("when two cars press and slide at 3 m/s, then a scrape follows each frame while they touch and carries a hit-free force", () => {
    const { sink, cars, feed } = setup();
    cars[0]!.velocity.set(0, 0, 3);
    const touch = pairHit(0.5);
    for (let f = 0; f < 4; f++) {
      feed.pair(cars[0]!, cars[1]!, touch);
      feed.frame(FRAME);
    }
    expect(sink.hits.length, "a graze is no hit").toBe(0);
    expect(sink.scrapes.length).toBe(4);
    expect(sink.scrapes[0]!.speed).toBeCloseTo(3, 9);
    expect(sink.scrapes[0]!.force).toBeGreaterThan(0);
    expect(sink.scrapes[0]!.force).toBeLessThanOrEqual(1);
    expect(new Set(sink.scrapes.map((s) => s.id)).size, "one contact").toBe(1);
  });

  it("when five contacts slide at once, then only the three pressed hardest scrape", () => {
    const { sink, cars, feed } = setup();
    for (let k = 0; k < 5; k++) {
      const car = makeCar();
      car.velocity.set(0, 0, 4);
      feed.wall(car, 1 + k, 0, 0, 0, "concrete");
    }
    feed.frame(FRAME);
    expect(sink.scrapes.length).toBe(3);
    expect(Math.min(...sink.scrapes.map((s) => s.force))).toBeGreaterThan(0.25 + 0.75 * (2 / 20) - 1e-9);
    expect(cars.length).toBe(3);
  });
});

describe("given a pane that breaks with no contact reported", () => {
  it("when it cracks, then a glass-on-glass hit at the pane is heard, and a shatter is louder", () => {
    const { sink, cars, feed } = setup();
    cars[0]!.bits = 1;
    feed.frame(FRAME);
    cars[0]!.bits = 1 | (2 << 2);
    feed.frame(FRAME);
    expect(sink.hits.map((h) => [h.a, h.b])).toEqual([["glass", "glass"], ["glass", "glass"]]);
    expect(sink.hits[1]!.impulse).toBeGreaterThan(sink.hits[0]!.impulse);
    expect([sink.hits[1]!.x, sink.hits[1]!.y, sink.hits[1]!.z]).toEqual([3, 1, 4]);
  });
});

describe("given a pile-up of thirty contacts in one frame", () => {
  it("when the frame plays, then at most six hits are heard and they are the hardest", () => {
    const { sink, feed } = setup();
    for (let k = 0; k < 30; k++) feed.wall(makeCar(), 2 + k, 0, 0, 0, "concrete");
    feed.frame(FRAME);
    expect(sink.hits.length).toBe(6);
    expect(Math.min(...sink.hits.map((h) => h.impulse))).toBe(26);
  });
});
