import { expect, test } from "vitest";
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

test("parsePreviewArgs accepts the two actions", () => {
  for (const action of ["stop", "restart"]) {
    const parsed = parsePreviewArgs([action]);
    expect(parsed.action, "action").toBe(action);
    expect(parsed.error, "error").toBeUndefined();
  }
});

test("parsePreviewArgs rejects missing, unknown and extra arguments", () => {
  expect(parsePreviewArgs([]).error).toMatch(/usage:/);
  expect(parsePreviewArgs(["reload"]).error).toMatch(/unknown action: reload/);
  expect(parsePreviewArgs(["start"]).error).toMatch(/unknown action: start/);
  expect(parsePreviewArgs(["restart", "--force"]).error).toMatch(/unexpected argument: --force/);
});

test("parsePid reads a pidfile and rejects junk", () => {
  expect(parsePid("4321\n")).toBe(4321);
  expect(parsePid("  99  ")).toBe(99);
  expect(parsePid("")).toBe(null);
  expect(parsePid("not-a-pid")).toBe(null);
  expect(parsePid("-7")).toBe(null);
  // pid 1 is the sandbox init, never a preview server.
  expect(parsePid("1")).toBe(null);
});

test("parsePgid reads the pgrp field past a comm containing spaces", () => {
  expect(parsePgid("4321 (node) S 4300 4321 4321 0 -1 4194304 1234")).toBe(4321);
  expect(parsePgid("4321 (npm run preview) S 4300 4200 4200 0 -1 0 0")).toBe(4200);
  expect(parsePgid("4321 (weird ) name) S 4300 4200 4200 0")).toBe(4200);
  expect(parsePgid("garbage")).toBe(null);
  expect(parsePgid("")).toBe(null);
  expect(parsePgid(undefined)).toBe(null);
});

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

test("parseListenerInodes picks LISTEN sockets on the wanted port only", () => {
  // 0x1F91 = 8081 (LISTEN), 0x1F90 = 8080, and the third row is ESTABLISHED.
  expect(firstMismatch(parseListenerInodes(PROC_NET_TCP, 8081), ["5551"])).toBeUndefined();
  expect(firstMismatch(parseListenerInodes(PROC_NET_TCP, 8080), ["5552"])).toBeUndefined();
  expect(parseListenerInodes(PROC_NET_TCP, 9999)).toHaveLength(0);
  expect(parseListenerInodes("", 8081)).toHaveLength(0);
  expect(parseListenerInodes(undefined, 8081)).toHaveLength(0);
});

test("parseListenerInodes reads the tcp6 dump the same way", () => {
  const v6 = "00000000000000000000000000000000:1F91";
  expect(firstMismatch(parseListenerInodes(tcpRow(0, v6, "0A", 7777), 8081), ["7777"])).toBeUndefined();
});

// /proc/<pid>/cmdline is NUL-separated.
const cmdline = (...argv) => argv.join("\u0000");

test("looksLikePreviewProcess matches the npm wrapper and its vite child", () => {
  const npmRun = cmdline("node", "/usr/lib/node_modules/npm/bin/npm-cli.js", "run", "preview");
  expect(looksLikePreviewProcess(npmRun)).toBe(true);
  expect(looksLikePreviewProcess(cmdline("npm", "run", "preview"))).toBe(true);
  expect(looksLikePreviewProcess(cmdline("node", "/ws/node_modules/.bin/vite", "preview"))).toBe(true);
  // `ps -o command=` output is space-separated.
  expect(looksLikePreviewProcess("node /ws/node_modules/.bin/vite preview")).toBe(true);
});

test("looksLikePreviewProcess spares the sibling scripts and re-used pids", () => {
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

test("previewOwners trusts port owners and dedupes the pidfile pid", () => {
  const owners = previewOwners({
    portPids: [50, 51],
    pidFilePid: 50,
    cmdlineOf: () => expect.fail("a port owner needs no corroboration"),
  });
  expect(firstMismatch(owners, [50, 51])).toBeUndefined();
});

test("previewOwners adds a pidfile pid whose command line is still the preview", () => {
  const owners = previewOwners({
    portPids: [51],
    pidFilePid: 50,
    cmdlineOf: (pid) => (pid === 50 ? cmdline("node", "npm-cli.js", "run", "preview") : ""),
  });
  expect(firstMismatch(owners, [51, 50])).toBeUndefined();
});

test("previewOwners drops a stale pidfile pid re-used by another process", () => {
  const owners = previewOwners({
    portPids: [],
    pidFilePid: 50,
    cmdlineOf: () => cmdline("sleep", "300"),
  });
  expect(owners).toHaveLength(0);
});

test("previewOwners drops a pidfile pid that no longer exists", () => {
  const owners = previewOwners({ portPids: [], pidFilePid: 50, cmdlineOf: () => "" });
  expect(owners).toHaveLength(0);
});

test("previewOwners on a free port with no pidfile signals nothing", () => {
  const owners = previewOwners({ portPids: [], pidFilePid: null, cmdlineOf: () => "" });
  expect(owners).toHaveLength(0);
});

test("stopOutcome fails when a pid survives or the port is still held", () => {
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

test("stopOutcome reports a verified free port", () => {
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

test("stopOutcome fails on a listener whose owner cannot be attributed", () => {
  const outcome = stopOutcome({
    signalled: [],
    stubborn: [],
    after: { pids: [], unattributed: true },
  });
  expect(outcome.ok).toBe(false);
  expect(outcome.error).toMatch(/port 8081 is held by a process this script cannot see/);
});

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

test("terminatePids SIGTERMs live pids and skips dead ones", async () => {
  const fake = fakeProcesses({ pids: [11, 12] });
  const result = await terminatePids([11, 12, 13], fake);
  expectTermination(result, { signalled: [11, 12], killed: [], stubborn: [] });
  expectSignals(fake.signals, [
    [11, "SIGTERM"],
    [12, "SIGTERM"],
  ]);
});

test("terminatePids escalates to SIGKILL when SIGTERM is ignored", async () => {
  const fake = fakeProcesses({ pids: [11, 12], ignoresTerm: [12] });
  const result = await terminatePids([11, 12], fake);
  expectTermination(result, { signalled: [11, 12], killed: [12], stubborn: [] });
  expectSignals(fake.signals, [
    [11, "SIGTERM"],
    [12, "SIGTERM"],
    [12, "SIGKILL"],
  ]);
});

test("terminatePids reports a pid that survives SIGKILL as stubborn", async () => {
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

test("terminatePids on a free port signals nothing", async () => {
  const fake = fakeProcesses({ pids: [] });
  const result = await terminatePids([], fake);
  expectTermination(result, { signalled: [], killed: [], stubborn: [] });
  expect(fake.signals).toHaveLength(0);
});
