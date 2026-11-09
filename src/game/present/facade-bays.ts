import * as THREE from "three";
import { detCos, detSin } from "../kernel/physics-core.js";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { buildingHeight, MAX_STOREYS, MIN_STOREYS } from "../world/openworld/interior-kinds.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { drawnHalf, HOME_HEIGHT, type Frontage } from "../world/openworld/openworld-facade-solids.ts";
import { BRICK_STYLE } from "../world/openworld/openworld-programme.ts";
import { buildAirconGeometry, buildBayGeometry, buildCondenserGeometry, buildCorniceGeometry, buildDeckGeometry, buildFanlightGeometry, buildRailingGeometry, buildRoofGeometry, buildShutterGeometry, buildStoopGeometry, buildSurroundGeometry, buildWindowBoxGeometry, TINT_ATTRIBUTE } from "./facade-bay-parts.ts";
import { airconWindowsOf, shuttersOf, visibleWindowsOf } from "./facade-fittings.ts";
import { windowBoxPlacements, type SillWindow } from "./facade-window-boxes.ts";
import { GLASS_ALPHA_BELOW, makeKitTextures, type KitTextures } from "./facade-kit-atlas.ts";
import { FACADE_GLOW, FACADE_OPEN_AT, FACADE_OPEN_UNIFORM, facadeOpenLoop, roofLiftAt } from "./facades.ts";

/**
 * The rowhomes' projecting bay stacks, stoops, iron railings, roofline cornices and what stands on their roofs (chimneys and hatches, on some a condenser or a deck): one instanced mesh per kind across
 * the map (seven draws, whatever the number of houses),
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

/** The steps' tints (sRGB) over the marble cell: marble in slightly different whites from house to house, and a sandstone and a brownstone for the houses that have them. */
const MARBLE_TINTS = [0xffffff, 0xeeeae0, 0xdcd9d2, 0xc9b49c, 0xa98f7a] as const;

/** The facade styles whose door has an arched fanlight in white surround (the Federal house); any other has a flat surround. */
const ARCHED_DOOR_STYLES: readonly string[] = [BRICK_STYLE];

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

/** How far behind a house's drawn front face its centre lies (m): the position the open-facade list names, found from a kit instance (the front face's point, turned to face out of it). */
export const KIT_HOUSE_BACK = drawnHalf(LAYOUT.houseDepth);

/** A house's seed from where it stands, then its windows light once the shared glow passes it (and only a share of houses light them). */
const KIT_SEED = "fract(dot(instanceMatrix[3].xz, vec2(0.0791, 0.1137)))";

/** The seed and the open flag of an instance: where its house stands (its translation, taken back along the kit's out axis to the building's centre) against the list of buildings with their rooms built. */
const KIT_HOUSE_VERTEX = /* glsl */ `
vKitOpen = 0.0;
#ifdef USE_INSTANCING
vKitSeed = ${KIT_SEED};
vec2 kitHouse = instanceMatrix[3].xz - normalize(instanceMatrix[2].xz) * ${KIT_HOUSE_BACK.toFixed(4)};
${facadeOpenLoop("vKitOpen", "kitHouse")}
#else
vKitSeed = 0.0;
#endif`;

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
    shader.uniforms.facadeOpenAt = FACADE_OPEN_AT;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float ${TINT_ATTRIBUTE};\nvarying float vKitSeed;\nflat varying float vKitOpen;\n${FACADE_OPEN_UNIFORM}`)
      .replace("#include <color_vertex>", tintedColorVertex())
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${KIT_HOUSE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float facadeGlow;\nvarying float vKitSeed;\nflat varying float vKitOpen;")
      .replace("#include <map_fragment>", `#include <map_fragment>\nif (vKitOpen > 0.5 && diffuseColor.a < ${GLASS_ALPHA_BELOW}) discard;`)
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

/** Where one instance of a kit mesh stands against a house: across the lot (u), up from the ground (or the roof, for a roof piece), and its scale (1: the geometry as built). */
type Placement = { across: number; up: number; width: number; height: number; depth: number };

/** One instanced mesh of the kit: its geometry and material, the placements each house gives it (none: the house has none) and its per-instance colour (none: the mesh has no colours). */
type KitKind = { name: string; geometry: THREE.BufferGeometry; material: THREE.Material; placements: (frontage: Frontage) => readonly Placement[]; colourOf: ((frontage: Frontage) => number) | null };

