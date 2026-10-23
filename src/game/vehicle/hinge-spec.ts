import { GRAVITY } from "../kernel/constants.ts";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { BootSpec, YZ } from "./car-variants.ts";

/** What one car's door or lid swings within (`DoorHinge.spec`): static, never netted. */
export interface HingeSpec {
  /** Hinge line to free edge (m). */
  length: number;
  kg: number;
  /** A uniform slab about one edge, m·L²/3 (kg·m²). */
  inertia: number;
  /** Dry friction and detent in the hinge (rad/s²): a swing drive under this moves nothing. */
  dry: number;
  /** The stop (rad open). */
  stop: number;
  /** Open angle (rad) the crash jams it at per unit of `hingeT`. */
  jam: number;
  /** A hit that raises `hingeT` past this unlatches it. */
  ajar: number;
  /** Energy the stop takes before it tears off (J). */
  tearJ: number;
  /** One slam shut this hard tears it off (J). */
  slamJ: number;
  /** A hit that raises `hingeT` past `tearT` at `tearMps` EBS or faster tears it off. */
  tearT: number;
  tearMps: number;
  /** Doors: the right door's hinge in plan (car x, z). */
  hx: number;
  hz: number;
  /** Lids: +1 opens turning about +x (front or top hinge), −1 about −x (a drop gate's bottom hinge). */
  dir: number;
  /** Lids: the unit chord, hinge to free edge, at rest (car y, z). */
  uy: number;
  uz: number;
  /** Lids: the struts' share of its weight; 1 holds it wherever it is left on a level car. */
  lift: number;
}

/** A style's lid (`BodyStyle.boot.swing`): a new car picks a preset or writes its own. */
export interface LidSwing {
  kg: number;
  /** The chord's rise above level, rearward, on the stop (rad). */
  rise: number;
  lift: number;
  ajar: number;
  tearT: number;
  tearMps: number;
  tearJ: number;
  slamJ: number;
}

/** Open angle per unit of crash hinge value: the crushed lid's turn since before lids swung. */
const LID_JAM = 0.5;
/** Dry friction and detent in a lid's hinge (rad/s²): a jostle leaves the lid where it hangs. */
const LID_DRY = 2;

/** Latch and tear bars shared by the presets: the doors' (C1), a rear hit for a side one. */
const LID_LATCH = { ajar: 0.2, tearT: 0.5, tearMps: 12.5 } as const;

/** Deck lid: 12.4 kg (2011 Accord teardown, NHTSA DOT HS 811 666); torsion bars lift a released lid to ~63°. Hinge energies guessed under a door's. */
const TRUNK_LID: LidSwing = { kg: 12.4, rise: 1.1, lift: 1.5, ...LID_LATCH, tearJ: 150, slamJ: 250 };
/** Gas struts hold a hatch or liftgate's chord this far above level (rad, ~17°): head room under its edge. */
const STRUT_RISE = 0.3;
/** Hatch with its glass (guessed 18 kg), on gas struts. */
const HATCH_LID: LidSwing = { kg: 18, rise: STRUT_RISE, lift: 1.5, ...LID_LATCH, tearJ: 200, slamJ: 300 };
/** SUV liftgate, glass and all (guessed 26 kg), on gas struts. */
export const LIFTGATE: LidSwing = { kg: 26, rise: STRUT_RISE, lift: 1.5, ...LID_LATCH, tearJ: 300, slamJ: 400 };
/** Pickup drop gate: 22 kg steel (20–30 kg typical), let down level on two cables, rated far above its own ~60 J drop. */
const DROP_GATE: LidSwing = { kg: 22, rise: 0, lift: 0, ...LID_LATCH, tearJ: 450, slamJ: 400 };

/** Where the boot turns (car [y, z]): its `pivot`, else the panel's own hinge edge. */
export function bootPivot(boot: BootSpec): YZ {
  return boot.pivot ?? boot.origin;
}

/** A chord rising more steeply than this from its hinge stands above it: a drop gate, opening rearward-down. */
const UPRIGHT_CHORD = Math.SQRT1_2;

/** A hinge this far (m) above the panel's own top edge is on the roof: a hatch or liftgate, carrying the rear glass. */
const ROOF_HINGE_RISE = 0.2;

/** Whether the boot is a roof-hinged hatch or liftgate (it carries the rear window). */
export function roofHinged(boot: BootSpec): boolean {
  return bootPivot(boot)[0] - boot.origin[0] > ROOF_HINGE_RISE;
}

/** The lid's hinge from its style: the free edge is the panel's edge farthest from the pivot. */
export function lidSpec(boot: BootSpec): HingeSpec {
  const [py, pz] = bootPivot(boot);
  let fy: number;
  let fz: number;
  if (boot.kind === "lid") {
    fy = boot.drop?.y ?? boot.origin[0];
    fz = boot.drop?.z ?? boot.z1;
  } else {
    const by = boot.y0;
    const bz = boot.z0 ?? boot.origin[1];
    const [ty, tz] = boot.origin;
    const bottom = hypot2(by - py, bz - pz) >= hypot2(ty - py, tz - pz);
    fy = bottom ? by : ty;
    fz = bottom ? bz : tz;
  }
  const length = hypot2(fy - py, fz - pz);
  const uy = (fy - py) / length;
  const uz = (fz - pz) / length;
  const dir = uy > UPRIGHT_CHORD ? -1 : 1;
  const s = boot.swing ?? (dir < 0 ? DROP_GATE : boot.kind === "lid" && !roofHinged(boot) ? TRUNK_LID : HATCH_LID);
  return {
    length,
    kg: s.kg,
    inertia: (s.kg * length * length) / 3,
    dry: LID_DRY,
    stop: dir * (s.rise - detAtan2(uy, -uz)),
    jam: LID_JAM,
    ajar: s.ajar,
    tearJ: s.tearJ,
    slamJ: s.slamJ,
    tearT: s.tearT,
    tearMps: s.tearMps,
    hx: 0,
    hz: 0,
    dir,
    uy,
    uz,
    lift: s.lift,
  };
}

/**
 * Opening acceleration (rad/s²) of lid `s` open `theta`, a uniform slab turning about car x: its weight (`upY`, `upZ`: the world's up in
 * car y and z), the struts' `lift` against it, and the car's forward acceleration `az` (m/s²) as a pseudo force. Its virtual work per rad
 * is ∫ r (∂p/∂θ)·F dm = m·L/2 · n·F, with n the chord turned a quarter toward opening.
 */
export function lidAccel(s: HingeSpec, theta: number, upY: number, upZ: number, az: number): number {
  const turn = s.dir * theta;
  const c = detCos(turn);
  const sn = detSin(turn);
  const cy = s.uy * c - s.uz * sn;
  const cz = s.uy * sn + s.uz * c;
  const fy = GRAVITY * (s.lift - upY);
  const fz = -GRAVITY * upZ - az;
  return (s.dir * 3 * (fz * cy - fy * cz)) / (2 * s.length);
}
