import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { LOOK } from "../ai/civilians/civilian-crowd-constants.ts";
import { ATTIRE } from "./civilian-art-constants.ts";
import { dressOfLook, skinOfLook } from "./civilian-dress.ts";
import { OUTFIT, type DriverLook } from "./driver-look.ts";

const LOOKS = 2000;
const LOOK_STEP = 0x9e3779b1;
const CONSECUTIVE_LOOKS = 64;
const blankLook = (): DriverLook => ({ woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false });
const looks = Array.from({ length: LOOKS }, (_, index) => Math.imul(index + 1, LOOK_STEP) >>> 0);

/** Look `look` dressed: the person and the attire it drew. */
function dressed(look: number): { person: DriverLook; attire: number } {
  const person = blankLook();
  return { person, attire: dressOfLook(look, person) };
}

describe("given two thousand crowd looks", () => {
  const everyone = looks.map(dressed);

  it("when they are dressed, then every attire of the city's wardrobe is worn", () => {
    const worn = [...new Set(everyone.map((one) => one.attire))].sort();
    expect(firstMismatch(worn, Object.values(ATTIRE).sort()), "attires worn").toBeUndefined();
  });

  it("when they are dressed, then both builds, caps, shades and moustaches appear", () => {
    expect(everyone.some((one) => one.person.woman), "a woman").toBe(true);
    expect(everyone.some((one) => !one.person.woman), "a man").toBe(true);
    expect(everyone.some((one) => one.person.hat !== null), "a cap").toBe(true);
    expect(everyone.some((one) => one.person.shades === true), "shades").toBe(true);
    expect(everyone.some((one) => one.person.mustache), "a moustache").toBe(true);
  });

  it("when they are dressed, then a suit's trousers match its jacket and a woman's moustache never grows", () => {
    const suited = everyone.filter((one) => one.attire === ATTIRE.SUIT);
    expect(suited.length, "suits worn").toBeGreaterThan(0);
    for (const one of suited) expect(one.person.pants, "suit trousers").toBe(one.person.shirt);
    expect(everyone.filter((one) => one.person.woman && one.person.mustache), "women with a moustache").toHaveLength(0);
    expect(everyone.some((one) => one.person.outfit === OUTFIT.SUIT), "a suit outfit").toBe(true);
  });

  it("when a look's woman bit is set or clear, then she is drawn a woman or he a man, whatever else the word holds", () => {
    const wrong = looks.filter((look) => dressed(look).person.woman !== (((look >>> LOOK.womanShift) & 1) === 1));
    expect(wrong, "looks drawn against their woman bit").toHaveLength(0);
    const womanBit = 1 << LOOK.womanShift;
    for (const look of looks.slice(0, 50)) {
      expect(dressed(look | womanBit).person.woman, "bit set").toBe(true);
      expect(dressed(look & ~womanBit).person.woman, "bit clear").toBe(false);
    }
  });

  it("when a look is dressed twice, then it is dressed the same", () => {
    const again = dressed(looks[7]!);
    expect(again.attire, "attire").toBe(everyone[7]!.attire);
    expect(again.person.shirt, "shirt").toBe(everyone[7]!.person.shirt);
    expect(again.person.hair, "hair").toBe(everyone[7]!.person.hair);
    expect(again.person.face, "face").toBe(everyone[7]!.person.face);
    expect(skinOfLook(again.person), "skin").toBe(skinOfLook(everyone[7]!.person));
  });
});

describe("given consecutive look seeds", () => {
  it("when they are dressed, then neighbours do not wear the same attire all the time", () => {
    const attires = Array.from({ length: CONSECUTIVE_LOOKS }, (_, look) => dressed(look).attire);
    expect(new Set(attires).size, "attires among consecutive seeds").toBeGreaterThanOrEqual(4);
  });
});
