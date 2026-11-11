import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { TIME_OF_DAY } from "../match/types.ts";
import { LAMP_POOL } from "./constants.ts";
import { SUN_HOP_METRES } from "./day-cycle.ts";
import { makeLamp, sunOffset, WorldStage } from "./engine-world.ts";
import { FACADE_GLOW } from "./facades.ts";
import type { SkyDetail } from "./sky-dome.ts";

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
/** The night's depth the stage darkens by at night (its `nightDepth`), and the sunset palette's glow share (the window lights at sunset). */
const NIGHT_DEPTH = 0.72;
/** The most the sun may move between two game minutes at midday (m of its offset): it has not moved if the stage did not hop. */
const SAME = 1e-12;

function newStage(): { stage: WorldStage; scene: THREE.Scene } {
  stubBrowser();
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.001);
  return { stage: new WorldStage(scene), scene };
}

/** The lamp's head material and its pool's. */
function lampOf(): { head: THREE.MeshStandardMaterial; pool: THREE.MeshBasicMaterial } {
  const lamp = makeLamp(true, false);
  const pool = lamp.getObjectByName(LAMP_POOL) as THREE.Mesh;
  const head = lamp.children.find((child) => child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial && child.material.emissive.getHex() === 0xf0e6c8) as THREE.Mesh;
  return { head: head.material as THREE.MeshStandardMaterial, pool: pool.material as THREE.MeshBasicMaterial };
}

/** What a stage's light is, written down to compare two. */
function lightOf(stage: WorldStage, scene: THREE.Scene): number[] {
  const sky = scene.background as THREE.Color;
  return [stage.sun.intensity, stage.sun.color.r, stage.sun.color.g, stage.sun.color.b, stage.sun.position.x, stage.sun.position.y, stage.sun.position.z, sky.r, sky.g, sky.b, FACADE_GLOW.value, stage.envIntensity, stage.smokeShade];
}

describe("given the stage's time of day and night setting (no cycle)", () => {
  // mutation: sed -i 's/    this.hemi.intensity = mixScalar(day.hemi\[1\], SUNSET.hemi\[1\], NIGHT.hemi\[1\], warm, k);/    this.hemi.intensity = mixScalar(day.hemi[1], SUNSET.hemi[1], NIGHT.hemi[1], warm, 0.5);/' src/game/present/engine-world.ts
  it("when the stage is lit by day and then by night, then its hemisphere, sun and fill are the day's and the night's darkened by the night depth, and the lamp heads and windows are lit at night only", () => {
    const { stage } = newStage();
    stage.setSkyTier("high");
    const { head, pool } = lampOf();
    expect(stage["hemi"].intensity, "day hemisphere").toBeCloseTo(1.35, 9);
    expect(stage.sun.intensity, "day sun").toBeCloseTo(2.6, 9);
    expect(FACADE_GLOW.value, "day windows").toBe(0);
    expect(head.emissiveIntensity, "day lamp heads").toBeCloseTo(1.4, 9);
    expect(pool.visible, "day pools").toBe(false);
    stage.setNight(true);
    expect(stage["hemi"].intensity, "night hemisphere").toBeCloseTo(THREE.MathUtils.lerp(1.35, 0.16, NIGHT_DEPTH), 9);
    expect(stage.sun.intensity, "night sun").toBeCloseTo(THREE.MathUtils.lerp(2.6, 0.32, NIGHT_DEPTH), 9);
    expect(FACADE_GLOW.value, "night windows").toBe(1);
    expect(head.emissiveIntensity, "night lamp heads").toBe(9);
    expect(pool.visible, "night pools").toBe(true);
    expect(pool.opacity, "night pools' opacity").toBeCloseTo(0.55, 9);
  });
});

