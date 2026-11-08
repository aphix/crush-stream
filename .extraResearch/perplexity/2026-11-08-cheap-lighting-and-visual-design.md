> Question: List a handful of tips on lighting placement at night in games like Need for Speed Heat for enhancing the effect and feel with cheap lighting, effectively making a better experience very cheaply. On that same note, do you have tips for interesting visual design in those games, in the daytime and overall, in terms of wide-pass, low-complexity (and lower computational cost) ways to enhance the scenes? Pseudocode codemods or deterministic prop placement from map design type stuff would be greatly helpful; go into detail.

Cheap lighting works best when it creates **rhythm, contrast, and readable silhouettes**, rather than trying to illuminate everything. *Need for Speed Heat* is a useful reference: its night identity comes from vibrant neon, headlights, reflections, rain, and strong color contrast—not merely from having many lights.[2][4][5]

## Low-cost nighttime lighting

- **Use emissive surfaces before dynamic lights.** Give storefronts, signs, billboards, windows, vending machines, and underpasses bright emissive materials. They suggest illumination at almost no per-frame lighting cost. Add only a few actual lights where the player can see the effect.

- **Reserve dynamic shadows for hero lights.** Headlights, police spotlights, a major gas station sign, or a tunnel entrance deserve real-time shadows. Most decorative lamps can use baked lighting, lightmaps, or shadowless lights. Baked lights avoid per-frame lighting and shadow calculations, while real-time lights become expensive as their overlap and shadow complexity increase.[1][3][6]

- **Light the road edge, not the whole road.** A narrow pool of light on a curb, barrier, palm trunk, or wet shoulder gives speed and direction. Alternating pools—bright, dark, bright, dark—create a stronger sense of motion than uniform illumination.

- **Place lights where they explain themselves.** Hide fixtures under awnings, behind signs, inside shop windows, beneath bridges, or near garage doors. A visible source paired with a nearby illuminated surface makes even a small light feel intentional.

- **Use a three-layer hierarchy.**
  - **Primary:** headlights, streetlights, police lights, major signs.
  - **Secondary:** shop windows, parking-lot lamps, tunnel strips.
  - **Tertiary:** tiny emissive dots, distant windows, decorative LEDs.
  
  The first layer should control navigation; the second establishes location; the third supplies texture.

- **Choose a restrained color grammar.** For example:
  - Cyan or blue for public infrastructure and wet asphalt.
  - Magenta or red for nightlife, danger, and competition.
  - Warm amber for safe areas, shops, and service stations.
  - Green only for selected industrial or directional accents.
  
  Avoid assigning every color everywhere. Repetition makes a district recognizable.

- **Create local color zones.** Let a block, tunnel, bridge, or venue own a color combination. The player should be able to identify a district from a few seconds of peripheral vision.

- **Use negative space.** A dark service road between two bright areas creates anticipation. Darkness is particularly effective before a landmark, jump, sharp corner, or police encounter.

- **Fake reflections cheaply.** Use wetness, roughness variation, and a few broad reflection cards or planar reflection zones near hero locations. A fully reflective world is expensive and visually noisy; a few deliberate reflected signs can sell the entire street.

- **Place light sources ahead of the player.** Lighting behind the vehicle mainly reveals the car. Lighting 30–100 meters ahead helps communicate the route, upcoming hazards, and speed.

- **Use silhouettes at intersections.** Backlight palms, cranes, bridge trusses, signs, and buildings against a brighter sky or district glow. Large silhouettes are cheap and readable at high speed.

- **Avoid excessive volumetric fog.** A small amount of height fog or localized haze can reveal beams and separate depth, but dense global fog often costs more and flattens the scene. Use it mainly around headlights, tunnels, rain, and humid waterfront areas.

- **Treat rain as a multiplier, not a requirement.** Wet roads and rain make lighting effects visible, but the scene should still work in dry conditions. Build the composition first, then use weather to amplify contrast and reflections.

## Daytime design with low complexity

Daytime scenes need shape, color, and composition because emissive lighting is no longer doing all the work.

- **Design in large value masses.** Divide each view into:
  - Sky and distant background.
  - Large midground structures.
  - Road and immediate foreground.
  
  Ensure these layers differ in brightness or saturation. A detailed scene with identical values often reads worse than a simple scene with clear separation.

- **Use landmark chains.** Every 10–20 seconds of driving, provide one of:
  - A distinctive tower or bridge.
  - A large billboard.
  - A skyline opening.
  - A color-coded building cluster.
  - A terrain change.
  
  This helps orientation without requiring a minimap to do all the work.

- **Frame the next event.** Put trees, walls, signs, bridge supports, or building edges along the sides of the camera view so they act as a visual frame. Leave the route or upcoming landmark open in the center.

- **Use one strong foreground prop.** A close palm, barrier, sign, parked truck, or light pole moving rapidly across the screen creates parallax. It often contributes more to perceived speed than adding distant geometry.

