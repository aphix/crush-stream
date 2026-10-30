import { describe, expect, it } from "vitest";
import { assignClass, classStats, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import * as THREE from "three";
import { applyDrive, idleDrive } from "../vehicle/car-drive.ts";
import { must } from "../kernel/must.test-util.ts";
import { applyAiDrive } from "./input-fade.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { snapshotAiCar } from "../match/derby.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { setGround } from "../world/ground.ts";
import { Track, blankProjection, projectPath } from "../world/track.ts";
import { SPAWN_FAR, SPAWN_NEAR, TrafficBrain } from "./traffic.ts";
import city from "../world/tracks/city.json" with { type: "json" };
import { DT } from "../vehicle/test-support.ts";

const track = new Track(city);

function cars(n: number, scene: THREE.Scene): DeformableCar[] {
  return Array.from({ length: n }, (_, i) => new DeformableCar({ body: 0x808080, accent: 0x404040, name: `t${i}` }, scene, null, fleetStyle(i)));
}

/** Drive `fleet` (traffic cars `ids`, by default its indices) with `brain` for `seconds`; `sample(i, car)` every 6th step; car `frozen` stays parked. */
function run(brain: TrafficBrain, fleet: DeformableCar[], seconds: number, sample: (i: number, c: DeformableCar) => void, frozen = -1, ids = fleet.map((_, i) => i)): void {
  const ground = track.ground();
  setGround(ground);
  const snaps: AiCar[] = ids.map((id) => blankAiCar(id));
  const park = { ...idleDrive(), brake: 1 };
  for (let step = 0; step < seconds / DT; step++) {
    for (const [i, c] of fleet.entries()) snapshotAiCar(snaps[i]!, ids[i]!, c, true);
    for (const [i, c] of fleet.entries()) {
      if (i === frozen) applyDrive(c, park, DT);
      else applyAiDrive(c, brain.think(snaps[i]!, snaps, DT), DT);
      c.integrate(DT);
    }
    if (step % 6 === 0) for (const [i, c] of fleet.entries()) sample(i, c);
  }
  setGround(null);
}

describe("given the city track's ambient traffic (cars that drive the lanes around the player)", () => {
  const brain = new TrafficBrain(track, 0, 1);

  it("when the traffic is first laid out, then it fills the loop lanes and then every side street, each car in its lane facing its lane's direction", () => {
    expect(brain.count).toBe(4 + 4 + 4);
    const p = blankProjection();
    for (const [i, s] of brain.spawns().entries()) {
      const slot = brain.slotOf(i);
      projectPath(slot.path, s.x, s.z, -1, p);
      expect(Math.abs(p.lateral - slot.offset), `car ${i} lateral ${p.lateral.toFixed(2)} vs lane ${slot.offset}`).toBeLessThan(0.2);
      const along = Math.sin(s.yaw) * slot.path.tx[p.k]! + Math.cos(s.yaw) * slot.path.tz[p.k]!;
      expect(along * slot.dir, `car ${i} faces its lane direction`).toBeGreaterThan(0.95);
      if (slot.path === track.path) expect(p.s > 70 && p.s < track.length - 70, `loop car ${i} on the grid (s ${p.s.toFixed(0)})`).toBeTruthy();
    }
    expect(brain.slots.some((s) => s.path !== track.path && s.dir < 0) && brain.slots.some((s) => s.path !== track.path && s.dir > 0)).toBeTruthy();
  });

  it("when twelve traffic cars drive 50 s from their start lanes, then they stay in their lanes at least 90% of the time and the cross-street cars drive through all four of the race loop's junctions", () => {
    const scene = new THREE.Scene();
    const fleet = cars(12, scene);
    brain.reset();
    for (const [i, s] of brain.spawns().entries()) fleet[i]!.spawnFacing(s.x, s.z, s.yaw, 0);
    // Junction centres where a side street meets the loop.
    const junctions = [
      [0, 0],
      [180, 0],
      [120, 60],
      [120, -60],
    ];
    const crossed = new Set<string>();
    let inLane = 0;
    let samples = 0;
    const p = blankProjection();
    run(brain, fleet, 50, (i, c) => {
      const slot = brain.slotOf(i);
      projectPath(slot.path, c.group.position.x, c.group.position.z, -1, p);
      samples++;
      if (Math.abs(p.lateral - slot.offset) < 1.5) inLane++;
      if (slot.path === track.path) return;
      for (const [jx, jz] of junctions) if (Math.hypot(c.group.position.x - jx!, c.group.position.z - jz!) < 4) crossed.add(`${jx},${jz}`);
    });
    expect(inLane / samples, `in lane ${((inLane / samples) * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.9);
    expect(crossed.size, `junctions crossed: ${[...crossed].join(" ")}`).toBe(4);
  });

  it("when a car comes up on another stopped in its lane, then it stops behind it without touching, and after 8 more seconds has edged round it", () => {
    const scene = new THREE.Scene();
    const [mover, blocker] = cars(2, scene);
    const slot = brain.slotOf(0);
    brain.reset();
    const at = (s: number) => {
      const pt = track.pointAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
      return { x: pt.x + pt.tz * slot.offset, z: pt.z - pt.tx * slot.offset, yaw: Math.atan2(pt.tx, pt.tz) };
    };
    const a = at(200);
    const b = at(235);
    mover!.spawnFacing(a.x, a.z, a.yaw, brain.speed);
    blocker!.spawnFacing(b.x, b.z, b.yaw, 0);
    let minGap = Infinity;
    let stopped = false;
    run(brain, [mover!, blocker!], 6, (i, c) => {
      if (i !== 0) return;
      const gap = Math.hypot(c.group.position.x - blocker!.group.position.x, c.group.position.z - blocker!.group.position.z);
      minGap = Math.min(minGap, gap);
      if (c.velocity.length() < 0.5) stopped = true;
    }, 1);
    expect(stopped, "came to a stop").toBeTruthy();
    expect(minGap, `kept clear, closest ${minGap.toFixed(2)} m centre to centre`).toBeGreaterThan(4.6);
    run(brain, [mover!, blocker!], 8, () => {}, 1);
    const p = blankProjection();
    projectPath(track.path, mover!.group.position.x, mover!.group.position.z, -1, p);
    expect(p.s, `got past the blocker (s ${p.s.toFixed(1)})`).toBeGreaterThan(240);
  });

  it("when a loop car and a cross-street car head for the same junction to arrive together, then one waits for the other to cross: they never touch, and both are through within 12 s", () => {
    const [loopCar, streetCar] = cars(2, new THREE.Scene());
    brain.reset();
    // Slot 0 (a loop lane, heading +z there) and slot 4 (a harbour road lane, heading +x) cross at the (0, 0) junction.
    const ids = [0, 4];
    const p = blankProjection();
    const near = ids.map((id) => brain["placeAt"](id, projectPath(brain.slotOf(id).path, 0, 0, -1, p).s));
    const meet = { x: near[0]!.x, z: near[1]!.z };
    const starts = ids.map((id) => {
      const slot = brain.slotOf(id);
      return brain["placeAt"](id, projectPath(slot.path, meet.x, meet.z, -1, p).s - slot.dir * 30);
    });
    for (const [k, c] of [loopCar!, streetCar!].entries()) c.spawnFacing(starts[k]!.x, starts[k]!.z, starts[k]!.yaw, brain.speed);
    let closest = Infinity;
    // Two cars cross at a right angle without touching while their centres stay over a car length plus a width apart.
    run(brain, [loopCar!, streetCar!], 12, () => {
      closest = Math.min(closest, Math.hypot(loopCar!.group.position.x - streetCar!.group.position.x, loopCar!.group.position.z - streetCar!.group.position.z));
    }, -1, ids);
    expect(closest, `closest ${closest.toFixed(2)} m centre to centre`).toBeGreaterThan(4.6);
    for (const [k, c] of [loopCar!, streetCar!].entries()) {
      const slot = brain.slotOf(ids[k]!);
      const past = slot.dir * (projectPath(slot.path, c.group.position.x, c.group.position.z, -1, p).s - projectPath(slot.path, meet.x, meet.z, -1, p).s);
      expect(past, `car ${ids[k]} is ${past.toFixed(1)} m past the junction`).toBeGreaterThan(10);
    }
  });

  it("when a traffic car driving its lane is wrecked (crashed, its engine still running), then it stops driving and comes to rest", () => {
    const [car] = cars(1, new THREE.Scene());
    brain.reset();
    const start = brain["placeAt"](0, 200);
    car!.spawnFacing(start.x, start.z, start.yaw, brain.speed);
    setGround(track.ground());
    const snap = blankAiCar(0);
    for (let step = 0; step < 4 / DT; step++) {
      snapshotAiCar(snap, 0, car!, true);
      snap.crashed = true;
      applyAiDrive(car!, brain.think(snap, [snap], DT), DT);
      car!.integrate(DT);
    }
    setGround(null);
    expect(car!.velocity.length(), "speed after 4 s").toBeLessThan(0.3);
  });

  it("when a car comes up on a racer stopped in its lane and facing it, then after the wait it edges out to its own kerb, and for a blocker facing the same way it edges toward the road's centre instead", () => {
    const slot = brain.slotOf(0);
    const kerbSide = Math.sign(slot.offset);
    const at = (s: number) => {
      const pt = track.pointAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
      return { x: pt.x + pt.tz * slot.offset, z: pt.z - pt.tx * slot.offset, yaw: Math.atan2(pt.tx, pt.tz) };
    };
    // How far the car moves sideways from its lane (m) over 14 s (2.5 s to stop and wait, 4.5 s to edge): toward its own kerb, and toward the road's centre.
    const swing = (blockerTurn: number): { kerb: number; centre: number } => {
      const [mover, blocker] = cars(2, new THREE.Scene());
      brain.reset();
      const a = at(200);
      const b = at(235);
      mover!.spawnFacing(a.x, a.z, a.yaw, brain.speed);
      blocker!.spawnFacing(b.x, b.z, b.yaw + blockerTurn, 0);
      const p = blankProjection();
      const out = { kerb: 0, centre: 0 };
      run(brain, [mover!, blocker!], 14, (i, c) => {
        if (i !== 0) return;
        projectPath(track.path, c.group.position.x, c.group.position.z, -1, p);
        const toKerb = kerbSide * (p.lateral - slot.offset);
        out.kerb = Math.max(out.kerb, toKerb);
        out.centre = Math.max(out.centre, -toKerb);
      }, 1);
      return out;
    };
    const facing = swing(Math.PI);
    const sameWay = swing(0);
    expect(facing.kerb > 1 && facing.centre < 1, `facing blocker: ${facing.kerb.toFixed(2)} m toward its own kerb, ${facing.centre.toFixed(2)} m toward the centre`).toBeTruthy();
    expect(sameWay.centre > 2.5 && sameWay.kerb < 0.5, `same-way blocker: ${sameWay.centre.toFixed(2)} m toward the centre, ${sameWay.kerb.toFixed(2)} m toward its own kerb`).toBeTruthy();
  });

  it("when a car comes up on a racer stopped facing it, square in its lane or over toward its kerb where the edge round goes, then in 14 s it never touches it", () => {
    const slot = brain.slotOf(0);
    const kerbSide = Math.sign(slot.offset);
    const at = (s: number, off: number) => {
      const pt = track.pointAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
      return { x: pt.x + pt.tz * (slot.offset + off), z: pt.z - pt.tx * (slot.offset + off), yaw: Math.atan2(pt.tx, pt.tz) };
    };
    for (const off of [0, kerbSide * 1.2]) {
      const [mover, blocker] = cars(2, new THREE.Scene());
      brain.reset();
      const a = at(200, 0);
      const b = at(235, off);
      mover!.spawnFacing(a.x, a.z, a.yaw, brain.speed);
      blocker!.spawnFacing(b.x, b.z, b.yaw + Math.PI, 0);
      let closest = Infinity;
      run(brain, [mover!, blocker!], 14, () => {
        closest = Math.min(closest, Math.hypot(mover!.group.position.x - blocker!.group.position.x, mover!.group.position.z - blocker!.group.position.z));
      }, 1);
      // Nose to nose, two half lengths and a hand's breadth.
      expect(closest, `blocker ${off.toFixed(1)} m over: closest ${closest.toFixed(2)} m centre to centre`).toBeGreaterThan(4.6);
    }
  });

  it("when a racer comes at it head-on 2.3 m to the side of its lane, its door a hand's breadth from ours as they pass, then it brakes; 3 m to the side, it does not", () => {
    const slot = brain.slotOf(0);
    const toCentre = -Math.sign(slot.offset);
    const pt = (s: number) => track.pointAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
    const at = (id: number, s: number, off: number, yaw: number, speed: number): AiCar => {
      const p = pt(s);
      const heading = Math.atan2(p.tx, p.tz) + yaw;
      return { ...blankAiCar(id), x: p.x + p.tz * (slot.offset + off), z: p.z - p.tx * (slot.offset + off), yaw: heading, vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed };
    };
    const brakes = (off: number): number => {
      brain.reset();
      const self = at(0, 100, 0, 0, brain.speed);
      const racer = at(20, 112, toCentre * off, Math.PI, 30);
      let brake = 0;
      for (let step = 0; step < 0.5 / DT; step++) brake = Math.max(brake, brain.think(self, [self, racer], DT).brake);
      return brake;
    };
    expect(brakes(2.3), "2.3 m over").toBeGreaterThan(0);
    expect(brakes(3), "3 m over").toBe(0);
  });

  it("when a racer bears down on a car in its lane on an open stretch (head-on 30 m ahead, or from behind), then it holds to its own kerb without stopping, and with the racer beyond what the road shows it keeps its lane", () => {
    brain.reset();
    const slot = brain.slotOf(0);
    const kerb = slot.offset + Math.sign(slot.offset || 1) * 1.5;
    const pt = (s: number) => track.pointAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
    const at = (id: number, s: number, yaw: number, speed: number): AiCar => {
      const p = pt(s);
      const heading = Math.atan2(p.tx, p.tz) + yaw;
      return { ...blankAiCar(id), alive: true, x: p.x + p.tz * slot.offset, z: p.z - p.tx * slot.offset, yaw: heading, vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed };
    };
    const cases = [
      { it: "head-on", racer: at(20, 130, Math.PI, 30), expectedOffset: kerb },
      { it: "from behind", racer: at(20, 70, 0, 30), expectedOffset: kerb },
      { it: "out of view", racer: at(20, 230, Math.PI, 30), expectedOffset: slot.offset },
    ];
    for (const testCase of cases) {
      brain.reset();
      const self = at(0, 100, 0, brain.speed);
      let out = idleDrive();
      for (let step = 0; step < 0.5 / DT; step++) out = brain.think(self, [self, testCase.racer], DT);
      expect(Math.abs(brain["planOffset"][0]! - testCase.expectedOffset), `${testCase.it}: steers for offset ${brain["planOffset"][0]!.toFixed(2)}, expected ${testCase.expectedOffset.toFixed(2)}`).toBeLessThan(1e-9);
      expect(out.brake, `${testCase.it}: no braking`).toBe(0);
    }
  });

  it("when a car on the throttle stays pinned where it is, then after about a second it backs off in reverse", () => {
    brain.reset();
    const slot = brain.slotOf(0);
    const pt = track.pointAt(200, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
    const wedged: AiCar = { ...blankAiCar(0), alive: true, x: pt.x + pt.tz * slot.offset, z: pt.z - pt.tx * slot.offset, yaw: Math.atan2(pt.tx, pt.tz) };
    let reversedAt = -1;
    for (let step = 0; step < 4 / DT && reversedAt < 0; step++) {
      if (brain.think(wedged, [wedged], DT).throttle < 0) reversedAt = step * DT;
    }
    expect(reversedAt > 1 && reversedAt < 2, `backed off at ${reversedAt.toFixed(2)} s`).toBeTruthy();
  });

  it("when a put-away traffic car is asked for a spot, then it wakes on its lane inside the observer's spawn ring, at least 14 m from other cars, and gets no spot where the player is looking", () => {
    brain.reset();
    const id = 6;
    const observer = { ...blankAiCar(0), x: 0, z: -30 };
    const others = [observer, { ...blankAiCar(1), x: 2, z: 0 }];
    const spot = brain.spawnPoint(id, [observer], others, () => false);
    must(spot, "found a spot");
    const d = Math.hypot(spot.x - observer.x, spot.z - observer.z);
    expect(d >= SPAWN_NEAR && d <= SPAWN_FAR, `distance ${d.toFixed(1)}`).toBeTruthy();
    expect(Math.hypot(spot.x - 2, spot.z)).toBeGreaterThanOrEqual(14);
    expect(brain.spawnPoint(id, [observer], others, () => true), "never pops in where the player is looking").toBe(null);
  });

  // The loop lanes, driven by the slowest-turning classes: a brain that planned every car on the sedan's figures (1.5 rad/s, asphalt grip)
  // asked a monster (0.9 rad/s, mud tyres) for too little lock and too much corner speed.
  it("when the slowest-turning classes drive the loop lanes 40 s, each planned on its own class's figures, then each stays within its lane's 1.5 m all the way round", (t) => {
    const worst = (ownFigures: boolean): Map<VehicleClassId, number> => {
      const scene = new THREE.Scene();
      const classes: VehicleClassId[] = ["monster", "truck", "suv", "muscle"];
      const fleet = classes.map((cls, i) => {
        const c = new DeformableCar({ body: 0x808080, accent: 0x404040, name: `t${i}` }, scene, null, classStats(cls).style);
        assignClass(c, cls);
        return c;
      });
      brain.reset();
      for (const [i, s] of brain.spawns().slice(0, classes.length).entries()) {
        fleet[i]!.spawnFacing(s.x, s.z, s.yaw, 0);
        brain.setClass(i, classStats(ownFigures ? classes[i]! : "sedan"));
      }
      const off = new Map<VehicleClassId, number>();
      const p = blankProjection();
      run(brain, fleet, 40, (i, c) => {
        const slot = brain.slotOf(i);
        projectPath(slot.path, c.group.position.x, c.group.position.z, -1, p);
        off.set(classes[i]!, Math.max(off.get(classes[i]!) ?? 0, Math.abs(p.lateral - slot.offset)));
      });
      for (let i = 0; i < classes.length; i++) brain.setClass(i, classStats("sedan"));
      return off;
    };
    const own = worst(true);
    const sedan = worst(false);
    t.annotate(`worst off the lane (m), own figures / sedan's: ${[...own].map(([cls, d]) => `${cls} ${d.toFixed(2)} / ${sedan.get(cls)!.toFixed(2)}`).join(", ")}`);
    for (const [cls, d] of own) expect(d, `${cls} ${d.toFixed(2)} m off its lane`).toBeLessThan(1.5);
  });
});
