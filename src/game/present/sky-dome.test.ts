import { describe, expect, it } from "vitest";
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
    expect(off.distanceTo(OLD_SUN), `the day's sun at (${off.x}, ${off.y}, ${off.z})`).toBeLessThan(1e-9);
  });

  it("when a course with no daylight of its own is lit, then its sky (and fog) colour is the course's, not the studio's near-black", () => {
    expect(courseDay(null, "#9db3c7").sky).toBe(0x9db3c7);
    expect(courseDay({ sun: "#fff0d4", sunIntensity: 2.6, hemi: "#b7d0ea", fill: "#f6e2c8" }, "#a6c6e2").sky).toBe(0xa6c6e2);
  });

  it("when the race runs at sunset, then the sun comes in low (12-25°) from the day's side, at the day's height over the shadow box", () => {
    const el = sunElevation(TIME_OF_DAY.sunset);
    expect(el >= 12 * DEG - 1e-9 && el <= 25 * DEG, `${(el / DEG).toFixed(1)}°`).toBeTruthy();
    const off = sunOffset(TIME_OF_DAY.sunset, new THREE.Vector3());
    expect(Math.abs(Math.atan2(off.x, -off.z) - Math.atan2(OLD_SUN.x, -OLD_SUN.z)), "the same bearing").toBeLessThan(1e-9);
    expect(Math.abs(off.y - OLD_SUN.y), "the same height").toBeLessThan(1e-9);
  });

  for (const time of TIMES_OF_DAY) {
    const look = SKY_LOOKS[time];
    it(`when the ${time} sky is drawn, then its disc (if any) lands on the light's bearing, and its strip runs from under the horizon to well above it`, () => {
      const bearing = Math.atan2(OLD_SUN.x, -OLD_SUN.z);
      const u0 = uAtNorth(look, bearing);
      expect(u0 >= 0 && u0 < 1, `u at north ${u0}`).toBeTruthy();
      if (look.disc) {
        // The shader's u at the light's bearing is the disc's column.
        const u = (((bearing / (2 * Math.PI) + u0) % 1) + 1) % 1;
        expect(Math.abs(u * look.width - look.disc.column), `u ${u * look.width} against column ${look.disc.column}`).toBeLessThan(1e-6);
        expect(rowElevation(look, look.disc.row), "the disc above the horizon").toBeGreaterThan(0);
      }
      expect(rowElevation(look, look.height - 1), "the bottom row under the horizon").toBeLessThan(0);
      expect(rowElevation(look, 0), `the top row at ${(rowElevation(look, 0) / DEG).toFixed(0)}°`).toBeGreaterThan(40 * DEG);
    });
  }
});

describe("given the Sky setting and the FX tier", () => {
  const rows: { mode: SkyMode; tier: FxTier; detail: SkyDetail }[] = [
    { mode: "auto", tier: "minimal", detail: "off" },
    { mode: "auto", tier: "off", detail: "off" },
    { mode: "auto", tier: "low", detail: "half" },
    { mode: "auto", tier: "high", detail: "full" },
    { mode: "auto", tier: "ultra", detail: "full" },
    { mode: "on", tier: "minimal", detail: "gradient" },
    { mode: "on", tier: "off", detail: "gradient" },
    { mode: "on", tier: "low", detail: "half" },
    { mode: "on", tier: "high", detail: "full" },
    { mode: "full", tier: "minimal", detail: "full" },
    { mode: "full", tier: "off", detail: "full" },
    { mode: "full", tier: "low", detail: "full" },
    { mode: "full", tier: "ultra", detail: "full" },
    { mode: "off", tier: "minimal", detail: "off" },
    { mode: "off", tier: "low", detail: "off" },
    { mode: "off", tier: "high", detail: "off" },
    { mode: "off", tier: "ultra", detail: "off" },
  ];
  for (const row of rows) {
    it(`when the sky is ${row.mode} on the ${row.tier} tier, then it draws ${row.detail}`, () => {
      expect(skyDetailFor(row.mode, row.tier)).toBe(row.detail);
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
      expect(skyDetailFor(row.mode, row.tier, true)).toBe(row.detail);
    });
  }
});

describe("given a sandbox dome (no time of day) with a procedural cover", () => {
  it("when the procedural sky is asked for, then it draws with that cover and no texture, and hides once the cover and the detail go", () => {
    const dome = new SkyDome();
    dome.show(null, 0);
    dome.setProcedural(0.4);
    dome.setDetail("procedural");
    expect(dome.mesh.visible).toBe(true);
    expect(dome.drawn).toBe(SKY_DRAWN.procedural);
    expect(dome.textureBytes).toBe(0);
    expect(dome["mat"].uniforms.uCover!.value).toBe(0.4);
    dome.setProcedural(null);
    dome.setDetail("off");
    expect(dome.mesh.visible).toBe(false);
    expect(dome.drawn).toBe(SKY_DRAWN.off);
  });

  it("when the sandbox's night comes on, then the dome draws the night look with stars, and the day look without them when it goes", () => {
    const dome = new SkyDome();
    dome.show(null, 0);
    dome.setProcedural(0.4);
    dome.setDetail("procedural");
    const u = dome["mat"].uniforms;
    const horizon = (): string => `#${(u.horizonColor!.value as THREE.Color).getHexString()}`;
    dome.setNight(true);
    expect(horizon()).toBe(SANDBOX_SKY.night.horizon);
    expect(u.uStars!.value).toBe(1);
    dome.setNight(false);
    expect(horizon()).toBe(SANDBOX_SKY.day.horizon);
    expect(u.uStars!.value).toBe(0);
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
    expect(dome.textureBytes, "the control: the strip is held").toBeGreaterThan(0);
    dome.setDetail("procedural");
    expect(dome.textureBytes).toBe(0);
    expect(dome.drawn).toBe(SKY_DRAWN.procedural);
    expect(loads.join(), "the one load, the strip's").toBe(TIME_OF_DAY.day);
  });
});

describe("given a race's sky dome", () => {
  it("when its detail goes gradient, then off, then gradient again, then it draws only while on and holds no texture", () => {
    const dome = new SkyDome();
    dome.show(TIME_OF_DAY.sunset, 0);
    expect(dome.mesh.visible, "no detail asked for yet").toBe(false);
    dome.setDetail("gradient");
    expect(dome.mesh.visible).toBe(true);
    expect(dome.textureBytes).toBe(0);
    dome.setDetail("off");
    expect(dome.mesh.visible).toBe(false);
    dome.setDetail("gradient");
    expect(dome.mesh.visible).toBe(true);
    dome.show(null, 0);
    expect(dome.mesh.visible, "no time of day: no sky").toBe(false);
  });

  it("when it is built, then it draws after every opaque surface, so the depth test skips what they cover", () => {
    expect(new SkyDome().mesh.renderOrder).toBeGreaterThan(1e9);
  });
});
