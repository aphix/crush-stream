import * as THREE from "three";
import { TIME_OF_DAY, type TimeOfDay } from "../match/types.ts";
import { loadUprightBitmap } from "./bitmap-loader.ts";
import type { FxTier } from "./engine-post.ts";
import { PROCEDURAL_LOOKS, PROCEDURAL_SKY_GLSL, SANDBOX_SKY, type SkyStops } from "./sky-procedural.ts";

const BASE = import.meta.env?.BASE_URL ?? "/";
const TURN = 2 * Math.PI;

/**
 * One time of day's sky: a 360° panorama strip (`public/sky/<time>.webp`, a seamless loop; one column a 1/width turn, square
 * pixels) and what was read off it (`SKY_LOOKS`): the row of its horizon,
 * the column of its sun or moon disc (null: none in the picture), the colour along its horizon (the haze it blends into and,
 * past day, the course's fog), at `MID_ELEVATION` and at its top (what the sky fades to past the strip, toward the zenith).
 */
type SkyLook = {
  /** Strip size (px). */
  width: number;
  height: number;
  /** Horizon row from the top (px). */
  horizonRow: number;
  /** The disc's column (px) and its centre's row from the top (px); null when the picture has none. */
  disc: { column: number; row: number } | null;
  /** Median colour just over the horizon, `MID_ELEVATION` up and over the top rows (sRGB hex): the plain gradient's three stops. */
  horizon: string;
  mid: string;
  zenith: string;
  /** Elevation (rad) where the plain gradient has reached the zenith colour: where the strip itself stops changing. */
  zenithElevation: number;
  /** Elevation (rad) over which the picture rises out of the haze colour: wide by day, where each course's own haze differs from the picture's. */
  hazeTop: number;
};

/** Elevation (rad) of the plain gradient's middle stop (20°). */
const MID_ELEVATION = 0.35;

/**
 * Read off the strips (the generator and the reader were throwaway scripts; these are what they measured). Day is five gpt-image-1
 * generations seam-matched row by row and cross-faded; sunset is that strip regraded to golden hour with a low sun, and night is
 * procedural (stars, a Milky Way of layered noise, a moon), both made locally when the image API ran out of credit.
 */
export const SKY_LOOKS: Record<TimeOfDay, SkyLook> = {
  [TIME_OF_DAY.day]: { width: 4096, height: 780, horizonRow: 702, disc: { column: 138, row: 116 }, horizon: "#adc3c9", mid: "#69a8cb", zenith: "#24629b", zenithElevation: 1.05, hazeTop: 0.2 },
  [TIME_OF_DAY.sunset]: { width: 4096, height: 780, horizonRow: 702, disc: { column: 410, row: 657 }, horizon: "#cd877a", mid: "#755291", zenith: "#292761", zenithElevation: 0.55, hazeTop: 0.07 },
  [TIME_OF_DAY.night]: { width: 4096, height: 780, horizonRow: 702, disc: { column: 410, row: 298 }, horizon: "#213151", mid: "#0b1229", zenith: "#050816", zenithElevation: 0.7, hazeTop: 0.07 },
};

/** Elevation (rad) of a strip row: square pixels, a full turn across the width. */
export function rowElevation(look: SkyLook, row: number): number {
  return ((look.horizonRow - row) * TURN) / look.width;
}

/**
 * The texture's u at bearing 0 (u = bearing / turn + this): the disc's column lands on `discBearing` (rad from −z toward +x),
 * so the sun or moon drawn in the sky stands where the light comes from.
 */
export function uAtNorth(look: SkyLook, discBearing: number): number {
  const u = look.disc ? look.disc.column / look.width - discBearing / TURN : 0;
  return u - Math.floor(u);
}

/** The player's Sky setting: `auto` draws the sky the FX tier affords (none on minimal and off), `on` always draws one (the plain gradient at least), `full` always draws the full picture, `off` never draws any. */
export const SKY_MODES = ["auto", "on", "full", "off"] as const;
export type SkyMode = (typeof SKY_MODES)[number];

