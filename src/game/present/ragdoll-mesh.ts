import * as THREE from "three";
import { JEANS, type DriverLook } from "./driver-look.ts";
import { PARTS } from "./ragdoll-body.ts";
import { applySpray, BARE_SPRAY, sprayUniforms, type SprayBitmap } from "./spray.ts";
import { PERSON_SPRAY } from "../match/look-data.ts";
import { BODY_REACH_M, BONES_ATTRIBUTE, BUILD, FLAGS_AT, isDrawn, KINDS_ATTRIBUTE, ORBS_AT, PALETTE_AT, ROW_TEXELS, SHAPE_PORTLY_ATTRIBUTE, SHAPE_WOMAN_ATTRIBUTE, skinPoint } from "./dummy-rig.ts";
import { dressRow } from "./dummy-dress.ts";
import { BustSprings } from "./dummy-jiggle.ts";
import { applyDolls } from "./dummy-shader.ts";
import { dummyGeometry } from "./dummy-skin.ts";
import { personSprayDepthTexture } from "./spray-depth.ts";

/** A stalled frame steps her bust at most this long (s). */
const MAX_FRAME = 0.05;
const _o = new THREE.Vector3();
const _lag = new THREE.Vector3();
const IDENTITY = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
/** The tallest texture every WebGL2 device takes (`MAX_TEXTURE_SIZE`'s guaranteed minimum): a sprayed mesh's atlas stays within it. */
const MAX_ATLAS_SIDE = 2048;
/** Floats per vertex in the kinds and bones attributes (`dummySkin`'s vec4s), and in a body shape other than the man's (`position`: 3). */
const VEC4 = 4;

/** A pick's hit: the slot (-1: none), the world point and its distance along the ray (m). */
type MeshHit = { slot: number; x: number; y: number; z: number; along: number };

/** The shape attribute a slot's build is drawn in. */
function shapeOf(flags: number): string {
  return (flags & BUILD.WOMAN) !== 0 ? SHAPE_WOMAN_ATTRIBUTE : (flags & BUILD.PORTLY) !== 0 ? SHAPE_PORTLY_ATTRIBUTE : "position";
}

function shapeSize(shape: string): number {
  return shape === "position" ? 3 : VEC4;
}

/** The float array behind `geometry`'s attribute `name`, which must be a plain one of `size` floats a vertex (so item i starts at i * size). */
function floatsOf(geometry: THREE.BufferGeometry, name: string, size: number): Float32Array {
  const attribute = geometry.getAttribute(name);
  if (!(attribute instanceof THREE.BufferAttribute) || !(attribute.array instanceof Float32Array) || attribute.normalized || attribute.itemSize !== size) throw new Error(`dummy attribute ${name}: not a plain float attribute of ${size}`);
  return attribute.array;
}

/** Room (m) the reach test leaves for the float32 points the triangles are tested on. */
const PICK_SLACK = 1e-3;

/** Each vertex's bone pair (its group), and per group the rest ball its vertices lie in for every build: posed, they lie within that ball's radius of the segment between its centre carried by bone a and by bone b. */
type PickGroups = {
  ofVertex: Uint16Array;
  /** Per triangle, its vertices' one group, or -1 when they span several (then always skinned and tested). */
  ofTriangle: Int16Array;
  always: Uint8Array;
  a: Uint8Array;
  b: Uint8Array;
  centre: Float32Array;
  radius: Float32Array;
  /** The greatest weight a group's vertices give each bust lag. */
  orbA: Float32Array;
  orbB: Float32Array;
  /** This pick's answer per group: 1 when the ray passes within reach. */
  hit: Uint8Array;
};

function pickGroupsOf(geometry: THREE.BufferGeometry): PickGroups {
  const { ofVertex, a, b } = bonePairs(floatsOf(geometry, BONES_ATTRIBUTE, VEC4));
  return { ofVertex, ...triangleGroups(geometry.index!, ofVertex), a, b, ...restBalls(geometry, ofVertex, a.length), hit: new Uint8Array(a.length) };
}

