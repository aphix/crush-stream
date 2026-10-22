import * as THREE from "three";
import { hypot2 } from "../kernel/physics-core.js";
import { lampEmissiveMap, makeLampUnit, type LampKind } from "./car-materials.ts";
import { brakeLampUnit, lampBatchGeometries, sideMarkerUnit } from "./part-variants.ts";
import { SeatDraw } from "./seat-draw.ts";
import type { BodyStyle } from "./car-variants.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";

/**
 * Lamp light pools, created once and only ever re-aimed or dimmed: adding, removing or hiding a light changes three's lights hash
 * and recompiles every lit material (32c53c1 dropped a 19-light shader for a boot hang). Broken, off and unassigned lights sit at
 * intensity 0. The pool size is chosen once at boot, before the programs link (`CrashEngine`), never per FX tier or mid-race.
 */
export interface LampPool {
  readonly spots: number;
  readonly tails: number;
}
export const FULL_POOL: LampPool = { spots: 4, tails: 4 };
export const PHONE_POOL: LampPool = { spots: 2, tails: 2 };
/** The pool a device links its programs with: the full one on a desktop or with `?lamps=full` (the A/B arm), else the phone's (every lit fragment loops over every light). */
export const lampPoolFor = (desktop: boolean, lampsParam: string | null): LampPool => (desktop || lampsParam === "full" ? FULL_POOL : PHONE_POOL);

/** Headlamp spot (exported for the fade tests: a lamp at weight 1 shows `intensity`). */
export const HEAD = { color: 0xfff1d8, intensity: 40, distance: 22, angle: 0.5, penumbra: 0.55, decay: 2 };
/** A tail lamp lights only the half-space behind its lens (a 90° cone): as a point light it reached forward through the glass into the
 *  cabin and over the bed floor, a red glow the references never show. */
const TAIL = { color: 0xff2414, intensity: 0.5, distance: 2.5, decay: 2, angle: Math.PI / 2, penumbra: 0.3 };
/** A lit siren washes the road and the body beside the car on its lens's side; it outranks every tail lamp but the followed car's
 *  (`SIREN_RANK`). Its spot hangs `out` m over the lens (closer, it blew the lens itself out to orange under ACES) and leans out of the
 *  bar's side, dipped `dip` rad, its cone `angle` rad: down to `dip + angle` (about 70°) below the level, short of the roof's footprint,
 *  so it never reaches the cabin under the roof (no lamp casts a shadow). Pointed straight down, it washed the seats blue and red. */
const SIREN = { red: 0xff1810, blue: 0x2848ff, intensity: 3, distance: 8, out: 0.8, dip: 0.6, angle: 0.6 };
/** Headlamp aim: a point AIM m ahead dipped DIP m (≈5°), so the beam pools on the road. */
const AIM = 10;
const DIP = 0.9;
/** The tail cone's apex sits this far (m) behind the lamp's seat on the skin, so the lens and the skin round it face away from it. */
const TAIL_SINK = 0.02;
/** Glow sprite world size (m). */
const GLOW_SIZE = 0.7;
const GLOW_OUT = 0.1;
/** Head glow by `lamps.bulb`: the neutral white, warm halogen, cool-white LED. */
const GLOW_HEAD = { neutral: [0.8, 0.7, 0.55], halogen: [0.82, 0.64, 0.42], led: [0.7, 0.72, 0.74] } as const;
const GLOW_TAIL = [0.55, 0.03, 0.015] as const;
/** A tail lamp is a running light at this share of its brake brightness (lens, glow, light and pool) while its car is off the brakes. */
const TAIL_RUNNING = 0.35;
const GLOW_RED = [1, 0.06, 0.04] as const;
const GLOW_BLUE = [0.08, 0.2, 1] as const;
/** A headlamp whose drawn lens is not lit (a dark lens with a lit DRL or projectors) glows this share: the full white sprite washed its
 *  whole lens white. A tail's red glow over a smoked lens reads as the lit lens it is, so tails keep theirs. */
const GLOW_DARK_LENS = 0.3;
/** A body lamp's glow fades with the cosine between its lens axis and the camera: full to about 70° off the axis, gone past 95° (a
 *  lamp's lens is seen from its side, never from behind). */
const GLOW_FACE = [-0.1, 0.35] as const;

/** Fake pools, shaped like the real spot's pool on the road (dark at the lamp, brightest about a fifth along, then a fading fan). A headlamp's
 *  quad runs from the lamp's foot POOL_LEN times the way to where its beam meets the ground (to at most POOL_MAX m), POOL_WIDTH as wide as
 *  long; a tail lamp's is a TAIL_POOL m square straight back. Colours are the additive peak at full opacity (the sprite's alpha shapes it);
 *  none is drawn beyond POOL_FAR_SQ (m², from the camera). */
const POOL_LEN = 0.75;
const POOL_MAX = 6;
const POOL_WIDTH = 0.65;
const TAIL_POOL = 1.6;
const POOL_LIFT = 0.02;
const POOL_FAR_SQ = 80 * 80;
/** Exported for the fade tests: a lamp at weight 1 shows a spot of `HEAD.intensity`; at weight 0 a decal of this colour. Tuned so a
 *  decal's ground luminance (summed over the pool, top-down at night) matches the real light's: spot 40 on a dark road is a dim, short pool. */
