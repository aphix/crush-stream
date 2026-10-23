import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { C_GRIP, C_H, C_OWNER, C_SURF, HIT_SIZE, pointContact, PQ_SIZE, PQ_X, PQ_Y, PQ_Z } from "../world/surfaces.ts";
import { SURFACE_IDS, type SurfaceId } from "../world/catalog.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { MIN_SIM_DT } from "./constants.ts";
import { carClass, CLASSES, drivenAxles } from "../vehicle/vehicle-classes.ts";

/**
 * Tyre marks on the GPU. Every slipping wheel stamps one short quad per frame into ONE ground-aligned render
 * target (the mark map); ground materials sample it by world xz (`applyMarkMap`). Draw cost is constant
 * however many marks exist: no per-mark meshes, the stamps of two frames go in one draw, an empty frame renders
 * nothing, and a slow subtractive fade pass ages old marks out.
 *
 * The map covers the course, or on a course wider than `MARK_TEXEL` texels allow, a window round what the shot watches: the
 * map wraps (world xz / window size is its uv), so the window slides a step at a time and wipes only the band it enters.
 *
 * Channels: R rubber (asphalt, concrete, cobble), G rut / scrape groove (dirt, gravel, sand, a bare hub),
 * B torn turf (grass).
 */

/** Surface id → mark channel (0 rubber, 1 rut, 2 turf); the rest leave rubber. Read from the surface under the tyre (`pointContact`). */
const CHANNEL: Partial<Record<SurfaceId, number>> = { dirt: 1, gravel: 1, sand: 1, grass: 2 };

/** Sandbox mark rect: the 48 m ground disc. */
const SANDBOX = { minX: -48, minZ: -48, maxX: 48, maxZ: 48 } as const;

const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
blank.needsUpdate = true;

/** Shared by every material `applyMarkMap` patches; `uMarkRect` = the window (minX, minZ, 1/sizeX, 1/sizeZ). */
const markMapUniforms = {
  uMarkMap: { value: blank as THREE.Texture },
  uMarkRect: {
    value: new THREE.Vector4(SANDBOX.minX, SANDBOX.minZ, 1 / (SANDBOX.maxX - SANDBOX.minX), 1 / (SANDBOX.maxZ - SANDBOX.minZ)),
  },
};