/** Each vertex's group: one per bone pair it blends between. */
function bonePairs(bones: Float32Array): Pick<PickGroups, "ofVertex" | "a" | "b"> {
  const count = bones.length / VEC4;
  const keys = new Map<number, number>();
  const ofVertex = new Uint16Array(count);
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < count; i++) {
    const w = bones[i * VEC4 + 2]!;
    // A vertex wholly on one bone is that bone's rigidly: a ball, not a capsule.
    const first = Math.round(bones[i * VEC4 + (w === 1 ? 1 : 0)]!);
    const second = w === 0 || w === 1 ? first : Math.round(bones[i * VEC4 + 1]!);
    const key = first * 256 + second;
    let group = keys.get(key);
    if (group === undefined) {
      group = a.length;
      keys.set(key, group);
      a.push(first);
      b.push(second);
    }
    ofVertex[i] = group;
  }
  return { ofVertex, a: Uint8Array.from(a), b: Uint8Array.from(b) };
}

/** Per group, the rest ball (centre, radius) its vertices lie in for all three builds, and its greatest bust-lag weights. */
function restBalls(geometry: THREE.BufferGeometry, ofVertex: Uint16Array, groups: number): Pick<PickGroups, "centre" | "radius" | "orbA" | "orbB"> {
  const shapes = [floatsOf(geometry, "position", 3), floatsOf(geometry, SHAPE_WOMAN_ATTRIBUTE, VEC4), floatsOf(geometry, SHAPE_PORTLY_ATTRIBUTE, VEC4)] as const;
  const sizes = [3, VEC4, VEC4] as const;
  const kinds = floatsOf(geometry, KINDS_ATTRIBUTE, VEC4);
  const sum = new Float64Array(groups * 4);
  for (let i = 0; i < ofVertex.length; i++) {
    const g = ofVertex[i]!;
    for (let k = 0; k < 3; k++) for (let axis = 0; axis < 3; axis++) sum[g * 4 + axis] += shapes[k][i * sizes[k] + axis]!;
    sum[g * 4 + 3] += 3;
  }
  const centre = new Float32Array(groups * 3);
  for (let g = 0; g < groups; g++) for (let axis = 0; axis < 3; axis++) centre[g * 3 + axis] = sum[g * 4 + axis]! / sum[g * 4 + 3]!;
  const radius = new Float32Array(groups);
  const orbA = new Float32Array(groups);
  const orbB = new Float32Array(groups);
  for (let i = 0; i < ofVertex.length; i++) {
    const g = ofVertex[i]!;
    for (let k = 0; k < 3; k++) {
      const at = i * sizes[k];
      radius[g] = Math.max(radius[g]!, Math.sqrt((shapes[k][at]! - centre[g * 3]!) ** 2 + (shapes[k][at + 1]! - centre[g * 3 + 1]!) ** 2 + (shapes[k][at + 2]! - centre[g * 3 + 2]!) ** 2));
    }
    orbA[g] = Math.max(orbA[g]!, Math.abs(kinds[i * VEC4 + 2]!));
    orbB[g] = Math.max(orbB[g]!, Math.abs(kinds[i * VEC4 + 3]!));
  }
  return { centre, radius, orbA, orbB };
}

/** Each triangle's one group, or -1 with its vertices marked always skinned when they span groups. */
function triangleGroups(index: THREE.BufferAttribute, ofVertex: Uint16Array): Pick<PickGroups, "ofTriangle" | "always"> {
  const ofTriangle = new Int16Array(index.count / 3);
  const always = new Uint8Array(ofVertex.length);
  for (let t = 0; t < index.count; t += 3) {
    const g = ofVertex[index.getX(t)]!;
    if (ofVertex[index.getX(t + 1)] === g && ofVertex[index.getX(t + 2)] === g) {
      ofTriangle[t / 3] = g;
      continue;
    }
    ofTriangle[t / 3] = -1;
    for (let k = 0; k < 3; k++) always[index.getX(t + k)] = 1;
  }
  return { ofTriangle, always };
}

/**
 * Every dummy in one instanced draw: one continuous body per slot (`dummyGeometry`), skinned in the vertex shader from the slot's ten
 * part poses (`pose`) and coloured by its look (`dress`); the instance is the slot. The draw ends after the highest slot with a dummy out.
 */
