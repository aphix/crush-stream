import { test } from "vitest";
import assert from "node:assert/strict";
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
  assert.ok(upstreamProcessor > 0);
  const committed = readFileSync(OUT, "utf8");
  assert.equal(committed.slice(0, upstreamProcessor), PREBUILT.slice(0, upstreamProcessor));
  assert.equal(committed.slice(upstreamProcessor), PROCESSOR.replace(/^\n/, ""));
});

test("the build is idempotent", () => {
  const before = readFileSync(OUT, "utf8");
  execFileSync("node", [join(ROOT, "scripts/build-motor-worklet.mjs")], { stdio: "pipe" });
  assert.equal(readFileSync(OUT, "utf8"), before);
});

test("the patched processor keeps upstream's licence header and registers the same processor name", () => {
  assert.match(PROCESSOR, /Copyright \(c\) 2021-2022 Antonio-R1/);
  assert.match(PROCESSOR, /registerProcessor\("engine-sound-processor", EngineSoundGenerator\)/);
  assert.match(PROCESSOR, /Modified for crash-deformer-test/);
});