/** Patch a ground / road MeshStandardMaterial to darken by the mark map, sampled at its world xz. */
export function applyMarkMap(material: THREE.MeshStandardMaterial): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uMarkMap = markMapUniforms.uMarkMap;
    shader.uniforms.uMarkRect = markMapUniforms.uMarkRect;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMarkXZ;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvMarkXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uMarkMap;\nuniform vec4 uMarkRect;\nvarying vec2 vMarkXZ;")
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
vec2 markIn = (vMarkXZ - uMarkRect.xy) * uMarkRect.zw;
vec4 markS = texture2D(uMarkMap, vMarkXZ * uMarkRect.zw) * (step(0.0, markIn.x) * step(markIn.x, 1.0) * step(0.0, markIn.y) * step(markIn.y, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.004, 0.004, 0.005), markS.r * 0.95);
diffuseColor.rgb *= 1.0 - markS.g * 0.55;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.05, 0.028), markS.b * 0.85);`,
      )
      // The asphalt reads grey mostly from grazing env specular: rubber and ruts must kill it too.
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
float markDark = clamp(markS.r * 0.92 + markS.g * 0.5 + markS.b * 0.4, 0.0, 1.0);
reflectedLight.indirectSpecular *= 1.0 - markDark;
reflectedLight.directSpecular *= 1.0 - markDark * 0.8;
reflectedLight.indirectDiffuse *= 1.0 - markDark * 0.5;`,
      );
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}|marks`;
  material.needsUpdate = true;
}

// The window spans at most two map periods per axis; instance i draws period (i & 1, i >> 1) past the window's first.
const STAMP_VERT = /* glsl */ `
attribute vec4 aInk;
uniform vec4 uRect;
varying vec4 vInk;
varying float vEdge;
varying vec2 vIn;
void main() {
  vInk = aInk;
  vEdge = position.z;
  vIn = (position.xy - uRect.xy) * uRect.zw;
  vec2 period = floor(uRect.xy * uRect.zw) + vec2(gl_InstanceID % 2, gl_InstanceID / 2);
  gl_Position = vec4((position.xy * uRect.zw - period) * 2.0 - 1.0, 0.0, 1.0);
}`;

const STAMP_FRAG = /* glsl */ `
varying vec4 vInk;
varying float vEdge;
varying vec2 vIn;
void main() {
  if (min(vIn.x, vIn.y) < 0.0 || max(vIn.x, vIn.y) >= 1.0) discard;
  gl_FragColor = vInk * (1.0 - smoothstep(0.45, 1.0, abs(vEdge)));
}`;

/** Wheel order matches `car.wheels` / `frame.wheels`: FL, FR, RL, RR. */
const HUBS = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;
const TYRE_W = 0.24;
const GROOVE_W = 0.07;
/** Rear-wheel sideways speed (m/s) where a slide starts to mark, at grip 1; a full-lock arcade turn stays under it. */
const SLIDE_START = 2.3;
const SLIDE_FULL = 4.5;
/** Handling's `drive.slide` counts any sideways creep; marks start at a real slide and are full at a drift. */
const DRIVE_SLIDE_START = 0.25;
const DRIVE_SLIDE_FULL = 0.8;
/** Subtract one 8-bit step from the whole map this often (s): a full-black mark is gone in ~2.5 min. */
const FADE_EVERY = 0.6;
/** Fades that take a full-ink texel to 0 (one 8-bit step each): a map with no stamps for this many is empty, and its fade is skipped. */
const FADES_TO_EMPTY = 255;
/** Frames the stamps wait to go into the map in one draw (a wheel's mark is drawn at most this many frames late). */
const DRAW_EVERY_FRAMES = 2;
/** Largest map texel (m): a 24 cm tyre is wider than its diagonal (14 cm), so a stamp covers a texel centre in every row it crosses (no dots). */
const MARK_TEXEL = 0.1;
/** The window moves in steps of this fraction of its size (a whole number of texels), wiping the band each step enters. */
const WINDOW_STEPS = 16;
/** A phone's map stops at this edge (texels): 4 MiB, not 16 plus mips, blurrier marks, and an Auto tier flip never resizes it. */
const PHONE_MAP_SIZE = 1024;

type WheelFx = {
  /** 0–1 slip this frame per wheel slot (car index × 4 + wheel). */
  readonly slip: Float32Array;
  /** 1 when a bare hub scrapes the ground this frame. */
  readonly scrape: Uint8Array;
  /** Surface channel under the wheel (0 rubber, 1 rut, 2 turf). */
  readonly channel: Uint8Array;
  /** Wheel contact (x, z) and velocity (x, z) per slot. */
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vz: Float32Array;
};

const _q = new THREE.Vector3();
const _hit = new Float64Array(HIT_SIZE);
const _pq = new Float64Array(PQ_SIZE);
const _clear = new THREE.Color();

/** What a draw into the mark map asks of the renderer. */
export type MarkRenderer = Pick<THREE.WebGLRenderer, "autoClear" | "getRenderTarget" | "setRenderTarget" | "getClearColor" | "getClearAlpha" | "setClearColor" | "clear" | "render">;

export class SkidMarks {
  /** Per-wheel results for smoke and sparks (`engine-cine.ts`). */
  readonly wheels: WheelFx;
  private rt: THREE.WebGLRenderTarget | null = null;
  /** The map is sampled and stamped (low / high tier); off keeps the target for the next switch. */
  private on = false;
  /** Offscreen stamp + fade draw, exposed so the boot warm-up can link their programs. */
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.Camera();
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly pos: Float32Array;
  private readonly ink: Float32Array;
  private readonly stamp: THREE.Mesh;
  private readonly fade: THREE.Mesh;
  /** Quads the stamp buffers hold: every wheel's stamp for `DRAW_EVERY_FRAMES` frames. */
  private readonly cap: number;
  private readonly maxCars: number;
  private readonly hasPrev: Uint8Array;
  /** Per wheel slot: the end edge of its last stamp (left x, z, right x, z), where the next one starts while `joinedWidth` matches. */
  private readonly edge: Float32Array;
  /** Per wheel slot: the width of the stamp it queued last frame, 0 when it queued none (its strip starts afresh). */
  private readonly joinedWidth: Float32Array;
  /** The course the marks cover (minX, minZ, sizeX, sizeZ); the window (`uMarkRect`) is all of it or a part round the shot's focus. */
  private readonly course = new THREE.Vector4(SANDBOX.minX, SANDBOX.minZ, SANDBOX.maxX - SANDBOX.minX, SANDBOX.maxZ - SANDBOX.minZ);
  /** Per car: launch spin held and eased out, so a boost launch lays two tapering stripes, not a 1 m dab. */
  private readonly spinHold: Float32Array;
  private quads = 0;
  /** `flush` calls since the last draw that found stamps waiting. */
  private framesQueued = 0;
  private fadeAcc = 0;
  /** Fades the map still needs before it holds no ink: 0 after a full wipe, `FADES_TO_EMPTY` after each stamp draw. */
  private fadesOwed = 0;
  private needsClear = true;
  private any = false;
  /** A phone's map stops at `PHONE_MAP_SIZE`: set once, before the first `setResolution`. */
  phone = false;

  constructor(maxCars: number) {
    const slots = maxCars * 4;
    this.maxCars = maxCars;
    this.cap = slots * DRAW_EVERY_FRAMES;
    this.wheels = {
      slip: new Float32Array(slots),
      scrape: new Uint8Array(slots),
      channel: new Uint8Array(slots),
      px: new Float32Array(slots),
      pz: new Float32Array(slots),
      vx: new Float32Array(slots),
      vz: new Float32Array(slots),
    };
    this.hasPrev = new Uint8Array(slots);
    this.edge = new Float32Array(slots * 4);
    this.joinedWidth = new Float32Array(slots);
    this.spinHold = new Float32Array(maxCars);
    this.pos = new Float32Array(this.cap * 4 * 3);
    this.ink = new Float32Array(this.cap * 4 * 4);
    const index = new Uint16Array(this.cap * 6);
    for (let i = 0; i < this.cap; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    this.geo.setIndex(new THREE.BufferAttribute(index, 1));
    // The window's two map periods per axis: one instance draws each (`STAMP_VERT`).
    this.geo.instanceCount = 4;
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aInk", new THREE.BufferAttribute(this.ink, 4).setUsage(THREE.DynamicDrawUsage));
    const additive = {
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      // Quad winding flips with travel direction in the map's xz → clip mapping.
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      forceSinglePass: true, // additive blend is order-independent, so skip three's back-then-front double draw
    } as const;
    this.stamp = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({ vertexShader: STAMP_VERT, fragmentShader: STAMP_FRAG, uniforms: { uRect: markMapUniforms.uMarkRect }, ...additive }),
    );
    this.stamp.frustumCulled = false;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fade = new THREE.Mesh(
      tri,
      new THREE.ShaderMaterial({
        vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0 / 255.0); }",
        ...additive,
        blendEquation: THREE.ReverseSubtractEquation,
      }),
    );
    this.fade.frustumCulled = false;
    this.scene.add(this.stamp, this.fade);
  }

  /** Map edge in texels (0 = no map: the off tier), capped on a phone. The target is created once and resized in place; the map is wiped. */
  setResolution(tierSize: number): void {
    const size = this.phone ? Math.min(tierSize, PHONE_MAP_SIZE) : tierSize;
    this.on = size > 0;
    if (this.on) {
      if (!this.rt) {
        this.rt = new THREE.WebGLRenderTarget(size, size, {
          depthBuffer: false,
          stencilBuffer: false,
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
          magFilter: THREE.LinearFilter,
          wrapS: THREE.RepeatWrapping,
          wrapT: THREE.RepeatWrapping,
        });
        this.rt.texture.anisotropy = 8;
      }
      this.rt.setSize(size, size);
    }
    markMapUniforms.uMarkMap.value = this.on ? this.rt!.texture : blank;
    this.clear();
  }

  /** Wipe every mark (scene reset) and forget wheel history so nothing stamps across the teleport. */
  clear(): void {
    this.needsClear = true;
    this.quads = 0;
    this.framesQueued = 0;
    this.hasPrev.fill(0);
    this.joinedWidth.fill(0);
    this.spinHold.fill(0);
    this.wheels.slip.fill(0);
    this.wheels.scrape.fill(0);
    this.any = false;
  }

  /**
   * Read every live car's wheels (state only) and queue this frame's stamps. Per wheel still on its hub:
   * Handling's `car.drive` slip (launch `spin` on the rear, brake `lock` on all four, `slide` for drifts and
   * handbrake turns) plus the rear wheels' own sideways speed (wrecks sliding with no driver). A wheel off
   * its hub marks nothing; the bare hub scraping low leaves a groove. Slide thresholds scale with grip.
   */
  update(cars: readonly DeformableCar[], simDt: number): void {
    const w = this.wheels;
    if (simDt <= MIN_SIM_DT) return;
    const n = Math.min(cars.length, this.maxCars);
    let any = false;
    for (let c = 0; c < n; c++) {
      const car = cars[c]!;
      const v = car.velocity;
      const fx = car.fwdFlat.x;
      const fz = car.fwdFlat.z;
      const hadPrev = this.hasPrev[c * 4] === 1;
      const lock = car.drive.lock;
      // Launch spin eases out at 1.4/s after Handling's spin ends; a boost launch also spins the driven wheels up to
      // ~14 m/s (a visual cheat: Handling's own spin is gone by 7 m/s), so it lays long tapering stripes.
      const along = v.x * fx + v.z * fz;
      const launch = car.drive.throttle > 0.5 ? car.drive.boostK * ramp(14 - along, 0, 6) : 0;
      const spin = (this.spinHold[c] = Math.max(car.drive.spin, launch, this.spinHold[c]! - simDt * 1.4));
      const bodySlide = ramp(car.drive.slide, DRIVE_SLIDE_START, DRIVE_SLIDE_FULL);
      // The driven axles lay the launch stripes: a FWD car's fronts, a RWD car's rears, a 4WD car's all four.
      const driven = drivenAxles(CLASSES[carClass(car)]);
      const tyreR = car.frame.rig.tyre.r;
      for (let k = 0; k < 4; k++) {
        const s = c * 4 + k;
        if (!car.group.visible) {
          this.hasPrev[s] = 0;
          w.slip[s] = 0;
          continue;
        }
        // A popped hub's wheel may have left for the world (`dropWheel`): track the bare hub instead.
        const popped = car.deform.massActive && car.deform.hubPopped(HUBS[k]!);
        if (popped) _q.copy(car.deform.massWorld(HUBS[k]!));
        else _q.copy(car.wheels[k]!.position).applyQuaternion(car.group.quaternion).add(car.group.position);
        const x = _q.x;
        const z = _q.z;
        const vx = hadPrev ? (x - w.px[s]!) / simDt : 0;
        const vz = hadPrev ? (z - w.pz[s]!) / simDt : 0;
        const jump = vx * vx + vz * vz > 80 * 80;
        // Where the tyre's bottom stands on the store's surfaces, asked as the sim asks it (a wheel over a deck sees the deck, one on
        // another car's roof is not on the mark map's floor), whatever moves the car: its drive, a wreck's masses, a netplay pose.
        _pq[PQ_X] = x;
        _pq[PQ_Z] = z;
        _pq[PQ_Y] = _q.y - tyreR;
        pointContact(_pq, car.slot, _hit);
        const gap = _q.y - tyreR - _hit[C_H]!;
        const grounded = gap < 0.14 && _hit[C_OWNER]! < 0;
        const grip = _hit[C_GRIP]!;
        const rear = k >= 2;
        let slip = 0;
        let scrape = 0;
        if (hadPrev && !jump && grounded && !popped) {
          const side = Math.abs(vx * fz - vz * fx);
          // Front tyres steer with the turn; only body sideslip (the hull's own velocity) slides them.
          const slide = Math.max(
            rear ? ramp(side, SLIDE_START * grip, SLIDE_FULL * grip) : ramp(Math.abs(v.x * fz - v.z * fx), SLIDE_START * grip, SLIDE_FULL * grip),
            rear ? bodySlide : bodySlide * 0.5,
          );
          slip = Math.max(slide, lock, (driven & (rear ? 2 : 1)) !== 0 ? spin : 0);
        } else if (hadPrev && !jump && popped && gap < -tyreR * 0.25 && vx * vx + vz * vz > 2) {
          scrape = 1;
          slip = 0.9;
        }
        w.slip[s] = slip;
        w.scrape[s] = scrape;
        const ch = scrape ? 1 : (CHANNEL[SURFACE_IDS[_hit[C_SURF]!]!] ?? 0);
        w.channel[s] = ch;
        if (slip > 0.04 && this.rt) this.queue(s, w.px[s]!, w.pz[s]!, x, z, scrape ? GROOVE_W : TYRE_W, ch, Math.min(1, slip * 0.9));
        else this.joinedWidth[s] = 0;
        if (slip > 0.04) any = true;
        w.px[s] = x;
        w.pz[s] = z;
        w.vx[s] = vx;
        w.vz[s] = vz;
        this.hasPrev[s] = jump ? 0 : 1;
      }
    }
    this.any = any;
  }

  /** True when any wheel slipped this frame (`wheels` holds the detail). */
  get slipping(): boolean {
    return this.any;
  }

  /** Re-target the mark map to a world rect (a race track's bounds); the next flush wipes it. */
  setBounds(minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.course.set(minX, minZ, Math.max(1e-3, maxX - minX), Math.max(1e-3, maxZ - minZ));
    this.needsClear = true;
  }

  /**
   * Draw the queued stamps and the periodic fade into the map; call once per frame before the main render, with the ground
   * position the shot watches (`focusX`, `focusZ`), which the window follows. Stamps wait up to `DRAW_EVERY_FRAMES` calls and go in one
   * `render()`: a fade, a wipe or a window step never waits.
   */
  flush(renderer: MarkRenderer, wallDt: number, focusX: number, focusZ: number): void {
    const rt = this.rt;
    if (!rt || !this.on) return;
    this.fadeAcc += wallDt;
    const due = this.fadeAcc >= FADE_EVERY;
    if (due) this.fadeAcc = 0;
    const fade = due && this.fadesOwed > 0;
    const rect = markMapUniforms.uMarkRect.value;
    const fromX = rect.x;
    const fromZ = rect.y;
    this.placeWindow(rt.width, focusX, focusZ);
    const moved = !this.needsClear && (rect.x !== fromX || rect.y !== fromZ);
    const wiped = this.needsClear || moved;
    if (!wiped && !fade && this.quads === 0) return;
    if (!wiped && !fade && ++this.framesQueued < DRAW_EVERY_FRAMES) return;
    this.framesQueued = 0;
    const prevTarget = renderer.getRenderTarget();
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    if (this.needsClear) {
      this.wipe(renderer, rt, 0, 0, rt.width, rt.width);
      this.fadesOwed = 0;
    }
    if (moved) {
      this.wipeBand(renderer, rt, 0, fromX, rect.x, 1 / rect.z);
      this.wipeBand(renderer, rt, 1, fromZ, rect.y, 1 / rect.w);
    }
    this.needsClear = false;
    renderer.setRenderTarget(rt);
    this.stamp.visible = this.quads > 0;
    this.fade.visible = fade;
    if (fade) this.fadesOwed--;
    if (this.quads > 0) {
      this.fadesOwed = FADES_TO_EMPTY;
      this.geo.setDrawRange(0, this.quads * 6);
      (this.geo.attributes.position as THREE.BufferAttribute).addUpdateRange(0, this.quads * 12);
      (this.geo.attributes.aInk as THREE.BufferAttribute).addUpdateRange(0, this.quads * 16);
      this.geo.attributes.position!.needsUpdate = true;
      this.geo.attributes.aInk!.needsUpdate = true;
    }
    if (this.quads > 0 || fade) renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = ac;
    this.quads = 0;
  }

  /** The window (`uMarkRect`) for a map `size` texels wide: per axis the whole course, or `size * MARK_TEXEL` m round the focus, on the step grid. */
  private placeWindow(size: number, focusX: number, focusZ: number): void {
    const c = this.course;
    const reach = size * MARK_TEXEL;
    const wx = Math.min(c.z, reach);
    const wz = Math.min(c.w, reach);
    markMapUniforms.uMarkRect.value.set(windowStart(c.x, c.z, wx, focusX), windowStart(c.y, c.w, wz, focusZ), 1 / wx, 1 / wz);
  }

  /** Wipe the map texels of the world band a window move on `axis` (0 x: columns, 1 z: rows) from start `from` to `to` brought in. */
  private wipeBand(renderer: MarkRenderer, rt: THREE.WebGLRenderTarget, axis: 0 | 1, from: number, to: number, size: number): void {
    if (from === to) return;
    const n = rt.width;
    const count = Math.min(n, Math.round((Math.abs(to - from) / size) * n));
    const start = to > from ? from + size : to;
    const first = ((Math.round((start / size) * n) % n) + n) % n;
    const head = Math.min(count, n - first);
    this.wipe(renderer, rt, axis === 0 ? first : 0, axis === 0 ? 0 : first, axis === 0 ? head : n, axis === 0 ? n : head);
    if (count > head) this.wipe(renderer, rt, 0, 0, axis === 0 ? count - head : n, axis === 0 ? n : count - head);
  }

  /** Clear the texel rect (x, y, w, h) of the map to no marks. */
  private wipe(renderer: MarkRenderer, rt: THREE.WebGLRenderTarget, x: number, y: number, w: number, h: number): void {
    rt.scissor.set(x, y, w, h);
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.getClearColor(_clear);
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setClearColor(_clear, alpha);
    rt.scissorTest = false;
  }

  /**
   * Boot / course warm-up: draw the stamp and the fade into the map through a zero-area scissor, so their
   * first real use (the first slip, often seconds into a race) neither links nor fetches uniforms.
   */
  warm(renderer: THREE.WebGLRenderer): void {
    const rt = this.rt;
    if (!rt) return;
    this.stamp.visible = true;
    this.fade.visible = true;
    rt.scissorTest = true;
    rt.scissor.set(0, 0, 0, 0);
    renderer.setRenderTarget(rt);
    renderer.render(this.scene, this.camera);
    rt.scissorTest = false;
    this.stamp.visible = false;
    this.fade.visible = false;
  }

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    markMapUniforms.uMarkMap.value = blank;
    this.geo.dispose();
    (this.stamp.material as THREE.Material).dispose();
    this.fade.geometry.dispose();
    (this.fade.material as THREE.Material).dispose();
  }

  /**
   * One quad from wheel slot `s`'s last contact to this one, `width` across, ink `a` in channel `ch`. It starts on the slot's last
   * stamp's end edge, so a wheel's stamps join in one strip of even width, round a turn too.
   */
  private queue(s: number, x0: number, z0: number, x1: number, z1: number, width: number, ch: number, a: number): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = hypot2(dx, dz);
    if (len < 1e-4) return;
    if (this.quads >= this.cap) {
      this.joinedWidth[s] = 0;
      return;
    }
    const nx = (-dz / len) * width * 0.5;
    const nz = (dx / len) * width * 0.5;
    const e = this.edge;
    const eo = s * 4;
    const joined = this.joinedWidth[s] === Math.fround(width) && (e[eo + 2]! - e[eo]!) * nx + (e[eo + 3]! - e[eo + 1]!) * nz > 0;
    const q = this.quads++;
    const p = this.pos;
    let o = q * 12;
    p[o++] = joined ? e[eo]! : x0 - nx; p[o++] = joined ? e[eo + 1]! : z0 - nz; p[o++] = -1;
    p[o++] = joined ? e[eo + 2]! : x0 + nx; p[o++] = joined ? e[eo + 3]! : z0 + nz; p[o++] = 1;
    p[o++] = x1 + nx; p[o++] = z1 + nz; p[o++] = 1;
    p[o++] = x1 - nx; p[o++] = z1 - nz; p[o] = -1;
    e[eo] = x1 - nx;
    e[eo + 1] = z1 - nz;
    e[eo + 2] = x1 + nx;
    e[eo + 3] = z1 + nz;
    this.joinedWidth[s] = width;
    const r = ch === 0 ? a : 0;
    const g = ch === 1 ? a : ch === 2 ? a * 0.3 : 0;
    const b = ch === 2 ? a : 0;
    const ink = this.ink;
    for (let i = q * 16; i < q * 16 + 16; i += 4) {
      ink[i] = r;
      ink[i + 1] = g;
      ink[i + 2] = b;
      ink[i + 3] = 0;
    }
  }
}

/** Start of a window `w` m wide on one axis of a course from `min`, `extent` m long: the course's start when it fits, else on the step grid round `focus`. */
function windowStart(min: number, extent: number, w: number, focus: number): number {
  if (extent <= w) return min;
  const step = w / WINDOW_STEPS;
  return (Math.floor(focus / step) - WINDOW_STEPS / 2) * step;
}

/** 0 below `a`, 1 above `b`, linear between. */
function ramp(x: number, a: number, b: number): number {
  return x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
}
