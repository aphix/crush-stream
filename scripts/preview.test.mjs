import { describe, expect, it } from "vitest";
import {
  looksLikePreviewProcess,
  parseListenerInodes,
  parsePgid,
  parsePid,
  parsePreviewArgs,
  previewOwners,
  stopOutcome,
  terminatePids,
} from "./preview.mjs";
import { firstMismatch } from "../src/game/kernel/compare-arrays.test-util.ts";

// One /proc/net/tcp row; the socket inode is column 10.
const tcpRow = (sl, local, state, inode) =>
  [
    `  ${sl}:`,
    local,
    "00000000:0000",
    state,
    "00000000:00000000",
    "00:00000000",
    "00000000",
    "1000",
    "0",
    inode,
    "1",
    "0000",
    "100",
  ].join(" ");

const PROC_NET_TCP = [
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode",
  tcpRow(0, "0100007F:1F91", "0A", 5551),
  tcpRow(1, "0100007F:1F90", "0A", 5552),
  tcpRow(2, "0100007F:1F91", "01", 5553),
  "",
].join("\n");

// /proc/<pid>/cmdline is NUL-separated.
const cmdline = (...argv) => argv.join("\u0000");

function fakeProcesses({ pids, ignoresTerm = [] }) {
  const alive = new Set(pids);
  const signals = [];
  return {
    signals,
    isAlive: (pid) => alive.has(pid),
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === "SIGKILL" || !ignoresTerm.includes(pid)) alive.delete(pid);
    },
    sleep: async () => {},
  };
}

function expectTermination(result, expected) {
  for (const key of ["signalled", "killed", "stubborn"]) {
    expect(firstMismatch(result[key], expected[key]), key).toBeUndefined();
  }
}

function expectSignals(signals, expected) {
  expect(signals, "signals sent").toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(signals[i][0], `signal ${i} pid`).toBe(expected[i][0]);
    expect(signals[i][1], `signal ${i} name`).toBe(expected[i][1]);
  }
}

describe("given the preview script's arguments", () => {
  it("when stop or restart is asked for, then each is accepted as the action with no error", () => {
    for (const action of ["stop", "restart"]) {
      const parsed = parsePreviewArgs([action]);
      expect(parsed.action, "action").toBe(action);
      expect(parsed.error, "error").toBeUndefined();
    }
  });

  it("when the action is missing, unknown or followed by an extra argument, then each is refused with its own message", () => {
    expect(parsePreviewArgs([]).error).toMatch(/usage:/);
    expect(parsePreviewArgs(["reload"]).error).toMatch(/unknown action: reload/);
    expect(parsePreviewArgs(["start"]).error).toMatch(/unknown action: start/);
    expect(parsePreviewArgs(["restart", "--force"]).error).toMatch(/unexpected argument: --force/);
  });
});

describe("given the text of a pidfile", () => {
  it("when it holds a pid, then the pid is read, and empty, non-numeric, negative and pid 1 text give none", () => {
    expect(parsePid("4321\n")).toBe(4321);
    expect(parsePid("  99  ")).toBe(99);
    expect(parsePid("")).toBe(null);
    expect(parsePid("not-a-pid")).toBe(null);
    expect(parsePid("-7")).toBe(null);
    // pid 1 is the sandbox init, never a preview server.
    expect(parsePid("1")).toBe(null);
  });
});

describe("given the stat line of a process", () => {
  it("when its process group is read, then a name with spaces or parentheses does not shift it, and junk gives none", () => {
    expect(parsePgid("4321 (node) S 4300 4321 4321 0 -1 4194304 1234")).toBe(4321);
    expect(parsePgid("4321 (npm run preview) S 4300 4200 4200 0 -1 0 0")).toBe(4200);
    expect(parsePgid("4321 (weird ) name) S 4300 4200 4200 0")).toBe(4200);
    expect(parsePgid("garbage")).toBe(null);
    expect(parsePgid("")).toBe(null);
    expect(parsePgid(undefined)).toBe(null);
  });
});

