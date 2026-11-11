import type * as THREE from "three";
import { hypot2 } from "../kernel/physics-core.js";

/** Trees draw whole inside this distance (m) of the eye, as a trunk and canopy lumps beyond it, by device class. */
export const TREE_NEAR_M = { desktop: 70, phone: 45 } as const;
/** The rowhome kit's small pieces (shutters, air-conditioners, decks, window boxes, roof pieces) draw inside this distance (m), by device class. */
export const KIT_DETAIL_M = { desktop: 90, phone: 60 } as const;
/** A cell flips back only this far (m) past the distance it flipped at, so an eye standing on the edge does not flicker. */
export const BAND_HYSTERESIS_M = 8;

/** One draw cell: its centre and width (m), its near mesh and its far one (null: nothing draws beyond the band). */
export type BandCell = { x: number; z: number; size: number; near: THREE.Object3D; far: THREE.Object3D | null };

/** Switches each cell between its near and far mesh by the eye's distance to the cell's nearest point. */
export class FarBand {
  private readonly cells: readonly BandCell[];
  private readonly nearM: number;
  private readonly isNear: Uint8Array;

  constructor(cells: readonly BandCell[], nearM: number) {
    this.cells = cells;
    this.nearM = nearM;
    this.isNear = new Uint8Array(cells.length).fill(1);
  }

  frame(eyeX: number, eyeZ: number): void {
    const cells = this.cells;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const half = c.size / 2;
      const d = hypot2(Math.max(Math.abs(eyeX - c.x) - half, 0), Math.max(Math.abs(eyeZ - c.z) - half, 0));
      const was = this.isNear[i] === 1;
      const near = was ? d <= this.nearM + BAND_HYSTERESIS_M : d < this.nearM;
      if (near === was) continue;
      this.isNear[i] = near ? 1 : 0;
      c.near.visible = near;
      if (c.far !== null) c.far.visible = !near;
    }
  }

  /** Every near mesh shows and every far one hides again. */
  stop(): void {
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]!;
      this.isNear[i] = 1;
      c.near.visible = true;
      if (c.far !== null) c.far.visible = false;
    }
  }
}
