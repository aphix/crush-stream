import { describe, expect, it } from "vitest";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { guardMates } from "./pack-guard.ts";
import { MIN_LIFE, OUT_RANGE, PoliceBrain } from "./police.ts";
import { sightRange } from "./cop-sight.ts";
import type { HunterWorld } from "./cop-brain.ts";
import { RaceBrain } from "./race-ai.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { idleDrive } from "../vehicle/car-drive.ts";
import { blankProjection, Track } from "../world/track.ts";
import fourCount from "../world/tracks/four-count.json" with { type: "json" };
import city from "../world/tracks/city.json" with { type: "json" };
import { BEAT, pt, rig, track } from "./police-rig.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** The oval is short, so its racers see a third of the full ranges (`sightRange`). */
const SIGHT = sightRange(track.length);

/** The racer far enough past the units (m along the road) that no racer sees them, but within `OUT_RANGE`. */
const PAST_SIGHT = SIGHT.near + 50;

describe("given a racer with a stakeout of two cops parked ahead of it, the first just woken by the racer passing and the second still parked", () => {
  it("when the racer stops racing and no chaser is near another racer so the pack stands down, then the parked cop never pulls out onto the road and is put away only once the racer is out of sight and the cop is MIN_LIFE s old", () => {
    const r = rig();
    r.hunt[0] = 0;
    r.beat();
    expect(r.police.think(r.cars[2]!, r.cars, BEAT).throttle, "unit 2 still drives").toBe(0);
    r.sit(PAST_SIGHT);
    r.run(MIN_LIFE - 2);
    expect(!r.stored.includes(2), "unit 2 is younger than MIN_LIFE").toBe(true);
    r.run(3);
    expect(r.stored.includes(2), "unit 2 is put away past MIN_LIFE").toBeTruthy();
  });

  it("when the racer stops racing beside the parked cop in the camera's view, then it is not put away while the camera sees it, and is put away once the racer has driven off and the camera no longer sees it", () => {
    const r = rig();
    r.hunt[0] = 0;
    r.camera.sees = true;
    r.run(MIN_LIFE + 30);
    expect(!r.stored.includes(2), "nothing vanishes in the camera's view").toBe(true);
    r.sit(PAST_SIGHT);
    r.camera.sees = false;
    r.beat();
    expect(r.stored.includes(2), "gone once out of the camera's view").toBeTruthy();
  });
});

describe("given a stakeout of two cops parked ahead of a racer on the road", () => {
  it("when a racer 60 m off the road across the field has its nearest road point past the second cop's spot, then only the first cop wakes, and when the racer passes on the road itself, then both wake", () => {
    const r = rig();
    const spot = r.cars[2]!;
    const s2 = track.project(spot.x, spot.z, -1, blankProjection()).s;
    // A point `off` m to the side of the road 5 m past unit 2's spot (the side whose nearest road point is still that stretch).
    const at = (off: number) => {
      const p = track.pointAt(s2 + 5, pt);
      for (const side of [1, -1]) {
        const x = p.x + p.tz * side * off;
        const z = p.z - p.tx * side * off;
        const on = track.project(x, z, -1, blankProjection());
        if (Math.abs(on.s - (s2 + 5)) < 10) return { x, z };
      }
      throw new Error("no side of the road keeps its nearest point there");
    };
    const racerAt = (off: number) => {
      Object.assign(r.cars[0]!, at(off));
      r.beat();
      r.beat();
      return r.police.chasers(r.cars, []).map((c) => c.id);
    };
    expect(firstMismatch(racerAt(60), [1]), "unit 2 woke for a racer 60 m off the road").toBeUndefined();
    // Control: the same pass on the road itself wakes it.
    expect(firstMismatch(racerAt(0), [1, 2]), "the rig's pass never wakes unit 2: the test proves nothing").toBeUndefined();
  });
});

