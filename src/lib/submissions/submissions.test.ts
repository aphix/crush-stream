import { describe, expect, it } from "vitest";
import { setImmediate as nextTurn } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import type { Sql } from "@/lib/db";
import { migratedPg, sqlOf } from "../test-db.test-util.ts";
import { LIMITS } from "../multiplayer/rate-limit.ts";
import { KINDS, MAX_JSON_BYTES, MAX_WIRE_BYTES, RECEIPT_PATTERN, type Envelope, type Kind } from "./kinds.ts";
import { handleSubmissions, STORE_MAX_BYTES, STORE_MAX_ROWS } from "./submissions.server.ts";
import { firstMismatch } from "../../game/kernel/compare-arrays.test-util.ts";
import { must } from "../../game/kernel/must.test-util.ts";

const OWNER_TOKEN = "owner-token-".padEnd(40, "x");
/** The clock every request is handled at: address buckets neither refill nor drain between a test's requests. */
const NOW = 1_800_000_000_000;
/** The receipt time is stored to the whole second. */
const SECOND_MS = 1000;

/** The migrated in-memory database, built once: starting PGlite costs about a second. */
const migrated = migratedPg();

/** The database with `migrations/*.sql` applied and no submissions, as the relay's tests build theirs. */
async function freshDb(): Promise<Sql> {
  const pg = await migrated;
  await pg.exec("TRUNCATE submissions");
  return sqlOf(pg);
}

const CLIP_TEXT = "U0NITAAqIAAAAAAAAAAA".repeat(40);
const BENCH_PAYLOAD = { at: "2026-10-07T10:00:00.000Z", result: { fps: 58.5, build: "3295bad" }, hud: { carCount: 16 } };
const CAPTURE_PAYLOAD = { version: 1, captureTrace: true, samples: [{ t: 0.25, cars: [{ x: 1 }] }, { t: 0.5, cars: [{ x: 2 }] }] };
const FLAG_PAYLOAD = { title: "Head-on at the bridge", course: "City", from: "reel", clip: CLIP_TEXT };
const PAYLOADS: Record<Kind, unknown> = { bench: BENCH_PAYLOAD, capture: CAPTURE_PAYLOAD, flag: FLAG_PAYLOAD };

function envelope(kind: Kind, over: Record<string, unknown> = {}): Envelope & Record<string, unknown> {
  return {
    kind,
    sha: "3295bad",
    at: 1_791_000_000_000,
    ua: "Mozilla/5.0 (X11; Linux x86_64) Test",
    screen: { w: 1920, h: 1080, dpr: 2 },
    scene: "race",
    settings: { scene: "race", seed: 12345, fxTier: "low", night: false, userTimeScale: null, session: "k3x9q2", loop: 2 },
    payload: PAYLOADS[kind],
    ...over,
  };
}

let lastIp = 0;
/** An address no earlier test has used: the limiter lives for the whole process. */
function freshIp(): string {
  lastIp++;
  return `10.20.${lastIp >> 8}.${lastIp & 255}`;
}

interface Listed {
  id: string;
  kind: Kind;
  receivedAt: string;
  sha: string;
  size: number;
}

interface Reply {
  status: number;
  body: {
    error?: string;
    id?: string;
    kind?: Kind;
    sha?: string;
    receivedAt?: string;
    submission?: Record<string, unknown>;
    submissions?: Listed[];
  };
}

/** One request, from its own fresh address unless `ip` is given; the server's owner token is `OWNER_TOKEN` unless `token` says otherwise (null: none configured). */
async function send(sql: Sql, init: RequestInit & { ip?: string; token?: string | null; search?: string; getSql?: () => Promise<Sql> } = {}): Promise<Reply> {
  const { ip = freshIp(), search = "", token = OWNER_TOKEN, getSql, ...rest } = init;
  const headers = { "x-forwarded-for": ip, ...(rest.headers as Record<string, string> | undefined) };
  const request = new Request(`http://game.test/api/submissions${search}`, { ...rest, headers });
  const res = await handleSubmissions(request, getSql ?? (async () => sql), token ?? undefined, NOW);
  return { status: res.status, body: (await res.json()) as Reply["body"] };
}

