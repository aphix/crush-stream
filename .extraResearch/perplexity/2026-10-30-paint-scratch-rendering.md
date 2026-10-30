> Question: How do real-time car games render paint scratches and scrapes from cars sliding against each other or walls (Wreckfest, BeamNG.drive, Burnout Paradise, GRID, Forza), in a way that would fit a WebGL2 three.js game with soft-body (vertex-deformed) car meshes and mobile performance limits? Concretely: (1) where the damage is stored: a per-car damage/scratch mask texture in the body's UV space painted at the contact point (resolution used, e.g. 256-1024 px), per-vertex attributes, decals, or triplanar/world-projected masks; how the contact point is mapped to texel coordinates (UV lookup via the nearest vertex/triangle, or projecting along the normal); (2) how the shader blends paint into primer and bare metal from that mask (thresholds, a noise or scratch-line texture to break the stroke into thin lines, roughness/metalness changes, normal perturbation), and how stroke width scales with slide depth or force; (3) real paint layer facts to make it believable: clear coat ~30-50 um, base coat ~15-25 um, primer ~20-30 um, e-coat ~20 um over steel; what colours each layer shows (grey/white primer, silver steel) and what a light vs deep scrape looks like; (4) performance tricks: updating the mask with a small GPU draw or CPU DataTexture sub-region update, throttling updates, sharing one atlas across cars. Give concrete numbers and name sources (GDC talks, developer blogs, papers).

Real-time games generally do **not** deform or repaint the whole car mesh at collision time. The practical solution is a persistent **damage mask in the car’s material space**, combined with a few inexpensive decals or procedural effects for high-impact damage.

A good WebGL2 design is:

1. Store damage in a UV-space mask.
2. Paint small regions of that mask when contacts occur.
3. Let the shader convert mask values into clear-coat loss, scratches, primer, and metal.
4. Use vertex deformation separately for dents and bending.
5. Reserve decals or geometry for detached panels, deep gouges, sparks, and debris.

The exact implementations in commercial games are usually proprietary, so the following is a robust approximation rather than a claim about each named title.

## 1. Where to store the damage

### Recommended representation

Use one or more low-resolution textures in the car’s UV space:

| Texture | Suggested format | Purpose |
|---|---:|---|
| Damage severity | `R8` or `R16F` | Accumulated depth/severity |
| Scratch direction or age | `RG8` | Optional anisotropy, variation, repair/fade state |
| Damage normal/height | `R8` | Gouge or chipped-paint relief |
| Damage seed/noise | Procedural or shared texture | Breaks damage into streaks and chips |

For mobile, begin with a **256² or 512² mask per car**. A 1024² mask is useful for a close-up showcase vehicle but is expensive when several cars are visible. A 512² `R8` texture costs only 256 KiB before mipmaps; a 1024² texture costs 1 MiB.

Use a texture atlas when possible—for example, four 512² car regions in one 1024² or 2048² atlas. Each car stores an atlas offset and scale.

### Why UV masks are usually preferable

A UV mask stays attached to a soft-body mesh when vertices move. This is important for a vertex-deformed car: the damage remains on the panel instead of sliding through world space.

Per-vertex damage attributes are generally too coarse for thin scrape lines and become stretched on large triangles. World-space or triplanar masks avoid UV seams but can swim over deforming geometry unless projected damage is converted into a persistent local coordinate. Decals are excellent for a few prominent impacts but are harder to manage for many sliding contacts.

A practical hybrid is:

- **UV mask:** persistent paint loss and scratches.
- **Projected decal:** temporary, sharp scrape mark or dirt streak.
- **Vertex deformation:** dent, panel bend, wheel deformation.
- **Small geometry/decal:** broken parts, deep cuts, exposed edges.

### Mapping a collision to UV coordinates

At the collision point, retain:

- world-space contact position \(p\),
- collision normal \(n\),
- relative tangential velocity \(v_t\),
- impulse or normal force \(J\),
- sliding distance or impact energy.

Transform the contact point into the car’s local space and find the impacted triangle. The most robust method is a **physics/render triangle mapping**:

1. Give each collision triangle an ID or retain the render triangle index.
2. Determine barycentric coordinates \((b_0,b_1,b_2)\) of the hit.
3. Interpolate the triangle’s UVs:

