import * as THREE from "three";
import type { Frontage } from "../world/openworld/openworld-facade-solids.ts";
import { buildBayGeometry, buildCorniceGeometry, buildRailingGeometry, buildStoopGeometry, TINT_ATTRIBUTE } from "./facade-bay-parts.ts";
import { makeKitTextures, type KitTextures } from "./facade-kit-atlas.ts";
import { FACADE_GLOW } from "./facades.ts";

/**
 * The rowhomes' projecting bay stacks, stoops, iron railings and roofline cornices: one instanced mesh per kind across the map (four draws, whatever the number of houses),
 * each house placed by its `Frontage`. Drawing only: what a car or a walker meets is `openworld-facade-solids.ts`.
 */

/** One house's accent: the bay's panels and its roofline cornice (sRGB), varying house to house against the brick. */
type HouseAccent = { name: string; panel: number; cornice: number };

export const HOUSE_ACCENTS: readonly HouseAccent[] = [
  { name: "sage", panel: 0x8fa58a, cornice: 0xe6dcc3 },
  { name: "olive", panel: 0x8e8c58, cornice: 0x5a4636 },
  { name: "cream", panel: 0xe4d9bb, cornice: 0x6b4f3a },
  { name: "wood", panel: 0x7a5638, cornice: 0xd8cdb0 },
  { name: "slate", panel: 0x6f8296, cornice: 0xe9e4d6 },
  { name: "tan", panel: 0xb08a5c, cornice: 0x4b4b50 },
];

/** The stone's tints (sRGB): the same steps in slightly different greys from house to house. */
const STONE_TINTS = [0xffffff, 0xe8e4dc, 0xd8d4cc] as const;

/** The kit's surfaces: painted wood and stone, nothing shiny; the iron railing a little. */
const KIT_ROUGHNESS = 0.85;
const KIT_METALNESS = 0.02;
const RAIL_ROUGHNESS = 0.55;
const RAIL_METALNESS = 0.45;
/** A railing texel counts as iron above this alpha: low enough that thin bars survive the distance's mipmaps. */
const RAIL_ALPHA_TEST = 0.3;

/** A lit window's brightness over the facades' own (1.3), and the share of houses that light theirs at full night (`LIT_SHARE` in facades.ts). */
const KIT_GLOW_INTENSITY = 1.3;
const WINDOW_LIT_SHARE = 0.6;

const INSTANCE_TINT = "vColor.rgb *= instanceColor.rgb;";
const SHARED_TINT = `vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, ${TINT_ATTRIBUTE});`;

/** three's colour chunk with the instance colour weighted by each vertex's tint share. */
export function tintedColorVertex(): string {
  const patched = THREE.ShaderChunk.color_vertex.replace(INSTANCE_TINT, SHARED_TINT);
  if (patched === THREE.ShaderChunk.color_vertex) throw new Error("three's color_vertex chunk no longer holds the instance colour line the kit patches");
  return patched;
}

/** A house's seed from where it stands, then its windows light once the shared glow passes it (and only a share of houses light them). */
const KIT_SEED = "fract(dot(instanceMatrix[3].xz, vec2(0.0791, 0.1137)))";

function makeKitMaterial(textures: KitTextures): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: textures.albedo,
    emissiveMap: textures.glow,
    emissive: 0xffffff,
    emissiveIntensity: KIT_GLOW_INTENSITY,
    vertexColors: true,
    roughness: KIT_ROUGHNESS,
    metalness: KIT_METALNESS,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.facadeGlow = FACADE_GLOW;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float ${TINT_ATTRIBUTE};\nvarying float vKitSeed;`)
      .replace("#include <color_vertex>", tintedColorVertex())
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n#ifdef USE_INSTANCING\nvKitSeed = ${KIT_SEED};\n#else\nvKitSeed = 0.0;\n#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float facadeGlow;\nvarying float vKitSeed;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= smoothstep(vKitSeed * 0.7, vKitSeed * 0.7 + 0.2, facadeGlow) * step(fract(vKitSeed * 7.3), ${WINDOW_LIT_SHARE.toFixed(2)});`,
      );
  };
  material.customProgramCacheKey = () => "facade-kit";
  return material;
}

function makeRailMaterial(textures: KitTextures): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: textures.rail, alphaTest: RAIL_ALPHA_TEST, side: THREE.DoubleSide, roughness: RAIL_ROUGHNESS, metalness: RAIL_METALNESS });
}

type Kind = "bay" | "stoop" | "railing" | "cornice";

export class FacadeBays {
  readonly group = new THREE.Group();
  /** Houses dressed, draw calls and triangles the kit costs. */
  readonly stats: { frontages: number; draws: number; triangles: number };
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly textures = makeKitTextures();
  private readonly kitMaterial = makeKitMaterial(this.textures);
  private readonly railMaterial = makeRailMaterial(this.textures);

  constructor(frontages: readonly Frontage[]) {
    const kinds: readonly [Kind, THREE.BufferGeometry, THREE.Material, (frontage: Frontage, into: THREE.Color) => void][] = [
      ["bay", buildBayGeometry(), this.kitMaterial, (frontage, into) => into.setHex(HOUSE_ACCENTS[frontage.variant % HOUSE_ACCENTS.length]!.panel)],
      ["stoop", buildStoopGeometry(), this.kitMaterial, (frontage, into) => into.setHex(STONE_TINTS[frontage.variant % STONE_TINTS.length]!)],
      ["railing", buildRailingGeometry(), this.railMaterial, () => undefined],
      ["cornice", buildCorniceGeometry(), this.kitMaterial, (frontage, into) => into.setHex(HOUSE_ACCENTS[frontage.variant % HOUSE_ACCENTS.length]!.cornice)],
    ];
    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    let triangles = 0;
    for (const [kind, geometry, material, colourOf] of kinds) {
      const mesh = new THREE.InstancedMesh(geometry, material, frontages.length);
      mesh.name = `facade-${kind}`;
      mesh.receiveShadow = true;
      for (const [at, frontage] of frontages.entries()) {
        matrix.makeRotationY(frontage.yaw + Math.PI / 2).setPosition(frontage.x, 0, frontage.z);
        mesh.setMatrixAt(at, matrix);
        if (kind !== "railing") {
          colourOf(frontage, colour);
          mesh.setColorAt(at, colour);
        }
      }
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.meshes.push(mesh);
      triangles += (geometry.getAttribute("position").count / 3) * frontages.length;
    }
    this.stats = { frontages: frontages.length, draws: this.meshes.length, triangles };
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.kitMaterial.dispose();
    this.railMaterial.dispose();
    this.textures.albedo.dispose();
    this.textures.glow.dispose();
    this.textures.rail.dispose();
  }
}