/** A JSON post: the body as text, or gzipped (`gzip`, with the header a browser's post carries). */
function post(sql: Sql, body: unknown, extra: { ip?: string; headers?: Record<string, string>; gzip?: boolean; getSql?: () => Promise<Sql> } = {}): Promise<Reply> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return send(sql, {
    method: "POST",
    ip: extra.ip,
    getSql: extra.getSql,
    headers: { "content-type": "application/json", ...(extra.gzip ? { "content-encoding": "gzip" } : {}), ...extra.headers },
    body: extra.gzip ? gzipSync(text) : text,
  });
}

/** A read with the owner's bearer token; `serverToken` is what the server has configured (null: nothing). */
function owner(sql: Sql, search = "", serverToken: string | null = OWNER_TOKEN): Promise<Reply> {
  return send(sql, { search, token: serverToken, headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
}

function listedIds(reply: Reply): string[] {
  return reply.body.submissions!.map((s) => s.id);
}

interface CaptureRow {
  t: number;
  cars: { x: number; y: number; z: number }[];
}

/** `samples` rows of numbers that do not repeat, about 1.6 kB each. */
function captureRows(samples: number): CaptureRow[] {
  return Array.from({ length: samples }, (_, i) => ({ t: i / 4, cars: Array.from({ length: 8 }, (_, c) => ({ x: Math.sin(i * 7 + c) * 100, y: Math.cos(i * 3 + c), z: (i * 31 + c * 17) % 977 / 7 })) }));
}

/** A capture of `rows`. */
function bigCapture(rows: CaptureRow[]): Envelope {
  return envelope("capture", { payload: { version: 1, samples: rows } }) as Envelope;
}

/** The value at `path` under `value`, each step an object's own member; fails where a step is not an object. */
function member(value: unknown, ...path: string[]): unknown {
  return path.reduce((at, key) => {
    must(typeof at === "object" && at !== null, `${key} is not under an object`);
    return Reflect.get(at, key);
  }, value);
}

/** The sorted member names of an object. */
function keysOf(value: unknown, what: string): string[] {
  if (typeof value !== "object" || value === null) throw new Error(`${what} is not an object`);
  return Object.keys(value).sort();
}

/** The array under `path`; fails where it is not one. */
function arrayAt(value: unknown, ...path: string[]): unknown[] {
  const at = member(value, ...path);
  if (!Array.isArray(at)) throw new Error(`${path.join(".")} is not an array`);
  return at;
}

/** What the owner reads back for `sent`, apart from the payload: the envelope's own fields, one expect each. */
function expectEnvelopeBack(got: unknown, sent: Envelope): void {
  expect(firstMismatch(keysOf(got, "the submission"), Object.keys(sent).sort()), "submission fields").toBeUndefined();
  expect(member(got, "kind"), "kind").toBe(sent.kind);
  expect(member(got, "sha"), "sha").toBe(sent.sha);
  expect(member(got, "at"), "at").toBe(sent.at);
  expect(member(got, "ua"), "ua").toBe(sent.ua);
  expect(member(got, "scene"), "scene").toBe(sent.scene);
  expect(member(got, "screen", "w"), "screen.w").toBe(sent.screen.w);
  expect(member(got, "screen", "h"), "screen.h").toBe(sent.screen.h);
  expect(member(got, "screen", "dpr"), "screen.dpr").toBe(sent.screen.dpr);
  expect(firstMismatch(keysOf(member(got, "settings"), "settings"), Object.keys(sent.settings).sort()), "settings keys").toBeUndefined();
  for (const key of Object.keys(sent.settings)) expect(member(got, "settings", key), `settings.${key}`).toBe(sent.settings[key]);
}

/** The capture rows the owner reads back, each number of each car. */
function expectRowsBack(got: unknown, rows: CaptureRow[]): void {
  const samples = arrayAt(got, "payload", "samples");
  expect(samples, "sample count").toHaveLength(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) throw new Error(`no row ${i}`);
    const back = samples[i];
    expect(member(back, "t"), `sample ${i} t`).toBe(row.t);
    const cars = arrayAt(back, "cars");
    expect(cars, `sample ${i} car count`).toHaveLength(row.cars.length);
    for (let c = 0; c < row.cars.length; c++) {
      const car = row.cars[c];
      if (!car) throw new Error(`no car ${c} in row ${i}`);
      expect(member(cars[c], "x"), `sample ${i} car ${c} x`).toBe(car.x);
      expect(member(cars[c], "y"), `sample ${i} car ${c} y`).toBe(car.y);
      expect(member(cars[c], "z"), `sample ${i} car ${c} z`).toBe(car.z);
    }
  }
}

describe("given the submissions endpoint on a freshly migrated database", () => {
  for (const kind of KINDS) {
    for (const gzip of [false, true]) {
      it(`when a ${kind} submission is posted${gzip ? " gzipped, as a browser sends it" : ""}, then it answers with a receipt id and the owner fetching that id gets back the same build, device, settings and payload`, async () => {
        const sql = await freshDb();
        const sent = envelope(kind);
        const secondOfPost = Math.floor(Date.now() / SECOND_MS) * SECOND_MS;
        const receipt = await post(sql, sent, { gzip });
        expect(receipt.status).toBe(201);
        expect(receipt.body.id!).toMatch(RECEIPT_PATTERN);
        const got = await owner(sql, `?id=${receipt.body.id}`);
        expect(got.status).toBe(200);
        expect(got.body.id).toBe(receipt.body.id);
        expect(got.body.kind).toBe(kind);
        expect(got.body.sha).toBe("3295bad");
        const receivedAt = Date.parse(got.body.receivedAt!);
        expect(receivedAt >= secondOfPost && receivedAt <= Date.now(), `the receipt time ${receivedAt} is the server's, inside the post's own window`).toBeTruthy();
        expectEnvelopeBack(got.body.submission, sent);
        if (kind === "bench") {
          expect(firstMismatch(keysOf(member(got.body.submission, "payload"), "payload"), Object.keys(BENCH_PAYLOAD).sort()), "payload fields").toBeUndefined();
          expect(member(got.body.submission, "payload", "at"), "payload.at").toBe(BENCH_PAYLOAD.at);
          expect(member(got.body.submission, "payload", "result", "fps"), "payload.result.fps").toBe(BENCH_PAYLOAD.result.fps);
          expect(member(got.body.submission, "payload", "result", "build"), "payload.result.build").toBe(BENCH_PAYLOAD.result.build);
          expect(member(got.body.submission, "payload", "hud", "carCount"), "payload.hud.carCount").toBe(BENCH_PAYLOAD.hud.carCount);
        } else if (kind === "capture") {
          expect(firstMismatch(keysOf(member(got.body.submission, "payload"), "payload"), Object.keys(CAPTURE_PAYLOAD).sort()), "payload fields").toBeUndefined();
          expect(member(got.body.submission, "payload", "version"), "payload.version").toBe(CAPTURE_PAYLOAD.version);
          expect(member(got.body.submission, "payload", "captureTrace"), "payload.captureTrace").toBe(CAPTURE_PAYLOAD.captureTrace);
          const samples = arrayAt(got.body.submission, "payload", "samples");
          expect(samples, "payload.samples").toHaveLength(CAPTURE_PAYLOAD.samples.length);
          for (let i = 0; i < CAPTURE_PAYLOAD.samples.length; i++) {
            expect(member(samples[i], "t"), `sample ${i} t`).toBe(CAPTURE_PAYLOAD.samples[i]?.t);
            expect(member(samples[i], "cars", "0", "x"), `sample ${i} car 0 x`).toBe(CAPTURE_PAYLOAD.samples[i]?.cars[0]?.x);
          }
        } else {
          expect(firstMismatch(keysOf(member(got.body.submission, "payload"), "payload"), Object.keys(FLAG_PAYLOAD).sort()), "payload fields").toBeUndefined();
          expect(member(got.body.submission, "payload", "title"), "payload.title").toBe(FLAG_PAYLOAD.title);
          expect(member(got.body.submission, "payload", "course"), "payload.course").toBe(FLAG_PAYLOAD.course);
          expect(member(got.body.submission, "payload", "from"), "payload.from").toBe(FLAG_PAYLOAD.from);
          expect(member(got.body.submission, "payload", "clip"), "payload.clip").toBe(FLAG_PAYLOAD.clip);
        }
      });
    }
  }

  it("when a bench card with the sim's phase table, work counters, long tasks and battery is posted, then the owner reads each field back, and an older card without them is still stored beside it", async () => {
    const sql = await freshDb();
    const added = {
      phases: {
        msPerSimS: { drive: 30.25, plan: 5, integrate: 25, wreck: 80, pairs: 20, structure: 18, course: 8, bake: 1, rules: 3, settle: 17 },
        unattributedMsPerSimS: 5,
        workPerSimS: { steps: 240, slices: 330, liveCarSlices: 3000, wreckCarSlices: 1900, asleepCarSlices: 40, pairTests: 1500, pairContacts: 210, partContacts: 3, prismQueries: 5200, prismsVisited: 21000, prismTouches: 160, skins: 480, skinVerts: 2_400_000, ragdollMessages: 12, ragdollBytes: 38_400 },
      },
      longTasks: { count: 4, totalMs: 312.5, maxMs: 120.25 },
      device: { battery: { start: { charging: false, level: 0.83 }, end: { charging: true, level: 0.81 } } },
    };
    const sent = envelope("bench", { payload: { at: "2026-10-17T10:00:00.000Z", result: { fps: 10, build: "3e214dff", ...added }, hud: { carCount: 16 } } });
    const receipt = await post(sql, sent);
    expect(receipt.status).toBe(201);
    const old = await post(sql, envelope("bench"));
    expect(old.status, "a card from before the phase table is accepted").toBe(201);
    const card = (await owner(sql, `?id=${receipt.body.id}`)).body.submission;
    expect(member(card, "payload", "result", "phases", "msPerSimS", "drive"), "a phase's ms").toBe(30.25);
    expect(member(card, "payload", "result", "phases", "unattributedMsPerSimS"), "the unattributed ms").toBe(5);
    expect(member(card, "payload", "result", "phases", "workPerSimS", "skinVerts"), "a work counter").toBe(2_400_000);
    expect(member(card, "payload", "result", "phases", "workPerSimS", "ragdollBytes"), "the ragdoll bytes").toBe(38_400);
    expect(member(card, "payload", "result", "longTasks", "maxMs"), "the longest task").toBe(120.25);
    expect(member(card, "payload", "result", "device", "battery", "end", "charging"), "the battery at the end").toBe(true);
    const oldCard = (await owner(sql, `?id=${old.body.id}`)).body.submission;
    expect(member(oldCard, "payload", "result", "fps"), "the older card is read back as it was sent").toBe(58.5);
    expect(member(oldCard, "payload", "result", "phases"), "and has no phase table").toBe(undefined);
    const addedBytes = Buffer.byteLength(JSON.stringify(added));
    expect(addedBytes, `the new fields are ${addedBytes} bytes`).toBeLessThan(2048);
  });

  it("when a capture of 300 samples of non-repeating numbers is posted gzipped, then the owner reads back every sample, and the store holds less than half its bytes", async () => {
    const sql = await freshDb();
    const rows = captureRows(300);
    const sent = bigCapture(rows);
    const receipt = await post(sql, sent, { gzip: true });
    expect(receipt.status).toBe(201);
    const got = await owner(sql, `?id=${receipt.body.id}`);
    expectEnvelopeBack(got.body.submission, sent);
    expect(member(got.body.submission, "payload", "version"), "payload.version").toBe(1);
    expectRowsBack(got.body.submission, rows);
    const [listed] = (await owner(sql)).body.submissions!;
    expect(listed!.size, `${listed!.size} stored bytes for ${JSON.stringify(sent).length} sent`).toBeLessThan(JSON.stringify(sent).length / 2);
  });

  it("when two submissions are posted, then their receipt ids differ", async () => {
    const sql = await freshDb();
    const a = await post(sql, envelope("bench"));
    const b = await post(sql, envelope("bench"));
    expect(a.body.id).not.toBe(b.body.id);
  });

  it("when a submission carries a field the endpoint does not know, then the owner never sees that field", async () => {
    const sql = await freshDb();
    const receipt = await post(sql, envelope("bench", { admin: true }));
    const got = await owner(sql, `?id=${receipt.body.id}`);
    expect("admin" in got.body.submission!).toBe(false);
  });
});

describe("given the submissions endpoint refusing what it must refuse", () => {
  const refusedCases = [
    { it: "the body is not JSON", body: "{not json", status: 400 },
    { it: "the body is a JSON array", body: "[]", status: 400 },
    { it: "the kind is not one of bench, capture, flag", body: envelope("bench", { kind: "../../etc" }), status: 400 },
    { it: "the build sha holds a path", body: envelope("bench", { sha: "../../x" }), status: 400 },
    { it: "the build sha is empty", body: envelope("bench", { sha: "" }), status: 400 },
    { it: "the user agent is missing", body: envelope("bench", { ua: undefined }), status: 400 },
    { it: "the user agent is over 512 characters", body: envelope("bench", { ua: "u".repeat(513) }), status: 400 },
    { it: "the screen has a negative width", body: envelope("bench", { screen: { w: -1, h: 10, dpr: 1 } }), status: 400 },
    { it: "the scene holds a path", body: envelope("bench", { scene: "../x" }), status: 400 },
    { it: "a setting is an object", body: envelope("bench", { settings: { nested: { a: 1 } } }), status: 400 },
    { it: "a setting name holds a path", body: envelope("bench", { settings: { "../x": 1 } }), status: 400 },
    {
      it: "there are more than 64 settings",
      body: envelope("bench", { settings: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i])) }),
      status: 400,
    },
    { it: "a bench payload is an array", body: envelope("bench", { payload: [1, 2] }), status: 400 },
    { it: "a capture has no samples", body: envelope("capture", { payload: { version: 1 } }), status: 400 },
    { it: "a capture has an empty sample list", body: envelope("capture", { payload: { samples: [] } }), status: 400 },
    { it: "a flagged clip's text is not base64", body: envelope("flag", { payload: { ...(PAYLOADS.flag as object), clip: "../../etc/passwd" } }), status: 400 },
    { it: "a flagged clip's text is empty", body: envelope("flag", { payload: { ...(PAYLOADS.flag as object), clip: "" } }), status: 400 },
    { it: "a flagged clip has no title", body: envelope("flag", { payload: { ...(PAYLOADS.flag as object), title: "" } }), status: 400 },
    { it: "a flagged clip says it came from somewhere else", body: envelope("flag", { payload: { ...(PAYLOADS.flag as object), from: "disk" } }), status: 400 },
    {
      it: "a flagged clip's body is over its size cap",
      body: envelope("flag", { payload: { ...(PAYLOADS.flag as object), clip: "A".repeat(MAX_JSON_BYTES.flag) } }),
      status: 413,
    },
  ];
  for (const testCase of refusedCases) {
    it(`when ${testCase.it}, then it answers ${testCase.status} and stores nothing`, async () => {
      const sql = await freshDb();
      const refused = await post(sql, testCase.body);
      expect(refused.status).toBe(testCase.status);
      expect(refused.body.id).toBe(undefined);
      expect((await owner(sql)).body.submissions).toHaveLength(0);
    });
  }

  it("when a gzipped bench card inflates past the bench cap (a few kB claiming 8 MB), then it answers 413 and stores nothing", async () => {
    const sql = await freshDb();
    const bomb = envelope("bench", { payload: { filler: "x".repeat(MAX_JSON_BYTES.bench + 1024) } });
    expect(gzipSync(JSON.stringify(bomb)).length, "the bomb is small on the wire").toBeLessThan(100 * 1024);
    const refused = await post(sql, bomb, { gzip: true });
    expect(refused.status).toBe(413);
    expect((await owner(sql)).body.submissions).toHaveLength(0);
  });

  it("when a gzipped bench card of over a megabyte of JSON (far bigger than the cards of 2026-10-07) is posted, then it is stored", async () => {
    const sql = await freshDb();
    const big = envelope("bench", { payload: { series: Array.from({ length: 400_000 }, (_, i) => i % 97) } });
    const receipt = await post(sql, big, { gzip: true });
    expect(receipt.status).toBe(201);
    expect(JSON.stringify(big).length, "over a megabyte of JSON").toBeGreaterThan(1_000_000);
  });

  it("when a gzipped capture inflates past the capture cap (a few kB claiming 40 MB), then it answers 413 and stores nothing", async () => {
    const sql = await freshDb();
    const bomb = envelope("capture", { payload: { samples: [{ filler: "x".repeat(MAX_JSON_BYTES.capture + 8 * 1024 * 1024) }] } });
    const wire = gzipSync(JSON.stringify(bomb));
    expect(wire.length, `the bomb is ${wire.length} bytes on the wire`).toBeLessThan(100 * 1024);
    const refused = await post(sql, bomb, { gzip: true });
    expect(refused.status).toBe(413);
    expect((await owner(sql)).body.submissions).toHaveLength(0);
  });

  it("when a body that is not gzip claims to be, then it answers 400", async () => {
    const sql = await freshDb();
    const refused = await send(sql, { method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip" }, body: JSON.stringify(envelope("bench")) });
    expect(refused.status).toBe(400);
  });

  it("when the body claims an encoding the endpoint does not read, then it answers 415", async () => {
    const sql = await freshDb();
    const refused = await post(sql, envelope("bench"), { headers: { "content-encoding": "br" } });
    expect(refused.status).toBe(415);
  });

  it("when the request is not declared as JSON, then it answers 415 and stores nothing", async () => {
    const sql = await freshDb();
    const refused = await post(sql, envelope("bench"), { headers: { "content-type": "text/plain" } });
    expect(refused.status).toBe(415);
    expect((await owner(sql)).body.submissions).toHaveLength(0);
  });

  it("when a body past the wire cap arrives as a stream that declares no length, then it answers 413 after taking no more than a chunk or two past the cap", async () => {
    const sql = await freshDb();
    const chunk = new Uint8Array(64 * 1024).fill(32);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.length;
        controller.enqueue(chunk);
        if (sent > MAX_WIRE_BYTES * 4) controller.close();
      },
    });
    const refused = await send(sql, { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    expect(refused.status).toBe(413);
    expect(sent, `${sent} bytes were taken for a cap of ${MAX_WIRE_BYTES}`).toBeLessThanOrEqual(MAX_WIRE_BYTES + 2 * chunk.length);
  });

  for (const method of ["PUT", "DELETE", "PATCH"]) {
    it(`when the method is ${method}, then it answers 405`, async () => {
      const sql = await freshDb();
      expect((await send(sql, { method })).status).toBe(405);
    });
  }
});