describe("given a pack-mate guard (the check that keeps a cop from driving into a cop of its own pack) on a cop driving 27 m/s along +z, steering 0.2 and at full throttle", () => {
  /** Unit 1 at the origin doing 27 m/s along +z, steering 0.2; the mate by default dead ahead, 40 m on, facing it (a hit in 1.1 s). */
  const meet = (pullsOut: (unit: number) => boolean, mate = { x: 0, z: 40, yaw: Math.PI }) => {
    const cars: AiCar[] = [0, 1, 2].map(blankAiCar);
    Object.assign(cars[1]!, { x: 0, z: 0, vx: 0, vz: 27, yaw: 0 });
    Object.assign(cars[2]!, { ...mate, vx: 0, vz: 0 });
    const out = { ...idleDrive(), throttle: 1, steer: 0.2 };
    guardMates(cars[1]!, cars, 1, 2, out, pullsOut);
    return out;
  };

  it("when a mate 40 m dead ahead is facing it and has only just woken (stopped, but it pulls out), then the cop steers away and cuts its throttle for the head-on hit about 1.1 s away", () => {
    const out = meet(() => true);
    expect(out.steer, `steer ${out.steer} not bent away from the mate`).toBeLessThan(0.2);
    expect(out.throttle, "no braking for a head-on in 1.1 s").toBeLessThan(1);
  });

  it("when a mate beside the path with its nose across it cannot pull out (parked at its stakeout, stored, knocked out), then it is read as stopped and the steer is left alone, but the same mate pulling out is steered away from", () => {
    // 8 m to the left, nose across the path: pulling out at 8 m/s it would be hit in 1.1 s; parked it is 8 m off.
    const mate = { x: -8, z: 30, yaw: Math.PI / 2 };
    expect(meet(() => false, mate).steer).toBe(0.2);
    expect(meet(() => true, mate).steer, "the geometry never makes a pulling-out mate a threat: the test proves nothing").not.toBe(0.2);
  });

  it("when a parked mate stands 40 m ahead on the path, then the cop steers round it and cuts its throttle", () => {
    const out = meet(() => false);
    expect(out.steer, `steer ${out.steer} not bent away from the parked mate`).toBeLessThan(0.2);
    expect(out.throttle, "no braking for a parked car dead ahead in 1.5 s").toBeLessThan(1);
  });

  it("when a mate stands 14 m ahead in its path and the cop is itself braking at 20 m/s, then it steers round and brakes harder, but a stopped cop and a reversing one are left alone and the same cop on the throttle is steered round", () => {
    const through = (throttle: number, brake: number, vz: number) => {
      const cars: AiCar[] = [0, 1, 2].map(blankAiCar);
      Object.assign(cars[1]!, { x: 0, z: 0, vx: 0, vz, yaw: 0 });
      Object.assign(cars[2]!, { x: 0, z: 14, vx: 0, vz: 0, yaw: Math.PI });
      const out = { ...idleDrive(), throttle, brake, steer: 0.2 };
      guardMates(cars[1]!, cars, 1, 2, out, () => false);
      return out;
    };
    const braking = through(0, 0.5, 20);
    expect(braking.steer < 0.2 && braking.brake > 0.5, `a braking car at 20 m/s was left to hit a stopped mate 14 m ahead: steer ${braking.steer}, brake ${braking.brake}`).toBeTruthy();
    // Controls: a stopped car and a reversing one are left alone, and the same car on the throttle is read.
    const stopped = through(0, 1, 0);
    expect(stopped.steer === 0.2 && stopped.brake === 1, "a stopped car was steered or braked by the guard").toBeTruthy();
    expect(through(-1, 0, 20).steer, "a reversing car was steered").toBe(0.2);
    expect(through(1, 0, 20).steer, "the geometry never makes the guard act on a car on the throttle: the test proves nothing").toBeLessThan(0.2);
  });

  it("when a mate passing alongside would be reached sooner (a graze 0.2 s away) and a just-woken mate is 6 m ahead with its nose at the cop (a hit 0.35 s away), then the cop still brakes for the one it would hit", () => {
    const cars: AiCar[] = [0, 1, 2, 3].map(blankAiCar);
    // Unit 1 doing 9 m/s along +z. Unit 2 overtaking 5 m to its left, a little behind, closest in 0.2 s at 5.0 m (a graze); unit 3 just woken, 6 m ahead and 3 m to its right, nose at it (a hit in 0.35 s).
    Object.assign(cars[1]!, { x: 0, z: 0, vx: 0, vz: 9, yaw: 0 });
    Object.assign(cars[2]!, { x: -5, z: -3, vx: 0, vz: 25, yaw: 0 });
    Object.assign(cars[3]!, { x: 3, z: 6, vx: 0, vz: 0, yaw: Math.PI });
    const out = { ...idleDrive(), throttle: 1, steer: 0 };
    guardMates(cars[1]!, cars, 1, 3, out, () => true);
    expect(out.brake, `brake ${out.brake}: the mate 0.35 s ahead was not braked for`).toBeGreaterThan(0.5);
  });

  it("when a pulling-out mate is dead ahead, then the cop lifts off the throttle without braking and drops its boost, but for a mate passing 5 m off (a graze) it lifts off the throttle and keeps its boost", () => {
    const boosting = (x: number) => {
      const cars: AiCar[] = [0, 1, 2].map(blankAiCar);
      Object.assign(cars[1]!, { x: 0, z: 0, vx: 0, vz: 27, yaw: 0 });
      Object.assign(cars[2]!, { x, z: 40, vx: 0, vz: 0, yaw: Math.PI });
      const out = { ...idleDrive(), throttle: 1, steer: 0.2, boost: true };
      guardMates(cars[1]!, cars, 1, 2, out, () => true);
      return out;
    };
    const hit = boosting(0);
    expect(hit.throttle < 1 && hit.brake === 0, "the geometry never makes the guard lift the throttle short of the brake: the test proves nothing").toBeTruthy();
    expect(hit.boost).toBe(false);
    const graze = boosting(5);
    expect(graze.throttle, "the geometry never makes the guard act on the graze: the test proves nothing").toBeLessThan(1);
    expect(graze.boost).toBe(true);
  });

  it("when the cop at 50 m/s is steering full lock that swings it 30 m clear of a parked mate far ahead, then the guard does not cancel that steer, but it steers round a mate when the cop holds straight on or when a mate 15 m ahead leaves no room to swing clear in time", () => {
    const yaw = 0.2;
    const v = 50;
    // A parked mate `ahead` m along the car's line and 4.5 m off it, to the side a positive steer turns toward.
    const through = (steer: number, ahead: number) => {
      const cars: AiCar[] = [0, 1, 2].map(blankAiCar);
      Object.assign(cars[1]!, { x: 0, z: 0, vx: Math.sin(yaw) * v, vz: Math.cos(yaw) * v, yaw });
      Object.assign(cars[2]!, { x: Math.sin(yaw) * ahead + Math.cos(yaw) * 4.5, z: Math.cos(yaw) * ahead - Math.sin(yaw) * 4.5, yaw: yaw + Math.PI });
      const out = { ...idleDrive(), throttle: 1, steer };
      guardMates(cars[1]!, cars, 1, 2, out, () => false);
      return out;
    };
    expect(through(1, 90).steer, "the guard bent a full-lock steer that swings the car 30 m clear of the mate by the time it gets there").toBe(1);
    // Controls: the same mate against a car holding straight on, and against the same steer with no room to use it, is steered round.
    expect(through(0, 90).steer, "the geometry never makes the guard act on a car holding straight on: the test proves nothing").toBeLessThan(-0.5);
    expect(through(1, 15).steer, "the guard let a car steer into a mate 0.3 s ahead on the strength of a swing that cannot clear it in time").toBeLessThan(0.5);
  });

  it("when a pack-mate dead ahead is still parked, then the cop's steer is exactly what it is with no mate there, and once that mate is knocked into motion and wakes the guard changes the steer", () => {
    const r = rig();
    const me = r.cars[1]!;
    const ahead = { x: me.x + Math.sin(me.yaw) * 40, z: me.z + Math.cos(me.yaw) * 40, yaw: me.yaw + Math.PI };
    // dt 0: the lead-in's own timer (and so its aim blend) does not move between the reads.
    const steer = (): number => r.police.think(me, r.cars, 0).steer;
    Object.assign(r.cars[2]!, { x: 4000, z: 4000 });
    const alone = steer();
    Object.assign(r.cars[2]!, ahead);
    expect(steer(), "a parked mate bent the lead-in's steering").toBe(alone);
    // Control: the same mate, knocked into motion, wakes (state pursuit) and the guard does read it.
    Object.assign(r.cars[2]!, { vx: 5 });
    r.beat();
    expect(steer(), "the rig's geometry never makes the guard act: the test proves nothing").not.toBe(alone);
  });
});

