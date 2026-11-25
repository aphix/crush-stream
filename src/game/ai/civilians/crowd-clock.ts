import { CLOCK_OFFSET_CREEP } from "./civilian-crowd-constants.ts";

/** A client's view of the host's crowd clock: the host's crowd time from its messages, run on this machine's clock the way the snapshot clock runs (least gap seen, a creep up). */
export class ClientCrowdClock {
  private offset = Infinity;
  private heardHost = 0;
  private heardCrowd = 0;

  hear(hostTime: number, crowdTime: number, localNow: number): void {
    this.offset = Math.min(localNow - hostTime, this.offset + CLOCK_OFFSET_CREEP);
    this.heardHost = hostTime;
    this.heardCrowd = crowdTime;
  }

  /** The host's crowd time at the host clock `renderDelay` s behind now, where the snapshots the client draws are. */
  crowdSeconds(localNow: number, renderDelay: number): number {
    return Math.max(0, this.heardCrowd + (localNow - this.offset - renderDelay - this.heardHost));
  }
}
