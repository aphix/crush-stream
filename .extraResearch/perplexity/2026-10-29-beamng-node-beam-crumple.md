> Question: How does BeamNG.drive's soft-body (node-beam, JBeam) physics produce realistic localized crash damage? Specifically, with documentation/forum/devblog sources: (1) beam parameters beamSpring, beamDamp, beamDeform, beamStrength, deformLimit, deformLimitExpansion, deformationTriggerRatio, precompression, beamLimitSpring/beamLimitDamp, BOUNDED/SUPPORT/ANISOTROPIC/PRESSURED beam types: what each does physically and typical values used for crumple zones vs chassis frame vs cabin; (2) how a crumple zone is made to absorb energy at a roughly constant force and then hit a much stiffer frame, and how damage is kept local (does a hit to the front corner move the rear bumper nodes, and what limits propagation: damping, deform thresholds, triangle collision, node weights); (3) how BeamNG handles vehicle-vs-vehicle, vehicle-vs-static-world and vehicle-vs-ground with one collision system (node-triangle collision, same for everything?) and whether any special cases exist; (4) how parts detach (breakGroups, wheels/hubs, doors, latches) and the thresholds involved; (5) how a vehicle is held fixed for testing (fixed nodes, 'fixed: true', test rigs) and how that interacts with damage; (6) physics step rate (2000 Hz) and node counts per car. Give concrete numbers where documented.

BeamNG.drive’s damage model is a **mass–spring–damper network**: nodes carry mass, beams connect them, and the vehicle’s visible collision surfaces are generally triangle meshes attached to that deforming structure. A crash becomes localized because force must travel through specific beams and collision contacts, while beams can permanently deform or break when their thresholds are exceeded.

## 1. Beam parameters and physical meaning

Beam values are forces or stiffnesses in SI units: stiffness is generally N/m, damping N·s/m, and deformation/strength thresholds are forces in newtons.[1][2]

| Parameter | Physical function |
|---|---|
| `beamSpring` | Elastic stiffness. It controls the restoring force when a beam is compressed or stretched. High values represent rigid chassis members; lower values represent flexible structures, rubber, or compliant mounts. It does **not** itself create permanent damage.[2] |
| `beamDamp` | Velocity-dependent resistance. It dissipates relative motion between the two nodes and reduces oscillation or rebound. It is not a permanent-deformation threshold. |
| `beamDeform` | Force at which the beam begins permanent deformation. After yielding, it does not simply return to its original length.[2] |
| `beamStrength` | Force at which the beam breaks and ceases to connect its two nodes. `FLT_MAX` makes the beam effectively unbreakable.[2] |
| `deformLimit` | Limits permanent deformation in compression, expressed relative to the beam’s original length.[4] |
| `deformLimitExpansion` | Limits permanent deformation in extension. It is commonly used to prevent beams from stretching excessively after deformation.[4] |
| `deformationTriggerRatio` | Controls how much of the deformation threshold must be reached before deformation-related behavior is triggered. It is useful for tuning when deformation begins or propagates, but it is not a separate energy-storage mechanism. |
| `beamPrecompression` / `precompression` | Sets the beam’s spawned or reference length relative to its geometric node distance. It can preload a beam, change its initial force state, and make a structural member act as if it is already compressed or stretched. The documentation examples commonly use `beamPrecompression: 1`.[1] |
| `beamLimitSpring` | Additional stiffness that activates when a bounded beam reaches its long or short limit.[5] |
| `beamLimitDamp` | Damping applied when a bounded beam reaches its limit; it helps prevent hard-limit oscillation and controls impact behavior at the limit.[5] |

A representative basic-car example uses `beamSpring: 1,201,000`, `beamDamp: 150`, `beamDeform: 50,000`, and an effectively unbreakable beam; the same tutorial also shows `beamDeform: 30,000` for another structural group.[8] These are examples, not universal “correct” values.

### Beam types

