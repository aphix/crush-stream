import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { TIME_OF_DAY, TIMES_OF_DAY } from "../match/types.ts";
import { courseDay, sunElevation, sunOffset } from "./engine-world.ts";
import { rowElevation, SKY_DRAWN, SKY_LOOKS, SkyDome, skyDetailFor, uAtNorth, type SkyDetail, type SkyMode } from "./sky-dome.ts";
import { SANDBOX_SKY } from "./sky-procedural.ts";
import type { FxTier } from "./engine-post.ts";

/** The sun's place before times of day: every course's daylight was lit from here. */
const OLD_SUN = new THREE.Vector3(-10, 22, 9);
const DEG = Math.PI / 180;

describe("given the race's times of day: the sky pictures and the light", () => {
  it("when the race runs by day, then the sun shines from exactly where it always has", () => {
    const off = sunOffset(TIME_OF_DAY.day, new THREE.Vector3());
    assert.ok(off.distanceTo(OLD_SUN) < 1e-9, `the day's sun at (${off.x}, ${off.y}, ${off.z})`);
  });

  it("when a course with no daylight of its own is lit, then its sky (and fog) colour is the course's, not the studio's near-black", () => {
    assert.equal(courseDay(null, "#9db3c7").sky, 0x9db3c7);
    assert.equal(courseDay({ sun: "#fff0d4", sunIntensity: 2.6, hemi: "#b7d0ea", fill: "#f6e2c8" }, "#a6c6e2").sky, 0xa6c6e2);
  });

  it("when the race runs at sunset, then the sun comes in low (12-25°) from the day's side, at the day's height over the shadow box", () => {
    const el = sunElevation(TIME_OF_DAY.sunset);
    assert.ok(el >= 12 * DEG - 1e-9 && el <= 25 * DEG, `${(el / DEG).toFixed(1)}°`);
    const off = sunOffset(TIME_OF_DAY.sunset, new THREE.Vector3());
    assert.ok(Math.abs(Math.atan2(off.x, -off.z) - Math.atan2(OLD_SUN.x, -OLD_SUN.z)) < 1e-9, "the same bearing");
    assert.ok(Math.abs(off.y - OLD_SUN.y) < 1e-9, "the same height");
  });

  for (const time of TIMES_OF_DAY) {
    const look = SKY_LOOKS[time];
    it(`when the ${time} sky is drawn, then its disc (if any) lands on the light's bearing, and its strip runs from under the horizon to well above it`, () => {
      const bearing = Math.atan2(OLD_SUN.x, -OLD_SUN.z);
      const u0 = uAtNorth(look, bearing);
      assert.ok(u0 >= 0 && u0 < 1, `u at north ${u0}`);
      if (look.disc) {
        // The shader's u at the light's bearing is the disc's column.
        const u = (((bearing / (2 * Math.PI) + u0) % 1) + 1) % 1;
        assert.ok(Math.abs(u * look.width - look.disc.column) < 1e-6, `u ${u * look.width} against column ${look.disc.column}`);
        assert.ok(rowElevation(look, look.disc.row) > 0, "the disc above the horizon");
      }
      assert.ok(rowElevation(look, look.height - 1) < 0, "the bottom row under the horizon");
      assert.ok(rowElevation(look, 0) > 40 * DEG, `the top row at ${(rowElevation(look, 0) / DEG).toFixed(0)}°`);
    });
  }
});

describe("given the Sky setting and the FX tier", () => {
  const rows: [SkyMode, FxTier, SkyDetail][] = [
    ["auto", "minimal", "off"],
    ["auto", "off", "off"],
    ["auto", "low", "half"],
    ["auto", "high", "full"],
    ["auto", "ultra", "full"],
    ["on", "minimal", "gradient"],
    ["on", "off", "gradient"],
    ["on", "low", "half"],
    ["on", "high", "full"],
    ["full", "minimal", "full"],
    ["full", "off", "full"],
    ["full", "low", "full"],
    ["full", "ultra", "full"],
    ["off", "minimal", "off"],
    ["off", "low", "off"],
    ["off", "high", "off"],
    ["off", "ultra", "off"],
  ];
  for (const [mode, tier, detail] of rows) {
    it(`when the sky is ${mode} on the ${tier} tier, then it draws ${detail}`, () => {
      assert.equal(skyDetailFor(mode, tier), detail);
    });
  }
});

