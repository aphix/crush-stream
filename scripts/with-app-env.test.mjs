import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  expect(stdout).toBe("true");
});

test("a leading NAME=value arg wins over the process env and is not run as the command", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, "WRAP_FLAG=cli", "OTHER=a=b", process.execPath, "-e", `${PRINT_FLAG}process.stdout.write(","+process.env.OTHER);`],
    { env: { ...process.env, WRAP_FLAG: "true" } },
  );
  expect(stdout).toBe("cli,a=b");
});

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

test("the wrapper propagates the command's exit code", async () => {
  const error = await rejection(execFileAsync(process.execPath, [WRAPPER, process.execPath, "-e", "process.exit(3)"]));
  expect(error, "the wrapper rejected").toBeDefined();
  if (error === undefined) throw new Error("the wrapper rejected");
  expect(error.code, "exit code").toBe(3);
});

test("a signal-killed command is never reported as success", async () => {
  // The wrapper's own SIGTERM handler must not swallow the re-raised signal.
  const error = await rejection(
    execFileAsync(process.execPath, [
      WRAPPER,
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM');process.stdin.resume();",
    ]),
  );
  expect(error, "the wrapper rejected").toBeDefined();
  if (error === undefined) throw new Error("the wrapper rejected");
  expect(error.signal === "SIGTERM" || error.code !== 0, "killed by SIGTERM or a non-zero exit").toBe(true);
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
  expect(stdout).toBe("linked");
});
