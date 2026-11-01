> Question: For a WebGL2 / three.js game running on mobile GPUs (Adreno, Mali, Apple) and mid-range laptops, what costs more: extra vertices/triangles, extra texture fetches in the fragment shader (normal maps, detail maps, parallax), or CPU-side per-vertex work (JavaScript or WASM skinning and normal recomputation each frame)? Concrete numbers where available: triangles per frame budgets on mobile WebGL at 60 fps, vertex shader vs fragment shader bottlenecks on tile-based GPUs (binning cost per triangle), cost of a dependent texture fetch, typical CPU cost per 1000 vertices for JS skinning and normal recomputation, and best practices from three.js / Babylon.js / PlayCanvas docs and mobile GPU vendor guides (ARM Mali best practices, Qualcomm Adreno guide, Apple Metal tips) about trading geometry for normal maps. Cite sources; mark measured numbers vs rules of thumb.

There is no universal winner, but for a typical mobile WebGL2 scene:

- **Fragment texture work usually costs the most** when objects cover many pixels, especially with overdraw, parallax, poor cache locality, or several material layers.
- **CPU skinning and normal recomputation can dominate** when performed in JavaScript/WASM every frame, because it removes work from the GPU and consumes the main-thread frame budget.
- **Extra triangles are often the cheapest way to add moderate silhouette or deformation quality**, provided they are not tiny screen-space triangles and the vertex count is not excessive.

## Practical cost hierarchy

| Work | Usually expensive when | General guidance |
|---|---|---|
| Extra triangles/vertices | High vertex counts, many skinned meshes, tiny triangles, poor culling, complex vertex shaders | Usually preferable to expensive per-pixel effects; use LOD and avoid micro-triangles |
| Normal-map fetch | Large screen coverage or bandwidth-limited scenes | Often a good geometry replacement for surface detail |
| Detail/albedo/specular fetches | Several additional samples per visible pixel, especially with overdraw | Combine maps where practical and use compressed mipmapped textures |
| Parallax/relief mapping | High screen coverage, steep viewing angles, multiple dependent samples | More expensive than an ordinary normal map; reserve for hero assets |
| CPU skinning | Many animated vertices updated every frame | Avoid unless necessary; prefer GPU skinning |
| CPU normal recomputation | Dynamic meshes with many vertices or repeated topology traversal | Recompute only changed regions, or move the work to a compute/offline path |

## Geometry versus fragment shading

A triangle must generally pass through the vertex-processing and tile/binning stages, while fragments are generated according to its screen coverage. On tile-based mobile GPUs, each triangle is assigned to every screen tile it overlaps; large or thin triangles can therefore increase bin-list traffic even when they produce few visible pixels. Mali documentation recommends models producing roughly **10–20 fragments per primitive**, which is a rule of thumb rather than a hard limit.[3][8]

Arm also notes that vertices have substantial processing and memory-bandwidth cost, and recommends reducing primitive count, avoiding micro-triangles, and using normal maps for fine surface detail instead of modeling it geometrically.[5][9] A useful interpretation is:

- Add geometry when it improves the **silhouette**, shadow shape, or actual displacement.
- Use normal maps for detail that changes lighting but not the silhouette.
- Avoid dense geometry whose triangles project to only a few pixels.
- Use LOD aggressively; Arm recommends simpler meshes at distance.[3][5]

The “10–20 fragments per primitive” recommendation implies that a triangle averaging 10 pixels is a better target than thousands of subpixel triangles. It does **not** mean that a scene with a particular triangle count will always run at 60 fps.

## Fragment texture fetches

A normal map typically adds at least one texture sample and associated tangent-space reconstruction. Detail, roughness, ambient-occlusion, and parallax techniques add more samples and arithmetic. The cost scales approximately with:

\[
\text{fragment cost} \propto
\text{visible pixels}
\times
\text{overdraw}
\times
\text{texture samples per pixel}
\]

A texture fetch is not a fixed number of nanoseconds across Adreno, Mali, and Apple GPUs. It depends on cache hit rate, compression, mip level, filtering, sampler contention, texture format, and whether the coordinate is dependent on earlier shader results. Qualcomm specifically advises minimizing texture fetches, reducing cache misses, using compressed textures and mipmaps, and avoiding expensive or poorly localized accesses.[1] Arm similarly recommends compressed, mipmapped textures and good texture locality.[3][8][9]

A **dependent texture fetch**—for example, a parallax sample whose UV is calculated from a previous height-map sample—is more costly than an independent lookup because later samples cannot be issued until the coordinate is known. It can also reduce locality and increase divergent work. There is no reliable vendor-independent “one dependent fetch equals N ordinary fetches” figure; treat the cost as a measured shader-dependent quantity, not a constant.

For parallax mapping, the number of samples can be especially significant:

\[
\text{parallax texture work}
\approx
N_{\text{pixels}}
\times
N_{\text{height samples}}
\]

Thus, a single extra vertex may be cheaper than one additional parallax iteration over a large object, while a few thousand extra vertices may be cheaper than several texture samples over a full-screen surface.

## CPU-side JavaScript/WASM skinning and normals

There is no portable, authoritative “typical cost per 1,000 vertices” number for JavaScript or WASM skinning. It varies substantially with:

