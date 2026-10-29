import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { FLAT_GROUND, setGround } from "../world/ground.ts";
import { placeProps, propColliders } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { blankPoint, blankProjection, projectPath, Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { FRAME, frame, makeWorld } from "../world/race-world.test-util.ts";
import { addCars, aheadPoints, camUsable, CINE, CineCam, CLEAR, clearSpot, DutchCam, occluder, raceSight, sightLine, SightLines, type Occluder, type Sight } from "./spectate-cam.ts";
import { AutoCam, type AutoScene } from "./auto-cam.ts";
import { carFrame } from "../vehicle/car-rig.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { BELT_Y } from "./ragdoll-proxy.ts";
import { eyeProblems } from "./spectate-cam.test-util.ts";

/** The dutch cam's mounts: each wheel well, looking forward and back. */
const MOUNT_COUNT = carFrame(CAR_STYLES.sedan).wheels.length * 2;

const COURSES = TRACKS.map((j) => new Track(parseTrack(j)));
/** The per-commit cases run the oval's lap; `spectate-cam.ai-long-run.ts` runs every course's. */
const OVAL_ONLY = COURSES.filter((c) => c.id === "oval");
/** How fast the watched car drives round the course (m/s). */
const WATCHED_SPEED = 30;
/** How far apart (m along the course) the two cars of the cut test drive: a pack's length. */
const PAIR_GAP = 12;
const scene = new THREE.Scene();

describe("given the trackside cinematic camera (a fixed eye beside the course that cuts to the followed car)", () => {
  for (const track of OVAL_ONLY) {
    it(`when a lap is driven on ${track.id}, then every spot the camera picks stands clear of every solid and sees the car`, (t) => {
      const placed = placeProps(track);
      const cols = propColliders(placed);
      const sight = raceSight(track, placed);
      const ground = track.ground();
      setGround(ground);
      try {
        const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "watched" }, scene, null);
        const cine = new CineCam();
        const pt = blankPoint();
        let spots = 0;
        let found = 0;
        let worst = 0;
        let total = 0;
        const bad: string[] = [];
        for (let s = 0; s < track.length; s += 8) {
          track.pointAt(s, pt);
          car.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), 30);
          car.group.position.y = ground.heightAt(pt.x, pt.z, pt.y + 0.5);
          spots++;
          const t0 = performance.now();
          const ok = cine.pick(sight, car) === "found";
          const ms = performance.now() - t0;
          worst = Math.max(worst, ms);
          total += ms;
          if (!ok) continue;
          found++;
          const e = cine.eye;
          for (const why of eyeProblems(track, cols, e, car.group.position)) bad.push(`s ${s}: ${why}`);
          if (e.y - ground.heightAt(e.x, e.z, e.y) > CINE.heights.at(-1)! + 0.01) bad.push(`s ${s}: eye ${e.y.toFixed(1)} m too high`);
        }
        t.annotate(`${track.id}: ${found}/${spots} spots framed, pick ${(total / spots).toFixed(2)} ms mean, ${worst.toFixed(2)} ms worst`);
        expect(bad).toHaveLength(0);
        expect(found, `${track.id}: only ${found}/${spots} spots found a clear eye`).toBeGreaterThanOrEqual(spots * 0.9);
      } finally {
        setGround(null);
      }
    });
  }

  it("when the oval is driven at 40 m/s, then the camera holds a shot until shortly after the car passes the eye, then picks the next spot ahead", () => {
    const track = COURSES.find((c) => c.id === "oval")!;
    const sight = raceSight(track, placeProps(track));
    const ground = track.ground();
    setGround(ground);
    try {
      const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "watched" }, scene, null);
      const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 900);
      const cine = new CineCam();
      const pt = blankPoint();
      const v = 40;
      const dt = FRAME;
      track.pointAt(0, pt);
      car.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), v);
      const L = track.length;
      const eye = new THREE.Vector3();
      const look = new THREE.Vector3();
      let shots = 0;
      let passedAt = -1;
      let shotAt = 0;
      let eyeS = 0;
      for (let i = 0; i * dt * v < L; i++) {
        const s = i * dt * v;
        track.pointAt(s, pt);
        car.group.position.set(pt.x, ground.heightAt(pt.x, pt.z, pt.y + 0.5), pt.z);
        car.velocity.set(pt.tx * v, 0, pt.tz * v);
        // The first search may take a few frames (a spot's sight lines go on over them): the trackside cam has no shot yet.
        if (!cine.update(camera, car, () => sight, dt)) {
          expect(shots === 0 && i < 10, `no shot at frame ${i}`).toBeTruthy();
          continue;
        }
        const p = car.group.position;
        if (!cine.eye.equals(eye)) {
          if (shots > 0) {
            const held = (i - shotAt) * dt;
            // Cut: CINE.after s after the car passed the eye (0.1 s of slack: the eye's pass plane is square to the
            // course at the spot, so on a bend it differs a little from the arc length), or the shot's time limit.
            expect(passedAt >= 0 ? Math.abs((i - passedAt) * dt - CINE.after) <= 0.1 : held >= CINE.maxShot - dt, `cut at frame ${i}: passed ${passedAt}, held ${held.toFixed(2)} s`).toBeTruthy();
          }
          // The new eye stands ahead of the car along the course.
          eyeS = projectPath(track.path, cine.eye.x, cine.eye.z, -1, blankProjection()).s;
          const ahead = (((eyeS - s) % L) + L) % L;
          expect(ahead > 0 && ahead < CINE.lead[1]! * 1.5, `eye ${ahead.toFixed(1)} m ahead`).toBeTruthy();
          eye.copy(cine.eye);
          shots++;
          shotAt = i;
          passedAt = -1;
        }
        // Passed: the car's arc length is beyond the eye's.
        if (passedAt < 0 && (((s - eyeS) % L) + L) % L < L / 2) passedAt = i;
        // The lens stays on the car.
        expect(camera.position.equals(cine.eye)).toBeTruthy();
        camera.getWorldDirection(look);
        const to = new THREE.Vector3(p.x, p.y + CINE.aimUp, p.z).sub(camera.position).normalize();
        expect(look.dot(to), `frame ${i} looks ${Math.acos(Math.min(1, look.dot(to))).toFixed(4)} rad off the car`).toBeGreaterThan(0.9999);
      }
      expect(shots, `${shots} shots in a lap`).toBeGreaterThanOrEqual(6);
    } finally {
      setGround(null);
    }
  });

  it("when the oval search is sliced into budgets of 40 samples, then it lands on the same spot as the whole search picks", () => {
    const track = COURSES.find((c) => c.id === "oval")!;
    const sight = raceSight(track, placeProps(track));
    const ground = track.ground();
    setGround(ground);
    try {
      const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "watched" }, scene, null);
      const whole = new CineCam();
      const sliced = new CineCam();
      const pt = blankPoint();
      let spots = 0;
      let manySlices = 0;
      for (let s = 0; s < track.length; s += 40) {
        track.pointAt(s, pt);
        car.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), 30);
        car.group.position.y = ground.heightAt(pt.x, pt.z, pt.y + 0.5);
        const a = whole.pick(sight, car);
        let b = sliced.pick(sight, car, 40);
        let slices = 1;
        for (; b === "more"; slices++) b = sliced.pick(sight, car, 40);
        spots++;
        if (slices > 1) manySlices++;
        expect(b, `s ${s}: whole ${a}, sliced ${b}`).toBe(a);
        if (a === "found") expect(sliced.eye.equals(whole.eye), `s ${s}: another spot`).toBeTruthy();
      }
      expect(manySlices, `only ${manySlices}/${spots} searches took more than one slice`).toBeGreaterThanOrEqual(spots / 2);
    } finally {
      setGround(null);
    }
  });
});

