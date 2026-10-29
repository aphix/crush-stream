import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { MAX_JSON_BYTES, MAX_WIRE_BYTES, type Envelope } from "./kinds.ts";
import { envelopeOf, submit, type Device, type SubmitResult } from "./client.ts";

const DEVICE: Device = { sha: "3295bad", ua: "Mozilla/5.0 Test", screen: { w: 390, h: 844, dpr: 3 } };
const CONTEXT = { scene: "race", settings: { seed: 7, fxTier: "low", session: "k3x9q2", loop: 4 } };
const NOW = 1_791_000_000_000;

interface Sent {
  url: string;
  method: string;
  contentType: string | null;
  text: string;
}

/** A fetch that records the request it got and answers with `status` and `reply`. */
function answering(status: number, reply: string, sent: Sent[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), contentType: new Headers(init.headers).get("content-type"), text: String(init.body) });
    return new Response(reply, { status });
  }) as typeof fetch;
}

function expectReceipt(result: SubmitResult, id: string, what = "receipt"): void {
  expect("id" in result ? result.id : undefined, what).toBe(id);
}

function expectRefusal(result: SubmitResult, error: string, what = "refusal"): void {
  expect("error" in result ? result.error : undefined, what).toBe(error);
}

/** Every envelope field but the payload, one expect each. */
function expectEnvelopeHeader(got: Envelope, want: Envelope, what: string): void {
  expect(got.kind, `${what}: kind`).toBe(want.kind);
  expect(got.sha, `${what}: sha`).toBe(want.sha);
  expect(got.at, `${what}: at`).toBe(want.at);
  expect(got.ua, `${what}: ua`).toBe(want.ua);
  expect(got.screen.w, `${what}: screen.w`).toBe(want.screen.w);
  expect(got.screen.h, `${what}: screen.h`).toBe(want.screen.h);
  expect(got.screen.dpr, `${what}: screen.dpr`).toBe(want.screen.dpr);
  expect(got.scene, `${what}: scene`).toBe(want.scene);
  expect(Object.keys(got.settings), `${what}: settings keys`).toHaveLength(Object.keys(want.settings).length);
  for (const key of Object.keys(want.settings)) expect(got.settings[key], `${what}: settings.${key}`).toBe(want.settings[key]);
}

describe("given a bench card ready to submit from a phone", () => {
  it("when it is posted, then the server gets the running build, the device, the clock, the scene, the settings and the card in one JSON request, and the receipt comes back", async () => {
    const sent: Sent[] = [];
    const payload = { result: { fps: 58 } };
    const result = await submit("bench", CONTEXT, payload, { fetch: answering(201, '{"id":"K7QM-2XWD"}', sent), device: DEVICE, now: NOW, gzip: false });
    expectReceipt(result, "K7QM-2XWD");
    expect(sent.length).toBe(1);
    const request = sent[0];
    if (!request) throw new Error("no request sent");
    expect(request.method).toBe("POST");
    expect(request.contentType).toBe("application/json");
    const body: Envelope & { payload: typeof payload } = JSON.parse(request.text);
    expectEnvelopeHeader(body, envelopeOf("bench", CONTEXT, payload, DEVICE, NOW), "request body");
    expect(body.payload.result.fps, "request body: payload fps").toBe(58);
  });

  it("when the browser can gzip, then the request is gzipped and says so, and the server can read back the same envelope", async () => {
    const seen: { encoding: string | null; text: string }[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      seen.push({ encoding: new Headers(init.headers).get("content-encoding"), text: gunzipSync(init.body as Uint8Array).toString("utf8") });
      return new Response('{"id":"K7QM-2XWD"}', { status: 201 });
    }) as typeof fetch;
    const payload = { samples: Array.from({ length: 200 }, (_, i) => ({ t: i / 4, x: i % 7 })) };
    const result = await submit("capture", CONTEXT, payload, { fetch: fetcher, device: DEVICE, now: NOW, gzip: true });
    expectReceipt(result, "K7QM-2XWD");
    const request = seen[0];
    if (!request) throw new Error("no request reached the fetcher");
    expect(request.encoding).toBe("gzip");
    const body: Envelope & { payload: typeof payload } = JSON.parse(request.text);
    expectEnvelopeHeader(body, envelopeOf("capture", CONTEXT, payload, DEVICE, NOW), "gzipped body");
    expect(body.payload.samples, "gzipped body: samples").toHaveLength(payload.samples.length);
    for (let i = 0; i < payload.samples.length; i++) {
      expect(body.payload.samples[i]?.t, `gzipped body: sample ${i} t`).toBe(payload.samples[i]?.t);
      expect(body.payload.samples[i]?.x, `gzipped body: sample ${i} x`).toBe(payload.samples[i]?.x);
    }
  });

  it("when the envelope is built for each kind, then it names that kind and carries the same build and device", () => {
    for (const kind of ["bench", "capture", "flag"] as const) {
      const e = envelopeOf(kind, CONTEXT, {}, DEVICE, NOW);
      expect(e.kind, `${kind} envelope kind`).toBe(kind);
      expect(e.sha, `${kind} envelope sha`).toBe("3295bad");
      expect(e.ua, `${kind} envelope ua`).toBe("Mozilla/5.0 Test");
    }
  });
});

