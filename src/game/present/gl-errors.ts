/** WebGL keeps one flag per error kind (six, context loss included); `getError` returns each set flag once. */
const ERROR_KINDS = 6;

/**
 * The WebGL error flags read since load. `getError` waits for the GPU process, a frame's stall, so it is read only at an FX tier
 * switch and when a submission is sent: a flag stays set until read, so none is missed, but one repeated between reads counts once.
 */
export class GlErrors {
  count = 0;
  /** The newest flag read (1282 is GL_INVALID_OPERATION); 0 before any. */
  last = 0;

  read(gl: Pick<WebGLRenderingContext, "getError" | "NO_ERROR">): void {
    for (let kind = 0; kind < ERROR_KINDS; kind++) {
      const flag = gl.getError();
      if (flag === gl.NO_ERROR) return;
      this.count++;
      this.last = flag;
    }
  }
}
