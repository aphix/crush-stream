import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { setGround } from "../world/ground.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import city from "../world/tracks/city.json" with { type: "json" };
import { phaseClock } from "../match/phase.ts";
import type { HighlightClip } from "../match/highlights.ts";
import { PoseBlend } from "../present/pose-blend.ts";
import { aimSink, hitFoot } from "../present/engine-cine.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { World } from "../world/race-world.test-util.ts";
import { FLIGHT_S, ReelDirector, type ReelHost } from "./engine-highlights.ts";
import { raceOn, recordRace } from "./reel-view.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The city's straightest 60 m (arc length, m): the chain's three cars stand in line on it. */
const STRAIGHT = 592;

function hostOf(w: World): ReelHost {
  return {
    carsOf: (clip) => clip.cars.map((c) => w.cars[c.slot]!),
    live: () => w.live(),
    scene: { dress: w.dress, collide: (car, slot, h) => w.race.courseHit(car, slot, h), restore: (slot, mem, at) => w.race.remember(slot, mem, at), knocks: (bits) => w.race.knockTo(bits), blend: new PoseBlend() },
    resetProps: () => w.race.resetProps(),
    clear: () => {},
    sight: () => w.race.courseSight()!,
    still: () => w.race.courseSight()!,
    clock: phaseClock(),
    crash: () => {},
    impact: () => {},
    fudge: () => {},
    hit: () => {},
    eject: () => {},
    passenger: () => {},
    strike: () => {},
    ride: () => false,
  };
}

describe("given the clip of a car driven into the rear of two standing cars, whose hits are car-to-car contacts above the cars' origins", () => {
  let w: World;
  let clip: HighlightClip;
  beforeAll(() => {
    w = raceOn("city", 7, 3);
    const rec = recordRace(w, new Track(parseTrack(city)), [{ kind: "chain", at: STRAIGHT, speed: 34, gap: 7, cars: [1, 2, 3] }], 16);
    clip = rec.clips[0]!;
  });
  afterAll(() => {
    w.race.exit();
    setGround(null);
  });

  /** A director that has played the clip up to the frame its crash cam begins on the first hit. */
  const playedToImpact = (played: HighlightClip = clip): ReelDirector => {
    const director = new ReelDirector(hostOf(w));
    director.stepBudgetMs = Infinity;
    director.play({ seed: 0x5eed, clips: [played] }, 0);
    for (let k = -1; k * FRAME < director["clips"][0]!.tl.wall && !director["began"]; k++) director.frame(FLIGHT_S + k * FRAME);
    return director;
  };

  it("when the crash cam's window opens, then each later impact it will look at carries the depth of its lowest judged point under its aim, which is above zero", () => {
    const director = playedToImpact();
    const later = director["hold"].later;
    expect(later.n, "later impacts of the window").toBeGreaterThan(0);
    const sight = w.race.courseSight()!;
    for (let k = 0; k < later.n; k++) {
      const hit = clip.hits.find((h) => Math.abs(h.x - later.at[k]!.x) < 1e-6 && Math.abs(h.z - later.at[k]!.z) < 1e-6)!;
      const foot = hitFoot(new THREE.Vector3(), hit.x, hit.y, hit.z, sight);
      expect(later.sink[k], `impact ${k}'s depth under its aim (m)`).toBeCloseTo(aimSink(later.at[k]!, foot), 6);
      expect(later.sink[k], `impact ${k}'s depth under its aim (m)`).toBeGreaterThan(0.05);
    }
  });

  it("when the shot the cars meet in is framed for a hit recorded 0.8 m lower, then its spot is asked about the aim and about the lowest point the reel judges, which sits lower", () => {
    const lowered = { ...clip, hits: clip.hits.map((h, k) => (k === 0 ? { ...h, y: h.y - 0.8 } : h)) };
    const director = playedToImpact(lowered);
    const asked: THREE.Vector3[] = [];
    vi.spyOn(director["shotCam"], "sees").mockImplementation((_sight, p) => {
      asked.push(p.clone());
      return true;
    });
    const prepared = director["cur"]!;
    director["frameShot"](prepared, { ...prepared.shots[0]!, hit: true });
    expect(asked.length, "points the spot was asked about").toBe(2);
    expect(asked[1]!.y, "the second point's height under the first's (m)").toBeLessThan(asked[0]!.y - 0.05);
  });
});
