> Question: A three.js (WebGL2) city scene has one directional sun light with a shadow map covering a region around the camera; most shadow casters (buildings, street furniture) never move, while a few dozen cars and a few hundred people do, and the sun moves only every few minutes. What techniques are documented or measured for cutting the per-frame cost of the shadow pass in scenes like this, in three.js or in game engines generally, and what did they gain? Cite sources.

The largest gain is to **stop rendering the entire directional-light shadow map every frame**. Since the sun and most casters are static, render static shadows once—or only when the sun, shadow camera, or static geometry changes—and render only dynamic casters each frame.

## Techniques and expected gains

### 1. Freeze the shadow map in three.js

Three.js exposes both global and per-light controls:

```js
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true; // render once

// Later, only after the sun or static casters change:
renderer.shadowMap.needsUpdate = true;
```

Alternatively, disable updates specifically on the sun:

```js
sun.shadow.autoUpdate = false;
sun.shadow.needsUpdate = true;
```

This removes repeated shadow-map rendering for unchanged geometry. The gain can approach the cost of the entire shadow pass: if the shadow pass consumed 4 ms per frame, freezing it can recover roughly 4 ms per frame, apart from the one-time update.[1][5][6]

However, this alone does **not** give correct moving-car and moving-person shadows: their shadows would also be frozen. It is appropriate only for fully static shadows, or as part of a split static/dynamic solution.

### 2. Split static and dynamic shadow casters

The relevant architecture is:

- Cache a shadow map for buildings, roads, poles, and other static casters.
- Render cars and people into a separate dynamic shadow map each frame.
- Combine the two during lighting, or use separate lights/material passes.

This avoids rerendering hundreds of static meshes merely because a few dozen cars and people moved. Unity HDRP documents this explicitly: static casters can be rendered according to an `OnEnable` or `OnDemand` update mode, while dynamic casters are rendered into their own maps each frame; its documentation says a mixed cached shadow map “greatly improves performance” in mostly-static scenes.[7]

In a custom WebGL2 implementation, the split generally requires custom shader logic or multiple shadow samplers. A practical variant is to maintain:

- one frozen static depth texture;
- one dynamic depth texture;
- a shader that takes the minimum/nearest valid depth from both maps.

The exact saving depends on caster draw cost, but the static portion is removed from every dynamic shadow update. If static casters account for 90% of shadow-pass work, the dynamic shadow pass can theoretically fall near 10% of its previous cost, plus compositing overhead.

### 3. Use cached or virtualized shadow pages

Unreal Engine’s Virtual Shadow Maps cache shadow-map pages between frames and invalidate only pages affected by moving geometry or a moving light.[2][8] Unreal also documents **Separate Static Caching**, which stores static and dynamic depth separately so that moving dynamic geometry does not force expensive static geometry in the same page to be redrawn.[8]

This is especially applicable to a sun whose shadow region covers a large area: only pages containing cars, people, or affected geometry need updating. The benefit is workload-dependent, but the documented mechanism specifically prevents cheap dynamic geometry from invalidating and rerendering expensive static geometry.[2][8]

A three.js/WebGL2 implementation would need to build this manually, for example with:

- tiled or cascaded shadow regions;
- dirty flags per tile;
- static depth textures retained between frames;
- dynamic depth rendered only into affected tiles;
- compositing or shader-side comparison of static and dynamic depths.

### 4. Restrict who casts shadows

Do not let every object cast into every shadow map. For example:

- Buildings cast into the static map.
- Cars and people cast into the dynamic map.
- Small props cast only if their shadows are visible at the current distance.
- Distant objects use baked lighting, blob/contact shadows, or no shadow.

This reduces both CPU scene traversal and GPU depth draws. The three.js guidance for moving characters in a static world recommends keeping automatic shadow updates off where possible and limiting `castShadow` to dynamic characters plus only the large static objects whose shadows matter.[3]

The gain is approximately proportional to removed shadow-caster draw calls and their vertex-processing cost. It is often more reliable than reducing the main render resolution because shadow passes commonly render many objects with little visual contribution.

### 5. Reduce shadow-map resolution, cascades, and coverage

