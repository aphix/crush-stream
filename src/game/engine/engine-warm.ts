import * as THREE from "three";
import { getCrackMap, makeGlassMaterial } from "../vehicle/car-materials.ts";
import { applyCarFinish, finishedMaterials, finishForTier } from "../vehicle/car-finish.ts";
import { warmCrashPath } from "./world-step.ts";
import { loadSkinKernel, skinKernel } from "../deform/skin-kernel.ts";
import { EngineCore } from "./engine-core.ts";
import type { Ultra } from "../present/ultra/ultra.ts";

/** Ms between polls of a parallel link, three's `compileAsync` interval. */
const LINK_POLL_MS = 10;
// Executor form: the tsconfig lib predates `Promise.withResolvers`.
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** three's `WebGLProgram.isReady` (KHR_parallel_shader_compile's completion status), missing from its types. */
const isLinked = (program: unknown): boolean =>
  typeof program !== "object" || program === null || !("isReady" in program) || typeof program.isReady !== "function" || program.isReady() === true;
/**
 * New programs one step of an Ultra pick's warm-up links and draws. Where the GPU process links and builds a program's first draw on its
 * main thread (ANGLE over desktop GL), the frame waiting on a step stalls about 70 ms a program; all of Ultra's at once stalled it seconds.
 */
const ULTRA_STEP_PROGRAMS = 3;
/** Frames the loop draws after a step's draws before the next step: that GPU work lands in them, not in the next step's or the switch's. */
const ULTRA_STEP_FRAMES = 2;

/**
 * Shader warm-up: links every program before the loop runs, then warms new scene content as it appears.
 */
export abstract class EngineWarm extends EngineCore {
  private warmQueued = false;
  /** Queued or running `warmScene` calls after boot; the scene-switch fade holds black while any is (`SceneFade`). */
  protected warmsInFlight = 0;
  /** Until the boot warm-up resolves (`ready`), the loop reads input only; after it, new scene content warms through `queueWarm`. */
  protected warming = true;
  /** Frames the engine has drawn (`frameDrawn`). */
  protected framesDrawn = 0;
  /** Callers of `warmsIdle` parked until the last in-flight warm ends. */
  private readonly idleWaiters: (() => void)[] = [];
  /** Callers of `framesPass` parked until the frame count they wait for is drawn. */
  private readonly frameWaiters: { until: number; resolve: () => void }[] = [];
  /** True once a loop draws the frames (the page's animation loop, then the bench's own); tests and headless-frame draw theirs by hand. */
  protected loopDraws = false;
  /** Whether the WASM skin is loaded (else every car skins in JS). The probes read it from `window.__crush`. */
  get skinKernelReady(): boolean {
    return skinKernel() !== null;
  }

  /**
   * Link every program play can reach before the loop starts: a first-use link stalls its frame 50–800 ms.
   * Waits for the studio env (part of every lit program's key), then warms the scene (`warmScene`) with three
   * stand-ins added: cracked glass (a pane gains the crack map mid-crash, `car.ts`), linked on a hidden mesh
   * that keeps the program alive; the torn-part material (`PartBatch.looseWarm`, a hidden mesh engine.ts adds
   * to the scene); and the debug views (their helpers, and the thrown dummies' rig and particle
   * views, join the scene only while shown).
   * Night, wet and the lamp pool's lights only change uniforms: the light count is fixed.
   */
  protected async warmPrograms(env: Promise<void>): Promise<void> {
    // Already in when a test process preloaded it (scripts/test-setup.mjs): no fetch, which Node cannot do for a file URL.
    const kernel = skinKernel()
      ? null
      : loadSkinKernel(fetch(new URL("../deform/skin-kernel.wasm", import.meta.url))).catch((err: unknown) =>
          console.warn("Crush Stream skin kernel unavailable, skinning in JS", err),
        );
    await env;
    if (this.disposed) return;
    const glass = makeGlassMaterial();
    glass.map = getCrackMap();
    const cracked = new THREE.Mesh(new THREE.PlaneGeometry(0, 0), glass);
    cracked.name = "warm-cracked-glass";
    cracked.visible = false;
    this.scene.add(cracked);
    this.ragdolls.debug.set(true, true);
    for (const car of this.live()) {
      car.setRigVisible(true);
      car.deform.setParticlesVisible(true, car.group);
    }
    const scene = this.warmScene();
    // While the GPU process compiles: the crush path's first run, unoptimised, cost 26–48 ms frames mid-race.
    // After the kernel is in (a 3 kB file, fetched since the start of this method), so the warm crash also runs the
    // WASM skin: its first calls and each style's tables land here, not on the first real crash.
    await kernel;
    warmCrashPath();
    await scene;
    this.ragdolls.debug.set(this.showRig, this.showParticles);
    for (const car of this.live()) {
      car.setRigVisible(this.showRig);
      car.deform.setParticlesVisible(this.showParticles, car.group);
    }
  }

