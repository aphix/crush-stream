import * as THREE from "three";
import { LAB_LIGHT } from "./lab-art.ts";
import { makeLamp } from "./engine-world.ts";
import { GROUND_LEVEL } from "../scenes/constants.ts";
import { groundMesh, levelOrder } from "../scenes/ground-stack.ts";
import { tagMaterial } from "../vehicle/material-class.ts";
import { MAT } from "../kernel/material-ids.ts";
import { PARKED_PREFABS, type PrefabId } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { disposePrefabMaterials, makePrefabMaterials, raceTextures } from "./prefabs.ts";
import type { PrefabMaterials, Skin } from "./prefab-pieces.ts";
import { assetTint, isAssetFamily } from "./scenery-assets-art.ts";
import { PARKED_PAINTS } from "./prefabs-car.ts";
import { PropTumble } from "./prop-tumble.ts";
import { DEPTH_INSTANCED } from "./track-mesh.ts";
import { galleryRow, galleryStyleOf, SCENERY_GALLERY } from "./showcase-gallery-rows.ts";
import { STYLE_WHEELS } from "../vehicle/wheel-batch.ts";
import { ELDER_LOOK, VIP_LOOK } from "./dummy-dress.ts";
import { FACE } from "./dummy-faces.ts";
import { JEANS, OUTFIT, type DriverLook } from "./driver-look.ts";
import { blankStance, guardDress, People, walkStance, type Stance } from "./people.ts";
import type { CarPose } from "../vehicle/car-parts.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";

/**
 * The showcase's set: every kind of person the game draws, standing in rows (`ROWS`) on the sandbox's disc so the owner can
 * survey how each looks and moves, and behind them three rows of cars (`CAR_ROWS`), one of every style in each, as built, with
 * every door and lid open, and stripped to the cabin. A row is data: how its figures stand and where; the next kind of thing
 * (props, prefabs) gets a row of its own beside these: `SHOWCASE_GALLERY` holds the prefabs, look-only, behind the eye.
 */

/** One figure: its dress (`cop`: a uniform, else a civilian `look`), and whether he stands `square` to the line instead of turned to the eye. */
type Figure = { name: string; cop: boolean; look: DriverLook; square?: boolean };

/** The reference's muted blue tee, her purple top and lighter-wash cut-offs, the brick-red long sleeve and its darker-rinse jeans, the navy cap, the men's dark-brown and her copper hair (sRGB, tuned to read as the reference under the showcase's light). */
const BLUE_TEE = 0x445166;
const PURPLE_TOP = 0x664b7b;
const CUT_OFFS = 0x494c52;
const BRICK_RED = 0x934427;
const DARK_RINSE = 0x272c34;
const NAVY_CAP = 0x141626;
const DARK_BROWN = 0x482d07;
const COPPER = 0x8c5126;

/** The people the game draws, as the look reference has them: the man in the blue tee, the woman, the man in red with a cap and dark glasses, a plain-clothes guard, the president and a uniformed cop. */
const FIGURES: readonly Figure[] = [
  { name: "man", cop: false, look: { woman: false, shirt: BLUE_TEE, pants: JEANS, hair: DARK_BROWN, hat: null, mustache: false, outfit: OUTFIT.TEE, face: FACE.MAN } },
  { name: "woman", cop: false, look: { woman: true, shirt: PURPLE_TOP, pants: CUT_OFFS, hair: COPPER, hat: null, mustache: false, outfit: OUTFIT.TOP, face: FACE.WOMAN } },
  { name: "cap and shades", cop: false, look: { woman: false, shirt: BRICK_RED, pants: DARK_RINSE, hair: DARK_BROWN, hat: NAVY_CAP, mustache: false, outfit: OUTFIT.LONG_SLEEVE, shades: true, face: FACE.CAP_MAN } },
  { name: "guard", ...guardDress(1) },
  { name: "president", cop: false, look: VIP_LOOK },
  { name: "uniformed cop", ...guardDress(0), square: true },
];
/** The back row: the same kinds, the president's older aide standing behind him as in the reference. */
const BACK_ROW: readonly Figure[] = FIGURES.map((figure) => (figure.look === VIP_LOOK ? { name: "older aide", cop: false, look: ELDER_LOOK } : figure));

/** The stride a walking row is caught at (rad of a whole stride's 2π): an elbow and a knee bent on each side. */
const STRIDE_PHASE = 1.1;

