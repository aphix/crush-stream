import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../game/kernel/compare-arrays.test-util.ts";
import { backoffMs, fetchDeployedSha, newerBuild, planReload, settleReload } from "./update-check.ts";

/** A browser's local storage, in memory. */
function memoryStore(): Storage {
  const rows = new Map<string, string>();
  return {
    get length() {
      return rows.size;
    },
    clear: () => rows.clear(),
    getItem: (k: string) => rows.get(k) ?? null,
    key: (i: number) => [...rows.keys()][i] ?? null,
    removeItem: (k: string) => void rows.delete(k),
    setItem: (k: string, v: string) => void rows.set(k, v),
  };
}

function replying(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

const MIN = 60_000;
const HREF = "https://game.test/crush/?bench=city#seed=7";

describe("given the running build and the sha the server's version file names", () => {
  const cases = [
    { it: "the server names a different build", running: "3295bad", deployed: "a1b2c3d", expected: "a1b2c3d" },
    { it: "the server names the same build", running: "3295bad", deployed: "3295bad", expected: null },
    { it: "the version file could not be read", running: "3295bad", deployed: null, expected: null },
    { it: "the server's build had no git (dev)", running: "3295bad", deployed: "dev", expected: null },
    { it: "the running build had no git (dev)", running: "dev", deployed: "a1b2c3d", expected: null },
  ];
  for (const testCase of cases) {
    it(`when ${testCase.it}, then the newer build is ${testCase.expected ?? "none"}`, () => {
      expect(newerBuild(testCase.running, testCase.deployed)).toBe(testCase.expected);
    });
  }
});

describe("given the version file the build emits", () => {
  const cases = [
    { it: "it names a sha", offline: false, status: 200, body: '{"sha":"3295bad"}', expected: "3295bad" },
    { it: "the server answers an error page", offline: false, status: 404, body: "<html>404</html>", expected: null },
    { it: "the server answers HTML with a 200 (a single-page fallback)", offline: false, status: 200, body: "<html></html>", expected: null },
    { it: "the sha holds a path", offline: false, status: 200, body: '{"sha":"../../x"}', expected: null },
    { it: "the sha is not text", offline: false, status: 200, body: '{"sha":12}', expected: null },
    { it: "there is no network", offline: true, status: 0, body: "", expected: null },
  ];
  const unreachable = (async () => Promise.reject(new TypeError("offline"))) as typeof fetch;
  for (const testCase of cases) {
    it(`when ${testCase.it}, then the deployed sha read is ${testCase.expected ?? "none"}`, async () => {
      const fetcher = testCase.offline ? unreachable : replying(testCase.body, testCase.status);
      expect(await fetchDeployedSha(fetcher)).toBe(testCase.expected);
    });
  }
});

describe("given an unattended page that keeps finding a newer build deployed", () => {
  it("when a reload goes and the page comes back still on the old build, then the next ones wait 2, 4, 8 ... minutes, and a new deploy goes at once", () => {
    const store = memoryStore();
    // The page asks every 30 s; the server's file says a1b2c3d, the page keeps coming back on 3295bad.
    const goes: number[] = [];
    for (let t = 0; t <= 20 * MIN; t += MIN / 2) if (planReload(store, HREF, "a1b2c3d", t) !== null) goes.push(t);
    expect(firstMismatch(goes, [0, 2 * MIN, 6 * MIN, 14 * MIN]), "the times a reload goes").toBeUndefined();
    expect(planReload(store, HREF, "f00ba12", 15 * MIN), "another build is not held back by the first one's backoff").not.toBe(null);
  });

  it("when the backoff has grown past an hour of waiting, then it stays at an hour", () => {
    expect(firstMismatch([1, 2, 3, 5, 6, 20].map(backoffMs), [2 * MIN, 4 * MIN, 8 * MIN, 32 * MIN, 60 * MIN, 60 * MIN]), "backoff per failed reload").toBeUndefined();
  });

  it("when the reload lands on the new build, then the record is spent and the next deploy starts from a first reload", () => {
    const store = memoryStore();
    planReload(store, HREF, "a1b2c3d", 0);
    settleReload(store, "a1b2c3d");
    expect(store.length).toBe(0);
    expect(planReload(store, HREF, "a1b2c3d", 1000)).not.toBe(null);
  });

  it("when the reload lands on a different build than it went for, then the record is kept", () => {
    const store = memoryStore();
    planReload(store, HREF, "a1b2c3d", 0);
    settleReload(store, "3295bad");
    expect(planReload(store, HREF, "a1b2c3d", 1000)).toBe(null);
  });

  it("when the device's clock is set back past the last reload, then the reload is not held for the whole jump", () => {
    const store = memoryStore();
    planReload(store, HREF, "a1b2c3d", 10 * MIN);
    expect(planReload(store, HREF, "a1b2c3d", 0)).not.toBe(null);
  });

  it("when a person taps the notice during the backoff, then the reload goes and counts toward the next backoff", () => {
    const store = memoryStore();
    planReload(store, HREF, "a1b2c3d", 0);
    expect(planReload(store, HREF, "a1b2c3d", MIN)).toBe(null);
    expect(planReload(store, HREF, "a1b2c3d", MIN, true)).not.toBe(null);
    expect(planReload(store, HREF, "a1b2c3d", 4 * MIN), "the tap was the second try: 4 minutes more").toBe(null);
    expect(planReload(store, HREF, "a1b2c3d", 5 * MIN)).not.toBe(null);
  });

  it("when storage cannot remember the attempt, then no automatic reload goes (it could not back off), but a tap does", () => {
    expect(planReload(null, HREF, "a1b2c3d", 0)).toBe(null);
    expect(planReload(null, HREF, "a1b2c3d", 0, true)).not.toBe(null);
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(planReload(full, HREF, "a1b2c3d", 0)).toBe(null);
  });
});

describe("given a page address with a query and a share fragment", () => {
  it("when the reload goes, then it keeps the query and the fragment and adds the deployed sha as v", () => {
    expect(planReload(memoryStore(), HREF, "a1b2c3d", 0)).toBe("https://game.test/crush/?bench=city&v=a1b2c3d#seed=7");
  });

  it("when the address already carries an older v, then the reload replaces it", () => {
    expect(planReload(memoryStore(), "https://game.test/crush/?v=old", "a1b2c3d", 0)).toBe("https://game.test/crush/?v=a1b2c3d");
  });
});
