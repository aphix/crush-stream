import * as THREE from "three";
import { SPECIES, SPECIES_SPEED } from "../ai/civilians/civilian-constants.ts";
import { CAT_COAT, DOG_COAT, DOWNED_LIFE_SECONDS, LOOK, STRIDE_RADIANS_PER_METRE } from "../ai/civilians/civilian-crowd-constants.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import { ANIMAL_SHAPES, animalFigures, type AnimalFigures, COLOUR_FLOATS, MATRIX_FLOATS, POSE_FLOATS } from "./animal-figure.ts";
import { FAR_DRAW, FEET_Y, SIGHT_RADIUS } from "./civilian-art-constants.ts";
import type { CrowdSight } from "./civilian-art.ts";
import { HIDE_GRACE } from "./openworld-sight.ts";

const FAR_DRAW_SQUARED = FAR_DRAW * FAR_DRAW;
/** An animal slower than this (m/s) is still: it sits, then lies down. */
const STILL_SPEED = 0.05;
/** Seconds a still animal sits before it lies down: a cat settles quicker than a dog (tuned by feel). */
const LIE_AFTER_SECONDS: Readonly<Record<number, number>> = { [SPECIES.cat]: 8, [SPECIES.dog]: 20 };
/** The time constant (s) a pose eases into sitting, lying or standing with: tuned by feel. */
const POSTURE_TAU = 0.4;
/** Figures per species at once: the cast has five cats and a dog; room for a city that keeps more. */
const ANIMAL_SLOTS = 16;
/** Animals run down at once, lying where they were struck. */
const DOWNED_SLOTS = 4;

/** Coat and accent (paws, muzzle) of each coat (sRGB), in `CAT_COAT` and `DOG_COAT` order: picked to read as the cast's descriptions (an orange cat, a black cat with white socks, a tabby, a tan dog). */
const CAT_COATS: readonly (readonly [number, number])[] = [
  [0xd9822b, 0xf3e3c8],
  [0x1c1c1f, 0x2a2a2e],
  [0x1c1c1f, 0xf2f2f0],
  [0x8a7656, 0xd8cdb6],
  [0x7d8088, 0xc9cbd0],
  [0xe8d8b8, 0xf6efe2],
];
const DOG_COATS: readonly (readonly [number, number])[] = [
  [0xb98a52, 0xe8d6b8],
  [0x202024, 0x8a6a48],
  [0x6b4428, 0xc9a27a],
  [0xeceae4, 0xd8c8b0],
];

/** A species' coats as linear floats, coat then accent per entry. */
function linearCoats(coats: readonly (readonly [number, number])[]): Float32Array {
  const out = new Float32Array(coats.length * 2 * COLOUR_FLOATS);
  const colour = new THREE.Color();
  for (let at = 0; at < coats.length; at++) {
    colour.set(coats[at]![0]).toArray(out, at * 2 * COLOUR_FLOATS);
    colour.set(coats[at]![1]).toArray(out, (at * 2 + 1) * COLOUR_FLOATS);
  }
  return out;
}

/** One species' figures, its coats and the instances written this frame. */
type Kind = { species: number; figures: AnimalFigures; coats: Float32Array; coatCount: number; drawn: number };

/**
 * The open world's cats and dogs (the crowd's residents of another species, `CrowdPoses`): one instanced draw per species, every shown animal within `FAR_DRAW` that the sight field has seen within
 * `HIDE_GRACE`, standing at the crowd's spot, its legs swung by its stride, sitting and then lying down while still; one run down lies on its side where it was struck. Allocates nothing a frame.
 */
export class AnimalArt {
  readonly group = new THREE.Group();
  private readonly kinds: readonly Kind[];
  private readonly unseenSeconds: Float32Array;
  private readonly sit: Float32Array;
  private readonly lie: Float32Array;
  private readonly downedLook = new Uint32Array(DOWNED_SLOTS);
  private readonly downedX = new Float32Array(DOWNED_SLOTS);
  private readonly downedZ = new Float32Array(DOWNED_SLOTS);
  private readonly downedYaw = new Float32Array(DOWNED_SLOTS);
  private readonly downedUntil = new Float64Array(DOWNED_SLOTS);
  private downedNext = 0;
  private clock = 0;

