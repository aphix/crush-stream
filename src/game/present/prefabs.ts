import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { once } from "../kernel/scalar.ts";
import { makeAsphalt, makeJerseyBarrier, makeLamp } from "./engine-world.ts";
import { tagSurface } from "./ultra/surface-tag.ts";
import { CARHENGE, CHEVRON, COOLING_TOWER, coolingTowerRadius, FENCE, JUNK_CRANE, MARBLE, OBELISK, obeliskHalf, PREFABS, SMOKESTACK, smokestackRadius, STAR_INNER, WRECK, type PrefabId } from "../world/catalog.ts";
import { box, cyl, MARBLE_SHADE, painted, type Piece, type PrefabMaterials, type PrefabPart, type Skin, squareFrustum } from "./prefab-pieces.ts";
import { basin, capitol, capitolPoolParts, flagpole, fountain, lincoln, monumentPieces, pool, whiteHouse } from "./prefabs-mall.ts";
import { frontBumper, lyingWheel, parkedCar } from "./prefabs-car.ts";
import { bushParts, flowerParts } from "./prefabs-foliage.ts";
import { streetKitParts } from "./prefabs-street.ts";
import { streetTreePieces } from "./street-trees.ts";
import { isStreetTreeSkin } from "../world/openworld/openworld-greenery.ts";
import { PARK_LAMP } from "../world/openworld/openworld-park.ts";
import { assetParts, disposeAssetMaterials, familyOf, isAssetFamily, makeAssetMaterials } from "./scenery-assets-art.ts";
import { PREFAB } from "../world/constants.ts";
import { dressPaving } from "./ground-relief.ts";
import { buildingPieces, HALF as BLOCK_HALF } from "./facade-mesh.ts";
import { disposeFacadeMaterials, type FacadeStyle, homeStyle, makeFacadeMaterials, splitFacadeSkin } from "./facades.ts";
import { GARFIELD_MONUMENT, GRANT_MEMORIAL, PEACE_MONUMENT } from "../world/landmarks.ts";
import { LAMP_POOL } from "./constants.ts";
import { applyWaterLook } from "./water-look.ts";
import { LeafMaterial, NatureMaterial } from "./nature-look.ts";
import { leafAtlas } from "./leaf-atlas.ts";
import { tagMaterial } from "../vehicle/material-class.ts";
import { MAT } from "../kernel/material-ids.ts";

/**
 * Prefab meshes and the race's shared procedural textures. A prefab is one or a few parts (geometry
 * + material), each drawn as one InstancedMesh. At scale 1 a prefab fills `PREFABS[id].size`
 * [w, h, d]; its origin sits on the ground at the footprint centre, +Z forward, front (seats,
 * billboard face, lamp arm) on +X. Large props reach a little below the origin so they do not
 * float on a slope.
 */

const C = {
  black: 0x1b1c20,
  white: 0xe8e6e0,
  orange: 0xff6a1a,
  yellow: 0xf2c400,
  concrete: 0xb7b1a4,
  concreteDark: 0xa39d90,
  barrier: 0xc4bfb3,
  light: 0xd8d4cc,
  metal: 0x2a2c32,
  truss: 0xc8cbd0,
  hay: 0xc9a64a,
  twine: 0x7d6430,
  wood: 0x9a6b3a,
  woodDark: 0x6b4626,
  rock: 0x7a766e,
  trunk: 0x5a4030,
  leaf: [0x2f5a2c, 0x3b6d34],
  roof: 0x6a665f,
  seatBlue: 0x2f5d9a,
  seatRed: 0xb3261e,
  rust: 0x7e4426,
  rustLight: 0x9a6a46,
  paintFaded: 0x4d6278,
  glassDark: 0x1f2226,
  craneYellow: 0xc79a1e,
  fire: 0xff7a1a,
  towerLight: 0xbdb7aa,
  towerDark: 0xb0aa9d,
  towerBase: 0x8f8a80,
  towerRim: 0xcfc9bc,
  towerInner: 0x3a3733,
  stackRed: 0xb3281e,
};

/** World metres per texture tile (mud: across the road, its ruts run along it). */
export const TILE = { asphalt: 8, concrete: 4, detail: 12, mud: 8 };

/** Billboard canvas: the ad on top, a metal-coloured strip (posts) along the bottom. */
const BILL_W = 512;
const BILL_AD = 256;
const BILL_STRIP = 32;

/** The billboard's paper white (its ground and its STREAM / RACEWAY lettering). */
const BILLBOARD_PAPER = "#f2efe6";

/**
 * The race's shared textures, built once per page (`raceTextures`): every track art and the lab dress from the same set, and none disposes it. `*Gain` is the reciprocal of the texture's
 * mean linear colour: a material with `color = gain` and `map = texture` shows its vertex colour on
 * average, so `SURFACES` colours stay the colours you see.
 */
