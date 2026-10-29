import { describe, expect, it } from "vitest";
import { decodeShare, followShare, type ShareState } from "./share-url.ts";

const DEFAULTS = decodeShare("");
/** The state of a page with `change` on it and the run's seed `seed` (the fleet is a seeded scene). */
const page = (change: Partial<ShareState>, seed = 0x3fa2c1): ShareState => ({ ...DEFAULTS, ...change, seed });
const follow = (s: ShareState, bar: string, client = false) => followShare(s, client, bar);

describe("given a page whose address bar follows only what the user changed", () => {
  it("when the page was opened with no hash, then the bar stays empty whatever seed the run rolled", () => {
    expect(follow(page({}), "")).toBe("");
    expect(follow(page({}, 0x1), "")).toBe("");
  });

  it("when the page was opened with a partial hash, then the bar keeps it as it is, with no seed and no other setting added", () => {
    expect(follow(page({ night: true }), "night=1")).toBe("night=1");
    expect(follow(page({ night: true }, 0xabc), "night=1")).toBe("night=1");
  });

  it("when the user makes the first change, then the bar gets the settings with the run's seed, so the link spawns the same field", () => {
    expect(follow(page({ night: true }), "")).toBe("night=1&seed=3fa2c1");
    expect(follow(page({ night: true, wet: true }), "night=1")).toBe("night=1&wet=1&seed=3fa2c1");
  });

  it("when the run's seed changes (Loop's next run), then the new seed follows only into a bar that already carries one", () => {
    expect(follow(page({ night: true }, 0x77), "night=1&seed=3fa2c1")).toBe("night=1&seed=77");
    expect(follow(page({ night: true }, 0x77), "night=1")).toBe("night=1");
    expect(follow(page({}, 0x77), "")).toBe("");
  });

  it("when the settings are put back to the defaults, then the bar empties, seed included", () => {
    expect(follow(page({}), "night=1&seed=3fa2c1")).toBe("");
  });

  it("when a scene other than the fleet is chosen and then the fleet again, then the bar records the scene while it is chosen and drops it on leaving it for the fleet", () => {
    expect(follow({ ...DEFAULTS, scene: "range" }, "")).toBe("scene=range");
    expect(follow(page({}), "scene=range")).toBe("");
  });

  it("when the page was opened with a hash in its own key order, then the bar is not rewritten into the encoder's key order", () => {
    expect(follow(page({ night: true, wet: true }), "wet=1&night=1")).toBe("wet=1&night=1");
  });

  it("when a netplay client has typed other settings too, then its bar is the room alone", () => {
    const client = page({ night: true, room: "ABCD2345" });
    expect(follow(client, "room=ABCD2345&night=1", true)).toBe("room=ABCD2345");
    expect(follow(client, "room=ABCD2345", true)).toBe("room=ABCD2345");
  });
});

describe("given a pasted share URL", () => {
  it("when the page starts from it, then its settings and its seed are what the page starts as, and the bar keeps the link as pasted", () => {
    const pasted = "#night=1&ramps=1&seed=3fa2c1";
    const t = decodeShare(pasted);
    expect(t.night).toBe(true);
    expect(t.ramps).toBe(true);
    expect(t.seed).toBe(0x3fa2c1);
    expect(follow(t, pasted.slice(1))).toBe(pasted.slice(1));
  });

  it("when the pasted link carries a seed and nothing else, then it keeps its seed until the settings or the run move on", () => {
    const t = decodeShare("#seed=3fa2c1");
    expect(t.seed).toBe(0x3fa2c1);
    expect(follow(t, "seed=3fa2c1")).toBe("seed=3fa2c1");
    expect(follow(page({ night: true }), "seed=3fa2c1")).toBe("night=1&seed=3fa2c1");
  });
});
