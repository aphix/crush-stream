import * as THREE from "three";
import type { CarDetail } from "./car-detail.ts";
import { DetailGovernor } from "./detail-governor.ts";
import type { WorldStage } from "./engine-world.ts";

/** The player's Draw distance: how far the view reaches against the scene's own far plane and fog. Auto is the scene as authored. */
export const DRAW_DISTANCES = ["auto", "far", "max"] as const;
export type DrawDistance = (typeof DRAW_DISTANCES)[number];
/** The far plane, the fog's reach (its density divided) and the car detail's cut distances, times this. */
const DRAW_REACH: Record<DrawDistance, number> = { auto: 1, far: 1.5, max: 2 };

/** The player's Render scale: drawing-buffer pixels per CSS pixel, or Auto. */
export const RENDER_SCALES = ["auto", "0.75", "1", "1.5", "2"] as const;
export type RenderScale = (typeof RENDER_SCALES)[number];
/** Auto's rungs, top first: fill cost goes with the ratio squared, so 1.5 → 1 shades 0.44 of the pixels. */
const AUTO_SCALE_RUNGS = [1.5, 1.25, 1] as const;

/** The player's Shadows: the sun's map and the box it covers round the followed car. */
export const SHADOW_QUALITIES = ["auto", "high", "max"] as const;
export type ShadowQuality = (typeof SHADOW_QUALITIES)[number];

/** A sun shadow level: the map's edge (texels), the box's half width (m), and how far (m) past the box's centre the shadow camera reaches beyond the sun. */
export interface ShadowLevel {
  readonly map: number;
  readonly half: number;
  readonly reach: number;
}
/** Texels of 4.7 cm (Auto), 3.5 cm (High), 2.3 cm (Max); the reach grows with the box so its far edge still casts under a low sun. */
export const SHADOW_LEVELS: Record<ShadowQuality, ShadowLevel> = {
  auto: { map: 1024, half: 24, reach: 34 },
  high: { map: 2048, half: 36, reach: 46 },
  max: { map: 4096, half: 48, reach: 58 },
};

/** The three knobs' values at once: what the bench puts back after an arm. */
export interface QualityPicks {
  draw: DrawDistance;
  scale: RenderScale;
  shadow: ShadowQuality;
}

type QualityKnob = keyof QualityPicks;
/** The knobs by name, in menu order. */
const KNOB = { draw: "draw", scale: "scale", shadow: "shadow" } as const satisfies Record<QualityKnob, QualityKnob>;
const KNOBS: readonly QualityKnob[] = Object.values(KNOB);

/** The member of `values` that `text` spells (a URL arm, a saved value), or null. */
export function knobValue<T extends string>(values: readonly T[], text: string | null): T | null {
  return values.find((v) => v === text) ?? null;
}

/** Auto's ratios on a device of pixel ratio `deviceRatio`: its own (no higher than the top rung), then each lower rung. */
function autoScaleRungs(deviceRatio: number): number[] {
  const top = Math.min(deviceRatio, AUTO_SCALE_RUNGS[0]);
  return [top, ...AUTO_SCALE_RUNGS.filter((r) => r < top)];
}

/** The scene's view distance: its own far plane and fog density as authored (the sandbox's, a course's), drawn at the player's reach. */
export class ViewDistance {
  /** The authored far plane (m) and fog density of the scene in force. */
  far: number;
  density: number;
  private reach = 1;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly scene: THREE.Scene;

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    this.camera = camera;
    this.scene = scene;
    this.far = camera.far;
    this.density = scene.fog instanceof THREE.FogExp2 ? scene.fog.density : 0;
  }

  /** A scene's own far plane (m) and fog density (`scene.fog` is already its fog): drawn at the reach in force. */
  author(far: number, density: number): void {
    this.far = far;
    this.density = density;
    this.apply();
  }

  setReach(reach: number): void {
    this.reach = reach;
    this.apply();
  }

  private apply(): void {
    this.camera.far = this.far * this.reach;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = this.density / this.reach;
  }
}

/** What the quality knobs act on. */
interface QualityHost {
  renderer: Pick<THREE.WebGLRenderer, "getPixelRatio" | "setPixelRatio">;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  stage: Pick<WorldStage, "setShadowLevel">;
  detail: Pick<CarDetail, "setReach">;
  /** The post chain's targets follow the drawing buffer. */
  post: { setSize(): void };
}

/**
 * The player's three quality knobs over Auto. Each takes effect at once and relinks nothing (a pixel ratio, a far plane, a fog
 * density, a shadow map's size); none turns the FX tier's Auto or a governor off.
 */
