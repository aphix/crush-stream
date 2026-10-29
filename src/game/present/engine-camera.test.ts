import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, DriverSeat, idleDrive, type DriveInput, type SeatView } from "../vehicle/car-drive.ts";
import type { PadState } from "../vehicle/gamepad.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import { paint } from "../vehicle/test-support.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { FLAT_GROUND, Ground, setGround, STEP_UP } from "../world/ground.ts";
import { Spring, Spring3 } from "./spring.ts";
import { CHASE, DriveCam } from "./drive-cam.ts";
import { PLATFORM_CAMERA } from "../vehicle/car-styles/platform.ts";
import { LANDING } from "./landing.ts";
import { type CarPicker, ChaseCamera, RIDE_PAUSE, type SpecScene } from "./engine-camera.ts";
import { blankFreeInput, DRAG_PITCH_PER_PX, DRAG_YAW_PER_PX } from "./free-cam.ts";
import { CINE, occluder, solid, type Sight } from "./spectate-cam.ts";
import { FINE_HZ, FRAME_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const DT = 1 / FRAME_HZ;
const NO_PICK: CarPicker = { at: () => -1, choose() {} };

/** A canvas that is just an event target: the camera only listens and captures pointers. */
function fakeCanvas(): HTMLCanvasElement {
  const t = new EventTarget() as unknown as HTMLCanvasElement; // the camera uses addEventListener, style and pointer capture only
  Object.assign(t, { style: {}, setPointerCapture: () => {}, releasePointerCapture: () => {} });
  return t;
}

function pointer(canvas: HTMLCanvasElement, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void {
  canvas.dispatchEvent(Object.assign(new Event(type), { button: 0, pointerId: 1, clientX: x, clientY: y }));
}

function rig(mode: "drive" | "global" = "drive") {
  const canvas = fakeCanvas();
  const seat = new DriverSeat();
  seat.mode = mode;
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180);
  camera.position.set(4, 2, 6);
  const view = new ChaseCamera(camera, canvas, seat, { rx: 0, ry: 0 } as PadState, false, NO_PICK);
  view.attach();
  const look = new THREE.Vector3(0, 1, 0);
  return { canvas, camera, view, look };
}

describe("given the ride-along camera following a thrown driver's dummy", () => {
  it("when the player drags in the driver's seat, then the eye orbits the dummy, and the drag does not count as framing the shot, so the next throw still rides", () => {
    const { canvas, camera, view, look } = rig("drive");
    view.frameRide(look);
    pointer(canvas, "pointerdown", 100, 100);
    pointer(canvas, "pointermove", 60, 100);
    view.frameRide(look);
    view.orbit(DT, 0, false);
    const off = camera.position.clone().sub(look);
    expect(view.userFramed).toBe(false);
    // 40 px left turns the bearing by 0.2 rad about the dummy: the eye moves round it, not away from it.
    expect(Math.abs(Math.atan2(off.x, off.z) - Math.atan2(4, 6)), "the eye turned about the dummy").toBeGreaterThan(0.01);
  });

  it("when a drag goes far past the limits in the global view, then the eye stops at the orbit's pitch range, above the ground, however far the drag goes", () => {
    const { canvas, camera, view, look } = rig("global");
    view.frameRide(look);
    pointer(canvas, "pointerdown", 100, 100);
    for (const dy of [4000, -8000]) {
      pointer(canvas, "pointermove", 100, 100 + dy);
      for (let f = 0; f < 4 * FRAME_HZ; f++) view.orbit(DT, 0, false);
      const off = camera.position.clone().sub(look);
      const elev = Math.asin(off.y / off.length());
      expect(elev >= 0.079 && elev <= 1.221, `elevation ${elev.toFixed(3)} rad`).toBeTruthy();
      expect(off.y + look.y, "above the ground").toBeGreaterThan(0);
      pointer(canvas, "pointermove", 100, 100);
    }
    pointer(canvas, "pointerup", 100, 100);
  });
});

describe("given the ride-along's automatic cuts and a drag on its camera", () => {
  it("when the player drags, taps and starts a new ride, then cuts are held during the drag and for the ride pause after it, a tap holds nothing, and a new ride starts free", () => {
    const { canvas, view, look } = rig("global");
    const held = (on = true): boolean => view.rideHeld(on, DT);
    view.frameRide(look);
    expect(held(), "no drag yet").toBe(false);
    pointer(canvas, "pointerdown", 100, 100);
    expect(held(), "a pointer that has not moved is a click so far").toBe(false);
    pointer(canvas, "pointermove", 140, 100);
    for (let f = 0; f < 600; f++) expect(held(), "held for as long as the drag lasts").toBe(true);
    pointer(canvas, "pointerup", 140, 100);
    let heldFor = 0;
    while (held()) heldFor += DT;
    expect(Math.abs(heldFor - RIDE_PAUSE), `held ${heldFor.toFixed(2)} s after the drag, want ${RIDE_PAUSE}`).toBeLessThan(2 * DT);
    pointer(canvas, "pointerdown", 100, 100);
    pointer(canvas, "pointerup", 100, 100);
    expect(held(), "a tap").toBe(false);
    // A drag that ended just before the ride stopped must not hold the next ride.
    pointer(canvas, "pointerdown", 100, 100);
    pointer(canvas, "pointermove", 140, 100);
    held();
    pointer(canvas, "pointerup", 140, 100);
    expect(held()).toBe(true);
    expect(held(false), "the ride ended").toBe(false);
    expect(held(), "the next ride is free").toBe(false);
  });
});

describe("given the orbit camera around a ring of lamp posts", () => {
  /** An orbit round (3, 0.7, 0) on `posts`, its eye lowered to 1.8 m (level with the posts' lower half) by a held stick. */
  function lowOrbit(posts: readonly { intact: boolean; group: { visible: boolean; position: THREE.Vector3 } }[]) {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180);
    camera.position.set(4, 2, 6);
    const seat = new DriverSeat();
    seat.mode = "global";
    const pad = { rx: 0, ry: -1 } as PadState;
    const view = new ChaseCamera(camera, fakeCanvas(), seat, pad, false, NO_PICK);
    view.look.set(3, 0.7, 0);
    view.posts = posts;
    for (let f = 0; f < 120; f++) view.orbit(DT, 0, false);
    pad.ry = 0;
    return { camera, view };
  }

  it("when the orbit goes a whole turn at a low eye height, then the eye stays 3 m from every post of the 16 m ring, in steps within twice the plain orbit's", () => {
    const ring = Array.from({ length: 6 }, (_, i) => ({ intact: true, group: { visible: true, position: new THREE.Vector3(Math.sin((i / 6) * Math.PI * 2) * 16, 0, Math.cos((i / 6) * Math.PI * 2) * 16) } }));
    const spin = 0.32;
    const turn = (posts: typeof ring): { near: number; step: number } => {
      const { camera, view } = lowOrbit(posts);
      for (let f = 0; f < 120; f++) view.orbit(DT, spin, false);
      let near = Infinity;
      let step = 0;
      const last = camera.position.clone();
      for (let f = 0; f < Math.round((2 * Math.PI) / spin / DT); f++) {
        view.orbit(DT, spin, false);
        step = Math.max(step, last.distanceTo(camera.position));
        last.copy(camera.position);
        for (const p of ring) near = Math.min(near, Math.hypot(camera.position.x - p.group.position.x, camera.position.z - p.group.position.z, Math.max(0, camera.position.y - 5.3)));
      }
      return { near, step };
    };
    const plain = turn([]);
    expect(plain.near, `the plain orbit passes ${plain.near.toFixed(2)} m from a post (the test needs one close)`).toBeLessThan(1);
    const pushed = turn(ring);
    expect(pushed.near, `eye ${pushed.near.toFixed(2)} m from a post`).toBeGreaterThanOrEqual(3);
    expect(pushed.step, `step ${pushed.step.toFixed(3)} m a frame against ${plain.step.toFixed(3)} m plain`).toBeLessThanOrEqual(2 * plain.step);
  });

  it("when a post stands 1.5 m beside the resting eye, then only a standing, visible post pushes the eye: a hidden or knocked-over one does not", () => {
    const post = { intact: true, group: { visible: true, position: new THREE.Vector3() } };
    const { camera, view } = lowOrbit([]);
    const settle = (): void => {
      for (let f = 0; f < 300; f++) view.orbit(DT, 0, false);
    };
    settle();
    const rest = camera.position.clone();
    view.posts = [post];
    // A post 1.5 m beside the resting eye.
    post.group.position.set(rest.x + 1.5, 0, rest.z);
    settle();
    expect(camera.position.distanceTo(rest), "a post beside the eye leaves it where it was").toBeGreaterThan(1);
    post.group.visible = false;
    settle();
    expect(camera.position.distanceTo(rest), "a hidden post still pushes").toBeLessThan(0.01);
    post.group.visible = true;
    settle();
    expect(camera.position.distanceTo(rest), "the post is back and does not push").toBeGreaterThan(1);
    post.intact = false;
    settle();
    expect(camera.position.distanceTo(rest), "a knocked-over post still pushes").toBeLessThan(0.01);
  });
});