export const POOL_HEAD = [0.033, 0.028, 0.02] as const;
const POOL_TAIL = [0.019, 0.0015, 0.0008] as const;
/**
 * Fade between a lamp's painted pool and its real light. A lamp's target weight is 1 within REAL_R0 (NDC radius from the centre of
 * the view) and REAL_D0 m of the camera, easing to 0 by REAL_R1 / REAL_D1; it slews there over FADE_S (a frame's step is capped at
 * FADE_DT_MAX s). A lamp already holding a light ranks HYSTERESIS higher (no chatter at the cut) and one is admitted only at a
 * target of ADMIT or more. The followed car's lamps rank FOLLOWED_BONUS higher, the highlight's HIGHLIGHT_BONUS.
 */
const REAL_R0 = 0.25;
const REAL_R1 = 0.7;
const REAL_D0 = 14;
const REAL_D1 = 40;
const FADE_S = 0.3;
const FADE_DT_MAX = 0.1;
const HYSTERESIS = 0.2;
const ADMIT = 0.1;
const FOLLOWED_BONUS = 4;
const HIGHLIGHT_BONUS = 2;
/** A siren ranks behind the followed car's lamps (-(1 + FOLLOWED_BONUS) - HYSTERESIS) and ahead of all else. */
const SIREN_RANK = -(FOLLOWED_BONUS + 0.5);
const NO_CARS: readonly never[] = [];

/** 1 at or under `lo`, 0 at or over `hi`, smooth between. */
function near01(x: number, lo: number, hi: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return 1 - t * t * (3 - 2 * t);
}

/** What a lamp slot shows: a body lamp, or a police light bar's red or blue siren. */
export type GlowKind = LampKind | "red" | "blue";

/** A lamp seated on one body-skin facet (see `anchorOnSkin`). */
export interface SkinAnchor {
  readonly verts: readonly [number, number, number];
  /** Barycentric weights of the lamp origin's projection onto the facet. */
  readonly w: readonly [number, number, number];
  /** Rest offset of the origin along the facet normal. */
  readonly h: number;
  /** Rest rotation of the lamp in the facet frame. */
  readonly rel: THREE.Quaternion;
}

/**
 * Anchor a lamp at `origin` / `rest` to the skin facet it sits on: the non-degenerate triangle of
 * the indexed `geo` nearest the origin, so its weights are in [0, 1] and the lamp rides that patch
 * of skin. Build-time only (one pass over the triangles).
 */
