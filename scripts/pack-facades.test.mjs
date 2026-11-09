import { createCanvas } from "@napi-rs/canvas";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKER = new URL("./pack-facades.mjs", import.meta.url).pathname;
const SHIPPED_JSON = new URL("../src/game/present/facade-layers.json", import.meta.url).pathname;
/** The packer filters and blurs every layer: a style takes tens of seconds. */
const PACK_TIMEOUT_MS = 180_000;
/** The size the farm style's crop needs (its picture is 848 x 1264) and a stand-in sentinel for its entry. */
const PICTURE = { width: 848, height: 1264 };
const SENTINEL = { bays: 99 };

function farmPicture() {
  const canvas = createCanvas(PICTURE.width, PICTURE.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#b8a089";
  context.fillRect(0, 0, PICTURE.width, PICTURE.height);
  context.fillStyle = "#2b3a45";
  for (const x of [306, 397, 488]) context.fillRect(x, 685, 54, 65);
  return canvas.toBuffer("image/png");
}

function workspace(pictures) {
  const dir = mkdtempSync(join(tmpdir(), "pack-facades-"));
  const folder = join(dir, "pictures");
  mkdirSync(folder);
  for (const [name, bytes] of Object.entries(pictures)) writeFileSync(join(folder, name), bytes);
  const json = join(dir, "layers.json");
  const shipped = JSON.parse(readFileSync(SHIPPED_JSON, "utf8"));
  writeFileSync(json, `${JSON.stringify({ ...shipped, farm: SENTINEL }, null, 2)}\n`);
  return { folder, out: join(dir, "out"), json, shipped };
}

const pack = ({ folder, out, json }) => spawnSync(process.execPath, [PACKER, folder, out, json], { encoding: "utf8" });

describe("given a folder with the picture of one style and the shipped layer data", () => {
  it("when it is packed, then that style's entry and strips are rewritten, every other entry is as it was, and no other strip is written", () => {
    const work = workspace({ "farm.png": farmPicture() });
    const run = pack(work);
    expect(run.status, run.stderr).toBe(0);
    const packed = JSON.parse(readFileSync(work.json, "utf8"));
    expect(Object.keys(packed), "the styles, in their order").toEqual(Object.keys(work.shipped));
    for (const style of Object.keys(work.shipped)) {
      if (style !== "farm") expect(packed[style], style).toEqual(work.shipped[style]);
    }
    expect(packed.farm, "farm repacked").toEqual({ ...work.shipped.farm, plain: packed.farm.plain });
    expect(readdirSync(work.out).sort()).toEqual(["farm-albedo.webp", "farm-glow.webp", "farm-normal.webp"]);
  }, PACK_TIMEOUT_MS);

  it("when no style's picture is in the folder, then nothing is packed and the layer data is left as it was", () => {
    const work = workspace({});
    const before = readFileSync(work.json, "utf8");
    const run = pack(work);
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(work.json, "utf8")).toBe(before);
    expect(readdirSync(work.out)).toEqual([]);
  }, PACK_TIMEOUT_MS);
});

