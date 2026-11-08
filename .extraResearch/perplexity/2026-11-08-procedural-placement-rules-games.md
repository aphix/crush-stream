> Question: How do open-world and driving games (GTA V, Cities: Skylines, Forza Horizon, Need for Speed, Watch Dogs, Midtown Madness, procedural city tools like CityEngine and Houdini) place street furniture and roadside props procedurally with cheap rules? Give the concrete rule shapes: spline-relative placement with fixed offsets, spacing intervals, seeded jitter, zone/biome weights, intersection and driveway exclusion, clear zones near the road edge, which props are collidable vs decal vs billboard, instancing and draw call budgets, how road decals (manholes, cracks, patches, skid marks, crosswalks) are placed and what artists avoid painting on roads, and level of detail thinning with distance. Cite sources (GDC talks, devblogs, papers) and say what is published versus folklore.

Most games use a **road-relative scatter system**, not a general-purpose urban-planning simulation. The road graph supplies splines, lanes, intersections, sidewalks, and metadata; simple filters then emit props at eligible samples. Published tools and talks document the architecture, but exact production constants for GTA V, Forza Horizon, Need for Speed, Watch Dogs, and Midtown Madness are generally proprietary. The concrete rules below are therefore a mixture of documented practice and well-supported industry inference.

## Core placement rule

Represent each road segment by a centerline spline \(C(s)\), where \(s\) is distance along the road. At each sample:

\[
P(s,d)=C(s)+d\,N(s)+h\,U
\]

- \(d\): signed lateral offset from the road or lane center.
- \(N(s)\): horizontal spline normal.
- \(U\): up vector.
- \(h\): terrain-conforming height.
- Rotation: tangent-aligned, usually with a small asset-specific yaw offset.

Typical rules are:

- Streetlights: one or both sidewalk offsets, every fixed distance \(L\).
- Bollards: repeated at a shorter interval along pedestrian or curb lanes.
- Trees: sidewalk or vegetation-lane offset, with spacing and minimum-size rules.
- Signs: attached to lane or junction metadata rather than freely scattered.
- Hydrants, bins, benches: sidewalk or frontage zones with larger exclusion radii.
- Guardrails, barriers, curbs, fences: generated continuously from the road spline or lane boundary.

A simple interval rule is:

\[
s_i=s_0+iL+\epsilon_i
\]

where \(\epsilon_i\) is seeded jitter. The seed normally comes from a stable road ID plus segment index, so regeneration does not make the city visibly change every build.

The published Houdini road-generation material from Sumo Digital describes this general division: gameplay-relevant objects such as hydrants, signs, and crosswalks are generated first, followed by beautification objects such as trees and trash cans; generators also attach metadata and traffic-network relationships to emitted props.[1] That is strong evidence for the workflow, although it does not reveal the exact formulas used in a particular shipped game.

## Practical rule shapes

### 1. Fixed-offset spline placement

The cheapest and most common rule is:

```text
for each road segment:
    for each side in {left, right}:
        sample spline every spacing meters
        offset by sidewalk_or_curb_distance
        align to tangent
        project onto terrain
        test exclusions
        emit asset
```

Offsets are usually defined by lane type rather than one global number:

```text
vehicle lane
parking lane
curb
sidewalk
vegetation strip
bike lane
building frontage
```

CityEngine’s street tools expose essentially this lane-oriented model: street segments can contain vehicle, parking, buffer, sidewalk, and vegetation lanes, with procedural markings and street furniture such as lights, bollards, and benches.[2] CityEngine can also run CGA rules inside Houdini through rule packages, making this kind of lane-relative generation available in a Houdini workflow.[3]

### 2. Spacing with deterministic variation

Uniform repetition looks artificial, so artists commonly combine:

- nominal spacing;
- a random start phase;
- bounded spacing jitter;
- alternating left/right placement;
- occasional skipped instances;
- asset variants selected from a seeded random stream.

For example:

```text
spacing = 24 m
jitter  = random(seed, i) * 4 m - 2 m
skip    = random(seed, i) < 0.08
scale   = 0.95–1.05
yaw     = ±2 degrees
```

The seed must be stable per road segment, otherwise an edit elsewhere in the city causes unrelated props to move.

### 3. Zone and biome weights

A road usually carries tags such as:

```text
downtown
residential
industrial
suburban
rural
park
coastal
desert
snow
historic
```

Each prop has a weighted eligibility table:

