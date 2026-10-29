import { describe, expect, it } from "vitest";
import { driverLook, pickedLook } from "../present/driver-look.ts";
import { carPickText, NO_CAR_PICK, NO_PERSON_PICK, parseCarPick, parsePersonPick, personPickText } from "./look-data.ts";

describe("given a player's look picks as the URL and the look message carry them", () => {
  it("when a car pick with some parts picked is written and read back, then it is the same pick, and the unpicked parts stay unpicked", () => {
    const pick = { ...NO_CAR_PICK, body: 0xff0000, rims: 0x00ff00, glass: 0x000001 };
    const text = carPickText(pick);
    expect(text).toBe("ff0000.....00ff00.000001");
    const back = parseCarPick(text)!;
    expect(carPickText(back), "the same text").toBe(text);
    expect(back.body, "body").toBe(0xff0000);
    expect(back.doors, "doors unpicked").toBe(null);
    expect(back.glass, "glass").toBe(0x000001);
  });

  it("when a driver pick (a woman with a cap and a moustache) is written and read back, then it is the same pick", () => {
    const pick = { ...NO_PERSON_PICK, woman: true, shirt: 0x123456, hat: 0xabcdef, mustache: true };
    const text = personPickText(pick);
    expect(text).toBe("w.123456...abcdef.1");
    const back = parsePersonPick(text)!;
    expect(back.woman, "build").toBe(true);
    expect(back.shirt, "shirt").toBe(0x123456);
    expect(back.pants, "trousers unpicked").toBe(null);
    expect(back.hat, "cap").toBe(0xabcdef);
    expect(back.mustache, "moustache").toBe(true);
  });

  const refusedCarPicks = [
    { it: "when a car pick has one slot too few, then it is refused", pick: "ff0000.....00ff00" },
    { it: "when a car pick's colour is not 6 hex digits, then it is refused", pick: "ff00......." },
  ] as const;
  for (const testCase of refusedCarPicks) {
    it(testCase.it, () => {
      expect(parseCarPick(testCase.pick), "parsed car pick").toBe(null);
    });
  }

  const refusedPersonPicks = [
    { it: "when a driver pick's build is neither w nor m, then it is refused", pick: "x....." },
    { it: "when a driver pick's moustache slot is not 1, then it is refused", pick: "m.....yes" },
  ] as const;
  for (const testCase of refusedPersonPicks) {
    it(testCase.it, () => {
      expect(parsePersonPick(testCase.pick), "parsed driver pick").toBe(null);
    });
  }

  it("when a drawn driver wears a pick of a shirt alone, then he keeps his own build, trousers and hair and wears the picked shirt", () => {
    const base = driverLook(3, 1);
    const look = pickedLook(base, { ...NO_PERSON_PICK, shirt: 0x010203 });
    expect(look.shirt, "shirt").toBe(0x010203);
    expect(look.woman, "build").toBe(base.woman);
    expect(look.pants, "trousers").toBe(base.pants);
    expect(look.hair, "hair").toBe(base.hair);
    expect(look.hat, "no cap").toBe(null);
  });
});