/** The rows, front to back: where they stand (`z`, m) and how. */
const ROWS: readonly { name: string; z: number; pose: (out: Stance) => Stance }[] = [
  { name: "standing", z: 0, pose: blankStance },
  { name: "mid-stride", z: -2.5, pose: (out) => walkStance(STRIDE_PHASE, false, out) },
];

/** Metres between neighbours in a row. */
const SPACING = 1.5;
const SLOTS = ROWS.length * FIGURES.length;

/** The car rows' styles, left to right, as the car reference's lineup orders them. */
const CAR_STYLES: readonly CarStyleId[] = ["sedan", "coupe", "monster", "pickup", "police", "hatchback", "wagon"];
/** The car rows behind the people, front to back (`z`, m): as built, every door and lid open, every part off (`showPose`). */
const CAR_ROWS: readonly { pose: CarPose; z: number }[] = [
  { pose: "intact", z: -9 },
  { pose: "open", z: -16 },
  { pose: "stripped", z: -23 },
];
/** Metres between neighbouring cars in a row: the longest turned to the eye with both doors at their stops clears the next. */
const CAR_SPACING = 5.5;
/** The cars' heading (rad; 0 faces the eye): front and left side to the eye, as the reference's iso shows them. */
export const SHOWCASE_CAR_YAW = -Math.PI / 5;

/** The eye the scene opens on (m; it looks at `look`), the sandbox car's parking spot out of sight, and a knock (m/s up, and away from the eye along -z). */
export const SHOWCASE_EYE = { x: 0, y: 1.5, z: 8, lookX: 0, lookY: 1, lookZ: 0 };
export const SHOWCASE_CAR = { x: 60, z: 60 };
export const SHOWCASE_KNOCK = { speed: 6, lift: 0.3 };
/** The reference's studio: a key from the eye's upper left (42° up, 20° round), so each front falls off to its right side as the reference's do, a cool sky light filling with its grey floor's bounce from below, and the fill as a low back light behind the rows so their backs are not left in the dark (low, so it lights no cap or hair top). */
export const SHOWCASE_LIGHT = { ...LAB_LIGHT, sunIntensity: 1.6, sunAt: [-5, 14, 14] as const, hemi: "#bcc2cc", hemiIntensity: 1.4, ground: "#7a7a7a", fillIntensity: 1.1, fillAt: [0, 3, -14] as const };
/** The reference's floor: a matte mid-grey (sRGB, tuned to hold the lightness its unlit Lambert had under the showcase's light, now that the studio env lights it) over the sandbox's asphalt, under its grid and rings. Wet drops its roughness as the ground's does. */
const STUDIO_FLOOR = 0x2e2c2a;
/** The share of a street's wetness the studio floor takes: at full the low back light shone a white hot spot across the people's feet. */
const FLOOR_WET_SHARE = 0.6;

/** The disc's radius (m): the sandbox's, grown to hold the scenery rows (the farthest building corner is about 132 m out) and a margin. */
export const SHOWCASE_RADIUS = 140;
/** The floor's drawn radius (m): past the farthest view the draw setting allows, far beyond the disc the rows and walkers use (`SHOWCASE_RADIUS`), so the set never ends in a rim; the horizon, fog and sky take it from there. */
const FLOOR_RADIUS = 72 * SHOWCASE_RADIUS;

/**
 * Every prefab that is not a unique landmark, in rows by size behind the eye (the opening frame looks -z), then the scenery rows past them
 * (`SCENERY_GALLERY`). Rows are spaced so no footprint touches another or crosses the rim, and the tall ones stand far enough back that their shadows end behind the eye.
 */
export const SHOWCASE_GALLERY: readonly Placed[] = [
  ...galleryRow(15, [PREFAB.cone, PREFAB.tyreStack, PREFAB.hayBale, PREFAB.crate, PREFAB.barrierBlock, PREFAB.rock, PREFAB.dumpster, PREFAB.chevron], 1.5),
  ...galleryRow(19, [PREFAB.lamp, PREFAB.gantry, PREFAB.flagpole, PREFAB.billboard, PREFAB.fence, PREFAB.wall, PREFAB.tree, PREFAB.palm], 2),
  ...galleryRow(23, [PREFAB.parkedSedan, PREFAB.parkedHatchback, PREFAB.parkedWagon, PREFAB.parkedCoupe, PREFAB.parkedPickup], 1),
  ...galleryRow(28, [PREFAB.grandstand, PREFAB.fountain], 9),
  ...galleryRow(38, [PREFAB.building, PREFAB.stucco], 2),
  ...SCENERY_GALLERY,
];

