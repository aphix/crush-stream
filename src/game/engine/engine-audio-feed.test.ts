import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { VOICES } from "../present/audio-mix.ts";
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
  const frame = (focus: FeedCar | null = null, rate = 1): void => feed.frame(FRAME, rate, focus, 0, 0, 0);
  frame();
  return { sink, cars, feed, frame };
}

describe("given two cars that meet", () => {
  it("when they hit hard, then one hit is heard at the contact with both steel and the impulse the sim gave", () => {
    const { sink, cars, feed, frame } = setup();
    feed.pair(cars[0]!, cars[1]!, pairHit(14));
    frame();
    expect(sink.hits.length).toBe(1);
    expect([sink.hits[0]!.a, sink.hits[0]!.b], "materials").toEqual(["steel", "steel"]);
    expect([sink.hits[0]!.impulse, sink.hits[0]!.x, sink.hits[0]!.y, sink.hits[0]!.z], "impulse and place").toEqual([14, 1, 0.5, 2]);
  });

  it("when the same contact reports itself on each of six slices, then it is one hit; a touch under 1.5 m/s is none", () => {
    const { sink, cars, feed, frame } = setup();
    for (let s = 0; s < 6; s++) feed.pair(cars[0]!, cars[1]!, pairHit(14 - s));
    feed.pair(cars[0]!, cars[2]!, pairHit(1));
    frame();
    expect(sink.hits.length).toBe(1);
  });

  it("when a pane of one of them breaks in the same frame, then the hit sounds as glass against steel", () => {
    const { sink, cars, feed, frame } = setup();
    feed.pair(cars[0]!, cars[1]!, pairHit(20));
    cars[1]!.bits = 2;
    frame();
    const hit = sink.hits.find((h) => h.impulse === 20)!;
    expect([hit.a, hit.b]).toEqual(["glass", "steel"]);
  });
});

describe("given a contact that is held", () => {
  it("when two cars stay pressed for a second, reporting every frame, then it is one hit, not one every tenth of a second", () => {
    const { sink, cars, feed, frame } = setup();
    for (let f = 0; f < FRAME_HZ; f++) {
      feed.pair(cars[0]!, cars[1]!, pairHit(14));
      frame();
    }
    expect(sink.hits.length).toBe(1);
  });

  it("when the sim crawls at a fiftieth of real time and reports the contact every fiftieth frame, then it is still one hit", () => {
    const { sink, cars, feed, frame } = setup();
    for (let f = 0; f < 4 * FRAME_HZ; f++) {
      if (f % 50 === 0) feed.pair(cars[0]!, cars[1]!, pairHit(14));
      frame(null, 0.02);
    }
    expect(sink.hits.length).toBe(1);
  });

  it("when it parts for 0.2 s and meets again, then the second meeting is a second hit", () => {
    const { sink, cars, feed, frame } = setup();
    feed.pair(cars[0]!, cars[1]!, pairHit(14));
    frame();
    for (let f = 0; f < 12; f++) frame();
    feed.pair(cars[0]!, cars[1]!, pairHit(14));
    frame();
    expect(sink.hits.length).toBe(2);
  });

  it("when a held contact's impulse grows past half as much again after a tenth of a second, then that blow is a second hit; a smaller rise is not", () => {
    const { sink, cars, feed, frame } = setup();
    for (const impulse of [14, 18, 20]) {
      feed.pair(cars[0]!, cars[1]!, pairHit(impulse));
      frame();
    }
    for (let f = 0; f < 8; f++) {
      feed.pair(cars[0]!, cars[1]!, pairHit(20));
      frame();
    }
    expect(sink.hits.length, "14, 18, 20: one hit").toBe(1);
    feed.pair(cars[0]!, cars[1]!, pairHit(25));
    frame();
    expect(sink.hits.length, "25 is past 1.5 x 14").toBe(2);
  });

  it("when a car grinds a wall after a 20 m/s hit, reporting every frame at 3 m/s for a second, then a 12 m/s bale it meets is a second hit", () => {
    const { sink, cars, feed, frame } = setup();
    feed.wall(cars[0]!, 20, 0, 0, 0, "concrete");
    frame();
    for (let f = 0; f < FRAME_HZ; f++) {
      feed.wall(cars[0]!, 3, 0, 0, 0, "concrete");
      frame();
    }
    feed.wall(cars[0]!, 12, 2, 0, 0, "hay");
    frame();
    expect(sink.hits.map((h) => h.b)).toEqual(["concrete", "hay"]);
  });

  it("when a car grazes at 0.5 m/s for a second and then a 9 m/s hit lands on the same car, then that is a hit", () => {
    const { sink, cars, feed, frame } = setup();
    for (let f = 0; f < FRAME_HZ; f++) {
      feed.wall(cars[0]!, 0.5, 0, 0, 0, "concrete");
      frame();
    }
    expect(sink.hits.length, "a graze is no hit").toBe(0);
    feed.wall(cars[0]!, 9, 0, 0, 0, "concrete");
    frame();
    expect(sink.hits.length).toBe(1);
  });
});