describe("given the derby's orbit round a car 4 m from the bowl's 38 m wall", () => {
  it("when the orbit goes a whole turn, then the eye stays 2 m inside the wall, so the wall never stands between it and the car", () => {
    const turn = (rim: number): number => {
      const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180);
      const seat = new DriverSeat();
      seat.mode = "global";
      const view = new ChaseCamera(camera, fakeCanvas(), seat, { rx: 0, ry: 0 } as PadState, false, NO_PICK);
      view.rim = rim;
      view.look.set(34, 0.7, 0);
      camera.position.set(30, 6, 0);
      const spin = 0.32;
      let far = 0;
      for (let f = 0; f < 120 + Math.round((2 * Math.PI) / spin / DT); f++) {
        view.orbit(DT, spin, false);
        if (f >= 120) far = Math.max(far, Math.hypot(camera.position.x, camera.position.z));
      }
      return far;
    };
    const plain = turn(Infinity);
    expect(plain, `the plain orbit reaches ${plain.toFixed(2)} m from the middle (the test needs it past the wall)`).toBeGreaterThan(38);
    const kept = turn(38);
    expect(kept, `eye ${kept.toFixed(2)} m from the middle`).toBeLessThanOrEqual(36 + 1e-9);
  });
});

describe("given the orbit kept clear of the scene's solids round a look that is itself inside one", () => {
  /** The followed car's look, 0.7 m over a sedan standing on flat ground at the origin (the engine's `followed.group.position.y + 0.7`). */
  const carLook = (): THREE.Vector3 => {
    const car = new DeformableCar(paint(), new THREE.Scene());
    assignClass(car, "sedan");
    car.spawnFacing(0, 0, 0, 0);
    return new THREE.Vector3(0, car.group.position.y + 0.7, 0);
  };
  /** The road under an overpass whose deck top stands 1 m over the look: the look is in the deck's slab (a surface within `STEP_UP` over a point is over it). */
  const overpass = (look: THREE.Vector3): Sight => {
    const g = new Ground();
    g.addPlane(0, -300, 300, -300, 300, Infinity);
    g.addPlane(look.y + 1, -300, 300, -5, 5, STEP_UP);
    return { ground: g, path: null, wallTop: 0, rim: Infinity, occ: [] };
  };
  /** A slope rising 1 in 2 toward +z from z = 0, and a look 0.7 m over the flat 2 m up it: 0.3 m under the slope. */
  const slope = (): Sight => {
    const g = new Ground();
    g.addPlane(0, -300, 300, -300, 300, Infinity);
    g.addFace(-300, 0, 0, 600, 300, 0, 0, 150, 150, Infinity);
    return { ground: g, path: null, wallTop: 0, rim: Infinity, occ: [] };
  };
  /** A ramp's 1.6 m block (a prop's box) the followed car has run into: the look is inside it. */
  const ramp: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ: [occluder(0, 0, 0, 2, 3, false, 0, 1.6)] };

  it("when the orbit goes a whole turn round a car under an overpass, at the foot of a rising slope and inside a ramp, then the eye stands outside every solid and never within the cinematic stop distance of the look", () => {
    const look = carLook();
    const cases: [string, Sight, THREE.Vector3][] = [
      ["overpass", overpass(look), look],
      ["slope", slope(), new THREE.Vector3(0, 0.7, 2)],
      ["ramp", ramp, look],
    ];
    const spin = 0.32;
    for (const [name, sight, at] of cases) {
      expect(solid(sight, at.x, at.y, at.z, 0), `${name}: the look is not inside a solid (the test needs it inside)`).toBeTruthy();
      const { camera, view } = rig("global");
      view.look.copy(at);
      camera.position.set(at.x, at.y + 5, at.z + 13);
      let near = Infinity;
      let buried = 0;
      for (let f = 0; f < 120 + Math.round((2 * Math.PI) / spin / DT); f++) {
        view.orbit(DT, spin, false, sight);
        const p = camera.position;
        near = Math.min(near, p.distanceTo(at));
        if (solid(sight, p.x, p.y, p.z, 0)) buried++;
      }
      expect(buried, `${name}: the eye stood inside a solid on ${buried} frames`).toBe(0);
      expect(near, `${name}: the eye came ${near.toFixed(2)} m from the look`).toBeGreaterThanOrEqual(CINE.stop);
    }
  });
});

