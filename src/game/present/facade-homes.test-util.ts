import { texelOfShare } from "./facade-homes.ts";

/** The share of windows a texel number stands for: the inverse of `texelOfShare`, and what the facade shader does with the red it reads (`facadeShareGlsl`). */
export const shareOfTexel = (texel: number): number => (texel - texelOfShare(0)) / (texelOfShare(1) - texelOfShare(0));
