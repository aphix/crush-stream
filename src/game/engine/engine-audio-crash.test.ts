import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runCrash } from "./engine-audio-crash.test-util.ts";

describe("given the real engine's fleet sandbox with audio on, two cars head-on and a third driven into the slab", () => {
  it("when it runs, then the car-car crash is heard steel on steel, the slab as steel on concrete, and the world is the same numbers as the same run with audio off", async () => {
    const on = await runCrash(true);
    const pairs = on.hits.map((h) => `${h.a}/${h.b}`);
    expect(pairs, "a car-car hit, steel on steel").toContain("steel/steel");
    expect(pairs, "the slab, steel on concrete").toContain("steel/concrete");
    for (const h of on.hits) expect(h.impulse, "every hit is a real one").toBeGreaterThan(1.5);
    const off = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--max-old-space-size=2048", "--import", "./scripts/test-setup.mjs", "scripts/audio-crash-digest.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop();
    expect(on.digest, "world digest with audio on").toBe(off);
  }, 180_000);
});