  /** For a crowd of `capacity` residents. */
  constructor(capacity: number) {
    this.group.name = "openworld-animals";
    this.kinds = [
      { species: SPECIES.cat, figures: animalFigures(SPECIES.cat, ANIMAL_SLOTS + DOWNED_SLOTS), coats: linearCoats(CAT_COATS), coatCount: Object.keys(CAT_COAT).length, drawn: 0 },
      { species: SPECIES.dog, figures: animalFigures(SPECIES.dog, ANIMAL_SLOTS + DOWNED_SLOTS), coats: linearCoats(DOG_COATS), coatCount: Object.keys(DOG_COAT).length, drawn: 0 },
    ];
    for (const kind of this.kinds) this.group.add(kind.figures.mesh);
    this.unseenSeconds = new Float32Array(capacity).fill(HIDE_GRACE);
    this.sit = new Float32Array(capacity);
    this.lie = new Float32Array(capacity);
    this.downedUntil.fill(-Infinity);
  }

  /** The figures of species `species` (`SPECIES.cat` or `dog`). */
  figuresOf(species: number): AnimalFigures {
    return this.kinds[species === SPECIES.cat ? 0 : 1]!.figures;
  }

  /** Animal `strike.guard` (look word `look`) was run down: it lies on its side where it was struck, facing the way it was thrown, for `DOWNED_LIFE_SECONDS`. */
  knocked(strike: Pick<FigureStrike, "x" | "z" | "vx" | "vz">, look: number): void {
    const slot = this.downedNext;
    this.downedNext = (slot + 1) % DOWNED_SLOTS;
    this.downedLook[slot] = look;
    this.downedX[slot] = strike.x;
    this.downedZ[slot] = strike.z;
    this.downedYaw[slot] = Math.atan2(strike.vx, strike.vz);
    this.downedUntil[slot] = this.clock + DOWNED_LIFE_SECONDS;
  }

