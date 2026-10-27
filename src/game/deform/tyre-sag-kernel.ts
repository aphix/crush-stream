/**
 * The tyre hold's `planGrid` and sag pass (`liftSaggingTriangles`, `car-tyre-skin.ts`) in Rust -> WASM (`kernels/skin`, `tyre.rs`), the JS's exact bits.
 * Nothing outlives a call: each copies its inputs into one scratch arena shared by every car and its results out, so a rebuilt car leaks nothing.
 */

/** WebAssembly page size (bytes): the memory grows in whole pages. */
export const WASM_PAGE_BYTES = 65536;

/** Triangles filed by plan cell: per triangle (`overTris` order) its plan box (x low, x high, z low, z high) and plan determinant, and per cell the triangles whose box meets it, in order. */
export type PlanGrid = { box: Float64Array; den: Float64Array; x0: number; z0: number; nx: number; nz: number; start: Int32Array; tris: Int32Array };

/** A tyre's size at scale 1 (m): `CarFrame["rig"]["tyre"]`. */
interface TyreSize {
  r: number;
  halfW: number;
}

/** What a sag pass reads of one skin and writes back: the `TyreSkin`'s own arrays, by reference (its per-wheel arrays are filled in place). */
export interface SagSkin {
  weld: Int32Array;
  /** Per vertex, bit w: it rests over wheel w's tyre (`over[w]` is not NaN). */
  liftable: Uint8Array;
  lift: Float32Array;
  dirty: Uint8Array;
  overTris: readonly Int32Array[];
  plans: readonly PlanGrid[];
  sagRead: readonly Float32Array[];
  /** Per wheel, its axle then its hub in the mesh's frame (`HELD_ELEMENTS` long each). */
  heldAt: Float64Array;
}

