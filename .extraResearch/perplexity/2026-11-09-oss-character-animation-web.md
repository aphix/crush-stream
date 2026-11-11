> Question: A browser game written in TypeScript with three.js (WebGL2) and the Rapier physics engine (WASM) has a small open-world city: a few hundred simulated pedestrians with homes, jobs, moods and daily schedules (simulated deterministically on a host and synced to multiplayer peers), about 30 traffic cars on a street graph with traffic lights, police, building interiors, and instanced street props, running on desktops and phones. Which open-source libraries, tools or asset sources exist for animating many humanoid characters in a WebGL or three.js game (procedural or clip-based animation, blending, inverse kinematics, instanced or GPU-skinned crowds, free animation clip libraries)? For each: what it does, licence, how maintained it is, and what it costs at runtime. Cite sources.

For this game, the practical solution is a **hybrid**: use ordinary `AnimationMixer` clips for nearby or important pedestrians, and use reduced-cost pose sampling, GPU instancing, or impostors for the distant population. The main options are below.

## Three.js and WebGL animation libraries

| Library/tool | What it does | Licence and maintenance | Runtime cost |
|---|---|---|---|
| **three.js `AnimationMixer` / `AnimationAction`** | Native clip playback, cross-fading, time scaling, additive actions, and per-character animation state. It is the safest baseline for glTF/GLB characters. | Three.js is open source and actively maintained; its animation system is part of the core project. Three.js is described as an open-source WebGL library.[10] | CPU cost scales with the number of mixers, animated bones, and active tracks. A few hundred fully evaluated skinned characters can become expensive on phones. Share immutable clips and update only visible/nearby characters. |
| **`three-ik`** | Inverse-kinematics solver for Three.js skeletons, useful for feet placement, hand targets, looking, and simple interaction poses. | Open-source project; verify the repository’s current licence and activity before adopting, because smaller Three.js IK packages vary considerably in maintenance. | IK is more expensive than clip playback. Run it only for nearby characters, and preferably only on selected chains such as legs or arms. |
| **`ik-manager` / Three.js IK implementations** | Alternative Three.js-oriented IK managers and FABRIK/CCD-style solvers. Useful as reference implementations or for limited procedural corrections. | Licence and maintenance differ by repository; treat these as dependencies requiring individual audit rather than a single standardized ecosystem. | Cost depends on iterations and chain length. A small number of leg or arm chains is feasible; solving every limb for hundreds of agents each frame is not. |
| **`@pixiv/three-vrm`** | Loads and updates VRM humanoids, including standardized humanoid bones, spring bones, look-at behavior, and VRM animation support. | Open source and maintained by Pixiv; check the repository’s current licence/version terms before shipping. | VRM’s standardized rig is useful for retargeting, but spring bones, look-at, and facial systems add CPU work. Disable those systems for distant NPCs. |
| **`three-mesh-bvh`** | Not an animation system, but a fast BVH for raycasts and spatial queries. It can support foot-ground checks, interaction tests, and visibility/culling logic. | Open source and actively used in the Three.js ecosystem; licence should be checked in the project repository. | BVH queries are generally cheaper than naïve triangle tests, but avoid per-bone or per-agent raycasts when a heightfield/navmesh approximation is sufficient. |
| **`meshoptimizer` / glTF-Transform** | Compresses geometry, skinning attributes, and animation data; can reduce download and memory pressure. | Open source; commonly used with glTF pipelines. Verify the specific package licence when integrating. | Usually lowers runtime bandwidth and memory use. Decompression and optimized buffer access are normally much cheaper than carrying uncompressed assets. |

## Crowd and GPU-oriented approaches