describe("given the chase eye drifting toward a wall along the course", () => {
  it(`when the eye drifts into the wall's clearance at ${FRAME_HZ} and ${FINE_HZ} Hz, then it is pulled in smoothly, not by whole metres`, (t) => {
    // A wall along z with its face at x = 3. The car drives along z, drifting toward it, nose turned off it: the chase eye sits on the wall's side.
    const wall: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ: [occluder(53, 0, 0, 50, 2000, false, 0, 30)] };
    const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "car" }, new THREE.Scene());
    const eyes = (hz: number, fixed: Sight | null): THREE.Vector3[] => {
      const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180);
      const seat = new DriverSeat();
      seat.mode = "follow";
      const view = new ChaseCamera(camera, fakeCanvas(), seat, { rx: 0, ry: 0 } as PadState, false, NO_PICK);
      const scene: SpecScene = { sight: () => wall, rivals: () => [], fixed: () => fixed, cut: (c) => c };
      const out: THREE.Vector3[] = [];
      for (let n = 0; n < 16 * hz; n++) {
        const t = n / hz;
        car.group.position.set(0.2 + 0.1 * t, 0, 20 * t);
        car.velocity.set(0.1, 0, 20);
        car.fwdFlat.set(-Math.sin(0.35), 0, Math.cos(0.35));
        view.frameSpectate(car, "third", scene, 1 / hz, false);
        out.push(camera.position.clone());
      }
      return out;
    };
    for (const hz of [FRAME_HZ, FINE_HZ]) {
      const free = eyes(hz, null);
      const held = eyes(hz, wall);
      let pushed = 0;
      let step = 0;
      let at = 0;
      let last = new THREE.Vector3();
      for (let n = 0; n < free.length; n++) {
        // What the wall moved the eye by this frame, and how much of it is new (the rig's own blend-in settles in 2 s).
        const d = held[n]!.clone().sub(free[n]!);
        pushed = Math.max(pushed, d.length());
        if (n > 2 * hz && d.distanceTo(last) > step) {
          step = d.distanceTo(last);
          at = n / hz;
        }
        last = d;
      }
      t.annotate(`${hz} Hz: the wall pushed the eye up to ${pushed.toFixed(2)} m, by at most ${step.toFixed(4)} m a frame`);
      expect(pushed, `${hz} Hz: the wall pushed the eye ${pushed.toFixed(2)} m (the test needs it to reach in)`).toBeGreaterThan(1);
      expect(step, `${hz} Hz: the pull-in moved the eye ${step.toFixed(3)} m in one frame, at ${at.toFixed(2)} s`).toBeLessThan(0.1);
    }
  });
});

describe("given a spectator camera taking a car up from another shot", () => {
  const enter = (carZ: number): { first: number; moved: number } => {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180);
    camera.position.set(4, 2, 6);
    camera.lookAt(0, 1, 0);
    const seat = new DriverSeat();
    seat.mode = "drive";
    const view = new ChaseCamera(camera, fakeCanvas(), seat, { rx: 0, ry: 0 } as PadState, false, NO_PICK);
    const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "car" }, new THREE.Scene());
    car.group.position.set(0, 0, carZ);
    car.fwdFlat.set(0, 0, 1);
    const from = camera.position.clone();
    view.frameDrive(car, null, DT, false);
    return { first: camera.position.distanceTo(car.group.position), moved: camera.position.distanceTo(from) };
  };

  it("when the previous shot is within the blend range of the car, then the eye blends in and has hardly moved on the first frame", () => {
    const r = enter(CHASE.blendRange - 10);
    expect(r.moved, `the eye moved ${r.moved.toFixed(2)} m on the first frame`).toBeLessThan(2);
  });

  it("when the previous shot is farther off than the blend range, then the camera cuts to the chase shot, with no swoop across the map after a scene change", () => {
    const r = enter(426);
    expect(r.first, `the eye is ${r.first.toFixed(1)} m from the car on the first frame`).toBeLessThan(15);
  });
});