\[
uv=b_0uv_0+b_1uv_1+b_2uv_2
\]

If the physics hull is a simplified mesh, use a nearest-triangle search or a panel lookup table. For a small number of contacts, CPU triangle lookup is adequate. For many contacts, build a spatial grid or BVH over car triangles.

If the contact is reported only in world space, project it along the collision normal onto the rendered surface:

\[
p_{\text{surface}}=p_{\text{contact}}-n\,d
\]

Then find the closest triangle and interpolate UVs. Do not use the nearest vertex alone; it causes visible snapping and poor placement on large triangles.

For UV seams, paint the hit into every nearby UV island whose 3D triangle is within the brush radius. Mirrored UVs need special handling if damage must not appear symmetrically.

### Painting the mask

Represent a scrape as a capsule or swept segment rather than a circular stamp. Its endpoints can be derived from the current and previous contact locations. In UV space:

- center: mapped contact UV,
- direction: projected tangential velocity transformed approximately into UV space,
- length: \(v_t \Delta t\),
- width: force- and depth-dependent,
- opacity: impulse, sliding distance, and material resistance.

For a GPU path, render a small brush quad into an `R8` or `R16F` render target using additive or maximum blending. For a CPU path, modify only the affected rectangle and upload it with a sub-image update. Avoid uploading the complete texture every frame.

## 2. Shader model for paint loss

A single continuous mask is usually enough. Let \(m\in[0,1]\) be accumulated damage severity.

Use thresholds with soft transitions:

```glsl
float clearLoss = smoothstep(0.05, 0.20, m);
float baseLoss  = smoothstep(0.25, 0.55, m);
float metalShow = smoothstep(0.60, 0.90, m);
```

A more believable model separates **coverage** from **depth**:

```glsl
float pattern = texture(uScratchPattern, uv * patternScale).r;
float streak  = smoothstep(0.35, 0.65, pattern);

float clearDamage = smoothstep(0.05, 0.25, damage);
float paintDamage = clearDamage * streak;
float deepDamage  = smoothstep(0.55, 0.90, damage) * streak;
```

Then blend materials approximately as follows:

```glsl
vec3 color = basePaintColor;
color = mix(color, primerColor, deepDamage * 0.55);
color = mix(color, steelColor,  metalShow * 0.75);

float roughness = mix(0.18, 0.42, clearDamage);
roughness = mix(roughness, 0.62, metalShow);

float metalness = mix(0.0, 0.75, metalShow);
```

Typical visual interpretation:

- **Low damage:** clear coat becomes rougher and less glossy; color remains mostly unchanged.
- **Medium damage:** thin pale or grey lines reveal primer beneath the base coat.
- **Deep damage:** irregular silver-grey steel appears, often with dark edge dirt or oxidation.
- **Very deep damage:** use a height mask, dark cavity line, or geometry rather than relying only on color.

Do not make all deep damage metallic. Bare steel is reflective, but the apparent color depends on lighting, oxidation, grime, and the surrounding paint. A cool grey primer and a slightly darker or brighter silver metal generally read better than pure white and pure chrome.

### Scratch-line breakup

A smooth circular brush looks like a sticker. Break it up with:

- a tileable directional scratch texture,
- blue-noise or hash noise,
- a high-frequency chip texture,
- the projected tangential direction.

For a scrape direction \(d\), evaluate elongated coordinates:

```glsl
vec2 q = vec2(dot(localUV, d), dot(localUV, vec2(-d.y, d.x)));
float lines = texture(uDirectionalScratches, q * vec2(80.0, 8.0)).r;
```

Multiply the brush by `lines`, then threshold it. Add a second noise scale to prevent obvious repetition.

### Normal and roughness response

A normal map should not make every scratch look like a deep trench. Use a small height contribution:

```glsl
float h = texture(uDamageHeight, uv).r;
vec3 damageNormal = perturbNormalFromHeight(h, ...);
```

For shallow scuffs:

- clear coat loss: primarily roughness change,
- fine scratches: subtle tangent-space normal perturbation,
- gouges: stronger height and dark edge,
- crushed panel: vertex deformation and a separate broad normal/roughness response.

