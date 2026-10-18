/**
 * When a setting has settled: the frames after a switch (a tier change, a pacer pin, a rung) are watched until the newest `SETTLE.frames` of
 * them are steady, and only then does a block score. Steady is two tests on the frame intervals (ms): no frame of the newest half is more than
 * `SETTLE.spike` times that half's median (a hang is a spike), and that median is within `SETTLE.levelTolerance` of the half before's (a cost still
 * falling or rising has not settled). A setting that is not steady once `SETTLE.capS` wall seconds and `SETTLE.capFrames` frames have passed is scored anyway and says so (`settled` false): a slow device (a phone at 10 fps) gets the frames, not just the seconds.
 */
export const SETTLE = { frames: 30, spike: 3, levelTolerance: 0.2, capS: 6, capFrames: 120 } as const;

/** What the frames after one switch were like: the worst frame, how long until steady, and whether it ever was. */
export interface SettleResult {
  settled: boolean;
  /** Frames and wall seconds watched. */
  frames: number;
  settleS: number;
  /** The longest frame interval (ms), its place among the frames after the switch (0 = the first) and the engine's own ms in it. */
  longestMs: number;
  longestAt: number;
  longestCpuMs: number;
}

/** Median of `values`, sorted in place (the whole array: a view would allocate every frame). */
function medianOf(values: Float64Array): number {
  values.sort();
  const count = values.length;
  return count % 2 === 1 ? values[count >> 1]! : (values[count / 2 - 1]! + values[count / 2]!) / 2;
}

/** One switch of an A/B as the card carries it: which A/B (`stretch`), the arm switched to, the round, and how its frames after the switch went. */
export interface SwitchHitch extends SettleResult {
  stretch: string;
  arm: string;
  round: number;
}

export class SettleWatch {
  private readonly ring = new Float64Array(2 * SETTLE.frames);
  private readonly scratch = new Float64Array(SETTLE.frames);
  private n = 0;
  private wallMs = 0;
  private settled = false;
  private longestMs = 0;
  private longestAt = 0;
  private longestCpuMs = 0;

  /** The frames from here on belong to a new switch. */
  reset(): void {
    this.n = 0;
    this.wallMs = 0;
    this.settled = false;
    this.longestMs = 0;
    this.longestAt = 0;
    this.longestCpuMs = 0;
  }

  /** The next frame's interval and the engine's ms in it; true once the setting has settled or the cap is reached (`result` says which). */
  push(intervalMs: number, cpuMs: number): boolean {
    const size = this.ring.length;
    if (intervalMs > this.longestMs) {
      this.longestMs = intervalMs;
      this.longestAt = this.n;
      this.longestCpuMs = cpuMs;
    }
    this.ring[this.n % size] = intervalMs;
    this.n++;
    this.wallMs += intervalMs;
    if (this.n >= size && this.steady()) this.settled = true;
    return this.settled || (this.wallMs >= SETTLE.capS * 1000 && this.n >= SETTLE.capFrames);
  }

  private steady(): boolean {
    const half = SETTLE.frames;
    const size = this.ring.length;
    let newest = 0;
    for (let k = 0; k < half; k++) {
      const value = this.ring[(this.n - 1 - k) % size]!;
      this.scratch[k] = value;
      newest = Math.max(newest, value);
    }
    const newestMedian = medianOf(this.scratch);
    if (newest > SETTLE.spike * newestMedian) return false;
    for (let k = 0; k < half; k++) this.scratch[k] = this.ring[(this.n - 1 - half - k) % size]!;
    const olderMedian = medianOf(this.scratch);
    return Math.abs(newestMedian - olderMedian) <= SETTLE.levelTolerance * olderMedian;
  }

  result(): SettleResult {
    return { settled: this.settled, frames: this.n, settleS: this.wallMs / 1000, longestMs: this.longestMs, longestAt: this.longestAt, longestCpuMs: this.longestCpuMs };
  }
}
