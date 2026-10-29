import { beforeEach, describe, expect, it } from "vitest";
import { encodeSaved } from "../net/reel-codec.ts";
import { makeClip } from "../net/reel-clip.test-util.ts";
import { autoPurge, deleteSaved, listSaved, loadSaved, purgeOutdated, setAutoPurge } from "./highlight-store.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** A `localStorage` in a Map: the store reads and writes nothing else of the browser. */
function stubStorage(): Map<string, string> {
  const m = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    },
  });
  return m;
}

/** `text` with byte `at` of its 11-byte header inverted: another build's clip. */
function flipByte(text: string, at: number): string {
  const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  bytes[at] = bytes[at]! ^ 0xff;
  return btoa(String.fromCharCode(...bytes));
}

const KEYS = ["now", "oldReplay", "oldNet"];

/** Three saved clips, newest first: this build's, one saved under another REPLAY_VERSION, one under another NET_VERSION. */
async function seed(store: Map<string, string>): Promise<void> {
  const text = await encodeSaved(makeClip().clip);
  const texts = [text, flipByte(text, 4), flipByte(text, 6)];
  store.set(
    "crush.highlights",
    JSON.stringify(KEYS.map((key, i) => ({ key, title: `clip ${key}`, trackName: "Oval", savedAt: 3 - i, chars: texts[i]!.length }))),
  );
  for (const [i, key] of KEYS.entries()) store.set(`crush.highlight.${key}`, texts[i]!);
}

describe("given saved highlights of this build and of others in a browser's storage", () => {
  let store: Map<string, string>;
  beforeEach(async () => {
    store = stubStorage();
    await seed(store);
  });

  it("when the saved clips are listed, then only the playable one is listed, the other two are counted as outdated, and nothing is deleted", () => {
    const got = listSaved();
    expect(firstMismatch(got.saved.map((s) => s.key), ["now"])).toBeUndefined();
    expect(got.outdated).toBe(2);
    expect(firstMismatch([...store.keys()].sort(), ["crush.highlight.now", "crush.highlight.oldNet", "crush.highlight.oldReplay", "crush.highlights"]), "listing alone deletes none").toBeUndefined();
  });

  it("when a clip's text is gone from storage or is not a clip, then it is outdated too", () => {
    store.delete("crush.highlight.now");
    store.set("crush.highlight.oldReplay", "%%%");
    store.set("crush.highlight.oldNet", "QQ==");
    const listed = listSaved();
    expect(listed.saved, "saved clips listed").toHaveLength(0);
    expect(listed.outdated, "outdated clips counted").toBe(3);
  });

  it("when the outdated clips are purged, then exactly those clips and their index rows go, the playable one stays whole, and a second purge changes nothing", () => {
    const keptText = loadSaved("now");
    purgeOutdated();
    expect(firstMismatch(listSaved().saved.map((s) => s.key), ["now"])).toBeUndefined();
    expect(listSaved().outdated).toBe(0);
    expect(loadSaved("now")).toBe(keptText);
    expect(loadSaved("oldReplay")).toBe(null);
    expect(loadSaved("oldNet")).toBe(null);
    expect(firstMismatch([...store.keys()].sort(), ["crush.highlight.now", "crush.highlights"])).toBeUndefined();
    const index = store.get("crush.highlights");
    purgeOutdated();
    expect(store.get("crush.highlights")).toBe(index);
  });

  it("when auto-purge is off, then listing keeps the outdated clips; when it is set, then listing deletes them at once, reports none, and keeps the playable one", () => {
    expect(autoPurge(), "off until set").toBe(false);
    expect(listSaved().outdated).toBe(2);
    expect(loadSaved("oldReplay") !== null, "kept while off").toBe(true);
    setAutoPurge(true);
    expect(autoPurge(), "kept in storage").toBe(true);
    const got = listSaved();
    expect(got.outdated).toBe(0);
    expect(firstMismatch(got.saved.map((s) => s.key), ["now"])).toBeUndefined();
    expect(loadSaved("oldReplay")).toBe(null);
    expect(loadSaved("oldNet")).toBe(null);
    setAutoPurge(false);
    expect(autoPurge()).toBe(false);
  });

  it("when the playable clip is deleted, then it goes and the outdated count stays", () => {
    deleteSaved("now");
    const listed = listSaved();
    expect(listed.saved, "saved clips listed").toHaveLength(0);
    expect(listed.outdated, "outdated clips counted").toBe(2);
  });

  it("when only the sim fingerprint in a clip's header differs, then it is outdated (listing reads the header alone, never the body)", () => {
    store.set("crush.highlight.now", flipByte(loadSaved("now")!, 7));
    expect(listSaved().saved).toHaveLength(0);
    expect(listSaved().outdated).toBe(3);
  });
});