/**
 * How much sky is drawn: the full 4096-wide strip (17 MB with its mips) on high and ultra, a 2048-wide one (4 MB) on low, and on
 * the canvas-only tiers (minimal, off) nothing, or with the Sky setting `on` a plain three-stop gradient with no texture at all.
 * The Sky setting `full` draws the full strip on every tier; a procedural sky (`sky-procedural.ts`, no texture) replaces whichever
 * of them is drawn, so under `auto` it too is none on the canvas-only tiers.
 */
export type SkyDetail = "off" | "gradient" | "half" | "full" | "procedural";

export function skyDetailFor(mode: SkyMode, tier: FxTier, procedural = false): SkyDetail {
  const detail = pictureDetail(mode, tier);
  return procedural && detail !== "off" ? "procedural" : detail;
}

function pictureDetail(mode: SkyMode, tier: FxTier): SkyDetail {
  if (mode === "off") return "off";
  if (mode === "full" || tier === "high" || tier === "ultra") return "full";
  if (tier === "low") return "half";
  return mode === "on" ? "gradient" : "off";
}

/** The sky as drawn: a small whole number a second of a bench's page series holds (`SkyDome.drawn`). */
export const SKY_DRAWN = { off: 0, gradient: 1, half: 2, full: 3, loading: 4, procedural: 5 } as const;
export type SkyDrawn = (typeof SKY_DRAWN)[keyof typeof SKY_DRAWN];

/** The procedural sky's clock (s) wraps this often, so the shader's float keeps its precision (the clouds jump once a wrap). */
const TIME_WRAP_S = 3600;

