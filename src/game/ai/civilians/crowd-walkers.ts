import { WALKER_CAPACITY } from "./civilian-crowd-constants.ts";

/** The bodies on foot the crowd makes room for, refilled by the engine before each crowd step: players, who can shove a civilian, and bodies that give no way but never shove (the law's foot cops). */
export class CrowdWalkers {
  count = 0;
  readonly x = new Float32Array(WALKER_CAPACITY);
  readonly z = new Float32Array(WALKER_CAPACITY);
  readonly velocityX = new Float32Array(WALKER_CAPACITY);
  readonly velocityZ = new Float32Array(WALKER_CAPACITY);
  readonly shoves = new Uint8Array(WALKER_CAPACITY);

  clear(): void {
    this.count = 0;
  }

  /** A player on foot: a shove of his is a push event. */
  add(x: number, z: number, velocityX: number, velocityZ: number): void {
    this.place(x, z, velocityX, velocityZ, 1);
  }

  /** A body civilians step round and may bump, but whose contact is no push event. */
  addBody(x: number, z: number, velocityX: number, velocityZ: number): void {
    this.place(x, z, velocityX, velocityZ, 0);
  }

  private place(x: number, z: number, velocityX: number, velocityZ: number, shoves: number): void {
    if (this.count === WALKER_CAPACITY) return;
    this.x[this.count] = x;
    this.z[this.count] = z;
    this.velocityX[this.count] = velocityX;
    this.velocityZ[this.count] = velocityZ;
    this.shoves[this.count++] = shoves;
  }
}
