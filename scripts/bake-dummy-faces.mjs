#!/usr/bin/env node
// Bakes the people's faces from the look reference's crops in assets-src/faces/ into src/game/present/dummy-faces.ts: each
// face cropped and scaled so its eyes and lip land where the dummy's head has them, as base64-packed sRGB rows.
//
//   node scripts/bake-dummy-faces.mjs
//
// Needs ffmpeg on the PATH (it decodes, crops and scales the PNGs). A crop's transparent pixels take the face's skin.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EYE_U, EYES_AT, FACE_SPAN, LIP_AT } from "../src/game/present/dummy-head.ts";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = join(ROOT, "assets-src", "faces");
const OUT = join(ROOT, "src", "game", "present", "dummy-faces.ts");
/** Texels on a side of one face. */
const TEXELS = 64;
/** Where the cheeks are sampled for the skin (u, v): under the eyes, beside the nose. */
const CHEEKS = [[0.3, 0.42], [0.7, 0.42]];
const CHEEK_HALF = 2;
/**
 * The reference's light is taken out of each face so the game's light and the face's relief shade it: each texel over its
 * neighbourhood's brightness (a blur `DELIGHT_SIGMA` texels wide), `DELIGHT` of the way; brows, eyes and lips keep their own.
 */
const DELIGHT_SIGMA = 5;
const DELIGHT = 0.7;
/** No texel is lifted more than this: a dark patch (the cap man's glasses) stays dark. */
const DELIGHT_MOST = 1.5;

/** `rgb`'s broad shading flattened toward `skin`'s brightness. */
function delight(rgb, skin) {
  const kernel = Array.from({ length: 6 * DELIGHT_SIGMA + 1 }, (_, k) => Math.exp(-(((k - 3 * DELIGHT_SIGMA) / DELIGHT_SIGMA) ** 2) / 2));
  const blurAlong = (from, step) =>
    Float64Array.from({ length: TEXELS * TEXELS }, (_, p) => {
      const [x, y] = [p % TEXELS, Math.floor(p / TEXELS)];
      let [sum, weight] = [0, 0];
      for (const [k, w] of kernel.entries()) {
        const [sx, sy] = step === 1 ? [x + k - 3 * DELIGHT_SIGMA, y] : [x, y + k - 3 * DELIGHT_SIGMA];
        if (sx < 0 || sy < 0 || sx >= TEXELS || sy >= TEXELS) continue;
        sum += w * from[sy * TEXELS + sx];
        weight += w;
      }
      return sum / weight;
    });
  const brightness = Float64Array.from({ length: TEXELS * TEXELS }, (_, p) => 0.2126 * rgb[p * 3] + 0.7152 * rgb[p * 3 + 1] + 0.0722 * rgb[p * 3 + 2]);
  const blurred = blurAlong(blurAlong(brightness, 1), TEXELS);
  const target = 0.2126 * skin[0] + 0.7152 * skin[1] + 0.0722 * skin[2];
  for (let p = 0; p < TEXELS * TEXELS; p++) {
    const gain = Math.min(DELIGHT_MOST, (target / blurred[p]) ** DELIGHT);
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.min(255, Math.round(rgb[p * 3 + c] * gain));
  }
}

/**
 * Each face: its crop's pupils (left and right in the picture) and the middle of its mouth, in source pixels, measured by eye,
 * and its gain (linear r, g, b) solved so it reads as the reference's face under the showcase's light.
 */
const FACES = [
  { name: "MAN", file: "man.png", eyes: [[91.6, 42.6], [114.4, 42.6]], mouth: [102.4, 65.6], gain: [1, 1.145, 1.258] },
  { name: "WOMAN", file: "woman.png", eyes: [[88, 44], [109.4, 44]], mouth: [98.4, 65.6], gain: [0.913, 0.944, 1.027] },
  { name: "CAP_MAN", file: "cap-man.png", eyes: [[90.5, 49], [113.5, 49]], mouth: [102, 71], gain: [1.188, 1.296, 1.519] },
  { name: "PRESIDENT", file: "president.png", eyes: [[111, 46], [137, 46]], mouth: [124, 69.6], gain: [0.666, 0.715, 0.701] },
  { name: "ELDER", file: "elder.png", eyes: [[84.2, 34.7], [102.3, 34.7]], mouth: [93.2, 47.3], gain: [1, 1, 1] },
  { name: "COP", file: "cop.png", eyes: [[116, 44], [141, 44]], mouth: [127, 69.6], gain: [0.99, 1, 1.139] },
];

const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (l) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

const eyeV = EYES_AT / FACE_SPAN;
const lipV = LIP_AT / FACE_SPAN;

function bake(face) {
  const [[lx, ly], [rx, ry]] = face.eyes;
  const width = (rx - lx) / (2 * EYE_U);
  const height = (face.mouth[1] - (ly + ry) / 2) / (eyeV - lipV);
  const x0 = (lx + rx) / 2 - width / 2;
  const y0 = (ly + ry) / 2 - (1 - eyeV) * height;
  const crop = `crop=${width.toFixed(2)}:${height.toFixed(2)}:${x0.toFixed(2)}:${y0.toFixed(2)},scale=${TEXELS}:${TEXELS}:flags=lanczos`;
  const rgba = execFileSync("ffmpeg", ["-v", "error", "-i", join(SOURCE, face.file), "-vf", crop, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 24 });
  for (let p = 0; p < TEXELS * TEXELS; p++) for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.min(255, Math.round(srgb(linear(rgba[p * 4 + c]) * face.gain[c])));
  const skin = [0, 0, 0];
  let count = 0;
  for (const [u, v] of CHEEKS) {
    const cx = Math.round(u * TEXELS);
    const cy = Math.round((1 - v) * TEXELS);
    for (let y = cy - CHEEK_HALF; y <= cy + CHEEK_HALF; y++) {
      for (let x = cx - CHEEK_HALF; x <= cx + CHEEK_HALF; x++) {
        const i = (y * TEXELS + x) * 4;
        for (let c = 0; c < 3; c++) skin[c] += rgba[i + c];
        count++;
      }
    }
  }
  const mean = skin.map((sum) => Math.round(sum / count));
  const rgb = Buffer.alloc(TEXELS * TEXELS * 3);
  for (let p = 0; p < TEXELS * TEXELS; p++) {
    const alpha = rgba[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round(rgba[p * 4 + c] * alpha + mean[c] * (1 - alpha));
  }
  delight(rgb, mean);
  const hex = `0x${mean.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return { name: face.name, skin: hex, rgb: rgb.toString("base64"), crop };
}

const baked = FACES.map(bake);
const src = `// Generated by scripts/bake-dummy-faces.mjs from assets-src/faces/*.png. Do not edit: re-run the script.
/**
 * The people's faces, from the look reference: each \`FACE_TEXELS\` square, its eyes and lip where the dummy's head has them,
 * sRGB RGB rows from the top, with the skin (sRGB) its cheeks read.
 */
export const FACE_TEXELS = ${TEXELS};
export const FACE = { ${baked.map((face, index) => `${face.name}: ${index}`).join(", ")} } as const;
export const FACES: readonly { skin: number; rgb: string }[] = [
${baked.map((face) => `  { skin: ${face.skin}, rgb: "${face.rgb}" },`).join("\n")}
];
`;
writeFileSync(OUT, src);
console.log(`${OUT}: ${baked.length} faces, ${(src.length / 1024).toFixed(0)} KB`);
for (const face of baked) console.log(`${face.name}: skin ${face.skin}, ${face.crop}`);
