import * as THREE from "three";
import { detCos, detSin } from "../kernel/physics-core.js";
import { SKY_LOOKS } from "./sky-dome.ts";
import { TIME_OF_DAY, type TimeOfDay } from "../match/types.ts";

/**
 * The environment the cars reflect outdoors: the scene's own sky over a dark ground, a sun glow where the sun light is, built once a look
 * (day, sunset, night) into a PMREM and swapped in when the look or the scene changes, never per frame. The size is the studio
 * environment's (512 x 256, a 128 cube), so three's cube-UV program parameters, and with them every program, are the studio's.
 */
const WIDTH = 512;
const HEIGHT = 256;
/** Radiance of the sky over what its picture shows (the studio environment's mean, matched by eye on the cars' paint) and of the dark ground. */
const SKY_GAIN = { [TIME_OF_DAY.day]: 1.7, [TIME_OF_DAY.sunset]: 1.3, [TIME_OF_DAY.night]: 1 } as const;
/** How much of the sky's blue the environment keeps: the rest is pulled to its grey, so a lit wall or floor is not tinted cyan by the sky's diffuse light while the paint's reflection still reads blue. */
const SKY_CHROMA = 0.55;
const GROUND = { near: 0.5, far: 0.3 } as const;
/** The sky's gradient stops (rad): horizon to mid, mid to zenith. */
const MID_ELEVATION = 0.5;
const ZENITH_ELEVATION = 1.25;
/** The horizon line's blur (rad): sharp enough for a mirror coat to show a line, soft enough to avoid a single-pixel crawl. */
const HORIZON_BLUR = 0.025;
/** The sun glow: a hot core and a broad halo (rad, radiance over the sky's). */
const SUN_CORE = { width: 0.045, radiance: 14 };
const SUN_HALO = { width: 0.5, radiance: 0.9 };
const TWO_PI = Math.PI * 2;

const _colour = new THREE.Color();

function skyStop(hex: string): THREE.Color {
  return _colour.set(hex).clone();
}

const smooth = (from: number, to: number, x: number): number => {
  const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The equirect of `look` as half floats (rows from the nadir up, as a `DataTexture` without `flipY` is read), the sun glow toward `sun` (a direction). */
function buildPixels(look: TimeOfDay, sun: THREE.Vector3): Uint16Array {
  const sky = SKY_LOOKS[look];
  const horizon = skyStop(sky.horizon);
  const mid = skyStop(sky.mid);
  const zenith = skyStop(sky.zenith);
  const gain = SKY_GAIN[look];
  const sunX = sun.x;
  const sunY = sun.y;
  const sunZ = sun.z;
  const out = new Uint16Array(WIDTH * HEIGHT * 4);
  const rgb = new THREE.Color();
  for (let row = 0; row < HEIGHT; row++) {
    const elevation = ((row + 0.5) / HEIGHT - 0.5) * Math.PI;
    const ring = detCos(elevation);
    const up = detSin(elevation);
    const above = smooth(-HORIZON_BLUR, HORIZON_BLUR, elevation);
    const lower = rgb.copy(horizon).lerp(mid, smooth(0, MID_ELEVATION, elevation)).lerp(zenith, smooth(MID_ELEVATION, ZENITH_ELEVATION, elevation));
    const grey = lower.r * 0.2126 + lower.g * 0.7152 + lower.b * 0.0722;
    lower.r = grey + (lower.r - grey) * SKY_CHROMA;
    lower.g = grey + (lower.g - grey) * SKY_CHROMA;
    lower.b = grey + (lower.b - grey) * SKY_CHROMA;
    const groundLevel = GROUND.far + (GROUND.near - GROUND.far) * smooth(-0.6, 0, elevation);
    for (let col = 0; col < WIDTH; col++) {
      const azimuth = ((col + 0.5) / WIDTH - 0.5) * TWO_PI;
      const cosAngle = ring * detCos(azimuth) * sunX + up * sunY + ring * detSin(azimuth) * sunZ;
      const angle = Math.acos(Math.min(1, Math.max(-1, cosAngle)));
      const glow = SUN_CORE.radiance * Math.exp(-((angle / SUN_CORE.width) ** 2)) + SUN_HALO.radiance * Math.exp(-((angle / SUN_HALO.width) ** 2));
      const i = (row * WIDTH + col) * 4;
      const skyShare = above * gain;
      out[i] = THREE.DataUtils.toHalfFloat(lower.r * skyShare * (1 + glow * above) + groundLevel * (1 - above));
      out[i + 1] = THREE.DataUtils.toHalfFloat(lower.g * skyShare * (1 + glow * above) + groundLevel * (1 - above));
      out[i + 2] = THREE.DataUtils.toHalfFloat(lower.b * skyShare * (1 + glow * above) + groundLevel * (1 - above));
      out[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  return out;
}

/** The daylight environments, one PMREM per look, built on first use and freed with the engine. */
export class DaylightEnv {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly built = new Map<TimeOfDay, THREE.Texture>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  /** The prefiltered environment of `look`, the sun glow toward `sun`; the first ask builds it (a few ms), later ones answer the same texture. */
  get(look: TimeOfDay, sun: THREE.Vector3): THREE.Texture {
    const cached = this.built.get(look);
    if (cached !== undefined) return cached;
    const equirect = new THREE.DataTexture(buildPixels(look, _sun.copy(sun).normalize()), WIDTH, HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
    equirect.colorSpace = THREE.LinearSRGBColorSpace;
    equirect.minFilter = equirect.magFilter = THREE.LinearFilter;
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    equirect.needsUpdate = true;
    const generator = new THREE.PMREMGenerator(this.renderer);
    const env = generator.fromEquirectangular(equirect).texture;
    equirect.dispose();
    generator.dispose();
    this.built.set(look, env);
    return env;
  }

  dispose(): void {
    for (const env of this.built.values()) env.dispose();
    this.built.clear();
  }
}

const _sun = new THREE.Vector3();
