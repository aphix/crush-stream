> Question: In a three.js scene, groups of objects drawn as one InstancedMesh, and some meshes whose vertex shader moves or scales vertices, vanish when the camera is close to them and reappear when it is farther away, or vanish as the camera rotates. What causes this, and how do three.js and other WebGL or game engines handle it? Cite sources.

The cause is almost certainly **incorrect or stale bounding volumes used for frustum culling**—not that the GPU vertex shader has stopped working.

Before drawing, three.js tests an object’s bounding sphere or box against the camera frustum. If the volume is outside the frustum, three.js skips the draw call. This test uses the CPU-side bounds; it generally cannot know that a vertex shader will later move, enlarge, or otherwise deform the vertices. Consequently, the visible geometry can extend beyond its recorded bounds, or the recorded bounds can be too small or in the wrong place. Rotating the camera then makes the culling result change, producing the “vanishes when close/rotated” symptom.

For `InstancedMesh`, the mesh has its own `boundingSphere` and `boundingBox`, which supersede the geometry’s bounds. three.js documents that these must be recomputed after changing instance transforms with `setMatrixAt()`; the sphere may be computed automatically when needed for frustum culling, but it can be stale if instance data changes afterward.[1][9]

## Typical fixes in three.js

```js
// After changing instance matrices:
instancedMesh.instanceMatrix.needsUpdate = true;

instancedMesh.computeBoundingSphere();
instancedMesh.computeBoundingBox();
```

For shader deformation, use a bound that encloses the **maximum possible GPU-deformed shape**:

```js
geometry.boundingSphere = new THREE.Sphere(
  new THREE.Vector3(0, 0, 0),
  maximumPossibleRadius
);

geometry.boundingBox = new THREE.Box3(
  new THREE.Vector3(-maxX, -maxY, -maxZ),
  new THREE.Vector3( maxX,  maxY,  maxZ)
);
```

For an `InstancedMesh`, set or compute the bounds on the `InstancedMesh` itself, because its instance-level bounds are the ones used for culling. If every instance may move widely, the safe bound must include all instance transforms and all possible shader displacement. A conservative oversized sphere is often preferable to intermittent disappearance.

You can also test the diagnosis by disabling culling:

```js
instancedMesh.frustumCulled = false;
mesh.frustumCulled = false;
```

If the objects no longer disappear, the problem is confirmed. This is useful for diagnosis, but disabling culling everywhere can increase CPU submission and GPU workload.

Also check for these related issues:

- Call `computeBoundingSphere()` after changing instance matrices; three.js specifically notes that recomputation may be necessary after `setMatrixAt()`.[1]
- Set `instanceMatrix.needsUpdate = true` after modifying instance transforms.
- Ensure the bounds are expressed in the coordinate space expected by the object and include object transforms.
- If the shader scales around a pivot, include the farthest possible transformed vertex, not merely the original geometry radius.
- If instances occupy a large region, one `InstancedMesh` has one aggregate culling volume; splitting it into spatially local instanced meshes can improve both correctness and culling efficiency.

## How engines generally handle it

All real-time engines face the same fundamental limitation: **frustum culling happens before the GPU vertex shader produces the final positions**. They therefore use a conservative precomputed, manually supplied, or dynamically updated bound.

Unity’s documentation describes the same failure mode explicitly: vertex shaders can push vertices outside pre-calculated bounds. Its remedies are to modify the bounds to cover the possible volume or enable `Update When Offscreen`, which recalculates bounds every frame.[5][6] Unity normally avoids updating off-screen skinned meshes for performance, so its default behavior also favors conservative bounds over continuous exact evaluation.[2][4]

The general approaches are:

- **Static conservative bounds:** Compute a maximum possible volume offline or at load time. This is cheap and common.
- **Dynamic bounds:** Recalculate bounds on the CPU as animation, instances, or deformation changes. This is more accurate but costs CPU time and may itself need to run even when the object is currently culled.
- **Disable culling:** Always submit the object. Simple and robust, but potentially expensive.
- **Spatial partitioning:** Divide a large group into smaller objects or batches, each with a tighter bound.
- **GPU-driven culling:** Compute bounds or visibility in compute shaders, then issue indirect draws. This handles large numbers of dynamic objects efficiently but requires a more complex renderer.

Thus, the correct conceptual fix is not to adjust the camera or depth settings first; it is to make the CPU-visible bounding volume encompass every position and scale the vertex shader can produce, recompute it when instance transforms change, or disable/specialize culling where appropriate.

[1] InstancedMesh (https://threejs.org/docs/pages/InstancedMesh)
[2] Skinned Mesh Renderer component reference - docs.unity.com (https://docs.unity.com/en-us/engine/6000.3/manual/assets-and-media/asset-types/mesh/components-reference/class-skinned-mesh-renderer)
[3] SkinnedMeshRenderer • UnityEngine • 7000.0 • Unity Editor (https://docs.unity.com/en-us/engine/7000.0/script-reference/unityengine/skinnedmeshrenderer)
[4] Skinned Mesh Renderer (https://docs.unity.cn/530/Documentation/Manual/class-SkinnedMeshRenderer.html)
[5] Skinned Mesh Renderer component (https://docs.unity3d.com/2022.1/Documentation/Manual/class-SkinnedMeshRenderer.html)
[6] Skinned Mesh Renderer - Unity (https://docs.unity.cn/430/Documentation/Components/class-SkinnedMeshRenderer.html)
[7] Skinned Mesh Renderer component reference • Unity Editor ... (https://docs.unity.com/en-us/engine/7000.0/manual/assets-and-media/asset-types/mesh/components-reference/class-skinned-mesh-renderer)
[8] Skinned Mesh Renderer component reference (https://docs.unity.com/en-us/engine/6000.0/manual/assets-and-media/asset-types/mesh/components-reference/class-skinned-mesh-renderer)
[9] How to update Things - three.js manual (https://threejs.org/manual/pages/how-to-update-things.html)
[10] Manual: Skinned Mesh Renderer - Unity (https://docs.unity.cn/2021.1/Documentation/Manual/class-SkinnedMeshRenderer.html)