describe("given the open world's cycle set by the game hour", () => {
  // mutation: sed -i 's/    if (this.dayHour !== null) return this.nightDepth \* this.grade.night;/    if (this.dayHour !== null) return this.grade.night;/' src/game/present/engine-world.ts
  it("when the hour is the dead of night, then the light is exactly the night setting's, and at noon exactly the day's", () => {
    const night = newStage();
    night.stage.setNight(true);
    const cycle = newStage();
    cycle.stage.setDayHour(0);
    const dark = lightOf(cycle.stage, cycle.scene);
    const expected = lightOf(night.stage, night.scene);
    for (const [at, value] of dark.entries()) expect(value, `night value ${at}`).toBeCloseTo(expected[at]!, 6);
    const day = newStage();
    const noon = newStage();
    noon.stage.setDayHour(12);
    const bright = lightOf(noon.stage, noon.scene);
    const plain = lightOf(day.stage, day.scene);
    for (const [at, value] of bright.entries()) if (at < 4 || at > 6) expect(value, `day value ${at}`).toBeCloseTo(plain[at]!, 6);
  });

  // mutation: sed -i 's/    lampPool.opacity = LAMP_POOL_OPACITY \* (cycling ? lamps : 1);/    lampPool.opacity = LAMP_POOL_OPACITY;/' src/game/present/engine-world.ts
  it("when the evening comes hour by hour, then the lamp heads, their pools and the windows come on together with it, ending where the night setting has them", () => {
    const { stage } = newStage();
    stage.setSkyTier("high");
    const { head, pool } = lampOf();
    stage.setDayHour(12);
    const noonHead = head.emissiveIntensity;
    expect(pool.visible, "noon pools").toBe(false);
    let previous = noonHead;
    let glow = 0;
    for (let minute = 16 * MINUTES_PER_HOUR; minute <= 21 * MINUTES_PER_HOUR; minute += 10) {
      stage.setDayHour(minute / MINUTES_PER_HOUR);
      expect(head.emissiveIntensity, `lamp heads at minute ${minute}`).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = head.emissiveIntensity;
      glow = Math.max(glow, FACADE_GLOW.value);
    }
    expect(head.emissiveIntensity, "night lamp heads").toBeCloseTo(9, 9);
    expect(FACADE_GLOW.value, "night windows").toBeCloseTo(1, 9);
    expect(pool.visible && pool.opacity > 0.5, "night pools").toBe(true);
    stage.setDayHour(18.6);
    expect(pool.visible && pool.opacity < 0.55, "dusk pools part way").toBe(true);
    expect(FACADE_GLOW.value, "dusk windows part way").toBeGreaterThan(0.3);
    expect(FACADE_GLOW.value, "dusk windows part way").toBeLessThan(1);
  });

  // mutation: sed -i 's/    if (this.dayHour === null \&\& this.night) return TIME_OF_DAY.night;/    if (this.night) return TIME_OF_DAY.night;/' src/game/present/engine-world.ts
  it("when a whole day is run, then the baked environment stays the day's, and the discrete night still bakes the night's", () => {
    const { stage } = newStage();
    const looks = new Set<string>();
    let nights = 0;
    for (let minute = 0; minute <= HOURS_PER_DAY * MINUTES_PER_HOUR; minute += 5) {
      stage.setDayHour(minute / MINUTES_PER_HOUR);
      looks.add(stage.envLook);
      if (stage.night) nights++;
    }
    expect(looks.size, "environments chosen over the day").toBe(1);
    expect(looks.has(TIME_OF_DAY.day), "the day's").toBe(true);
    expect(nights, "samples at night (the lamps' flag)").toBeGreaterThan(40);
    const discrete = newStage();
    discrete.stage.setNight(true);
    expect(discrete.stage.envLook, "the night setting's environment").toBe(TIME_OF_DAY.night);
  });

  // mutation: sed -i 's/    if (this.dayHour !== null) return;\n    if (this.time !== null) {/    if (this.time !== null) {/' src/game/present/engine-world.ts
  it("when a night key or setting asks for night or day in the cycle, then nothing changes, and leaving the cycle gives the night setting back", () => {
    const { stage, scene } = newStage();
    stage.setDayHour(12);
    const noon = lightOf(stage, scene);
    stage.setNight(true);
    expect(firstMismatch(lightOf(stage, scene), noon), "light after setNight(true) at noon").toBeUndefined();
    expect(stage.night, "night flag at noon").toBe(false);
    stage.setDayHour(null);
    expect(stage.night, "night flag outside the cycle").toBe(false);
    stage.setNight(true);
    expect(stage.night, "the night setting works again outside it").toBe(true);
    stage.setNight(false);
    stage.setDayHour(0);
    stage.setNight(false);
    expect(stage.night, "night flag at midnight, setNight(false) ignored").toBe(true);
  });

  // mutation: sed -i 's/    if (hour === null) {\n      if (this.dayHour === null) return;/    if (hour === null) {\n      return;/' src/game/present/engine-world.ts
  it("when the cycle is left, then the time of day's sun, sky and light are back as they were before it", () => {
    const { stage, scene } = newStage();
    stage.setTime(TIME_OF_DAY.sunset);
    const before = lightOf(stage, scene);
    const sun = stage.sunOffset.clone();
    stage.setDayHour(0);
    expect(stage.sunOffset.distanceTo(sun), "the cycle moved the sun").toBeGreaterThan(1);
    stage.setDayHour(null);
    expect(firstMismatch(lightOf(stage, scene), before), "light after the cycle").toBeUndefined();
    expect(stage.sunOffset.distanceTo(sunOffset(TIME_OF_DAY.sunset, new THREE.Vector3())), "the sunset's sun").toBeLessThan(SAME);
  });
});

