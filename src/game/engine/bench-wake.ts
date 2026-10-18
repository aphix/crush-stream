/**
 * The screen wake lock a bench loop holds from its first step to its last, so a phone does not dim and lock its screen between the pages of an
 * eight-bench cycle (a locked screen throttles the page: its frames are not the device's speed). The browser drops the lock whenever the page is hidden, so
 * the hold asks again when the page is shown. `held` is what the card's per-second series reads. A browser without the API (or one that refuses it: no secure
 * context, battery saver) holds nothing, and the series says so.
 */
export class WakeHold {
  held = false;
  readonly supported: boolean;
  private sentinel: WakeLockSentinel | null = null;
  private ended = false;
  private readonly onVisibility = (): void => {
    if (!document.hidden && !this.ended) void this.acquire();
  };

  constructor() {
    this.supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Asks for the lock unless this hold has it; a refusal is logged and leaves `held` false. */
  async acquire(): Promise<void> {
    if (!this.supported || this.ended || (this.sentinel !== null && !this.sentinel.released)) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      this.sentinel = sentinel;
      this.held = true;
      sentinel.addEventListener("release", () => void (this.held = false));
    } catch (err) {
      this.held = false;
      console.warn("Crush bench: the screen wake lock was refused", err);
    }
  }

  /** The loop is over: the lock goes and the hold asks no more. */
  async release(): Promise<void> {
    this.ended = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    const sentinel = this.sentinel;
    this.sentinel = null;
    this.held = false;
    if (sentinel !== null && !sentinel.released) await sentinel.release();
  }
}