/** The number keys' props, in key order (Digit1 the first): every knockable prefab (`body: "knock"`) but a carton (the high-jump pile's), then the car parts a car's own parts weigh as. */
export const THROWN_KINDS = [PREFAB.cone, PREFAB.crate, PREFAB.tyreStack, PREFAB.hayBale, PREFAB.muscleBumper, PREFAB.monsterWheel, PREFAB.carWheel] as const;
/** Props of each kind out at once: a key past them throws its kind's oldest again. Seven kinds of 32: 224 bodies in the world at most. */
export const THROWN_PER_KIND = 32;
/** Where the thrown props stand until thrown (m under the disc's floor): out of sight and out of reach of everything. */
const THROWN_DEPTH = 20;
/** The gap (m) between neighbouring parked props: over the longest of them (1.5 m), so none stands in another's broad-phase box (props stacked on one spot made every step pair them all). */
const THROWN_SPACING = 3;
/** The showcase's thrown props, kind by kind (`THROWN_KINDS`), `THROWN_PER_KIND` each, standing under the floor until a key throws one: a kind a row, its props along it. */
export const SHOWCASE_THROWN: readonly Placed[] = THROWN_KINDS.flatMap((prefab, row) =>
  Array.from({ length: THROWN_PER_KIND }, (_, n) => ({ prefab, x: (n - (THROWN_PER_KIND - 1) / 2) * THROWN_SPACING, y: -THROWN_DEPTH, z: (row - (THROWN_KINDS.length - 1) / 2) * THROWN_SPACING, yaw: 0, sx: 1, sy: 1, sz: 1 })),
);
/** Every prop the dummies' world holds: the thrown ones first (their index is `kind * THROWN_PER_KIND + n`), then the gallery, whose knockable pieces a dummy or a thrown prop knocks about. */
export const SHOWCASE_PROPS: readonly Placed[] = [...SHOWCASE_THROWN, ...SHOWCASE_GALLERY];

/** The light posts' feet (x, z; m) and where each spot aims (x, z; m): the front pair flank the people (out of the opening frame), the back pair the car rows. */
const POSTS: readonly { x: number; z: number; aimX: number; aimZ: number }[] = [
  { x: -11, z: -3, aimX: 1, aimZ: -1 },
  { x: 11, z: -3, aimX: -1, aimZ: -1 },
  { x: -19, z: -13, aimX: -3, aimZ: -17 },
  { x: 19, z: -13, aimX: 3, aimZ: -17 },
];
/** A post's spot at night: warm, wide enough that its cone's edge still lights the next row, and aimed at chest height. No post casts a shadow: a shadow pass is a whole extra draw of every caster. */
const POST_LIGHT = { color: 0xffe2b0, intensity: 260, distance: 55, angle: 0.8, penumbra: 0.6, decay: 2, headY: 5.1, aimY: 1 };

const _mark = new THREE.Vector3();

/** The monster's rims are gunmetal as its batched wheels' are (`STYLE_WHEELS`), a scenery asset takes its placement's sprite tint, a parked car a paint by its slot; the other props are untinted. */
function galleryTint(id: PrefabId, i: number, out: THREE.Color, style: Skin): boolean {
  if (isAssetFamily(style)) {
    assetTint(i, out);
    return true;
  }
  if (PARKED_PREFABS.has(id)) {
    out.setHex(PARKED_PAINTS[i % PARKED_PAINTS.length]!);
    return true;
  }
  if (id !== PREFAB.monsterWheel) return false;
  out.copy(STYLE_WHEELS.monster.tint);
  return true;
}

export class ShowcaseArt {
  readonly group = new THREE.Group();
  readonly people = new People(SLOTS);
  readonly slots = SLOTS;
  readonly carSlots = CAR_ROWS.length * CAR_STYLES.length;
  private readonly gallery = new THREE.Group();
  private readonly galleryMaterials: PrefabMaterials;
  private readonly floor = groundMesh(new THREE.CircleGeometry(FLOOR_RADIUS, 96), tagMaterial(new THREE.MeshStandardMaterial({ color: STUDIO_FLOOR, roughness: 1, metalness: 0 }), MAT.STUDIO_FLOOR, FLOOR_WET_SHARE), GROUND_LEVEL.runoff);
  /** The posts' spots, in the set whenever it stands (a light shown or hidden relinks every lit shader) and dark by day (`setNight`). */
  private readonly postLights: THREE.SpotLight[] = [];
  /** Every prop the dummies' world holds (`SHOWCASE_PROPS`), drawn where it has them. */
  readonly props: PropTumble;

