> Question: In a real-time game, with only a few rock models and a few plant sprites or models available, what do developers do so that the reused assets do not look repetitive or flat as the camera angle and distance change? Describe the techniques, what each one costs, and the order in which you would apply them in a browser game on mobile hardware.

Developers combine **visual variation**, **good placement**, and **distance-based simplification**. The goal is not to create dozens of unique assets; it is to prevent the player from seeing the same asset, orientation, lighting, and spacing repeated in an obvious pattern.

## Techniques, from cheapest to most expensive

| Technique | What it does | Typical cost |
|---|---|---|
| **Random transforms** | Varies position, rotation, and scale within controlled ranges. Rocks can be tilted or partially buried; plants can use different heights and lean angles. | Nearly free at runtime; trivial CPU cost. |
| **Weighted variation** | Uses several versions with unequal probabilities, so common assets appear often and distinctive ones remain occasional. | Very low CPU and memory cost. |
| **Mirroring and UV variation** | Flips meshes or sprite UVs and varies texture coordinates, tint, brightness, hue, or saturation. | Very low; texture changes are cheap if they do not require extra materials. Mirroring can occasionally affect normals or winding. |
| **Material and color variation** | Applies per-instance color, roughness, ambient-darkening, or subtle hue changes. | Low, especially with GPU instancing or shader attributes; additional materials can increase draw calls. |
| **Cluster or “kitbash” composition** | Places small rocks, grass, leaves, and debris in different groups rather than distributing every object uniformly. | Low runtime cost; more authoring and tuning effort. |
| **Procedural scattering** | Uses a deterministic random seed, terrain slope, masks, exclusion zones, and density rules to generate plausible placement. | Low-to-moderate CPU cost during generation; usually paid once and cached. Poor algorithms can create visible patterns or frame-time spikes. |
| **Decals and ground variation** | Adds shadows, dirt patches, pebble decals, grass-color patches, and contact darkening to break uniform terrain. | Low-to-moderate GPU cost; overdraw and transparency can become expensive on mobile. |
| **Lighting and baked shading** | Uses lightmaps, ambient occlusion, vertex colors, or baked directional shading to give identical models different perceived depth. | Low runtime cost if baked; increased texture memory and authoring time. Dynamic lights and shadows cost considerably more. |
| **Texture atlases** | Packs rock, plant, and ground textures together so many objects can share one material and fewer draw calls. | Saves rendering cost, but increases atlas management complexity and may waste texture space. |
| **GPU instancing** | Draws many copies of the same geometry/material with different transforms or per-instance values. `InstancedMesh` is specifically intended to reduce draw calls for many objects sharing geometry and materials.[3] | Low CPU/draw-call cost, but requires compatible shaders and GPU support; does not make geometry itself cheaper. |
| **Geometry merging or batching** | Combines static nearby objects into larger meshes. | Can reduce draw calls, but makes culling less precise and complicates updates and variation. |
| **LOD meshes** | Replaces a rock or plant with progressively simpler geometry as it gets farther away. LOD commonly uses several mesh levels and may end in a billboard.[1] | Extra asset versions and switching logic; saves vertex and pixel work. |
| **Billboards or impostors** | Replaces distant plants or rocks with camera-facing quads or baked views. Billboards are especially suitable for grass and vegetation.[2] | Very cheap to render, but can reveal their 2D nature from steep camera angles, side views, or with strong shadows. |
| **Distance and visibility culling** | Stops rendering objects outside the camera frustum or beyond a relevance distance. | Usually a major win; requires spatial partitioning or good instance management. |
| **Chunk streaming** | Loads, generates, and unloads terrain details around the player. | Saves memory and startup time but adds implementation complexity, asset-management work, and possible pop-in. |

## How to keep repetition from becoming visible

Use variation that is **correlated with the environment**, not pure randomness:

