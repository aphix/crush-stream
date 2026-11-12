import * as THREE from "three";
import type { Stoops } from "../world/openworld/openworld-stoops.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { DETAIL_KEEP_M, DETAIL_NEAR_M, FAR_DRAW, FEET_Y, FIGURE_COLOUR_CACHE_FLOATS, FIGURE_FLOATS, NEAR_DRAW, SIGHT_RADIUS, SLOT_KEEP_DISTANCE_SCALE, SLOTS_PER_DUMMY_MESH } from "./civilian-art-constants.ts";
import { dressOfLook, isPoliceLook, skinOfLook, writeLinearColour } from "./civilian-dress.ts";
import { civilianFigures, type CivilianFigures } from "./civilian-figure.ts";
import { WALK_SPEED } from "./walker-locomotion.ts";
import { PoseSmoothing } from "./civilian-anim-smoothing.ts";
import { poseCivilian } from "./civilian-pose.ts";
import type { DriverLook } from "./driver-look.ts";
import { HIDE_GRACE, type SightField } from "./openworld-sight.ts";

/** What the crowd's drawing asks of the sight field: whether a person is in view. */
export type CrowdSight = Pick<SightField, "seen">;
import { DummyMesh } from "./ragdoll-mesh.ts";
import { dummyGeometry, streetGeometry } from "./dummy-skin.ts";

const NO_SLOT = -1;
const NEAR_DRAW_SQUARED = NEAR_DRAW * NEAR_DRAW;
const FAR_DRAW_SQUARED = FAR_DRAW * FAR_DRAW;
const KEEP_SLOT_SQUARED = SLOT_KEEP_DISTANCE_SCALE * SLOT_KEEP_DISTANCE_SCALE;
const DETAIL_NEAR_SQUARED = DETAIL_NEAR_M * DETAIL_NEAR_M;
const DETAIL_KEEP_SQUARED = DETAIL_KEEP_M * DETAIL_KEEP_M;
const SHIRT_AT = 0;
/** A far figure's gait amplitude is her brain's pace over a walk's, to this most (the near dummies' leg swing stops growing at the same 1.6). */
const FIGURE_MAX_GAIT = 1.6;
const TROUSERS_AT = FIGURE_FLOATS.COLOUR;
const SKIN_AT = FIGURE_FLOATS.COLOUR * 2;

/**
 * The open world's crowd drawn (`CrowdPoses` is the crowd's, read each frame): the nearest civilians as posed dummies (`DummyMesh`,
 * dressed from their look), every other one in view as one instance of a cheap low-poly figure, nothing past `FAR_DRAW`, and nobody
 * the sight field has not seen for `HIDE_GRACE` seconds. Draw calls do not grow with the crowd.
 */