describe("given the cycle's sun", () => {
  // mutation: sed -i 's/    } else if (sunNeedsHop(this.cycleElevation, target)) {/    } else if (true) {/' src/game/present/engine-world.ts
  it("when the hour passes minute by minute, then the light's direction and shadow axes change only at a hop, a few hundred times a day, and the grade changes every minute", () => {
    const { stage } = newStage();
    stage.setDayHour(0);
    const before = new THREE.Vector3();
    const right = new THREE.Vector3();
    let hops = 0;
    let steps = 0;
    let lastIntensity = stage.sun.intensity;
    let moved = 0;
    for (let minute = 1; minute <= HOURS_PER_DAY * MINUTES_PER_HOUR; minute++) {
      before.copy(stage.sunOffset);
      right.copy(stage.sunRight);
      stage.setDayHour(minute / MINUTES_PER_HOUR);
      const hopped = stage.sunOffset.distanceTo(before) > SAME;
      if (hopped) hops++;
      else expect(stage.sunRight.distanceTo(right), `shadow axes with no hop at minute ${minute}`).toBeLessThan(SAME);
      if (hopped) expect(stage.sunRight.distanceTo(right) >= 0, "axes after a hop").toBe(true);
      if (stage.sun.intensity !== lastIntensity) moved++;
      lastIntensity = stage.sun.intensity;
      steps++;
    }
    expect(hops, "hops in a game day").toBeGreaterThan(150);
    expect(hops, "hops in a game day").toBeLessThan(450);
    expect(moved, "minutes the sun's strength changed").toBeGreaterThan(steps / 4);
    expect(SUN_HOP_METRES, "the tolerance in force (m)").toBeGreaterThan(0);
  });

  // mutation: sed -i 's/const LOW_SUN = THREE.MathUtils.degToRad(12);/const LOW_SUN = THREE.MathUtils.degToRad(2);/' src/game/present/engine-world.ts
  it("when the light is read round the clock, then it never stands lower than the sunset's 12 degrees, is the day's 58 degrees at noon and the moon's at night", () => {
    const { stage } = newStage();
    const floor = THREE.MathUtils.degToRad(12);
    const elevation = (): number => Math.atan2(stage.sunOffset.y, Math.hypot(stage.sunOffset.x, stage.sunOffset.z));
    let lowest = Infinity;
    for (let minute = 0; minute <= HOURS_PER_DAY * MINUTES_PER_HOUR; minute++) {
      stage.setDayHour(minute / MINUTES_PER_HOUR);
      lowest = Math.min(lowest, elevation());
    }
    expect(lowest, "the lowest the light stood (rad)").toBeGreaterThanOrEqual(floor - 1e-6);
    stage.setDayHour(12);
    expect(elevation() * (180 / Math.PI), "noon's elevation (deg)").toBeCloseTo(58.6, 0);
    stage.setDayHour(1);
    expect(elevation() * (180 / Math.PI), "the moon's elevation (deg)").toBeGreaterThan(20);
  });
});