describe("given the chase camera on a car driven by its own drive", () => {
  const H = 1 / FINE_HZ;
  /** Fine steps in one display frame: the frame-rate rig updates every this many. */
  const PER_FRAME = FINE_HZ / FRAME_HZ;

  /** A sedan from `v0` under `input` for `seconds`, stepped as the engine does, followed by one rig at the fine rate and one at the frame rate. */
  function followed(v0: number, input: (car: DeformableCar) => Partial<DriveInput>, seconds: number) {
    setGround(null);
    const car = new DeformableCar(paint(), new THREE.Scene());
    assignClass(car, "sedan");
    car.spawnFacing(0, 0, 0, v0);
    const w = newWorld([car], null);
    const rigs = [new DriveCam(), new DriveCam()];
    const cams = [new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180), new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180)];
    for (let i = 0, n = Math.round(seconds / H); i < n; i++) {
      applyDrive(car, { ...idleDrive(), ...input(car) }, H);
      stepWorld(w, H);
      rigs[0]!.update(cams[0]!, car, "third", H, 0, 0);
      if (i % PER_FRAME === PER_FRAME - 1) rigs[1]!.update(cams[1]!, car, "third", PER_FRAME * H, 0, 0);
    }
    for (const cam of cams) cam.updateMatrixWorld();
    return { car, rigs, fine: cams[0]!, coarse: cams[1]! };
  }

  /** The car's sideways distance (m) from the camera's centre line, + = the car is to the camera's right. */
  function offCentre(cam: THREE.PerspectiveCamera, car: DeformableCar): number {
    const f = cam.getWorldDirection(new THREE.Vector3());
    const l = Math.hypot(f.x, f.z);
    return ((car.group.position.x - cam.position.x) * f.z - (car.group.position.z - cam.position.z) * f.x) / l;
  }

  it(`when the car holds 20 m/s straight for 3 s, then the eye sits the chase offset behind it and ${FRAME_HZ} and ${FINE_HZ} Hz agree`, () => {
    const r = followed(20, (car) => ({ throttle: Math.min(1, Math.max(0, 0.3 + (20 - car.speed) * 0.5)) }), 3);
    const p = r.car.group.position;
    const dist = PLATFORM_CAMERA.third.dist + Math.min(r.car.speed, 30) * CHASE.pullback;
    const gap = Math.hypot(r.fine.position.x - (p.x - r.car.fwdFlat.x * dist), r.fine.position.y - (p.y + PLATFORM_CAMERA.third.height), r.fine.position.z - (p.z - r.car.fwdFlat.z * dist));
    expect(gap, `the eye is ${(gap * 100).toFixed(1)} cm off the chase offset`).toBeLessThan(0.02);
    const rates = r.fine.position.distanceTo(r.coarse.position);
    expect(rates, `${FRAME_HZ} and ${FINE_HZ} Hz eyes are ${(rates * 100).toFixed(2)} cm apart`).toBeLessThan(0.01);
  });

  it(`when the car holds a 15 m/s turn at steer 0.5 for 2 s, then it sits off the camera's centre line, the same at ${FRAME_HZ} and ${FINE_HZ} Hz`, () => {
    const r = followed(15, (car) => ({ throttle: Math.min(1, Math.max(0, 0.3 + (15 - car.speed) * 0.5)), steer: 0.5 }), 2);
    const fine = Math.abs(offCentre(r.fine, r.car));
    const coarse = Math.abs(offCentre(r.coarse, r.car));
    expect(fine, `the car is ${fine.toFixed(2)} m off the camera's centre line`).toBeGreaterThanOrEqual(0.55);
    expect(Math.abs(fine - coarse), `${FRAME_HZ} Hz ${coarse.toFixed(3)} m, ${FINE_HZ} Hz ${fine.toFixed(3)} m`).toBeLessThanOrEqual(0.05 * fine);
  });

  it("when the car slides 40 degrees off its heading at 12 m/s, then the aim leads along its velocity, not its nose", () => {
    const car = new DeformableCar(paint(), new THREE.Scene());
    assignClass(car, "sedan");
    car.spawnFacing(0, 0, 0, 0);
    const heading = (40 * Math.PI) / 180;
    car.velocity.set(Math.sin(heading) * 12, 0, Math.cos(heading) * 12);
    const rig = new DriveCam();
    const cam = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180);
    for (let t = 0; t < 3; t += DT) rig.update(cam, car, "third", DT, 0, 0);
    const aim = rig["aim"].x;
    const p = car.group.position;
    const off = (Math.atan2(aim.x - p.x, aim.z - p.z) * 180) / Math.PI;
    expect(Math.abs(off - 40), `the aim leads ${off.toFixed(1)} degrees round, the velocity 40`).toBeLessThan(1);
    const lead = Math.hypot(aim.x - p.x, aim.z - p.z);
    expect(Math.abs(lead - 12 * CHASE.aheadVel), `the aim leads ${lead.toFixed(2)} m`).toBeLessThan(0.05);
  });

  /** The eye over a fall from 3.2 m at 8 m/s after 0.4 s in the air: how far it dips below where it settles, its height 1.5 s after touchdown against that, the view's roll and its pitch. */
  function landing(h: number, reduceMotion: boolean) {
    const car = new DeformableCar(paint(), new THREE.Scene());
    assignClass(car, "sedan");
    car.spawnFacing(0, 0, 0, 0);
    const ground = car.group.position.y;
    car.group.position.y = ground + 3.2;
    const rig = new DriveCam();
    rig.reduceMotion = reduceMotion;
    const cam = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180);
    const fwd = new THREE.Vector3();
    const step = () => {
      rig.update(cam, car, "third", h, 0, 0);
      cam.updateMatrixWorld();
    };
    for (let t = 0; t < 3; t += h) step();
    car.airborne = true;
    car.velocity.y = -8;
    for (let t = 0; t < 0.4 - 1e-9; t += h) {
      car.group.position.y -= 8 * h;
      step();
    }
    car.group.position.y = ground;
    car.airborne = false;
    car.wheelsDown = 15;
    car.velocity.y = 0;
    const settled = ground + PLATFORM_CAMERA.third.height;
    let low = Infinity;
    let roll = 0;
    const pitch: number[] = [];
    let after = 0;
    for (let t = 0; t < 1.5 - 1e-9; t += h) {
      step();
      low = Math.min(low, cam.position.y);
      roll = Math.max(roll, Math.abs(Math.asin(cam.matrixWorld.elements[1]!)));
      pitch.push(cam.getWorldDirection(fwd).y);
      after = cam.position.y;
    }
    return { dip: settled - low, off: Math.abs(after - settled), roll, pitch, fall: rig.landFall };
  }

  it("when the car lands on four wheels after 0.4 s falling at 8 m/s, then the eye dips under its settled height and is back within 1 cm by 1.5 s", () => {
    for (const h of [1 / FRAME_HZ, H]) {
      const l = landing(h, false);
      expect(l.dip, `at ${Math.round(1 / h)} Hz the eye dipped ${(l.dip * 100).toFixed(1)} cm`).toBeGreaterThanOrEqual(0.03);
      expect(l.off, `at ${Math.round(1 / h)} Hz the eye was ${(l.off * 100).toFixed(1)} cm off its settled height after 1.5 s`).toBeLessThan(0.01);
    }
  });

  it("when the car lands after a fall at 8 m/s, then the camera's landing carries the fall speed for the pad's rumble, and a fall under the landing floor carries none", () => {
    expect(Math.abs(landing(H, false).fall - 8)).toBeLessThan(1e-9);
    const was = LANDING.fall;
    LANDING.fall = 9;
    try {
      expect(landing(H, false).fall).toBe(0);
    } finally {
      LANDING.fall = was;
    }
  });

  it("when the car lands, then the view wobbles in pitch and roll for the landing's window", () => {
    const l = landing(H, false);
    const was = CHASE.landing.wobble;
    CHASE.landing.wobble = 0;
    const still = landing(H, false);
    CHASE.landing.wobble = was;
    let pitch = 0;
    for (let i = 0; i < l.pitch.length; i++) pitch = Math.max(pitch, Math.abs(l.pitch[i]! - still.pitch[i]!));
    expect(pitch, `the pitch moved ${pitch.toFixed(4)} against a still landing`).toBeGreaterThan(0.005);
    expect(l.roll, `the roll reached ${l.roll.toFixed(4)} rad`).toBeGreaterThan(0.005);
    expect(still.roll, `a still landing rolled ${still.roll}`).toBeLessThan(1e-6);
  });

  it("when the landing's pitch is sampled every millisecond, then the wobble crosses zero at most 12 times in its half second (a 9 Hz wobble, not a 30 Hz strobe at a 60 fps display's Nyquist rate), and starts from rest", () => {
    const ms = 1 / 1000;
    const l = landing(ms, false);
    const was = CHASE.landing.wobble;
    CHASE.landing.wobble = 0;
    const still = landing(ms, false);
    CHASE.landing.wobble = was;
    let crossings = 0;
    let prev = 0;
    let first = NaN;
    for (let i = 0; i < l.pitch.length; i++) {
      const d = l.pitch[i]! - still.pitch[i]!;
      if (Number.isNaN(first) && Math.abs(d) > 1e-9) first = Math.abs(d);
      if (Math.abs(d) < 1e-7) continue;
      if (prev !== 0 && Math.sign(d) !== Math.sign(prev)) crossings++;
      prev = d;
    }
    expect(crossings, `the wobble crossed zero ${crossings} times: it never swung`).toBeGreaterThanOrEqual(2);
    expect(crossings, `${crossings} zero crossings in the landing window (${(crossings / 2 / CHASE.landing.hold).toFixed(0)} Hz)`).toBeLessThanOrEqual(12);
    expect(first, `the wobble began at ${first} of pitch, not from rest`).toBeLessThan(0.001);
  });

  it("when motion is reduced, then the landing neither dips the eye past 1 cm nor wobbles the view", () => {
    const l = landing(H, true);
    expect(l.dip, `the eye dipped ${(l.dip * 100).toFixed(1)} cm`).toBeLessThanOrEqual(0.01);
    expect(l.roll, `the view rolled ${l.roll} rad`).toBeLessThan(1e-6);
  });
});