/** The share (of 100) of houses with a condenser on the roof, with a roof deck and with an air-conditioning unit, each from its own bits of the house's variant. */
const CONDENSER_SHARE = 45;
const DECK_SHARE = 20;
const AIRCON_SHARE = 40;
const CONDENSER_BITS = 8;
const DECK_BITS = 16;
const AIRCON_BITS = 12;
/** The share (of 100) of houses with window boxes, and the bits of the variant that choose it and which storey they stand on (the first or second above the ground storey). */
const WINDOW_BOX_SHARE = 25;
const WINDOW_BOX_BITS = 4;
const WINDOW_BOX_STOREY_BITS = 20;
const WINDOW_BOX_STOREYS = 2;
const SHUTTER_BITS = 24;
const PERCENT = 100;
const WHITE = 0xffffff;
/** The shutters' paints (sRGB): black, grey-blue, bottle green and oxblood, one per house. */
const SHUTTER_COLOURS = [0x23262b, 0x5f7184, 0x3d5a45, 0x6b2f2a] as const;
/** An air-conditioning unit: its size (m), and how far over the window's sill it sits. */
const AIRCON = { width: 0.62, height: 0.4, projection: 0.3, lift: 0.12 } as const;

const accentOf = (frontage: Frontage): HouseAccent => HOUSE_ACCENTS[frontage.variant % HOUSE_ACCENTS.length]!;

const IDENTITY_TURN = new THREE.Quaternion();

const IN_PLACE: Placement = { across: 0, up: 0, width: 1, height: 1, depth: 1 };

/** How high (m) a house stands: its roofline, the height of its storeys. */
const homeHeightOf = (frontage: Frontage): number => buildingHeight(frontage.storeys, false);

/** How high (m) a house's roof stands: the 14 m block's top and the per-building parapet lift the facade shader gives it, at the house's height. */
function roofTopOf(frontage: Frontage): number {
  const face = drawnHalf(frontage.depth);
  const block = PREFABS[PREFAB.building].size[1];
  return ((block + roofLiftAt(frontage.x - detCos(frontage.yaw) * face, frontage.z + detSin(frontage.yaw) * face)) * homeHeightOf(frontage)) / block;
}

/** The share of houses (out of `PERCENT`) a house is among, by the `bits` of its variant. */
const inShare = (frontage: Frontage, bits: number, share: number): boolean => (frontage.variant >>> bits) % PERCENT < share;

/** `compute` for a facade style and a storey count, once for each. */
function byStoreys<T>(compute: (style: string, storeys: number) => readonly T[]): (style: string, storeys: number) => readonly T[] {
  const made = new Map<string, readonly T[]>();
  return (style, storeys) => {
    const key = `${style}@${storeys}`;
    let value = made.get(key);
    if (value === undefined) {
      value = compute(style, storeys);
      made.set(key, value);
    }
    return value;
  };
}

/** One bay stack for each storey count a house has, each on the houses of that count: a stack has a window over every floor, so a taller house's is taller. */
function bayKinds(material: THREE.Material): KitKind[] {
  return Array.from({ length: MAX_STOREYS - MIN_STOREYS + 1 }, (_, at): KitKind => {
    const storeys = MIN_STOREYS + at;
    return { name: `bay-${storeys}`, geometry: buildBayGeometry(storeys), material, placements: (frontage) => (frontage.storeys === storeys ? [IN_PLACE] : []), colourOf: (frontage) => accentOf(frontage).panel };
  });
}

