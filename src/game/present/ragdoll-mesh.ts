import * as THREE from "three";
import { JEANS, type DriverLook } from "./driver-look.ts";
import { PARTS } from "./ragdoll-body.ts";
import { applySpray, BARE_SPRAY, sprayUniforms, type SprayBitmap } from "./spray.ts";
import { PERSON_SPRAY } from "../match/look-data.ts";
import { BONES_ATTRIBUTE, BUILD, FLAGS_AT, isDrawn, KINDS_ATTRIBUTE, ORBS_AT, PALETTE_AT, ROW_TEXELS, SHAPE_PORTLY_ATTRIBUTE, SHAPE_WOMAN_ATTRIBUTE, skinPoint } from "./dummy-rig.ts";
import { dressRow } from "./dummy-dress.ts";
import { BustSprings } from "./dummy-jiggle.ts";
import { applyDolls } from "./dummy-shader.ts";
import { dummyGeometry } from "./dummy-skin.ts";

/** A stalled frame steps her bust at most this long (s). */
const MAX_FRAME = 0.05;
const _o = new THREE.Vector3();
const _lag = new THREE.Vector3();
const IDENTITY = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
/** The tallest texture every WebGL2 device takes (`MAX_TEXTURE_SIZE`'s guaranteed minimum): a sprayed mesh's atlas stays within it. */
const MAX_ATLAS_SIDE = 2048;

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
  private readonly dolls: THREE.DataTexture;
  /** Every slot's spray (`PERSON_SPRAY`), one bitmap's rows per slot, slot 0 lowest; null on a mesh whose slots wear none, which samples `BARE_SPRAY`. */
  private readonly sprayRgba: Uint8Array | null;
  private readonly sprayAtlas: THREE.DataTexture;
  /** What a pick skins a slot's vertices into, and which of them the slot draws (made at the first pick). */
  private pickPoints: Float32Array | null = null;
  private pickDrawn: Uint8Array | null = null;

  /**
   * `sprayed`: its slots wear sprays (`spray`: the thrown drivers, the garage's); the course's figures wear none and hold no atlas.
   * `geometry`: `dummyGeometry` or a view of it on the same attributes (`seatedGeometry`).
   */
  constructor(slots: number, sprayed = false, geometry: THREE.BufferGeometry = dummyGeometry()) {
    super(geometry, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 }), slots);
    this.rows = new Float32Array(slots * ROW_TEXELS * 4);
    this.bust = new BustSprings(slots);
    this.dolls = new THREE.DataTexture(this.rows, ROW_TEXELS, slots, THREE.RGBAFormat, THREE.FloatType);
    this.sprayRgba = sprayed ? new Uint8Array(PERSON_SPRAY.w * PERSON_SPRAY.h * 4 * slots) : null;
    this.sprayAtlas = this.sprayRgba ? sprayAtlas(this.sprayRgba, slots) : BARE_SPRAY;
    this.customDepthMaterial = new THREE.MeshDepthMaterial();
    applyDolls(this.customDepthMaterial, this.dolls, false);
    applyDolls(this.material, this.dolls, true);
    // The posed body is wherever its parts are: nothing to cull against, and the instance transforms only hide.
    this.frustumCulled = false;
    applySpray(this.material, sprayUniforms(PERSON_SPRAY, this.sprayAtlas, this.sprayRgba ? slots : 1), "", "vSprayP = position;\nvSprayN = normal;\nvSprayRow = float(gl_InstanceID);", "dummy");
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
    };
  }

  /** Every woman out stepped `dt` s: her bust's two particles chase her torso's pose; the rows upload only when a lag moved. */
  jiggle(dt: number): void {
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

  /** Slot `s` wears `spray`'s paint (a `PERSON_SPRAY` bitmap), or none. Only a `sprayed` mesh's slots wear any. */
  spray(s: number, spray: SprayBitmap | null): void {
    if (!this.sprayRgba) throw new Error("DummyMesh.spray on a mesh built without sprays");
    const at = s * PERSON_SPRAY.w * PERSON_SPRAY.h * 4;
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
    const bones = this.geometry.getAttribute(BONES_ATTRIBUTE);
    const kinds = this.geometry.getAttribute(KINDS_ATTRIBUTE);
    if (!isDrawn(kinds.getY(i), this.flagsOf(s))) return false;
    const flags = this.flagsOf(s);
    const shape = (flags & BUILD.WOMAN) !== 0 ? SHAPE_WOMAN_ATTRIBUTE : (flags & BUILD.PORTLY) !== 0 ? SHAPE_PORTLY_ATTRIBUTE : "position";
    const lag = (s * ROW_TEXELS + ORBS_AT) * 4;
    _o.fromBufferAttribute(this.geometry.getAttribute(shape), i);
    _o.addScaledVector(_lag.fromArray(this.rows, lag), kinds.getZ(i)).addScaledVector(_lag.fromArray(this.rows, lag + 4), kinds.getW(i));
    skinPoint(this.rows, s, bones.getX(i), bones.getY(i), bones.getZ(i), _o, out);
    return true;
  }

  /** Slot `s`'s colour for `role` (linear) into `into`. */
  colourOf(s: number, role: number, into: THREE.Color): THREE.Color {
    return into.fromArray(this.rows, s * ROW_TEXELS * 4 + (PALETTE_AT + role) * 4);
  }

  private flagsOf(s: number): number {
    return this.rows[(s * ROW_TEXELS + FLAGS_AT) * 4]!;
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
    const count = this.geometry.getAttribute("position").count;
    const points = (this.pickPoints ??= new Float32Array(count * 3));
    const drawn = (this.pickDrawn ??= new Uint8Array(count));
    const cull = this.material.side !== THREE.DoubleSide;
    for (let s = 0; s < this.count; s++) {
      if (((this.shown >> s) & 1) === 0) continue;
      const at = s * ROW_TEXELS * 4;
      _reach.center.set(PARTS[0].c[0], PARTS[0].c[1], PARTS[0].c[2]).applyQuaternion(_q.fromArray(this.rows, at + 4)).add(_o.fromArray(this.rows, at));
      if (!_local.intersectsSphere(_reach)) continue;
      for (let i = 0; i < count; i++) {
        drawn[i] = this.posed(s, i, _o) ? 1 : 0;
        _o.toArray(points, 3 * i);
      }
      for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        if (drawn[a] === 0 || _local.intersectTriangle(_va.fromArray(points, 3 * a), _vb.fromArray(points, 3 * b), _vc.fromArray(points, 3 * c), cull, _at) === null) continue;
        const point = _at.clone().applyMatrix4(this.matrixWorld);
        const distance = raycaster.ray.origin.distanceTo(point);
        if (distance < raycaster.near || distance > raycaster.far) continue;
        const normal = _vb.clone().sub(_va).cross(_vc.clone().sub(_va)).normalize();
        intersects.push({ distance, point, face: { a, b, c, normal, materialIndex: 0 }, faceIndex: t / 3, instanceId: s, object: this });
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
/** The sphere a posed body lies within, about its torso's centre: the standing feet are 1.11 m below it, a flung limb no farther. */
const _reach = new THREE.Sphere(new THREE.Vector3(), 1.3);