describe("given the chase eye's springs", () => {
  it(`when an underdamped spring runs at ${FRAME_HZ} and ${FINE_HZ} Hz, then it overshoots its target by the damping ratio's share and lands in the same place`, () => {
    const zeta = 0.45;
    const rates = [1 / FRAME_HZ, 1 / FINE_HZ].map((h) => {
      const s = new Spring();
      s.x = 1;
      let peak = 0;
      for (let t = 0; t < 1 - 1e-9; t += h) peak = Math.max(peak, -s.stepDamped(0, 7, zeta, h));
      return { x: s.x, peak };
    });
    const overshoot = Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
    expect(Math.abs(rates[1]!.peak - overshoot), `overshoot ${rates[1]!.peak.toFixed(3)}, expected ${overshoot.toFixed(3)}`).toBeLessThan(0.01);
    expect(Math.abs(rates[0]!.x - rates[1]!.x), `${FRAME_HZ} Hz ${rates[0]!.x}, ${FINE_HZ} Hz ${rates[1]!.x}`).toBeLessThan(1e-9);
  });

  it("when a speed cap is set, then the eye's speed relative to its target never passes it", () => {
    const s = new Spring3();
    const target = new THREE.Vector3(0, 0, 10);
    const axes = { lon: 9, lat: 5.5, up: 7 };
    const calm = { lon: 1, lat: 1, up: 1 };
    let fastest = 0;
    for (let t = 0; t < 2; t += DT) {
      s.stepBasis(target, axes, calm, 3, DT, 0, 1);
      fastest = Math.max(fastest, s.v.length());
    }
    expect(fastest, `the eye reached ${fastest.toFixed(2)} m/s`).toBeLessThanOrEqual(3 + 1e-9);
  });
});

