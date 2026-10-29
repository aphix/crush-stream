import { describe, expect, it } from "vitest";
import { LIMITS, RateLimiter } from "./rate-limit.ts";
import { ROOM_MAX } from "./rooms.ts";

/** One relay request as signaling.server.ts admits it: the address, then the peer. Its room spends no bucket. */
function request(l: RateLimiter, ip: string, peer: string, now: number): boolean {
  return l.ip(ip, now) && l.peer(ip, peer, now);
}

describe("given the signaling relay's rate limits (a per-address bucket and a per-peer-id bucket; a room spends none)", () => {
  it("when a full room of friends behind one NAT sends 60 requests per peer within 2 s of handshaking, then no request is refused", () => {
    const l = new RateLimiter();
    // Worse than the measured 8-page smoke (~30 requests per peer over 7 s): 60 per peer inside 2 s.
    let refused = 0;
    for (let k = 0; k < 60; k++) {
      for (let p = 0; p < ROOM_MAX; p++) if (!request(l, "nat", `peer${p}`, k * 33)) refused++;
    }
    expect(refused).toBe(0);
  });

  it("when one peer id floods 1000 requests at once, then it gets one peer's burst, and 1000 requests a second later get only its refill rate", () => {
    const l = new RateLimiter();
    let ok = 0;
    for (let k = 0; k < 1000; k++) if (request(l, "a", "same", 0)) ok++;
    expect(ok).toBe(LIMITS.peer.burst);
    ok = 0;
    for (let k = 0; k < 1000; k++) if (request(l, "a", "same", 1000)) ok++;
    expect(ok).toBe(LIMITS.peer.rate);
  });

  it("when one address rotates through 5000 peer ids and rooms at once, then it gets no more than a full room's worth of requests (the address burst)", () => {
    const l = new RateLimiter();
    let ok = 0;
    for (let k = 0; k < 5000; k++) if (request(l, "a", `p${k}`, 0)) ok++;
    expect(ok).toBe(LIMITS.ip.burst);
  });

  it("when one address is exhausted and another address exhausts a peer id, then a third address using that same peer id, and its room listing, are still admitted", () => {
    const l = new RateLimiter();
    for (let k = 0; k < 5000; k++) request(l, "a", `p${k}`, 0);
    for (let k = 0; k < 1000; k++) request(l, "b", "victim", 0);
    // Same peer id from another address: its own bucket, not the flooder's.
    expect(request(l, "c", "victim", 0)).toBeTruthy();
    expect(l.list("c", 0)).toBeTruthy();
  });

  it("when three addresses send at their full rate for 70 s with a fresh peer and room per request, then a new address and peer are still admitted", () => {
    // ReviewA's probe: three addresses at their full rate, a fresh peer and room per request, 70 s.
    const l = new RateLimiter();
    const tick = 1000 / LIMITS.ip.rate;
    let now = 0;
    for (let k = 0; now < 70_000; k++, now = k * tick) {
      for (const ip of ["x1", "x2", "x3"]) request(l, ip, `${ip}-${k}`, now);
    }
    expect(request(l, "victim", "fresh", now - tick)).toBeTruthy();
  });

  it("when an outsider rotates through 5000 peer ids for a public room, then every member of that room behind another address is still admitted", () => {
    const l = new RateLimiter();
    for (let k = 0; k < 5000; k++) request(l, "outsider", `p${k}`, 0);
    for (let p = 0; p < ROOM_MAX; p++) expect(request(l, "nat", `peer${p}`, 0), `peer${p}`).toBeTruthy();
  });
});