export class DummyMesh extends THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  /** Slots with a dummy out, a bit each. */
  private shown = 0;
  /** Every slot's row of bone transforms (translation, rotation: `PARTS` rest to pose), role colours, flags and bust lag. */
  private readonly rows: Float32Array;
  private readonly bust: BustSprings;
  /** The wall clock (s) at the last jiggle. */
  private clock = 0;
  /** The sim's share of wall time (the engine sets it each frame): in slow-mo the bust moves as slowly as the body. */
  timeScale = 1;
  private readonly dolls: THREE.DataTexture;
  /** Per slot, its row's span in `rows` (floats), kept to hand three's update ranges without making one a frame. */
  private readonly rowRanges: { start: number; count: number }[];
  /** The first `sprayedSlots` slots' sprays (`PERSON_SPRAY`), one bitmap's rows per slot, slot 0 lowest; null on a mesh whose slots wear none, which samples `BARE_SPRAY`. */
  private readonly sprayRgba: Uint8Array | null;
  private readonly sprayAtlas: THREE.DataTexture;
  /** The slot whose head and torso the camera does not see (-1: none): a first-person eye stands in that dummy. Its shadow keeps them. */
  readonly viewHidden = { value: -1 };
  /** What a pick skins a slot's vertices into, and which of them the slot draws (made at the first pick). */
  private pickPoints: Float32Array | null = null;
  private pickDrawn: Uint8Array | null = null;
  private pickGroups: PickGroups | null = null;

  /**
   * `sprayed`: its slots wear sprays (`spray`: the thrown drivers, the garage's); the course's figures wear none and hold no atlas.
   * `sprayedSlots`: how many of its first slots the atlas holds sprays of (the rest draw none): the dummy pool holds four, whatever it grows to.
   * `geometry`: `dummyGeometry` or a view of it on the same attributes (`seatedGeometry`).
   */
  constructor(slots: number, sprayed = false, geometry: THREE.BufferGeometry = dummyGeometry(), sprayedSlots = slots) {
    super(geometry, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 }), slots);
    this.rows = new Float32Array(slots * ROW_TEXELS * 4);
    this.bust = new BustSprings(slots);
    this.dolls = new THREE.DataTexture(this.rows, ROW_TEXELS, slots, THREE.RGBAFormat, THREE.FloatType);
    this.rowRanges = Array.from({ length: slots }, (_, s) => ({ start: s * ROW_TEXELS * 4, count: ROW_TEXELS * 4 }));
    this.sprayRgba = sprayed ? new Uint8Array(PERSON_SPRAY.w * PERSON_SPRAY.h * 4 * sprayedSlots) : null;
    this.sprayAtlas = this.sprayRgba ? sprayAtlas(this.sprayRgba, sprayedSlots) : BARE_SPRAY;
    this.customDepthMaterial = new THREE.MeshDepthMaterial();
    applyDolls(this.customDepthMaterial, this.dolls, false, this.viewHidden);
    applyDolls(this.material, this.dolls, true, this.viewHidden);
    // The posed body is wherever its parts are: nothing to cull against, and the instance transforms only hide.
    this.frustumCulled = false;
    applySpray(this.material, sprayUniforms(PERSON_SPRAY, this.sprayAtlas, this.sprayRgba ? sprayedSlots : 1, sprayed ? { map: personSprayDepthTexture() } : null), "", "vSprayP = position;\nvSprayN = normal;\nvSprayRow = float(gl_InstanceID);", sprayed ? "dummy-depth" : "dummy");
    this.material.addEventListener("dispose", () => {
      if (this.sprayAtlas !== BARE_SPRAY) this.sprayAtlas.dispose();
      this.dolls.dispose();
      this.customDepthMaterial!.dispose();
    });
    for (let s = 0; s < slots; s++) {
      this.setMatrixAt(s, HIDDEN);
      this.dress(s, false, { woman: false, shirt: 0x2b2d32, pants: JEANS, hair: 0x2a1d15, hat: null, mustache: false });
    }
    this.count = 0;
    this.onBeforeRender = () => {
      const now = performance.now() * 0.001;
      this.jiggle(Math.min(MAX_FRAME, now - this.clock));
      this.clock = now;
      this.uploadDrawnRows();
    };
    // The shadow pass draws first and uploads the bone texture before `onBeforeRender` runs.
    this.onBeforeShadow = () => this.uploadDrawnRows();
  }

  /** The next upload of the bone texture takes the rows of the slots the draw ends after (`count`) and no others. One range a row: three's partial upload copies a range along one row. Nothing drawn: a whole upload, if one is due. */
  private uploadDrawnRows(): void {
    const ranges = this.dolls.updateRanges;
    ranges.length = 0;
    for (let s = 0; s < this.count; s++) ranges.push(this.rowRanges[s]!);
  }

  /** Every woman out stepped `dt` wall seconds, slowed by `timeScale`: her bust's two particles chase her torso's pose; the rows upload only when a lag moved. */
  jiggle(dt: number): void {
    dt *= this.timeScale;
    let moved = false;
    for (let s = 0; s < this.count; s++) {
      if (((this.shown >> s) & 1) === 0 || (this.flagsOf(s) & BUILD.WOMAN) === 0) continue;
      moved = this.bust.step(this.rows, s, dt) || moved;
    }
    if (moved) this.dolls.needsUpdate = true;
  }

  /** Slot `s`'s bust at rest on its torso from its next step: no lag left from another figure or another place. */
  private settleBust(s: number): void {
    this.bust.reset(s);
    this.rows.fill(0, (s * ROW_TEXELS + ORBS_AT) * 4, (s * ROW_TEXELS + ORBS_AT + 2) * 4);
  }

  /** Slot `s`'s clothes, face and build from `look` (`dressRow`), or (`cop`) a police uniform over the driver's own hair and face. */
  dress(s: number, cop: boolean, look: DriverLook): void {
    dressRow(this.rows, s * ROW_TEXELS * 4, cop, look);
    this.settleBust(s);
    this.dolls.needsUpdate = true;
  }

  /** Slot `s` wears `spray`'s paint (a `PERSON_SPRAY` bitmap), or none. Only a `sprayed` mesh's first `sprayedSlots` slots wear any: clearing a slot past them is a no-op (there is nothing to clear, so no upload), painting one throws. */
  spray(s: number, spray: SprayBitmap | null): void {
    if (!this.sprayRgba) throw new Error("DummyMesh.spray on a mesh built without sprays");
    const at = s * PERSON_SPRAY.w * PERSON_SPRAY.h * 4;
    if (!spray && at >= this.sprayRgba.length) return;
    if (spray) this.sprayRgba.set(spray.rgba, at);
    else this.sprayRgba.fill(0, at, at + PERSON_SPRAY.w * PERSON_SPRAY.h * 4);
    this.sprayAtlas.needsUpdate = true;
  }

  /** Slot `s`'s body part `k` at pose `p`, `q`: the bone the skin blends its vertices from (translation `p - q c`, so the part's centre `c` standing lands on `p`). */
  pose(s: number, k: number, p: THREE.Vector3, q: THREE.Quaternion): void {
    if (((this.shown >> s) & 1) === 0) {
      this.shown |= 1 << s;
      this.count = 32 - Math.clz32(this.shown);
      this.setMatrixAt(s, IDENTITY);
      this.instanceMatrix.needsUpdate = true;
    }
    const c = PARTS[k]!.c;
    _o.set(c[0], c[1], c[2]).applyQuaternion(q);
    const at = (s * ROW_TEXELS + 2 * k) * 4;
    this.rows[at] = p.x - _o.x;
    this.rows[at + 1] = p.y - _o.y;
    this.rows[at + 2] = p.z - _o.z;
    this.rows[at + 4] = q.x;
    this.rows[at + 5] = q.y;
    this.rows[at + 6] = q.z;
    this.rows[at + 7] = q.w;
    this.dolls.needsUpdate = true;
  }

  /** Slot `s`'s eyes turned in its head by `yaw` (toward its +x) and `pitch` (down) rad: the face print's irises shift by them. Hiding or dressing the slot centres them. */
  eyes(s: number, yaw: number, pitch: number): void {
    const at = (s * ROW_TEXELS + ORBS_AT) * 4 + 3;
    if (this.rows[at] === Math.fround(yaw) && this.rows[at + 4] === Math.fround(pitch)) return;
    this.rows[at] = yaw;
    this.rows[at + 4] = pitch;
    this.dolls.needsUpdate = true;
  }

  hide(s: number): void {
    this.shown &= ~(1 << s);
    this.count = 32 - Math.clz32(this.shown);
    this.setMatrixAt(s, HIDDEN);
    this.instanceMatrix.needsUpdate = true;
    this.settleBust(s);
  }

  /** Point `rest` of the standing body (m), carried by slot `s`'s part `k` as posed now, in the world, into `out`. */
  partPoint(s: number, k: number, rest: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const at = (s * ROW_TEXELS + 2 * k) * 4;
    return out.copy(rest).applyQuaternion(_q.fromArray(this.rows, at + 4)).add(_o.fromArray(this.rows, at)).applyMatrix4(this.matrixWorld);
  }

  /** Vertex `i` of slot `s` as posed now (her bust's lag too) into `out`; false when the slot's build does not draw it. */
  posed(s: number, i: number, out: THREE.Vector3): boolean {
    const flags = this.flagsOf(s);
    const shape = shapeOf(flags);
    return this.posedFrom(s, i, flags, floatsOf(this.geometry, shape, shapeSize(shape)), shapeSize(shape), floatsOf(this.geometry, KINDS_ATTRIBUTE, VEC4), floatsOf(this.geometry, BONES_ATTRIBUTE, VEC4), out);
  }

  /** `posed` over the attributes' own arrays, read raw: three's per-item getters box each double they return when they are not inlined (about 100 B a vertex). */
  private posedFrom(s: number, i: number, flags: number, shape: Float32Array, size: number, kinds: Float32Array, bones: Float32Array, out: THREE.Vector3): boolean {
    if (!isDrawn(kinds[i * VEC4 + 1]!, flags)) return false;
    const lag = (s * ROW_TEXELS + ORBS_AT) * 4;
    _o.set(shape[i * size]!, shape[i * size + 1]!, shape[i * size + 2]!);
    _o.addScaledVector(_lag.fromArray(this.rows, lag), kinds[i * VEC4 + 2]!).addScaledVector(_lag.fromArray(this.rows, lag + 4), kinds[i * VEC4 + 3]!);
    skinPoint(this.rows, s, bones[i * VEC4]!, bones[i * VEC4 + 1]!, bones[i * VEC4 + 2]!, _o, out);
    return true;
  }

  /** Slot `s`'s colour for `role` (linear) into `into`. */
  colourOf(s: number, role: number, into: THREE.Color): THREE.Color {
    return into.fromArray(this.rows, s * ROW_TEXELS * 4 + (PALETTE_AT + role) * 4);
  }

  private flagsOf(s: number): number {
    return this.rows[(s * ROW_TEXELS + FLAGS_AT) * 4]!;
  }

  /** Whether `ray` (in the mesh's frame) crosses the sphere slot `s`'s posed body lies within. */
  private crosses(s: number, ray: THREE.Ray): boolean {
    const at = s * ROW_TEXELS * 4;
    _reach.center.set(PARTS[0].c[0], PARTS[0].c[1], PARTS[0].c[2]).applyQuaternion(_q.fromArray(this.rows, at + 4)).add(_o.fromArray(this.rows, at));
    return ray.intersectsSphere(_reach);
  }

  /** Slot `s`'s vertices as posed now into the pick's points, and whether the slot draws each (one it does not keeps the point before it): only the groups `ray` (the mesh's frame) passes within reach of, and the vertices of triangles that span groups. */
  private skinSlot(s: number, ray: THREE.Ray): PickGroups {
    const count = this.geometry.getAttribute("position").count;
    const points = (this.pickPoints ??= new Float32Array(count * 3));
    const drawn = (this.pickDrawn ??= new Uint8Array(count));
    const groups = (this.pickGroups ??= pickGroupsOf(this.geometry));
    this.reached(s, ray, groups);
    const flags = this.flagsOf(s);
    const name = shapeOf(flags);
    const size = shapeSize(name);
    const shape = floatsOf(this.geometry, name, size);
    const kinds = floatsOf(this.geometry, KINDS_ATTRIBUTE, VEC4);
    const bones = floatsOf(this.geometry, BONES_ATTRIBUTE, VEC4);
    const { ofVertex, always, hit } = groups;
    for (let i = 0; i < count; i++) {
      if (hit[ofVertex[i]!] === 0 && always[i] === 0) continue;
      drawn[i] = this.posedFrom(s, i, flags, shape, size, kinds, bones, _o) ? 1 : 0;
      _o.toArray(points, 3 * i);
    }
    return groups;
  }

  /** Marks in `groups.hit` the groups of slot `s` whose posed reach `ray` (the mesh's frame) passes within. */
  private reached(s: number, ray: THREE.Ray, groups: PickGroups): void {
    const lag = (s * ROW_TEXELS + ORBS_AT) * 4;
    const lagA = _lag.fromArray(this.rows, lag).length();
    const lagB = _lag.fromArray(this.rows, lag + 4).length();
    const { a, b, centre, radius, orbA, orbB, hit } = groups;
    for (let g = 0; g < hit.length; g++) {
      _o.fromArray(centre, 3 * g);
      skinPoint(this.rows, s, a[g]!, a[g]!, 0, _o, _va);
      skinPoint(this.rows, s, b[g]!, b[g]!, 0, _o, _vb);
      const reach = radius[g]! + orbA[g]! * lagA + orbB[g]! * lagB + PICK_SLACK;
      hit[g] = ray.distanceSqToSegment(_va, _vb) <= reach * reach ? 1 : 0;
    }
  }

  /**
   * A ray against each slot's body as it is posed now, the triangles the slot draws skinned from its part poses (`posed`): a hand raised, a
   * leg swung or a dummy flung is picked where it is drawn, and a woman or a portly man by her own shape. A slot is skinned only when the ray crosses
   * the sphere of its reach. The garage's spray reads the hit's point, face normal and instance.
   */
  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    _inverse.copy(this.matrixWorld).invert();
    _local.copy(raycaster.ray).applyMatrix4(_inverse);
    const index = this.geometry.index!;
    const cull = this.material.side !== THREE.DoubleSide;
    for (let s = 0; s < this.count; s++) {
      if (((this.shown >> s) & 1) === 0 || !this.crosses(s, _local)) continue;
      const { ofTriangle, hit } = this.skinSlot(s, _local);
      const points = this.pickPoints!;
      const drawn = this.pickDrawn!;
      for (let t = 0; t < index.count; t += 3) {
        const g = ofTriangle[t / 3]!;
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        if ((g >= 0 && hit[g] === 0) || drawn[a] === 0 || _local.intersectTriangle(_va.fromArray(points, 3 * a), _vb.fromArray(points, 3 * b), _vc.fromArray(points, 3 * c), cull, _at) === null) continue;
        const point = _at.clone().applyMatrix4(this.matrixWorld);
        const distance = raycaster.ray.origin.distanceTo(point);
        if (distance < raycaster.near || distance > raycaster.far) continue;
        const normal = _vb.clone().sub(_va).cross(_vc.clone().sub(_va)).normalize();
        intersects.push({ distance, point, face: { a, b, c, normal, materialIndex: 0 }, faceIndex: t / 3, instanceId: s, object: this });
      }
    }
  }

  /**
   * The hit `raycast` sorts first for `ray` (world) between `near` and `far` m among the slots other than `skip`: its slot (-1: none), world point
   * and distance into `out`. A bullet's pick: no hit list, no sort, no allocation.
   */
  nearestHit(ray: THREE.Ray, near: number, far: number, skip: number, out: MeshHit): void {
    out.slot = -1;
    out.along = Infinity;
    _inverse.copy(this.matrixWorld).invert();
    _local.copy(ray).applyMatrix4(_inverse);
    const index = this.geometry.index!;
    const cull = this.material.side !== THREE.DoubleSide;
    for (let s = 0; s < this.count; s++) {
      if (s === skip || ((this.shown >> s) & 1) === 0 || !this.crosses(s, _local)) continue;
      const { ofTriangle, hit } = this.skinSlot(s, _local);
      const points = this.pickPoints!;
      const drawn = this.pickDrawn!;
      for (let t = 0; t < index.count; t += 3) {
        const g = ofTriangle[t / 3]!;
        if (g >= 0 && hit[g] === 0) continue;
        const a = index.getX(t);
        if (drawn[a] === 0 || _local.intersectTriangle(_va.fromArray(points, 3 * a), _vb.fromArray(points, 3 * index.getX(t + 1)), _vc.fromArray(points, 3 * index.getX(t + 2)), cull, _at) === null) continue;
        _at.applyMatrix4(this.matrixWorld);
        const distance = ray.origin.distanceTo(_at);
        if (distance < near || distance > far || distance >= out.along) continue;
        out.slot = s;
        out.x = _at.x;
        out.y = _at.y;
        out.z = _at.z;
        out.along = distance;
      }
    }
  }
}

/** `rgba` as the atlas of `slots` sprays stacked up it; throws past `MAX_ATLAS_SIDE` (pack slots in columns too before raising a sprayed mesh's slots that far). */
function sprayAtlas(rgba: Uint8Array, slots: number): THREE.DataTexture {
  const height = PERSON_SPRAY.h * slots;
  if (height > MAX_ATLAS_SIDE) throw new Error(`${slots} sprayed dummies need a ${height} px atlas, past ${MAX_ATLAS_SIDE}`);
  const atlas = new THREE.DataTexture(rgba, PERSON_SPRAY.w, height);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.magFilter = THREE.LinearFilter;
  atlas.minFilter = THREE.LinearFilter;
  atlas.needsUpdate = true;
  return atlas;
}

const _inverse = new THREE.Matrix4();
const _local = new THREE.Ray();
const _q = new THREE.Quaternion();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _at = new THREE.Vector3();
/** The sphere a posed body lies within, about its torso's centre. */
const _reach = new THREE.Sphere(new THREE.Vector3(), BODY_REACH_M);