describe("given two packs of cops, each with a parked stakeout, and a racer passing both in one beat", () => {
  it("when both packs call a reinforcement in the same beat, then they park more than 10 m apart", () => {
    let doubled = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const cars: AiCar[] = Array.from({ length: 7 }, (_, i) => blankAiCar(i));
      const hunt = new Uint8Array(7);
      hunt[0] = 1;
      // The engine's `park` moves the car; the snapshot `cars` holds is only refreshed after the beat.
      const placed: { id: number; x: number; z: number }[] = [];
      const everPlaced = new Map<number, { x: number; z: number }>();
      const world: HunterWorld = {
        park: (id, x, _y, z) => placed.push({ id, x, z }),
        store: () => {},
        down: () => false,
        speed: (id) => hypot2(cars[id]!.vx, cars[id]!.vz),
        sirens: () => {},
        hidden: () => false,
      };
      const police = new PoliceBrain(track, new RaceBrain(track, 1), 1, 6, seed);
      const lead = track.length * 0.4;
      let time = 0;
      const beat = () => {
        police.update(time, BEAT, cars, hunt, lead, world);
        time += BEAT;
      };
      const refresh = () => {
        for (const p of placed) {
          Object.assign(cars[p.id]!, p);
          everPlaced.set(p.id, p);
        }
        placed.length = 0;
      };
      const start = track.pointAt(lead, pt);
      Object.assign(cars[0]!, { x: start.x, z: start.z });
      // Two stakeouts parked, the second one a beat after the first stored its dice.
      for (let n = 0; n < 100 && everPlaced.size < 4; n++) {
        beat();
        refresh();
      }
      expect(everPlaced.size, `seed ${seed}: two stakeouts parked`).toBe(4);
      // One racer passes both packs' first spots in one beat (so both wake, and both call their reinforcement in the same beat 5 s on);
      // stakeouts further apart than a pass covers are skipped.
      const arcs = [...everPlaced.values()].map((p) => track.project(p.x, p.z, -1, blankProjection()).s);
      const pack0 = Math.min(arcs[0]!, arcs[1]!);
      const pack1 = Math.min(arcs[2]!, arcs[3]!);
      if (Math.abs(pack0 - pack1) > 20) continue;
      const at = track.pointAt(Math.max(pack0, pack1) + 3, pt);
      Object.assign(cars[0]!, { x: at.x, z: at.z });
      for (let n = 0; n < 60; n++) {
        beat();
        if (placed.length > 1) {
          doubled++;
          const [a, b] = placed;
          expect(Math.hypot(a!.x - b!.x, a!.z - b!.z), `seed ${seed}: two reinforcements parked ${Math.hypot(a!.x - b!.x, a!.z - b!.z).toFixed(1)} m apart in one beat`).toBeGreaterThan(10);
        }
        refresh();
      }
    }
    expect(doubled, `only ${doubled} beats called two reinforcements: the test proves nothing`).toBeGreaterThanOrEqual(2);
  });
});