- Number of bone influences per vertex
- Typed-array layout and allocations
- JavaScript versus WASM
- Bounds checks and SIMD use
- Whether positions, normals, tangents, and bounds are all updated
- Browser and device CPU
- Cache behavior and synchronization with GPU buffer uploads

Consequently, figures such as “X microseconds per 1,000 vertices” should be treated as **local measurements**, not transferable rules of thumb. CPU skinning also has a second cost: updated vertex buffers must be uploaded or synchronized with the GPU every frame.

Normal recomputation is commonly more expensive than merely transforming existing normals because it requires accumulating face contributions and normalizing vertices. If topology is static and only bones move, recomputing normals from triangles each frame is usually wasteful; transform existing normals or use GPU skinning instead. For dynamic topology, benchmark separate phases:

1. Face-normal generation.
2. Vertex-normal accumulation.
3. Normalization.
4. Buffer upload.
5. Rendering.

A useful benchmark unit is milliseconds per frame for 1,000, 10,000, and 100,000 vertices on each target class—not a universal per-vertex constant.

## What “triangle budget” should mean

A fixed mobile WebGL triangle budget is not dependable. A scene with 100,000 triangles can be faster than one with 20,000 if the latter has heavy overdraw, expensive shaders, or poor texture locality. Conversely, a few hundred thousand visible, skinned vertices can become expensive on older phones.

Use these as **rules of thumb, not measured limits**:

- Start with roughly **50,000–150,000 visible triangles per frame** for a conservative 60-fps mobile target.
- Test **200,000–500,000 visible triangles per frame** only after profiling on representative low- and mid-tier devices.
- Treat total **vertex count**, not just triangle count, as important: UV seams, hard normals, and material boundaries duplicate vertices.
- Reduce the budget sharply for CPU skinning, morph targets, expensive vertex shaders, transparent objects, or multiple full-screen passes.

These ranges are engineering starting points, not guarantees from WebGL or GPU vendors. On a 60-fps target, the complete frame budget is only:

\[
16.67\ \text{ms}
\]

That time includes JavaScript, animation, culling, WebGL calls, GPU execution, browser overhead, and presentation.

## Engine and vendor-aligned practices

- Prefer **GPU skinning** over per-frame JavaScript/WASM skinning when supported by the engine and material pipeline.
- Do not recompute normals every frame unless topology actually changes.
- Use normal maps for fine detail that does not affect silhouettes; Arm explicitly recommends this tradeoff.[3][5]
- Use LOD and culling; remove back-facing opaque geometry early where possible.[3][10]
- Avoid micro-triangles and long thin triangles, especially at distance.[5]
- Use ASTC, ETC2, or another appropriate compressed texture format, plus mipmaps.[3][8][9]
- Minimize texture samples and keep accesses coherent; Qualcomm highlights texture-cache misses as a major texture-pipeline cost.[1]
- Reduce transparent layers and overdraw; fragment cost is proportional to the number of shaded fragments, not merely screen resolution.[9]
- Use simpler shaders for distant objects: omit parallax first, then detail maps, then other optional material layers.
- Profile separately as **CPU-bound**, **vertex-bound**, **fragment-bound**, and **bandwidth-bound** rather than optimizing triangle count in isolation.

## Bottom line

For most mobile scenes, the preferred tradeoff is:

1. **Use moderate geometry for silhouettes and deformation.**
2. **Use one compressed, mipmapped normal map instead of substantial fine-detail geometry.**
3. **Avoid parallax and multiple detail fetches on large or overdrawn surfaces.**
4. **Avoid CPU-side per-frame skinning and normal rebuilding whenever GPU skinning or precomputed data can be used.**

The concrete vendor guidance supports the direction of this tradeoff, but reliable numerical costs for dependent fetches and CPU work require measurements on the actual Adreno, Mali, or Apple device and browser combination.

[1] Adreno GPU on PC: Best Practices - Game Developer Guide (https://docs.qualcomm.com/nav/home/pc_best_practices.html?product=1601111740035277)
[2] Developer Guide: Arm Mali GPU Best Practices (https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/new-developer-guide-arm-mali-application-developer-best-practices)
[3] Arm Mali GPUs Best Practices Developer Guide (https://armkeil.blob.core.windows.net/developer/Arm%20Developer%20Community/PDF/Arm%20Mali%20GPU%20Best%20Practices.pdf)
[4] Arm® MaliTM GPU OpenGL ES 3.x Developer Guide (https://documentation-service.arm.com/static/649ad0f138511951cb799268)
[5] [PDF] Geometry best practices for Unreal Engine - Arm (https://documentation-service.arm.com/static/615efb57e4f35d2484679d98?token=)
[6] gfxcourses.stanford.edu › 19_mobilegpuLecture 19: Parallelizing and Optimizing Rasterization (https://gfxcourses.stanford.edu/cs248a/winter23content/media/gpuhardware/19_mobilegpu.pdf)
[7] Best practice principles for mobile game development - Arm Developer (https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/p2-best-practices-mobile-game-development)
[8] [PDF] Arm® GPU Best Practices Developer Guide (https://documentation-service.arm.com/static/67a62b17091bfc3e0a947695%3Ftoken=)
[9] Accelerating Mali GPU analysis using Arm Mobile Studio (https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/accelerating-mali-gpu-analysis-using-arm-mobile-studio)
[10] Mali Performance 5: An Application's ... (https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/mali-performance-5-an-application-s-performance-responsibilities)