describe("given the sim standing still (paused, held or waiting: rate 0)", () => {
  it("when a contact is reported, two seconds of frames pass at rate 0, and it is reported again, then it is one hit, not two", () => {
    const { sink, cars, feed, frame } = setup();
    feed.pair(cars[0]!, cars[1]!, pairHit(14));
    frame(null, 0);
    for (let f = 0; f < 2 * FRAME_HZ; f++) frame(null, 0);
    feed.pair(cars[0]!, cars[1]!, pairHit(14));
    frame(null, 0);
    expect(sink.hits.length).toBe(1);
  });

  it("when a car is in the air for two seconds at rate 0, then landing builds no air time: its landing is not heard", () => {
    const h = setup();
    const car = h.cars[0]!;
    car.airborne = true;
    car.wheelsDown = 0;
    car.velocity.y = -8;
    for (let f = 0; f < 2 * FRAME_HZ; f++) h.frame(null, 0);
    car.airborne = false;
    car.wheelsDown = 15;
    car.velocity.y = 0;
    h.frame(null, 0);
    expect(h.sink.hits.length).toBe(0);
  });
});

describe("given the queue before the frame plays it", () => {
  it("when thirty faint near hits fill it and a hard hit 300 m off arrives, then the far hit is not in the queue, which holds only near ones", () => {
    const { feed } = setup();
    for (let k = 0; k < 30; k++) feed.wall(makeCar(), 5, 1, 0, 0, "concrete");
    feed.wall(makeCar(), 90, 300, 0, 0, "concrete");
    const queued = Array.from(feed["qImpulse"].subarray(0, feed["queued"]));
    expect(queued.length, "the queue is full").toBeGreaterThan(0);
    expect(queued.includes(90), "the far hit was queued").toBe(false);
    expect(queued.every((impulse) => impulse === 5), "only the near hits").toBe(true);
  });

  it("when a hit lands past 400 m with the queue empty, then nothing is queued", () => {
    const { feed } = setup();
    feed.wall(makeCar(), 90, 500, 0, 0, "concrete");
    expect(feed["queued"]).toBe(0);
  });
});

describe("given a car that meets a wall or prop", () => {
  it("when a hay bale is hit, then the pair is steel and the material the course gave", () => {
    const { sink, cars, feed, frame } = setup();
    feed.wall(cars[0]!, 9, 5, 0.4, 6, "hay");
    frame();
    expect([sink.hits[0]!.a, sink.hits[0]!.b]).toEqual(["steel", "hay"]);
    expect([sink.hits[0]!.x, sink.hits[0]!.z]).toEqual([5, 6]);
  });
});

/** Car `car` flies for half a second falling at 8 m/s, then is on its four wheels: the frame it lands is the last one run. */
function flyAndLand(frame: (focus: FeedCar | null) => void, car: FeedCar, focus: FeedCar | null = null): void {
  car.airborne = true;
  car.wheelsDown = 0;
  car.velocity.y = -8;
  for (let f = 0; f < 30; f++) frame(focus);
  car.airborne = false;
  car.wheelsDown = 15;
  car.velocity.y = 0;
  frame(focus);
}

describe("given a car that lands", () => {
  it("when it comes down on its four wheels after half a second in the air at 8 m/s, then rubber meets the surface under it at the fall's speed", () => {
    const h = setup();
    flyAndLand(h.frame, h.cars[0]!);
    expect(h.sink.hits.length).toBe(1);
    expect(h.sink.hits[0]!.a).toBe("rubber");
    expect(h.sink.hits[0]!.impulse).toBe(8);
  });

  it("when the car is the focus car, then its landing is the tyres' thud and the feed hears none", () => {
    const h = setup();
    flyAndLand(h.frame, h.cars[0]!, h.cars[0]!);
    expect(h.sink.hits.length).toBe(0);
  });

  it("when it is placed 50 m away in mid-flight and lands there, then no landing is heard", () => {
    const h = setup();
    const car = h.cars[0]!;
    car.airborne = true;
    car.velocity.y = -8;
    for (let f = 0; f < 30; f++) h.frame();
    car.group.position.x = 50;
    car.airborne = false;
    car.velocity.y = 0;
    h.frame();
    h.frame();
    expect(h.sink.hits.length).toBe(0);
  });

  it("when upward speed jumps with a wheel off the ground, then it is the body that slams: steel; on four wheels with no flight, nothing", () => {
    const h = setup();
    h.cars[0]!.wheelsDown = 3;
    h.cars[0]!.velocity.y = -8;
    h.frame();
    h.cars[0]!.velocity.y = 0;
    h.frame();
    expect(h.sink.hits[0]!.a).toBe("steel");
    h.cars[1]!.velocity.y = -8;
    h.frame();
    h.cars[1]!.velocity.y = 0;
    h.frame();
    expect(h.sink.hits.length, "the wheels-down jump added none").toBe(1);
  });
});