/** Where a spot lies against a racer: straight-line metres, and metres of road it is ahead of the racer (negative: behind it). */
function against(racer: { x: number; z: number }, spot: { x: number; z: number }) {
  const proj = blankProjection();
  const along = track.project(spot.x, spot.z, -1, proj).s - track.project(racer.x, racer.z, -1, proj).s;
  return { dist: Math.hypot(spot.x - racer.x, spot.z - racer.z), ahead: along - track.length * Math.round(along / track.length) };
}

function racerSees(racer: { x: number; z: number }, spot: { x: number; z: number }): boolean {
  const { dist, ahead } = against(racer, spot);
  return dist < SIGHT.near || (ahead > -SIGHT.behind && ahead < SIGHT.ahead);
}

describe("given a racer on the road with stakeouts parked for it and a reinforcement called once a woken cop has stayed beside it", () => {
  it("when every spot a cop is put on is checked against the racer where it stood, then none is within its near range of it, none ahead of it within its sight along the road and none in its mirrors", () => {
    let reinforcements = 0;
    let spots = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = rig(4, seed);
      r.run(40);
      for (const park of r.parks) {
        spots++;
        const { dist, ahead } = against(park.racer, park);
        expect(!racerSees(park.racer, park), `seed ${seed}: unit ${park.id} put ${dist.toFixed(0)} m from the racer, ${ahead.toFixed(0)} m ahead of it along the road`).toBe(true);
      }
      if (r.parks.some((park) => park.id === 3)) reinforcements++;
    }
    expect(spots, `${spots} cops put on the road: the test proves nothing`).toBeGreaterThanOrEqual(18);
    expect(reinforcements, "no reinforcement was called: the test proves nothing").toBeGreaterThanOrEqual(1);
  });
});