| Library/tool | What it does | Licence and maintenance | Runtime cost |
|---|---|---|---|
| **`three-instanced-mesh` / InstancedMesh-based systems** | Renders many copies of the same character or prop with one draw call. For characters, it works best with a small set of shared meshes and a limited number of animation states. | Three.js’s built-in `InstancedMesh` is the most stable option. Third-party helpers vary in maintenance and licences. | Greatly reduces draw calls, but ordinary `InstancedMesh` does not automatically provide independent skeletal animation. You need shader-based animation, baked vertex animation, or a small number of shared pose states. |
| **GPU skinning with texture palettes** | Evaluates bone matrices or animation poses in a vertex shader. Each instance selects a character pose or animation time from a texture/buffer. | Usually implemented in application code or small open-source examples rather than one dominant library. Licence depends on the implementation. | Moves animation work from JavaScript to the GPU. It can support many agents, but increases vertex-shader work, bone-texture bandwidth, and implementation complexity. Mobile GPU limits must be tested carefully. |
| **Vertex Animation Textures (VAT)** | Bakes each animation or motion sequence into vertex-position textures and samples them in a shader. Excellent for distant crowds whose characters do not need runtime IK or exact bone deformation. | Open-source VAT examples exist, but formats and licences differ. A custom implementation is often straightforward. | Very low CPU cost and few draw calls; memory usage can be high because every sampled frame stores vertex data. It is less suitable for many interchangeable outfits or arbitrary runtime blending. |
| **GPU crowd demos for Three.js/WebGL** | Common implementations use instancing, bone textures, animation atlases, and shader-side time offsets. They are useful as architecture references rather than turnkey engines. | Project quality and maintenance are inconsistent. Audit licences, browser support, WebGL2 assumptions, and whether the code is production-ready. | Best performance for large distant crowds, but requires custom asset preprocessing and careful LOD management. |
| **`three-nebula` or particle systems** | Particle and sprite systems can represent very distant pedestrians as billboards, silhouettes, or abstract moving groups. | Open-source status and maintenance depend on the chosen package. | Much cheaper than skinned meshes; useful beyond the range where individual identity and animation matter. |

For a few hundred pedestrians, a sensible three-tier design is:

- **Near:** full skinned meshes, `AnimationMixer`, locomotion blending, and occasional IK.
- **Mid-range:** shared skeleton/mesh variants, simplified clips, no facial animation, no spring bones, and throttled updates.
- **Far:** instanced meshes, VAT, billboard impostors, or group-level movement with animation phase offsets.

## Procedural animation and blending

A custom procedural layer is often more valuable than adding a large animation framework:

- Blend idle, walk, run, turn, and work clips using speed, direction, mood, and schedule state.
- Use phase synchronization so left/right foot timing remains stable when speed changes.
- Add procedural torso orientation and head look-at only for nearby characters.
- Apply foot correction against the navmesh or simplified ground surface rather than running full-body IK.
- Update distant agents at 5–15 Hz and interpolate transforms between simulation ticks.
- Keep deterministic schedule and mood state separate from visual animation state; peers can reproduce the same high-level state while each client renders at an appropriate LOD.

For networking, synchronize **semantic state**—position/path, locomotion mode, schedule activity, mood seed, and animation phase—not every bone transform. A deterministic seed can select idle variations and phase offsets without network traffic.

## Animation and asset sources

| Source | What it provides | Licence and maintenance | Runtime cost |
|---|---|---|---|
| **Mixamo** | Large library of humanoid clips, auto-rigging, and downloadable character/animation combinations. Adobe says it is free with an Adobe ID and does not require a Creative Cloud subscription.[3] | Adobe permits characters and animations in personal, commercial, and nonprofit projects, including video games.[3] It is **not equivalent to CC0**: avoid redistributing the raw files or repackaging them as a standalone asset library. | No direct runtime cost beyond the resulting clips. FBX-to-glTF conversion, retargeting, clip cleanup, and reducing keyframes affect CPU, memory, and download size. |
| **Mesh2Motion** | Browser-based open-source auto-rigging and animation workflow, including humanoid and creature animation. Search results describe its models, rigs, and animations as CC0.[1] | Appears attractive for permissively licensed assets, but verify the project repository and individual asset licence before shipping because the cited information is from a secondary source. | Same as any imported clip set; preprocessing and animation compression determine runtime cost. |
| **Quaternius** | Free low-poly characters and game-ready asset packs, including animated content. Search results identify its library as CC0.[5] | CC0 assets are convenient for commercial redistribution and modification, subject to confirming the exact pack’s licence. | Low-poly models are well suited to mobile crowds. The main cost is still the number of skinned vertices and active animation evaluations. |
| **Kenney** | Large collection of game assets, including character and animation assets in permissive formats. | Kenney assets are commonly distributed under permissive terms; verify the exact pack and current licence. | Usually appropriate for lightweight stylized crowds; animation cost depends on skeleton complexity and clip count. |
| **KayKit** | Stylized character and animation packs, including humanoid clips and characters. | Some packs are distributed as CC0 according to the cited asset catalogue, but verify each pack’s licence and attribution requirements.[4] | Low-poly assets can work well in mid- and far-range LODs, though separate character meshes may reduce instancing benefits. |
| **CMU Graphics Lab Motion Capture Database** | Thousands of human motion-capture trials in formats such as ASF/AMC and C3D.[7] | Free access does not automatically mean unrestricted commercial redistribution. Check the database terms and convert only the motions needed. | Raw motion capture needs retargeting, cleanup, resampling, and compression. It is a source for building a library, not a drop-in Three.js package. |
| **Blender and Godot/Unreal animation samples** | Useful sources of rigging, retargeting, and procedural-animation examples. | Licence varies by sample; do not assume that an engine example or demo asset is redistributable. | No inherent runtime cost; exported glTF clips have the same costs as any other animation data. |