describe("given the chase camera and a hit on the car it follows", () => {
  const make = (reduceMotion = false) => {
    const seat = new DriverSeat();
    seat.mode = "drive";
    const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180);
    const view = new ChaseCamera(camera, fakeCanvas(), seat, { rx: 0, ry: 0 } as PadState, reduceMotion, NO_PICK);
    return { seat, camera, view };
  };
  /** How far one frame of `trauma` moves the eye of a settled car in the seat's `view` (the clock held, so the shake's phase is the same in every call). */
  const shaken = (view: SeatView, trauma: number): number => {
    const { seat, camera, view: cam } = make();
    seat.view = view;
    const car = new DeformableCar(paint(), new THREE.Scene());
    assignClass(car, "sedan");
    car.spawnFacing(0, 0, 0, 0);
    for (let t = 0; t < 3; t += DT) cam.frameDrive(car, null, DT, true);
    const rest = camera.position.clone();
    cam.trauma = trauma;
    cam.frameDrive(car, null, DT, true);
    return camera.position.distanceTo(rest);
  };

  it("when the car is hit at 1, 4, 15 and 40 m/s, then a nudge adds no shake, a hard hit raises the shake along a straight ramp from 2 to 20 m/s, and the shake never passes full", () => {
    const { view } = make();
    view.jolt(1);
    expect(view.trauma, "1 m/s").toBe(0);
    view.jolt(4);
    expect(Math.abs(view.trauma - (4 - 2) / 18), `4 m/s ${view.trauma}`).toBeLessThan(1e-12);
    view.trauma = 0;
    view.jolt(15);
    expect(Math.abs(view.trauma - 13 / 18), `15 m/s ${view.trauma}`).toBeLessThan(1e-12);
    view.jolt(40);
    expect(view.trauma, "40 m/s on top of that").toBe(1);
  });

  it("when a pile grinds on the car with a 10 m/s hit every frame for a second, then the shake holds that one hit's level instead of climbing to full", () => {
    const { view } = make();
    for (let f = 0; f < 60; f++) view.jolt(10);
    expect(Math.abs(view.trauma - 8 / 18), `trauma ${view.trauma} after 60 hits`).toBeLessThan(1e-12);
  });

  it("when the eye's sideways shake is sampled every millisecond for a second, then it swings at most 12 times a second (a jolt, not a strobing flicker)", () => {
    let ms = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ms);
    const { camera, view, look } = rig("global");
    view.look.copy(look);
    for (let f = 0; f < 120; f++) view.orbit(DT, 0, false);
    const rest = camera.position.clone();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    let crossings = 0;
    let prev = 0;
    for (ms = 0; ms < 1000; ms++) {
      camera.position.copy(rest);
      view.trauma = 1;
      view.orbit(0, 0, true);
      const side = camera.position.clone().sub(rest).dot(right);
      if (ms > 0 && Math.sign(side) !== Math.sign(prev) && side !== 0) crossings++;
      prev = side;
    }
    expect(crossings, `${crossings} sign changes in 1 s (${crossings / 2} Hz)`).toBeLessThanOrEqual(24);
  });

  it("when the orbit shakes, then the eye moves across the view and never along it, so the road far ahead holds still", () => {
    vi.spyOn(performance, "now").mockImplementation(() => 5000);
    const frame = (trauma: number) => {
      const { camera, view, look } = rig("global");
      view.look.copy(look);
      for (let f = 0; f < 120; f++) view.orbit(DT, 0, false);
      view.trauma = trauma;
      view.orbit(DT, 0, true);
      return { at: camera.position.clone(), dir: camera.getWorldDirection(new THREE.Vector3()) };
    };
    const calm = frame(0);
    const shaken = frame(0.7);
    const d = shaken.at.clone().sub(calm.at);
    expect(d.length(), `the eye moved ${d.length().toFixed(3)} m`).toBeGreaterThan(0.02);
    expect(Math.abs(d.dot(calm.dir)), `${d.dot(calm.dir)} m of it along the view`).toBeLessThan(1e-9);
  });

  it("when the strength knob is 0, or motion is reduced, then a hit and the first crash's kick add no shake", () => {
    const was = CHASE.shake;
    CHASE.shake = 0;
    try {
      const { view } = make();
      view.jolt(30);
      view.kick(2);
      expect(view.trauma, "knob 0").toBe(0);
    } finally {
      CHASE.shake = was;
    }
    const calm = make(true).view;
    calm.jolt(30);
    calm.kick(2);
    expect(calm.trauma, "reduced motion").toBe(0);
    const half = make().view;
    CHASE.shake = 0.5;
    try {
      half.jolt(20);
      expect(half.trauma, "knob 0.5 halves a full hit").toBe(0.5);
    } finally {
      CHASE.shake = was;
    }
  });

  it("when the shake runs in the chase, far chase and hood views, then each moves the eye, and the hood moves it by the hood's set share of the chase's amount", () => {
    vi.spyOn(performance, "now").mockImplementation(() => 5000);
    const chase = shaken("third", 0.7);
    const far = shaken("far", 0.7);
    const hood = shaken("first", 0.7);
    expect(chase > 0.02 && far > 0.02, `chase ${chase.toFixed(3)} m, far ${far.toFixed(3)} m`).toBeTruthy();
    expect(hood > 0.01 && Math.abs(hood / chase - CHASE.shakeHood) < 0.02, `hood ${hood.toFixed(3)} m is ${(hood / chase).toFixed(3)} of the chase's`).toBeTruthy();
    const calm = shaken("third", 0);
    expect(calm, `no trauma moves the settled eye ${calm.toFixed(4)} m against the shake's ${chase.toFixed(3)} m`).toBeLessThan(chase / 20);
  });
});

