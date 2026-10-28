import { MAT, type MaterialId } from "../kernel/material-ids.ts";

export type Tone = readonly [color: number, roughness: number, metalness: number];

const CARPET: Tone = [0x121417, 0.98, 0];
const TRIM: Tone = [0x16191d, 0.85, 0.05];
const SOFT: Tone = [0x1d2026, 0.7, 0];
const ACCENT: Tone = [0x6c7178, 0.35, 0.85];
const GLOSS: Tone = [0x07090c, 0.12, 0.3];
const LEATHER: Tone = [0x1b1f25, 0.62, 0];
const INSERT: Tone = [0x262a31, 0.8, 0];
const STEER_RIM: Tone = [0x1a1c20, 0.55, 0];
const STEER_HUB: Tone = [0x22252a, 0.4, 0.3];
const BLACK: Tone = [0x111214, 0.7, 0.05];
const STEEL: Tone = [0x5d6064, 0.5, 0.8];
const PLASTIC: Tone = [0x18191c, 0.6, 0.05];
const ENGINE: Tone = [0x24262a, 0.55, 0.6];
const ALU: Tone = [0x9ea2a8, 0.32, 0.9];
const RED: Tone = [0xa8231c, 0.5, 0.2];
const RESERVOIR_GREY: Tone = [0x5a5a56, 0.5, 0];
const BLACK_PLASTIC: Tone = [0x121316, 0.6, 0.05];
const PIANO_BLACK: Tone = [0x121316, 0.14, 0.05];
const CHROME_TRIM: Tone = [0xd2d6db, 0.16, 0.95];
const BODY_PAINT: Tone = [0xf2f2f0, 0.42, 0.2];
const MIRROR_FITTING: Tone = [0x1c1e22, 0.5, 0.05];
const MIRROR_SILVER: Tone = [0x9aa8b4, 0.08, 0.7];
const PLATFORM_MIRROR_ARM: Tone = [0x2a2c32, 0.5, 0.05];
const PLATFORM_MIRROR_CAP: Tone = [0x1c1e22, 0.35, 0.1];
const PLATFORM_GRILLE: Tone = [0x1a1c20, 0.55, 0.05];
const GRILLE_DARK: Tone = [0x0b0c0e, 0.85, 0.1];
const PLATE: Tone = [0xd8d4cc, 0.6, 0.1];
// A lamp's roughness and metalness only matter where its unlit lens is drawn in the part batch; the lamp batch overwrites its uv.
const LAMP_HEAD: Tone = [0xf4f1e8, 0.3, 0.1];
const LAMP_TAIL: Tone = [0xc4121c, 0.3, 0.1];
const LAMP_CLEAR: Tone = [0xd8dde2, 0.3, 0.1];
const LAMP_RED: Tone = [0x8a0c12, 0.3, 0.1];
const LAMP_AMBER: Tone = [0xff9a1a, 0.3, 0.1];
const LAMP_SMOKED: Tone = [0x2a1a1c, 0.3, 0.1];
const LAMP_DARK: Tone = [0x0e0f11, 0.3, 0.1];
const RUBBER: Tone = [0x121214, 0.92, 0.05];
const ALLOY: Tone = [0xc9cdd4, 0.28, 0.92];
const DARK_DISC: Tone = [0x1c1d20, 0.7, 0.3];
const HUB: Tone = [0x8a909a, 0.35, 0.8];
const DARK_HUB: Tone = [0x232428, 0.55, 0.45];
const CHROME: Tone = [0xeef0f3, 0.12, 1];
// The far wheel's one disc where the near wheel has spokes over a dark disc: their average at rest, and the blur tone once smeared.
const FAR_DISC: Tone = [0x4a4d53, 0.5, 0.6];
// The lamp unit's housing roughness and metalness are dead: its uv picks an emissive texel, not a tone-grid one.
const LAMP_UNIT_HEAD_HOUSING: Tone = [0x1a1c20, 0, 0];
const LAMP_UNIT_TAIL_HOUSING: Tone = [0x15171a, 0, 0];