- **Build modular “facades,” not complete buildings.** For high-speed roads, use:
  - Simple massing meshes.
  - Repeated window textures.
  - Roofline silhouettes.
  - A few unique entrances or corners.
  
  Spend geometry where the player can approach, stop, or crash.

- **Vary repetition at the silhouette level.** Repeated assets become less obvious when their height, rotation, spacing, and top profile vary. Three simple warehouse modules can look like ten different buildings if their roof parapets, signs, loading bays, and paint bands differ.

- **Use texture and material changes as cheap zoning.** A road can feel different because of:
  - Asphalt color.
  - Curb style.
  - Lane-marking density.
  - Wall paint.
  - Vegetation type.
  - Signage language or color.
  
  These changes are often cheaper than unique meshes.

- **Reserve detail for decision points.** Add extra geometry near:
  - Intersections.
  - Jumps.
  - Race starts and finishes.
  - Garages.
  - Police roadblocks.
  - Scenic overlooks.
  
  Long, high-speed stretches can rely on silhouettes and repetition.

- **Use atmospheric perspective aggressively.** Desaturate and reduce contrast with distance. This hides low-detail assets, improves depth, and keeps the foreground visually important.

- **Create designed emptiness.** Empty parking lots, drainage channels, industrial setbacks, and undeveloped parcels can provide contrast between dense areas. Fill them with one strong idea rather than dozens of unrelated props.

## Deterministic prop placement

A useful system separates **authoring rules** from **randomness**. The seed should be stable, so changing one asset does not reshuffle the entire map.

```pseudo
function scatter_zone(zone, global_seed):
    seed = hash(global_seed, zone.id, zone.version)

    for cell in grid(zone.bounds, zone.cell_size):
        if not inside(zone.allowed_area, cell.center):
            continue

        if overlaps_road(cell, zone.road_buffer):
            continue

        if near_intersection(cell, zone.intersection_clearance):
            continue

        local_seed = hash(seed, cell.x, cell.y)

        category = weighted_choice(
            local_seed,
            [
                ("palm",   zone.palm_weight),
                ("lamp",   zone.lamp_weight),
                ("barrier", zone.barrier_weight),
                ("dumpster", zone.dumpster_weight),
                ("sign",   zone.sign_weight)
            ]
        )

        asset = choose_variant(category, local_seed)

        position = jitter(
            cell.center,
            hash(local_seed, "position"),
            zone.position_jitter
        )

        rotation = aligned_rotation(
            zone.edge_direction,
            hash(local_seed, "rotation"),
            zone.rotation_limit
        )

        scale = range_value(
            asset.min_scale,
            asset.max_scale,
            hash(local_seed, "scale")
        )

        if violates_spacing(position, asset.radius, placed_objects):
            continue

        if blocks_sightline(position, zone.protected_sightlines):
            continue

        if not passes_density_budget(asset, cell):
            continue

        place(asset, position, rotation, scale)
        placed_objects.add(asset)
```

### Important rules

- **Use stable hashes, not global random state.** A hash of `map_id + zone_id + cell_id + asset_category` gives repeatable results. Artists can regenerate one district without changing unrelated districts.

- **Partition the map into zones.** Useful zones include:
  - Downtown.
  - Waterfront.
  - Industrial.
  - Residential.
  - Highway.
  - Construction.
  - Race venue.
  
  Each zone can define asset weights, colors, density, allowed surfaces, and lighting behavior.

- **Use exclusion buffers.** Keep props away from:
  - Drivable surfaces.
  - Racing lines.
  - Camera cuts.
  - Emergency escape routes.
  - Intersections.
  - Navigation-critical signs.
  
  A simple distance field or signed distance map is usually enough.

- **Use blue-noise or Poisson-style spacing.** Pure random placement produces clumps and gaps. Minimum-distance placement gives more natural distribution at low complexity.

```pseudo
function poisson_place(candidates, min_distance, seed):
    shuffle_deterministically(candidates, seed)
    accepted = []

    for p in candidates:
        if all(distance(p, q) >= min_distance for q in accepted):
            accepted.append(p)

    return accepted
```

- **Use edge-aware placement.** Props should understand sidewalks, walls, curbs, and medians. Sample a surface normal and align objects to it, but clamp tilt so signs and lamps remain believable.

```pseudo
function place_on_edge(point, surface):
    normal = surface.normal(point)
    tangent = normalize(cross(world_up, normal))

    rotation = look_rotation(tangent, world_up)
    rotation = clamp_tilt(rotation, max_tilt = 4 degrees)

    return transform(point, rotation)
```

- **Use gradients instead of hard boundaries.** Rather than switching from “urban” to “industrial” abruptly, interpolate weights according to distance from a zone center.

```pseudo
t = smoothstep(0, blend_width, distance_to_zone_center)
industrial_weight = lerp(old_weight, new_weight, t)
```

- **Author “must-have” objects separately.** Procedural dressing should never decide the location of:
  - Route arrows.
  - Major landmarks.
  - Race barriers.
  - Police ambush props.
  - Tutorial signage.
  - Critical collision blockers.
  
  Place these manually, then let procedural systems fill around them.