A useful rule is to make the normal strength proportional to the square root of severity rather than severity itself. This keeps small marks visible without making every scrape geometrically exaggerated.

### Width and opacity from collision data

Let \(F\) be normalized impulse, \(S\) normalized sliding speed, and \(D\) accumulated sliding distance:

\[
w=w_0\left(1+k_FF+k_SS\right)
\]

\[
\alpha=\operatorname{saturate}
\left(c_FF+c_SS+c_DD\right)
\]

Example game-oriented values:

- fine scratch width: 1–3 cm,
- ordinary paint scuff: 3–10 cm,
- heavy wall scrape: 10–25 cm,
- impact chip radius: 1–5 cm,
- deep gouge: usually a separate narrow feature, 0.5–3 cm.

Convert physical width to UV width using the local triangle’s approximate world-to-UV scale. A fixed UV radius will look inconsistent on panels with different texel density.

Use a separate impact term for normal force:

```glsl
float impact = saturate(normalImpulse / impactReference);
float slide  = saturate(tangentialSpeed / slideReference);

float brushOpacity = 0.15 * slide + 0.85 * impact;
float brushWidth   = mix(0.02, 0.12, slide);
```

The constants should be tuned against the car’s scale and collision system rather than treated as universal physical values.

## 3. Believable paint layers

Automotive coating thickness varies by manufacturer, repair history, and production process. Representative factory values are approximately:

| Layer | Typical thickness | What becomes visible when removed |
|---|---:|---|
| Clear coat | 30–50 µm | Loss of gloss; base color remains |
| Base coat | 15–25 µm | Primer or surfacer |
| Primer/surfacer | 20–40 µm | E-coat or substrate |
| E-coat | roughly 18–22 µm | Steel substrate beneath the corrosion barrier |

One industrial coating reference lists clear coat at 35–50 µm, base coat at 10–25 µm, primer at 25–40 µm, and e-coat at 18–22 µm.[1] Other automotive coating references give broader ranges, including base coat around 13–38 µm and clear coat around 38–102 µm, showing why exact numbers should be treated as representative rather than universal.[3] A coating study reported base coat around 20–25 µm and clear coat around 70–100 µm for a particular system.[9]

For rendering, the exact micrometre values do not need to be simulated physically. Use them to define visual stages:

- **Scuff:** clear coat is abraded; painted color is still dominant, but highlights become broad and dull.
- **Light scrape:** clear coat and part of the color coat are removed; a pale primer-colored line appears.
- **Medium scrape:** irregular grey or off-white primer/surfacer is visible.
- **Deep scrape:** silver-grey steel or e-coat appears, with dark grime at the boundary.
- **Severe collision:** use panel deformation, chipped edges, exposed structure, and detached parts.

Primer is often grey, white, beige, or color-tinted. Steel should not be represented as mirror chrome; use a rough silver-grey with directional or noisy variation. The e-coat may be dark grey, black, or muted grey depending on the system.

## 4. Performance strategy for WebGL2 and mobile

### Use render-target brush updates

The best GPU approach is a damage atlas rendered as a texture:

- one atlas for all cars,
- one small brush draw per contact or a batched contact buffer,
- additive, maximum, or custom blend accumulation,
- no full-texture readback.

WebGL2 supports render-to-texture through framebuffer objects. If the damage texture must be sampled while being painted, use ping-pong textures:

1. sample old damage texture,
2. render new damage texture,
3. swap the two textures.

Avoid sampling and rendering to the same texture simultaneously.

### CPU `DataTexture` updates

For a CPU implementation:

- keep the mask as an `Uint8Array`,
- compute the affected texel rectangle,
- modify only that rectangle,
- upload the rectangle with a sub-region texture update,
- avoid mipmap regeneration every contact.

A 512² mask is a good starting point. At 30 Hz, uploading a small 32×32 or 64×32 dirty region per scrape is usually far cheaper than uploading the entire mask. If using a full texture update, throttle it to roughly 10–20 Hz and interpolate the visual result in the shader.

### Suggested mobile budgets

A practical starting budget per visible car:

- damage mask: 256² `R8` for distant cars,
- damage mask: 512² `R8` for the player car,
- optional height mask: 256² `R8`,
- 0–4 active GPU brush draws per frame,
- combine multiple contacts into one brush vertex buffer,
- update only when impulse or sliding distance exceeds a threshold,
- use no damage texture at all for very distant cars.

