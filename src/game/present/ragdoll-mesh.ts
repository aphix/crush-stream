import * as THREE from "three";
import { JEANS, type DriverLook } from "./driver-look.ts";
import { PARTS } from "./ragdoll-body.ts";
import { applySpray, sprayUniforms, type SprayBitmap } from "./spray.ts";
import { PERSON_SPRAY } from "../match/look-data.ts";
import { BONES_ATTRIBUTE, BUILD, FLAGS_AT, isDrawn, KINDS_ATTRIBUTE, ORBS_AT, PALETTE_AT, ROW_TEXELS, SHAPE_PORTLY_ATTRIBUTE, SHAPE_WOMAN_ATTRIBUTE, skinPoint } from "./dummy-rig.ts";
import { dressRow } from "./dummy-dress.ts";
import { BUST_ATTRIBUTE, BustSprings, bustWeights } from "./dummy-jiggle.ts";
import { applyDolls } from "./dummy-shader.ts";
import { dummyGeometry } from "./dummy-skin.ts";

/** A stalled frame steps her bust at most this long (s). */
const MAX_FRAME = 0.05;
const _o = new THREE.Vector3();
const _lag = new THREE.Vector3();
const IDENTITY = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

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
  /** Every slot's spray (`PERSON_SPRAY`), one bitmap's rows per slot, slot 0 lowest. */
  private readonly sprayRgba: Uint8Array;
  private readonly sprayAtlas: THREE.DataTexture;

  constructor(slots: number) {
    super(dummyGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 }), slots);
    this.rows = new Float32Array(slots * ROW_TEXELS * 4);
    this.bust = new BustSprings(slots);
    this.geometry.setAttribute(BUST_ATTRIBUTE, new THREE.Float32BufferAttribute(bustWeights(this.geometry.getAttribute(SHAPE_WOMAN_ATTRIBUTE), this.geometry.getAttribute(KINDS_ATTRIBUTE)), 2));
    this.dolls = new THREE.DataTexture(this.rows, ROW_TEXELS, slots, THREE.RGBAFormat, THREE.FloatType);
    this.sprayRgba = new Uint8Array(PERSON_SPRAY.w * PERSON_SPRAY.h * 4 * slots);
    this.sprayAtlas = new THREE.DataTexture(this.sprayRgba, PERSON_SPRAY.w, PERSON_SPRAY.h * slots);
    this.sprayAtlas.colorSpace = THREE.SRGBColorSpace;
    this.sprayAtlas.magFilter = THREE.LinearFilter;
    this.sprayAtlas.minFilter = THREE.LinearFilter;
    this.sprayAtlas.needsUpdate = true;
    this.customDepthMaterial = new THREE.MeshDepthMaterial();
    applyDolls(this.customDepthMaterial, this.dolls, false);
    applyDolls(this.material, this.dolls, true);
    // The posed body is wherever its parts are: nothing to cull against, and the instance transforms only hide.
    this.frustumCulled = false;
    applySpray(this.material, sprayUniforms(PERSON_SPRAY, this.sprayAtlas, slots), "", "vSprayP = position;\nvSprayN = normal;\nvSprayRow = float(gl_InstanceID);", "dummy");
    this.material.addEventListener("dispose", () => {
      this.sprayAtlas.dispose();
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

  /** Slot `s` wears `spray`'s paint (a `PERSON_SPRAY` bitmap), or none. */
  spray(s: number, spray: SprayBitmap | null): void {
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
    if (!isDrawn(this.geometry.getAttribute(KINDS_ATTRIBUTE).getY(i), this.flagsOf(s))) return false;
    const flags = this.flagsOf(s);
    const shape = (flags & BUILD.WOMAN) !== 0 ? SHAPE_WOMAN_ATTRIBUTE : (flags & BUILD.PORTLY) !== 0 ? SHAPE_PORTLY_ATTRIBUTE : "position";
    const bust = this.geometry.getAttribute(BUST_ATTRIBUTE);
    const lag = (s * ROW_TEXELS + ORBS_AT) * 4;
    _o.fromBufferAttribute(this.geometry.getAttribute(shape), i);
    _o.addScaledVector(_lag.fromArray(this.rows, lag), bust.getX(i)).addScaledVector(_lag.fromArray(this.rows, lag + 4), bust.getY(i));
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

  /** A ray against each slot's drawn body as its torso carries it (every part is rigid on it at rest: the garage's standing driver, exactly). */
  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const hits: THREE.Intersection[] = [];
    const kinds = this.geometry.getAttribute(KINDS_ATTRIBUTE);
    for (let s = 0; s < this.count; s++) {
      if (((this.shown >> s) & 1) === 0) continue;
      const at = s * ROW_TEXELS * 4;
      _torso.compose(_o.fromArray(this.rows, at), _q.fromArray(this.rows, at + 4), _unit);
      _world.multiplyMatrices(this.matrixWorld, _torso);
      _pick.geometry = this.geometry;
      _pick.material = this.material;
      _pick.matrixWorld = _world;
      _pick.raycast(raycaster, hits);
      for (const hit of hits) {
        if (!hit.face || !isDrawn(kinds.getY(hit.face.a), this.flagsOf(s))) continue;
        hit.instanceId = s;
        hit.object = this;
        intersects.push(hit);
      }
      hits.length = 0;
    }
  }
}

const _pick = new THREE.Mesh();
const _torso = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _unit = new THREE.Vector3(1, 1, 1);