describe("given the driven car's chase and far chase eye beside a course wall and under rising ground", () => {
  const make = (view: SeatView) => {
    const seat = new DriverSeat();
    seat.mode = "drive";
    seat.view = view;
    const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180);
    const cam = new ChaseCamera(camera, fakeCanvas(), seat, { rx: 0, ry: 0 } as PadState, false, NO_PICK);
    const car = new DeformableCar(paint(), new THREE.Scene());
    assignClass(car, "sedan");
    car.spawnFacing(0, 0, 0, 0);
    return { camera, cam, car };
  };

  it("when the car stands nose turned off a wall and the eye behind it would be inside the wall, then the eye ends up outside the wall's clearance, and inside it without the sight", () => {
    // A wall along z with its face at x = 3; the eye of a car turned 0.5 rad off it sits at x ~ 3 (the chase) or ~ 4.8 (the far chase).
    const wall: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ: [occluder(53, 0, 0, 50, 2000, false, 0, 30)] };
    for (const view of ["third", "far"] as const) {
      const free = make(view);
      const held = make(view);
      for (const r of [free, held]) r.car.fwdFlat.set(-Math.sin(0.5), 0, Math.cos(0.5));
      for (let n = 0; n < 180; n++) {
        free.cam.frameDrive(free.car, null, DT, false);
        held.cam.frameDrive(held.car, wall, DT, false);
      }
      const f = free.camera.position;
      const h = held.camera.position;
      expect(solid(wall, f.x, f.y, f.z, 0.5), `${view}: the unguarded eye at x ${f.x.toFixed(2)} m is not in the wall (the test needs it inside)`).toBeTruthy();
      expect(!solid(wall, h.x, h.y, h.z, 0.5), `${view}: the eye at x ${h.x.toFixed(2)} m, y ${h.y.toFixed(2)} m stands inside the wall's clearance`).toBe(true);
    }
  });

  it("when the ground rises behind the car above the chase height, then the eye stays the chase's floor clearance above the ground under it on every frame", () => {
    // A hill face behind the car: 0.5 m up per metre toward -z, so the eye 6 m behind would sit 3 m up in the rock at the chase's 2 m.
    const hill = new Ground();
    hill.addFace(-50, -50, 0, 100, 100, 25, 25, -25, -25, Infinity);
    setGround(hill);
    try {
      for (const view of ["third", "far"] as const) {
        const { camera, cam, car } = make(view);
        let worst = Infinity;
        for (let n = 0; n < 180; n++) {
          cam.frameDrive(car, null, DT, false);
          const p = camera.position;
          worst = Math.min(worst, p.y - hill.heightAt(p.x, p.z, car.group.position.y));
        }
        expect(worst, `${view}: the eye came ${worst.toFixed(2)} m over the ground (clearance ${CHASE.floor} m)`).toBeGreaterThanOrEqual(CHASE.floor - 1e-6);
      }
    } finally {
      setGround(null);
    }
  });
});

describe("given a driven car whose body style seats its own cameras", () => {
  it("when it is framed in the hood, chase and far chase views, then the hood eye stands at its style's seat and each chase settles at its style's distance and height", () => {
    const own = { hood: [1.4, 0.6], third: { dist: 8, height: 3, aimUp: 1.5 }, far: { dist: 12.5, height: 4.6, aimUp: 2 } } as const;
    for (const view of ["first", "third", "far"] as const) {
      const seat = new DriverSeat();
      seat.mode = "drive";
      seat.view = view;
      const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180);
      const cam = new ChaseCamera(camera, fakeCanvas(), seat, { rx: 0, ry: 0 } as PadState, false, NO_PICK);
      const car = new DeformableCar(paint(), new THREE.Scene());
      Object.assign(car, { style: { ...car.style, camera: own } });
      assignClass(car, "sedan");
      car.spawnFacing(0, 0, 0, 0);
      for (let n = 0; n < 180; n++) cam.frameDrive(car, null, DT, false);
      const p = camera.position;
      const g = car.group.position;
      if (view === "first") {
        const eye = car.group.localToWorld(new THREE.Vector3(0, own.hood[0], own.hood[1]));
        expect(p.distanceTo(eye), `hood eye ${p.toArray().map((v) => v.toFixed(2))} vs the style's ${eye.toArray().map((v) => v.toFixed(2))}`).toBeLessThan(0.05);
      } else {
        const [back, up] = [Math.hypot(p.x - g.x, p.z - g.z), p.y - g.y];
        expect(Math.abs(back - own[view].dist) < 0.3 && Math.abs(up - own[view].height) < 0.3, `${view}: eye ${back.toFixed(2)} m back, ${up.toFixed(2)} m up; the style's ${own[view].dist}, ${own[view].height}`).toBeTruthy();
      }
    }
  });
});

describe("given a canvas press and release (a click) over a world that moves while the button is down", () => {
  /** One car at `at` (px); `at` is where the world has it now. */
  const clickRig = () => {
    const world = { at: 100 };
    const chosen: number[] = [];
    const picker: CarPicker = { at: (x) => (Math.abs(x - world.at) < 20 ? 7 : -1), choose: (car) => chosen.push(car) };
    const canvas = fakeCanvas();
    const seat = new DriverSeat();
    seat.mode = "global";
    const view = new ChaseCamera(new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 180), canvas, seat, { rx: 0, ry: 0 } as PadState, false, picker);
    view.attach();
    return { world, chosen, canvas };
  };

  it("when the car is under the press and has moved on by the release, then the click still follows it", () => {
    const { world, chosen, canvas } = clickRig();
    pointer(canvas, "pointerdown", 100, 50);
    world.at = 400;
    pointer(canvas, "pointerup", 100, 50);
    expect(firstMismatch(chosen, [7])).toBeUndefined();
  });

  it("when the press missed every car and one slides under the pointer before the release, then nothing is followed", () => {
    const { world, chosen, canvas } = clickRig();
    world.at = 400;
    pointer(canvas, "pointerdown", 100, 50);
    world.at = 100;
    pointer(canvas, "pointerup", 100, 50);
    expect(chosen).toHaveLength(0);
  });

  it("when the press on a car turns into a drag, then nothing is followed", () => {
    const { chosen, canvas } = clickRig();
    pointer(canvas, "pointerdown", 100, 50);
    pointer(canvas, "pointermove", 140, 50);
    pointer(canvas, "pointerup", 140, 50);
    expect(chosen).toHaveLength(0);
  });
});

