import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { camOf, eyeOf } from "./free-cam-pose.ts";
import { FreeCam } from "./free-cam.ts";

describe("given a free camera's pose saved as the shareable camera setting", () => {
  it("when a pose is written and read back, then the eye and the heading are the same, and the eye is where the headless screenshot camera puts it", () => {
    const free = new FreeCam();
    free.eye.set(12, 3.5, -7);
    free.yaw = 2.1;
    free.pitch = -0.4;
    const cam = camOf(free);
    const { eye, look } = eyeOf(cam);
    expect(new THREE.Vector3(...eye).distanceTo(free.eye)).toBeLessThan(1e-9);
    // `--camera r,pitch,angle,x,y,z`: x + sin(angle) r cos(pitch), y + r sin(pitch), z + cos(angle) r cos(pitch).
    const [r, pitch, angle, x, y, z] = cam as [number, number, number, number, number, number];
    expect(Math.abs(x + Math.sin(angle) * r * Math.cos(pitch) - 12) < 1e-9 && Math.abs(y + r * Math.sin(pitch) - 3.5) < 1e-9 && Math.abs(z + Math.cos(angle) * r * Math.cos(pitch) + 7) < 1e-9).toBeTruthy();
    const heading = new THREE.Vector3(...look).sub(free.eye).normalize();
    expect(Math.abs(heading.y - Math.sin(free.pitch)) < 1e-9 && Math.abs(heading.x + Math.sin(free.yaw) * Math.cos(free.pitch)) < 1e-9, "the look point is ahead of the eye").toBeTruthy();
  });
});