describe("given a car that lies on its roof", () => {
  it("when it slides at 6 m/s, then its body scrapes the ground every frame, steel on the surface, and stops when it stops", () => {
    const { sink, cars, frame } = setup();
    cars[0]!.group.matrixWorld.elements[5] = -1;
    cars[0]!.velocity.set(6, 0, 0);
    for (let f = 0; f < 5; f++) frame();
    expect(sink.scrapes.length, "scrapes in five frames").toBe(5);
    expect(sink.scrapes[0]!.a).toBe("steel");
    expect(sink.scrapes[0]!.speed).toBe(6);
    cars[0]!.velocity.set(0, 0, 0);
    for (let f = 0; f < 4; f++) frame();
    const before = sink.scrapes.length;
    for (let f = 0; f < 5; f++) frame();
    expect(sink.scrapes.length, "none four frames after it stopped").toBe(before);
  });
});

describe("given cars that slide along each other or a wall", () => {
  it("when two cars press and slide at 3 m/s, then a scrape follows each frame while they touch and carries a hit-free force", () => {
    const { sink, cars, feed, frame } = setup();
    cars[0]!.velocity.set(0, 0, 3);
    const touch = pairHit(0.5);
    for (let f = 0; f < 4; f++) {
      feed.pair(cars[0]!, cars[1]!, touch);
      frame();
    }
    expect(sink.hits.length, "a graze is no hit").toBe(0);
    expect(sink.scrapes.length).toBe(4);
    expect(sink.scrapes[0]!.speed).toBeCloseTo(3, 9);
    expect(sink.scrapes[0]!.force).toBeGreaterThan(0);
    expect(sink.scrapes[0]!.force).toBeLessThanOrEqual(1);
    expect(new Set(sink.scrapes.map((s) => s.id)).size, "one contact").toBe(1);
  });

  it("when more contacts slide at once than the scrape budget, then only the hardest pressed scrape", () => {
    const { sink, feed, frame } = setup();
    for (let k = 0; k < VOICES.scrapes + 2; k++) {
      const car = makeCar();
      car.velocity.set(0, 0, 4);
      feed.wall(car, 1 + k, 0, 0, 0, "concrete");
    }
    frame();
    expect(sink.scrapes.length).toBe(VOICES.scrapes);
    expect(Math.min(...sink.scrapes.map((s) => s.force))).toBeGreaterThan(0.25 + 0.75 * (2 / 20) - 1e-9);
  });
});

describe("given a pane that breaks with no contact reported", () => {
  it("when it cracks, then a glass-on-glass hit at the pane is heard, and a shatter is louder", () => {
    const { sink, cars, frame } = setup();
    cars[0]!.bits = 1;
    frame();
    cars[0]!.bits = 1 | (2 << 2);
    frame();
    expect(sink.hits.map((h) => [h.a, h.b])).toEqual([["glass", "glass"], ["glass", "glass"]]);
    expect(sink.hits[1]!.impulse).toBeGreaterThan(sink.hits[0]!.impulse);
    expect([sink.hits[1]!.x, sink.hits[1]!.y, sink.hits[1]!.z]).toEqual([3, 1, 4]);
  });
});

describe("given a pile-up of hits in one frame", () => {
  it("when thirty hits of rising impulse land beside the listener, then at most six are heard and they are the hardest", () => {
    const { sink, feed, frame } = setup();
    for (let k = 0; k < 30; k++) feed.wall(makeCar(), 2 + k, 0, 0, 0, "concrete");
    frame();
    expect(sink.hits.length).toBe(6);
    expect(Math.min(...sink.hits.map((h) => h.impulse))).toBe(26);
  });

  it("when ten faint hits beside the listener meet ten hard ones 300 m away, then the six played are the near ones", () => {
    const { sink, feed, frame } = setup();
    for (let k = 0; k < 10; k++) feed.wall(makeCar(), 5, 1, 0, 0, "concrete");
    for (let k = 0; k < 10; k++) feed.wall(makeCar(), 40, 300, 0, 0, "concrete");
    frame();
    expect(sink.hits.length).toBe(6);
    expect(sink.hits.every((h) => h.impulse === 5)).toBe(true);
  });

  it("when a hard hit lands 500 m off, then it is not played at all", () => {
    const { sink, feed, frame } = setup();
    feed.wall(makeCar(), 90, 500, 0, 0, "concrete");
    frame();
    expect(sink.hits.length).toBe(0);
  });
});
