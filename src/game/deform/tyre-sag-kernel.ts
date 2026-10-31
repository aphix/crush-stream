/**
 * The tyre hold's sag pass (`liftSaggingTriangles`, `car-tyre-skin.ts`) in Rust -> WASM (`kernels/skin`, `tyre.rs`), the JS's exact bits.
 * Each call copies its inputs into one scratch arena shared by every car and its results out; the arena holds a skin only weakly, so a rebuilt car leaks nothing.
 */

/** WebAssembly page size (bytes): the memory grows in whole pages. */
export const WASM_PAGE_BYTES = 65536;

/** A tyre's size at scale 1 (m): `CarFrame["rig"]["tyre"]`. */
interface TyreSize {
  r: number;
  halfW: number;
}

/** What a sag pass reads of one skin and writes back: the `TyreSkin`'s own arrays, by reference (its per-wheel arrays are filled in place). */
export interface SagSkin {
  /** Moved by every hold before its sag passes: while it stands, the skin's positions and its tables below are as the arena last copied them. */
  serial: number;
  weld: Int32Array;
  /** Per vertex, bit w: it rests over wheel w's tyre (`over[w]` is not NaN). */
  liftable: Uint8Array;
  /** Per vertex, 1: the pass never reads a triangle with it (a wheel well's liner). */
  sagFree: Uint8Array;
  rest: Float32Array;
  lift: Float32Array;
  dirty: Uint8Array;
  overTris: readonly Int32Array[];
  sagRead: readonly Float32Array[];
  /** Per wheel, its axle then its hub in the mesh's frame (`HELD_ELEMENTS` long each). */
  heldAt: Float64Array;
  /** Per wheel, its hub when the rest skin's clearances are read, and (element 2) the wheel scale they are read at. */
  restHub: Float64Array;
  restScale: Float64Array;
  /** The shares of the tyre's radius out along the road the top is read whole to and not past. */
  sagTop: Float64Array;
  /** Per wheel, the share of its hold it keeps: under 1 while a torn-off wheel leaves its seat. */
  fade: Float64Array;
}

export type TyreSagExports = {
  memory: WebAssembly.Memory;
  sag_pass: (...args: number[]) => number;
};

type Lanes = Float32Array | Float64Array | Int32Array | Uint8Array;
interface LaneKind<T extends Lanes> {
  readonly BYTES_PER_ELEMENT: number;
  new (buffer: ArrayBuffer, byteOffset: number, length: number): T;
}

/** One block of the arena: `cap` elements at byte address `at`, `view` over them (rebound when the memory's buffer is replaced). */
class Scratch<T extends Lanes> {
  at = 0;
  cap = 0;
  /** The capacity the next `settle` gives it, when above `cap`. */
  want = 0;
  view: T;
  private readonly kind: LaneKind<T>;

  constructor(kind: LaneKind<T>) {
    this.kind = kind;
    this.view = new kind(new ArrayBuffer(0), 0, 0);
  }

  get bytes(): number {
    return (this.cap * this.kind.BYTES_PER_ELEMENT + 7) & ~7;
  }

  bind(buffer: ArrayBuffer): void {
    this.view = new this.kind(buffer, this.at, this.cap);
  }
}

/** Elements of the job block (`tyre.rs` `JOB_*`): the wheel's axle and hub, the tyre's size, the rest hub and scale, the wheel's index, the top's extent, the hold's share. */
const SAG_JOB = { held: 0, tyreR: 6, tyreHalfW: 7, restHub: 8, restScale: 11, wheel: 12, topFull: 13, topNone: 14, fade: 15 } as const;
const JOB_LENGTH = 16;
const HELD_LENGTH = 6;

export class TyreSagArena {
  private readonly ex: TyreSagExports;
  private buf: ArrayBuffer | null = null;
  private readonly pos = new Scratch(Float32Array);
  private readonly rest = new Scratch(Float32Array);
  private readonly weld = new Scratch(Int32Array);
  private readonly liftable = new Scratch(Uint8Array);
  private readonly sagFree = new Scratch(Uint8Array);
  private readonly tris = new Scratch(Int32Array);
  private readonly lift = new Scratch(Float32Array);
  /** The pass's per-point bump: zero between calls, which the arena keeps because the kernel zeroes what it sets. */
  private readonly bump = new Scratch(Float32Array);
  private readonly dirty = new Scratch(Uint8Array);
  private readonly read = new Scratch(Float32Array);
  private readonly job = new Scratch(Float64Array);
  private readonly blocks = [this.pos, this.rest, this.weld, this.liftable, this.sagFree, this.tris, this.lift, this.bump, this.dirty, this.read, this.job];
  /** The skin whose positions and tables the arena holds (weakly), and its `serial` then; NaN: none. */
  private loaded: WeakRef<SagSkin> | null = null;
  private loadedSerial = NaN;

