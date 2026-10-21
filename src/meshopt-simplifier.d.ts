/** What the game reads of `three/addons/libs/meshopt_simplifier.module.js` (`@types/three` has no types for it). */
declare module "three/addons/libs/meshopt_simplifier.module.js" {
  export const MeshoptSimplifier: {
    readonly ready: Promise<void>;
    simplify<T extends Uint16Array | Uint32Array>(indices: T, positions: Float32Array, stride: number, targetIndexCount: number, targetError: number): [T, number];
  };
}