export class CivilianArt {
  readonly group = new THREE.Group();
  readonly dummies: readonly DummyMesh[];
  readonly figures: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Civilians drawn as dummies and as figures by the last `update`. */
  nearDrawn = 0;
  farDrawn = 0;
  private readonly capacity: number;
  /** What keeps a near civilian's pose from snapping when her activity or her walk changes. */
  private readonly smoothing: PoseSmoothing;
  /** The rowhomes' stoops, set once the crowd has them: a civilian walking a door's spur has her feet on its treads. */
  stoops: Stoops | null = null;
  private readonly slotCount: number;
  private readonly detailSlots: number;
  private readonly detailChunks: number;
  private readonly slotOwner: Int32Array;
  private readonly slotLook: Uint32Array;
  private readonly slotOf: Int32Array;
  private readonly nearStamp: Int32Array;
  private readonly nearList: Int32Array;
  /** Per civilian: seconds out of every player's sight (capped at `HIDE_GRACE`), and the stamp of the last frame she was in sight or within her grace. */
  private readonly unseenSeconds: Float32Array;
  private readonly visibleStamp: Int32Array;
  private readonly nearKey: Float32Array;
  private stamp = 0;
  private eyeX = 0;
  private eyeZ = 0;
  private readonly instances: CivilianFigures;
  /** Per civilian: the look her cached figure colours (shirt, trousers, skin, linear) were made from, and whether there are any. */
  private readonly figureLook: Uint32Array;
  private readonly figureCached: Uint8Array;
  private readonly figureColours: Float32Array;
  private readonly dress: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false, outfit: 0, shades: false, face: 0 };

  /** `nearSlots` posed dummies at most (a tier's `NEAR_SLOTS`), the first `detailSlots` of them the full body and the rest the street body; `capacity` civilians at most, the crowd's size. */
  constructor(nearSlots: number, capacity: number, detailSlots = nearSlots) {
    this.capacity = capacity;
    this.smoothing = new PoseSmoothing(capacity);
    this.slotCount = nearSlots;
    this.detailSlots = Math.min(detailSlots, nearSlots);
    this.detailChunks = Math.ceil(this.detailSlots / SLOTS_PER_DUMMY_MESH);
    this.slotOwner = new Int32Array(nearSlots).fill(NO_SLOT);
    this.slotLook = new Uint32Array(nearSlots);
    this.slotOf = new Int32Array(capacity).fill(NO_SLOT);
    this.nearStamp = new Int32Array(capacity);
    this.unseenSeconds = new Float32Array(capacity).fill(HIDE_GRACE);
    this.visibleStamp = new Int32Array(capacity);
    this.nearList = new Int32Array(nearSlots);
    this.nearKey = new Float32Array(nearSlots);
    this.figureLook = new Uint32Array(capacity);
    this.figureCached = new Uint8Array(capacity);
    this.figureColours = new Float32Array(capacity * FIGURE_COLOUR_CACHE_FLOATS);
    this.dummies = [...poolChunks(this.detailSlots, dummyGeometry), ...poolChunks(nearSlots - this.detailSlots, streetGeometry)];
    this.instances = civilianFigures(capacity);
    this.figures = this.instances.mesh;
    this.group.add(...this.dummies, this.figures);
  }

  /** The dummy slot civilian `civilian` was posed in by the last `update`, or -1 (a figure, or not drawn). */
  slotOfCivilian(civilian: number): number {
    return this.slotOf[civilian]!;
  }

  /** Draw the crowd as seen from (`eyeX`, `eyeZ`) by the players `sight` stands for, `wallDt` s after the last frame: once a frame, after the crowd's step. `held` (per civilian, 1: a physical body in the dummies' world stands for her) draws none of them here. */
  update(poses: CrowdPoses, eyeX: number, eyeZ: number, sight: CrowdSight, wallDt: number, held: Uint8Array | null = null): void {
    const count = Math.min(poses.count, this.capacity);
    this.stamp = (this.stamp + 1) | 0;
    this.eyeX = eyeX;
    this.eyeZ = eyeZ;
    this.refreshSight(poses, count, sight, wallDt, held);
    const selected = this.selectNearest(poses, count);
    this.assignSlots(poses, selected);
    this.poseDummies(poses, selected, wallDt);
    this.drawFigures(poses, count);
    this.nearDrawn = selected;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of this.dummies) {
      mesh.material.dispose();
      mesh.dispose();
    }
    this.figures.geometry.dispose();
    this.figures.material.dispose();
    this.figures.dispose();
  }

  /** Every shown civilian within `FAR_DRAW` is asked of the sight field; one unseen for `HIDE_GRACE` seconds is not drawn, and one out of range must be seen again to come back. */
  private refreshSight(poses: CrowdPoses, count: number, sight: CrowdSight, wallDt: number, held: Uint8Array | null): void {
    for (let civilian = 0; civilian < count; civilian++) {
      const dx = poses.x[civilian]! - this.eyeX;
      const dz = poses.z[civilian]! - this.eyeZ;
      if (poses.shown[civilian] === 0 || (held !== null && held[civilian] === 1) || dx * dx + dz * dz > FAR_DRAW_SQUARED) {
        this.unseenSeconds[civilian] = HIDE_GRACE;
        continue;
      }
      const unseen = sight.seen(poses.x[civilian]!, poses.z[civilian]!, SIGHT_RADIUS) ? 0 : Math.min(HIDE_GRACE, this.unseenSeconds[civilian]! + wallDt);
      this.unseenSeconds[civilian] = unseen;
      if (unseen < HIDE_GRACE) this.visibleStamp[civilian] = this.stamp;
    }
  }

  /** `nearList` filled with the shown civilians within `NEAR_DRAW`, nearest first, at most one per slot; a civilian holding a slot counts as nearer than she is. Returns how many. */
  private selectNearest(poses: CrowdPoses, count: number): number {
    const slots = this.slotCount;
    if (slots === 0) return 0;
    let selected = 0;
    for (let civilian = 0; civilian < count; civilian++) {
      if (this.visibleStamp[civilian] !== this.stamp) continue;
      const dx = poses.x[civilian]! - this.eyeX;
      const dz = poses.z[civilian]! - this.eyeZ;
      let key = dx * dx + dz * dz;
      if (this.slotOf[civilian]! !== NO_SLOT) key *= KEEP_SLOT_SQUARED;
      if (key > NEAR_DRAW_SQUARED) continue;
      if (selected === slots && key >= this.nearKey[slots - 1]!) continue;
      let at = selected < slots ? selected++ : slots - 1;
      while (at > 0 && this.nearKey[at - 1]! > key) {
        this.nearKey[at] = this.nearKey[at - 1]!;
        this.nearList[at] = this.nearList[at - 1]!;
        at--;
      }
      this.nearKey[at] = key;
      this.nearList[at] = civilian;
    }
    return selected;
  }

  /** Slots of civilians no longer near are freed; each newly near civilian takes a free slot of the pool her distance wants (full body inside `DETAIL_NEAR_M`, kept to `DETAIL_KEEP_M`; else street), the other pool's when that is full, and is dressed in it. A holder in the other pool moves only into a free slot. */
  private assignSlots(poses: CrowdPoses, selected: number): void {
    for (let k = 0; k < selected; k++) this.nearStamp[this.nearList[k]!] = this.stamp;
    for (let slot = 0; slot < this.slotCount; slot++) {
      const owner = this.slotOwner[slot]!;
      if (owner === NO_SLOT || this.nearStamp[owner] === this.stamp) continue;
      this.slotOwner[slot] = NO_SLOT;
      this.slotOf[owner] = NO_SLOT;
      this.meshOf(slot).hide(this.indexIn(slot));
    }
    for (let k = 0; k < selected; k++) {
      const civilian = this.nearList[k]!;
      const held = this.slotOf[civilian]!;
      const dx = poses.x[civilian]! - this.eyeX;
      const dz = poses.z[civilian]! - this.eyeZ;
      const squared = dx * dx + dz * dz;
      const wantsDetail = squared < DETAIL_NEAR_SQUARED || (held !== NO_SLOT && held < this.detailSlots && squared < DETAIL_KEEP_SQUARED);
      if (held !== NO_SLOT && held < this.detailSlots === wantsDetail) continue;
      let slot = this.lowestFree(wantsDetail);
      if (held === NO_SLOT && slot === NO_SLOT) slot = this.lowestFree(!wantsDetail);
      if (slot === NO_SLOT) continue;
      if (held !== NO_SLOT) {
        this.slotOwner[held] = NO_SLOT;
        this.meshOf(held).hide(this.indexIn(held));
      }
      this.slotOwner[slot] = civilian;
      this.slotOf[civilian] = slot;
      this.dressSlot(slot, poses.look[civilian]!);
    }
  }

  /** The lowest slot no civilian holds in the detail pool (`detail`) or the street pool, or `NO_SLOT`. */
  private lowestFree(detail: boolean): number {
    const from = detail ? 0 : this.detailSlots;
    const to = detail ? this.detailSlots : this.slotCount;
    for (let slot = from; slot < to; slot++) if (this.slotOwner[slot]! === NO_SLOT) return slot;
    return NO_SLOT;
  }

  private meshOf(slot: number): DummyMesh {
    return this.dummies[slot < this.detailSlots ? Math.floor(slot / SLOTS_PER_DUMMY_MESH) : this.detailChunks + Math.floor((slot - this.detailSlots) / SLOTS_PER_DUMMY_MESH)]!;
  }

  private indexIn(slot: number): number {
    return (slot < this.detailSlots ? slot : slot - this.detailSlots) % SLOTS_PER_DUMMY_MESH;
  }

  private dressSlot(slot: number, look: number): void {
    dressOfLook(look, this.dress);
    this.meshOf(slot).dress(this.indexIn(slot), isPoliceLook(look), this.dress);
    this.slotLook[slot] = look;
  }

  /** Each near civilian posed in her slot, dressed again first when her look changed. */
  private poseDummies(poses: CrowdPoses, selected: number, wallDt: number): void {
    this.smoothing.begin(this.stamp, wallDt);
    for (let k = 0; k < selected; k++) {
      const civilian = this.nearList[k]!;
      const slot = this.slotOf[civilian]!;
      if (this.slotLook[slot] !== poses.look[civilian]) this.dressSlot(slot, poses.look[civilian]!);
      poseCivilian(this.meshOf(slot), this.indexIn(slot), poses, civilian, this.smoothing, this.stoops);
    }
  }

  /** Every shown civilian within `FAR_DRAW` that has no dummy, packed into the figures' instances from 0. */
  private drawFigures(poses: CrowdPoses, count: number): void {
    let drawn = 0;
    for (let civilian = 0; civilian < count; civilian++) {
      if (this.visibleStamp[civilian] !== this.stamp || this.nearStamp[civilian] === this.stamp) continue;
      const dx = poses.x[civilian]! - this.eyeX;
      const dz = poses.z[civilian]! - this.eyeZ;
      if (dx * dx + dz * dz > FAR_DRAW_SQUARED) continue;
      this.writeFigure(drawn++, poses, civilian);
    }
    this.farDrawn = drawn;
    this.figures.count = drawn;
    this.figures.visible = drawn > 0;
    if (drawn === 0) return;
    for (let upload = 0; upload < this.instances.uploads.length; upload++) this.instances.uploads[upload]!.needsUpdate = true;
  }

  /** Civilian `civilian`'s linear shirt, trousers and skin colours made from her look and kept until it changes. */
  private cacheFigureColours(look: number, civilian: number): void {
    dressOfLook(look, this.dress);
    const at = civilian * FIGURE_COLOUR_CACHE_FLOATS;
    writeLinearColour(this.dress.shirt, this.figureColours, at + SHIRT_AT);
    writeLinearColour(this.dress.pants, this.figureColours, at + TROUSERS_AT);
    writeLinearColour(skinOfLook(this.dress), this.figureColours, at + SKIN_AT);
    this.figureLook[civilian] = look;
    this.figureCached[civilian] = 1;
  }

  /** Instance `instance` standing where civilian `civilian` does, in her clothes, striding at her phase. */
  private writeFigure(instance: number, poses: CrowdPoses, civilian: number): void {
    if (this.figureCached[civilian] === 0 || this.figureLook[civilian] !== poses.look[civilian]) this.cacheFigureColours(poses.look[civilian]!, civilian);
    const { matrices, shirts, trousers, skins, gaits } = this.instances;
    const matrixAt = instance * FIGURE_FLOATS.MATRIX;
    const colourAt = instance * FIGURE_FLOATS.COLOUR;
    const cacheAt = civilian * FIGURE_COLOUR_CACHE_FLOATS;
    const turnCos = Math.cos(poses.yaw[civilian]!);
    const turnSin = Math.sin(poses.yaw[civilian]!);
    matrices[matrixAt] = turnCos;
    matrices[matrixAt + 1] = 0;
    matrices[matrixAt + 2] = -turnSin;
    matrices[matrixAt + 3] = 0;
    matrices[matrixAt + 4] = 0;
    matrices[matrixAt + 5] = 1;
    matrices[matrixAt + 6] = 0;
    matrices[matrixAt + 7] = 0;
    matrices[matrixAt + 8] = turnSin;
    matrices[matrixAt + 9] = 0;
    matrices[matrixAt + 10] = turnCos;
    matrices[matrixAt + 11] = 0;
    matrices[matrixAt + 12] = poses.x[civilian]!;
    matrices[matrixAt + 13] = FEET_Y + poses.feetY[civilian]!;
    matrices[matrixAt + 14] = poses.z[civilian]!;
    matrices[matrixAt + 15] = 1;
    for (let channel = 0; channel < FIGURE_FLOATS.COLOUR; channel++) {
      shirts[colourAt + channel] = this.figureColours[cacheAt + SHIRT_AT + channel]!;
      trousers[colourAt + channel] = this.figureColours[cacheAt + TROUSERS_AT + channel]!;
      skins[colourAt + channel] = this.figureColours[cacheAt + SKIN_AT + channel]!;
    }
    const gaitAt = instance * FIGURE_FLOATS.GAIT;
    gaits[gaitAt] = poses.stride[civilian]!;
    gaits[gaitAt + 1] = Math.min(FIGURE_MAX_GAIT, poses.speed[civilian]! / WALK_SPEED);
  }
}

/** `slots` posed dummies of `geometry` in meshes of at most `SLOTS_PER_DUMMY_MESH`, none out yet. */
function poolChunks(slots: number, geometry: () => THREE.BufferGeometry): DummyMesh[] {
  return Array.from({ length: Math.ceil(slots / SLOTS_PER_DUMMY_MESH) }, (_, chunk) => {
    const mesh = new DummyMesh(Math.min(SLOTS_PER_DUMMY_MESH, slots - chunk * SLOTS_PER_DUMMY_MESH), false, geometry());
    mesh.castShadow = true;
    return mesh;
  });
}