/** Clip-space depth of the dome, as a share of w: past every surface the far plane keeps (the backdrop's, nearer, draws over it). */
const FAR_DEPTH = 0.9999995;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position.z = gl_Position.w * ${FAR_DEPTH};
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uTextured;
uniform vec3 haze;
uniform vec3 horizonColor;
uniform vec3 midColor;
uniform vec3 zenith;
uniform float uNorth;
uniform float horizonV;
uniform float vPerRad;
uniform float topEl;
uniform float zenithEl;
uniform float hazeTop;
varying vec3 vDir;
const float TURN = 6.28318530718;
const float MID_EL = ${MID_ELEVATION};
${PROCEDURAL_SKY_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec3 c;
  if (uProcedural > 0.5) {
    c = proceduralSky(d, el);
  } else if (uTextured > 0.5) {
    float u = atan(d.x, -d.z) / TURN + uNorth;
    vec2 uv = vec2(fract(u), clamp(horizonV + el * vPerRad, 0.0005, 0.9995));
    // The gradients from whichever of u and u + 1/2 has no seam here, so the wrap column samples the finest mip like the rest.
    float a = fract(u + 0.5);
    vec2 dx = vec2(abs(dFdx(uv.x)) < abs(dFdx(a)) ? dFdx(uv.x) : dFdx(a), dFdx(uv.y));
    vec2 dy = vec2(abs(dFdy(uv.x)) < abs(dFdy(a)) ? dFdy(uv.x) : dFdy(a), dFdy(uv.y));
    c = textureGrad(map, uv, dx, dy).rgb;
    c = mix(c, zenith, smoothstep(topEl - 0.18, topEl, el));
  } else {
    c = mix(mix(horizonColor, midColor, smoothstep(0.0, MID_EL, el)), zenith, smoothstep(MID_EL, zenithEl, el));
  }
  c = mix(haze, c, smoothstep(0.0, hazeTop, el));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * The race's sky (`WorldStage.setTime`): the time of day's picture on a sphere round the camera, drawn at infinity (turned with
 * the camera, never moved, on the far plane, writing no depth) after everything opaque, so the depth test skips every pixel a
 * surface already covers. It takes no fog and no tone mapping, as the flat sky colour it replaces; under its own `hazeTop` it
 * fades into the scene's fog colour, so the fogged course meets it with no seam. `setDetail` picks how much of it is drawn (`SkyDetail`);
 * only the picture in use is held, each loads when first asked for, and until it is in the flat colour shows. A procedural sky
 * (`setProcedural`) draws in the sandbox too.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private time: TimeOfDay | null = null;
  private detail: SkyDetail = "off";
  private held: { key: string; texture: THREE.Texture } | null = null;
  private loading: string | null = null;
  /** The procedural sky's cloud cover (0-1), null for none; the sandbox's night setting picks its look. */
  private cover: number | null = null;
  private night = false;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private readonly cloudLit = new THREE.Color();
  private readonly cloudShade = new THREE.Color();
  private readonly discTint = new THREE.Vector3();

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        map: { value: null },
        uTextured: { value: 0 },
        haze: { value: new THREE.Color() },
        horizonColor: { value: new THREE.Color() },
        midColor: { value: new THREE.Color() },
        zenith: { value: new THREE.Color() },
        uNorth: { value: 0 },
        horizonV: { value: 0 },
        vPerRad: { value: 0 },
        topEl: { value: 0 },
        zenithEl: { value: 0 },
        hazeTop: { value: 0 },
        uProcedural: { value: 0 },
        uCover: { value: 0 },
        uSunDir: { value: this.sunDir },
        uTime: { value: 0 },
        uCloudLit: { value: this.cloudLit },
        uCloudShade: { value: this.cloudShade },
        uDiscTint: { value: this.discTint },
        uStars: { value: 0 },
      },
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.mat);
    this.mesh.name = "sky-dome";
    // A unit sphere at the origin that the shader carries to the sky: never culled, never hit, last of the opaque draws.
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.mesh.renderOrder = 2e9;
    this.mesh.visible = false;
    const clock = this.mat.uniforms.uTime!;
    this.mesh.onBeforeRender = () => {
      clock.value = (performance.now() * 0.001) % TIME_WRAP_S;
    };
  }

  /** The haze the dome fades into at its horizon: the scene's fog colour, which `WorldStage.apply` hands over whenever it recolours the fog. */
  setHaze(color: THREE.Color): void {
    (this.mat.uniforms.haze!.value as THREE.Color).copy(color);
  }

  /** Show `time`'s sky with its disc on `discBearing` (rad), or none (null). */
  show(time: TimeOfDay | null, discBearing: number): void {
    this.time = time;
    if (time !== null) {
      const look = SKY_LOOKS[time];
      const u = this.mat.uniforms;
      u.uNorth!.value = uAtNorth(look, discBearing);
      u.horizonV!.value = 1 - look.horizonRow / look.height;
      u.vPerRad!.value = look.width / TURN / look.height;
      u.topEl!.value = rowElevation(look, 0);
      this.setStops(look);
    }
    this.refresh();
  }

  /** The procedural sky with this cloud cover (0-1), or null: the time of day's picture. */
  setProcedural(cover: number | null): void {
    this.cover = cover;
    this.refresh();
  }

  /** The light's offset (any length): the procedural sky's sun or moon stands on its direction. */
  setSun(offset: THREE.Vector3): void {
    this.sunDir.copy(offset).normalize();
  }

  /** The sandbox's night setting: its procedural sky by night or by day (a race's follows its time of day). */
  setNight(on: boolean): void {
    if (on === this.night) return;
    this.night = on;
    this.refresh();
  }

  /** How much sky to draw (`skyDetailFor`, or "off"). */
  setDetail(detail: SkyDetail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.refresh();
  }

  /** Bytes of the picture held now (RGBA8 with its mip chain): 0 for the gradient, the procedural sky and no sky. */
  get textureBytes(): number {
    const image = this.held?.texture.image as ImageBitmap | undefined;
    return image ? Math.round(image.width * image.height * 4 * (4 / 3)) : 0;
  }

  /**
   * What the dome is drawing this frame, as one of `SKY_DRAWN`: nothing, the gradient, the half or the full picture, the procedural sky, or `loading` (a picture is asked for and not in yet, so the flat colour
   * shows). The bench writes it down each second: it is the sky's state as drawn, not the setting that asks for it.
   */
  get drawn(): SkyDrawn {
    if (!this.mesh.visible) return this.time === null || this.detail === "off" ? SKY_DRAWN.off : SKY_DRAWN.loading;
    return SKY_DRAWN[this.detail];
  }

  private setStops(look: SkyStops): void {
    const u = this.mat.uniforms;
    u.zenithEl!.value = look.zenithElevation;
    u.hazeTop!.value = look.hazeTop;
    (u.horizonColor!.value as THREE.Color).set(look.horizon);
    (u.midColor!.value as THREE.Color).set(look.mid);
    (u.zenith!.value as THREE.Color).set(look.zenith);
  }

  /** The procedural sky over the race's strip stops (`show`), or over the sandbox's own; the strip is let go. */
  private showProcedural(): void {
    const { time } = this;
    const sandbox = SANDBOX_SKY[this.night ? "night" : "day"];
    if (time === null) this.setStops(sandbox);
    const look = time === null ? sandbox : PROCEDURAL_LOOKS[time];
    const u = this.mat.uniforms;
    u.uCover!.value = this.cover ?? 0;
    this.cloudLit.set(look.cloudLit);
    this.cloudShade.set(look.cloudShade);
    this.discTint.fromArray(look.discTint);
    u.uStars!.value = look.stars ? 1 : 0;
    this.release();
    this.mesh.visible = true;
  }

  private refresh(): void {
    const { time, detail } = this;
    this.mat.uniforms.uProcedural!.value = detail === "procedural" ? 1 : 0;
    if (detail === "procedural") {
      this.showProcedural();
      return;
    }
    if (time === null || detail === "off") {
      this.mesh.visible = false;
      this.release();
      return;
    }
    if (detail === "gradient") {
      this.mat.uniforms.uTextured!.value = 0;
      this.mesh.visible = true;
      this.release();
      return;
    }
    const key = `${time}-${detail}`;
    if (this.held?.key === key) {
      this.install(this.held.texture);
      return;
    }
    this.mesh.visible = false;
    if (this.held) this.release();
    if (this.loading === key) return;
    this.loading = key;
    this.load(detail === "half" ? `${time}-half` : time).then((texture) => {
      if (this.loading === key) this.loading = null;
      if (!texture) return;
      if (`${this.time}-${this.detail}` !== key || this.held?.key === key) {
        discard(texture);
        return;
      }
      this.release();
      this.held = { key, texture };
      this.install(texture);
    });
  }

  private install(texture: THREE.Texture): void {
    this.mat.uniforms.map!.value = texture;
    this.mat.uniforms.uTextured!.value = 1;
    this.mesh.visible = true;
  }

  private release(): void {
    if (!this.held) return;
    this.mat.uniforms.map!.value = null;
    discard(this.held.texture);
    this.held = null;
  }

  private async load(file: string): Promise<THREE.Texture | null> {
    try {
      const bitmap = await loadUprightBitmap(`${BASE}sky/${file}.webp`);
      const texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      // Anisotropic filtering draws the wrap column as a dashed line of coarse-mip pixels (measured at every setting above 1); the strip has no anisotropy to speak of below 60° of elevation.
      texture.anisotropy = 1;
      // An ImageBitmap carries its orientation already.
      texture.flipY = false;
      texture.needsUpdate = true;
      return texture;
    } catch (err) {
      console.error(`sky ${file} failed to load`, err);
      return null;
    }
  }
}

/** A texture's GPU copy and its decoded bitmap are freed. */
function discard(texture: THREE.Texture): void {
  texture.dispose();
  (texture.image as ImageBitmap).close();
}