export type TyreSagExports = {
  memory: WebAssembly.Memory;
  plan_grid: (...args: number[]) => number;
  sag_look: (...args: number[]) => number;
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

/** Elements of the job block: `plan_grid`'s header out (x0, z0, nx, nz, filed length, start and filed length needed), `sag_pass`'s in (`tyre.rs`). */
const JOB_LENGTH = 16;
const PLAN_HEADER = { x0: 0, z0: 1, nx: 2, nz: 3, filed: 4, startNeeded: 5, filedNeeded: 6 } as const;
const SAG_JOB = { held: 0, tyreR: 6, tyreHalfW: 7, x0: 8, z0: 9, nx: 10, nz: 11, wheel: 12 } as const;
const HELD_LENGTH = 6;
const PLAN_STATUS = { ok: 0, short: 1, declined: 2 } as const;
/** A typical plan grid's cell and filed counts: the first call's room, so it is not found short. */
const PLAN_START_TYPICAL = 4096;
const PLAN_FILED_TYPICAL = 32768;
/** Numbers a `sag_pass` record holds per triangle (`RECORD_LEN`, `tyre.rs`). */
const SAG_RECORD_LENGTH = 11;
/** The tyre top's samples (`SAG_COUNT`, `tyre.rs`): `sag_look` writes their x, z and y here for `sag_pass`. */
const SAG_SAMPLE_COUNT = 195;
/** The bits of `sag_look`'s return (`LOOK_CLEAR`, `LOOK_FINITE`, `tyre.rs`): `sag_pass` reads the whole of it. */
const SAG_LOOK = { clear: 1, finite: 2 } as const;

export class TyreSagArena {
  private readonly ex: TyreSagExports;
  private buf: ArrayBuffer | null = null;
  private readonly pos = new Scratch(Float32Array);
  private readonly weld = new Scratch(Int32Array);
  private readonly liftable = new Scratch(Uint8Array);
  private readonly tris = new Scratch(Int32Array);
  private readonly box = new Scratch(Float64Array);
  private readonly den = new Scratch(Float64Array);
  private readonly start = new Scratch(Int32Array);
  private readonly filed = new Scratch(Int32Array);
  private readonly lift = new Scratch(Float32Array);
  /** The pass's per-point bump: zero between calls, which the arena keeps because the kernel zeroes what it sets. */
  private readonly bump = new Scratch(Float32Array);
  private readonly dirty = new Scratch(Uint8Array);
  private readonly read = new Scratch(Float32Array);
  private readonly job = new Scratch(Float64Array);
  /** The pass's per-triangle scratch (`SAG_RECORD_LENGTH` numbers each). */
  private readonly records = new Scratch(Float64Array);
  private readonly samples = new Scratch(Float64Array);
  /** Per triangle, whether the pass has filled its record yet (the kernel zeroes it each pass). */
  private readonly built = new Scratch(Uint8Array);
  private readonly blocks = [this.pos, this.weld, this.liftable, this.tris, this.box, this.den, this.start, this.filed, this.lift, this.bump, this.dirty, this.read, this.job, this.records, this.built, this.samples];

  constructor(ex: TyreSagExports) {
    this.ex = ex;
    this.job.want = JOB_LENGTH;
    this.samples.want = 3 * SAG_SAMPLE_COUNT;
  }

  /** `tris` (corners, three a triangle) of the skin `pos` filed by plan cell, or null when the kernel leaves it to the JS (no triangles, or an extent that is no sane grid). */
  planGrid(pos: Float32Array, tris: Int32Array): PlanGrid | null {
    const count = tris.length / 3;
    this.want(this.pos, pos.length);
    this.want(this.tris, tris.length);
    this.want(this.box, count * 4);
    this.want(this.den, count);
    this.want(this.start, PLAN_START_TYPICAL);
    this.want(this.filed, PLAN_FILED_TYPICAL);
    for (;;) {
      this.settle();
      this.pos.view.set(pos);
      this.tris.view.set(tris);
      const status = this.ex.plan_grid(this.pos.at, this.tris.at, count, this.box.at, this.den.at, this.start.at, this.start.cap, this.filed.at, this.filed.cap, this.job.at);
      if (status === PLAN_STATUS.declined) return null;
      const h = this.job.view;
      if (status === PLAN_STATUS.ok) {
        const cells = h[PLAN_HEADER.nx]! * h[PLAN_HEADER.nz]!;
        return {
          box: this.box.view.slice(0, count * 4),
          den: this.den.view.slice(0, count),
          x0: h[PLAN_HEADER.x0]!,
          z0: h[PLAN_HEADER.z0]!,
          nx: h[PLAN_HEADER.nx]!,
          nz: h[PLAN_HEADER.nz]!,
          start: this.start.view.slice(0, cells + 1),
          tris: this.filed.view.slice(0, h[PLAN_HEADER.filed]!),
        };
      }
      this.want(this.start, h[PLAN_HEADER.startNeeded]!);
      this.want(this.filed, h[PLAN_HEADER.filedNeeded]!);
    }
  }

  /** One read of wheel `wheel`'s tyre against the skin's triangles over it (`liftSaggingTriangles`): `skin.lift`, `skin.dirty` and `skin.sagRead[wheel]` as the JS leaves them. True when any corner was lifted. */
  sagPass(skin: SagSkin, pos: Float32Array, wheel: number, tyre: TyreSize): boolean {
    const tris = skin.overTris[wheel]!;
    const plan = skin.plans[wheel]!;
    this.roomForSagPass(skin, pos, tris, plan);
    this.pos.view.set(pos);
    this.weld.view.set(skin.weld);
    this.tris.view.set(tris);
    this.lift.view.set(skin.lift);
    const job = this.job.view;
    for (let k = 0; k < HELD_LENGTH; k++) job[SAG_JOB.held + k] = skin.heldAt[wheel * HELD_LENGTH + k]!;
    job[SAG_JOB.tyreR] = tyre.r;
    job[SAG_JOB.tyreHalfW] = tyre.halfW;
    const look = this.ex.sag_look(this.pos.at, this.weld.at, this.tris.at, tris.length, this.lift.at, this.read.at, this.samples.at, this.job.at);
    skin.sagRead[wheel]!.set(this.read.view.subarray(0, tris.length));
    if (look & SAG_LOOK.clear) return false;
    this.loadPlan(skin, plan, wheel);
    const raised =
      this.ex.sag_pass(
        this.pos.at,
        this.weld.at,
        this.liftable.at,
        this.tris.at,
        tris.length,
        this.box.at,
        this.den.at,
        this.start.at,
        this.filed.at,
        this.lift.at,
        this.bump.at,
        this.dirty.at,
        this.records.at,
        this.built.at,
        this.samples.at,
        this.job.at,
        look,
      ) !== 0;
    if (!raised) return false;
    skin.lift.set(this.lift.view.subarray(0, skin.lift.length));
    skin.dirty.set(this.dirty.view.subarray(0, skin.dirty.length));
    return true;
  }

  /** Room for both calls of a pass at once: the arena moves only here, so what the first call left stands for the second. */
  private roomForSagPass(skin: SagSkin, pos: Float32Array, tris: Int32Array, plan: PlanGrid): void {
    this.want(this.pos, pos.length);
    this.want(this.weld, skin.weld.length);
    this.want(this.liftable, skin.liftable.length);
    this.want(this.tris, tris.length);
    this.want(this.box, plan.box.length);
    this.want(this.den, plan.den.length);
    this.want(this.start, plan.start.length);
    this.want(this.filed, plan.tris.length);
    this.want(this.lift, skin.lift.length);
    this.want(this.bump, skin.lift.length);
    this.want(this.dirty, skin.dirty.length);
    this.want(this.read, tris.length);
    this.want(this.records, (tris.length / 3) * SAG_RECORD_LENGTH);
    this.want(this.built, tris.length / 3);
    this.settle();
  }

  /** Copies the plan and the skin's marks that only `sag_pass` reads into the arena. */
  private loadPlan(skin: SagSkin, plan: PlanGrid, wheel: number): void {
    this.liftable.view.set(skin.liftable);
    this.box.view.set(plan.box);
    this.den.view.set(plan.den);
    this.start.view.set(plan.start);
    this.filed.view.set(plan.tris);
    this.dirty.view.set(skin.dirty);
    const job = this.job.view;
    job[SAG_JOB.x0] = plan.x0;
    job[SAG_JOB.z0] = plan.z0;
    job[SAG_JOB.nx] = plan.nx;
    job[SAG_JOB.nz] = plan.nz;
    job[SAG_JOB.wheel] = wheel;
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
    }
    if (this.buf === mem.buffer) return;
    for (const b of this.blocks) b.bind(mem.buffer);
    this.buf = mem.buffer;
  }
}
