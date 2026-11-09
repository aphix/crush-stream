import { BODY_SWAP_SECONDS } from "./traffic-constants.ts";

/** Whether a pool car may be rebuilt to wear another body: it is the costliest thing traffic asks of the engine, so it happens at most once in `BODY_SWAP_SECONDS`, for every fleet together. */
export class BodySwaps {
  private lastAt = -Infinity;

  allows(seconds: number): boolean {
    return seconds - this.lastAt >= BODY_SWAP_SECONDS;
  }

  note(seconds: number): void {
    this.lastAt = seconds;
  }
}
