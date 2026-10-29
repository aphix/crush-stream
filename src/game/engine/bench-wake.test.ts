import { afterEach, describe, expect, it, vi } from "vitest";
import { WakeHold } from "./bench-wake.ts";

type Listener = () => void;

/** A page whose Screen Wake Lock API is a stub: each `request` hands back a sentinel the test can release the way a browser does (a hidden page). */
function stubPage(options: { supported?: boolean; refuse?: boolean } = {}): {
  requests: number;
  sentinels: { released: boolean; release(): Promise<void>; fire(): void }[];
  lastRequest: Promise<unknown>;
  show(hidden: boolean): void;
} {
  const listeners = new Set<Listener>();
  const state = { hidden: false };
  const page = {
    requests: 0,
    sentinels: [] as { released: boolean; release(): Promise<void>; fire(): void }[],
    lastRequest: Promise.resolve() as Promise<unknown>,
    show(hidden: boolean): void {
      state.hidden = hidden;
      if (hidden) for (const sentinel of page.sentinels) if (!sentinel.released) sentinel.fire();
      for (const listener of listeners) listener();
    },
  };
  Object.defineProperty(globalThis, "document", {
    value: { get hidden() { return state.hidden; }, addEventListener: (_type: string, l: Listener) => void listeners.add(l), removeEventListener: (_type: string, l: Listener) => void listeners.delete(l) },
    configurable: true,
  });
  const grant = async () => {
    page.requests++;
    if (options.refuse) throw new Error("NotAllowedError");
    const release = new Set<Listener>();
    const sentinel = {
      released: false,
      addEventListener: (_type: string, l: Listener) => void release.add(l),
      release: async () => {
        sentinel.released = true;
        for (const l of release) l();
      },
      fire: () => {
        sentinel.released = true;
        for (const l of release) l();
      },
    };
    page.sentinels.push(sentinel);
    return sentinel;
  };
  const wakeLock = { request: () => (page.lastRequest = grant()) };
  Object.defineProperty(globalThis, "navigator", { value: options.supported === false ? {} : { wakeLock }, configurable: true });
  return page;
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
  Object.defineProperty(globalThis, "navigator", originalNavigator!);
});

describe("given a loop that holds the screen wake lock", () => {
  it("when the hold is acquired, then the lock is requested once and held; a second ask while held requests nothing", async () => {
    const page = stubPage();
    const hold = new WakeHold();
    await hold.acquire();
    await hold.acquire();
    expect(page.requests, "requests").toBe(1);
    expect(hold.held, "held").toBe(true);
    await hold.release();
  });

  it("when the page is hidden and shown again, then the browser's release is seen (held false) and the hold asks again on show, and is held again", async () => {
    const page = stubPage();
    const hold = new WakeHold();
    await hold.acquire();
    page.show(true);
    expect(hold.held, "released with the hidden page").toBe(false);
    page.show(false);
    await page.lastRequest;
    expect(page.requests, "asked again on show").toBe(2);
    expect(hold.held, "held again").toBe(true);
    await hold.release();
  });

  it("when the loop ends, then the lock is released, held is false, and a page shown later asks for nothing", async () => {
    const page = stubPage();
    const hold = new WakeHold();
    await hold.acquire();
    await hold.release();
    expect(hold.held, "held").toBe(false);
    expect(page.sentinels[0]!.released, "the sentinel was released").toBe(true);
    page.show(true);
    page.show(false);
    expect(page.requests, "no ask after the end").toBe(1);
  });

  it("when the browser has no wake lock, then nothing is requested and held stays false", async () => {
    const page = stubPage({ supported: false });
    const hold = new WakeHold();
    await hold.acquire();
    expect(hold.supported, "supported").toBe(false);
    expect(hold.held, "held").toBe(false);
    expect(page.requests, "requests").toBe(0);
    await hold.release();
  });

  it("when the browser refuses the lock, then the refusal is logged, held is false, and the hold does not throw", async () => {
    stubPage({ refuse: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hold = new WakeHold();
    await hold.acquire();
    expect(hold.held, "held").toBe(false);
    expect(warn.mock.calls.length, "logged").toBe(1);
    await hold.release();
  });
});
