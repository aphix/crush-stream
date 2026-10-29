import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const WRAPPER = join(SCRIPTS, "with-app-env.mjs");
const PRINT_FLAG = "process.stdout.write(String(process.env.WRAP_FLAG));";

test("the wrapped command inherits the process env", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", PRINT_FLAG],
    { env: { ...process.env, WRAP_FLAG: "true" } },
  );
  assert.equal(stdout, "true");
});

test("a leading NAME=value arg wins over the process env and is not run as the command", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, "WRAP_FLAG=cli", "OTHER=a=b", process.execPath, "-e", `${PRINT_FLAG}process.stdout.write(","+process.env.OTHER);`],
    { env: { ...process.env, WRAP_FLAG: "true" } },
  );
  assert.equal(stdout, "cli,a=b");
});

test("the wrapper propagates the command's exit code", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [WRAPPER, process.execPath, "-e", "process.exit(3)"]),
    (err) => err.code === 3,
  );
});

test("a signal-killed command is never reported as success", async () => {
  // The wrapper's own SIGTERM handler must not swallow the re-raised signal:
  // a cancelled build reporting exit 0 is a silently passing gate.
  await assert.rejects(
    execFileAsync(process.execPath, [
      WRAPPER,
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM');process.stdin.resume();",
    ]),
    (err) => err.signal === "SIGTERM" || err.code !== 0,
  );
});

test("the CLI still runs when invoked through a symlinked path", async () => {
  // node realpaths import.meta.url but not process.argv[1], so a raw comparison
  // turns the wrapper into a no-op that exits 0 without starting anything.
  const link = join(mkdtempSync(join(tmpdir(), "app-env-link-")), "scripts");
  symlinkSync(SCRIPTS, link);
  const { stdout } = await execFileAsync(process.execPath, [
    join(link, "with-app-env.mjs"),
    "WRAP_FLAG=linked",
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  assert.equal(stdout, "linked");
});