  /** A frame: the animals of `poses` drawn as seen from (`eyeX`, `eyeZ`) by the players `sight` stands for, `wallDt` s after the last. */
  update(poses: CrowdPoses, eyeX: number, eyeZ: number, sight: CrowdSight, wallDt: number): void {
    this.clock += wallDt;
    const ease = 1 - Math.exp(-wallDt / POSTURE_TAU);
    for (let at = 0; at < this.kinds.length; at++) this.kinds[at]!.drawn = 0;
    const count = Math.min(poses.count, this.unseenSeconds.length);
    for (let resident = 0; resident < count; resident++) {
      const species = poses.look[resident]! >>> LOOK.speciesShift;
      const dx = poses.x[resident]! - eyeX;
      const dz = poses.z[resident]! - eyeZ;
      if (poses.shown[resident] === 0 || species === SPECIES.person || dx * dx + dz * dz > FAR_DRAW_SQUARED) {
        this.unseenSeconds[resident] = HIDE_GRACE;
        continue;
      }
      const unseen = sight.seen(poses.x[resident]!, poses.z[resident]!, SIGHT_RADIUS) ? 0 : Math.min(HIDE_GRACE, this.unseenSeconds[resident]! + wallDt);
      this.unseenSeconds[resident] = unseen;
      if (unseen >= HIDE_GRACE) continue;
      this.easePosture(poses, resident, species, ease);
      const kind = this.kindOf(species);
      if (kind.drawn >= ANIMAL_SLOTS) continue;
      const shape = ANIMAL_SHAPES[species]!;
      const phase = (poses.stride[resident]! / STRIDE_RADIANS_PER_METRE) * ((2 * Math.PI) / shape.stride);
      const gait = Math.min(1, poses.speed[resident]! / SPECIES_SPEED[species]!);
      this.write(kind, poses.look[resident]!, poses.x[resident]!, FEET_Y + poses.feetY[resident]!, poses.z[resident]!, poses.yaw[resident]!, false, phase, gait, this.sit[resident]!, this.lie[resident]!);
    }
    this.drawDowned();
    for (let at = 0; at < this.kinds.length; at++) this.finish(this.kinds[at]!);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const kind of this.kinds) {
      kind.figures.mesh.geometry.dispose();
      kind.figures.mesh.material.dispose();
      kind.figures.mesh.dispose();
    }
  }

  private kindOf(species: number): Kind {
    return this.kinds[species === SPECIES.cat ? 0 : 1]!;
  }

  /** Still: sitting, then after `LIE_AFTER_SECONDS` of rest (the crowd's `activityClock`) lying; moving: standing. Eased toward it. */
  private easePosture(poses: CrowdPoses, resident: number, species: number, ease: number): void {
    const still = poses.speed[resident]! < STILL_SPEED;
    const lying = still && poses.activityClock[resident]! >= LIE_AFTER_SECONDS[species]!;
    this.sit[resident] = this.sit[resident]! + ((still && !lying ? 1 : 0) - this.sit[resident]!) * ease;
    this.lie[resident] = this.lie[resident]! + ((lying ? 1 : 0) - this.lie[resident]!) * ease;
  }

  /** The run-down animals still lying, after this frame's living ones. */
  private drawDowned(): void {
    for (let slot = 0; slot < DOWNED_SLOTS; slot++) {
      if (!(this.clock < this.downedUntil[slot]!)) continue;
      const look = this.downedLook[slot]!;
      const species = look >>> LOOK.speciesShift;
      const kind = this.kindOf(species);
      this.write(kind, look, this.downedX[slot]!, FEET_Y + ANIMAL_SHAPES[species]!.bodyHalfWidth, this.downedZ[slot]!, this.downedYaw[slot]!, true, 0, 0, 0, 1);
    }
  }

  /** The next instance of `kind` at (x, y, z) facing `yaw` (on its side when `fallen`), in the coat of `look`, in the pose given. */
  private write(kind: Kind, look: number, x: number, y: number, z: number, yaw: number, fallen: boolean, phase: number, gait: number, sit: number, lie: number): void {
    const instance = kind.drawn++;
    const { matrices, poses, coats, accents } = kind.figures;
    const m = instance * MATRIX_FLOATS;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // Standing: a turn by `yaw` about y. Fallen: then rolled a quarter onto its side (its x axis is the world's up).
    matrices[m] = fallen ? 0 : cos;
    matrices[m + 1] = fallen ? 1 : 0;
    matrices[m + 2] = fallen ? 0 : -sin;
    matrices[m + 3] = 0;
    matrices[m + 4] = fallen ? -cos : 0;
    matrices[m + 5] = fallen ? 0 : 1;
    matrices[m + 6] = fallen ? sin : 0;
    matrices[m + 7] = 0;
    matrices[m + 8] = sin;
    matrices[m + 9] = 0;
    matrices[m + 10] = cos;
    matrices[m + 11] = 0;
    matrices[m + 12] = x;
    matrices[m + 13] = y;
    matrices[m + 14] = z;
    matrices[m + 15] = 1;
    const p = instance * POSE_FLOATS;
    poses[p] = phase;
    poses[p + 1] = gait;
    poses[p + 2] = sit;
    poses[p + 3] = lie;
    const coat = ((look & LOOK.hashMask) % kind.coatCount) * 2 * COLOUR_FLOATS;
    const c = instance * COLOUR_FLOATS;
    for (let channel = 0; channel < COLOUR_FLOATS; channel++) {
      coats[c + channel] = kind.coats[coat + channel]!;
      accents[c + channel] = kind.coats[coat + COLOUR_FLOATS + channel]!;
    }
  }

  private finish(kind: Kind): void {
    const { mesh, uploads } = kind.figures;
    mesh.count = kind.drawn;
    mesh.visible = kind.drawn > 0;
    if (kind.drawn === 0) return;
    for (let at = 0; at < uploads.length; at++) uploads[at]!.needsUpdate = true;
  }
}
