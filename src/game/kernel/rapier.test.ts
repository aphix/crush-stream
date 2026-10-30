import { describe, expect, it } from "vitest";
import "./rapier-node.test-util.ts";
import { loadRapier, readAngvel, readLinvel, readRotation, readTranslation } from "./rapier.ts";

describe("given a box flung through the air and spinning in a Rapier world", () => {
  it("when its pose and velocities are read from the wasm, then each is the very value its getter gives", async () => {
    const R = await loadRapier();
    const world = new R.World({ x: 0, y: -9.81, z: 0 });
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(1.25, 2.5, -3.75).setLinvel(4, 5, -6).setAngvel({ x: 1, y: -2, z: 3 }));
    world.createCollider(R.ColliderDesc.cuboid(0.2, 0.3, 0.4), body);
    for (let s = 0; s < 10; s++) world.step();
    const read = new Float64Array(13);
    readTranslation(body, read, 0);
    readRotation(body, read, 3);
    readLinvel(body, read, 7);
    readAngvel(body, read, 10);
    const t = body.translation();
    const q = body.rotation();
    const v = body.linvel();
    const w = body.angvel();
    const got = [t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, w.x, w.y, w.z];
    const names = ["x", "y", "z", "qx", "qy", "qz", "qw", "vx", "vy", "vz", "wx", "wy", "wz"];
    for (let i = 0; i < names.length; i++) expect(read[i], names[i]).toBe(got[i]);
    world.free();
  });
});
