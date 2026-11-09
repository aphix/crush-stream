import { WALKER_CAPACITY } from "./civilian-crowd-constants.ts";

/** The players on foot the crowd makes room for and can be pushed by: refilled by the engine before each crowd step. */
export class CrowdWalkers {
  count = 0;
  readonly x = new Float32Array(WALKER_CAPACITY);
  readonly z = new Float32Array(WALKER_CAPACITY);
  readonly velocityX = new Float32Array(WALKER_CAPACITY);
  readonly velocityZ = new Float32Array(WALKER_CAPACITY);

  clear(): void {
    this.count = 0;
  }

  add(x: number, z: number, velocityX: number, velocityZ: number): void {
    if (this.count === WALKER_CAPACITY) return;
    this.x[this.count] = x;
    this.z[this.count] = z;
    this.velocityX[this.count] = velocityX;
    this.velocityZ[this.count++] = velocityZ;
  }
}
