import { tickAt } from "./civilian-clock.ts";
import { EVENT_KIND, EVENT_TRIPLE, PLAN_LEAD_TICKS } from "./civilian-constants.ts";
import { EVENT_LOG_CAPACITY, NOT_A_CIVILIAN } from "./civilian-crowd-constants.ts";
import type { CivilianRemote } from "./civilian-remote.ts";

export const NO_EVENTS: readonly number[] = [];

/** The crowd's event log (kind, subject, crowd seconds triples) and the batch of them queued for the brain's next plan. */
export class CrowdEventLog {
  private readonly remote: CivilianRemote;
  private readonly log = new Float64Array(EVENT_LOG_CAPACITY * EVENT_TRIPLE);
  private logCount = 0;
  private logView = new Float64Array(0);
  /** Log events a late joiner's catch-up has given the brain. */
  private replayed = 0;
  private readonly batch: Float64Array;
  private batchCount = 0;
  /** The newest tick posted to the brain, kept in step with the remote's own: an event is posted at the next one. */
  private postedThrough = -1;

  constructor(capacity: number, remote: CivilianRemote) {
    this.remote = remote;
    this.batch = new Float64Array((capacity + EVENT_LOG_CAPACITY) * EVENT_TRIPLE);
  }

  /** The host's event log (kind, subject, crowd seconds triples), a view of the live one. */
  view(): Float64Array {
    if (this.logView.length !== this.logCount * EVENT_TRIPLE) this.logView = this.log.subarray(0, this.logCount * EVENT_TRIPLE);
    return this.logView;
  }

  /** Where the events of the host's log `events` that this log has not got begin: after the last one it has (the log only grows). */
  firstNew(events: Float64Array): number {
    let first = 0;
    const last = (this.logCount - 1) * EVENT_TRIPLE;
    for (let at = events.length - EVENT_TRIPLE; at >= 0 && last >= 0; at -= EVENT_TRIPLE) {
      if (events[at] === this.log[last] && events[at + 1] === this.log[last + 1] && events[at + 2] === this.log[last + 2]) {
        first = at + EVENT_TRIPLE;
        break;
      }
    }
    return first;
  }

  /** The brain has been advanced through `tick`: the next event is posted past the plans it has made ahead. */
  advanced(tick: number): void {
    this.postedThrough = Math.max(this.postedThrough, tick + PLAN_LEAD_TICKS);
  }

  /** After the catch-up, the log's events still to come (the host's clock is ahead of a client's) go to the brain as heard ones do. */
  queueUnreplayed(): void {
    for (let at = this.replayed; at < this.logCount; at++) this.queueForBrain(this.log[at * EVENT_TRIPLE]!, this.log[at * EVENT_TRIPLE + 1]!, this.log[at * EVENT_TRIPLE + 2]!);
    this.replayed = this.logCount;
    this.postBatch();
  }

  /** A late joiner's first steps give the brain the log's events at the ticks they happened in, as the host's brain had them. */
  replayDue(tick: number): ArrayLike<number> {
    let end = this.replayed;
    while (end < this.logCount && tickAt(this.log[end * EVENT_TRIPLE + 2]!) <= tick) end++;
    if (end === this.replayed) return NO_EVENTS;
    const due = this.log.subarray(this.replayed * EVENT_TRIPLE, end * EVENT_TRIPLE);
    this.replayed = end;
    return due;
  }

  logHostEvent(kind: number, subject: number, seconds: number): void {
    this.appendLog(kind, subject, seconds);
    this.queueForBrain(kind, subject, seconds);
  }

  logPair(kind: number, first: number, second: number, seconds: number): void {
    this.logHostEvent(kind, first, seconds);
    if (second !== NOT_A_CIVILIAN) this.logHostEvent(EVENT_KIND.alongside, second, seconds);
  }

  appendLog(kind: number, subject: number, seconds: number): void {
    if (this.logCount === EVENT_LOG_CAPACITY) {
      this.log.copyWithin(0, EVENT_TRIPLE);
      this.logCount--;
      this.replayed = Math.max(0, this.replayed - 1);
    }
    const at = this.logCount++ * EVENT_TRIPLE;
    this.log[at] = kind;
    this.log[at + 1] = subject;
    this.log[at + 2] = seconds;
  }

  queueForBrain(kind: number, subject: number, seconds: number): void {
    const at = this.batchCount++ * EVENT_TRIPLE;
    this.batch[at] = kind;
    this.batch[at + 1] = subject;
    this.batch[at + 2] = seconds;
  }

  /** The queued events go to the brain with the next tick it has not been asked to plan, so a knock hides its civilian at once and every peer gets the plan its events ride. */
  postBatch(): void {
    if (this.batchCount === 0) return;
    this.postedThrough++;
    this.remote.post(this.postedThrough, this.batch.subarray(0, this.batchCount * EVENT_TRIPLE));
    this.batchCount = 0;
  }
}