A directional shadow map covering a large region around the camera wastes texels outside visible or important areas. Common reductions include:

- smaller orthographic shadow-camera bounds;
- fewer cascades;
- lower resolution for distant cascades;
- updating distant cascades less frequently;
- separate high-resolution near shadows from low-resolution far shadows.

These reduce rasterization and depth-texture bandwidth, though they do not by themselves eliminate traversal and draw-call cost. The appropriate tradeoff depends on whether profiling shows GPU rasterization, vertex processing, or CPU submission as the bottleneck.

### 6. Update dynamic shadows less often

Cars and people usually move every frame, but their shadow maps need not necessarily update at display rate. Possible policies include:

- update every second or third frame;
- update only when dynamic objects move beyond a threshold;
- update only the affected cascade or tile;
- update distant dynamic shadows at a lower frequency.

This trades temporal shadow lag for lower average cost. For example, updating a dynamic shadow map every other frame cuts its average update cost approximately in half, assuming no additional invalidation work.

### 7. Bake what does not need to be dynamic

For truly static lighting, offline lightmaps or baked shadowing remove real-time shadow rendering entirely. Unity’s documentation describes precomputed lightmaps as offering better quality and performance than real-time shadows when level geometry and lighting are static.[4]

For the described scene, baking is suitable for:

- building-to-ground shadows;
- fixed street furniture;
- static ambient occlusion.

Dynamic cars and people would still use real-time shadows, contact shadows, or simplified projected shadows.

## Recommended design for this scene

A sensible implementation order is:

1. **Freeze or cache static shadows.**
2. **Render only cars and people in a dynamic shadow pass.**
3. **Use a smaller dynamic shadow map or dynamic region around the camera.**
4. **Cull small and distant casters.**
5. **Update dynamic shadows every \(N\) frames or only when movement warrants it.**
6. **Reduce cascade coverage and resolution after profiling.**

The biggest documented architectural gain is not merely setting `autoUpdate = false`; it is **separating static and dynamic shadow data**. Three.js directly supports on-demand shadow updates, while engines such as Unity HDRP and Unreal expose more complete cached-static/dynamic separation because they can retain and combine shadow data internally.[1][7][8]

[1] threejs-lighting (https://tessl.io/registry/skills/github/cloudai-x/threejs-skills/threejs-lighting)
[2] Virtual Shadow Maps in Unreal Engine (https://dev.epicgames.com/documentation/unreal-engine/virtual-shadow-maps-in-unreal-engine?lang=en-US)
[3] Shadows That Look Right (Grade A) - Claude Skill (https://www.skillsdirectory.com/skills/nirholas-shadows-that-look-right)
[4] Shadows in Unity (https://docs.unity3d.com/460/Documentation/Manual/Shadows.html)
[5] skilljmskill/skills/threejs-performance/SKILL.md at 4bce7920e38ebc07f050f52c04f54bb27a4a86dc · DaraBoth/skilljmskill (https://github.com/DaraBoth/skilljmskill/blob/4bce7920e38ebc07f050f52c04f54bb27a4a86dc/skills/threejs-performance/SKILL.md)
[6] Three.js-Claude-Skill-Package/skills/source/threejs-impl/threejs-impl-shadows/SKILL.md at master · Impertio-Studio/Three.js-Claude-Skill-Package (https://github.com/Impertio-Studio/Three.js-Claude-Skill-Package/blob/master/skills/source/threejs-impl/threejs-impl-shadows/SKILL.md)
[7] Control shadow resolution and quality | 17.6.0 (https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.6/manual/Shadows-in-HDRP.html)
[8] Virtual Shadow Maps in Unreal Engine | Unreal Engine 5.4 Documentation | Epic Developer Community (https://dev.epicgames.com/documentation/unreal-engine/virtual-shadow-maps-in-unreal-engine?application_version=5.4)
[9] Virtual Shadow Maps in Unreal Engine | Unreal Engine 5.7 Documentation | Epic Developer Community (https://dev.epicgames.com/documentation/unreal-engine/virtual-shadow-maps-in-unreal-engine?application_version=5.7)
[10] Three JS Performance Guide (https://gist.github.com/iErcann/2a9dfa51ed9fc44854375796c8c24d92)
