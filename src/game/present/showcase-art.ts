import * as THREE from "three";
import { LAB_LIGHT } from "./lab-art.ts";
import { STAGE_DIAMETER } from "./engine-world.ts";
import { GROUND_LEVEL } from "../scenes/constants.ts";
import { groundMesh } from "../scenes/ground-stack.ts";
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
 * (props, prefabs) gets a row of its own beside these.
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
/** The reference's floor: a matte mid-grey (sRGB, tuned to its lightness under the showcase's light) over the sandbox's asphalt, under its grid and rings; matte so the back light does not glint off it at the eye's grazing angle. */
const STUDIO_FLOOR = 0x3f3c39;

const _mark = new THREE.Vector3();

export class ShowcaseArt {
  readonly group = new THREE.Group();
  readonly people = new People(SLOTS);
  readonly slots = SLOTS;
  readonly carSlots = CAR_ROWS.length * CAR_STYLES.length;
  private readonly floor = groundMesh(new THREE.CircleGeometry(STAGE_DIAMETER / 2, 64), new THREE.MeshLambertMaterial({ color: STUDIO_FLOOR }), GROUND_LEVEL.runoff);

  constructor() {
    this.group.name = "showcase";
    this.group.visible = false;
    this.group.add(this.floor, this.people.group);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    for (let slot = 0; slot < SLOTS; slot++) this.people.dress(slot, this.figureOf(slot).cop, this.figureOf(slot).look);
    this.stand();
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
  }
}