  constructor(ex: TyreSagExports) {
    this.ex = ex;
    this.job.want = JOB_LENGTH;
  }

  /**
   * One read of wheel `wheel`'s tyre against the skin's triangles over it (`liftSaggingTriangles`, `again`: an earlier pass of this hold read them):
   * `skin.lift`, `skin.dirty` and `skin.sagRead[wheel]` as the JS leaves them. True when any corner was lifted.
   */
  sagPass(skin: SagSkin, pos: Float32Array, wheel: number, again: boolean, tyre: TyreSize): boolean {
    const tris = skin.overTris[wheel]!;
    this.room(skin, pos, tris);
    if (skin.serial !== this.loadedSerial || this.loaded?.deref() !== skin) {
      this.pos.view.set(pos);
      this.rest.view.set(skin.rest);
      this.weld.view.set(skin.weld);
      this.liftable.view.set(skin.liftable);
      this.sagFree.view.set(skin.sagFree);
      if (this.loaded?.deref() !== skin) this.loaded = new WeakRef(skin);
      this.loadedSerial = skin.serial;
    }
    this.tris.view.set(tris);
    this.lift.view.set(skin.lift);
    this.dirty.view.set(skin.dirty);
    if (again) this.read.view.set(skin.sagRead[wheel]!);
    const job = this.job.view;
    for (let k = 0; k < HELD_LENGTH; k++) job[SAG_JOB.held + k] = skin.heldAt[wheel * HELD_LENGTH + k]!;
    job[SAG_JOB.tyreR] = tyre.r;
    job[SAG_JOB.tyreHalfW] = tyre.halfW;
    for (let k = 0; k < 3; k++) job[SAG_JOB.restHub + k] = skin.restHub[wheel * 3 + k]!;
    job[SAG_JOB.restScale] = skin.restScale[2]!;
    job[SAG_JOB.wheel] = wheel;
    job[SAG_JOB.topFull] = skin.sagTop[0]!;
    job[SAG_JOB.topNone] = skin.sagTop[1]!;
    job[SAG_JOB.fade] = skin.fade[wheel]!;
    const raised =
      this.ex.sag_pass(this.pos.at, this.rest.at, this.weld.at, this.liftable.at, this.sagFree.at, this.tris.at, tris.length, this.lift.at, this.bump.at, this.dirty.at, this.read.at, again ? 1 : 0, this.job.at) !== 0;
    skin.sagRead[wheel]!.set(this.read.view.subarray(0, tris.length));
    if (!raised) return false;
    skin.lift.set(this.lift.view.subarray(0, skin.lift.length));
    skin.dirty.set(this.dirty.view.subarray(0, skin.dirty.length));
    return true;
  }

  /** Room for a pass: the arena moves only here. */
  private room(skin: SagSkin, pos: Float32Array, tris: Int32Array): void {
    this.want(this.pos, pos.length);
    this.want(this.rest, skin.rest.length);
    this.want(this.weld, skin.weld.length);
    this.want(this.liftable, skin.liftable.length);
    this.want(this.sagFree, skin.sagFree.length);
    this.want(this.tris, tris.length);
    this.want(this.lift, skin.lift.length);
    this.want(this.bump, skin.lift.length);
    this.want(this.dirty, skin.dirty.length);
    this.want(this.read, tris.length);
    this.settle();
  }

  private want(block: Scratch<Lanes>, n: number): void {
    if (n > block.cap && n > block.want) block.want = Math.max(n, 2 * block.cap);
  }

  /** Gives every block the room asked for (all at once, in new pages at the memory's end: the old ones are left, bounded by the doubling), and rebinds the views when the memory's buffer was replaced. */
  private settle(): void {
    const mem = this.ex.memory;
    if (this.blocks.some((b) => b.want > b.cap)) {
      let end = mem.buffer.byteLength;
      const base = end;
      for (const b of this.blocks) {
        b.cap = Math.max(b.cap, b.want);
        b.at = end;
        end += b.bytes;
      }
      mem.grow(Math.ceil((end - base) / WASM_PAGE_BYTES));
      this.buf = null;
      this.loadedSerial = NaN;
    }
    if (this.buf === mem.buffer) return;
    for (const b of this.blocks) b.bind(mem.buffer);
    this.buf = mem.buffer;
  }
}
