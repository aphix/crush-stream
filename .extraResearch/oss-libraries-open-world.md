# Existing libraries for the Open World: what to adopt, what to keep (2026-11-09)

Owner: "are there any libs/repos/rigs/open source scaffolding for animations or logic tracking or world state management or anything like that which would be beneficial and save us work? ... never reinvent the wheel unless ... we have a custom way to do it that's already better". Four neutral Perplexity questions (raw answers: `perplexity/2026-11-09-oss-crowd-agent-sim-js.md`, `-oss-character-animation-web.md`, `-oss-ecs-world-state-js.md`, `-oss-culling-lod-threejs.md`). Only the claims below were checked against the source; the rest are leads.

## Verified

1. **`@three.ez/instanced-mesh` (InstancedMesh2)**: MIT, v0.3.16, last published 2026-11-04, peer `three >=0.159.0` (npm registry). Its README: "Enhanced InstancedMesh with frustum culling, fast raycasting (using a BVH), sorting, visibility, LOD, skinning and more"; "Per-instance frustum culling ... By default `perObjectFrustumCulled` is `true`"; a dynamic BVH "works very well if the instances are mostly static"; per-instance visibility (`setVisibilityAt`), LOD and shadow LOD, per-instance uniforms, skinning. 481 stars ([repo](https://github.com/three-ez/instanced-mesh)).
2. **`three-mesh-bvh`**: MIT, v0.9.18, last published 2026-11-03 (npm registry). A BVH for raycasts and spatial queries ([docs](https://gkjohnson.github.io/tools/docs/three-mesh-bvh/)).
3. **Quaternius assets are not CC0 any more.** The Quaternius Asset License v1.0 (updated 8/28/2026): free for commercial games, "No attribution is required", but you may not "redistribute the Assets themselves ... as a standalone asset, asset pack, stock file ... regardless of how much the Assets have been modified" ([licence](https://quaternius.com/license.html)). The site lists "Universal Animation Library" 1 and 2 (humanoid, retargetable) and a "Downtown City MegaKit". The Perplexity answer's "CC0" is wrong for current packs.
4. **Mixamo** (Adobe FAQ, cited in the answer): free with an Adobe ID, use in commercial games allowed, bipedal humanoids only; not CC0 (no redistribution of the raw files). Not opened by Main; treat as the answer's reading of the FAQ.

## Not adopted, and why (reading, not measured)

- **ECS / state libraries (bitecs, Miniplex, XState, behaviour-tree packages, Lagless):** the open world already keeps its society in typed-array rows (`CityState`), runs it on a fixed tick, seeded and pure, with a worker twin, NET-versioned host events and digest rows. A library would replace working, determinism-proven code for no named gain. Lagless's licence is unconfirmed; the behaviour-tree packages are small or inactive (behavior3js last activity 2015 per the answer).
- **Crowd/traffic libraries (PathFinding.js, CrowdSim, traffic topic repos):** the answer itself finds none that covers schedules, needs, local avoidance, signals and deterministic sync; ours already has a street graph planner, separation and signal phases.
- **Netcode (Colyseus, Nakama):** the game has its own WebRTC relay and host-authoritative events.

## Worth trying here

1. **InstancedMesh2 for the open world's map-wide instance groups** (ground decals in one 8192 m cell, trees, street kit, facade fittings, roof pieces): per-instance frustum culling fixes the "one sphere for the whole city" cost from `openworld-culling.md` without re-cutting every group into cells, and its per-instance visibility could carry OwCull's phase-out. Trial on one group first (the decals), measure draw-list CPU and visible instances at street level, keep only if it wins on the owner's bench. It is a dependency add: owner's call.
2. **three-mesh-bvh** only if a sight or raycast cost shows up in a profile (police sight, the camera's wall check); SightField's coarse boxes are cheap today.
3. **Animation clips:** the dummy rig's procedural clips (OwAnim) are code; a clip library would need retargeting to that rig. If clips are wanted, Quaternius's Universal Animation Library fits the licence for a shipped game, but its files must not sit in a public repo as assets (QAL 3a): keep them out of the GitHub repo or bake them into code-form poses.