describe("given the kernel's table of TCP sockets", () => {
  it("when a port is asked for, then only the sockets listening on it are picked, never established ones or other ports", () => {
    // 0x1F91 = 8081 (LISTEN), 0x1F90 = 8080, and the third row is ESTABLISHED.
    expect(firstMismatch(parseListenerInodes(PROC_NET_TCP, 8081), ["5551"])).toBeUndefined();
    expect(firstMismatch(parseListenerInodes(PROC_NET_TCP, 8080), ["5552"])).toBeUndefined();
    expect(parseListenerInodes(PROC_NET_TCP, 9999)).toHaveLength(0);
    expect(parseListenerInodes("", 8081)).toHaveLength(0);
    expect(parseListenerInodes(undefined, 8081)).toHaveLength(0);
  });

  it("when the tcp6 dump is read, then its listener is picked the same way", () => {
    const v6 = "00000000000000000000000000000000:1F91";
    expect(firstMismatch(parseListenerInodes(tcpRow(0, v6, "0A", 7777), 8081), ["7777"])).toBeUndefined();
  });
});

describe("given the command line of a process", () => {
  it("when it is the npm wrapper or its vite child, then it is taken for the preview", () => {
    const npmRun = cmdline("node", "/usr/lib/node_modules/npm/bin/npm-cli.js", "run", "preview");
    expect(looksLikePreviewProcess(npmRun)).toBe(true);
    expect(looksLikePreviewProcess(cmdline("npm", "run", "preview"))).toBe(true);
    expect(looksLikePreviewProcess(cmdline("node", "/ws/node_modules/.bin/vite", "preview"))).toBe(true);
    // `ps -o command=` output is space-separated.
    expect(looksLikePreviewProcess("node /ws/node_modules/.bin/vite preview")).toBe(true);
  });

  it("when it is a sibling script, a preview:stop or preview:restart wrapper, a vite build, an unrelated process or empty, then it is not taken for the preview", () => {
    // The sandbox service runs this one in the same box (CapturePreviewThumbnail).
    const thumbnail = cmdline(
      "node",
      "/opt/app-template/scripts/preview-thumbnail.mjs",
      "http://127.0.0.1:8080/",
      "/tmp/preview-thumbnail.png",
    );
    expect(looksLikePreviewProcess(thumbnail)).toBe(false);
    expect(looksLikePreviewProcess(cmdline("node", "scripts/preview.mjs", "stop"))).toBe(false);
    // This tooling's own npm wrappers, which carry no `.mjs` in their cmdline.
    const npmCli = "/usr/lib/node_modules/npm/bin/npm-cli.js";
    expect(looksLikePreviewProcess(cmdline("node", npmCli, "run", "preview:stop"))).toBe(false);
    expect(looksLikePreviewProcess(cmdline("node", npmCli, "run", "preview:restart"))).toBe(false);
    expect(looksLikePreviewProcess(cmdline("npm", "run", "preview:stop"))).toBe(false);
    const viteBuild = cmdline("vite", "build", "--outDir", "preview-dist");
    expect(looksLikePreviewProcess(viteBuild)).toBe(false);
    expect(looksLikePreviewProcess(cmdline("/usr/bin/preview-tool", "--x"))).toBe(false);
    expect(looksLikePreviewProcess(cmdline("sleep", "300"))).toBe(false);
    expect(looksLikePreviewProcess(cmdline("node", "server.mjs"))).toBe(false);
    expect(looksLikePreviewProcess("")).toBe(false);
  });
});