/** The one place a car part's look is edited: each registry id draws with one base tone, and ids may share a base. */
const CAR_TONE: Readonly<Record<MaterialId, Tone>> = {
  [MAT.CABIN_CARPET]: CARPET,
  [MAT.CABIN_HARD_PLASTIC]: TRIM,
  [MAT.CABIN_SOFT_TOUCH]: SOFT,
  [MAT.DASH_PLASTIC]: TRIM,
  [MAT.DASH_SOFT_TOUCH]: SOFT,
  [MAT.CABIN_TRIM_BRIGHT]: ACCENT,
  [MAT.CABIN_SCREEN]: GLOSS,
  [MAT.DOOR_CARD]: TRIM,
  [MAT.DOOR_ARMREST]: SOFT,
  [MAT.SPEAKER_CONE]: BLACK,
  [MAT.SEAT_LEATHER]: LEATHER,
  [MAT.SEAT_CLOTH]: INSERT,
  [MAT.SEAT_BASE]: PLASTIC,
  [MAT.STEERING_RIM]: STEER_RIM,
  [MAT.STEERING_HUB]: STEER_HUB,
  [MAT.STEERING_COLUMN]: PLASTIC,
  [MAT.FIREWALL_STEEL]: TRIM,
  [MAT.COWL_PLASTIC]: TRIM,
  [MAT.INNER_FENDER_STEEL]: TRIM,
  [MAT.STRUT_TOWER_STEEL]: ALU,
  [MAT.BAY_UNDERTRAY]: BLACK,
  [MAT.BATTERY_CASE]: PLASTIC,
  [MAT.BATTERY_TERMINAL]: RED,
  [MAT.FUSE_BOX]: PLASTIC,
  [MAT.RESERVOIR]: RESERVOIR_GREY,
  [MAT.LAMP_HOUSING]: PLASTIC,
  [MAT.ENGINE_CAST_IRON]: ENGINE,
  [MAT.ENGINE_ALUMINIUM]: ALU,
  [MAT.ENGINE_COVER]: PLASTIC,
  [MAT.INTAKE_PIPE]: ALU,
  [MAT.INTAKE_RUNNER]: ALU,
  [MAT.AIRBOX]: PLASTIC,
  [MAT.RADIATOR_CORE]: BLACK,
  [MAT.RADIATOR_TANK]: ALU,
  [MAT.FAN_PLASTIC]: PLASTIC,
  [MAT.BRAKE_BOOSTER]: ENGINE,
  [MAT.RUBBER_HOSE]: PLASTIC,
  [MAT.EXHAUST_MANIFOLD]: STEEL,
  [MAT.CRASH_BAR_STEEL]: STEEL,
  [MAT.FRAME_RAIL_STEEL]: BLACK,
  [MAT.TRANSFER_CASE]: RED,
  [MAT.STEERING_BOX]: BLACK,
  [MAT.SUSPENSION_BRACKET]: BLACK,
  [MAT.SHOCK_BODY]: STEEL,
  [MAT.COIL_SPRING]: STEEL,
  [MAT.AXLE_HOUSING]: BLACK,
  [MAT.DIFF_CASE]: ENGINE,
  [MAT.DRIVESHAFT]: STEEL,
  [MAT.SUSPENSION_LINK]: BLACK,
  [MAT.SHOCK_ROD_CHROME]: ALU,
  [MAT.MIRROR_HOUSING]: BODY_PAINT,
  [MAT.MIRROR_HOUSING_CHROME]: CHROME_TRIM,
  [MAT.MIRROR_HOUSING_GLOSS_BLACK]: PIANO_BLACK,
  [MAT.MIRROR_FOOT]: MIRROR_FITTING,
  [MAT.MIRROR_GLASS]: MIRROR_SILVER,
  [MAT.PLATFORM_MIRROR_ARM]: PLATFORM_MIRROR_ARM,
  [MAT.PLATFORM_MIRROR_CAP]: PLATFORM_MIRROR_CAP,
  [MAT.PLATFORM_GRILLE]: PLATFORM_GRILLE,
  [MAT.GRILLE_BACKING]: GRILLE_DARK,
  [MAT.GRILLE_BLACK]: BLACK_PLASTIC,
  [MAT.GRILLE_CHROME]: CHROME_TRIM,
  [MAT.GRILLE_PAINTED]: BODY_PAINT,
  [MAT.LICENCE_PLATE]: PLATE,
  [MAT.WIPER_BLADE]: BLACK_PLASTIC,
  [MAT.WIPER_ARM]: BLACK_PLASTIC,
  [MAT.LAMP_LENS_HEAD]: LAMP_HEAD,
  [MAT.LAMP_LENS_TAIL]: LAMP_TAIL,
  [MAT.LAMP_LENS_CLEAR]: LAMP_CLEAR,
  [MAT.LAMP_LENS_RED]: LAMP_RED,
  [MAT.LAMP_LENS_AMBER]: LAMP_AMBER,
  [MAT.LAMP_LENS_SMOKED]: LAMP_SMOKED,
  [MAT.LAMP_HOUSING_DARK]: LAMP_DARK,
  [MAT.LAMP_BEZEL_BLACK]: BLACK_PLASTIC,
  [MAT.LAMP_BEZEL_CHROME]: CHROME_TRIM,
  [MAT.LAMP_CAVITY]: GRILLE_DARK,
  [MAT.TYRE]: RUBBER,
  [MAT.TYRE_LUG]: RUBBER,
  [MAT.RIM_ALLOY]: ALLOY,
  [MAT.RIM_DISC]: DARK_DISC,
  [MAT.RIM_HUB]: HUB,
  [MAT.RIM_HUB_PAINTED]: DARK_HUB,
  [MAT.RIM_LIP_CHROME]: CHROME,
  [MAT.RIM_DISC_FAR]: FAR_DISC,
  [MAT.LAMP_UNIT_HOUSING_HEAD]: LAMP_UNIT_HEAD_HOUSING,
  [MAT.LAMP_UNIT_HOUSING_TAIL]: LAMP_UNIT_TAIL_HOUSING,
  [MAT.CAR_PAINT]: BODY_PAINT,
  [MAT.CAR_CABIN_TRIM]: TRIM,
  [MAT.BUMPER_PAINTED]: BODY_PAINT,
  [MAT.BUMPER_CHROME]: CHROME_TRIM,
  [MAT.BUMPER_BLACK]: BLACK_PLASTIC,
};

export function carTone(id: MaterialId): Tone {
  const tone = CAR_TONE[id];
  if (!tone) throw new Error(`car-tones: no tone for material id ${id}`);
  return tone;
}
