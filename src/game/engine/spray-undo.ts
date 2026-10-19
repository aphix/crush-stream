import type { SprayBitmap } from "../present/spray.ts";

/** Steps a chain keeps: a step is 4 bytes a texel it changed (index u16, ink before, ink after), so 100 strokes that each repaint all 16 384 texels stay under 6.5 MiB a bitmap. */
const UNDO_DEPTH = 100;

/** One step: the texels it changed (index, ink before, ink after) and the bitmap's inks either side. */
type Step = { readonly at: Uint16Array; readonly was: Uint8Array; readonly now: Uint8Array; readonly inksWas: readonly number[]; readonly inksNow: readonly number[] };

/**
 * One spray bitmap's undo and redo chains for a garage visit: `begin` before a change (a stroke, a clear) and `commit` after
 * it keep what changed as one step; a new step drops the redo chain.
 */
export class SprayUndo {
  private readonly bitmap: SprayBitmap;
  private readonly before: Uint8Array;
  private inksBefore: readonly number[] = [];
  private readonly undos: Step[] = [];
  private readonly redos: Step[] = [];

  constructor(bitmap: SprayBitmap) {
    this.bitmap = bitmap;
    this.before = new Uint8Array(bitmap.texels.length);
  }

  get undoable(): number {
    return this.undos.length;
  }

  get redoable(): number {
    return this.redos.length;
  }

  begin(): void {
    this.before.set(this.bitmap.texels);
    this.inksBefore = [...this.bitmap.palette];
  }

  commit(): void {
    const { texels, palette } = this.bitmap;
    let n = 0;
    for (let i = 0; i < texels.length; i++) if (texels[i] !== this.before[i]) n++;
    if (n === 0) return;
    const step: Step = { at: new Uint16Array(n), was: new Uint8Array(n), now: new Uint8Array(n), inksWas: this.inksBefore, inksNow: [...palette] };
    for (let i = 0, k = 0; i < texels.length; i++) {
      if (texels[i] === this.before[i]) continue;
      step.at[k] = i;
      step.was[k] = this.before[i]!;
      step.now[k++] = texels[i]!;
    }
    if (this.undos.push(step) > UNDO_DEPTH) this.undos.shift();
    this.redos.length = 0;
  }

  /** The last step taken back; false with none to undo. */
  undo(): boolean {
    const step = this.undos.pop();
    if (!step) return false;
    this.bitmap.restore(step.at, step.was, step.inksWas);
    this.redos.push(step);
    return true;
  }

  /** The last step undone made again; false with none to redo. */
  redo(): boolean {
    const step = this.redos.pop();
    if (!step) return false;
    this.bitmap.restore(step.at, step.now, step.inksNow);
    this.undos.push(step);
    return true;
  }
}