describe("given the pids on the preview port and a pidfile pid", () => {
  it("when the pidfile pid is also a port owner, then it is listed once and needs no corroboration", () => {
    const owners = previewOwners({
      portPids: [50, 51],
      pidFilePid: 50,
      cmdlineOf: () => expect.fail("a port owner needs no corroboration"),
    });
    expect(firstMismatch(owners, [50, 51])).toBeUndefined();
  });

  it("when the pidfile pid's command line is still the preview, then it is added after the port owners", () => {
    const owners = previewOwners({
      portPids: [51],
      pidFilePid: 50,
      cmdlineOf: (pid) => (pid === 50 ? cmdline("node", "npm-cli.js", "run", "preview") : ""),
    });
    expect(firstMismatch(owners, [51, 50])).toBeUndefined();
  });

  it("when the pidfile pid now runs another process, then it is dropped", () => {
    const owners = previewOwners({
      portPids: [],
      pidFilePid: 50,
      cmdlineOf: () => cmdline("sleep", "300"),
    });
    expect(owners).toHaveLength(0);
  });

  it("when the pidfile pid no longer exists, then it is dropped", () => {
    const owners = previewOwners({ portPids: [], pidFilePid: 50, cmdlineOf: () => "" });
    expect(owners).toHaveLength(0);
  });

  it("when the port is free and there is no pidfile pid, then nothing is to be signalled", () => {
    const owners = previewOwners({ portPids: [], pidFilePid: null, cmdlineOf: () => "" });
    expect(owners).toHaveLength(0);
  });
});

describe("given the end of a stop attempt", () => {
  it("when a pid survives or another pid now holds the port, then the stop fails naming the pids still holding it", () => {
    const stubbornOnly = stopOutcome({
      signalled: [50],
      stubborn: [50],
      after: { pids: [] },
    });
    expect(stubbornOnly.ok).toBe(false);
    expect(stubbornOnly.error).toMatch(/still held by pid\(s\) 50/);

    const newOwner = stopOutcome({
      signalled: [50],
      stubborn: [],
      after: { pids: [77] },
    });
    expect(newOwner.ok).toBe(false);
    expect(newOwner.error).toMatch(/still held by pid\(s\) 77/);
  });

  it("when the port ends up free, then the stop succeeds, saying which pids stopped or that nothing was listening", () => {
    const stopped = stopOutcome({
      signalled: [50],
      stubborn: [],
      after: { pids: [] },
    });
    expect(stopped.ok).toBe(true);
    expect(stopped.message).toMatch(/stopped pid\(s\) 50 — port 8081 is free/);

    const idle = stopOutcome({ signalled: [], stubborn: [], after: { pids: [] } });
    expect(idle.ok).toBe(true);
    expect(idle.message).toMatch(/nothing was listening on 8081/);
  });

  it("when the port is held by a process that cannot be attributed, then the stop fails", () => {
    const outcome = stopOutcome({
      signalled: [],
      stubborn: [],
      after: { pids: [], unattributed: true },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/port 8081 is held by a process this script cannot see/);
  });
});

describe("given pids to terminate", () => {
  it("when some are live and some dead, then each live one gets SIGTERM and the dead ones are skipped", async () => {
    const fake = fakeProcesses({ pids: [11, 12] });
    const result = await terminatePids([11, 12, 13], fake);
    expectTermination(result, { signalled: [11, 12], killed: [], stubborn: [] });
    expectSignals(fake.signals, [
      [11, "SIGTERM"],
      [12, "SIGTERM"],
    ]);
  });

  it("when a pid ignores SIGTERM, then it is escalated to SIGKILL", async () => {
    const fake = fakeProcesses({ pids: [11, 12], ignoresTerm: [12] });
    const result = await terminatePids([11, 12], fake);
    expectTermination(result, { signalled: [11, 12], killed: [12], stubborn: [] });
    expectSignals(fake.signals, [
      [11, "SIGTERM"],
      [12, "SIGTERM"],
      [12, "SIGKILL"],
    ]);
  });

  it("when a pid survives SIGKILL, then it is reported as stubborn", async () => {
    const signals = [];
    const result = await terminatePids([11], {
      isAlive: () => true,
      kill: (pid, signal) => signals.push([pid, signal]),
      sleep: async () => {},
    });
    expectTermination(result, { signalled: [11], killed: [11], stubborn: [11] });
    expectSignals(signals, [
      [11, "SIGTERM"],
      [11, "SIGKILL"],
    ]);
  });

  it("when there are none, then nothing is signalled", async () => {
    const fake = fakeProcesses({ pids: [] });
    const result = await terminatePids([], fake);
    expectTermination(result, { signalled: [], killed: [], stubborn: [] });
    expect(fake.signals).toHaveLength(0);
  });
});
