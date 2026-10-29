import { expect, it, describe } from "vitest";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");
/** Uncapped, the diff of two 75k-float arrays ran past 90 s and past a heap cap; capped it takes about a second. */
const MAX_RUN_MS = 30_000;
/** The failure report of the capped diff is a few KB; a whole-array print is megabytes. */
const MAX_REPORT_CHARS = 100_000;

/** @returns {Promise<{ code: unknown, report: string, ms: number }>} the child's outcome; a child that does not fail is a test failure */
async function runFailingFixture() {
  const started = performance.now();
  try {
    await execFileAsync(process.execPath, [VITEST, "run", "--project", "scripts", "scripts/diff-cap.fixture.test.mjs"], {
      cwd: ROOT,
      env: { ...process.env, DIFF_CAP_FIXTURE: "1" },
      timeout: MAX_RUN_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    return { code: error.code, report: `${error.stdout}${error.stderr}`, ms: performance.now() - started };
  }
  return expect.fail("the fixture compare passed: it must fail to prove the diff is capped");
}

describe("given a test whose compare of two 75k-float arrays fails", () => {
  it("when vitest reports it, then the run ends fast with a small truncated diff, not a machine-sized one", async () => {
    const { code, report, ms } = await runFailingFixture();
    expect(code, "exit code of the failing child run").toBe(1);
    expect(report, "the failure is the compare, so the diff was built").toContain("to deeply equal");
    expect(report, "the diff says it was cut").toContain("Diff result is truncated");
    expect(report.length, "report characters").toBeLessThan(MAX_REPORT_CHARS);
    expect(ms, "ms to fail").toBeLessThan(MAX_RUN_MS);
  });
});