export class PlayerQuality {
  draw: DrawDistance = "auto";
  scale: RenderScale = "auto";
  shadow: ShadowQuality = "auto";
  readonly view: ViewDistance;
  /** Auto's render-scale rung (an index into `autoRungs`), walked by how GPU-bound a match is. */
  scaleGov: DetailGovernor;
  private readonly autoRungs: number[];
  /** Knobs the page's URL set: a saved preference never overrides them, the player's pick does. */
  private readonly pinned = new Set<QualityKnob>();
  private readonly host: QualityHost;

  constructor(host: QualityHost, deviceRatio: number) {
    this.host = host;
    this.view = new ViewDistance(host.camera, host.scene);
    this.autoRungs = autoScaleRungs(deviceRatio);
    this.scaleGov = this.newScaleGov();
    this.applyScale();
  }

  /** The pixel ratio the renderer draws at now. */
  get pixelRatio(): number {
    return this.host.renderer.getPixelRatio();
  }

  /** The knobs the page's URL pinned, in menu order ("draw scale"; "" for none). */
  get pinnedKnobs(): string {
    return KNOBS.filter((k) => this.pinned.has(k)).join(" ");
  }

  /** The player's picks: in force at once, each clearing the page's pin on its knob. */
  setDraw(value: DrawDistance): void {
    this.pinned.delete(KNOB.draw);
    this.putDraw(value);
  }

  setScale(value: RenderScale): void {
    this.pinned.delete(KNOB.scale);
    this.putScale(value);
  }

  setShadow(value: ShadowQuality): void {
    this.pinned.delete(KNOB.shadow);
    this.putShadow(value);
  }

  /** The page's URL arms (null: absent or unknown): in force and pinned. */
  pinFromPage(draw: DrawDistance | null, scale: RenderScale | null, shadow: ShadowQuality | null): void {
    if (draw !== null) {
      this.putDraw(draw);
      this.pinned.add(KNOB.draw);
    }
    if (scale !== null) {
      this.putScale(scale);
      this.pinned.add(KNOB.scale);
    }
    if (shadow !== null) {
      this.putShadow(shadow);
      this.pinned.add(KNOB.shadow);
    }
  }

  /** This browser's saved knobs (stored text; anything else is Auto), on each knob the page's URL did not pin. */
  setSaved(draw: string, scale: string, shadow: string): void {
    if (!this.pinned.has(KNOB.draw)) this.putDraw(knobValue(DRAW_DISTANCES, draw) ?? "auto");
    if (!this.pinned.has(KNOB.scale)) this.putScale(knobValue(RENDER_SCALES, scale) ?? "auto");
    if (!this.pinned.has(KNOB.shadow)) this.putShadow(knobValue(SHADOW_QUALITIES, shadow) ?? "auto");
  }

  picks(): QualityPicks {
    return { draw: this.draw, scale: this.scale, shadow: this.shadow };
  }

  /** All three knobs at once, pins kept (the bench's arms and the run's own values after them). */
  restore(picks: QualityPicks): void {
    this.putDraw(picks.draw);
    this.putScale(picks.scale);
    this.putShadow(picks.shadow);
  }

  /** Auto's render scale starts over at its top rung (a bench step's fresh page); the picks stay. */
  restartAuto(): void {
    this.scaleGov = this.newScaleGov();
    this.applyScale();
  }

  /** One frame while the FX tier is automatic (`DetailGovernor.frame`'s inputs): true when Auto moved the pixel ratio. */
  govern(ms: number, workMs: number, renderMs: number, gpuMs: number, matching: boolean): boolean {
    if (this.scale !== "auto") return false;
    // The sim's lost time is not the render scale's to fix: the pacer's share is left out.
    if (this.scaleGov.frame(ms, 0, workMs, renderMs, gpuMs, matching) === null) return false;
    this.applyScale();
    return true;
  }

  private newScaleGov(): DetailGovernor {
    return new DetailGovernor(0, this.autoRungs.length - 1, "gpu");
  }

  private putDraw(value: DrawDistance): void {
    this.draw = value;
    this.view.setReach(DRAW_REACH[value]);
    this.host.detail.setReach(DRAW_REACH[value]);
  }

  private putScale(value: RenderScale): void {
    this.scale = value;
    this.applyScale();
  }

  private putShadow(value: ShadowQuality): void {
    this.shadow = value;
    this.host.stage.setShadowLevel(SHADOW_LEVELS[value]);
  }

  private applyScale(): void {
    const ratio = this.scale === "auto" ? this.autoRungs[this.scaleGov.level]! : Number(this.scale);
    const renderer = this.host.renderer;
    if (renderer.getPixelRatio() === ratio) return;
    renderer.setPixelRatio(ratio);
    this.host.post.setSize();
  }
}