describe("given the spectator cam cycle with the free view in it", () => {
  const blankInput = blankFreeInput();

  it("when View is pressed from Auto, then the free view holds the camera, and View from it goes back to Auto", () => {
    const { view } = rig("global");
    view.spec = "auto";
    view.cycleSpec(false);
    expect(view.specView(false), "the free view follows Auto in the ring").toBe("free");
    expect(view.flying, "and flies").toBe(true);
    view.cycleSpec(false);
    expect(view.specView(false), "View again is back where it came from").toBe("auto");
    expect(view.flying, "and no longer flies").toBe(false);
  });

  it("when View is pressed again after coming back from the free view, then the ring carries on to the chase and Auto's next press reaches the free view again", () => {
    const { view } = rig("global");
    view.spec = "auto";
    const seen: string[] = [];
    for (let press = 0; press < 3; press++) {
      view.cycleSpec(false);
      seen.push(view.specView(false));
    }
    expect(firstMismatch(seen, ["free", "auto", "third"]), "Auto, free, back to Auto, then past it").toBeUndefined();
    for (let press = 0; press < 6; press++) view.cycleSpec(false);
    expect(view.specView(false), "round the ring to Auto").toBe("auto");
    view.cycleSpec(false);
    expect(view.specView(false), "and the free view is in the ring again").toBe("free");
  });

  it("when the view before it was the scene's own (none picked), then leaving the free view puts that back", () => {
    const { view } = rig("global");
    view.enterFree();
    expect(view.spec).toBe("free");
    expect(view.leaveFree(), "it was on").toBe(true);
    expect(view.spec, "the scene's own view again").toBe(null);
    expect(view.leaveFree(), "leaving again is nothing").toBe(false);
  });

  it("when the free view begins and nothing is held, then the camera keeps the pose it had", () => {
    const { camera, view } = rig("global");
    camera.position.set(4, 2, 6);
    camera.lookAt(10, 2, -30);
    const before = camera.getWorldDirection(new THREE.Vector3());
    view.enterFree();
    view.frameFree(blankInput, DT);
    expect(camera.position.distanceTo(new THREE.Vector3(4, 2, 6)), `the eye is at ${camera.position.toArray().join(", ")}`).toBeLessThan(1e-9);
    expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(before), "the view is the one it had").toBeLessThan(1e-6);
  });

  it("when the free view frames, then the shot counts as the viewer's own, and leaving gives back what it was", () => {
    const { view } = rig("global");
    view.userFramed = false;
    view.enterFree();
    view.frameFree(blankInput, DT);
    expect(view.userFramed, "the cinematic and the auto cuts stand down").toBe(true);
    view.leaveFree();
    expect(view.userFramed, "the view before it was not framed").toBe(false);
  });

  it("when a pointer drags in the free view, then the view turns by the drag and the orbit's bearing does not move", () => {
    const { canvas, view } = rig("global");
    view.enterFree();
    view.frameFree(blankInput, DT);
    const bearing = view.bearing;
    pointer(canvas, "pointerdown", 100, 100);
    pointer(canvas, "pointermove", 150, 140);
    pointer(canvas, "pointerup", 150, 140);
    expect(Math.abs(view.free.yaw + 50 * DRAG_YAW_PER_PX), `yaw ${view.free.yaw}`).toBeLessThan(1e-9);
    expect(Math.abs(view.free.pitch + 40 * DRAG_PITCH_PER_PX), `pitch ${view.free.pitch}`).toBeLessThan(1e-9);
    expect(view.bearing, "the orbit stayed").toBe(bearing);
  });

  it("when the wheel turns in the free view, then it sets the flight speed", () => {
    const { canvas, view } = rig("global");
    view.enterFree();
    view.frameFree(blankInput, DT);
    canvas.dispatchEvent(Object.assign(new Event("wheel"), { deltaY: -100, preventDefault() {} }));
    expect(Math.abs(view.free.speedScale - Math.exp(0.15)), `speed scale ${view.free.speedScale}`).toBeLessThan(1e-9);
  });

  it("when two fingers spread 40 px apart while their middle moves 20 px right, then the eye flies 40 px of the reach forward and slides 20 px of it left", () => {
    const { canvas, camera, view } = rig("global");
    camera.position.set(4, 2, 6);
    view.enterFree();
    view.frameFree(blankInput, DT);
    const touch = (type: "pointerdown" | "pointermove", id: number, x: number, y: number): void => {
      canvas.dispatchEvent(Object.assign(new Event(type), { button: 0, pointerId: id, clientX: x, clientY: y }));
    };
    touch("pointerdown", 1, 100, 100);
    touch("pointerdown", 2, 300, 100);
    touch("pointermove", 2, 340, 100);
    view.frameFree(blankInput, DT);
    const pxToMetres = view.free.reach / 400;
    expect(Math.abs(camera.position.z - (6 - 40 * pxToMetres)), `z ${camera.position.z}: 40 px of spread ahead of 6`).toBeLessThan(1e-6);
    expect(Math.abs(camera.position.x - (4 - 20 * pxToMetres)), `x ${camera.position.x}: 20 px of slide left of 4`).toBeLessThan(1e-6);
  });
});