- Place large rocks near slopes, cliffs, shorelines, or erosion paths.
- Group plants into patches with empty gaps rather than using a uniform grid.
- Use several density fields or noise scales: broad biome variation plus small local clustering.
- Avoid repeating the same rotation sequence. Use a seeded random generator so the result is stable across sessions.
- Hide asset boundaries with foreground vegetation, terrain contours, fog, shadows, and occlusion.
- Vary silhouettes first. A different outline is usually more noticeable than a small texture-color change.
- Avoid excessive scale variation for plants; implausibly large or tiny specimens can look worse than repetition.
- Use a small number of carefully authored “hero” variants near the camera and simpler randomized detail farther away.

For plants, crossed quads or camera-facing sprites are inexpensive, but they should usually be mixed with a few low-poly 3D plants so the camera does not expose a flat wall of vegetation. For rocks, rotate, scale, tilt, bury, and cluster them; a few distinct silhouettes generally outperform many nearly identical color variants.

## Recommended order for a browser game on mobile

1. **Set budgets and profile first.** Establish limits for visible objects, texture memory, triangles, transparency, and draw calls. Mobile performance is often constrained by draw calls and fragment/overdraw cost as much as by polygon count.
2. **Use a small authored asset set well.** Add at least a few silhouette variants for rocks and plants, then use random rotation, scale, mirroring, tint, and weighted selection.
3. **Improve placement.** Use seeded procedural scattering, biome masks, slope rules, clusters, gaps, and exclusion areas. This is usually the best visual improvement per engineering cost.
4. **Share materials and atlas textures.** Keep objects on as few compatible materials as practical, avoiding unnecessary transparent layers.
5. **Instance repeated meshes.** Use instancing for many copies with the same geometry and material; it reduces draw calls, though it does not eliminate shading, overdraw, or triangle work.[3]
6. **Cull aggressively.** Frustum-cull and distance-cull detail, preferably in spatial chunks. Set separate distances for near plants, medium rocks, and distant scenery.
7. **Add simple LODs.** Use a high-quality model nearby, a low-poly model at medium distance, and a billboard or impostor farther away. LOD is specifically intended to reduce rendered triangles as distance increases.[1]
8. **Control transparency and shadows.** Reduce alpha-tested plant density, avoid large overlapping transparent quads, and disable or simplify shadows for distant foliage.
9. **Bake lighting where possible.** Prefer lightmaps, vertex colors, ambient occlusion, and cheap per-instance tint over many dynamic lights.
10. **Stream only if the world requires it.** For large worlds, load detail by terrain chunk; for a small scene, chunk streaming may cost more complexity than it saves.

The practical default is: **authored variants → seeded clustered scattering → shared materials/instancing → culling → LOD/billboards → streaming**. This sequence gives the largest visual gains first, then spends engineering effort on techniques that reduce mobile GPU and memory cost.

[1] Unity - Manual: Grass and other details (https://docs.unity3d.com/2019.1/Documentation/Manual/terrain-Grass.html)
[2] Grass and other details - Unity - Manual (https://docs.unity3d.com/6000.4/Documentation/Manual/terrain-Grass.html)
[3] InstancedMesh (https://threejs.org/docs/pages/InstancedMesh)
[4] Grass and other details (https://docs.unity3d.com/2018.4/Documentation/Manual/terrain-Grass.html)
[5] Scripting API: Terrain - Unity - Manual (https://docs.unity3d.com/2021.2/Documentation/ScriptReference/Terrain.html)
[6] Grass and other details - Unity - Manual (https://docs.unity3d.com/2019.2/Documentation/Manual/terrain-Grass.html)
[7] Unity Script Reference (https://docs.unity3d.com/355/Documentation/ScriptReference/Terrain.html)
[8] Unity - Manual: Grass and other details (https://docs.unity3d.com/2021.1/Documentation/Manual/terrain-Grass.html)
[9] Grass and other details - Unity 6.3 User Manual (https://docs.unity3d.com/2021.2/Documentation/Manual/terrain-Grass.html?ampDeviceId=a482a635-2fa9-4d5f-9b42-8b53a5511632&ampTimestamp=1768003200597)
[10] threejs-notes/threejs/part02-threejs/12-performance-and ... (https://github.com/hoihky/threejs-notes/blob/main/threejs/part02-threejs/12-performance-and-instancing.md)