| Zone | Lights | Trees | Bins | Utility poles | Road grime |
|---|---:|---:|---:|---:|---:|
| Downtown | high | low/medium | high | low | medium |
| Residential | medium | high | medium | medium | low |
| Industrial | medium | low | medium | high | high |
| Rural | low | low/medium | low | high | medium |
| Park | low | very high | medium | low | low |

Weights may also depend on road class, traffic volume, climate, wealth, or district style. CityEngine’s CGA system is published as a rule-based procedural system; the exact game-specific weight tables are usually not public.

## Exclusion and clearance tests

A robust generator treats placement as a candidate followed by rejection tests.

### Intersection exclusion

At junctions, suppress ordinary repeated props inside a distance such as:

```text
intersection radius
+ sidewalk corner radius
+ asset clearance radius
```

Then use special junction rules for:

- traffic lights;
- crossing signs;
- stop signs;
- signal-control cabinets;
- corner bollards;
- crosswalks;
- lane arrows;
- curb ramps.

The exclusion shape is often a 2D polygon or capsule around the junction rather than a simple circle. It can be derived from the intersection node, connected lane widths, turning radii, and visibility triangles.

### Driveway and entrance exclusion

Roadside props are rejected near:

- driveways;
- garage mouths;
- loading bays;
- pedestrian crossings;
- bus stops;
- fire access routes;
- bridge approaches;
- tunnel portals;
- service roads;
- building entrances.

Driveways are commonly represented as tagged road-edge intervals. A candidate whose projected \(s\) falls within the interval plus a margin is discarded.

### Road-edge clear zones

A clear-zone test prevents poles, trees, benches, and signs from intruding into the usable road or emergency recovery area:

```text
distance to drivable surface > minimum_clearance
distance to curb > asset-specific offset
distance to lane boundary > safety margin
```

Large objects normally get larger clearance radii. A tree may require a broad root and canopy clearance; a signpost may need only a narrow base clearance. Some systems use swept-volume tests against the road mesh, not merely a center-point offset.

### Collision and overlap tests

Cheap generators usually test a low-resolution footprint:

- 2D bounding circle or rectangle;
- oriented bounding box;
- cached occupancy mask;
- spatial hash or grid lookup.

Full mesh collision is generally reserved for validation or hero locations. Candidate rejection can be ordered cheaply:

1. wrong zone or lane type;
2. outside road-side interval;
3. intersection/driveway exclusion;
4. occupancy-grid overlap;
5. terrain slope or height failure;
6. expensive final validation.

The Sumo Digital material is particularly useful here because it says that automated props can receive actor tags and metadata describing their relationship to the traffic network.[1] That supports downstream filtering and gameplay integration, although it does not establish a universal collision algorithm.

## Collidable versus visual-only props

A practical three-tier classification is:

### Gameplay or physically collidable

Use real collision for objects that:

- block vehicles or pedestrians;
- can be struck;
- define navigation;
- support interaction;
- affect traffic visibility or routing.

Examples include:

- concrete barriers;
- guardrails;
- lamp posts when destructible;
- hydrants when gameplay-relevant;
- traffic lights;
- bollards;
- large signs;
- fences;
- bridge parapets.

These may use simplified collision meshes, capsules, or vehicle-specific hit volumes rather than rendering geometry.

### Query-only or low-cost collision

Some props need to be detectable but need not participate in detailed physics:

- curb edges;
- signposts;
- thin poles;
- shallow barriers;
- navigation obstacles.

They may use trigger volumes, raycast proxies, or a shared simplified collision layer.

### Visual-only

Use no collision for:

- litter;
- cracks;
- stains;
- small debris;
- distant trees;
- painted road markings;
- grime;
- small decals;
- repeated façade details.

A common production compromise is to make a few representative objects collidable and leave the rest as visual dressing. The result preserves gameplay readability without turning every bin, cone, and sign into a physics object.

## Decals and road-surface wear

Road markings and wear are usually generated in several layers.

### Structured markings

These are deterministic from road and lane metadata:

- lane dividers;
- arrows;
- stop lines;
- crosswalks;
- parking bays;
- bus markings;
- turn restrictions;
- edge lines.

Crosswalks and stop lines should be created from intersection topology and lane direction, not from random scattering. Their orientation, width, and position depend on the crossing connection between sidewalk nodes and vehicle lanes.

### Repeated utility details

Manholes, drain grates, reflectors, and utility covers are typically placed along lanes or curb lines:

```text
sample road spline or lane spline
apply a repeat interval
avoid junctions, crossings, and patch regions
align to road tangent
project slightly above the road surface
```