describe("given a pack that has stood down (its racer stopped racing) with a cop of it still driving", () => {
  /** Unit 1 on the road `ahead` m along from the racer (car 0), moving. */
  const drive = (cars: readonly AiCar[], ahead: number) => {
    const s = track.project(cars[0]!.x, cars[0]!.z, -1, blankProjection()).s;
    const p = track.pointAt(s + ahead, pt);
    Object.assign(cars[1]!, { x: p.x, z: p.z, vx: 0, vz: 10 });
  };

  it("when the cop keeps driving 60 m from the racer in the camera's view for a minute, then it is never put away, and when it falls 150 m behind the racer out of the camera's view, then it is", () => {
    const r = rig();
    r.hunt[0] = 0;
    r.camera.sees = true;
    for (let n = 0; n < 60 / BEAT; n++) {
      drive(r.cars, 60);
      r.beat();
      expect(!r.stored.includes(1), `a cop moving 60 m from the racer was put away at ${r.clock().toFixed(2)} s`).toBe(true);
    }
    r.camera.sees = false;
    drive(r.cars, -150);
    r.beat();
    expect(r.stored.includes(1), "a cop 150 m behind the racer is put away").toBeTruthy();
  });
});

describe("given a stood-down pack's cop that keeps driving in a racer's sight along the road, with no other racer to take up", () => {
  /**
   * Seconds after the stakeout (`share` of the lap on `on`) the cop (kept `ahead` m along from the racer, moving) is put away, or Infinity within `limit` s;
   * the camera looks away from `lookAway` s on.
   */
  const goneAfter = (on: Track, share: number, ahead: number, limit: number, lookAway = Infinity): number => {
    const r = rig(2, 1, share, 1, on);
    r.hunt[0] = 0;
    const s = on.project(r.cars[0]!.x, r.cars[0]!.z, -1, blankProjection()).s;
    for (let n = 0; n < limit / BEAT; n++) {
      const p = on.pointAt(s + ahead, pt);
      Object.assign(r.cars[1]!, { x: p.x, z: p.z, vx: 0, vz: 10 });
      r.camera.sees = r.clock() < lookAway;
      r.beat();
      if (r.stored.includes(1)) return r.clock();
    }
    return Infinity;
  };

  // The ranges scale with the course: the oval and City (~0.7 km) a third of them, Four-Count (4 km) the full ones. Each racer sits before a straight,
  // so the cop's straight-line gap is its road gap.
  for (const [id, on, share] of [["oval", track, 0.4], ["four-count", new Track(fourCount), 0.4], ["city", new Track(city), 0.5]] as const) {
    it(`when the camera sees it on ${id}, then it is never put away, and once the camera looks away, then it is put away within a beat if it is clear of the racers' near range, and never inside it`, () => {
      const near = sightRange(on.length).near;
      const clear = near + 20 + 6;
      expect(goneAfter(on, share, clear, 120), "a cop the camera sees was put away").toBe(Infinity);
      const gone = goneAfter(on, share, clear, 120, 60);
      expect(gone > 60 && gone < 60 + 2 * BEAT, `a cop out of the camera's view went at ${gone} s, not as the camera looked away at 60 s`).toBeTruthy();
      expect(goneAfter(on, share, near, 120, 0), "a cop inside the near range was put away").toBe(Infinity);
    });
  }

  it("when it is doing 25 m/s, then it eases along the line however long it has been out, never stopping in the racers' path", () => {
    const r = rig();
    r.hunt[0] = 0;
    r.camera.sees = true;
    r.beat();
    Object.assign(r.cars[1]!, { vx: 0, vz: 25 });
    const young = r.police.think(r.cars[1]!, r.cars, 0);
    expect(young.brake < 0.5 && young.throttle > 0, `a young given-up cop braked: throttle ${young.throttle}, brake ${young.brake}`).toBeTruthy();
    r.run(120);
    const old = r.police.think(r.cars[1]!, r.cars, 0);
    expect(old.brake < 0.5 && old.throttle > 0, `a given-up cop out 120 s braked: throttle ${old.throttle}, brake ${old.brake}`).toBeTruthy();
  });
});