Mixamo is particularly useful for prototyping and commercial games, but Adobe’s own FAQ limits the auto-rigger and library to bipedal humanoids.[3] For a project that wants to publish source files or an asset pack, CC0 sources such as verified Quaternius, Mesh2Motion, or applicable KayKit packs are safer than distributing downloaded Mixamo files.

## Recommended stack for this game

1. **Authoring:** Blender plus Mixamo, CC0 assets, or CMU motion data; retarget everything to one compact humanoid skeleton.
2. **Runtime baseline:** glTF/GLB, Three.js `AnimationMixer`, shared `AnimationClip` objects, and a small locomotion state machine.
3. **Near-field IK:** a lightweight CCD/FABRIK solver for feet and selected interactions only.
4. **Crowd rendering:** start with ordinary skinned meshes and aggressive LODs; move mid/far agents to instanced or VAT rendering if profiling shows animation or draw calls are limiting.
5. **Mobile safeguards:** cap active mixers, disable facial/spring-bone systems outside the near tier, reduce bone counts, compress animation tracks, and throttle distant updates.
6. **Determinism:** replicate schedule/mood/action state and seeds, not skeletal poses; render animation locally according to camera distance and device performance.

The largest risk is not the choice of clip library—it is evaluating hundreds of independent skeletons, tracks, IK chains, and draw calls every frame. A compact shared rig, animation LOD, throttled updates, and GPU or impostor rendering for distant pedestrians will usually produce a larger gain than switching between similar clip-player libraries.

[1] How to animate a 3D character for free | StarterLoot (https://starterloot.com/guides/how-to-animate-a-3d-character-for-free/)
[2] Best Free Rigged 3D Character Models for Games (2026) (https://app.cinevva.com/guides/free-rigged-3d-character-models)
[3] Mixamo FAQ | Creative Cloud (https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
[4] animate · Skills-SI Market (https://skills-si.com/de/skills/hashgraph-online-awesome-codex-plugins-plugins-homie-rocks-homie-skills-animate)
[5] Where to Find Free Game Assets in 2026 (20+ Sources) (https://app.cinevva.com/guides/game-assets-guide)
[6] awesome-animation-datasets/docs/categories/human-body.md at main · Shimingyi/awesome-animation-datasets (https://github.com/Shimingyi/awesome-animation-datasets/blob/main/docs/categories/human-body.md)
[7] Animation and motion capture for Apps and AI Agents (https://agentgid.com/assets/animation/)
[8] Free-Game-Dev-Assets/catalog/animation/mixamo.md at main · TMHSDigital/Free-Game-Dev-Assets (https://github.com/TMHSDigital/Free-Game-Dev-Assets/blob/main/catalog/animation/mixamo.md)
[9] How to Use Mixamo Animations and Get Custom Motion Free (https://viggle.ai/blog/how-to-use-mixamo-animations)
[10] WebGL: 2D and 3D graphics for the web - Web APIs | MDN (https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)
