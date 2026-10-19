import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RANGE } from "../scenes/range.ts";
import { groundMesh } from "../scenes/ground-stack.ts";

/** The sign boards' paint: scuffed yellow with a brown edge and black ink, shared by every station's height and distance boards. */
const SIGN_BOARD_PAINT = { fill: "#e3b93f", edge: "#6b5419", ink: "#16130c" } as const;

/** Distance signs: board size (m), board centre height, and how far outside the field's left edge (−z) they stand. */
const BOARD_W = 2.6;
const BOARD_H = 1.3;
const BOARD_Y = 2;
const BOARD_OUT = 1.5;
/** Cells per row of a sign atlas, and a cell's size (px): one label per cell. */
const SIGN_ATLAS_COLUMNS = 6;
const SIGN_CELL = { width: 256, height: 128 } as const;

/** The signs' atlas: one cell per label, in order, black on scuffed yellow with a brown edge (`SIGN_BOARD_PAINT`). */
export function signAtlas(labels: readonly string[]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIGN_ATLAS_COLUMNS * SIGN_CELL.width;
  canvas.height = Math.ceil(labels.length / SIGN_ATLAS_COLUMNS) * SIGN_CELL.height;
  const ctx = canvas.getContext("2d")!;
  for (const [k, label] of labels.entries()) {
    const x0 = (k % SIGN_ATLAS_COLUMNS) * SIGN_CELL.width;
    const y0 = Math.floor(k / SIGN_ATLAS_COLUMNS) * SIGN_CELL.height;
    ctx.fillStyle = SIGN_BOARD_PAINT.fill;
    ctx.fillRect(x0 + 4, y0 + 4, 248, 120);
    ctx.strokeStyle = SIGN_BOARD_PAINT.edge;
    ctx.lineWidth = 6;
    ctx.strokeRect(x0 + 7, y0 + 7, 242, 114);
    ctx.fillStyle = SIGN_BOARD_PAINT.ink;
    ctx.font = "bold 92px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x0 + 128, y0 + 68);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A `width` x `height` sign face centred at (x, y, z), facing −x (back up the throw), reading cell `index` of a `count`-label `signAtlas`. */
export function signFace(width: number, height: number, x: number, y: number, z: number, index: number, count: number): THREE.BufferGeometry {
  const rows = Math.ceil(count / SIGN_ATLAS_COLUMNS);
  const col = index % SIGN_ATLAS_COLUMNS;
  const row = Math.floor(index / SIGN_ATLAS_COLUMNS);
  // A +z plane turned −90° about y faces −x.
  const face = new THREE.PlaneGeometry(width, height).rotateY(-Math.PI / 2).translate(x, y, z);
  const uv = face.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / SIGN_ATLAS_COLUMNS, 1 - (row + 1 - uv.getY(i)) / rows);
  return face;
}

/**
 * The ejection range's art (`RANGE`): a sand field from the wall at the origin down +x, a low kerb round it, and a
 * numbered sign on two posts every `RANGE.signStep` m along its left edge, facing back up the range. Four draws,
 * shown only in the range scene.
 */
export function makeRangeArt(): THREE.Group {
  const g = new THREE.Group();
  g.name = "range";
  const { length: L, halfWidth: W } = RANGE;
  const sand = groundMesh(
    new THREE.PlaneGeometry(L, W * 2).rotateX(-Math.PI / 2).translate(L / 2, 0.012, 0),
    new THREE.MeshStandardMaterial({ color: 0xc8a466, roughness: 1, metalness: 0 }),
    "runoff",
  );
  sand.receiveShadow = true;
  const kerbs = [
    new THREE.BoxGeometry(L, 0.12, 0.4).translate(L / 2, 0.06, -W - 0.2),
    new THREE.BoxGeometry(L, 0.12, 0.4).translate(L / 2, 0.06, W + 0.2),
    new THREE.BoxGeometry(0.4, 0.12, W * 2 + 0.8).translate(L + 0.2, 0.06, 0),
  ];
  const kerb = new THREE.Mesh(mergeGeometries(kerbs)!, new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.85 }));
  kerb.receiveShadow = true;

  const z = -W - BOARD_OUT;
  const boards: THREE.BufferGeometry[] = [];
  const posts: THREE.BufferGeometry[] = [];
  const distances = Array.from({ length: RANGE.signs }, (_, k) => (k + 1) * RANGE.signStep);
  for (const [k, d] of distances.entries()) {
    boards.push(signFace(BOARD_W, BOARD_H, d, BOARD_Y, z, k, distances.length));
    const postH = BOARD_Y - BOARD_H / 2;
    for (const dz of [-BOARD_W * 0.35, BOARD_W * 0.35]) posts.push(new THREE.BoxGeometry(0.1, postH, 0.1).translate(d + 0.06, postH / 2, z + dz));
  }
  const signs = new THREE.Mesh(mergeGeometries(boards)!, new THREE.MeshStandardMaterial({ map: signAtlas(distances.map(String)), roughness: 0.8, side: THREE.DoubleSide }));
  signs.castShadow = true;
  const stakes = new THREE.Mesh(mergeGeometries(posts)!, new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.9 }));
  stakes.castShadow = true;
  for (const geo of [...kerbs, ...boards, ...posts]) geo.dispose();
  g.add(sand, kerb, signs, stakes);
  g.visible = false;
  return g;
}