export function anchorOnSkin(geo: THREE.BufferGeometry, origin: THREE.Vector3, rest: THREE.Quaternion): SkinAnchor {
  const pos = geo.getAttribute("position").array;
  const index = geo.index?.array;
  if (!index) throw new Error("anchorOnSkin: the skin must be indexed");
  let best = -1;
  let bestD = Infinity;
  for (let t = 0; t < index.length; t += 3) {
    _tri.a.fromArray(pos, index[t]! * 3);
    _tri.b.fromArray(pos, index[t + 1]! * 3);
    _tri.c.fromArray(pos, index[t + 2]! * 3);
    if (_tri.getArea() < 1e-6) continue;
    const d = _tri.closestPointToPoint(origin, _e).distanceToSquared(origin);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (best < 0) throw new Error("anchorOnSkin: no skin facet");
  const verts = [index[best]!, index[best + 1]!, index[best + 2]!] as const;
  frameAt(pos, verts);
  THREE.Triangle.getBarycoord(origin, _a, _b, _c, _d);
  return {
    verts,
    w: [_d.x, _d.y, _d.z],
    h: _e.subVectors(origin, _a).dot(_n),
    rel: new THREE.Quaternion().setFromRotationMatrix(_m).invert().multiply(rest),
  };
}

/** Seat an anchored lamp on the current skin: origin = Σwᵢ·vᵢ + h·n, rotation = frame · rel. */
export function poseOnSkin(anchor: SkinAnchor, pos: ArrayLike<number>, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  frameAt(pos, anchor.verts);
  const [wa, wb, wc] = anchor.w;
  outPos.copy(_a).multiplyScalar(wa).addScaledVector(_b, wb).addScaledVector(_c, wc).addScaledVector(_n, anchor.h);
  outQuat.setFromRotationMatrix(_m).multiply(anchor.rel);
}

/** Loads `_a/_b/_c` and the frame `_m` = (edge ab, n × ab, n) with unit normal `_n`. */
function frameAt(pos: ArrayLike<number>, [a, b, c]: readonly [number, number, number]): void {
  _a.fromArray(pos, a * 3);
  _b.fromArray(pos, b * 3);
  _c.fromArray(pos, c * 3);
  _t.subVectors(_b, _a).normalize();
  _n.crossVectors(_t, _d.subVectors(_c, _a)).normalize();
  _m.makeBasis(_t, _d.crossVectors(_n, _t), _n);
}

/** What the pool reads from a car; `DeformableCar` satisfies it. */
interface LampHost {
  readonly group: THREE.Object3D;
  readonly style: Pick<BodyStyle, "lamps">;
  readonly lampCount: number;
  /** Writes lamp `i`'s world seat on the skin and outward axis; returns its kind, or null once broken or dark. */
  lampWorld(i: number, pos: THREE.Vector3, dir: THREE.Vector3): GlowKind | null;
  /** Whether the car is on its brakes: its tail lamps burn bright, not as running lights. */
  readonly braking: boolean;
  /** Advance the siren flash to `now` (s); no-op without sirens on. */
  flashSirens(now: number): void;
}

/** The best `size` candidates by ascending score, in place: no allocation per offer. `id` is the caller's own tag (a stash slot, or -1). */
class Ranking {
  readonly score: Float64Array;
  readonly pos: THREE.Vector3[];
  readonly dir: THREE.Vector3[];
  readonly kind: GlowKind[];
  readonly id: Int32Array;
  readonly size: number;
  count = 0;

  constructor(size: number) {
    this.size = size;
    this.score = new Float64Array(size);
    this.id = new Int32Array(size);
    this.pos = Array.from({ length: size }, () => new THREE.Vector3());
    this.dir = Array.from({ length: size }, () => new THREE.Vector3());
    this.kind = Array.from({ length: size }, (): GlowKind => "tail");
  }

  offer(s: number, p: THREE.Vector3, d: THREE.Vector3, kind: GlowKind, id: number): void {
    const k = this.size;
    if (this.count === k && (k === 0 || s >= this.score[k - 1]!)) return;
    let j = this.count < k ? this.count++ : k - 1;
    const sp = this.pos[j]!;
    const sd = this.dir[j]!;
    for (; j > 0 && this.score[j - 1]! > s; j--) {
      this.score[j] = this.score[j - 1]!;
      this.pos[j] = this.pos[j - 1]!;
      this.dir[j] = this.dir[j - 1]!;
      this.kind[j] = this.kind[j - 1]!;
      this.id[j] = this.id[j - 1]!;
    }
    this.score[j] = s;
    this.pos[j] = sp.copy(p);
    this.dir[j] = sd.copy(d);
    this.kind[j] = kind;
    this.id[j] = id;
  }
}

/** A car's lamps' fade state, kept across frames: weight `w` (0 painted pool … 1 real light) and whether the lamp holds a pooled light. */
interface LampFade {
  readonly w: Float32Array;
  readonly act: Uint8Array;
}
const NO_FADE: LampFade = { w: new Float32Array(0), act: new Uint8Array(0) };

/**
 * Every intact lamp glows (one additive point sprite each, one draw for all cars). Every head and tail lamp also shows its pool as
 * a fake ground decal (`pools`, one instanced draw) and, fading with it, a real light: a lamp's weight w (0..1) scales its real
 * light to `w × full` and its decal to `(1 − w) × full`, so the sum looks constant as a lamp slides from painted to real as it nears
 * the middle of the view and the camera, and back as it leaves. The fixed light pools go to the best-ranked lamps: the followed car
 * (weight 1), then the cars of the clip being played (1), then (desktop) any lamp by how central and near it is (`realness`). A
 * lamp is only handed a pooled light when one is free, and gives it back when its weight is back at 0, so no lit light is ever
 * swapped for another. White spots for headlamps, short red half-space spots for tail lamps; a lit police siren takes a tail spot too, recoloured
 * red or blue (colour and range are uniforms: the lights hash never changes) and cutting the weakest tail lamp if need be.
 */
export class LampLights {
  readonly spots: THREE.SpotLight[] = [];
  /** Tail lamps' and sirens' lights. */
  readonly tailSpots: THREE.SpotLight[] = [];
  readonly glow: THREE.Points;
  private readonly glowPos: THREE.BufferAttribute;
  private readonly glowCol: THREE.BufferAttribute;
  private readonly heads: Ranking;
  private readonly tails: Ranking;
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  /** Whether any car's lamps may earn real lights by screen position (desktop; a phone's budget keeps them to the followed car and the highlight). */
  middleTile = true;
  /**
   * Night (the time of day, `WorldStage.night`; the engine sets it every frame). By day a car's head lamps, and its tail lamps while it
   * is off the brakes, are off: no glow, real light or pool. Brake lamps (the tails while it brakes) and police sirens light at any hour.
   * Drawn only. Night until set: the pool's lit behaviour is night's.
   */
  night = true;
  /** Fake pools: one instanced ground decal for every head and tail lamp, at (1 − weight) of its colour. */
  readonly pools: THREE.InstancedMesh;
  /** This frame's head and tail lamps: world seat and axis (6 floats each), kind (1 head), fade state and lamp index, target weight, rank score and brightness (`TAIL_RUNNING` for a tail off the brakes). */
  private readonly stash: Float32Array;
  private readonly stashHead: Uint8Array;
  private readonly stashFade: LampFade[];
  private readonly stashIdx: Uint8Array;
  private readonly stashQ: Float32Array;
  private readonly stashScore: Float32Array;
  private readonly stashBright: Float32Array;
  /** Scratch for `settle`: 1 where the lamp is in its kind's best-ranked set this frame. */
  private readonly want: Uint8Array;
  private readonly fades = new WeakMap<LampHost, LampFade>();
  /** Seconds of this frame's fade (0 on the first frame, which snaps instead of fading in). */
  private fadeDt = 0;
  private primed = false;

  constructor(scene: THREE.Scene, maxLamps: number, pool: LampPool = FULL_POOL) {
    this.heads = new Ranking(pool.spots);
    this.tails = new Ranking(pool.tails);
    for (let i = 0; i < pool.spots; i++) {
      const s = new THREE.SpotLight(HEAD.color, 0, HEAD.distance, HEAD.angle, HEAD.penumbra, HEAD.decay);
      scene.add(s, s.target);
      this.spots.push(s);
    }
    for (let i = 0; i < pool.tails; i++) {
      const s = new THREE.SpotLight(TAIL.color, 0, TAIL.distance, TAIL.angle, TAIL.penumbra, TAIL.decay);
      scene.add(s, s.target);
      this.tailSpots.push(s);
    }
    const geo = new THREE.BufferGeometry();
    this.glowPos = new THREE.BufferAttribute(new Float32Array(maxLamps * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.glowCol = new THREE.BufferAttribute(new Float32Array(maxLamps * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.glowPos);
    geo.setAttribute("color", this.glowCol);
    geo.setDrawRange(0, 0);
    this.glow = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: GLOW_SIZE,
        map: glowSprite(),
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.frustumCulled = false;
    scene.add(this.glow);
    this.stash = new Float32Array(maxLamps * 6);
    this.stashHead = new Uint8Array(maxLamps);
    this.stashFade = Array.from({ length: maxLamps }, () => NO_FADE);
    this.stashIdx = new Uint8Array(maxLamps);
    this.stashQ = new Float32Array(maxLamps);
    this.stashScore = new Float32Array(maxLamps);
    this.stashBright = new Float32Array(maxLamps);
    this.want = new Uint8Array(maxLamps);
    // The engine makes `pools` a ground decal (`groundMaterial`, `levelOrder`): that layer is above this one.
    this.pools = new THREE.InstancedMesh(
      poolQuad(),
      // A flat quad shows one face to a pixel: three's back-then-front two-pass draw (the default for a see-through double-sided material) only re-resolved the program twice a frame.
      new THREE.MeshBasicMaterial({ map: poolSprite(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }),
      maxLamps,
    );
    this.pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxLamps * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.pools.count = 0;
    this.pools.frustumCulled = false;
    scene.add(this.pools);
  }

  /**
   * After the cars' skin and the camera are final for the frame, before render. `now` (s) clocks the sirens; `highlight` is the
   * cars of the clip being played; `dt` (s) is the frame's wall time, which paces every lamp's fade (0 holds them where they are).
   */
  update(cars: readonly LampHost[], camera: THREE.Camera, followed: LampHost | null, now = performance.now() / 1000, highlight: readonly LampHost[] = NO_CARS, dt = 0): void {
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    _cam.setFromMatrixPosition(camera.matrixWorld);
    this.fadeDt = this.primed ? Math.min(Math.max(dt, 0), FADE_DT_MAX) : 0;
    this.heads.count = 0;
    this.tails.count = 0;
    const gp = this.glowPos.array as Float32Array;
    const gc = this.glowCol.array as Float32Array;
    const st = this.stash;
    let n = 0;
    let ns = 0;
    for (let ci = 0; ci < cars.length; ci++) {
      const car = cars[ci]!;
      let fade = this.fades.get(car);
      if (!car.group.visible) {
        fade?.act.fill(0);
        fade?.w.fill(0);
        continue;
      }
      if (!fade || fade.w.length < car.lampCount) this.fades.set(car, (fade = { w: new Float32Array(car.lampCount), act: new Uint8Array(car.lampCount) }));
      car.flashSirens(now);
      const bonus = this.bonus(car, followed, highlight);
      for (let i = 0; i < car.lampCount; i++) {
        const kind = car.lampWorld(i, _pos, _dir);
        // Dark (`!kind`: broken, or a siren not lit just now), or by day a lamp that burns only at night: no glow, light or pool.
        if (!kind || (!this.night && (kind === "head" || (kind === "tail" && !car.braking)))) {
          fade.w[i] = 0;
          fade.act[i] = 0;
          continue;
        }
        if (n * 3 >= gp.length) continue;
        _e.copy(_pos).addScaledVector(_dir, GLOW_OUT).toArray(gp, n * 3);
        const c = kind === "head" ? GLOW_HEAD[car.style.lamps.bulb ?? "neutral"] : kind === "tail" ? GLOW_TAIL : kind === "red" ? GLOW_RED : GLOW_BLUE;
        const bright = kind === "tail" && !car.braking ? TAIL_RUNNING : 1;
        const lens = kind === "head" ? car.style.lamps.shapes?.head?.lens : undefined;
        const dark = lens === undefined || lens === "lit" ? 1 : GLOW_DARK_LENS;
        // A body lamp's glow shows only on the side its lens faces: seen from behind the lens (past the body, through the cabin's glass)
        // it is dark. A siren shows all round.
        const shown = (kind === "head" || kind === "tail" ? THREE.MathUtils.smoothstep(_e.subVectors(_cam, _pos).normalize().dot(_dir), GLOW_FACE[0], GLOW_FACE[1]) : 1) * bright * dark;
        gc[n * 3] = c[0] * shown;
        gc[n * 3 + 1] = c[1] * shown;
        gc[n * 3 + 2] = c[2] * shown;
        n++;
        if (kind === "head" || kind === "tail") {
          _pos.toArray(st, ns * 6);
          _dir.toArray(st, ns * 6 + 3);
          const q = bonus > 0 ? 1 : this.realness(_pos);
          const score = q > 0 ? q + bonus : 0;
          this.stashHead[ns] = kind === "head" ? 1 : 0;
          this.stashFade[ns] = fade;
          this.stashIdx[ns] = i;
          this.stashQ[ns] = q;
          this.stashScore[ns] = score;
          this.stashBright[ns] = bright;
          if (score > 0) (kind === "head" ? this.heads : this.tails).offer(-score - (fade.act[i] === 1 ? HYSTERESIS : 0), _pos, _dir, kind, ns);
          ns++;
        } else {
          // Ahead of every lamp but the followed car's (scores down to -(1 + FOLLOWED_BONUS)); the followed car's own siren is first, one behind the view last.
          let score = SIREN_RANK + _pos.distanceToSquared(_cam) * 1e-6;
          if (car === followed) score = -2 * FOLLOWED_BONUS - 1;
          else if (!this.frustum.containsPoint(_pos)) score = 10;
          this.tails.offer(score, _pos, _dir, kind, -1);
        }
      }
    }
    this.glow.geometry.setDrawRange(0, n);
    this.glowPos.needsUpdate = true;
    this.glowCol.needsUpdate = true;

    this.settle(true, ns);
    this.settle(false, ns);
    this.primed = true;

    // A head or tail lamp shows its pool as a decal in the share its real light leaves: (1 − weight) of the full pool.
    let np = 0;
    for (let s = 0; s < ns; s++) {
      const a = this.stashFade[s]!.act[this.stashIdx[s]!] === 1 ? 1 - this.stashFade[s]!.w[this.stashIdx[s]!]! : 1;
      if (a > 0) np = this.addPool(np, s, a * this.stashBright[s]!);
    }
    this.pools.count = np;
    this.pools.instanceMatrix.needsUpdate = true;
    this.pools.instanceColor!.needsUpdate = true;
  }

  /** What `car`'s lamps add to their rank for a real light: the followed car outranks the highlight's cars, and both are fully real. */
  private bonus(car: LampHost, followed: LampHost | null, highlight: readonly LampHost[]): number {
    if (car === followed) return FOLLOWED_BONUS;
    for (let i = 0; i < highlight.length; i++) if (highlight[i] === car) return HIGHLIGHT_BONUS;
    return 0;
  }

  /**
   * How real a lamp at `p` wants to be, 0 (painted decal) to 1 (real light): 1 near the middle of the view and near the camera,
   * easing out to 0 towards the screen edge (NDC radius) and with distance, 0 behind the camera or on a phone (`middleTile` off).
   */
  private realness(p: THREE.Vector3): number {
    if (!this.middleTile) return 0;
    const v = this.viewProj.elements;
    const w = v[3]! * p.x + v[7]! * p.y + v[11]! * p.z + v[15]!;
    if (w <= 0) return 0;
    const x = (v[0]! * p.x + v[4]! * p.y + v[8]! * p.z + v[12]!) / w;
    const y = (v[1]! * p.x + v[5]! * p.y + v[9]! * p.z + v[13]!) / w;
    return near01(Math.sqrt(x * x + y * y), REAL_R0, REAL_R1) * near01(p.distanceTo(_cam), REAL_D0, REAL_D1);
  }

  /**
   * Settle the real lights of one kind (`head`: spots, else tail spots) and every lamp's weight for this frame. A lamp's weight slews
   * towards its target over `FADE_S`; a lamp holds a pooled light (`act`) from the frame it is admitted at weight 0 until its weight
   * is back at 0, and a lamp is only admitted into a free light (never over a lit one), best-ranked first. Lights are packed best-first,
   * unused ones at intensity 0. A siren takes its tail spot at once, cutting the weakest tail lamps if it must.
   */
  private settle(head: boolean, ns: number): void {
    const rank = head ? this.heads : this.tails;
    const lights = head ? this.spots.length : this.tailSpots.length;
    const { want, stashFade, stashIdx, stashHead, stashScore, stashQ } = this;
    const kindOf = head ? 1 : 0;
    let cap = lights;
    want.fill(0, 0, ns);
    for (let k = 0; k < rank.count; k++) {
      const id = rank.id[k]!;
      if (id < 0) cap--;
      else want[id] = 1;
    }
    const step = this.fadeDt / FADE_S;
    let live = 0;
    for (let s = 0; s < ns; s++) {
      if (stashHead[s] !== kindOf) continue;
      const f = stashFade[s]!;
      const i = stashIdx[s]!;
      if (f.act[i] === 0) continue;
      const target = want[s] === 1 ? stashQ[s]! : 0;
      const w = f.w[i]!;
      const next = w < target ? Math.min(target, w + step) : Math.max(target, w - step);
      f.w[i] = next;
      if (next === 0 && target === 0) f.act[i] = 0;
      else live++;
    }
    // ponytail: weakest-first cut is O(lamps²), but only runs when a siren or a car back from hiding finds the lights full.
    while (live > cap) {
      let worst = -1;
      let low = Infinity;
      for (let s = 0; s < ns; s++) {
        if (stashHead[s] !== kindOf || stashFade[s]!.act[stashIdx[s]!] === 0 || stashScore[s]! >= low) continue;
        worst = s;
        low = stashScore[s]!;
      }
      stashFade[worst]!.act[stashIdx[worst]!] = 0;
      stashFade[worst]!.w[stashIdx[worst]!] = 0;
      live--;
    }
    for (let k = 0; k < rank.count && live < cap; k++) {
      const s = rank.id[k]!;
      if (s < 0 || stashQ[s]! < ADMIT || stashFade[s]!.act[stashIdx[s]!] === 1) continue;
      stashFade[s]!.act[stashIdx[s]!] = 1;
      stashFade[s]!.w[stashIdx[s]!] = this.primed ? 0 : stashQ[s]!;
      live++;
    }
    let j = 0;
    for (let k = 0; k < rank.count; k++) {
      const s = rank.id[k]!;
      if (s < 0) {
        _pos.copy(rank.pos[k]!);
        _dir.copy(rank.dir[k]!);
        this.seat(head, j++, rank.kind[k]!, 1);
      } else if (stashFade[s]!.act[stashIdx[s]!] === 1) {
        this.seatStashed(head, j++, s);
      }
    }
    for (let s = 0; s < ns; s++) if (stashHead[s] === kindOf && want[s] === 0 && stashFade[s]!.act[stashIdx[s]!] === 1) this.seatStashed(head, j++, s);
    for (; j < lights; j++) {
      if (head) this.spots[j]!.intensity = 0;
      else this.tailSpots[j]!.intensity = 0;
    }
  }

  private seatStashed(head: boolean, j: number, s: number): void {
    _pos.fromArray(this.stash, s * 6);
    _dir.fromArray(this.stash, s * 6 + 3);
    this.seat(head, j, head ? "head" : "tail", this.stashFade[s]!.w[this.stashIdx[s]!]! * this.stashBright[s]!);
  }

  /** Aim pooled light `j` of its kind from the lamp in `_pos` / `_dir`, at `w` of its full intensity (a siren is always full). */
  private seat(head: boolean, j: number, kind: GlowKind, w: number): void {
    if (head) {
      const s = this.spots[j]!;
      s.position.copy(_pos);
      s.target.position.copy(_pos).addScaledVector(_dir, AIM);
      s.target.position.y -= DIP;
      s.intensity = HEAD.intensity * w;
      return;
    }
    const l = this.tailSpots[j]!;
    const tail = kind === "tail";
    if (tail) {
      l.position.copy(_pos).addScaledVector(_dir, -TAIL_SINK);
      l.target.position.copy(l.position).add(_dir);
    } else {
      l.position.set(_pos.x, _pos.y + SIREN.out, _pos.z);
      l.target.position.copy(l.position).add(_dir);
      l.target.position.y -= Math.tan(SIREN.dip);
    }
    l.angle = tail ? TAIL.angle : SIREN.angle;
    l.color.setHex(tail ? TAIL.color : kind === "red" ? SIREN.red : SIREN.blue);
    l.distance = tail ? TAIL.distance : SIREN.distance;
    l.intensity = tail ? TAIL.intensity * w : SIREN.intensity;
  }

  /**
   * Pool instance `k` for stashed lamp `s` at opacity `a` (its colour scaled by it): a flat quad on the ground, its near edge at the lamp's foot and its far edge where the
   * beam has faded. A headlamp's runs along the spot's own aim (`AIM`, `DIP`) to where the beam meets the ground, a tail lamp's
   * straight back. Returns the next free instance (`k` when the lamp has no ground to light).
   * ponytail: one flat quad at the ground height under the beam's end; on a steep slope its near end floats or sinks.
   */
  private addPool(k: number, s: number, a: number): number {
    const st = this.stash;
    const o = s * 6;
    const px = st[o]!;
    const py = st[o + 1]!;
    const pz = st[o + 2]!;
    const dx = st[o + 3]!;
    const dy = st[o + 4]!;
    const dz = st[o + 5]!;
    const head = this.stashHead[s] === 1;
    const cx = px - _cam.x;
    const cz = pz - _cam.z;
    if (cx * cx + cz * cz > POOL_FAR_SQ) return k;
    const ground = activeGround();
    const h0 = ground.heightAt(px, pz, py);
    if (h0 === NO_FLOOR || py <= h0) return k;
    const flat = hypot2(dx, dz);
    if (flat < 0.05) return k;
    const fx = dx / flat;
    const fz = dz / flat;
    let y = h0;
    let len = TAIL_POOL;
    let wid = TAIL_POOL;
    if (head) {
      const ry = dy * AIM - DIP;
      if (ry > -0.01) return k;
      const t = (h0 - py) / ry;
      const reach = flat * AIM * t;
      if (reach < 0.5 || reach > HEAD.distance) return k;
      const g = ground.heightAt(px + dx * AIM * t, pz + dz * AIM * t, h0 + 0.5);
      if (g !== NO_FLOOR) y = g;
      len = Math.min(POOL_MAX, POOL_LEN * reach);
      wid = POOL_WIDTH * len;
    } else if (flat < 0.3) return k;
    const m = this.pools.instanceMatrix.array as Float32Array;
    const b = k * 16;
    m[b] = fz * wid;
    m[b + 1] = 0;
    m[b + 2] = -fx * wid;
    m[b + 3] = 0;
    m[b + 4] = 0;
    m[b + 5] = 1;
    m[b + 6] = 0;
    m[b + 7] = 0;
    m[b + 8] = fx * len;
    m[b + 9] = 0;
    m[b + 10] = fz * len;
    m[b + 11] = 0;
    m[b + 12] = px;
    m[b + 13] = y + POOL_LIFT;
    m[b + 14] = pz;
    m[b + 15] = 1;
    const col = head ? POOL_HEAD : POOL_TAIL;
    const c = this.pools.instanceColor!.array as Float32Array;
    c[k * 3] = col[0] * a;
    c[k * 3 + 1] = col[1] * a;
    c[k * 3 + 2] = col[2] * a;
    return k + 1;
  }

  dispose(): void {
    for (const l of [...this.spots, ...this.tailSpots]) l.dispose();
    const mat = this.glow.material as THREE.PointsMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.glow.geometry.dispose();
    const pm = this.pools.material as THREE.MeshBasicMaterial;
    pm.map?.dispose();
    pm.dispose();
    this.pools.geometry.dispose();
    this.pools.dispose();
  }
}

/** Soft round falloff, white with alpha (1 − r)²; built in code so it needs no DOM. */
function glowSprite(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.min(1, hypot2(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2));
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(255 * (1 - r) ** 2);
    }
  }
  const t = new THREE.DataTexture(data, n, n);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** A unit quad on the ground, x in ±0.5, z from 0 (the lamp's foot) to 1 (along the beam), facing up; uv.y runs with z. */
function poolQuad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

/**
 * A pool's falloff over `poolQuad`, white with alpha built in code (no DOM): a spot's ground pool is brightest a fifth of the way
 * along (where the beam's near edge meets the road), dark at the lamp's foot, then fans out and fades: alpha is `along × (1 − lateral²)²`,
 * `along` rising to the peak and falling as (1 − s)^1.6, the half width growing from 0.4 of the quad to all of it.
 */
function poolSprite(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const s = (y + 0.5) / n;
    const along = s < 0.2 ? 1 - ((0.2 - s) / 0.2) ** 2 : (1 - (s - 0.2) / 0.8) ** 1.6;
    const half = 0.4 + 0.6 * s;
    for (let x = 0; x < n; x++) {
      const lat = Math.min(1, Math.abs(((x + 0.5) / n - 0.5) * 2) / half);
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(255 * along * (1 - lat * lat) ** 2);
    }
  }
  const t = new THREE.DataTexture(data, n, n);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _tri = new THREE.Triangle();
const _cam = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tint = new THREE.Color();

/** A lamp unit's look: lit head and tail (the tail stays below ACES's bright-red-to-yellow knee so its lens reads red
 *  under its own glow), the tail as a running light (`TAIL_RUNNING` of it) and dark (a high brake lamp off the brakes: its red lens
 *  unlit), and broken (either kind). The lens alone emits: `lampEmissiveMap` masks the housing. */
const LAMP_LOOK = {
  head: { color: 0xffffff, emissive: 0xf4f1e8, emissiveIntensity: 1.15 },
  tail: { color: 0xffffff, emissive: 0xe01018, emissiveIntensity: 1.1 },
  running: { color: 0xffffff, emissive: 0xe01018, emissiveIntensity: 1.1 * TAIL_RUNNING },
  off: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 0 },
  broken: { color: 0x5a5c60, emissive: 0x1a1b1c, emissiveIntensity: 0.12 },
} as const;

/** A car as the lamp batch reads it: its lamps (seat, state, kind, unit variant), whether it is on its brakes, and its drawn-only lamp fittings (a lid's share with its lamp and lid, a marker's tint). */
interface LampCar {
  readonly lamps: readonly { readonly seat: THREE.Object3D; readonly intact: boolean; readonly kind: LampKind; readonly variant: number }[];
  readonly braking: boolean;
  readonly lampFittings: readonly {
    readonly seat: THREE.Object3D;
    readonly kind: keyof typeof FITTING_MESH;
    readonly variant: number;
    readonly share: { readonly lamp: { readonly intact: boolean }; readonly lid: { readonly detached: boolean } | null } | null;
    readonly tint?: THREE.Color | null;
  }[];
}

/** Each lamp fitting's slot in `LampBatch`, a lid share's broken one, and its slot while the car brakes (the tails' share and the
 *  high brake lamp burn bright; off the brakes the share is a running light and the high brake lamp dark). */
const FITTING_MESH = { brake: 12, marker: 5, hood: 6, boot: 7 } as const;
const SHARE_BROKEN = { brake: -1, marker: -1, hood: 8, boot: 9 } as const;
const FITTING_BRAKING = { brake: 4, marker: 5, hood: 6, boot: 11 } as const;
/** A tail lamp's slot while its car brakes. */
const TAIL_BRAKING = 10;

/** Per slot, the lamp family its seats draw and its look: head lit, head broken, tail running, tail broken, high brake lamp lit, marker,
 *  the heads' shares on the hood, the tails' on the boot lid, those two shares broken, the tails and their share braking, high brake dark,
 *  and by day (`BY_DAY`) the head, running tail and their shares unlit. */
const LAMP_SLOTS = [
  ["head", LAMP_LOOK.head],
  ["head", LAMP_LOOK.broken],
  ["tail", LAMP_LOOK.running],
  ["tail", LAMP_LOOK.broken],
  ["brake", LAMP_LOOK.tail],
  ["marker", LAMP_LOOK.head],
  ["hood", LAMP_LOOK.head],
  ["boot", LAMP_LOOK.running],
  ["hood", LAMP_LOOK.broken],
  ["boot", LAMP_LOOK.broken],
  ["tail", LAMP_LOOK.tail],
  ["boot", LAMP_LOOK.tail],
  ["brake", LAMP_LOOK.off],
  ["head", LAMP_LOOK.off],
  ["tail", LAMP_LOOK.off],
  ["hood", LAMP_LOOK.off],
  ["boot", LAMP_LOOK.off],
] as const;

/** Each slot's by day: a lit head lamp, a running tail and their lid shares draw their unlit lens; every other slot (broken, braking, the high brake lamp, a marker) is its own. */
const UNLIT_BY_DAY = new Map([[0, 13], [2, 14], [6, 15], [7, 16]]);
const BY_DAY = Int8Array.from(LAMP_SLOTS, (_, b) => UNLIT_BY_DAY.get(b) ?? b);

/** Whether `seat` shows: on the camera's layer (distance detail) and visible up its parent chain. */
function seatShown(seat: THREE.Object3D): boolean {
  let shown = seat.layers.isEnabled(0);
  for (let p: THREE.Object3D | null = seat; p && shown; p = p.parent) shown = p.visible;
  return shown;
}

/**
 * Every car's lamp units as ONE draw (`SeatDraw`) instead of four meshes per car. A car keeps a bare Object3D per lamp that it seats on
 * the skin, parented to the class lift but out of the scene graph; `sync` brings each shown seat's world matrix current from the lift's
 * and packs it with the unit variant its style draws (`lamps.shapes`) and its slot's look, so braking or a broken lamp only changes the
 * look. Brake lamps, side markers and the lamps' shares on the hood and boot lid are seats too.
 */
export class LampBatch {
  /** Every draw, for the scene. */
  readonly meshes: readonly THREE.Mesh[];
  readonly draw: SeatDraw;
  /** Night (`WorldStage.night`, as `LampLights.night`; the engine sets both every frame): by day the head and running tail lenses are unlit (`BY_DAY`). */
  night = true;
  /** Per slot (`LAMP_SLOTS`), the seats packed this sync. */
  private readonly n = new Int32Array(LAMP_SLOTS.length);
  /** Per slot, its family's first variant in the draw and how many it has. */
  private readonly first: Int32Array;
  private readonly variants: Int32Array;
  /** Per slot, its look's diffuse and emissive colours. */
  private readonly looks: readonly (readonly [THREE.Color, THREE.Color])[];
  /** Geometries the batch built (the fittings' are shared). */
  private readonly own: THREE.BufferGeometry[];

  /** `capacity`: each slot's worth of seats (two per car), as many again for the side markers. */
  constructor(capacity: number) {
    const families = {
      head: lampBatchGeometries("head") ?? [makeLampUnit("head")],
      tail: lampBatchGeometries("tail") ?? [makeLampUnit("tail")],
      brake: [brakeLampUnit()],
      marker: [sideMarkerUnit()],
      hood: lampBatchGeometries("hood") ?? [new THREE.BufferGeometry()],
      boot: lampBatchGeometries("boot") ?? [new THREE.BufferGeometry()],
    };
    this.own = [...families.head, ...families.tail, ...families.hood, ...families.boot];
    const variants: THREE.BufferGeometry[] = [];
    const first = new Map<keyof typeof families, number>();
    for (const [family, geos] of Object.entries(families) as [keyof typeof families, THREE.BufferGeometry[]][]) {
      first.set(family, variants.length);
      variants.push(...geos);
    }
    this.first = Int32Array.from(LAMP_SLOTS, ([family]) => first.get(family)!);
    this.variants = Int32Array.from(LAMP_SLOTS, ([family]) => families[family].length);
    this.looks = LAMP_SLOTS.map(([, look]) => [new THREE.Color(look.color), new THREE.Color(look.emissive).multiplyScalar(look.emissiveIntensity)] as const);
    // White in both: each seat's look multiplies them.
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.25, emissiveMap: lampEmissiveMap(), emissive: 0xffffff });
    this.draw = new SeatDraw(variants, material, capacity * (LAMP_SLOTS.length + 1), "lamp");
    this.meshes = [this.draw.mesh];
  }

  /** Pack the shown lamps of `cars` (the cars' own world matrices must be current). A seat off layer 0 (distance detail) is hidden. */
  sync(cars: readonly LampCar[]): void {
    this.n.fill(0);
    this.draw.begin();
    for (const car of cars) {
      for (const l of car.lamps) {
        if (!seatShown(l.seat)) continue;
        this.put(!l.intact ? (l.kind === "head" ? 1 : 3) : l.kind === "head" ? 0 : car.braking ? TAIL_BRAKING : 2, l.seat, l.variant);
      }
      for (const f of car.lampFittings) {
        if (!seatShown(f.seat)) continue;
        // A lid's share goes dark with its lamp, and once its lid has torn off.
        const dark = f.share !== null && (!f.share.lamp.intact || f.share.lid?.detached === true);
        this.put(dark ? SHARE_BROKEN[f.kind] : car.braking ? FITTING_BRAKING[f.kind] : FITTING_MESH[f.kind], f.seat, f.variant, f.tint);
      }
    }
    this.draw.end();
  }

  /** Seats packed into slot `b` by the last sync. */
  drawn(b: number): number {
    return this.n[b]!;
  }

  private put(slot: number, seat: THREE.Object3D, variant: number, tint?: THREE.Color | null): void {
    seat.updateWorldMatrix(false, false);
    const b = this.night ? slot : BY_DAY[slot]!;
    const [color, glow] = this.looks[b]!;
    const look = tint ? _tint.copy(color).multiply(tint) : color;
    if (this.draw.put(this.first[b]! + (this.variants[b] === 1 ? 0 : variant), seat.matrixWorld, look, glow)) this.n[b]!++;
  }

  dispose(): void {
    for (const g of this.own) g.dispose();
    this.draw.dispose();
  }
}
