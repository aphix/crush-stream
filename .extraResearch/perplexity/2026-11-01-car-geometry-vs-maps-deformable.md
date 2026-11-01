> Question: In racing and car-crash games with deformable cars (BeamNG.drive, Wreckfest, Forza Motorsport/Horizon damage, Gran Turismo, Burnout Paradise, Need for Speed, Assetto Corsa, and mobile racers like Real Racing 3 and Asphalt 9), how do developers balance mesh polygon count against normal maps, height/parallax maps and detail textures for car bodies, and how does deformation change that balance? Concrete specifics: typical car body triangle and vertex counts per LOD (hero car vs AI cars vs mobile), what fine detail they bake into normal maps (panel gaps, shut lines, vents, badges, wheel-arch lips) vs keep as geometry, how the deformable mesh resolution is chosen (enough vertices for crumple/folds; BeamNG node/beam vs visual mesh skinning; Wreckfest's soft-body deformation of a visual mesh), whether normal maps stay correct when the mesh deforms (tangent space riding the skinned mesh), and whether vertex count or skinning cost (CPU or GPU skinning) is the bottleneck. Cite GDC talks, developer blogs and postmortems; mark facts vs estimates.

There is **no published industry-wide polygon budget** for these games, and the requested titles rarely disclose per-car counts. The defensible picture is therefore: **specific facts where developers document them, and clearly labeled estimates elsewhere**.

## The central trade-off

A car renderer usually divides detail into four layers:

| Detail | Usually represented by | Why |
|---|---|---|
| Overall silhouette, panel curvature, wheel arches | Geometry | A normal map cannot change the outline or cast the correct silhouette |
| Medium-scale creases, vents, shut lines, seams and raised trim | Geometry in hero views; normal/height maps at distance | Geometry affects shadows, reflections and parallax; textures are cheaper |
| Fine stamped-metal ripples, tiny fasteners, grille perforations, logos and surface grain | Normal maps, sometimes height/parallax maps | Too small to justify vertices |
| Paint, dirt, scratches, color variation and damage masks | Albedo, roughness, metallic and detail textures | These are primarily material variation |

For glossy cars, geometry is more valuable than on a matte object because reflections reveal curvature and gaps. A shallow normal-map “panel gap” can look acceptable in diffuse lighting but often fails in a close reflection, at a grazing angle, or when the gap must cast a shadow.

## Polygon counts: what can and cannot be stated

The following ranges are **production estimates, not published specifications**:

| Target | Approximate visible vehicle triangles | Typical use |
|---|---:|---|
| Hero car, modern PC/console racing game | 100,000–300,000 | Player car, showroom, replay, close camera |
| Hero car with separate interior, wheels, glass, damage parts and accessories | 200,000–500,000+ | Very close camera or premium presentation |
| Ordinary AI car, high-detail LOD | 50,000–150,000 | Nearby traffic or opponents |
| Mid-distance car | 15,000–60,000 | Racing pack, normal gameplay distance |
| Far-distance car | 2,000–15,000 | Silhouette-only rendering |
| Older or performance-constrained mobile car | 10,000–60,000 | Depending on device and camera distance |
| Premium mobile/showcase car | 50,000–150,000 | Often used only for the player vehicle or menu |

These figures count rendered triangles, not necessarily unique vertices. Hard edges, UV seams, material splits and duplicated normals can make the vertex count substantially higher. A mesh with 100,000 triangles might therefore have roughly 60,000–150,000 rendered vertices, depending on topology and attribute discontinuities.

The important variable is not merely “triangles per car.” It is:

\[
\text{total cost} \approx \text{cars visible} \times \text{vertices updated} \times \text{deformation/skin cost}
\]

A 250,000-triangle player car may be reasonable when one car is fully deforming, but not when twenty such cars are being simulated and skinned every frame.

## What is normally geometry?

Developers generally keep these features as geometry when they affect silhouette, shadows, reflections or collision presentation:

- Wheel-arch outer lips
- Bumpers and fenders
- Door, hood and trunk boundaries when they open or separate
- Large grilles and deep air intakes
- Spoilers, mirrors, handles and prominent badges
- Tire sidewalls and wheel spokes
- Headlamp and taillamp housings
- Major panel folds and strongly convex body lines
- Separate crumple zones or detachable body parts

They commonly bake or texture these features when they are shallow or small:

- Fine panel gaps and shut lines
- Small vents and grille perforations
- Badge relief
- Fasteners, rivets and small bolts
- Fine stamped-metal creases
- Subtle bumper grooves
- Carbon-fiber weave and paint texture
- Scratches, dirt, dents and impact masks

A practical rule is: **if the feature must remain visible at the car’s normal gameplay distance, use geometry only when it changes silhouette or produces meaningful parallax/reflection; otherwise bake it.**

Height or parallax maps are useful between those extremes, but their value is limited on a highly reflective, deforming object. They can create view-dependent relief without adding vertices, yet they do not alter the true silhouette, collision shape, reflection environment or shadow casting. They are also more expensive than a plain normal map and are commonly reduced or disabled at lower LODs.

## Deformation changes the optimal topology

A conventional static car can spend geometry on visual smoothness and use a normal map for fine detail. A deformable car needs geometry distributed according to **where it must bend**, not just where it looks smooth in the undamaged state.

That means:

- More edge loops around doors, fenders, bumpers and hood corners
- Vertices placed where dents and folds should form
- Reasonably even surface spacing in likely impact zones
- Separate meshes for parts that must detach, open or receive different damage states
- Avoidance of extremely long, thin triangles that produce spikes or shading artifacts
- Matching or compatible topology between nearby inner and outer panels

BeamNG’s documentation explicitly warns that flexbody density is a balance: too little geometry makes deformation chunky, while too much can produce spikes. It also recommends edge loops and pre-triangulated meshes.[9][10]

The visual mesh does **not** need one physics node per vertex. It needs enough vertices to interpolate the deformation smoothly. A low-resolution physics structure can drive a denser render mesh, but the render mesh cannot recover deformation detail that the physics nodes never describe.

## BeamNG.drive: documented architecture

BeamNG separates the physical structure from the rendered vehicle:

- **Nodes** are mass points.
- **Beams** connect nodes and provide spring, damping, deformation and break behavior.
- **Triangles** can be used for collision and aerodynamic calculations.
- **Flexbodies** are visual meshes mapped to the node structure.[1][3][6][8]

The visual mesh is deformed by mapping each vertex to nearby nodes. BeamNG documents a mapping involving a center node plus nearby \(VX\), \(VY\), and, where possible, \(VZ\) nodes; vertices are then moved according to those node relationships.[7]

This is not ordinary rigid-body skinning driven by a conventional bone hierarchy. It is closer to a deformation field reconstructed from the node/beam structure. BeamNG states that the mesh follows the nodes to which it is bound.[1]

BeamNG’s own modeling guidance says the visual mesh should generally contain **more geometry than the node/beam structure**, so the result remains visually smooth.[2] Its tutorial gives a broad starting point of roughly **three to four nodes across a typical car and similar longitudinal density**, while stressing that density is a balancing act rather than a universal number.[5]

That implies a useful distinction:

- Physics resolution controls where the car can bend, collapse and transfer forces.
- Visual-mesh resolution controls how smoothly those changes appear.
- Texture resolution controls fine surface detail that follows the deformed surface.

A door with only a few structural nodes can bend, but it cannot produce a convincing localized dent in the middle. BeamNG explicitly describes this relationship: a door needs nodes in the relevant area to dent there.[2]

### BeamNG bottleneck

For BeamNG, the bottleneck is not simply render-triangle count. A vehicle can incur costs from:

- Node and beam solving
- Collision and triangle processing
- Updating the deformable visual mesh
- Skinning or deformation of every flexbody vertex
- Rendering the resulting geometry and materials

BeamNG specifically notes that it recalculates vertex positions based on chassis deformation, making polygon density a performance concern in addition to ordinary rendering cost.[10] Thus, high vertex counts are unusually expensive compared with a static car, because the vertices are not merely submitted to the GPU; they must also be updated as the physical structure changes.

## Wreckfest and other soft-body damage systems

Wreckfest is commonly described as using soft-body-style vehicle deformation, but publicly available material does not establish a reliable universal triangle budget or a complete implementation specification for every car and LOD. It should not be assumed to use exactly the same node/beam/flexbody system as BeamNG.

The general design pattern is similar:

- A lower-resolution physical representation controls impact response.
- A higher-resolution render representation displays bending and damage.
- Body sections may use separate damage meshes, material states or detachable components.
- Normal maps provide fine undamaged detail but cannot independently generate the large folds created by deformation.

The larger the expected dents and folds, the more the body must be represented by deformable vertices or a deformation-capable intermediate representation. A dense static mesh with a normal map is not a substitute for deformation resolution.

## Normal maps during deformation

A normal map can remain correct during deformation, but only under the right tangent-space treatment.

For a tangent-space normal map, the sampled normal is defined relative to the surface tangent frame:

- tangent \(T\)
- bitangent \(B\)
- geometric normal \(N\)

The shader transforms the texture-space normal through the current tangent basis. If the tangent, bitangent and normal are updated consistently with the deformed or skinned surface, the normal map “rides” the mesh and continues to describe local detail.

If the system deforms positions but leaves tangents unchanged, several problems can appear:

- Panel detail points in the wrong direction
- Highlights that look detached from the body
- Incorrect shading near sharp dents
- Seams or baked details that no longer align with the changed curvature

For ordinary linear skinning, engines can recompute or transform tangent frames from the same deformation. For non-linear node-based deformation, the implementation may need to recalculate normals and tangents, approximate them from neighboring deformed vertices, or use a deformation-aware basis.

There is no general public evidence that every listed game handles tangent-space detail identically. Therefore the safe statement is:

- **A normal map can remain valid on a deforming mesh if its tangent frame is deformed or rebuilt with the mesh.**
- **A baked normal map does not magically remain physically accurate when the underlying surface undergoes large nonlinear folds.**

Large crash damage is usually handled by changing geometry, deformation state, damage textures, or all three. Normal maps are best treated as local surface detail, not as the primary representation of major crumpling.

## AI cars, LODs and mobile games

AI cars usually receive cheaper treatment in at least one of these ways:

- Lower-resolution body mesh
- Reduced or disabled interior
- Simplified wheels and underbody
- Fewer material layers
- Lower-resolution normal and roughness maps
- Reduced damage simulation
- Shared or pooled deformation resources
- Less frequent updates when distant
- Rigid or pre-authored damage states instead of fully simulated deformation

Mobile games typically move more information into textures and reduce the number of deforming vertices. They may reserve the most detailed model for the player car, menus and replays, while AI cars use cheaper LODs or visually limited damage. This is especially important because mobile devices face both GPU bandwidth limits and CPU limits for simulation and animation.

The exact balance differs sharply between:

- A game with one player car and many distant opponents
- A demolition game with several nearby deforming cars
- A replay/showroom renderer
- A mobile game targeting a broad range of devices

Consequently, “hero car polygon count” is less useful than asking how many vertices are **actively deformed per frame**.

## CPU versus GPU skinning

For a static car, vertex count is primarily a GPU workload: vertex shading, rasterization, bandwidth and overdraw. For a deformable car, the cost can shift toward CPU or compute work:

- Physics runs on the CPU or a physics-oriented subsystem.
- Node positions must be converted into render deformation.
- Vertex positions, normals and tangents may be updated.
- The updated mesh may need to be uploaded or consumed by GPU skinning/compute.
- Collision and damage structures may also be updated.

If deformation is implemented as conventional GPU skinning, CPU vertex cost can be reduced, but the GPU still pays for skinning every vertex, and the physics/deformation data must be supplied. If the mesh is dynamically rewritten on the CPU, CPU time and buffer uploads become more significant.

The practical bottleneck is therefore conditional:

- **Few cars, high-end hardware:** rendering and material complexity may dominate.
- **Many deforming cars:** physics, vertex deformation, skinning and bandwidth can dominate.
- **BeamNG-like simulation:** node/beam physics plus per-vertex flexbody updates are central costs.
- **Mobile:** CPU simulation, GPU bandwidth, shader complexity and thermal limits all matter, so deformation is commonly simplified.

## Bottom line

A reasonable production strategy is:

1. Build enough body geometry for silhouette, reflections and plausible deformation.
2. Put fine seams, vents, badges and stamped detail into normal/roughness textures unless they need real depth or silhouette.
3. Choose physics-node density from the smallest dent or fold that must be simulated, not from the render mesh’s triangle count.
4. Use a denser visual mesh than the physical structure, but avoid excessive vertices because deformable vertices must be updated.
5. Recompute or correctly transform tangent frames as the mesh deforms; otherwise normal-map detail will shade incorrectly.
6. Use aggressive LODs for AI and mobile cars, often reducing both render geometry and the number of actively deforming vertices.
7. Treat quoted polygon budgets as estimates unless the developer has published them; the cited BeamNG documentation describes the deformation architecture and density principles but does not provide a universal “triangles per car” target.[1][2][5][7][9][10]

[1] Final Mesh Splitting - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/vehicle-art/final-mesh-splitting/)
[2] Modeling cars for this game. | BeamNG (https://www.beamng.com/threads/modeling-cars-for-this-game.506/)
[3] Beams - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/beams/)
[4] Jbeam Tips and Tricks - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/jbeamtips/)
[5] Basic Car Tutorial - Autobello Kit Car - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/tutorials/basic_car_tutorial/)
[6] Soft-body Physics - BeamNG.drive (https://www.beamng.com/game/about/physics/)
[7] Flexbodies - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/flexbodies/)
[8] JBeam file sections - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/)
[9] Modeling - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/vehicle-art/modeling/)
[10] Vehicle Modeling Guidelines - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/vehicle_modeling/)