describe("given a procedural sky cover, the Sky setting and the FX tier", () => {
  const rows: { mode: SkyMode; tier: FxTier; detail: SkyDetail }[] = [
    { mode: "auto", tier: "off", detail: "off" },
    { mode: "auto", tier: "minimal", detail: "off" },
    { mode: "auto", tier: "low", detail: "procedural" },
    { mode: "auto", tier: "high", detail: "procedural" },
    { mode: "auto", tier: "ultra", detail: "procedural" },
    { mode: "on", tier: "off", detail: "procedural" },
    { mode: "on", tier: "minimal", detail: "procedural" },
    { mode: "on", tier: "low", detail: "procedural" },
    { mode: "on", tier: "high", detail: "procedural" },
    { mode: "on", tier: "ultra", detail: "procedural" },
    { mode: "full", tier: "off", detail: "procedural" },
    { mode: "full", tier: "minimal", detail: "procedural" },
    { mode: "full", tier: "low", detail: "procedural" },
    { mode: "full", tier: "high", detail: "procedural" },
    { mode: "full", tier: "ultra", detail: "procedural" },
    { mode: "off", tier: "off", detail: "off" },
    { mode: "off", tier: "minimal", detail: "off" },
    { mode: "off", tier: "low", detail: "off" },
    { mode: "off", tier: "high", detail: "off" },
    { mode: "off", tier: "ultra", detail: "off" },
  ];
  for (const row of rows) {
    it(`when the sky is ${row.mode} on the ${row.tier} tier, then it draws ${row.detail}`, () => {
      assert.equal(skyDetailFor(row.mode, row.tier, true), row.detail);
    });
  }
});

describe("given a sandbox dome (no time of day) with a procedural cover", () => {
  it("when the procedural sky is asked for, then it draws with that cover and no texture, and hides once the cover and the detail go", () => {
    const dome = new SkyDome();
    dome.show(null, 0);
    dome.setProcedural(0.4);
    dome.setDetail("procedural");
    assert.equal(dome.mesh.visible, true);
    assert.equal(dome.drawn, SKY_DRAWN.procedural);
    assert.equal(dome.textureBytes, 0);
    assert.equal(dome["mat"].uniforms.uCover!.value, 0.4);
    dome.setProcedural(null);
    dome.setDetail("off");
    assert.equal(dome.mesh.visible, false);
    assert.equal(dome.drawn, SKY_DRAWN.off);
  });

  it("when the sandbox's night comes on, then the dome draws the night look with stars, and the day look without them when it goes", () => {
    const dome = new SkyDome();
    dome.show(null, 0);
    dome.setProcedural(0.4);
    dome.setDetail("procedural");
    const u = dome["mat"].uniforms;
    const horizon = (): string => `#${(u.horizonColor!.value as THREE.Color).getHexString()}`;
    dome.setNight(true);
    assert.equal(horizon(), SANDBOX_SKY.night.horizon);
    assert.equal(u.uStars!.value, 1);
    dome.setNight(false);
    assert.equal(horizon(), SANDBOX_SKY.day.horizon);
    assert.equal(u.uStars!.value, 0);
  });
});

describe("given a race dome holding its strip", () => {
  it("when the procedural sky is asked for, then the strip is let go and no picture is loaded", async () => {
    const dome = new SkyDome();
    const loads: string[] = [];
    let loaded: Promise<unknown> = Promise.resolve();
    Object.assign(dome, {
      load: (file: string) => {
        loads.push(file);
        loaded = Promise.resolve(new THREE.Texture({ width: 64, height: 16, close() {} }));
        return loaded;
      },
    });
    dome.show(TIME_OF_DAY.day, 0);
    dome.setDetail("full");
    await loaded;
    assert.ok(dome.textureBytes > 0, "the control: the strip is held");
    dome.setDetail("procedural");
    assert.equal(dome.textureBytes, 0);
    assert.equal(dome.drawn, SKY_DRAWN.procedural);
    assert.equal(loads.join(), TIME_OF_DAY.day, "the one load, the strip's");
  });
});

describe("given a race's sky dome", () => {
  it("when its detail goes gradient, then off, then gradient again, then it draws only while on and holds no texture", () => {
    const dome = new SkyDome();
    dome.show(TIME_OF_DAY.sunset, 0);
    assert.equal(dome.mesh.visible, false, "no detail asked for yet");
    dome.setDetail("gradient");
    assert.equal(dome.mesh.visible, true);
    assert.equal(dome.textureBytes, 0);
    dome.setDetail("off");
    assert.equal(dome.mesh.visible, false);
    dome.setDetail("gradient");
    assert.equal(dome.mesh.visible, true);
    dome.show(null, 0);
    assert.equal(dome.mesh.visible, false, "no time of day: no sky");
  });

  it("when it is built, then it draws after every opaque surface, so the depth test skips what they cover", () => {
    assert.ok(new SkyDome().mesh.renderOrder > 1e9);
  });
});