describe("given the sky in the cycle", () => {
  /** The dome's stars and the sky's colour at the horizon, as uniforms. */
  function skyOf(stage: WorldStage): { stars: number; horizon: THREE.Color } {
    const material = stage.sky.mesh.material as THREE.ShaderMaterial;
    return { stars: material.uniforms.uStars!.value as number, horizon: (material.uniforms.horizonColor!.value as THREE.Color).clone() };
  }

  // mutation: sed -i 's/    u.uStars!.value = night;/    u.uStars!.value = night > 0.5 ? 1 : 0;/' src/game/present/sky-dome.ts
  it("when the evening comes with a sky drawn, then the stars rise with the night and the horizon goes from the day's to the night's through the sunset's", () => {
    const { stage } = newStage();
    stage.setSkyTier("high");
    stage.setDayHour(12);
    const detail: SkyDetail = "procedural";
    expect(stage.sky.drawn, "the dome draws the procedural sky in the cycle").toBe(5);
    expect(detail).toBe("procedural");
    const day = skyOf(stage);
    stage.setDayHour(18.5);
    const dusk = skyOf(stage);
    stage.setDayHour(21.5);
    const night = skyOf(stage);
    stage.setDayHour(0);
    const dead = skyOf(stage);
    expect(day.stars, "stars at noon").toBe(0);
    expect(dusk.stars, "stars at dusk").toBeGreaterThan(0);
    expect(dusk.stars, "stars at dusk").toBeLessThan(1);
    expect(dead.stars, "stars at midnight").toBe(1);
    expect(night.stars, "stars after the dusk").toBeGreaterThan(dusk.stars);
    expect(dusk.horizon.r / dusk.horizon.b, "dusk's horizon is warmer (redder over blue) than the day's").toBeGreaterThan(day.horizon.r / day.horizon.b);
    expect(dead.horizon.r + dead.horizon.g + dead.horizon.b, "midnight's horizon is dark").toBeLessThan((day.horizon.r + day.horizon.g + day.horizon.b) / 4);
  });

  // mutation: sed -i 's/  if (uStars > 0.0) {/  if (uStars > 0.5) {/' src/game/present/sky-procedural.ts
  it("when the stars' shader is read, then their brightness scales with the stars uniform rather than switching at one half", () => {
    const stage = newStage().stage;
    const fragment = (stage.sky.mesh.material as THREE.ShaderMaterial).fragmentShader;
    expect(fragment, "the stars' guard").toContain("if (uStars > 0.0) {");
    expect(fragment, "the stars' strength").toContain("* uStars;");
  });
});

describe("given a stage at night on a tier with no bloom", () => {
  /** The lamp pool's opacity at hour `hour` on the sky tier `tier`. */
  function poolAt(tier: "off" | "minimal" | "low" | "high", hour: number): number {
    const { stage } = newStage();
    stage.setSkyTier(tier);
    stage.setDayHour(hour);
    return lampOf().pool.opacity;
  }

  // mutation: sed -i 's/ \* (this.skyTier === "off" || this.skyTier === "minimal" ? NO_BLOOM_POOL_GAIN : 1)//' src/game/present/engine-world.ts
  it("when the pool is read at minimal and at high, then minimal's is 1.4 times higher, and never over 1", () => {
    const high = poolAt("high", 0);
    expect(poolAt("minimal", 0), "minimal").toBeCloseTo(Math.min(1, high * 1.4), 9);
    expect(poolAt("off", 0), "off").toBeCloseTo(Math.min(1, high * 1.4), 9);
    expect(poolAt("low", 0), "low is as high").toBeCloseTo(high, 9);
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) expect(poolAt("minimal", hour), `hour ${hour}`).toBeLessThanOrEqual(1);
  });
});
