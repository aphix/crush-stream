import { describe, expect, it } from "vitest";
import { KONAMI, KonamiCode } from "./konami.ts";

const typed = (k: KonamiCode, codes: readonly string[]): boolean[] => codes.map((c) => k.press(c));

describe("given the Konami code watcher (up up down down left right left right B A B A)", () => {
  it("when the code is typed, then only its last key reports it", () => {
    const hits = typed(new KonamiCode(), KONAMI);
    expect(hits.indexOf(true)).toBe(KONAMI.length - 1);
    expect(hits.filter(Boolean).length).toBe(1);
  });

  it("when stray keys and an extra up come first, then the code still counts; a wrong key inside it spoils that run", () => {
    expect(typed(new KonamiCode(), ["KeyW", "ArrowUp", ...KONAMI]).at(-1)).toBe(true);
    expect(typed(new KonamiCode(), [...KONAMI.slice(0, 6), "KeyX", ...KONAMI.slice(6)]).includes(true)).toBe(false);
  });

  it("when the classic code (one B A) is typed, then it is not this one", () => {
    expect(typed(new KonamiCode(), KONAMI.slice(0, 10)).includes(true)).toBe(false);
  });

  it("when the code is typed twice, then each completes it once", () => {
    const hits = typed(new KonamiCode(), [...KONAMI, ...KONAMI]);
    expect(hits.filter(Boolean).length).toBe(2);
  });
});