- **Normal beams**: ordinary two-node spring/damper/deformation/strength connections.
- **`BOUNDED` beams**: use `beamLongBound` and `beamShortBound`; once a length limit is reached, `beamLimitSpring` and `beamLimitDamp` can add a strong limit response.[5]
- **`SUPPORT` beams**: specialized constraint-like beams used where a connection should provide directional or limit support. Documentation examples use them for steering-limit structures with values such as `beamSpring: 5,001,000`, `beamDamp: 250`, `beamDeform: 150,000`, and `beamStrength: 550,000`.[9]
- **`ANISOTROPIC` beams**: use different properties for compression and extension. Ordinary `beamSpring`/`beamDamp` apply in compression, while `springExpansion`/`dampExpansion` apply when the beam is stretched beyond its spawned length.[10]
- **`PRESSURED` beams**: pressure-like beams are used for structures such as tires or inflated components. Their force is derived from the enclosed or associated geometry and pressure behavior rather than being only a conventional axial spring. They are not normally the main tool for chassis crumple tuning.

There is no authoritative universal table saying, for example, “all crumple beams should be exactly X N/m and all cabin beams exactly Y N/m.” Values depend on node mass, geometry, beam length, triangulation, collision shape, and the desired vehicle scale. The documented examples show that ordinary vehicle files use values ranging from low thousands for compliant or fragile structures to millions for rigid structural members.[1][5][8][10]

## 2. Making a crumple zone absorb energy and stop at the frame

A simplified crumple-zone design uses three progressively different behaviors:

1. **Elastic compliance**: lower `beamSpring` lets the nose move and store/release some elastic energy.
2. **Controlled yielding**: a chosen `beamDeform` makes the nose permanently shorten once its force threshold is exceeded.
3. **Hard structural transition**: much higher `beamSpring`, `beamDeform`, and usually `beamStrength` in the frame rails, bulkhead, and cabin make those members substantially harder to deform or break.

The result is not a literal ideal constant-force absorber. A roughly constant-force crush response is approximated by distributing many beams and nodes through the crumple zone, giving them similar yield thresholds and arranging them so that successive members deform as the nose shortens. The force is then governed by the combined active beams, node masses, geometry, damping, and collision contact. A sharp increase in stiffness at the bulkhead or frame gives the “crumple zone first, cabin later” behavior.

`deformLimit` and `deformLimitExpansion` prevent the sacrificial beams from shortening or stretching without bound. Limit beams can supply a final stiffening response through `beamLimitSpring` and `beamLimitDamp`.[4][5]

### Why damage remains localized

A front-corner hit does not automatically translate every rear bumper node by the same amount. The rear can move, but only through transmitted impulses and structural paths:

- Force travels through connected beams and collision contacts.
- Beam stiffness and damping determine how quickly and strongly motion is transmitted.
- Permanent deformation consumes available deformation in the directly loaded members.
- `beamStrength` allows overloaded links to break, disconnecting parts.
- `deformLimit` and expansion limits stop unlimited structural distortion.
- Triangle collision creates contact at the locally intersecting surfaces rather than applying a global force to the entire vehicle.
- Node masses and local triangulation determine inertia and load paths.

Thus a corner impact may deform the corner, bumper mount, fender, front rail, and nearby suspension first. If the impact is severe enough, the resulting impulse can propagate through the rails, floor, or cabin and eventually move rear nodes, but rear motion is a consequence of structural transmission—not an automatic whole-car deformation operation.

The model is also not equivalent to a finite-element continuum solver. Beam layout is a deliberately simplified structural approximation, so two parts with similar real-world construction can behave differently if their JBeam topology, masses, collision triangles, or thresholds differ.

## 3. Vehicle, static-world, and ground collisions

BeamNG uses the same broad soft-body concept for impact response: deformable vehicle nodes and beams respond to collision contacts. The vehicle’s collision geometry is represented through node/triangle structures, so contact is localized to the triangles and nodes involved rather than being a special “front crash” event.

The practical distinction is the other object:

- **Vehicle vs. vehicle**: both soft bodies can deform and exchange momentum.
- **Vehicle vs. static world**: the world object does not deform like a vehicle, so the vehicle absorbs most of the deformation.
- **Vehicle vs. ground**: terrain or road collision supplies contact forces; the vehicle’s tires, suspension, underbody, and body nodes respond through their own structures.

The same collision framework does not imply identical behavior in every case. Static scenery, terrain, tires, wheels, triggers, and special gameplay objects can use different collision representations or filtering rules. The available documentation results do not establish that every world surface is literally represented by the same deformable node-triangle structure as a vehicle, nor do they provide a complete list of all special cases. It is safer to describe the system as a common collision/contact pipeline with different object types and collision geometries, rather than claim that “everything is exactly the same.”

