/**
 * The cage fit's plan raster and plan field (`rasterise`, `planFieldOf` in `cage-fields.ts`) in the skin kernel's module, the JS's
 * exact bits. The JS stays the reference and the fallback: until the module loads, both entries here write nothing and say so.
 * Each style gets one block of the module's memory for its triangle tables and its scratch (a style's fields all have one size, so
 * one block serves every car of it); a fit's inputs are copied in and the fields copied out, so the module keeps no car's state.
 */

import { skinKernel, type SkinKernel } from "../deform/skin-kernel.ts";
import type { CageFields, CageStyle } from "./car-cage.ts";

/** The most gone glass panes a cage reads openings for (a car has a windscreen and a rear screen). */
export const OPEN_MAX = 4;
/** Elements of the raster's params block (`cutY`, `cutX`, `cutZ`) and of its result block (`heightMax`, then `planBox`). */
const PARAMS = 3;
const RESULT = 5;

type Blocks = "tris" | "triGroup" | "pos" | "rawY" | "panelOn" | "open" | "params" | "res" | "top" | "bottom" | "covered" | "part" | "plan" | "toCovered" | "toUncovered" | "lf" | "ld" | "lz" | "lv";

/** One style's block: the byte address of each table and views over them (rebuilt when the memory grows and detaches its buffer). */
class CageTables {
  buf: ArrayBuffer | null = null;
  pos!: Float64Array;
  rawY!: Float64Array;
  panelOn!: Uint8Array;
  open!: Float64Array;
  params!: Float64Array;
  res!: Float64Array;
  top!: Float32Array;
  bottom!: Float32Array;
  covered!: Uint8Array;
  part!: Uint8Array;
  plan!: Float32Array;
  readonly at: Readonly<Record<Blocks, number>>;
  private readonly lens: { pos: number; open: number; nodes: number; panels: number };

  constructor(at: Readonly<Record<Blocks, number>>, lens: { pos: number; open: number; nodes: number; panels: number }) {
    this.at = at;
    this.lens = lens;
  }

  bind(buffer: ArrayBuffer): void {
    const { at, lens } = this;
    this.pos = new Float64Array(buffer, at.pos, lens.pos);
    this.rawY = new Float64Array(buffer, at.rawY, lens.pos / 3);
    this.panelOn = new Uint8Array(buffer, at.panelOn, lens.panels);
    this.open = new Float64Array(buffer, at.open, lens.open);
    this.params = new Float64Array(buffer, at.params, PARAMS);
    this.res = new Float64Array(buffer, at.res, RESULT);
    this.top = new Float32Array(buffer, at.top, lens.nodes);
    this.bottom = new Float32Array(buffer, at.bottom, lens.nodes);
    this.covered = new Uint8Array(buffer, at.covered, lens.nodes);
    this.part = new Uint8Array(buffer, at.part, lens.nodes);
    this.plan = new Float32Array(buffer, at.plan, lens.nodes);
    this.buf = buffer;
  }
}

/** Each style's block, placed on first use. */
const placed = new WeakMap<CageStyle, CageTables>();

/** The style's block with its views over the memory's current buffer, placed on first use. */
function tablesOf(k: SkinKernel, style: CageStyle, f: CageFields): CageTables {
  const hit = placed.get(style);
  if (hit !== undefined) {
    if (hit.buf !== k.ex.memory.buffer) hit.bind(k.ex.memory.buffer);
    return hit;
  }
  const openLength = OPEN_MAX * 4;
  const { nu, nv, tris, triGroup } = style;
  const nodes = nu * nv;
  const line = Math.max(nu, nv);
  let end = 0;
  const place = (bytes: number): number => {
    const at = end;
    end += (bytes + 7) & ~7;
    return at;
  };
  const off: Record<Blocks, number> = {
    tris: place(tris.byteLength),
    triGroup: place(triGroup.byteLength),
    pos: place(f.pos.byteLength),
    rawY: place(f.rawY.byteLength),
    panelOn: place(f.panelOn.byteLength),
    open: place(openLength * 8),
    params: place(PARAMS * 8),
    res: place(RESULT * 8),
    top: place(nodes * 4),
    bottom: place(nodes * 4),
    covered: place(nodes),
    part: place(nodes),
    plan: place(nodes * 4),
    toCovered: place(nodes * 8),
    toUncovered: place(nodes * 8),
    lf: place(line * 8),
    ld: place(line * 8),
    lz: place((line + 1) * 8),
    lv: place(line * 4),
  };
  const base = k.alloc(end);
  const at = { ...off };
  for (const key of Object.keys(at) as Blocks[]) at[key] += base;
  const bytes = new Uint8Array(k.ex.memory.buffer);
  bytes.set(new Uint8Array(tris.buffer, tris.byteOffset, tris.byteLength), at.tris);
  bytes.set(triGroup, at.triGroup);
  const t = new CageTables(at, { pos: f.pos.length, open: openLength, nodes, panels: f.panelOn.length });
  t.bind(k.ex.memory.buffer);
  placed.set(style, t);
  return t;
}

/**
 * `rasterise`'s loop in the kernel: `f.top`, `f.bottom`, `f.covered`, `f.part`, `f.heightMax` and `f.planBox` as the JS leaves them,
 * `f.planFresh` cleared. `open` holds the `opens` gone panes' plan boxes. False (nothing written) while the kernel is not loaded.
 */
export function rasteriseInKernel(style: CageStyle, f: CageFields, panelOn: Uint8Array, opens: number, open: Float64Array, margin: number, lidMargin: number, cutY: number, cutX: number, cutZ: number): boolean {
  const k = skinKernel();
  if (k === null) return false;
  const t = tablesOf(k, style, f);
  t.pos.set(f.pos);
  t.rawY.set(f.rawY);
  t.panelOn.set(panelOn);
  t.open.set(open);
  t.params[0] = cutY;
  t.params[1] = cutX;
  t.params[2] = cutZ;
  const a = t.at;
  k.ex.cage_rasterise(style.nu, style.nv, style.step, style.u0, style.v0, margin, lidMargin, style.triCount, style.panelCount + 1, style.partGroup, opens, a.tris, a.triGroup, a.pos, a.rawY, a.panelOn, a.open, a.params, a.top, a.bottom, a.covered, a.part, a.res);
  f.top.set(t.top);
  f.bottom.set(t.bottom);
  f.covered.set(t.covered);
  f.part.set(t.part);
  f.heightMax = t.res[0]!;
  f.planFresh = false;
  f.planBox[0] = t.res[1]!;
  f.planBox[1] = t.res[2]!;
  f.planBox[2] = t.res[3]!;
  f.planBox[3] = t.res[4]!;
  return true;
}

/** `planFieldOf`'s passes in the kernel: `f.plan` as the JS leaves it, `f.planFresh` set. False (nothing written) while the kernel is not loaded. */
export function planFieldInKernel(style: CageStyle, f: CageFields): boolean {
  const k = skinKernel();
  if (k === null) return false;
  const t = tablesOf(k, style, f);
  t.covered.set(f.covered);
  const a = t.at;
  k.ex.plan_field(style.nu, style.nv, style.step, a.covered, a.plan, a.toCovered, a.toUncovered, a.lf, a.ld, a.lz, a.lv);
  f.plan.set(t.plan);
  f.planFresh = true;
  return true;
}