Some are mesh decals; others are shallow geometry to avoid z-fighting and to produce reliable highlights.

### Stochastic wear

Cracks, patches, stains, tire marks, and skid marks use seeded random placement constrained by masks:

```text
candidate position = road surface sample
accept if:
    road material is eligible
    not inside marking exclusion
    not too close to curb
    not inside intersection special mask
    slope and curvature are acceptable
```

Useful masks include:

- lane mask;
- shoulder mask;
- wheel-track mask;
- intersection mask;
- wetness or climate mask;
- repair-history mask;
- traffic-intensity mask.

Skid marks should be tied to vehicle events when they represent actual gameplay. Background skid marks can be spline-shaped baked decals with randomized length, curvature, opacity, and fade.

### What artists avoid painting on roads

Artists generally avoid unconstrained random road painting because it produces obvious procedural errors. Common exclusions include:

- lane markings and arrows;
- crosswalks and stop lines;
- manholes and drains;
- curbs and gutters;
- intersections;
- bridges and expansion joints;
- tunnel entrances;
- fresh asphalt patches;
- visible texture seams;
- areas with steep curvature;
- road edges where decals would spill onto sidewalks;
- locations where decals would overlap too densely.

They also avoid excessive contrast, long straight crack distributions, identical rotations, and decals that remain equally visible at every distance. Road wear must preserve the semantic readability of traffic markings.

The Sumo Digital description explicitly states that road meshes are refined with mesh decals and vertex colors for wear and tear, while props are then scattered beside the roads.[1] That confirms the broad layering approach, not a universal list of forbidden masks.

## Instancing and draw-call budgets

Repeated roadside objects should almost never be emitted as unique renderable meshes.

Typical optimization layers are:

- GPU or hardware instancing for identical meshes;
- shared materials and atlases;
- merged static batches by cell;
- hierarchical instanced static meshes;
- impostors or billboard clusters;
- baked decals or road material masks;
- streaming cells keyed to player position;
- separate collision proxies;
- visibility and distance culling.

The economical representation is:

```text
asset ID
transform
variant ID
color/scale seed
LOD policy
collision flag
```

rather than a unique mesh and material per object.

Published procedural-environment guidance recommends shared geometry and instancing for repeated pieces and separating near, middle, and far layers so distant props do not consume the same rendering cost as hero objects.[4] Commercial road-generation tooling likewise advertises instanced static meshes and LOD-based optimization for large roadside scenes.[5]

There is no single “correct” draw-call budget. It depends on platform, renderer, occlusion system, material count, shadow settings, and whether instances are batched by cell. Production budgets are usually expressed as frame-time targets and per-cell limits rather than a public fixed number. Exact budgets for the named games are not generally published.

## Distance thinning and LOD

A common hierarchy is:

### Near

- full mesh;
- collision where needed;
- shadows;
- decals and small clutter;
- unique variants;
- high-frequency road detail.

### Middle

- simplified mesh;
- reduced collision;
- fewer shadows;
- merged or instanced batches;
- lower-resolution decals;
- fewer small props.

### Far

- billboard, impostor, or low-poly replacement;
- no physics;
- no individual litter;
- sparse trees and poles;
- road wear baked into terrain or material;
- only major silhouettes retained.

Thinning is usually distance- and importance-weighted rather than a single hard cutoff:

```text
keep_probability =
    base_density
    × zone_weight
    × asset_importance
    × distance_fade
```

A streetlight may remain visible farther than a trash bin because it affects the skyline and road readability. A manhole may disappear early, while a crosswalk remains because it is semantically important.

To avoid popping, systems use:

- hysteresis between LOD thresholds;
- cross-fades;
- clustered replacement assets;
- density-preserving thinning;
- deterministic selection so the same objects disappear consistently.

The procedural-modeling reference specifically describes LOD variants, instancing, and hysteresis for distance transitions.[4] The existence of LODs in game-ready street-asset workflows is also documented in commercial asset tooling, though that is weaker evidence than an engine or developer post.[6]

## What is known for the named games