describe("given a submission the server refuses or cannot be reached for", () => {
  const cases = [
    { it: "the server's store is full", status: 507, reply: "{}", error: "the server's store is full" },
    { it: "the address has posted too much", status: 429, reply: "{}", error: "too many submissions just now, try again in a minute" },
    { it: "a proxy in front answers 413 with an HTML page", status: 413, reply: "<html>too large</html>", error: "too big to send" },
    { it: "the server fails", status: 500, reply: "{}", error: "the server answered 500" },
    { it: "the server accepts it but sends no receipt", status: 201, reply: "{}", error: "the server sent no receipt" },
  ];
  for (const testCase of cases) {
    it(`when ${testCase.it}, then the player is told: ${testCase.error}`, async () => {
      const result = await submit("bench", CONTEXT, {}, { fetch: answering(testCase.status, testCase.reply), device: DEVICE, now: NOW, gzip: false });
      expectRefusal(result, testCase.error);
    });
  }

  it("when the network is down, then the player is told the server could not be reached", async () => {
    const offline = (async () => Promise.reject(new TypeError("offline"))) as typeof fetch;
    expectRefusal(await submit("bench", CONTEXT, {}, { fetch: offline, device: DEVICE, now: NOW }), "could not reach the server");
  });

  it("when a card is over the bench size cap, then nothing is sent and the player is told how big it is", async () => {
    const sent: Sent[] = [];
    const big = { filler: "x".repeat(MAX_JSON_BYTES.bench) };
    const result = await submit("bench", CONTEXT, big, { fetch: answering(201, '{"id":"K7QM-2XWD"}', sent), device: DEVICE, now: NOW, gzip: false });
    expect(sent).toHaveLength(0);
    expect("error" in result && result.error.startsWith("too big to send (8.0 MB, at most 8.0 MB)"), JSON.stringify(result)).toBeTruthy();
  });

  it("when a body that is not gzipped is over the wire cap, then nothing is sent and the player is told how big it is on the wire", async () => {
    const sent: Sent[] = [];
    const big = { samples: [{ filler: "x".repeat(MAX_WIRE_BYTES + 1) }] };
    const result = await submit("capture", CONTEXT, big, { fetch: answering(201, '{"id":"K7QM-2XWD"}', sent), device: DEVICE, now: NOW, gzip: false });
    expect(sent).toHaveLength(0);
    expect("error" in result && result.error.includes("on the wire"), JSON.stringify(result)).toBeTruthy();
  });
});