For example, maintain three quality tiers:

| Tier | Mask | Updates | Effects |
|---|---:|---:|---|
| Near/player | 512² `R8` + optional height | 20–60 Hz | scratches, primer, metal, normal |
| Mid-distance | 256² `R8` | 10–20 Hz | color and roughness only |
| Far | none or one static decal | on major impact | no fine scratches |

### Atlas organization

Allocate a fixed atlas slot per car:

```text
atlasUV = carOffset + localUV * carScale;
```

Use the same material shader for every car. The car instance stores:

- atlas offset,
- atlas scale,
- damage texture layer or region,
- paint and primer colors,
- car-local UV transform.

A texture array can also work, but an atlas is often simpler with WebGL2 and allows several damage channels to share one allocation.

### Avoiding visual and numerical problems

- Dilate UV islands by several texels to reduce filtering seams.
- Use clamp-to-edge within each atlas slot, not across neighboring cars.
- Paint a small border around a dirty rectangle.
- Do not generate mipmaps after every update; update them periodically or use a separate low-resolution damage texture.
- Keep damage accumulation monotonic unless repairs are a gameplay feature.
- Compress or clear damage for cars that leave the active simulation.
- For mirrored UVs, either accept mirrored marks or maintain a mapping to both islands.
- Apply damage in the car’s undeformed local UV system so vertex deformation does not distort the mask unpredictably.

## Recommended implementation

For a three.js/WebGL2 prototype, use:

- `512² R8` damage atlas for the player car,
- `256² R8` atlas regions for other nearby cars,
- barycentric contact-to-UV mapping,
- a swept capsule brush for sliding,
- GPU ping-pong render targets,
- `smoothstep` thresholds for clear coat, primer, and steel,
- one directional scratch texture plus blue-noise breakup,
- roughness increase beginning at low damage,
- primer at medium damage,
- metal only at high damage,
- vertex deformation handled independently,
- decals reserved for a handful of prominent gouges.

That architecture gives the characteristic result of modern vehicle games without requiring per-contact mesh generation or expensive dynamic texture projection. It also scales cleanly from a desktop-quality 1024² hero car down to a mobile 256² mask.

The paint-layer values above are representative rather than universal: industrial references list clear coat around 35–50 µm, base coat around 10–25 µm, primer around 25–40 µm, and e-coat around 18–22 µm.[1] Broader automotive references report substantially wider ranges across manufacturers and coating systems.[3]

[1] Paint Thickness Measurement: Inline Eddy Current & Ultrasonic (https://ifactoryapp.com/industries/automotive-manufacturing/paint-thickness-measurement-inline-eddy-current-ultrasonic)
[2] Car Auto Coating Paint Thickness Explained (https://www.alibaba.com/product-insights/car-auto-coating-paint-thickness.html)
[3] Understanding Modern Automotive Paintwork - Ultimate Finish (https://www.theultimatefinish.co.uk/car-care-blog/featured/paintwork/)
[4] Feature Evident | May 2023 - PCI Index | Paint & Coatings Industry (https://digitaledition.pcimag.com/may-2023/feature-evident/)
[5] Blog | Stellarica Interactive - Game Dev, Graphics & Physics (https://stellarica.io/blog)
[6] Characterizing polymer material properties for automotive ... (https://www.rohde-schwarz.com/us/applications/characterizing-polymer-material-properties-for-automotive-applications_56279-1416704.html)
[7] www.cdeep.iitb.ac.in › slides › S15Protective Coating - MM650/2 - IIT Bombay (https://www.cdeep.iitb.ac.in/slides/S15/MM650/MM650-L1.pdf)
[8] Ultrasonic Paint Thickness Measurement - Plastic Substrates (https://www.defelsko.com/resources/ultrasonic-paint-thickness-measurement-on-plastic-substrates)
[9] [PDF] STUDY AND CHARACTERIZATION OF AUTOMOTIVE COATING ... (https://ijmmt.ro/vol4no12012/03___Bellisario_Santo_Quadrini.pdf)
[10] Process for the production of multi-layer coatings in light ... (https://patents.google.com/patent/EP1682285B1/en)
