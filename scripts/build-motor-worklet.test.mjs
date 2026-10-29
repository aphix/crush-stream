import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/audio/motor-worklet.js");
const PREBUILT = readFileSync(join(ROOT, "kernels/motor/engine_sound_generator_worklet_webassembly.js"), "utf8");
const PROCESSOR = readFileSync(join(ROOT, "kernels/motor/motor-processor.js"), "utf8");

test("the committed worklet is upstream's prebuilt module with our processor spliced on (npm run build:motor)", () => {
  const upstreamProcessor = PREBUILT.indexOf("/*\n * Copyright (c) 2021-2022 Antonio-R1");
  expect(upstreamProcessor).toBeGreaterThan(0);
  const committed = readFileSync(OUT, "utf8");
  expect(committed.slice(0, upstreamProcessor)).toBe(PREBUILT.slice(0, upstreamProcessor));
  expect(committed.slice(upstreamProcessor)).toBe(PROCESSOR.replace(/^\n/, ""));
});

test("the build is idempotent", () => {
  const before = readFileSync(OUT, "utf8");
  execFileSync("node", [join(ROOT, "scripts/build-motor-worklet.mjs")], { stdio: "pipe" });
  expect(readFileSync(OUT, "utf8")).toBe(before);
});

test("the patched processor keeps upstream's licence header and registers the same processor name", () => {
  expect(PROCESSOR).toMatch(/Copyright \(c\) 2021-2022 Antonio-R1/);
  expect(PROCESSOR).toMatch(/registerProcessor\("engine-sound-processor", EngineSoundGenerator\)/);
  expect(PROCESSOR).toMatch(/Modified for crash-deformer-test/);
});
