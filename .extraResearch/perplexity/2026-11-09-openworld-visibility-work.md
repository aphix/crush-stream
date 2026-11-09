> Question: A browser game (three.js, WebGL2) has a small open-world city: about 300 instanced rowhome buildings with facade geometry, ground decals, street props, building interiors loaded near the player, about 300 simulated pedestrians and about 30 traffic cars, on desktops and phones. How do open-world games decide each frame what to draw, what to simulate and what to keep loaded for things the player cannot currently see, and how do they keep that visibility work itself cheap? What has been measured, and with what results? Cite sources.

Open-world games usually separate **rendering visibility**, **simulation activity**, and **asset residency**. They do not ask one expensive question—“what is visible?”—for every object every frame. Instead, they use cheap coarse tests first, hierarchical spatial organization, distance-based quality tiers, and slower event-driven updates for streaming and simulation.

## 1. Three different decisions

| Decision | Typical question | Update frequency |
|---|---|---|
| **Draw** | Could this object contribute pixels to the current camera? | Every frame, often per spatial chunk |
| **Simulate** | Does this actor need full behavior, simplified behavior, or no behavior? | Every frame for nearby actors; less often farther away |
| **Keep loaded** | Might the player need this asset soon? | On movement, boundary crossings, or streaming-budget updates |

An object can therefore be loaded but not drawn, drawn at low detail but not fully simulated, or simulated abstractly while its detailed mesh is unloaded.

## 2. The usual visibility pipeline

A practical pipeline for the described city is:

1. **Partition the world spatially.**  
   Divide the city into grid cells, sectors, or a quadtree. Each cell stores buildings, props, decals, pedestrians, and traffic references. Culling a cell avoids testing every object individually.

2. **Test the camera frustum.**  
   The engine checks each cell’s bounding box or sphere against the six planes of the camera frustum. Objects outside the view are rejected before draw submission. Three.js performs frustum culling at the `Object3D`/mesh level by default, but a large merged mesh is culled as one object, so city geometry should generally be clustered rather than merged into one world-sized mesh.[6][8]

3. **Apply distance and screen-size thresholds.**  
   Nearby rowhomes may use full facade geometry; farther buildings may use simplified meshes, impostors, or only silhouettes. Small decals and props can disappear when their projected size is below a pixel threshold.

4. **Use occlusion selectively.**  
   Frustum culling does not know that a building is hidden behind another building. Occlusion culling can remove such objects, but it requires additional CPU work and baked/runtime data. Unity explicitly notes that runtime occlusion calculations can offset their savings, making occlusion most attractive when the project is GPU-bound from overdraw.[4]

5. **Submit only the remaining renderable groups.**  
   Repeated objects—streetlights, windows, shrubs, pedestrians, or similar cars—are instanced or batched to reduce draw calls. `InstancedMesh` reduces submission overhead, but ordinary instancing is commonly all-or-nothing for culling: if the aggregate bounding volume is visible, all instances may be drawn. That makes localized instance groups preferable to one instance set spanning the whole city.[7]

A useful arrangement for this game would be one or a few instance groups per city cell, not one global group for all 300 buildings or all pedestrians.

## 3. Simulation is usually cheaper than rendering

The 300 pedestrians and 30 cars should not all run identical full logic every frame.

A common tier system is:

- **Near player:** full animation, collision, navigation, avoidance, and interaction.
- **Middle distance:** lower-rate steering and animation updates; simplified collision.
- **Far but relevant:** update positions or traffic flow at a coarse interval.
- **Outside the active simulation radius:** freeze, despawn, or represent groups statistically.
- **Out of sight but potentially important:** keep a lightweight state—route, velocity, schedule, or seed—without running the full character controller.

Simulation can also be updated at a fixed lower rate, such as 10–20 Hz, while rendering interpolates between states at display rate. Pedestrians can be spatially registered so only actors in nearby cells enter detailed updates. Cars can be simulated by road segment and lane rather than by expensive free-space navigation.

Visibility should not be used as the only simulation rule: an actor behind a building may still need to move if it is about to emerge, affect gameplay, or be audible. Distance, relevance, and predicted near-future visibility are better criteria.

## 4. Streaming and interiors

Streaming normally uses an **active radius** around the player rather than the current camera frustum alone.

For example:

- Keep the current cell and neighboring cells resident.
- Preload cells in the movement direction.
- Retain recently used cells briefly to prevent thrashing.
- Load interiors only when the player approaches an entrance, looks through a window, or enters an interior trigger.
- Unload by least-recently-used priority when memory or GPU-resource budgets are reached.

The load radius should exceed the draw radius. Otherwise, turning quickly or moving across a cell boundary can expose unloaded geometry. Interiors can use separate budgets and be loaded asynchronously in stages: collision/proxy first, then structural mesh, then materials, decals, and decorative props.

