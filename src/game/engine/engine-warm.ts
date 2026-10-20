import * as THREE from "three";
import { getCrackMap, makeGlassMaterial } from "../vehicle/car-materials.ts";
import { applyCarFinish, finishedMaterials } from "../vehicle/car-finish.ts";
import { warmCrashPath } from "./world-step.ts";
import { loadSkinKernel, skinKernel } from "../deform/skin-kernel.ts";
import { EngineCore } from "./engine-core.ts";

/**
 * Shader warm-up: links every program before the loop runs, then warms new scene content as it appears.
 */
export abstract class EngineWarm extends EngineCore {
  private warmQueued = false;
  /** Queued or running `warmScene` calls after boot; the scene-switch fade holds black while any is (`SceneFade`). */
  protected warmsInFlight = 0;
  /** Until the boot warm-up resolves (`ready`), the loop reads input only; after it, new scene content warms through `queueWarm`. */
  protected warming = true;
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
    const programs = this.renderer.info.programs?.length ?? 0;
    this.scene.unparkAll();
    const post = this.cine.post;
    const jobs: Promise<unknown>[] = [];
    this.eachFinish(
      () => jobs.push(post.warm(this.scene, this.camera, [[this.cine.marks.scene, this.cine.marks.camera]])),
      () => jobs.push(post.warmHdr(this.scene, this.camera)),
    );
    await Promise.all(jobs);
    if (this.disposed) return;
    // After boot every known program has drawn; the draws below cost the GPU process ~0.5–1 s for a whole
    // course, so content that brought no new program (the city's traffic cars) skips them.
    if (!this.warming && (this.renderer.info.programs?.length ?? 0) === programs) return;
    const shown: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    const hiddenMats: THREE.Material[] = [];
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
        if (m.visible) continue;
        m.visible = true;
        hiddenMats.push(m);
      }
    });
    const r = this.renderer;
    const hdr = this.cine.post.sceneRT;
    r.setScissor(0, 0, 0, 0);
    r.setScissorTest(true);
    hdr.scissor.set(0, 0, 0, 0);
    hdr.scissorTest = true;
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
    hdr.scissorTest = false;
    r.setScissorTest(false);
    this.cine.marks.warm(r);
    r.setRenderTarget(null);
    for (const o of shown) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
    for (const m of hiddenMats) m.visible = false;
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
    if (this.warming || this.warmQueued) return;
    this.warmQueued = true;
    this.warmsInFlight++;
    queueMicrotask(() => {
      this.warmQueued = false;
      // Surfaces added since (a course's art) wear the Ultra set before the compile, so their programs link with the rest.
      this.cine.ultra?.dress();
      this.warmScene()
        .catch((err: unknown) => console.error("Crush Stream program warm-up failed", err))
        .finally(() => this.warmsInFlight--);
    });
  }
}