  /**
   * Compile the scene async for both outputs plus every post pass and tier composite (`PostFX.warm`) and the
   * mark map's stamp and fade, then draw it with every mesh shown and unculled into both real outputs (the
   * canvas and the HDR target) and the mark map, through a zero-area scissor so nothing lands. Compiling alone
   * left each program's first draw mid-race to check its link and fetch its uniform locations: synchronous GPU
   * round trips, 110–340 ms frames. The draws also link what compile() skips (shadow-depth variants of hidden
   * or far meshes) and upload every texture. Both car finish states are warmed whatever the tier (`eachFinish`).
   */
  private async warmScene(): Promise<void> {
    const before = new Set(this.renderer.info.programs ?? []);
    this.scene.unparkAll();
    const post = this.cine.post;
    const jobs: Promise<unknown>[] = [];
    this.eachFinish(
      () => jobs.push(post.warm(this.scene, this.camera, [[this.cine.marks.scene, this.cine.marks.camera]])),
      () => jobs.push(post.warmHdr(this.scene, this.camera)),
    );
    await Promise.all(jobs);
    if (this.disposed) return;
    // After boot every known program has drawn; a whole scene's draw costs the GPU process 0.2–1 s, so only the meshes
    // whose material gained a program draw (the purse pool, a course's art), and content that brought none skips it.
    const gained = this.warming ? null : this.materialsWithNewPrograms(before);
    if (gained?.size === 0) return;
    this.drawWarm(gained);
  }

  /**
   * Resolves once every program made since `before` has linked. three's `compileAsync` polls each material's current program, which a
   * frame drawing another look sets back to that look's, so it would resolve before a worn look's programs are in.
   */
  private async linkedSince(before: ReadonlySet<unknown>): Promise<void> {
    const gl = this.renderer.getContext();
    while (!this.disposed && !gl.isContextLost() && (this.renderer.info.programs ?? []).some((p) => !before.has(p) && !isLinked(p))) await sleep(LINK_POLL_MS);
  }