  constructor() {
    this.group.name = "showcase";
    this.group.visible = false;
    this.group.add(this.floor, this.people.group, this.gallery);
    this.galleryMaterials = makePrefabMaterials(raceTextures(), true);
    const add = (mesh: THREE.InstancedMesh, id: PrefabId, shared: THREE.Material | null, cast: boolean): void => {
      mesh.castShadow = !shared && cast;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = DEPTH_INSTANCED;
      if (id === PREFAB.assetDecal || id === PREFAB.assetTile) mesh.renderOrder = levelOrder(GROUND_LEVEL.decal);
      this.gallery.add(mesh);
    };
    this.props = new PropTumble(SHOWCASE_PROPS, this.galleryMaterials, add, galleryTint, galleryStyleOf);
    this.erectPosts();
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    // A throw's ray picks the floor before the first frame is drawn: its turned matrix must be current, or a wide floor stands on end across the set.
    this.group.updateMatrixWorld(true);
    for (let slot = 0; slot < SLOTS; slot++) this.people.dress(slot, this.figureOf(slot).cop, this.figureOf(slot).look);
    this.stand();
  }

  /** The posts' spots at their full strength at night, out by day. */
  setNight(on: boolean): void {
    for (const light of this.postLights) light.intensity = on ? POST_LIGHT.intensity : 0;
  }

  private erectPosts(): void {
    for (const post of POSTS) {
      const pole = makeLamp(false);
      pole.traverse((part) => (part.castShadow = false));
      pole.position.set(post.x, 0, post.z);
      const light = new THREE.SpotLight(POST_LIGHT.color, 0, POST_LIGHT.distance, POST_LIGHT.angle, POST_LIGHT.penumbra, POST_LIGHT.decay);
      light.position.set(post.x, POST_LIGHT.headY, post.z);
      light.target.position.set(post.aimX, POST_LIGHT.aimY, post.aimZ);
      this.postLights.push(light);
      this.group.add(pole, light, light.target);
    }
  }

  /** Every figure back on his mark (a reset). */
  stand(): void {
    for (let slot = 0; slot < SLOTS; slot++) this.place(slot);
    this.people.update(0);
  }

  /** Slot `slot` back on his mark (he has walked home). */
  restore(slot: number): void {
    this.place(slot);
    this.people.update(0);
  }

  /** Slot `slot` on his mark in his row's pose, turned to face the scene's eye as the reference's line-up faces its camera; the cop stands square to the line as the reference's does, so the key rakes his front as it does the man's. */
  private place(slot: number): void {
    this.markOf(slot, _mark);
    this.people.stand(slot, _mark.x, _mark.y, _mark.z, this.yawOf(slot), ROWS[Math.floor(slot / FIGURES.length)]!.pose(blankStance()), false);
  }

  /** The way slot `slot` faces on his mark (rad about the vertical, 0 along +z). */
  yawOf(slot: number): number {
    this.markOf(slot, _mark);
    return this.figureOf(slot).square ? 0 : Math.atan2(SHOWCASE_EYE.x - _mark.x, SHOWCASE_EYE.z - _mark.z);
  }

  /** Slot `slot` taken off the set (knocked over: the ragdoll world has him now). */
  take(slot: number): void {
    this.people.hide(slot);
    this.people.update(0);
  }

  /** Where slot `slot` stands (world, feet) into `out`. */
  markOf(slot: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(((slot % FIGURES.length) - (FIGURES.length - 1) / 2) * SPACING, 0, ROWS[Math.floor(slot / FIGURES.length)]!.z);
  }

  /** Car slot `slot`: its style, pose and column (left to right), and where it stands (world, ground) into `out`. */
  carOf(slot: number, out: THREE.Vector3): { style: CarStyleId; pose: CarPose; column: number } {
    const column = slot % CAR_STYLES.length;
    const row = CAR_ROWS[Math.floor(slot / CAR_STYLES.length)]!;
    out.set((column - (CAR_STYLES.length - 1) / 2) * CAR_SPACING, 0, row.z);
    return { style: CAR_STYLES[column]!, pose: row.pose, column };
  }

  figureOf(slot: number): Figure {
    return (slot < FIGURES.length ? FIGURES : BACK_ROW)[slot % FIGURES.length]!;
  }

  dispose(): void {
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.people.dispose();
    this.gallery.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        o.dispose();
      }
    });
    disposePrefabMaterials(this.galleryMaterials);
    for (const light of this.postLights) light.dispose();
  }
}
