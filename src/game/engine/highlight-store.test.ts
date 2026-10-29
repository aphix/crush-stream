import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { encodeSaved } from "../net/reel-codec.ts";
import { makeClip } from "../net/reel-clip.test-util.ts";
import { autoPurge, deleteSaved, listSaved, loadSaved, purgeOutdated, setAutoPurge } from "./highlight-store.ts";

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
    assert.deepEqual(got.saved.map((s) => s.key), ["now"]);
    assert.equal(got.outdated, 2);
    assert.deepEqual([...store.keys()].sort(), ["crush.highlight.now", "crush.highlight.oldNet", "crush.highlight.oldReplay", "crush.highlights"], "listing alone deletes none");
  });

  it("when a clip's text is gone from storage or is not a clip, then it is outdated too", () => {
    store.delete("crush.highlight.now");
    store.set("crush.highlight.oldReplay", "%%%");
    store.set("crush.highlight.oldNet", "QQ==");
    assert.deepEqual(listSaved(), { saved: [], outdated: 3 });
  });

  it("when the outdated clips are purged, then exactly those clips and their index rows go, the playable one stays whole, and a second purge changes nothing", () => {
    const keptText = loadSaved("now");
    purgeOutdated();
    assert.deepEqual(listSaved().saved.map((s) => s.key), ["now"]);
    assert.equal(listSaved().outdated, 0);
    assert.equal(loadSaved("now"), keptText);
    assert.equal(loadSaved("oldReplay"), null);
    assert.equal(loadSaved("oldNet"), null);
    assert.deepEqual([...store.keys()].sort(), ["crush.highlight.now", "crush.highlights"]);
    const index = store.get("crush.highlights");
    purgeOutdated();
    assert.equal(store.get("crush.highlights"), index);
  });

  it("when auto-purge is off, then listing keeps the outdated clips; when it is set, then listing deletes them at once, reports none, and keeps the playable one", () => {
    assert.equal(autoPurge(), false, "off until set");
    assert.equal(listSaved().outdated, 2);
    assert.equal(loadSaved("oldReplay") !== null, true, "kept while off");
    setAutoPurge(true);
    assert.equal(autoPurge(), true, "kept in storage");
    const got = listSaved();
    assert.equal(got.outdated, 0);
    assert.deepEqual(got.saved.map((s) => s.key), ["now"]);
    assert.equal(loadSaved("oldReplay"), null);
    assert.equal(loadSaved("oldNet"), null);
    setAutoPurge(false);
    assert.equal(autoPurge(), false);
  });

  it("when the playable clip is deleted, then it goes and the outdated count stays", () => {
    deleteSaved("now");
    assert.deepEqual(listSaved(), { saved: [], outdated: 2 });
  });

  it("when only the sim fingerprint in a clip's header differs, then it is outdated (listing reads the header alone, never the body)", () => {
    store.set("crush.highlight.now", flipByte(loadSaved("now")!, 7));
    assert.deepEqual(listSaved().saved, []);
    assert.equal(listSaved().outdated, 3);
  });
});