  /** Every material in the scene holding a program that `before` did not (three keeps a material's programs by key). */
  private materialsWithNewPrograms(before: ReadonlySet<unknown>): Set<THREE.Material> {
    const gained = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      for (const m of [(o as THREE.Mesh).material ?? []].flat()) {
        const built = this.renderer.properties.get(m);
        if (typeof built !== "object" || built === null || !("programs" in built) || !(built.programs instanceof Map)) continue;
        for (const program of built.programs.values()) if (!before.has(program)) gained.add(m);
      }
    });
    return gained;
  }

  /** The zero-scissor draws of `warmScene`: both finish states into the canvas and the HDR target, the post passes and the mark map. */
  private drawWarm(only: ReadonlySet<THREE.Material> | null): void {
    const r = this.renderer;
    const hdr = this.cine.post.sceneRT;
    this.staged(only, () => {
      this.eachFinish(
        () => {
          for (const target of [null, hdr]) {
            r.setRenderTarget(target);
            r.render(this.scene, this.camera);
          }
        },
        () => {
          r.setRenderTarget(hdr);
          r.render(this.scene, this.camera);
        },
      );
      this.cine.post.prime();
    });
    this.cine.marks.warm(r);
    r.setRenderTarget(null);
  }

  /**
   * Run `draw` with a zero scissor on the canvas and the HDR target and every mesh shown and unculled, or with `only`, just the meshes
   * wearing one of those materials (the rest are muted by material, not object, so a drawn mesh under a muted one, the purse pool under
   * the dummies, still draws); then put it all back.
   */
  private staged(only: ReadonlySet<THREE.Material> | null, draw: () => void): void {
    const shown: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    const hiddenMats: THREE.Material[] = [];
    const mutedMats: THREE.Material[] = [];
    this.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) return;
      if (!o.visible) {
        o.visible = true;
        shown.push(o);
      }
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
      for (const m of [(o as THREE.Mesh).material ?? []].flat()) {
        const draws = only === null || only.has(m);
        if (m.visible === draws) continue;
        m.visible = draws;
        (draws ? hiddenMats : mutedMats).push(m);
      }
    });
    const r = this.renderer;
    const hdr = this.cine.post.sceneRT;
    r.setScissor(0, 0, 0, 0);
    r.setScissorTest(true);
    hdr.scissor.set(0, 0, 0, 0);
    hdr.scissorTest = true;
    draw();
    hdr.scissorTest = false;
    r.setScissorTest(false);
    for (const o of shown) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
    for (const m of hiddenMats) m.visible = false;
    for (const m of mutedMats) m.visible = true;
  }

  /**
   * Run `off` with every car finish in the scene off, then `on` with it on, then put each material's own state back: an FX tier
   * switch (Auto steps down mid-race) then links nothing. The finish draws only at the post tiers, so `on` is for the HDR target alone.
   */
  private eachFinish(off: () => void, on: () => void): void {
    const finished = finishedMaterials(this.scene);
    applyCarFinish(this.scene, false);
    off();
    applyCarFinish(this.scene, true);
    on();
    applyCarFinish(this.scene, finished);
  }

  /**
   * After boot, new scene content (a race course's art, a new car) warms once the current synchronous change
   * is complete (art in the scene, fog set, cars placed): setup menus and the countdown absorb the link, the race doesn't.
   */
  protected queueWarm(): void {
    if (this.warming || this.warmQueued || this.disposed) return;
    this.warmQueued = true;
    this.warmsInFlight++;
    queueMicrotask(() => {
      this.warmQueued = false;
      // Surfaces added since (a course's art) wear the Ultra set before the compile, so their programs link with the rest.
      this.cine.ultra?.dress();
      this.warmScene()
        .catch((err: unknown) => console.error("Crush Stream program warm-up failed", err))
        .finally(() => this.warmEnded());
    });
  }

  /** Resolves once no warm is queued or running (at once when none is): the event the scene fade, the probes and the tests wait on. */
  warmsIdle(): Promise<void> {
    if (this.warmsInFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private warmEnded(): void {
    if (--this.warmsInFlight > 0) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  /**
   * Link and draw `ultra`'s programs (its sky as the environment, its dressed surfaces, the car finish its tier draws) into the HDR target,
   * the only output its tier draws the scene into, while the frames still draw the current look: a few programs a step, with frames
   * between (`ULTRA_STEP_PROGRAMS`), so neither a step nor the switch after the last stalls a frame. Stops once `wanted` reads false, or
   * once a context restore disposes `ultra` (the restore's pick loads another).
   */
  protected async warmUltra(ultra: Ultra, wanted: () => boolean): Promise<void> {
    this.warmsInFlight++;
    await this.warmUltraSteps(ultra, () => wanted() && this.cine.ultra === ultra && !this.disposed)
      .catch((err: unknown) => console.error("Crush Stream Ultra warm-up failed", err))
      .finally(() => this.warmEnded());
  }

  private async warmUltraSteps(ultra: Ultra, going: () => boolean): Promise<void> {
    this.scene.unparkAll();
    const drawn: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).material !== undefined) drawn.push(o);
    });
    const hdr = this.cine.post.sceneRT;
    for (let next = 0; next < drawn.length && going(); ) {
      const before = new Set(this.renderer.info.programs ?? []);
      next = this.wearingUltra(ultra, () => this.compileInto(hdr, drawn, next, before.size + ULTRA_STEP_PROGRAMS));
      const gained = this.materialsWithNewPrograms(before);
      if (gained.size === 0) continue;
      await this.linkedSince(before);
      if (!going()) return;
      this.wearingUltra(ultra, () =>
        this.staged(gained, () => {
          this.renderer.setRenderTarget(hdr);
          this.renderer.render(this.scene, this.camera);
        }),
      );
      this.renderer.setRenderTarget(null);
      await this.framesPass(ULTRA_STEP_FRAMES);
    }
  }

  /** Compile `objects` from `from` on for `target` until the renderer holds `programs` programs; the index it stopped at. */
  private compileInto(target: THREE.WebGLRenderTarget, objects: readonly THREE.Object3D[], from: number, programs: number): number {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(target);
    let i = from;
    while (i < objects.length && (r.info.programs ?? []).length < programs) r.compile(objects[i++]!, this.camera, this.scene);
    r.setRenderTarget(prev);
    return i;
  }

  /** `fn` run wearing `ultra` and the car finish its tier draws, both put back before the next frame draws. */
  private wearingUltra<T>(ultra: Ultra, fn: () => T): T {
    const finished = finishedMaterials(this.scene);
    ultra.wear(true);
    applyCarFinish(this.scene, finishForTier("ultra"));
    try {
      return fn();
    } finally {
      applyCarFinish(this.scene, finished);
      ultra.wear(false);
    }
  }

  /** Resolves once the loop has drawn `frames` more frames; at once where no loop draws them. */
  private framesPass(frames: number): Promise<void> {
    if (!this.loopDraws || this.disposed) return Promise.resolve();
    const until = this.framesDrawn + frames;
    return new Promise((resolve) => this.frameWaiters.push({ until, resolve }));
  }

  /** One more frame drawn: counts it and releases the `framesPass` waiters whose frames are in. */
  protected frameDrawn(): void {
    this.framesDrawn++;
    for (let w = this.frameWaiters.length - 1; w >= 0; w--) {
      const waiter = this.frameWaiters[w]!;
      if (waiter.until > this.framesDrawn) continue;
      this.frameWaiters.splice(w, 1);
      waiter.resolve();
    }
  }

  /** The engine is disposed: no frame will come for the `framesPass` waiters, so they end. */
  protected releaseFrameWaiters(): void {
    for (const waiter of this.frameWaiters.splice(0)) waiter.resolve();
  }
}
