import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DeformableCar } from "../vehicle/car.ts";
import { DRIVE } from "../vehicle/car-drive.ts";
import { CHASE, DriveCam, followBlend, wobbleEnvelope } from "./drive-cam.ts";

describe("given the chase view's follow blend over forward speed (masterclass 23:34: fade over a parameter)", () => {
  it("when the car is under the band or past it, then the blend is 0 or 1", () => {
    expect(followBlend(-5)).toBe(0);
    expect(followBlend(CHASE.followFrom)).toBe(0);
    expect(followBlend(CHASE.followTo)).toBe(1);
    expect(followBlend(40)).toBe(1);
  });
  it("when the speed climbs through the band, then the blend rises without a jump or a fall, and the old 3 m/s switch is mid-band", () => {
    const STEP = 0.01;
    let prev = 0;
    for (let v = 0; v <= 8; v += STEP) {
      const b = followBlend(v);
      expect(b, `the blend fell at ${v.toFixed(2)} m/s`).toBeGreaterThanOrEqual(prev);
      expect(b - prev, `the blend jumped at ${v.toFixed(2)} m/s: ${prev} -> ${b}`).toBeLessThan(0.02);
      prev = b;
    }
    expect(followBlend(3) > 0 && followBlend(3) < 1).toBeTruthy();
  });
});

describe("given a landing's wobble envelope", () => {
  const { hold, attack } = CHASE.landing;
  it("when the landing has just begun, then the amplitude is 0, not the full amplitude", () => {
    expect(wobbleEnvelope(hold, hold, attack)).toBe(0);
  });
  it("when the landing runs its hold, then the amplitude eases in without a jump, peaks, and fades out to 0", () => {
    const STEP = 0.001;
    let prev = 0;
    let peak = 0;
    for (let left = hold; left >= 0; left -= STEP) {
      const a = wobbleEnvelope(left, hold, attack);
      expect(Math.abs(a - prev), `the envelope jumped at ${left.toFixed(3)} s left: ${prev} -> ${a}`).toBeLessThan(0.05);
      peak = Math.max(peak, a);
      prev = a;
    }
    expect(peak > 0.8 && peak <= 1).toBeTruthy();
    expect(wobbleEnvelope(0, hold, attack)).toBe(0);
  });
});

describe("given the chase camera behind a car, once at rest and once at full forward speed (its lens widened)", () => {
  /** The look's turn (rad) for a 40 px mouse drag after 3 s of the chase at `speed` (m/s), and the lens it drew with (deg). */
  function dragAt(speed: number): { turn: number; fov: number } {
    const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "car" }, new THREE.Scene());
    car.fwdFlat.set(0, 0, 1);
    car.velocity.set(0, 0, speed);
    const cam = new DriveCam();
    const camera = new THREE.PerspectiveCamera(CHASE.fov, 16 / 9, 0.1, 400);
    for (let f = 0; f < 180; f++) cam.update(camera, car, "third", 1 / 60, 0, 0);
    cam.nudge(-40, 0);
    return { turn: cam.look, fov: camera.fov };
  }

  // mutation: sed -i 's/^    this.lensShare = camera.fov \/ CHASE.fov;$/    this.lensShare = 1;/' src/game/present/drive-cam.ts
  it("when the mouse drags the look by the same pixels, then at speed it turns more by the widened lens's share of the resting one, so the picture moves as far a pixel", () => {
    const rest = dragAt(0);
    const fast = dragAt(DRIVE.maxFwd);
    expect(fast.fov, "control: the lens widened at speed (deg)").toBeGreaterThan(CHASE.fov + 5);
    expect(fast.turn / rest.turn, "the turn at speed over the turn at rest").toBeCloseTo(fast.fov / rest.fov, 6);
  });
});
