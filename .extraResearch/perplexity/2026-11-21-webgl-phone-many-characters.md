> Question: A WebGL2 (three.js) browser game draws a small city neighbourhood with a few hundred animated pedestrians, a few dozen cars, building facades, interiors and night lighting, and must run at high frame rates on phone browsers. What has been measured or documented about where frame time goes on phone GPUs and browsers in scenes like this, and which practices produced measured gains? Cite sources with numbers.

For a 60-Hz target, the total frame budget is **16.67 ms**; at 120 Hz it is only **8.33 ms**. The available evidence suggests that phone-browser scenes like this are usually limited by a combination of **draw-submission CPU cost, fragment/pixel work, shadow passes, and JavaScript animation/update work**, rather than by polygon count alone.

## What has been measured

- **Draw calls can dominate CPU time.** A measured Three.js reduction from **531 to 334 draw calls**—a 37% decrease—reduced CPU frame time by **12–18%**, with identical pixels.[2] Another reported mobile comparison reduced calls from **31 to 2–3**, vertices by about **80%**, and increased mobile FPS from **15–25 to 30–45**—roughly an **80% FPS increase**—though this is a project report rather than a controlled benchmark.[4]
- A commonly cited rule of thumb is about **0.1 ms of CPU overhead per mobile draw call**: 200 separate meshes could therefore consume roughly **20 ms**, already exceeding a 16.67-ms frame budget; batching them into one call was reported to reduce that overhead to about **0.1 ms**.[5] Treat this as an approximate device-dependent estimate, not a universal constant.
- Browser GPU studies find that increasing GPU time strongly reduces frame rate: one reported relationship says that a one-unit GPU-time increase corresponded to approximately a **two-thirds FPS reduction on high-end Windows**, and slightly more than **one-half on low-end Windows and Mac**.[1] The study is not a phone-specific city benchmark, but it supports treating GPU time and frame-time variance as first-class measurements.
- **Shadows multiply rendering work.** A shadow-casting light requires another scene render for its shadow map; one documented example measured approximately **3 ms for one directional light with shadows** versus **12 ms for three shadow-casting lights**, against a 16.67-ms budget.[9] Other documentation summarizes the same mechanism: each shadow-casting light renders shadow casters again.[3][7]
- **Resolution and overdraw are major mobile-GPU costs.** A scene can be GPU-bound even with modest JavaScript time and draw-call counts when pixel ratio, transparent layers, post-processing, or large shadow maps are high.[7][8] This is particularly relevant to glass, windows, foliage, particle effects, interiors viewed through openings, and night lighting with multiple blended layers.
- Practical mobile budgets cited in Three.js guidance are roughly **under 100–150 draw calls**, **100,000–500,000 visible triangles**, and **under 100–200 MB of GPU textures** for a mid-range phone; these are heuristics rather than standards.[3]

## Practices with measured or documented gains

- **Instance repeated objects.** Use `InstancedMesh` for pedestrians, street furniture, lamps, and repeated building components. One example notes that 100 copies of a three-mesh model can mean **300 calls**, while instancing can reduce that to **three**, keeping the same geometry workload while cutting submission overhead.[3]
- **Merge or batch compatible geometry and materials.** The 531-to-334-call measurement produced **12–18% lower CPU frame time** without visual changes.[2] For buildings, sidewalks, façade elements, and static props, batching by material is usually more valuable than blindly reducing triangles.
- **Reduce shadow work.** Use one principal shadow-casting light, restrict its shadow camera and caster list, lower shadow-map resolution, and bake static building/interior shadows where possible. The measured **3 ms versus 12 ms** lighting example shows how quickly multiple shadow lights can consume the frame.[9]
- **Cap device pixel ratio and scale resolution adaptively.** A cited mobile approach caps pixel ratio at **2**, or around **1.5 on weaker phones**, and lowers it when GPU frame time rises.[3][7] This directly reduces fragment workload; it is often more effective than reducing already-small meshes.
- **Use LOD and culling.** Apply distance-based pedestrian animation and geometry LOD, frustum/occlusion culling for buildings and interiors, and impostors or simplified meshes for distant cars and people. The cited mobile budget recommends LOD and culling to remain within its **100k–500k visible-triangle** range.[3]
- **Compress and share textures.** KTX2/Basis textures, shared atlases, and 1,024–2,048-pixel maps reduce GPU memory and bandwidth; the cited guidance targets **less than 100–200 MB** of texture memory on mid-range phones.[3]
- **Measure CPU and GPU separately.** `renderer.info.render.calls`, triangle counts, texture counts, browser performance traces, and Spector.js captures identify different bottlenecks.[6][8] A useful diagnostic split is:
  - High JavaScript time: pedestrian AI, animation updates, physics, allocations, or draw submission.
  - Low JavaScript time but high GPU time: pixel ratio, overdraw, shadows, lighting, post-processing, or shader complexity.
  - High calls but modest GPU time: batching, instancing, material consolidation, and fewer scene objects are likely to help.

For this particular scene, the highest-probability order is: **profile on representative phones; instance or batch pedestrians and repeated props; reduce material/draw-call count; use one tightly scoped shadow light; cap pixel ratio; then optimize transparent overdraw and animation updates**. The numerical results above are useful directional evidence, but the exact winner depends on the phone GPU, browser, resolution, thermal state, and whether the frame is CPU- or GPU-bound.

[1] Characterizing GPU-accelerated Web Applications in Browsers (https://dl.acm.org/doi/10.1145/3744916.3787824)
[2] How to Reduce Three.js Draw Calls Without Changing a Pixel (https://irisli.dev/notes/fewer-draw-calls/)
[3] Mobile Performance Budget (Grade A) - Claude Skill (https://www.skillsdirectory.com/skills/nirholas-mobile-performance-budget)
[4] Three.js Animation Optimization Guide (https://github.com/ErikBudanovDev/Three-JS-Animation---Girl-in-Metaverse/blob/master/README_OPTIMIZATION.md)
[5] How Do You Optimize Three.js Performance for Mobile Devices - Digital Strategy Force (https://digitalstrategyforce.com/journal/how-do-you-optimize-threejs-performance-for-mobile-devices/)
[6] claudedesignskills/.claude/skills/threejs-webgl/references/optimization_checklist.md at 1da73febff0c3e1dfefc07f8a5ef8f7d1dfdb6cd · freshtechbro/claudedesignskills (https://github.com/freshtechbro/claudedesignskills/blob/1da73febff0c3e1dfefc07f8a5ef8f7d1dfdb6cd/.claude/skills/threejs-webgl/references/optimization_checklist.md)
[7] gamedev-skills/skills/web-game-performance/SKILL.md at ... (https://github.com/Playgama/gamedev-skills/blob/main/skills/web-game-performance/SKILL.md)
[8] Three.js Performance Optimisation: 60fps Patterns | IGC (https://www.intelligentgraphicandcode.com/development/threejs-interfaces/performance)
[9] WebGL and Three.js: Building 3D Web Experiences That Actually Perform (https://simplified.media/guides/webgl-threejs)
[10] 100 Three.js Tips That Actually Improve Performance (2026) (https://www.utsubo.com/blog/threejs-best-practices-100-tips)