describe("given the wheel-well dutch camera (an eye mounted in each wheel well, looking forward and back)", () => {
  it("when a one-lap oval race with four rivals is watched, then it keeps at least as many rivals in view as any one fixed wheel well does", (t) => {
    const w = makeWorld();
    try {
      w.race.enter();
      w.race.command({ type: "options", options: { trackId: "oval", laps: 1, aiCount: 4, spectate: true } });
      w.race.reseed(3);
      w.race.command({ type: "start" });
      const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 900);
      const dutch = new DutchCam();
      const fixed = new Array<number>(MOUNT_COUNT).fill(0);
      let mine = 0;
      let cuts = 0;
      let last = dutch.mount;
      const state = { acc: 0 };
      const watched = w.seat.carIndex;
      for (let n = 0; n < 70 / FRAME; n++) {
        frame(w, state);
        const car = w.cars[watched]!;
        const rivals = w.live();
        dutch.update(camera, car, () => rivals, FRAME);
        if (dutch.mount !== last) cuts++;
        last = dutch.mount;
        // Sampled 4 times a second.
        if (n % 15 !== 0) continue;
        mine += dutch.seen(car, rivals, dutch.mount, camera);
        for (let j = 0; j < MOUNT_COUNT; j++) fixed[j]! += dutch.seen(car, rivals, j, camera);
      }
      t.annotate(`rival-samples in view: dutch ${mine}, fixed wells ${fixed.join(" ")}; ${cuts} cuts`);
      expect(cuts, `${cuts} cuts in 70 s`).toBeGreaterThanOrEqual(15);
      // The rivals trail the watched car for most of the lap, so the best fixed well (one looking back) sees nearly all of them at every sample
      // (1104 of the 1120 possible at reseed 3) and the cam, holding each cut 1.2-3.5 s, can trail it by a sample or two when a rival
      // slips out of the frame between its checks. Across reseeds 1-12 it ran from 3 under the best well to 28 over it. A cam that
      // cycled the wells blind averages the eight wells, 541 here, so a 1 % slack of the possible rival-samples keeps the property.
      const slack = Math.ceil(0.01 * 4 * 70 / FRAME / 15);
      for (let j = 0; j < MOUNT_COUNT; j++) expect(mine, `well ${j} kept ${fixed[j]} in view, the dutch cam ${mine} (slack ${slack})`).toBeGreaterThanOrEqual(fixed[j]! - slack);
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});

describe("given a 12 × 14 × 12 m building, yawed 0.3 rad, on open flat ground", () => {
  // One 12 × 14 × 12 m building, yawed 0.3 rad, on open flat ground.
  const yaw = 0.3;
  const sight: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0.6, rim: Infinity, occ: [occluder(0, 0, yaw, 6, 6, false, 0, 14)] };
  /** A point `d` m out of the building's face `side` (0..3), `slide` m along it, at height y. */
  const off = (side: number, d: number, slide: number, y: number): [number, number, number] => {
    const a = yaw + (side * Math.PI) / 2;
    return [(6 + d) * Math.cos(a) - slide * Math.sin(a), y, -(6 + d) * Math.sin(a) - slide * Math.cos(a)];
  };

  it("when camera spots are tested around it, then a spot is rejected inside the building, within 1.9 m of any face or roof and at ground level, and accepted in the open", () => {
    expect(clearSpot(sight, 0, 1.5, 0), "inside").toBe(false);
    for (let side = 0; side < 4; side++) {
      for (const slide of [0, 4]) {
        expect(clearSpot(sight, ...off(side, 1.9, slide, 1.5)), `side ${side} slide ${slide}: 1.9 m off the face`).toBe(false);
        expect(clearSpot(sight, ...off(side, 2.6, slide, 1.5)), `side ${side} slide ${slide}: 2.6 m off the face`).toBe(true);
      }
    }
    expect(clearSpot(sight, 0, 15.5, 0), "1.5 m over the roof").toBe(false);
    expect(clearSpot(sight, 0, 17, 0), "3 m over the roof").toBe(true);
    expect(clearSpot(sight, 40, 0.1, 0), "on the ground").toBe(false);
    expect(clearSpot(sight, 40, 1.5, 0), "open air").toBe(true);
  });

  it("when an eye and a target are tested for sight, then the building between them blocks, and so does the car driving behind it within the look-ahead time", () => {
    const eye = { x: -30, y: 1.5, z: 0 };
    const target = { x: 30, y: 0.7, z: -45 };
    const still = { x: 0, y: 0, z: 0 };
    const north = { x: 0, y: 0, z: 25 };
    expect(camUsable(sight, eye, { x: 30, y: 0.7, z: 0 }, still, 0), "building in the line").toBe(false);
    expect(camUsable(sight, eye, target, still, 2), "open line to a still car").toBe(true);
    expect(camUsable(sight, eye, target, north, 1), "1 s on it is still at z -20, clear of the building").toBe(true);
    expect(camUsable(sight, eye, target, north, 2), "2 s on it is behind the building").toBe(false);
    expect(camUsable(sight, { x: 0, y: 1.5, z: 0 }, target, still, 0), "eye inside the building").toBe(false);
  });

  it("when a lamp post stands near the eye or the sight line, then a post on the line or within 2 m of the eye rejects the view and one well beside both does not", () => {
    const eye = { x: -10, y: 1.5, z: 0 };
    const target = { x: 0, y: 0.7, z: 0 };
    const still = { x: 0, y: 0, z: 0 };
    const post = (x: number, z: number): Sight => ({ ...sight, occ: [occluder(x, z, 0, 0.45, 0.45, true, 0, 5.3)] });
    expect(camUsable(post(-5, 0), eye, target, still, 0), "on the sight line").toBe(false);
    expect(camUsable(post(-5, 0.6), eye, target, still, 0), "0.6 m off the sight line (its head and arm reach 0.45 m)").toBe(false);
    expect(camUsable(post(-5, 1.2), eye, target, still, 0), "1.2 m off the sight line, 5 m from the eye").toBe(true);
    expect(camUsable(post(-9, 1.5), eye, target, still, 0), "1.8 m beside the eye").toBe(false);
    expect(camUsable(post(-10, 3.2), eye, target, still, 0), "3.2 m beside the eye").toBe(true);
  });

  it("when a sight check is run one line at a time, then it answers as the whole check does and no slice runs past one line", () => {
    const eye = { x: -30, y: 1.5, z: 0 };
    const still = { x: 0, y: 0, z: 0 };
    const north = { x: 0, y: 0, z: 25 };
    const cases = [
      { target: { x: 30, y: 0.7, z: -45 }, vel: still, horizon: 2, clear: true },
      { target: { x: 30, y: 0.7, z: 0 }, vel: still, horizon: 0, clear: false },
      { target: { x: 30, y: 0.7, z: -45 }, vel: north, horizon: 1, clear: true },
      { target: { x: 30, y: 0.7, z: -45 }, vel: north, horizon: 2, clear: false },
    ];
    const lines = new SightLines();
    for (const c of cases) {
      expect(camUsable(sight, eye, c.target, c.vel, c.horizon)).toBe(c.clear);
      expect(lines.begin(sight, eye, c.target, c.vel, c.horizon)).toBe(true);
      let slices = 1;
      let r = lines.run(1);
      for (; r === "more"; slices++) {
        expect(lines.spent, `a slice took ${lines.spent} samples`).toBeLessThanOrEqual(80);
        r = lines.run(1);
      }
      expect(r === "clear", `horizon ${c.horizon}`).toBe(c.clear);
      expect(lines.active).toBe(false);
      if (c.vel === north && c.clear) expect(slices, `${slices} slices for the ${c.horizon} s horizon`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("given the oval course and a car driving across it", () => {
  it("when the car's position is predicted ahead, then the samples follow the course, not the straight line of its velocity", () => {
    const track = COURSES.find((c) => c.id === "oval")!;
    const open = raceSight(track, placeProps(track));
    setGround(track.ground());
    try {
      const pt = blankPoint();
      const pr = blankProjection();
      const out = new Float64Array(3 * (CLEAR.most + 1));
      let bends = 0;
      for (let s = 0; s < track.length; s += 10) {
        track.pointAt(s, pt);
        const n = aheadPoints(open, pt.x, pt.y + 0.5, pt.z, pt.tx * 40, pt.tz * 40, 4, out);
        expect(n >= 1 && n <= CLEAR.most + 1, `s ${s}: ${n} samples`).toBeTruthy();
        for (let i = 0; i < n; i++) expect(Math.abs(projectPath(track.path, out[3 * i]!, out[3 * i + 2]!, -1, pr).lateral), `s ${s}: sample ${i} is ${pr.lateral.toFixed(1)} m off the course`).toBeLessThan(1);
        // The straight on its velocity leaves the road there: the prediction is not that line.
        const lat = Math.abs(projectPath(track.path, pt.x + pt.tx * 160, pt.z + pt.tz * 160, -1, pr).lateral);
        if (lat > 10) bends++;
      }
      expect(bends, "no bend in the lap leaves the straight 10 m off the road").toBeGreaterThan(0);
    } finally {
      setGround(null);
    }
  });
});

describe("given the Auto spectator camera (the shot director that cuts between shot kinds while watching a race)", () => {
  for (const track of OVAL_ONLY) {
    it(`when a car drives 90 s round ${track.id} at ${WATCHED_SPEED} m/s, then every trackside or high cut stands clear and sees the car, and the cuts mix shot kinds`, (t) => {
      const placed = placeProps(track);
      const cols = propColliders(placed);
      const sight = raceSight(track, placed);
      const ground = track.ground();
      setGround(ground);
      try {
        const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "watched" }, scene, null);
        const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 900);
        const auto = new AutoCam();
        const autoScene: AutoScene = { sight: () => sight, rivals: () => [], cut: (c) => c };
        const pt = blankPoint();
        const kinds = new Set<string>();
        const bad: string[] = [];
        let cuts = 0;
        let playing: typeof auto.shot = null;
        let checked = 0;
        for (let n = 0; n < 90 / FRAME; n++) {
          track.pointAt((n * FRAME * WATCHED_SPEED) % track.length, pt);
          car.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), WATCHED_SPEED);
          car.group.position.y = ground.heightAt(pt.x, pt.z, pt.y + 0.5);
          auto.update(camera, car, autoScene, FRAME);
          if (auto.shot === playing) continue;
          playing = auto.shot;
          cuts++;
          const kind = auto.shot!.kind;
          kinds.add(kind);
          // A wheel mount rides the car and a chase pose has no spot to find: only the searched spots promise room and sight.
          if (kind === "chase" || kind === "dutch" || !auto.cam.found) continue;
          checked++;
          for (const why of eyeProblems(track, cols, camera.position, car.group.position)) bad.push(`cut ${cuts} (${kind}) at ${(n * FRAME).toFixed(1)} s: ${why}`);
        }
        t.annotate(`${track.id}: ${cuts} cuts in 90 s (${[...kinds].join(", ")}), ${checked} searched spots checked`);
        expect(bad).toHaveLength(0);
        expect(cuts, `${cuts} cuts in 90 s`).toBeGreaterThanOrEqual(8);
        expect(kinds.size, `only ${[...kinds].join(", ")}`).toBeGreaterThanOrEqual(3);
        expect(checked, `${checked} searched spots`).toBeGreaterThanOrEqual(3);
      } finally {
        setGround(null);
      }
    });
  }

  it("when the camera cuts onto another car, then the chase shot is posed on it while its opener is searched, not at the old shot's eye", () => {
    const track = COURSES.find((c) => c.id === "city")!;
    const sight = raceSight(track, placeProps(track));
    const ground = track.ground();
    setGround(ground);
    try {
      const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 900);
      const auto = new AutoCam();
      const pair = [new DeformableCar({ body: 0x808080, accent: 0x404040, name: "first" }, scene, null), new DeformableCar({ body: 0x808080, accent: 0x404040, name: "second" }, scene, null)];
      let watched = pair[0]!;
      // The Auto driver's cut: the other car of the pair.
      const autoScene: AutoScene = {
        sight: () => sight,
        rivals: () => pair,
        cut: (car) => {
          watched = car === pair[0] ? pair[1]! : pair[0]!;
          return watched;
        },
      };
      const pt = blankPoint();
      const bad: string[] = [];
      // The trackside or high shot a switch cuts away from, until the new car's opener lands.
      let held: typeof auto.shot = null;
      let checked = 0;
      for (let n = 0; n < 120 / FRAME; n++) {
        // The pair drives round the course a pack's length apart.
        for (const [k, car] of pair.entries()) {
          track.pointAt((n * FRAME * WATCHED_SPEED + k * PAIR_GAP) % track.length, pt);
          car.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), WATCHED_SPEED);
          car.group.position.y = ground.heightAt(pt.x, pt.z, pt.y + 0.5);
        }
        const was = watched;
        const before = auto.shot;
        const fixedEye = (before?.kind === "cine" || before?.kind === "high") && auto.cam.found;
        auto.update(camera, watched, autoScene, FRAME);
        if (watched !== was && fixedEye) held = before;
        if (held === null) continue;
        if (auto.shot !== null && auto.shot !== held) {
          held = null;
          continue;
        }
        checked++;
        const away = camera.position.distanceTo(watched.group.position);
        if (away > 12) bad.push(`at ${(n * FRAME).toFixed(2)} s the camera stands ${away.toFixed(1)} m from the new car`);
      }
      expect(bad).toHaveLength(0);
      expect(checked, `${checked} frames of a searched opener after a cut away from a fixed eye`).toBeGreaterThanOrEqual(3);
    } finally {
      setGround(null);
    }
  });

  it("when a wreck's velocity swings 4° a frame at 60 and 240 Hz, then the chase eye follows a low-passed heading and does not swing", (t) => {
    // Every spot is solid: every shot poses as the chase.
    const solidAll: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: 1, occ: [] };
    const autoScene: AutoScene = { sight: () => solidAll, rivals: () => [], cut: (car) => car };
    const swing = (4 * Math.PI) / 180;
    for (const hz of [60, 240]) {
      const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "wreck" }, new THREE.Scene());
      car.fwdFlat.set(0, 0, 1);
      const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 900);
      const auto = new AutoCam();
      const prevEye = new THREE.Vector3();
      const prevCar = new THREE.Vector3();
      let worst = 0;
      for (let n = 0; n < 15 * hz; n++) {
        // Driving straight at 20 m/s while the velocity's direction flips by 8 deg every frame.
        const a = n % 2 === 0 ? swing : -swing;
        car.velocity.set(20 * Math.sin(a), 0, 20 * Math.cos(a));
        car.group.position.set(0, 0, (20 * n) / hz);
        auto.update(camera, car, autoScene, 1 / hz);
        // The eye's step beyond the car's own, once the first shot has landed.
        if (auto.shot !== null && n > 5 * hz) worst = Math.max(worst, camera.position.clone().sub(prevEye).sub(car.group.position).add(prevCar).length());
        prevEye.copy(camera.position);
        prevCar.copy(car.group.position);
      }
      t.annotate(`${hz} Hz: the eye steps at most ${worst.toFixed(4)} m a frame beyond the car's own`);
      expect(worst, `${hz} Hz: the eye steps ${worst.toFixed(3)} m a frame beyond the car's own`).toBeLessThan(0.1);
    }
  });
});