describe("given more posts at once than the server works through", () => {
  it("when twelve posts from twelve addresses arrive while the first is still being stored, then six are stored and six are sent away as busy, and the busy ones left nothing", async () => {
    const sql = await freshDb();
    let release: () => void = () => undefined;
    // `Promise.withResolvers` is in the runtime but not in the project's ES2022 lib typings.
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = async (): Promise<Sql> => {
      await gate;
      return sql;
    };
    const all = Array.from({ length: 12 }, () => post(sql, envelope("bench"), { getSql: slow }));
    // The sixth waiter is admitted and the seventh is not: the busy ones answer before the gate opens.
    await nextTurn();
    release();
    const statuses = (await Promise.all(all)).map((r) => r.status).sort();
    expect(firstMismatch(statuses, [201, 201, 201, 201, 201, 201, 503, 503, 503, 503, 503, 503])).toBeUndefined();
    expect((await owner(sql)).body.submissions!.length).toBe(6);
  });
});

describe("given one address posting submissions", () => {
  it("when it posts more than its burst, then the extra ones answer 429 and store nothing, while another address is still admitted", async () => {
    const sql = await freshDb();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.submit.burst + 3; i++) statuses.push((await post(sql, envelope("bench"), { ip })).status);
    expect(firstMismatch(statuses, [...Array<number>(LIMITS.submit.burst).fill(201), 429, 429, 429]), "statuses of the burst").toBeUndefined();
    expect((await post(sql, envelope("bench"))).status).toBe(201);
    expect((await owner(sql)).body.submissions!.length).toBe(LIMITS.submit.burst + 1);
  });

  it("when malformed posts have spent its burst, then a valid post answers 429 without touching the database", async () => {
    let touched = 0;
    const sql = { query: async () => (touched++, []) } as unknown as Sql;
    const ip = freshIp();
    for (let i = 0; i < LIMITS.submit.burst; i++) await post(sql, "{not json", { ip });
    const refused = await post(sql, envelope("bench"), { ip });
    expect(refused.status).toBe(429);
    expect(touched).toBe(0);
  });
});