Occlusion data and other visibility data also consume memory. Unity documents that baked occlusion data must be loaded into RAM and that enabling occlusion can increase disk, CPU, and memory requirements.[2]

## 5. Keeping visibility work cheap

The main optimization is to avoid doing expensive visibility work at object granularity unless coarse tests say it is necessary.

Effective techniques include:

- **Hierarchical culling:** test cell bounds first, then objects inside visible cells.
- **Spatial coherence:** update nearby cells and objects together.
- **Temporal coherence:** preserve last frame’s visibility and avoid rebuilding all lists when the camera has moved only slightly.
- **Distance bands:** use simple squared-distance tests before detailed tests.
- **Precomputed static data:** bake cell bounds, portal connections, occluder regions, and LOD ranges.
- **Portal/room culling:** for interiors, traverse only rooms connected to the player’s current room through visible doors or portals.
- **Per-cell instancing:** reduce draw calls without making the entire city one indivisible culling unit.
- **Separate static and dynamic lists:** static buildings and decals can use cached spatial structures; pedestrians and cars need frequently updated membership.
- **Budgeted streaming:** cap asset uploads, decompression, and scene-graph work per frame.
- **Avoid per-frame allocations:** reuse arrays, bounding volumes, and visibility buffers.

Occlusion culling is not automatically beneficial. In one measured Quest 2 example, enabling it reduced draw calls from about 180 to about 120 and saved roughly 0.69 ms/frame in opaque drawing, but added about 0.32 ms/frame of culling work and used approximately 0.8 MB of RAM.[3] The net gain was therefore about 0.37 ms/frame in that particular scene and device—not a universal result.

Unity similarly emphasizes that reducing draw calls can improve CPU performance, while more rigorous culling can reduce both CPU command submission and GPU rendering; however, culling itself has a cost and must be profiled.[1][2]

## 6. What the measurements mean for this city

At only about 300 buildings, the building count itself is unlikely to be the dominant problem. The likely costs are:

- facade material and draw-call count;
- overdraw from decals, transparent materials, and dense windows;
- excessive geometry in visible buildings;
- animated pedestrian skinning and animation updates;
- texture bandwidth and pixel ratio on phones;
- asset upload and garbage-collection spikes during streaming;
- overly large instanced groups that defeat useful culling.

A reasonable target architecture would be:

- 16–64 spatial city cells, depending on dimensions;
- one bounding volume and visibility record per cell;
- building LODs selected by distance and projected size;
- facade and prop instance groups split by cell and material;
- pedestrians divided into near, mid, and far simulation pools;
- traffic simulated primarily by road segments;
- interiors streamed by trigger plus look-ahead;
- occlusion enabled only for dense street corridors or interiors where measurement shows a net benefit;
- separate profiling of JavaScript, culling, draw submission, GPU frame time, memory, and streaming stalls.

The decisive measurements are not object counts but **frame-time budgets**: CPU scripting, animation, culling, render submission, GPU geometry, fragment/overdraw, texture memory, and worst-case streaming spikes. A technique is useful only if its saved rendering or simulation time exceeds its own CPU, memory, and implementation cost.

[1] Reduce rendering work on the CPU or GPU - docs.unity.com (https://docs.unity.com/en-us/engine/6000.6/manual/analysis/graphics-performance-profiling/optimizing-graphics-performance)
[2] Managing GPU usage for PC and console games - Unity (https://unity.com/how-to/gpu-optimization)
[3] How to Use Occlusion Culling in Unity — The Sneaky Way (https://www.gamedeveloper.com/design/how-to-use-occlusion-culling-in-unity-the-sneaky-way)
[4] Occlusion culling (https://docs.unity3d.com/6000.1/Documentation/Manual/OcclusionCulling.html)
[5] A Practical Guide to Profiling and Optimizing WebGL Scenes (https://webeyez.com/insights/guides/three-js-performance-profile-guide)
[6] threejs-performance - cloudai-x (https://www.ui-skills.com/skills/cloudai-x/threejs-performance)
[7] Article 09: Performance: Instancing, LOD, Draw Calls — Three ... (https://masterallarts.com/learn/threejs-from-zero/09-performance-instancing-lod/)
[8] WebGL and Three.js: Building 3D Web Experiences That Actually ... (https://simplified.media/guides/webgl-threejs)
[9] Glassys/docs/notes/threejs-best-practices-100-tips.md at main · qundaoXu/Glassys (https://github.com/qundaoXu/Glassys/blob/main/docs/notes/threejs-best-practices-100-tips.md)
[10] 252 Threejs Webgl Patterns (Grade A) - Claude Skill - Skills Directory (https://www.skillsdirectory.com/skills/fluxonlab-252-threejs-webgl-patterns)