## Codemods for a wide visual pass

A broad pass can improve a map without remodeling it.

### 1. District color pass

```pseudo
for district in map.districts:
    palette = district.palette

    for material in district.materials:
        material.base_color = remap_hsv(
            material.base_color,
            hue_range = palette.hue_range,
            saturation_scale = palette.saturation,
            value_scale = palette.value
        )

    for sign in district.signs:
        sign.emissive_color = choose_palette_color(
            hash(district.id, sign.id),
            palette.neon_colors
        )
```

Use this to make industrial areas dusty amber, waterfront areas cyan-blue, and entertainment areas magenta or red without replacing assets.

### 2. Roadside rhythm pass

```pseudo
for segment in road.segments:
    interval = choose_interval(
        segment.type,
        highway = 40m,
        urban = 18m,
        tunnel = 8m
    )

    for distance in range(0, segment.length, interval):
        side = alternate_left_right(distance)
        prop = choose_prop(segment.theme, hash(segment.id, distance))

        place(
            prop,
            road.edge_position(distance, side),
            rotation = road.tangent_rotation(distance)
        )
```

Vary the interval slightly, but preserve a recognizable rhythm. Lamps, palms, barriers, and signs should not all repeat at the same frequency.

### 3. Landmark reveal pass

```pseudo
for landmark in important_landmarks:
    approaches = find_approach_routes(landmark)

    for route in approaches:
        for point in sample_route(route, every = 30m):
            if line_of_sight(point, landmark):
                keep_view_open(point, radius = 12m)
                add_frame_props(point, landmark)
                add_low_intensity_guidance_light(point)
```

This prevents procedural clutter from hiding important visual anchors and adds framing elements that direct attention naturally.

### 4. Low-cost night conversion

```pseudo
for emissive_surface in map.emissive_surfaces:
    emissive_surface.intensity = district_night_multiplier(
        emissive_surface.district
    )

for light in map.lights:
    if light.is_decorative and not light.is_hero:
        light.shadow_mode = NONE
        light.runtime_mode = BAKED
        light.range = min(light.range, 18m)

for hero in map.hero_lights:
    hero.shadow_mode = REALTIME
    hero.shadow_distance = 35m
```

Baked lighting and constrained light influence are standard ways to reduce runtime cost; culling masks, low-resolution cubemaps, and selective shadow casting further limit the cost of complex scenes.[1][3]

## Performance-minded scene rules

- Prefer one atlas material over many unique materials.
- Instance repeated meshes rather than duplicating them.
- Use impostors or billboard clusters for distant windows, palms, and skyline buildings.
- Cull decorative lights by district, distance, and camera direction.
- Keep shadow-casting lights sparse.
- Use lower-resolution reflection probes for secondary areas.
- Disable expensive effects outside the player’s immediate view.
- Group lights by purpose so they can be toggled as a set.
- Avoid overlapping many lights with large radii.
- Use baked indirect lighting for static architecture and reserve real-time lighting for moving vehicles and hero effects.
- Test from the actual racing camera, not only from an editor viewport.

The central principle is to spend computation where the player notices **movement, route readability, reflections, and silhouettes**. Spend art effort where the vehicle slows down or the camera lingers; use color, emissive materials, repetition, atmospheric depth, and stable procedural dressing everywhere else.

[1] Choosing and configuring a render pipeline and lighting ... (https://docs.unity3d.com/2023.2/Documentation/Manual/BestPracticeLightingPipelines.html)
[2] Need for Speed Heat Review: Hot in the City (https://www.gtplanet.net/need-for-speed-heat-review/)
[3] Performance optimization for high-end graphics on PC and ... (https://unity.com/how-to/performance-optimization-high-end-graphics)
[4] Need For Speed Heat Feels Like the Dying Light of Racing Games (https://in.ign.com/need-for-speed-heat/140525/need-for-speed-heat-feels-like-the-dying-light-of-racing-games)
[5] Need for Speed Heat Review | New Game Network (https://www.newgamenetwork.com/article/2237/need-for-speed-heat-review/)
[6] Light Modes • Unity Editor • Unity Docs (https://docs.unity.com/en-us/engine/7000.0/manual/lighting-overview/lighting-light-sources/components/configuring/light-modes/introduction)
[7] Lighting Mode • Configuring Mixed lights with Lighting Modes • 6000.3 • Unity Editor (https://docs.unity.com/en-us/engine/6000.3/manual/lighting-overview/lighting-light-sources/components/configuring/lighting-mode/lighting-mode)
[8] Lighting strategy - Unity - Manual (https://docs.unity3d.com/2019.2/Documentation/Manual/BestPracticeMakingBelievableVisuals3.html)
[9] Building Destructible Environments That Don't Tank Your ... (https://www.strayspark.studio/blog/chaos-destruction-ue5-destructible-environments)
[10] Need for Speed Heat (for PC) Review (https://au.pcmag.com/pc-games/64648/need-for-speed-heat-for-pc)
