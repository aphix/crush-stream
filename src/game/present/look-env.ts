import * as THREE from "three";

/** The studio environment every FX tier lights the cars with (`scripts/bake-env.mjs` bakes it from three's RoomEnvironment). */
export const STUDIO_ENV_URL = `${import.meta.env?.BASE_URL ?? "/"}env-studio.hdr`;

/** An RGBE file's pixels as `hdr-worker.ts` answers them: RGBA half floats, rows top first. */
export type HdrPixels = { data: Uint16Array; width: number; height: number };

/**
 * One Radiance RGBE equirect (linear radiance, so highlights above 1 survive) downloaded, decoded to half float in a worker
 * (`hdr-worker.ts`) and prefiltered to a PMREM texture for `scene.environment`. The caller owns the result and disposes it. Null
 * when the download or the decode fails, or `stillWanted()` says so after them (the renderer was disposed meanwhile).
 */
export async function loadHdrEnv(renderer: THREE.WebGLRenderer, url: string = STUDIO_ENV_URL, stillWanted: () => boolean = () => true): Promise<THREE.Texture | null> {
  const file = await download(url);
  const pixels = file === null ? null : await decodeInWorker(file);
  if (pixels === null || !stillWanted()) return null;
  const equirect = new THREE.DataTexture(pixels.data, pixels.width, pixels.height, THREE.RGBAFormat, THREE.HalfFloatType);
  equirect.colorSpace = THREE.LinearSRGBColorSpace;
  equirect.minFilter = equirect.magFilter = THREE.LinearFilter;
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.needsUpdate = true;
  const gen = new THREE.PMREMGenerator(renderer);
  const env = gen.fromEquirectangular(equirect).texture;
  equirect.dispose();
  gen.dispose();
  return env;
}

/** The file's bytes; null when the server answers an error or the network fails (`fetch` rejects with a TypeError). */
async function download(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch (err) {
    if (err instanceof TypeError) return null;
    throw err;
  }
}

/** One worker per file, ended once it answers; null, logged, when the worker fails (it threw, or its script did not load). */
async function decodeInWorker(file: ArrayBuffer): Promise<HdrPixels | null> {
  const worker = new Worker(new URL("./hdr-worker.ts", import.meta.url), { type: "module" });
  try {
    // Executor form: the tsconfig lib predates `Promise.withResolvers`.
    return await new Promise<HdrPixels | null>((resolve) => {
      worker.onmessage = (event: MessageEvent<HdrPixels>) => resolve(event.data);
      worker.onerror = (event) => {
        console.error("Crush Stream HDR decode failed", event.message);
        resolve(null);
      };
      worker.postMessage(file, [file]);
    });
  } finally {
    worker.terminate();
  }
}
