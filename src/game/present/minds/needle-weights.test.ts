import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { loadWeights, type WeightSources } from "./needle-weights.ts";

const URL = "https://weights.test/needle2.cact";
const GOOD = new Uint8Array([1, 2, 3, 4]);
const BAD = new Uint8Array([9, 9, 9]);

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A Cache Storage bucket and a network, both stand-ins that count what they are asked. */
function sources(cached: Uint8Array<ArrayBuffer> | null, served: Uint8Array<ArrayBuffer>) {
  const kept = new Map<string, Uint8Array<ArrayBuffer>>();
  if (cached !== null) kept.set(URL, cached);
  const counts = { fetches: 0, deletes: 0, puts: 0 };
  const cache = {
    match: (url: RequestInfo | URL) => Promise.resolve(kept.has(String(url)) ? new Response(kept.get(String(url))) : undefined),
    put: async (url: RequestInfo | URL, response: Response) => {
      counts.puts++;
      kept.set(String(url), new Uint8Array(await response.arrayBuffer()));
    },
    delete: (url: RequestInfo | URL) => {
      counts.deletes++;
      return Promise.resolve(kept.delete(String(url)));
    },
  };
  const given: WeightSources = {
    fetch: () => {
      counts.fetches++;
      return Promise.resolve(new Response(served));
    },
    caches: { open: () => Promise.resolve(cache) },
    digest: (bytes) => crypto.subtle.digest("SHA-256", bytes),
  };
  return { given, counts, kept };
}

describe("given the Needle weights and their known hash", () => {
  // mutation: sed -i 's/    if (hex(await sources.digest(bytes)) === sha256) return { bytes, cached: true };/    if (hex(await sources.digest(bytes)) === "") return { bytes, cached: true };/' src/game/present/minds/needle-weights.ts
  it("when a good copy is cached, then it is used and nothing is fetched", async () => {
    const { given, counts } = sources(GOOD, GOOD);
    const got = await loadWeights(given, "bucket", URL, await sha256(GOOD));
    expect(got.cached, "from the cache").toBe(true);
    expect(counts.fetches, "fetches").toBe(0);
  });

  // mutation: sed -i '/^    await cache.delete(url);/d' src/game/present/minds/needle-weights.ts
  it("when the cached copy does not hash right, then it is dropped, fetched again and the good copy kept", async () => {
    const { given, counts, kept } = sources(BAD, GOOD);
    const got = await loadWeights(given, "bucket", URL, await sha256(GOOD));
    expect(firstMismatch([got.cached, got.bytes.length, counts.deletes, counts.fetches, counts.puts], [false, GOOD.length, 1, 1, 1]), "cached, bytes, deletes, fetches, puts").toBeUndefined();
    expect(kept.get(URL)?.length, "the kept copy").toBe(GOOD.length);
  });

  // mutation: sed -i 's/  if (got !== sha256) throw new Error/  if (got === "") throw new Error/' src/game/present/minds/needle-weights.ts
  it("when the download does not hash right, then loading fails and nothing is cached", async () => {
    const { given, counts } = sources(null, BAD);
    await expect(loadWeights(given, "bucket", URL, await sha256(GOOD))).rejects.toThrow(/hashed to/);
    expect(counts.puts, "puts").toBe(0);
  });
});