describe("given the cars as the cinematic eye's solids", () => {
  it("when a line runs sideways across a sedan at belt height, then its body holds it under the belt, over the hood it is clear, its cabin holds it over the cabin's span, and a line a car-length-radius from its centre is clear", () => {
    const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "solid" }, scene, null);
    expect(car.fwdFlat.z, "the car faces +z").toBeGreaterThan(0.99);
    const occ: Occluder[] = [];
    addCars(occ, [car], null);
    const sight: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ };
    const { half, comY } = car.frame;
    const { rearGlass, windshield } = car.style;
    const hood = (windshield.base[1] + half.z) / 2;
    const cabin = (rearGlass.base[1] + windshield.base[1]) / 2;
    const across = (y: number, z: number): number => sightLine(sight, 6, y, z, -6, y, z);
    const belt = car.style.proxyBelt ?? BELT_Y;
    const margin = 0.5;
    expect(across(belt - margin, hood), "under the belt the hood holds the line").toBeLessThan(0);
    expect(across(belt + margin, hood), "over the hood the line is clear").toBeGreaterThanOrEqual(0);
    expect(across(comY + half.y - margin, cabin), "the cabin holds the line under its roof").toBeLessThan(0);
    expect(across(belt - margin, half.z + margin * 2), "past the nose the line is clear").toBeGreaterThanOrEqual(0);
    expect(sightLine(sight, half.z - 0.1, 0.5, 0, half.z + 3, 0.5, 0), "the old cylinder stood as wide as the car is long: a line along the beam's far side is clear").toBeGreaterThanOrEqual(0);
  });
});