describe("given a stood-down pack's cop on the oval with a second racer on the course", () => {
  it("when the racer its pack gave up on drives behind it, then it does not take it up again, and when the other racer comes within ENGAGE m, then it takes that one up", () => {
    const r = rig(2, 1, 0.4, 2);
    r.camera.sees = true;
    const s = track.project(r.cars[2]!.x, r.cars[2]!.z, -1, blankProjection()).s;
    const behind = (racer: AiCar, ds: number) => {
      const p = track.pointAt(s - ds, pt);
      Object.assign(racer, { x: p.x, z: p.z });
    };
    r.hunt[0] = 0;
    r.beat();
    expect(r.police.copsOn(0), "the pack did not stand down").toBe(0);
    r.hunt[0] = 1;
    behind(r.cars[0]!, 20);
    r.run(5);
    expect(r.police.chasers(r.cars, []), "a cop took up the racer its pack gave up on").toHaveLength(0);
    r.hunt[1] = 1;
    behind(r.cars[1]!, 25);
    r.beat();
    expect(firstMismatch(r.police.chasers(r.cars, []).map((c) => c.id), [2]), "the given-up cop did not take up the other racer").toBeUndefined();
    expect(r.police.copsOn(1)).toBe(1);
  });
});

describe("given a woken cop the race's stall rule has asked to put away", () => {
  it("when it is driving 36 km/h 56 m from the racer in the camera's view, then it is not put away, and once it is stopped there, or driving out of every racer's sight, then it is", () => {
    const r = rig();
    r.camera.sees = true;
    const s = track.project(r.cars[0]!.x, r.cars[0]!.z, -1, blankProjection()).s;
    const place = (ahead: number, speed: number) => {
      const p = track.pointAt(s + ahead, pt);
      Object.assign(r.cars[1]!, { x: p.x, z: p.z, vx: 0, vz: speed });
    };
    place(56, 10);
    r.beat();
    r.police.recall(1, r.world);
    expect(r.stored.length, "a cop driving 36 km/h 56 m from the racer was recalled").toBe(0);
    place(56, 0);
    r.police.recall(1, { ...r.world, hidden: () => true });
    expect(firstMismatch(r.stored, [1]), "a stopped cop is recalled where it stands").toBeUndefined();
  });

  it("when it is stopped 5 m from the racer in the camera's view, then it is not put away, and once the camera no longer sees it, then it is, where it stands", () => {
    const r = rig();
    r.camera.sees = true;
    r.cars[1]!.vx = 0;
    r.cars[1]!.vz = 0;
    r.beat();
    r.police.recall(1, r.world);
    expect(r.stored.length, "a stuck cop the camera sees was recalled").toBe(0);
    r.camera.sees = false;
    r.police.recall(1, r.world);
    expect(firstMismatch(r.stored, [1]), "a stuck cop out of the camera's view is recalled").toBeUndefined();
  });

  it("when it is driving 36 km/h 400 m ahead of the racer, then it is put away", () => {
    const r = rig();
    const p = track.pointAt(track.project(r.cars[0]!.x, r.cars[0]!.z, -1, blankProjection()).s + 400, pt);
    Object.assign(r.cars[1]!, { x: p.x, z: p.z, vx: 0, vz: 10 });
    r.beat();
    r.police.recall(1, { ...r.world, hidden: () => true });
    expect(firstMismatch(r.stored, [1]), "a moving cop out of every racer's sight is recalled").toBeUndefined();
  });
});

