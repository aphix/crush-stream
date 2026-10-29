import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { CAR_SPRAY, carPickText, NO_CAR_PICK, NO_PERSON_PICK, packSpray, PERSON_SPRAY, personPickText, SPRAY_PALETTE } from "../match/look-data.ts";
import { packLook, readLook } from "../net/look-codec.ts";
import { RELAY_MSG_MAX } from "../net/net-hub.test-util.ts";
import { PlayerLooks } from "./player-looks.ts";
import { must } from "../kernel/must.test-util.ts";

/** Where `PlayerLooks` keeps each spray: what a build from before the bitmaps doubled wrote too. */
const KEYS = { car: "crush.spray.car", person: "crush.spray.person" } as const;
/** The bitmaps' side before NET 34. */
const OLD_SIDE = 128;

let saved: Map<string, string>;
beforeEach(() => {
  saved = new Map();
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v), removeItem: (k: string) => saved.delete(k) } });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

/** Every texel a different ink from its neighbour (nibbles on the wire, the most bytes a bitmap packs to), each ink a colour of the player's own. */
function speckled(count: number): { texels: Uint8Array; palette: number[] } {
  const texels = Uint8Array.from({ length: count }, (_, i) => (i % 15) + 1);
  return { texels, palette: SPRAY_PALETTE.map((c, ink) => (ink === 0 ? c : 0x010203 * ink)) };
}

describe("given the player's spray kept in this browser's storage", () => {
  const oldSaves = [
    { it: "a stripe and a dot in presets (packed as runs)", paint: () => ({ texels: new Uint8Array(OLD_SIDE * OLD_SIDE).fill(4, 3000, 3500).fill(9, 9000, 9003), palette: SPRAY_PALETTE }) },
    { it: "a speckled bitmap in colours of the player's own (packed as nibbles)", paint: () => speckled(OLD_SIDE * OLD_SIDE) },
  ];
  for (const testCase of oldSaves) {
    it(`when a 128 x 128 save of ${testCase.it} is loaded, then each old texel covers its 2 x 2 of the 256 x 256 bitmap in the same ink and colour`, () => {
      const old = testCase.paint();
      for (const key of Object.values(KEYS)) saved.set(key, Buffer.from(packSpray(old)).toString("base64"));
      const looks = new PlayerLooks();
      for (const bitmap of [looks.mine.carSpray, looks.mine.personSpray]) {
        const side = bitmap.layout.w;
        expect(side, "the bitmap is twice the old side").toBe(2 * OLD_SIDE);
        const expected = Uint8Array.from({ length: side * side }, (_, i) => old.texels[(Math.floor(i / side) >> 1) * OLD_SIDE + ((i % side) >> 1)]!);
        assertSameNumbers(bitmap.texels, expected, "texels doubled 2 x 2");
        assertSameNumbers(bitmap.palette, old.palette, "the inks' colours");
      }
      looks.dispose();
    });
  }

  it("when a heavy 256 x 256 spray (every texel painted, 15 colours of the player's own) is saved and sent, then the next visit and a peer read it back exactly, and its look is one message under the relay's cap", () => {
    const looks = new PlayerLooks();
    looks.mine.carSpray.load(speckled(CAR_SPRAY.w * CAR_SPRAY.h));
    looks.mine.personSpray.load(speckled(PERSON_SPRAY.w * PERSON_SPRAY.h));
    looks.save("car");
    looks.save("person");
    const next = new PlayerLooks();
    for (const target of ["car", "person"] as const) {
      assertSameNumbers(next.sprayOf(target).texels, looks.sprayOf(target).texels, `${target}: texels from storage`);
      assertSameNumbers(next.sprayOf(target).palette, looks.sprayOf(target).palette, `${target}: inks from storage`);
    }
    const msg = packLook(3, { ...looks.data(), car: { ...NO_CAR_PICK, body: 0xffffff }, person: { ...NO_PERSON_PICK, shirt: 0xffffff } });
    expect(msg.length, `MSG.look ${msg.length} bytes against the cap's ${RELAY_MSG_MAX}`).toBeLessThanOrEqual(RELAY_MSG_MAX);
    const heard = readLook(msg);
    must(heard, "a peer reads the look");
    assertSameNumbers(heard.look.carSpray.texels, looks.mine.carSpray.texels, "car texels on the wire");
    assertSameNumbers(heard.look.personSpray.palette, looks.mine.personSpray.palette, "driver inks on the wire");
    looks.dispose();
    next.dispose();
  });

  it("when a peer's look is worn, then its car spray is mipped, so a far car's paint does not alias", () => {
    const looks = new PlayerLooks();
    looks.wear(1, looks.data());
    expect(looks.of(1, 0)?.carSpray.texture.generateMipmaps).toBe(true);
    looks.dispose();
  });
});

describe("given the player's picks kept in this browser's storage", () => {
  it("when the driver's build and clothes and the car's colours are kept and the page loads again, then the next visit wears the same picks, and a bare browser or a garbled save wears none", () => {
    const looks = new PlayerLooks();
    looks.mine.person = { woman: true, shirt: 0x123456, pants: 0x654321, hair: null, hat: 0xabcdef, mustache: false };
    looks.mine.car = { ...NO_CAR_PICK, body: 0xff0000, rims: 0x00ff00 };
    looks.savePicks();
    const next = new PlayerLooks();
    expect(personPickText(next.mine.person), "the driver's picks").toBe(personPickText(looks.mine.person));
    expect(carPickText(next.mine.car), "the car's picks").toBe(carPickText(looks.mine.car));
    saved.set("crush.look.person", "garbled");
    saved.delete("crush.look.car");
    const garbled = new PlayerLooks();
    expect(personPickText(garbled.mine.person), "a garbled save").toBe(personPickText(NO_PERSON_PICK));
    expect(carPickText(garbled.mine.car), "no save").toBe(carPickText(NO_CAR_PICK));
    for (const l of [looks, next, garbled]) l.dispose();
  });
});