## 4. Detachment and breakage

The basic detachment mechanism is beam failure:

- Set the connecting beams’ `beamStrength` below the loads expected during the desired event.
- When the force exceeds that value, the beam breaks and no longer connects its nodes.[2]
- Use `FLT_MAX` where a connection should not break.[2]

A bumper, for example, can be made detachable by using relatively weak beams between the bumper structure and the chassis.[2] The detached part may still contain intact internal beams and therefore remain a coherent object after separating from the main body.

`breakGroups` provide a higher-level grouping mechanism for coordinated breakage. Parts such as doors, hoods, bumpers, and other assemblies can use break-group logic so that a break event disables or separates a defined set of connections rather than relying only on one beam.

Wheels and hubs commonly involve several independent mechanisms: wheel-hub beams can break, suspension links can fail, and wheel/axle or attachment constraints can be configured separately. Doors can detach through hinge, latch, and attachment beams. A latch is generally modeled as a deliberately weak connection: its effective threshold is the relevant beam strength or specialized latch setting, not one universal vehicle-wide number.

The important threshold distinction is:

- `beamDeform`: permanent bending/yielding.
- `beamStrength`: complete beam failure.
- Break-group or latch thresholds: higher-level rules that can cause multiple connections or a component attachment to release.

The cited documentation gives concrete example thresholds—such as `beamDeform: 30,000–50,000 N` in the tutorial and `beamStrength: 550,000 N` in the support-beam example—but these are component-specific examples, not standard detachment thresholds.[8][9]

## 5. Fixing a vehicle for tests

A test vehicle can be held in place by fixing selected nodes. In JBeam, a node may be marked with a fixed property such as `"fixed": true`, or a test rig can constrain selected nodes externally. Fixed nodes remove or greatly restrict the corresponding translational degrees of freedom, allowing controlled tests such as compressing a bumper into a barrier or loading one structural section.

This does **not** make the whole vehicle immune to damage. Other nodes and beams can still deform, and beams connected to fixed nodes can accumulate force, permanently deform, or break. However, fixing nodes changes the boundary conditions substantially: it can create unrealistically high reactions near the fixture and send loads through paths that would not occur in a freely moving vehicle. A fixed-node crash test therefore measures the JBeam structure under a constrained load case, not necessarily a real-world crash.

## 6. Physics rate and node counts

BeamNG is widely associated with a physics update rate of approximately **2,000 Hz**, but the search results available here do not provide a current official documentation citation confirming that number.

Likewise, there is no single documented node count “per car.” Node counts vary with:

- vehicle complexity and detail level,
- body and chassis topology,
- suspension and steering,
- wheels and tires,
- interior and props,
- deformable collision surfaces,
- special mechanisms and detachable parts.

A simple mod vehicle may use far fewer nodes than a detailed official vehicle. Node count should therefore be obtained from the specific JBeam files or vehicle debug tools rather than treated as a fixed engine constant.

## Bottom line

Localized damage comes from the combination of **local triangle contact**, **mass-carrying nodes**, **beam stiffness and damping**, **permanent deformation thresholds**, **deformation limits**, and **breakable connections**. A convincing crumple zone is built by giving the nose a distributed set of lower-yield beams and the cabin/frame a much higher structural resistance; it is not produced by a single “crumple zone” parameter. The official documentation explicitly defines stiffness, deformation, strength, limits, bounded beams, support beams, and anisotropic beams, while exact crumple-zone recipes, universal detachment thresholds, a universal node count, and a complete list of collision special cases are not specified as single fixed values.[1][2][4][5][8][9][10]

[1] JBeam Syntax - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/jbeamsyntax/)
[2] Introduction to JBeam - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/)
[3] Debug Tools - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/debugtools/)
[4] Beams - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/beams/)
[5] documentation.beamng.com · sections · beamsBounded Beams - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/beams/bounded/)
[6] Camera - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/camera/)
[7] The part/slot system - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/partslotsystem/)
[8] Basic Car Tutorial - Autobello Kit Car (https://documentation.beamng.com/modding/vehicle/tutorials/basic_car_tutorial/)
[9] documentation.beamng.com · sections · beamsSupport Beams - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/beams/support/)
[10] documentation.beamng.com · beams · anisotropicAnisotropic Beams - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/beams/anisotropic/)