/** What each kind of the kit stands as, per house: the ground pieces once, the roof pieces on the lifted roof, the shutters where the table has windows with room, the air-conditioner in one upper window. */
function kitKinds(textures: { kit: THREE.Material; rail: THREE.Material }): readonly KitKind[] {
  const everyHouse = (): readonly Placement[] => [IN_PLACE];
  const onRoof = (frontage: Frontage): readonly Placement[] => [{ ...IN_PLACE, up: roofTopOf(frontage) }];
  const shuttersFor = byStoreys(shuttersOf);
  const windowsFor = byStoreys(airconWindowsOf);
  const boxWindowsFor = byStoreys(visibleWindowsOf);
  const airconWindow = (frontage: Frontage): SillWindow | null => {
    const candidates = windowsFor(frontage.style, frontage.storeys);
    return candidates.length === 0 || !inShare(frontage, AIRCON_BITS, AIRCON_SHARE) ? null : candidates[(frontage.variant >>> AIRCON_BITS) % candidates.length]!;
  };
  return [
    ...bayKinds(textures.kit),
    { name: "stoop", geometry: buildStoopGeometry(), material: textures.kit, placements: everyHouse, colourOf: (frontage) => MARBLE_TINTS[frontage.variant % MARBLE_TINTS.length]! },
    { name: "railing", geometry: buildRailingGeometry(), material: textures.rail, placements: everyHouse, colourOf: null },
    { name: "surround", geometry: buildSurroundGeometry(), material: textures.kit, placements: (frontage) => (ARCHED_DOOR_STYLES.includes(frontage.style) ? [] : [IN_PLACE]), colourOf: () => WHITE },
    { name: "fanlight", geometry: buildFanlightGeometry(), material: textures.kit, placements: (frontage) => (ARCHED_DOOR_STYLES.includes(frontage.style) ? [IN_PLACE] : []), colourOf: () => WHITE },
    { name: "cornice", geometry: buildCorniceGeometry(), material: textures.kit, placements: (frontage) => [{ ...IN_PLACE, up: homeHeightOf(frontage) - HOME_HEIGHT }], colourOf: (frontage) => accentOf(frontage).cornice },
    { name: "roof", geometry: buildRoofGeometry(), material: textures.kit, placements: onRoof, colourOf: () => WHITE },
    { name: "condenser", geometry: buildCondenserGeometry(), material: textures.kit, placements: (frontage) => (inShare(frontage, CONDENSER_BITS, CONDENSER_SHARE) ? onRoof(frontage) : []), colourOf: () => WHITE },
    { name: "deck", geometry: buildDeckGeometry(), material: textures.kit, placements: (frontage) => (inShare(frontage, DECK_BITS, DECK_SHARE) ? onRoof(frontage) : []), colourOf: () => WHITE },
    {
      name: "shutter",
      geometry: buildShutterGeometry(),
      material: textures.kit,
      placements: (frontage) => shuttersFor(frontage.style, frontage.storeys).map((shutter) => ({ across: shutter.across, up: shutter.sill, width: shutter.width, height: shutter.height, depth: 1 })),
      colourOf: (frontage) => SHUTTER_COLOURS[(frontage.variant >>> SHUTTER_BITS) % SHUTTER_COLOURS.length]!,
    },
    {
      name: "aircon",
      geometry: buildAirconGeometry(),
      material: textures.kit,
      placements: (frontage) => {
        const window = airconWindow(frontage);
        return window === null ? [] : [{ across: window.across, up: window.sill + AIRCON.lift, width: AIRCON.width, height: AIRCON.height, depth: AIRCON.projection }];
      },
      colourOf: () => WHITE,
    },
    {
      name: "windowBox",
      geometry: buildWindowBoxGeometry(),
      material: textures.kit,
      placements: (frontage) => (inShare(frontage, WINDOW_BOX_BITS, WINDOW_BOX_SHARE) ? windowBoxPlacements(boxWindowsFor(frontage.style, frontage.storeys), 1 + ((frontage.variant >>> WINDOW_BOX_STOREY_BITS) % WINDOW_BOX_STOREYS), airconWindow(frontage)) : []),
      colourOf: (frontage) => accentOf(frontage).panel,
    },
  ];
}

export class FacadeBays {
  readonly group = new THREE.Group();
  /** Houses dressed, draw calls and triangles the kit costs. */
  readonly stats: { frontages: number; draws: number; triangles: number };
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly textures = makeKitTextures();
  private readonly kitMaterial = makeKitMaterial(this.textures);
  private readonly railMaterial = makeRailMaterial(this.textures);

  constructor(frontages: readonly Frontage[]) {
    const matrix = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const colour = new THREE.Color();
    let triangles = 0;
    for (const { name, geometry, material, placements, colourOf } of kitKinds({ kit: this.kitMaterial, rail: this.railMaterial })) {
      const stood = frontages.flatMap((frontage) => placements(frontage).map((placement) => ({ frontage, placement })));
      const mesh = new THREE.InstancedMesh(geometry, material, stood.length);
      mesh.name = `facade-${name}`;
      mesh.receiveShadow = true;
      for (const [at, { frontage, placement }] of stood.entries()) {
        // The kit's x is the lot's u negated, and its z is out of the facade.
        local.compose(position.set(-placement.across, placement.up, 0), IDENTITY_TURN, scale.set(placement.width, placement.height, placement.depth));
        matrix.makeRotationY(frontage.yaw + Math.PI / 2).setPosition(frontage.x, 0, frontage.z).multiply(local);
        mesh.setMatrixAt(at, matrix);
        if (colourOf !== null) mesh.setColorAt(at, colour.setHex(colourOf(frontage)));
      }
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.meshes.push(mesh);
      triangles += (geometry.getAttribute("position").count / 3) * stood.length;
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