describe("given the owner reading submissions back", () => {
  it("when no owner token is configured on the server, then reads answer 503 even with a bearer header", async () => {
    const sql = await freshDb();
    expect((await owner(sql, "", null)).status).toBe(503);
  });

  it("when the configured token is shorter than 24 characters, then reads answer 503, whatever the bearer header says", async () => {
    const sql = await freshDb();
    const reply = await send(sql, { token: "short", headers: { authorization: "Bearer short" } });
    expect(reply.status).toBe(503);
  });

  const unauthorizedCases: { it: string; headers: Record<string, string> }[] = [
    { it: "no authorization header is sent", headers: {} },
    { it: "the token is wrong", headers: { authorization: `Bearer ${OWNER_TOKEN}y` } },
    { it: "the token is a prefix of the right one", headers: { authorization: `Bearer ${OWNER_TOKEN.slice(0, 30)}` } },
    { it: "the scheme is not Bearer", headers: { authorization: `Basic ${OWNER_TOKEN}` } },
  ];
  for (const testCase of unauthorizedCases) {
    it(`when ${testCase.it}, then listing and fetching answer 401 and reveal no submission`, async () => {
      const sql = await freshDb();
      const receipt = await post(sql, envelope("bench"));
      const list = await send(sql, { headers: testCase.headers });
      const one = await send(sql, { search: `?id=${receipt.body.id}`, headers: testCase.headers });
      expect(list.status).toBe(401);
      expect(one.status).toBe(401);
      expect(JSON.stringify([list.body, one.body]).includes("3295bad")).toBe(false);
    });
  }

  it("when the owner lists, then the newest submissions come first without their payloads, and `kind` and `limit` narrow the list", async () => {
    const sql = await freshDb();
    const ids: string[] = [];
    for (const kind of ["bench", "flag", "bench", "capture"] as const) ids.push((await post(sql, envelope(kind))).body.id!);
    const all = await owner(sql);
    expect(firstMismatch(listedIds(all), [...ids].reverse()), "listed ids, newest first").toBeUndefined();
    expect(firstMismatch(Object.keys(all.body.submissions![0]!).sort(), ["id", "kind", "receivedAt", "sha", "size"])).toBeUndefined();
    expect(firstMismatch(listedIds(await owner(sql, "?kind=bench")), [ids[2], ids[0]]), "listed ids of kind bench").toBeUndefined();
    expect((await owner(sql, "?limit=2")).body.submissions!.length).toBe(2);
  });

  const badQueryCases = [
    { it: "the receipt id is not the receipt format", search: "?id=%27%3B%20DROP%20TABLE%20submissions%3B--", status: 400 },
    { it: "the receipt id holds a path", search: "?id=..%2F..%2Fetc%2Fpasswd", status: 400 },
    { it: "the kind filter is not a kind", search: "?kind=all", status: 400 },
    { it: "the limit is not a number", search: "?limit=lots", status: 400 },
    { it: "the limit is over 200", search: "?limit=201", status: 400 },
    { it: "the receipt id is well formed but unknown", search: "?id=2222-2222", status: 404 },
  ];
  for (const testCase of badQueryCases) {
    it(`when ${testCase.it}, then the owner gets ${testCase.status}`, async () => {
      const sql = await freshDb();
      expect((await owner(sql, testCase.search)).status).toBe(testCase.status);
    });
  }

  it("when one address sends more than its burst of reads with a wrong token, then the extra ones answer 429 instead of 401", async () => {
    const sql = await freshDb();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.read.burst + 5; i++) statuses.push((await send(sql, { ip, headers: { authorization: "Bearer wrong" } })).status);
    expect(firstMismatch(statuses, [...Array<number>(LIMITS.read.burst).fill(401), 429, 429, 429, 429, 429]), "statuses of the bad-token burst").toBeUndefined();
  });
});

describe("given the store is at its size cap", () => {
  it("when it holds the most rows it keeps, then a post answers 507 and the owner can still read what is there", async () => {
    const sql = await freshDb();
    await sql.query(
      `INSERT INTO submissions (id, kind, sha, size, body)
       SELECT 'T' || n, 'bench', 'abc1234', 10, '{}' FROM generate_series(1, $1::int) AS n`,
      [STORE_MAX_ROWS],
    );
    const refused = await post(sql, envelope("bench"));
    expect(refused.status).toBe(507);
    expect((await owner(sql, "?limit=1")).body.submissions!.length).toBe(1);
  });

  it("when it holds the most bytes it keeps, then a post answers 507", async () => {
    const sql = await freshDb();
    await sql.query(`INSERT INTO submissions (id, kind, sha, size, body) VALUES ('BIG', 'bench', 'abc1234', $1, '{}')`, [STORE_MAX_BYTES]);
    expect((await post(sql, envelope("bench"))).status).toBe(507);
  });
});