describe("given a stakeout parked and its pack stood down half a second later, the racer far past it", () => {
  it("when the cops are younger than MIN_LIFE, then they stay, and when they have been on the road MIN_LIFE s, then they are put away", () => {
    const r = rig();
    r.hunt[0] = 0;
    r.sit(PAST_SIGHT);
    r.run(MIN_LIFE - 3);
    expect(r.stored.length, "a cop was put away before MIN_LIFE").toBe(0);
    r.run(4);
    expect(r.stored.includes(1) && r.stored.includes(2), "both cops are put away once MIN_LIFE has passed").toBeTruthy();
  });

  it("when the race is over (its clock stands still, the beats go on), then the cops are put away once they have been on the road MIN_LIFE s all the same", () => {
    const r = rig();
    r.hunt[0] = 0;
    r.sit(PAST_SIGHT);
    r.finish();
    r.run(MIN_LIFE - 3);
    expect(r.stored.length, "a cop was put away before MIN_LIFE").toBe(0);
    r.run(4);
    expect(r.stored.includes(1) && r.stored.includes(2), "both cops are put away once MIN_LIFE s of beats have passed").toBeTruthy();
  });

  it("when the racer is farther than OUT_RANGE away, then the cops are put away at once", () => {
    const r = rig();
    r.hunt[0] = 0;
    Object.assign(r.cars[0]!, { x: OUT_RANGE * 10, z: OUT_RANGE * 10 });
    r.run(1);
    expect(r.stored.includes(1) && r.stored.includes(2), "out of range, both go before MIN_LIFE").toBeTruthy();
  });

  it("when a cop is knocked out, then it is put away DOWN_STORE s on, before MIN_LIFE", () => {
    const r = rig();
    r.knockedOut.add(2);
    r.sit(PAST_SIGHT);
    r.beat();
    r.run(7);
    expect(r.stored.includes(2), "the wreck is put away before MIN_LIFE").toBeTruthy();
    expect(!r.stored.includes(1), "unit 1, not wrecked and younger than MIN_LIFE, stays").toBe(true);
  });
});