type RaceTextures = {
  asphalt: THREE.CanvasTexture;
  asphaltGain: THREE.Color;
  concrete: THREE.CanvasTexture;
  concreteGain: THREE.Color;
  /** Natural ground (grass, dirt, gravel, sand, cobble). */
  detail: THREE.CanvasTexture;
  detailGain: THREE.Color;
  /** A mud road's ruts (along the canvas's v) and puddles, drawn in the road's own frame; `mudGloss` its roughness (puddles wet). */
  mud: THREE.CanvasTexture;
  mudGain: THREE.Color;
  mudGloss: THREE.CanvasTexture;
  billboard: THREE.CanvasTexture;
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function texture(c: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 1 / mean linear colour of a canvas. */
export function gainOf(c: HTMLCanvasElement): THREE.Color {
  const lut = new Float32Array(256);
  const col = new THREE.Color();
  for (let i = 0; i < 256; i++) lut[i] = col.setRGB(i / 255, 0, 0, THREE.SRGBColorSpace).r;
  const px = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < px.length; i += 4) {
    r += lut[px[i]!]!;
    g += lut[px[i + 1]!]!;
    b += lut[px[i + 2]!]!;
  }
  const n = px.length / 4;
  return new THREE.Color(n / r, n / g, n / b);
}

/** Soft blob drawn at (x, y) and its wrapped copies, so the canvas tiles seamlessly. */
function blob(ctx: CanvasRenderingContext2D, size: number, x: number, y: number, r: number, rgba: string): void {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const cx = x + ox;
      const cy = y + oy;
      if (cx + r < 0 || cy + r < 0 || cx - r > size || cy - r > size) continue;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
}

function makeDetail(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = "#c8c8c8";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const light = Math.random() > 0.5;
    blob(ctx, S, Math.random() * S, Math.random() * S, 20 + Math.random() * 70, light ? "rgba(255,255,255,0.09)" : "rgba(40,40,40,0.09)");
  }
  for (let i = 0; i < 14000; i++) {
    const n = Math.random();
    ctx.fillStyle = n > 0.5 ? `rgba(255,255,255,${(n - 0.5) * 0.35})` : `rgba(0,0,0,${(0.5 - n) * 0.35})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, n > 0.93 || n < 0.07 ? 3 : 1.5, n > 0.93 || n < 0.07 ? 2 : 1.5);
  }
  return c;
}

/** Mud's colour and roughness canvases: wavy wheel ruts along v (darker grooves, a lit lip beside each), puddles dark and glossy. */
function makeMud(): [HTMLCanvasElement, HTMLCanvasElement] {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const [r, rough] = canvas(S, S);
  ctx.fillStyle = "#bcbcbc";
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = "#dddddd";
  rough.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) blob(ctx, S, Math.random() * S, Math.random() * S, 20 + Math.random() * 60, Math.random() > 0.5 ? "rgba(255,255,255,0.1)" : "rgba(30,25,20,0.12)");
  // Ruts: a wobble of whole periods per tile, so the canvas tiles along v.
  for (let i = 0; i < 18; i++) {
    const x0 = Math.random() * S;
    const w = 3 + Math.random() * 9;
    const amp = 4 + Math.random() * 14;
    const turns = 1 + Math.floor(Math.random() * 3);
    const phase = Math.random() * Math.PI * 2;
    const dark = 0.18 + Math.random() * 0.25;
    for (let y = 0; y < S; y += 2) {
      const x = x0 + amp * detSin((2 * Math.PI * turns * y) / S + phase);
      for (const ox of [-S, 0, S]) {
        ctx.fillStyle = `rgba(20,16,12,${dark})`;
        ctx.fillRect(x + ox - w / 2, y, w, 2);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(x + ox + w / 2, y, 2, 2);
        rough.fillStyle = "rgba(140,140,140,0.5)";
        rough.fillRect(x + ox - w / 2, y, w, 2);
      }
    }
  }
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const rad = 14 + Math.random() * 30;
    blob(ctx, S, x, y, rad, "rgba(15,12,10,0.45)");
    blob(rough, S, x, y, rad, "rgba(20,20,20,0.95)");
  }
  for (let i = 0; i < 9000; i++) {
    const n = Math.random();
    ctx.fillStyle = n > 0.5 ? `rgba(255,255,255,${(n - 0.5) * 0.3})` : `rgba(0,0,0,${(0.5 - n) * 0.3})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  return [c, r];
}

function makeConcrete(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = "#d2d2d2";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 30; i++) blob(ctx, S, Math.random() * S, Math.random() * S, 12 + Math.random() * 40, Math.random() > 0.5 ? "rgba(255,255,255,0.12)" : "rgba(50,46,40,0.12)");
  for (let i = 0; i < 3500; i++) {
    const n = Math.random();
    ctx.fillStyle = n > 0.6 ? `rgba(255,255,255,${n * 0.18})` : `rgba(30,28,24,${(1 - n) * 0.2})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, n > 0.92 ? 2 : 1, 1);
  }
  // Panel joint, once per tile.
  ctx.fillStyle = "rgba(40,38,34,0.22)";
  ctx.fillRect(0, 0, 2, S);
  return c;
}

function makeBillboard(): HTMLCanvasElement {
  const [c, ctx] = canvas(BILL_W, BILL_AD + BILL_STRIP);
  ctx.fillStyle = BILLBOARD_PAPER;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "#c8261c";
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillRect(0, 192, 512, 64);
  ctx.fillStyle = "#16171b";
  ctx.font = "bold 92px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("CRUSH", 256, 130);
  ctx.fillStyle = BILLBOARD_PAPER;
  ctx.font = "bold 40px sans-serif";
  ctx.fillText("STREAM", 256, 34);
  ctx.fillText("RACEWAY", 256, 224);
  ctx.fillStyle = "#2a2c32";
  ctx.fillRect(0, BILL_AD, BILL_W, BILL_STRIP);
  return c;
}

export const raceTextures = once((): RaceTextures => {
  const asphalt = tagSurface(makeAsphalt(), "asphalt", TILE.asphalt);
  asphalt.repeat.set(1, 1);
  const concrete = makeConcrete();
  const detail = makeDetail();
  const [mud, mudRough] = makeMud();
  const mudGloss = texture(mudRough, true);
  mudGloss.colorSpace = THREE.NoColorSpace;
  return {
    asphalt,
    asphaltGain: gainOf(asphalt.image as HTMLCanvasElement),
    concrete: tagSurface(texture(concrete, true), "concrete", TILE.concrete),
    concreteGain: gainOf(concrete),
    detail: tagSurface(texture(detail, true), "ground", TILE.detail),
    detailGain: gainOf(detail),
    mud: texture(mud, true),
    mudGain: gainOf(mud),
    mudGloss,
    billboard: texture(makeBillboard(), false),
  };
});

/** The sidewalk's material: the concrete's colour, the paving's normal. */
function paved(tex: RaceTextures): THREE.MeshStandardMaterial {
  const material = tagMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.concrete, color: tex.concreteGain, roughness: 0.92, metalness: 0.04 }), MAT.CONCRETE);
  dressPaving(material);
  return material;
}

/** The materials a prefab record makes only when a prop reads them (a course without sidewalks never makes the paving's). */
const lazyMade = new WeakMap<PrefabMaterials, { paving?: THREE.Material }>();

export function makePrefabMaterials(tex: RaceTextures, fullAssetMaps = false): PrefabMaterials {
  const lazy: { paving?: THREE.Material } = {};
  const water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.2 });
  applyWaterLook(water);
  const materials: PrefabMaterials = {
    plain: tagMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05 }), MAT.GENERIC),
    nature: tagMaterial(new NatureMaterial(), MAT.GENERIC),
    leaves: tagMaterial(new LeafMaterial(typeof document === "undefined" ? null : leafAtlas()), MAT.GENERIC),
    concrete: tagMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.concrete, color: tex.concreteGain, roughness: 0.92, metalness: 0.04 }), MAT.CONCRETE),
    get paving(): THREE.Material {
      return (lazy.paving ??= paved(tex));
    },
    facades: makeFacadeMaterials(),
    assets: makeAssetMaterials(fullAssetMaps),
    billboard: tagMaterial(new THREE.MeshStandardMaterial({ map: tex.billboard, emissiveMap: tex.billboard, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.6 }), MAT.BILLBOARD_FACE),
    water: tagMaterial(water, MAT.WATER),
  };
  lazyMade.set(materials, lazy);
  return materials;
}

/** Dispose a record of prefab materials: the ones it holds, and of the lazy ones only those a prop read. */
export function disposePrefabMaterials(materials: PrefabMaterials): void {
  for (const material of [materials.plain, materials.nature, materials.leaves, materials.concrete, materials.billboard, materials.water]) material.dispose();
  lazyMade.get(materials)?.paving?.dispose();
  disposeFacadeMaterials(materials.facades);
  disposeAssetMaterials(materials.assets);
}

/** Every uv of `g` set to (u, v). */
function uvAt(g: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry {
  const a = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
}

function cone(): Piece[] {
  // Body radius at height y, for the reflective band hugging it.
  const r = (y: number) => 0.165 - ((y - 0.04) / 0.66) * 0.14;
  return [
    [box(0.4, 0.04, 0.4, 0, 0.02, 0), C.black, MAT.CONE_BASE],
    [cyl(0.025, 0.165, 0.04, 0.7, 8, true), C.orange, MAT.CONE_BODY],
    [cyl(r(0.44) + 0.006, r(0.3) + 0.006, 0.3, 0.44, 8, true), C.white, MAT.CONE_BAND],
  ];
}

function tyreStack(): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.TorusGeometry(0.25, 0.125, 5, 10).rotateX(Math.PI / 2).translate(0, 0.125 + i * 0.25, 0);
    out.push([g, i % 2 ? C.white : C.black, i % 2 ? MAT.TYRE_STACK_PAINTED : MAT.TYRE_STACK]);
  }
  return out;
}

function hayBale(): Piece[] {
  return [
    [box(1.2, 0.9, 0.9, 0, 0.45, 0), C.hay, MAT.HAY],
    [box(0.06, 0.92, 0.92, -0.3, 0.45, 0), C.twine, MAT.TWINE],
    [box(0.06, 0.92, 0.92, 0.3, 0.45, 0), C.twine, MAT.TWINE],
  ];
}

function crate(): Piece[] {
  const out: Piece[] = [[box(0.96, 0.96, 0.96, 0, 0.5, 0), C.wood, MAT.CRATE_WOOD]];
  for (const y of [0.06, 0.94]) out.push([box(1, 0.12, 1, 0, y, 0), C.woodDark, MAT.CRATE_WOOD]);
  for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) out.push([box(0.1, 0.76, 0.1, x, 0.5, z), C.woodDark, MAT.CRATE_WOOD]);
  return out;
}

function rock(): Piece[] {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // Same hash for a shared corner, so the faceted shell stays closed.
    const h = Math.abs(detSin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1;
    const k = 0.8 + 0.25 * h;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(2.4 / (b.max.x - b.min.x), 1.85 / (b.max.y - b.min.y), 2.2 / (b.max.z - b.min.z));
  g.translate(0, -0.25, 0);
  g.computeVertexNormals();
  return [[g, C.rock, MAT.ROCK]];
}

function tree(): Piece[] {
  return [
    [cyl(0.15, 0.24, -0.2, 2.0, 5, true), C.trunk, MAT.TREE_BARK],
    [new THREE.ConeGeometry(1.6, 3.8, 6).translate(0, 3.3, 0), C.leaf[0]!, MAT.CONIFER_FOLIAGE],
    [new THREE.ConeGeometry(1.05, 3.0, 6).translate(0, 5.5, 0), C.leaf[1]!, MAT.CONIFER_FOLIAGE],
  ];
}

/** A five-pointed star prism (outer radius R, one tip towards +z) from y0 to y1. */
function star(R: number, y0: number, y1: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    const r = i % 2 ? R * STAR_INNER : R;
    if (i) s.lineTo(detSin(a) * r, -detCos(a) * r);
    else s.moveTo(0, -r);
  }
  // The extrusion runs along the shape's z; turned upright, the shape's y maps to −z.
  return new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y0, 0);
}

/** The Plaza de la Revolución memorial: a stone tower in star-plan steps, tapering to a spire. */
function monument(): Piece[] {
  const steps = [[6.2, -0.8, 1.4], [5.7, 1.4, 4.2], [5.1, 4.2, 9], [4.5, 9, 15], [3.9, 15, 22], [3.3, 22, 30], [2.8, 30, 38], [2.3, 38, 45], [1.8, 45, 50]] as const;
  const out = steps.map(([R, y0, y1], i): Piece => [star(R, y0, y1), i % 2 ? 0xd9d3c3 : 0xc4bdab, MAT.LIMESTONE]);
  out.push([new THREE.ConeGeometry(0.8, 5, 5).translate(0, 52.5, 0), 0xb4ad9b, MAT.LIMESTONE]);
  return out;
}

/** A royal palm: a leaning trunk and a crown of eight drooping fronds. */
function palm(): Piece[] {
  const lean = -0.08;
  const out: Piece[] = [[cyl(0.15, 0.27, 0, 8.2, 6).rotateZ(lean), C.trunk, MAT.PALM_TRUNK]];
  const top = new THREE.Vector3(0, 8.2, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), lean);
  for (let k = 0; k < 8; k++) {
    const frond = new THREE.BoxGeometry(0.5, 0.05, 3.4).translate(0, 0, 1.8).rotateX(0.5).rotateY((k * Math.PI) / 4).translate(top.x, top.y, 0);
    out.push([frond, C.leaf[k % 2]!, MAT.PALM_FROND]);
  }
  return out;
}

/** A stucco wall 10 m long (tinted per placement), a cap and a weathered footing. */
function wall(): Piece[] {
  return [
    [box(0.4, 3, 10, 0, 1.5, 0), 0xffffff, MAT.GARDEN_WALL],
    [box(0.6, 0.2, 10, 0, 3.1, 0), C.concrete, MAT.WALL_CAP],
    [box(0.44, 0.5, 10.02, 0, 0.25, 0), C.rock, MAT.WALL_FOOTING],
  ];
}

/** The Washington Monument: the shaft in its two shades of marble, then the pyramidion. */
function obelisk(): Piece[] {
  const { seam, shaft, tip, shoulder } = OBELISK;
  return [
    [squareFrustum(obeliskHalf(0), obeliskHalf(seam), 0, seam), MARBLE_SHADE.low, MAT.MARBLE],
    [squareFrustum(obeliskHalf(seam), shoulder, seam, shaft), MARBLE_SHADE.high, MAT.MARBLE],
    [squareFrustum(shoulder, 0, shaft, tip), MARBLE_SHADE.high, MAT.MARBLE],
  ];
}

/** A plain neoclassical block: footing, body, projecting cornice, parapet. */
function marble(): Piece[] {
  const { footing, body, cornice, parapet } = MARBLE;
  return [
    [box(footing.half * 2, footing.y1, footing.half * 2, 0, footing.y1 / 2, 0), MARBLE_SHADE.trim, MAT.MARBLE_TRIM],
    [box(body.half * 2, body.y1 - footing.y1, body.half * 2, 0, (footing.y1 + body.y1) / 2, 0), MARBLE_SHADE.wall, MAT.MARBLE],
    [box(cornice.half * 2, cornice.y1 - body.y1, cornice.half * 2, 0, (body.y1 + cornice.y1) / 2, 0), MARBLE_SHADE.trim, MAT.MARBLE_TRIM],
    [box(parapet.half * 2, parapet.y1 - cornice.y1, parapet.half * 2, 0, (cornice.y1 + parapet.y1) / 2, 0), MARBLE_SHADE.wall, MAT.MARBLE],
  ];
}

/** A museum slab: a block in facade `style` on the marble body's footprint (the collider's), its layers laid in the instance's own metres. */
function marbleSlab(style: FacadeStyle, mats: PrefabMaterials): PrefabPart[] {
  const reach = MARBLE.body.half / BLOCK_HALF;
  return [{ geometry: painted(buildingPieces(style, MAT.BUILDING_WALL, true)).scale(reach, 1, reach), material: mats.facades[style], shared: false }];
}

function fence(): Piece[] {
  const { kerb, rails, post } = FENCE;
  return [
    [box(kerb.hx * 2, kerb.y1, kerb.hz * 2, 0, kerb.y1 / 2, 0), C.concrete, MAT.FENCE_KERB],
    [box(rails.hx * 2, rails.y1 - kerb.y1, rails.hz * 2, 0, (kerb.y1 + rails.y1) / 2, 0), C.black, MAT.IRON_FENCE],
    ...[-1, 1].map((s): Piece => [box(post.half * 2, post.y1 - kerb.y1, post.half * 2, s * post.x, (kerb.y1 + post.y1) / 2, 0), C.black, MAT.IRON_FENCE]),
  ];
}

function dumpster(): Piece[] {
  return [
    [box(1.9, 1.05, 1.1, 0, 0.7, 0), 0x2f5d3a, MAT.DUMPSTER_STEEL],
    [box(2, 0.1, 1.25, 0, 1.3, 0), C.black, MAT.DUMPSTER_LID],
    [box(0.12, 0.3, 1.1, -0.82, 0.15, 0), C.metal, MAT.DUMPSTER_STEEL],
    [box(0.12, 0.3, 1.1, 0.82, 0.15, 0), C.metal, MAT.DUMPSTER_STEEL],
  ];
}

function grandstand(): Piece[] {
  const out: Piece[] = [];
  const depth = 1.2;
  for (let i = 0; i < 5; i++) {
    const top = 0.6 + 0.8 * i;
    const x = 3.5 - (i + 0.5) * depth;
    out.push([box(depth, top + 0.5, 29.6, x, (top - 0.5) / 2, 0), i % 2 ? C.concreteDark : C.concrete, MAT.GRANDSTAND_CONCRETE]);
    out.push([box(0.45, 0.4, 29, x - depth / 2 + 0.35, top + 0.2, 0), i === 2 ? C.seatRed : C.seatBlue, MAT.GRANDSTAND_SEAT]);
  }
  out.push([box(1, 6.25, 30, -3, 2.625, 0), C.concrete, MAT.GRANDSTAND_CONCRETE]);
  out.push([box(6.1, 0.25, 30, -0.45, 5.875, 0), C.light, MAT.GRANDSTAND_STEEL]);
  for (const z of [-14, -4.7, 4.7, 14]) out.push([box(0.2, 5.75, 0.2, 2.4, 2.875, z), C.metal, MAT.GRANDSTAND_STEEL]);
  return out;
}

function billboard(): Piece[] {
  const s0 = BILL_STRIP / (BILL_AD + BILL_STRIP);
  const panel = box(0.3, 2.5, 6, 0, 3.25, 0);
  const uv = panel.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, s0 + uv.getY(i) * (1 - s0));
  return [
    [uvAt(box(0.15, 2.2, 0.15, 0, 1, -2.2), 0.5, s0 / 2), 0xffffff, MAT.BILLBOARD_POST],
    [uvAt(box(0.15, 2.2, 0.15, 0, 1, 2.2), 0.5, s0 / 2), 0xffffff, MAT.BILLBOARD_POST],
    [panel, 0xffffff, MAT.BILLBOARD_FACE],
  ];
}

/** Lattice pylon (also the legs of the start gantry). */
function pylon(): Piece[] {
  const out: Piece[] = [];
  for (const x of [-0.44, 0.44]) for (const z of [-0.44, 0.44]) out.push([box(0.12, 6, 0.12, x, 3, z), C.truss, MAT.GANTRY_LATTICE]);
  for (let y = 0.75; y < 6; y += 1.5) {
    for (const s of [-0.44, 0.44]) {
      out.push([box(0.88, 0.07, 0.07, 0, y, s), C.truss, MAT.GANTRY_LATTICE]);
      out.push([box(0.07, 0.07, 0.88, s, y, 0), C.truss, MAT.GANTRY_LATTICE]);
    }
  }
  out.push([box(1, 0.12, 1, 0, 5.94, 0), C.metal, MAT.GANTRY_LATTICE]);
  return out;
}

/**
 * The chevron board's drawing (m): each arm of the ">" runs `run` along the board and `rise` up or down it from the apex, `stroke`
 * wide, and stands `proud` over the board's two faces so the arrow reads from both; the post is `post` wide. Tuned by eye in a race screenshot.
 */
const CHEVRON_DRAW = { run: 0.4, rise: 0.3, stroke: 0.12, proud: 0.01, post: 0.08 };

/**
 * One chevron alignment board on its post: black, a bold yellow chevron whose apex points to local −Z. Seen from the +X face
 * (the front) it reads ">", from the −X face "<": either face points the same way in the world, along local −Z, so a turn to
 * the driver's right shows the front and a turn to the left shows the back.
 */
function chevron(): Piece[] {
  const { width, height, top, thick } = CHEVRON;
  const { run, rise, stroke, proud, post } = CHEVRON_DRAW;
  const centre = top - height / 2;
  const slope = detAtan2(rise, run);
  const arm = (side: 1 | -1): Piece => [new THREE.BoxGeometry(thick, stroke, hypot2(run, rise)).rotateX(-side * slope).translate(0, centre + (side * rise) / 2, 0), C.yellow, MAT.CHEVRON_BOARD];
  return [
    [box(thick - 2 * proud, height, width, 0, centre, 0), C.black, MAT.CHEVRON_BOARD],
    [box(thick - 2 * proud, top - height, post, 0, (top - height) / 2, 0), C.metal, MAT.CHEVRON_POST],
    arm(1),
    arm(-1),
  ];
}

/** Free a group's geometries, and the materials and maps not listed in `keep`. */
function disposeGroup(g: THREE.Group, keep: readonly THREE.Material[] = []): void {
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    (o.geometry as THREE.BufferGeometry).dispose();
    const m = o.material as THREE.MeshStandardMaterial;
    if (keep.includes(m)) return;
    m.map?.dispose();
    m.dispose();
  });
}

/**
 * makeLamp fitted to 4.4 m with its arm towards the road (+X) (`acorn`: the acorn lamp at its own size, no arm): the pole in vertex colours, then the
 * head and the night light pool on makeLamp's own shared materials, so the scene's day / night
 * switch lights them with every other lamp. The acorn lamp stands on the open world's sidewalk slabs, so its pool lies over the slab's top (`PREFABS.sidewalk.size`), as it lies over the ground at a race's lamp;
 * `onSlab` false (a park's lamp, on the ground) leaves its pool on the ground.
 */
function lamp(plain: THREE.Material, acorn = false, onSlab = acorn): PrefabPart[] {
  const g = makeLamp(true, acorn);
  g.updateMatrixWorld(true);
  const k = acorn ? 1 : 4.4 / 5.2;
  const fit = new THREE.Matrix4().makeRotationY(Math.PI / 2).scale(new THREE.Vector3(k, k, k));
  const pole: Piece[] = [];
  const shared: PrefabPart[] = [];
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.MeshStandardMaterial;
    const geo = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld).applyMatrix4(fit);
    if (onSlab && o.name === LAMP_POOL) shared.push({ geometry: geo.translate(0, PREFABS[PREFAB.sidewalk].size[1], 0), material: m, shared: true });
    else if (o.name === LAMP_POOL || m.emissive?.getHex()) shared.push({ geometry: geo, material: m, shared: true });
    else pole.push([geo, m.color.getHex(), MAT.LAMP_POLE]);
  });
  disposeGroup(
    g,
    shared.map((p) => p.material),
  );
  return [{ geometry: painted(pole), material: plain, shared: false }, ...shared];
}

function barrierBlock(): Piece[] {
  const g = makeJerseyBarrier();
  // One 1.78 m × 0.61 m jersey segment stretched to the catalog's 2 m × 0.64 m block.
  const seg = g.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry instanceof THREE.ExtrudeGeometry)!;
  const geometry = (seg.geometry as THREE.BufferGeometry).clone().scale(0.64 / 0.61, 1, 2 / 1.78);
  disposeGroup(g);
  return [[geometry, C.barrier, MAT.JERSEY_CONCRETE]];
}

/** A junked car shell lying on its wheels, nose +Z: a body box, a crushed cabin, its glass a dark band. Light grey, so the per-instance tint (`TrackArt.tint`) is its paint. */
function wreck(): Piece[] {
  const { wide, long, tall } = WRECK;
  return [
    [box(wide, tall * 0.55, long, 0, tall * 0.3, 0), 0xc8c8c8, MAT.DUMPSTER_STEEL],
    [box(wide * 0.84, tall * 0.4, long * 0.42, 0, tall * 0.78, -long * 0.06), 0xa8a8a8, MAT.DUMPSTER_STEEL],
    [box(wide * 0.86, tall * 0.22, long * 0.36, 0, tall * 0.8, -long * 0.06), C.glassDark, MAT.DUMPSTER_STEEL],
  ];
}

/** A shell's pieces turned by `yaw` about y and moved to (x, y, z): `upright` stands it on its nose first. */
function shellAt(upright: boolean, yaw: number, x: number, y: number, z: number, hex: number): Piece[] {
  const { wide, long, tall } = WRECK;
  const body = box(wide, tall, long, 0, 0, 0);
  const glass = box(wide * 0.86, tall * 0.3, long * 0.36, 0, tall * 0.4, -long * 0.06);
  for (const g of [body, glass]) {
    if (upright) g.rotateX(Math.PI / 2);
    g.rotateY(yaw).translate(x, y, z);
  }
  return [[body, hex, MAT.DUMPSTER_STEEL], [glass, C.glassDark, MAT.DUMPSTER_STEEL]];
}

/** The Carhenge: pairs of rusted shells stood on their noses round a ring, a shell across each pair's tops, a campfire in the middle. */
function carhenge(): Piece[] {
  const { ring, pairs, gap } = CARHENGE;
  const { long, tall } = WRECK;
  const shades = [C.rust, C.rustLight, C.paintFaded];
  const out: Piece[] = [];
  for (let p = 0; p < pairs; p++) {
    const a = (p * 2 * Math.PI) / pairs;
    const rx = detSin(a);
    const rz = detCos(a);
    // Stood on its nose, a shell's roof (its local +y) turns to +z: a half turn past the ring's bearing faces it into the middle.
    for (const side of [-1, 1]) out.push(...shellAt(true, a + Math.PI, ring * rx + side * (gap / 2) * rz, long / 2 - 0.2, ring * rz - side * (gap / 2) * rx, shades[(p + side + 3) % 3]!));
    out.push(...shellAt(false, a + Math.PI / 2, ring * rx, long - 0.2 + tall / 2, ring * rz, shades[p % 3]!));
  }
  out.push([cyl(0.9, 1.1, 0, 0.35, 8), C.rock, MAT.ROCK], [cyl(0, 0.75, 0.3, 1.6, 6), C.fire, MAT.CAMPFIRE_FLAME]);
  return out;
}

/** The Carhenge campfire's glow: the lamps' night pool (their shared decal, drawn only at night) laid round the fire, 12.6 m across. */
function firePool(): PrefabPart {
  const g = makeLamp();
  const pool = g.getObjectByName(LAMP_POOL) as THREE.Mesh;
  const geometry = (pool.geometry as THREE.BufferGeometry).clone().rotateX(-Math.PI / 2).scale(1.4, 1, 1.4).translate(0, 0.025, 0);
  const keep: THREE.Material[] = [];
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.name === LAMP_POOL || (o.material as THREE.MeshStandardMaterial).emissive?.getHex())) keep.push(o.material as THREE.Material);
  });
  disposeGroup(g, keep);
  return { geometry, material: pool.material as THREE.Material, shared: true };
}

/** The junkyard crane: a lattice tower over a heap of wrecks and tyres, its boom out along +X with a shell hanging off the hook. */
function junkCrane(): Piece[] {
  const { height, reach, heap } = JUNK_CRANE;
  const leg = 1.1;
  const out: Piece[] = [];
  for (const x of [-leg, leg]) for (const z of [-leg, leg]) out.push([box(0.28, height - 3, 0.28, x, (height - 3) / 2, z), C.craneYellow, MAT.GANTRY_LATTICE]);
  for (let y = 2; y < height - 3; y += 2.5) {
    out.push([box(leg * 2, 0.16, 0.16, 0, y, leg), C.craneYellow, MAT.GANTRY_LATTICE], [box(leg * 2, 0.16, 0.16, 0, y, -leg), C.craneYellow, MAT.GANTRY_LATTICE]);
    out.push([box(0.16, 0.16, leg * 2, leg, y + 1.25, 0), C.craneYellow, MAT.GANTRY_LATTICE], [box(0.16, 0.16, leg * 2, -leg, y + 1.25, 0), C.craneYellow, MAT.GANTRY_LATTICE]);
  }
  const cabTop = height - 2.6 + 2.2 / 2;
  out.push([box(2.8, 2.2, 2.8, 0, height - 2.6, 0), C.craneYellow, MAT.GANTRY_LATTICE]);
  // The boom lies on the cab's top.
  out.push([box(reach + 4.5, 0.7, 0.7, (reach - 4.5) / 2, cabTop + 0.7 / 2, 0), C.craneYellow, MAT.GANTRY_LATTICE]);
  out.push([box(1.8, 1.4, 1.6, -3.8, height - 2.1, 0), C.concreteDark, MAT.CRANE_COUNTERWEIGHT]);
  out.push([box(0.08, 6, 0.08, reach - 0.4, height - 4.4, 0), C.metal, MAT.GANTRY_LATTICE]);
  out.push(...shellAt(false, 0.6, reach - 0.4, height - 8.1, 0, C.paintFaded));
  // The heap: shells piled round the tower's foot, the upper ones tipped over the lower.
  const pile: readonly (readonly [number, number, number, number, number])[] = [
    [3.2, 0.65, 0.8, 0.3, C.rust], [-3.0, 0.65, 1.5, 2.1, C.rustLight], [0.4, 0.65, -3.6, 1.4, C.paintFaded], [0.8, 0.65, 3.8, -0.4, C.rust],
    [-2.4, 0.65, -3.0, 0.9, C.rustLight], [2.6, 1.95, 1.4, 0.5, C.paintFaded], [-2.2, 1.95, 0.2, 2.4, C.rust], [0.6, 1.95, -2.6, 1.2, C.rustLight],
  ];
  for (const [x, y, z, yaw, hex] of pile) out.push(...shellAt(false, yaw, x, y, z, hex));
  for (let i = 0; i < 6; i++) {
    const a = (i * 2 * Math.PI) / 6 + 0.4;
    out.push([cyl(0.36, 0.36, -0.13, 0.13, 8).rotateX(Math.PI / 2).rotateY(a).translate((heap - 0.6) * detSin(a), 0.38, (heap - 0.6) * detCos(a)), C.black, MAT.TYRE_STACK]);
  }
  return out;
}

const TOWER_SIDES = 64;
const TOWER_RINGS = 22;

/** A lathe's uv in the concrete tile's metres: u in whole tiles round the turn (no seam), v along the profile; for the part of the turn from fraction `turn0` to `turn1`. */
function latheUv(g: THREE.LatheGeometry, points: readonly THREE.Vector2[], turn0: number, turn1: number, reach: number): THREE.LatheGeometry {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const rows = points.length;
  const sides = uv.count / rows - 1;
  const tiles = Math.max(1, Math.round((2 * Math.PI * reach) / TILE.concrete));
  let along = 0;
  for (let j = 0; j < rows; j++) {
    if (j > 0) along += points[j]!.distanceTo(points[j - 1]!);
    for (let i = 0; i <= sides; i++) uv.setXY(i * rows + j, (turn0 + ((turn1 - turn0) * i) / sides) * tiles, along / TILE.concrete);
  }
  return g;
}

/** A cooling tower: an intake plinth, the hyperboloid shell in ribs of two concrete tones, a rim, and a dark inner wall and floor seen over the open top. */
function coolingTower(): Piece[] {
  const { base, height, plinth, wall } = COOLING_TOWER;
  const shell: THREE.Vector2[] = [];
  for (let k = 0; k <= TOWER_RINGS; k++) {
    const y = plinth + ((height - plinth) * k) / TOWER_RINGS;
    shell.push(new THREE.Vector2(coolingTowerRadius(y), y));
  }
  const intake = [new THREE.Vector2(base, 0), new THREE.Vector2(base, plinth)];
  const inner = shell.map((p) => new THREE.Vector2(p.x - wall, p.y)).reverse();
  inner.push(new THREE.Vector2(base - wall, 0));
  const rim = shell[TOWER_RINGS]!.x;
  const out: Piece[] = [[latheUv(new THREE.LatheGeometry(intake, TOWER_SIDES), intake, 0, 1, base), C.towerBase, MAT.GRANDSTAND_CONCRETE]];
  for (let s = 0; s < TOWER_SIDES; s++) {
    const g = new THREE.LatheGeometry(shell, 1, (s * 2 * Math.PI) / TOWER_SIDES, (2 * Math.PI) / TOWER_SIDES);
    out.push([latheUv(g, shell, s / TOWER_SIDES, (s + 1) / TOWER_SIDES, base), s % 2 ? C.towerDark : C.towerLight, MAT.GRANDSTAND_CONCRETE]);
  }
  out.push([uvAt(new THREE.RingGeometry(rim - wall, rim, TOWER_SIDES).rotateX(-Math.PI / 2).translate(0, height, 0), 0.3, 0.3), C.towerRim, MAT.GRANDSTAND_CONCRETE]);
  out.push([latheUv(new THREE.LatheGeometry(inner, TOWER_SIDES), inner, 0, 1, base - wall), C.towerInner, MAT.GRANDSTAND_CONCRETE]);
  out.push([uvAt(new THREE.CircleGeometry(base - wall, TOWER_SIDES).rotateX(-Math.PI / 2).translate(0, 0.1, 0), 0.3, 0.3), C.towerInner, MAT.GRANDSTAND_CONCRETE]);
  return out;
}

const STACK_SIDES = 24;

/** A smokestack: a concrete footing and shaft, red and white aviation bands over its top, a lip and a dark flue. */
function smokestack(): Piece[] {
  const { base, height, footing, lip, lipRise, banded, bands } = SMOKESTACK;
  const plainTop = height - lipRise - banded;
  const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => uvAt(g, 0.3, 0.3);
  const part = (y0: number, y1: number, hex: number): Piece => [flat(cyl(smokestackRadius(y1), smokestackRadius(y0), y0, y1, STACK_SIDES, true)), hex, MAT.PILLAR_CONCRETE];
  const out: Piece[] = [[flat(cyl(base, base, 0, footing, STACK_SIDES, true)), C.concreteDark, MAT.PILLAR_CONCRETE], part(footing, plainTop, C.concrete)];
  for (let b = 0; b < bands; b++) out.push(part(plainTop + (banded * b) / bands, plainTop + (banded * (b + 1)) / bands, b % 2 ? C.white : C.stackRed));
  const crown = smokestackRadius(height);
  out.push([flat(cyl(crown, crown, height - lipRise, height, STACK_SIDES, true)), C.concreteDark, MAT.PILLAR_CONCRETE]);
  out.push([flat(new THREE.CircleGeometry(crown - lip, STACK_SIDES).rotateX(-Math.PI / 2).translate(0, height, 0)), C.towerInner, MAT.PILLAR_CONCRETE]);
  return out;
}

/** A paving slab (`PREFABS.sidewalk.size`): a light stone box, its top 6 cm proud of the ground. */
function sidewalk(): Piece[] {
  return [[box(2.4, 0.06, 3.2, 0, 0.03, 0), C.concrete, MAT.CONCRETE]];
}

/** Prefab `id` at scale 1 as drawable parts (one for most; the lamp adds its head and night pool); a building in the facade style `skin` names (else its prefab's own), a scenery asset in the family it names (else the first). */
export function prefabParts(id: PrefabId, mats: PrefabMaterials, skin: Skin = null): PrefabPart[] {
  const style = isAssetFamily(skin) || isStreetTreeSkin(skin) || skin === PARK_LAMP ? null : skin;
  const one = (pieces: Piece[], material: THREE.Material): PrefabPart[] => [{ geometry: painted(pieces), material, shared: false }];
  switch (id) {
    case PREFAB.cone:
      return one(cone(), mats.plain);
    case PREFAB.tyreStack:
      return one(tyreStack(), mats.plain);
    case PREFAB.hayBale:
      return one(hayBale(), mats.plain);
    case PREFAB.crate:
      return one(crate(), mats.plain);
    case PREFAB.muscleBumper:
      return frontBumper("coupe");
    case PREFAB.monsterWheel:
      return lyingWheel("monster");
    case PREFAB.carWheel:
      return lyingWheel("sedan");
    case PREFAB.barrierBlock:
      return one(barrierBlock(), mats.concrete);
    case PREFAB.rock:
      return one(rock(), mats.nature);
    case PREFAB.tree:
      return isStreetTreeSkin(skin) ? one(streetTreePieces(skin), mats.leaves) : one(tree(), mats.nature);
    case PREFAB.building:
    case PREFAB.buildingShell:
    case PREFAB.stucco: {
      const { style: s, storeys, party } = splitFacadeSkin(style ?? homeStyle(id)!);
      return one(buildingPieces(s, id === PREFAB.stucco ? MAT.STUCCO_WALL : MAT.BUILDING_WALL, false, storeys, party), mats.facades[s]);
    }
    case PREFAB.monument:
      return one(monument(), mats.plain);
    case PREFAB.palm:
      return one(palm(), mats.nature);
    case PREFAB.wall:
      return one(wall(), mats.plain);
    case PREFAB.dumpster:
      return one(dumpster(), mats.plain);
    case PREFAB.obelisk:
      return one(obelisk(), mats.plain);
    case PREFAB.capitol:
      return one(capitol(), mats.plain);
    case PREFAB.marble:
      return style ? marbleSlab(splitFacadeSkin(style).style, mats) : one(marble(), mats.plain);
    case PREFAB.whiteHouse:
      return one(whiteHouse(), mats.plain);
    case PREFAB.fountain:
      return fountain(mats);
    case PREFAB.fence:
      return one(fence(), mats.plain);
    case PREFAB.pool:
      return pool(mats);
    case PREFAB.basin:
      return basin(mats);
    case PREFAB.lincoln:
      return one(lincoln(), mats.plain);
    case PREFAB.capitolPool:
      return capitolPoolParts(mats);
    case PREFAB.grantMemorial:
      return one(monumentPieces(GRANT_MEMORIAL), mats.plain);
    case PREFAB.peaceMonument:
      return one(monumentPieces(PEACE_MONUMENT), mats.plain);
    case PREFAB.garfieldMonument:
      return one(monumentPieces(GARFIELD_MONUMENT), mats.plain);
    case PREFAB.flagpole:
      return one(flagpole(), mats.plain);
    case PREFAB.grandstand:
      return one(grandstand(), mats.plain);
    case PREFAB.billboard:
      return one(billboard(), mats.billboard);
    case PREFAB.lamp:
      return lamp(mats.plain);
    case PREFAB.acornLamp:
      return lamp(mats.plain, true, skin !== PARK_LAMP);
    case PREFAB.gantry:
      return one(pylon(), mats.plain);
    case PREFAB.chevron:
      return one(chevron(), mats.plain);
    case PREFAB.wreck:
      return one(wreck(), mats.plain);
    case PREFAB.parkedSedan:
      return one(parkedCar("sedan"), mats.plain);
    case PREFAB.parkedHatchback:
      return one(parkedCar("hatchback"), mats.plain);
    case PREFAB.parkedWagon:
      return one(parkedCar("wagon"), mats.plain);
    case PREFAB.parkedCoupe:
      return one(parkedCar("coupe"), mats.plain);
    case PREFAB.parkedPickup:
      return one(parkedCar("pickup"), mats.plain);
    case PREFAB.carhenge:
      return [...one(carhenge(), mats.plain), firePool()];
    case PREFAB.junkCrane:
      return one(junkCrane(), mats.plain);
    case PREFAB.coolingTower:
      return one(coolingTower(), mats.concrete);
    case PREFAB.smokestack:
      return one(smokestack(), mats.concrete);
    case PREFAB.sidewalk:
      return [{ geometry: painted(sidewalk()), material: mats.paving, shared: false, shadow: false }];
    case PREFAB.bush:
      return bushParts(mats);
    case PREFAB.flowers:
      return flowerParts(mats);
    case PREFAB.assetCard:
    case PREFAB.assetStandee:
    case PREFAB.assetCross:
    case PREFAB.assetCrossSolid:
    case PREFAB.assetDecal:
    case PREFAB.assetTile:
    case PREFAB.assetBox:
    case PREFAB.assetBoxSolid:
      return assetParts(id, familyOf(skin), mats);
    case PREFAB.invisibleWall:
      return [];
    case PREFAB.bench:
    case PREFAB.bikeRack:
    case PREFAB.litterBin:
    case PREFAB.parkingMeter:
    case PREFAB.hydrant:
    case PREFAB.cafeSet:
    case PREFAB.busShelter:
    case PREFAB.busStopSign:
    case PREFAB.newsBox:
    case PREFAB.streetSign:
    case PREFAB.bollard:
    case PREFAB.cellarDoor:
    case PREFAB.hoopFence:
    case PREFAB.pavilion:
    case PREFAB.plaza:
      return streetKitParts(id, mats);
  }
}
