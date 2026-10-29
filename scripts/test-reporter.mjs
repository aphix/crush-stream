import { relative } from "node:path";

const SLOWEST_SHOWN = 10;

/**
 * Vitest reporter for the rules the default one lacks. A test process that writes anything to stderr (a `console.warn`, a
 * library's warning) fails the run, its lines printed under the file's name: a warning is a defect, the next emitter is a red
 * here. The slowest files print at the end: split any that sets the wall time.
 * @implements {import("vitest/node").Reporter}
 */
export default class TestReporter {
  /** @type {import("vitest/node").Vitest | undefined} */
  vitest;
  /** @type {Map<string, string[]>} */
  stderrByFile = new Map();

  /** @param {import("vitest/node").Vitest} vitest */
  onInit(vitest) {
    this.vitest = vitest;
  }

  /** @param {import("vitest/node").UserConsoleLog} log */
  onUserConsoleLog(log) {
    if (log.type !== "stderr") return;
    const entity = log.taskId ? this.vitest?.state.getReportedEntityById(log.taskId) : undefined;
    const file = entity ? (entity.type === "module" ? entity : entity.module).moduleId : "(no file)";
    this.stderrByFile.set(file, [...(this.stderrByFile.get(file) ?? []), log.content]);
  }

  /** @param {ReadonlyArray<import("vitest/node").TestModule>} modules */
  onTestRunEnd(modules) {
    for (const [file, lines] of this.stderrByFile) {
      console.log(`\nstderr from ${relative(process.cwd(), file)}:\n${lines.join("")}`);
      process.exitCode = 1;
    }
    this.stderrByFile.clear();
    const slow = modules
      .map((m) => [m.moduleId, m.diagnostic().duration])
      .sort((a, b) => b[1] - a[1])
      .slice(0, SLOWEST_SHOWN);
    console.log(`\nslowest files: ${slow.map(([f, ms]) => `${relative(process.cwd(), f)} ${Math.round(ms / 1000)} s`).join(", ")}`);
  }
}
