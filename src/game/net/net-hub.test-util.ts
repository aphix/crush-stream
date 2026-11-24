import type { NetTx } from "./net-ports.ts";
import { NetTransport, type NetPeer } from "./transport.ts";

/** Frame time (ms) of a session loop: one host snapshot and one guest input per step. */
export const FRAME_MS = 1000 / 30;
/** The relay's message cap (bytes): a longer message never arrives. */
export const RELAY_MSG_MAX = 240 * 1024;

/**
 * An in-memory room: every end reaches every other end unless their pair is cut (a connection blip).
 * An `unlisted` end is off every roster while its messages still flow (a link the host's transport
 * no longer reports, yet traffic gets through).
 */
export class Hub {
  readonly ends = new Map<string, Link>();
  readonly unlisted = new Set<string>();
  private readonly cut = new Set<string>();
  private queue: { due: number; fn: () => void }[] = [];
  private readonly delays = new Map<string, number>();

  /** The time (ms) the delays run on: a test sets it to its own clock. */
  now: () => number = () => 0;

  /** Each end's `meta` getter (a public host's relay tag), by peer id. */
  readonly metas = new Map<string, () => string>();

  readonly connect = (_tx: NetTx, _room: string, id: string, role: "host" | "client", meta: () => string = () => ""): NetTransport => {
    const end = new Link(this, id, role);
    this.ends.set(id, end);
    this.metas.set(id, meta);
    return end;
  };

  linked(a: string, b: string): boolean {
    return !this.cut.has(`${a}|${b}`);
  }

  /** Drop (or restore) the link between two peers, both ways. */
  setCut(a: string, b: string, on: boolean): void {
    for (const k of [`${a}|${b}`, `${b}|${a}`]) {
      if (on) this.cut.add(k);
      else this.cut.delete(k);
    }
  }

  /** Delay every message between two peers, both ways, by `ms` (0: none): the first `flush` at or after that long delivers it. */
  setDelay(a: string, b: string, ms: number): void {
    this.delays.set(`${a}|${b}`, ms);
    this.delays.set(`${b}|${a}`, ms);
  }

  delayOf(a: string, b: string): number {
    return this.delays.get(`${a}|${b}`) ?? 0;
  }

  post(fn: () => void, delayMs = 0): void {
    this.queue.push({ due: this.now() + delayMs, fn });
  }

  /** Deliver everything sent so far that is due (and whatever that sends in turn, if it too is due). */
  flush(): void {
    const now = this.now();
    for (;;) {
      const due = this.queue.filter((item) => item.due <= now);
      if (due.length === 0) return;
      this.queue = this.queue.filter((item) => item.due > now);
      for (const item of due) item.fn();
    }
  }

  /** A raw message from `from` to `to`, as if `from` had sent it. */
  sendAs(from: string, to: string, data: Uint8Array): void {
    const end = this.ends.get(to);
    if (end) this.post(() => end.onMessage?.(from, data.slice()));
  }
}

class Link extends NetTransport {
  closed = false;
  private readonly hub: Hub;
  private readonly role: "host" | "client";

  constructor(hub: Hub, id: string, role: "host" | "client") {
    super(id);
    this.hub = hub;
    this.role = role;
  }

  send(data: Uint8Array, to?: string): void {
    if (data.length > RELAY_MSG_MAX) return;
    for (const [id, end] of this.hub.ends) {
      if (id === this.selfId || end.closed || (to !== undefined && to !== id) || !this.hub.linked(this.selfId, id)) continue;
      const copy = data.slice();
      this.hub.post(() => end.onMessage?.(this.selfId, copy), this.hub.delayOf(this.selfId, id));
    }
  }

  peers(): readonly NetPeer[] {
    const out: NetPeer[] = [];
    for (const [id, end] of this.hub.ends) {
      if (id === this.selfId || end.closed || !this.hub.linked(this.selfId, id) || this.hub.unlisted.has(id)) continue;
      out.push({ id, rttMs: 1, host: end.role === "host" });
    }
    return out;
  }

  close(): void {
    this.closed = true;
  }
}