| System | Publicly established | Not publicly established |
|---|---|---|
| **GTA V** | Large streamed open world, extensive road dressing, traffic and world systems are evident in released material and technical discussions. | Exact prop-generation formulas, seeds, exclusion radii, collision categories, and per-cell budgets. |
| **Forza Horizon** | Large roads and environments use strong modularity, streaming, instancing, and LOD principles typical of open-world racing games. | Exact roadside scatter rules and decal masks for each title. |
| **Need for Speed** | Roadside assets and markings are heavily authored around driving readability and racing routes. | Exact procedural-versus-manual split and runtime budgets. |
| **Watch Dogs** | Dense urban dressing requires road-network metadata, streaming, culling, and interaction-aware collision selection. | Exact placement grammar and city-generation implementation. |
| **Midtown Madness** | An older streamed driving-game design with comparatively simpler geometry and collision needs. | Public technical detail sufficient to reconstruct its prop scatter implementation. |
| **CityEngine** | CGA rules, lane/segment structures, procedural street furniture, and Houdini integration are publicly documented.[2][3] | Whether any particular game used CityEngine output directly, and the game’s runtime placement rules. |
| **Houdini** | Spline HDAs, road generators, metadata, decals, scatter rules, and manual/procedural hybrid workflows are publicly documented in developer material.[1] | Proprietary studio-specific constants and shipped-game implementations. |

## Published practice versus folklore

**Well published:**

- Lane- and spline-relative road construction.
- Rule-based generation in CityEngine/CGA.
- Houdini road HDAs and procedural scatter.
- Gameplay-first placement followed by beautification.
- Decals and vertex colors for road wear.
- Instancing, batching, LODs, and distance-based thinning.
- Metadata connecting props to traffic or road networks.[1][2][3][4][5]

**Strong industry practice but not universal:**

- Stable per-segment random seeds.
- Fixed interval plus bounded jitter.
- Occupancy grids and clearance polygons.
- Zone/biome-weighted asset tables.
- Separate gameplay, visual, and billboard representations.
- Special intersection and driveway exclusion masks.

**Folklore unless backed by a specific developer source:**

- Exact GTA V or Forza prop spacing values.
- Claims that every roadside object is generated by one universal spline rule.
- Specific draw-call numbers for the named games.
- Assertions that all road decals use runtime projection.
- Exact collision policies for individual props.
- Claims that one middleware package explains a shipped game’s complete world-generation pipeline.

The most realistic model is therefore a **hybrid**: roads, lanes, curbs, markings, barriers, and many repeated props are generated from structured splines and metadata; important junctions, hero streets, gameplay objects, and visual exceptions are hand-authored; the final scene is aggressively instanced, culled, LOD-thinned, and streamed.

### Sources:

[1] Sumo Digital developer post describing Houdini spline road generation, decals, vertex colors, traffic-linked metadata, and gameplay-first roadside props.  
[2] CityEngine Street Designer documentation/reporting describing lane types and procedural street furniture.  
[3] Esri CityEngine for Houdini documentation describing CGA rule packages executed in Houdini.  
[4] Procedural modeling reference describing shared geometry, instancing, layered prop density, LODs, and hysteresis.  
[5] Road-generation tooling documentation describing instanced static meshes and LOD optimization.  
[6] Game-ready street-asset documentation describing collision separation and LOD assets.

[1] Procedural City Generator 1.2.1 Buildings and Roads Prop Guide (https://www.youtube.com/watch?v=W7XvIjL0c_c&xstg=CAMSBhUDzO3xHw==)
[2] Esri releases CityEngine 2025.1 | CG Channel (https://www.cgchannel.com/2025/12/esri-releases-cityengine-2025/)
[3] ArcGIS CityEngine for Houdini - Plugin for Houdini (https://esri.github.io/cityengine/houdini)
[4] threejs-game-studio/references/procedural-modeling.md at ... (https://github.com/chrislaupama/threejs-game-studio/blob/main/references/procedural-modeling.md)
[5] Complete Urban Street Props - Bundle (https://www.fab.com/bundles/058dcb16-a5c2-4a07-a231-a2f841fa9256)
[6] Road Creator Pro - Unreal Engine Free Download | 3DCGHUB (https://3dcghub.com/road-creator-pro/)
[7] procedural - DIGITAL PRODUCTION (https://digitalproduction.com/tag/procedural/)
[8] Untitled (https://store.steampowered.com/news/posts/?feed=steam_community_announcements&enddate=1643637899)
[9] CityEngine 2025.0: Street Designer Arrives, Perpetual ... (https://digitalproduction.com/2025/07/01/cityengine-2025-0-street-designer-arrives-perpetual-licensing-leaves/)
[10] Interactive City Generator for Game Engines (https://nccastaff.bournemouth.ac.uk/jmacey/MastersProject/MSc21/03/MastersProject_Bui_Alexandra_Kim.pdf)
