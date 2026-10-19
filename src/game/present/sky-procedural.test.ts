import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TIME_OF_DAY } from "../match/types.ts";
import { PROCEDURAL_LOOKS, SANDBOX_SKY, type ProceduralLook, type SkyStops } from "./sky-procedural.ts";

const HEX = /^#[0-9a-f]{6}$/;

const cases: { it: string; look: ProceduralLook & Partial<SkyStops>; stops: boolean; stars: boolean }[] = [
  { it: "a race by day", look: PROCEDURAL_LOOKS[TIME_OF_DAY.day], stops: false, stars: false },
  { it: "a race at sunset", look: PROCEDURAL_LOOKS[TIME_OF_DAY.sunset], stops: false, stars: false },
  { it: "a race at night", look: PROCEDURAL_LOOKS[TIME_OF_DAY.night], stops: false, stars: true },
  { it: "the sandbox by day", look: SANDBOX_SKY.day, stops: true, stars: false },
  { it: "the sandbox by night", look: SANDBOX_SKY.night, stops: true, stars: true },
];

describe("given the procedural sky's looks", () => {
  for (const c of cases) {
    it(`when ${c.it} is drawn, then its clouds and disc have colours, stars show only at night and the sandbox brings its own gradient`, () => {
      assert.match(c.look.cloudLit, HEX);
      assert.match(c.look.cloudShade, HEX);
      assert.equal(c.look.discTint.length, 3);
      for (const channel of c.look.discTint) assert.ok(channel > 0 && channel <= 1, `disc tint channel ${channel}`);
      assert.equal(c.look.stars, c.stars);
      if (!c.stops) return;
      for (const stop of [c.look.horizon, c.look.mid, c.look.zenith]) assert.match(stop ?? "", HEX);
      assert.ok((c.look.zenithElevation ?? 0) > 0 && (c.look.hazeTop ?? 0) > 0, `zenith at ${c.look.zenithElevation} rad, haze to ${c.look.hazeTop} rad`);
    });
  }
});
