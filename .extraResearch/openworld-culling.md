# Culling in the open world: what to draw, simulate and keep (2026-11-09)

Asked because the owner saw crosswalks and building facades pop in and out with camera angle on the Open World preview, and asked how large open-world sims balance culling against its own cost. Perplexity answers (leads only) are in `perplexity/2026-11-09-openworld-visibility-work.md`, `-instanced-mesh-pop-in.md` and `-offscreen-agents-crowds-traffic.md`. Below, only what was checked against a source.

## Verified

1. **three.js culls an `InstancedMesh` by one sphere, computed once.** The docs: "The engine automatically computes the bounding sphere when it is needed, e.g., for ray casting or view frustum culling. You may need to recompute the bounding sphere if an instance is transformed via `setMatrixAt`." ([InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)). The source we ship (three 0.186) confirms the "once": `Frustum.intersectsObject` calls `computeBoundingSphere()` only when `boundingSphere === null` (`src/math/Frustum.js:150`), and `InstancedMesh.computeBoundingSphere` unions the *geometry's* sphere through each instance matrix (`src/objects/InstancedMesh.js:151-173`). So a group is drawn or skipped whole, and its sphere is wrong when a vertex shader moves vertices past the geometry, when matrices change after the first frame, or when `count` changes.
2. **Shader-moved vertices escape precomputed bounds; the fix is a conservative bound.** Unity, same failure mode: "vertex shaders that change vertex positions" can push vertices "outside of the maximum known bounds"; the remedies are "Modify the bounds to match the maximum potential bounding volume of your mesh. Use this option if possible, because it is better for performance", or recalculating bounds every frame ("Update When Offscreen") when performance matters less ([Skinned Mesh Renderer](https://docs.unity3d.com/2022.1/Documentation/Manual/class-SkinnedMeshRenderer.html)).
3. **Occlusion culling costs CPU and pays off mostly indoors.** Unity: its runtime occlusion "performs runtime calculations on the CPU, which can offset the CPU time that it saves", is "most likely to result in performance improvements when a Project is GPU-bound due to overdraw", "works best in Scenes where small, well-defined areas are clearly separated from one another by solid GameObjects. A common example is rooms connected by corridors", and "If your Project generates Scene geometry at runtime, then Unity's built-in occlusion culling is not suitable" ([Occlusion culling](https://docs.unity3d.com/6000.1/Documentation/Manual/OcclusionCulling.html)).
4. **One measured trade (Quest 2, an indoor Unity scene):** occlusion "added an average cost of 0.32 ms/frame" in culling, gave "0.69 ms/frame" back in opaque drawing, "draw calls went from 180 to about 120", and the data took "0.8MB of RAM"; the author expects "a higher cost for a smaller benefit" outdoors ([Game Developer / The Gamedev Guru](https://www.gamedeveloper.com/design/how-to-use-occlusion-culling-in-unity-the-sneaky-way)).

Already on main and consistent: `perplexity/2026-10-14-threejs-mobile-gpu-perf.md` §10 (deformed bounds, BatchedMesh for per-object culling), `perplexity/2026-11-09-threejs-per-frame-cost-practice.md` ("Preserve culling": keep `frustumCulled`, valid bounds, split very large instance sets spatially), `perplexity/2026-11-08-roadside-vegetation-rendering-browser.md` (distance cull per chunk), `race-traffic.md` (traffic in a bubble around the player).

## Not used (unverified or weak)

- The network and stall numbers in the off-screen agents answer (20 Hz / 5 Hz / 60 bytes per bus, a 10.6 s streaming stall) come from small hobby repositories, not engine documentation; not used.
- "16-64 city cells" and "10-20 Hz" mid-tier simulation rates: engineering suggestions in the answers, no source; treated as estimates.
- The three answers agree on separating three decisions (draw / simulate / keep loaded) with distance tiers and hysteresis; that is practice, not a measured figure.

## What we found in our own code (same day)

- **Crosswalk pop-in was depth, not culling** (OwFabric, ow-preview f76b2a07f): the decal quad lay 1.5 cm under the road ribbons and their depth proxy with only a one-pixel polygon offset, so near the camera it lost the depth test. Fixed by raising the decal to the road's lift.
- **But every ground decal on the map is one `InstancedMesh` with a map-wide sphere** (prop-tumble groups by an 8192 m asset cell), so frustum culling can never drop any of them: a cost, not a bug.
- **The chase camera in the cab** came from ground paint standing up as sight solids (OwCull, ow-preview d79153579).
- **Facade pop-in** (near culled, ~20 m drawn): open with OwFacadeGeo; `facade-bays.ts` builds an `InstancedMesh` without computing its sphere after its matrices, the first suspect under finding 1.

## For this repo

1. Every instanced group whose vertex shader moves, widens or lifts vertices (facade relief and bays, the scenery assets' `fit`/widen, decal lift) gets a bound that holds the drawn extent, computed after its last `setMatrixAt` batch; a row asserts the group's sphere contains every instance's drawn corners.
2. Group instances by city cell and material (cells of tens of metres in the open world, not the 8192 m asset cell), so frustum culling can drop off-screen cells. Count the draw calls this adds against the cull it buys (BenchObserve's frame parts).
3. Keep per-draw culling to the cheap frustum test. SightField's sight lines decide simulation and phase-out (cars, people, interiors behind their envelope walls: the "rooms behind doors" case where occlusion pays); don't run them per draw.
4. Keep draw, simulate and keep-loaded separate, each with hysteresis (OwCull's hide grace), and a load radius larger than the draw radius for interiors.
5. Measure before keeping any new cull: its per-frame cost against the draw time it saves, on the owner's bench.
