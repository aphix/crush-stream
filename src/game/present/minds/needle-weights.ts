/** What weight loading needs of the browser: fetch, Cache Storage and SHA-256 (the worker's own; a test hands in stand-ins). */
export type WeightSources = {
  fetch: (url: string) => Promise<Response>;
  caches: { open: (name: string) => Promise<Pick<Cache, "match" | "put" | "delete">> };
  digest: (bytes: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;
};

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The model's weights: from Cache Storage when a verified copy is there, else downloaded once and kept. Either way the bytes must hash to `sha256`;
 * a cached copy that does not is dropped and fetched again, a download that does not is refused (throws).
 */
export async function loadWeights(sources: WeightSources, cacheName: string, url: string, sha256: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; cached: boolean }> {
  const cache = await sources.caches.open(cacheName);
  const kept = await cache.match(url);
  if (kept !== undefined) {
    const bytes = new Uint8Array(await kept.arrayBuffer());
    if (hex(await sources.digest(bytes)) === sha256) return { bytes, cached: true };
    await cache.delete(url);
  }
  const response = await sources.fetch(url);
  if (!response.ok) throw new Error(`Needle weights: ${url} answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const got = hex(await sources.digest(bytes));
  if (got !== sha256) throw new Error(`Needle weights: ${url} hashed to ${got}, not ${sha256}`);
  await cache.put(url, new Response(bytes));
  return { bytes, cached: false };
}
