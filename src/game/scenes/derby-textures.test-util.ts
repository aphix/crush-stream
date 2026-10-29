import type * as THREE from "three";
import { must } from "../kernel/must.test-util.ts";

/** The texel bytes of a texture built in memory (red, green, blue, alpha per texel); fails the test if it carries none. */
export function pixelsOf(texture: THREE.DataTexture) {
  const { data } = texture.image;
  must(data, "texture carries pixel data");
  return data;
}
