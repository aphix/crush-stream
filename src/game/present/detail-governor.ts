import { DETAIL_LEVELS } from "./car-detail.ts";
import { SLOW_WINDOWS } from "./constants.ts";
import { climbFits, FrameWork, type Judge } from "./frame-work.ts";

/**
 * A quality rung chosen by how the match runs: the distance detail's (`DETAIL_LEVELS`) on the main thread's total, and Auto
 * render scale's (`PlayerQuality`) on the GPU's alone, the way `AutoFx` chooses the FX tier: windows of
 * the frames the match plays (`FrameWork`). A window is slow when the frame cannot hold the 60 fps budget (the main thread's or
 * the GPU's median over it is too long; with no GPU reading, a wall rate under `SLOW_FPS`, the 60 fps of a plain screen less 5 %)
 * or the pacer gave up more than `LOST_SHARE` of its time (a sim that cannot keep its clock). `SLOW_WINDOWS` slow windows in a row
 * step one rung nearer (a cheaper draw); `holdWindows` windows in a row with room to spare step one rung back (a pinned display
 * shows 60 fps at any headroom, so "not slow" is not room). A step back that is followed by a step nearer within twice its hold was
 * too soon: the hold doubles (to `MAX_HOLD`), so a device that cannot afford a rung stops trying it. A hitch ends one window and
 * never steps, a match's first `SETTLE_MS` and every rung change's are not counted (the draw's new cost takes a moment to show),
 * and outside a match nothing is counted at all.
 */
const SLOW_FPS = 57;
const LOST_SHARE = 0.02;
const FIRST_HOLD = 10;
const MAX_HOLD = 80;

export class DetailGovernor {
  /** The rung in force (0: the farthest cuts, or the sharpest render scale). */
  level: number;
  /** Windows with room in a row that step one rung back, doubled by a too-early step back. */
  holdWindows = FIRST_HOLD;
  private readonly win: FrameWork;
  private readonly last: number;
  private lostMs = 0;
  private slow = 0;
  private fine = 0;
  /** The busier sides summed over `fine`'s windows: a step back needs their mean to fit `climbFits`. */
  private fineBusy = 0;
  /** Windows since the last step back (-1: none yet); it only matters while it is within twice the hold. */
  private sinceBack = -1;

  /** `start`: the rung a match opens on (clamped); `last`: the ladder's last rung (`DETAIL_LEVELS`'s by default); `judge`: the basis its windows are judged on (`frame-work.ts`). */
  constructor(start: number, last = DETAIL_LEVELS.length - 1, judge: Judge = "work") {
    this.last = last;
    this.win = new FrameWork(judge);
    this.level = Math.min(last, Math.max(0, start));
  }

  /**
   * One rendered frame: its wall interval (ms), the sim time the pacer gave up in it (ms), the main thread's ms for the last frame
   * (judged in total: this governor does not split sim from render), the draw submit inside it, the newest GPU ms (-1: none) and
   * whether a match is running. Returns the rung to switch to, or null.
   */
  frame(ms: number, lostMs: number, workMs: number, renderMs: number, gpuMs: number, matching: boolean): number | null {
    if (!matching) {
      this.restart();
      return null;
    }
    const counted = !this.win.settling;
    const done = this.win.add(ms, workMs, renderMs, gpuMs);
    if (!counted) return null;
    this.lostMs += lostMs;
    if (!done) return null;
    const slow = this.win.slow(SLOW_FPS) || this.lostMs > LOST_SHARE * this.win.wallMs;
    this.lostMs = 0;
    if (this.sinceBack >= 0) this.sinceBack++;
    if (slow) {
      this.fine = this.fineBusy = 0;
      this.slow++;
      if (this.slow < SLOW_WINDOWS || this.level >= this.last) return null;
      // Too soon after a step back: the next try waits longer.
      if (this.sinceBack >= 0 && this.sinceBack <= 2 * this.holdWindows) this.holdWindows = Math.min(MAX_HOLD, this.holdWindows * 2);
      this.sinceBack = -1;
      return this.move(this.level + 1);
    }
    this.slow = 0;
    if (this.level <= 0 || !this.win.roomy()) {
      this.fine = this.fineBusy = 0;
      return null;
    }
    this.fineBusy += this.win.busy;
    if (++this.fine < this.holdWindows || !climbFits(this.fineBusy / this.fine)) return null;
    this.sinceBack = 0;
    return this.move(this.level - 1);
  }

  /** Drop the window under way and its counts (outside a match, or a lost context's frames that drew nothing). */
  restart(): void {
    this.win.restart();
    this.lostMs = this.slow = this.fine = this.fineBusy = 0;
  }

  private move(to: number): number {
    this.level = to;
    this.restart();
    return to;
  }
}
