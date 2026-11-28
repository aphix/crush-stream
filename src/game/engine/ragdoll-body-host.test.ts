import { describe, expect, it } from "vitest";
import { driverLook } from "../present/driver-look.ts";
import { ORBS_AT, ROW_TEXELS } from "../present/dummy-rig.ts";
import { flatSystem } from "../present/ragdoll-throws.test-util.ts";
import { RagdollBodyHost } from "./ragdoll-body-host.ts";

describe("given a civilian's body standing on the ragdoll pool", () => {
  it("when its civilian looks 0.3 rad to her +x with her eyes and 0.1 down, then the pool's dummy in its slot carries that eye turn", async () => {
    const sys = await flatSystem();
    const host = new RagdollBodyHost(() => sys);
    const slot = host.start(0, 0, 0, 0, driverLook(1, 0), host.freeSlot(0), 0, 0);
    expect(slot, "a body stood").toBeGreaterThanOrEqual(0);
    host.look(slot, 0, 0, 0.3, 0.1);
    const rows = sys.pickMesh["rows"];
    const at = (slot * ROW_TEXELS + ORBS_AT) * 4 + 3;
    expect(rows[at], "across (rad)").toBeCloseTo(0.3, 6);
    expect(rows[at + 4], "down (rad)").toBeCloseTo(0.1, 6);
    sys.dispose();
  });
});
