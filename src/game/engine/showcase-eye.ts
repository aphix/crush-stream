/** The eye stands this long (s) before its pose goes into the URL. */
const STOP_S = 0.4;

/** Tells when the showcase's free eye has stopped: still for `STOP_S` since it last moved, at a pose the URL does not show yet. */
export class EyeStop {
  private shown: string | null = null;
  private seen = "";
  private still = 0;

  /** Forget the eye: the next frame's pose is the one the URL already shows (entering the scene). */
  reset(): void {
    this.shown = null;
  }

  /** One frame at pose `cam` (`camOf`): `cam` once, as the eye comes to rest at a new pose, else null. */
  frame(cam: readonly number[], wallDt: number): readonly number[] | null {
    const text = cam.map((n) => Math.round(n * 1e3)).join(",");
    if (this.shown === null) this.shown = text;
    if (text !== this.seen) {
      this.seen = text;
      this.still = 0;
      return null;
    }
    this.still += wallDt;
    if (this.still < STOP_S || text === this.shown) return null;
    this.shown = text;
    return cam;
  }
}
