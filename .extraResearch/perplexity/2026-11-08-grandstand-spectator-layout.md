> Question: Motorsport and stadium spectator stands: give the concrete geometry a procedural game generator could apply. (1) Orientation: which way do the seats face relative to the track (they face the track, the highest tier furthest from it); where is the roof and the back wall. (2) Setback of the front row from the track edge in metres (kerb, run-off, barrier, catch fence), by circuit type (F1 permanent circuit, rally spectator zones, drag/oval, street circuit). (3) Where stands go along a circuit: start/finish straight, outside of corners, hairpin exits, braking zones, and where they must never go (inside of fast corners, run-off in line with a straight). (4) Dimensions: length parallel to the track, number of rows, row depth (tread) and riser height in metres, the Green Guide sightline C-value, overall tier angle, seat width, stair/aisle spacing, typical capacity per metre of length. (5) Crowd density on rows and standing areas, general admission banks and grass banks, camping spectator areas. (6) Where marshals, catch fences, advertising boards and tyre walls sit between track and stand. Give numbers in metres with sources and say what is published versus an estimate.

A procedural generator should treat **spectator geometry as a safety envelope**, not as a fixed distance from asphalt. The exact setback is determined by the circuit’s FIA/ASN risk assessment, vehicle speed, run-off, debris trajectory, fencing, terrain, and local approval; the numerical values below are therefore a mixture of published guidance and clearly labelled design estimates.

## 1. Stand orientation and envelope

For a conventional grandstand:

- Seats face toward the track’s relevant viewing line.
- The lowest/front row is nearest the track.
- The highest tier is furthest from the track and normally rises away from the track.
- The roof is above and behind the seating bowl, supported by columns or a rear frame. A roof may project over the upper rows but should not obstruct sightlines.
- The back wall is behind the highest row, usually enclosing concourses, stairs, toilets, concessions, and structural services.
- Place the main access concourse at the rear or beneath the stand; do not use the track-side edge as the primary evacuation route.
- Use a cross-section with this order, from track outward:

```text
track → kerb → run-off → barrier → debris/catch fence → safety margin → stand front → seats rising away from track → rear concourse/back wall → roof
```

The FIA drawing requirements identify the spectator fence as the “second line of protection,” separate from the track-side protection system.[5] HSE guidance likewise says that protection must account for vehicle type, speed, distance, debris, and the need for sufficient deceleration space.[7]

## 2. Front-row setback

The values below are **procedural starting estimates**, not universal FIA minimums. Measure from the track edge or kerb to the front edge of the spectator seating platform.

| Circuit situation | Suggested front-row setback | Procedural interpretation |
|---|---:|---|
| F1 permanent circuit, fast straight or braking zone | 25–50 m minimum; use 50–100 m where run-off is substantial | Keep the stand behind the full run-off, barrier, debris fence, and an additional public exclusion strip |
| F1 permanent circuit, lower-speed corner | 15–30 m | Only if the approved run-off and debris protection fit inside this envelope |
| Rally spectator zone | 20–50 m from the road; 50 m or more at jumps, exits, high-speed bends, and potential cutting points | Use terrain and natural elevation; do not convert this into a rigid roadside grandstand rule |
| Drag strip | 30–60 m from the racing lanes at the start/acceleration area; more near the finish or shutdown zone | Increase setback in the direction of travel and near areas where vehicles can leave the strip |
| Oval, straight | 20–40 m beyond the outer safety barrier | Use larger values for high-banked, high-speed ovals |
| Oval, corner | 30–60 m beyond the outer barrier, often with additional catch fencing | Do not place low spectator platforms on the outside of a fast corner |
| Street circuit | Usually 8–20 m behind the barrier on a straight; 15–30 m at braking zones and corners | Existing buildings, walls, bridges, and temporary debris fencing may form the outer boundary |

These numbers are **estimates for a game generator**. The published sources do not provide one universal “grandstand distance from track” table. FIA and HSE guidance instead require a risk-based arrangement: FIA rally guidance says spectator zones should be clearly marked and, where appropriate, far from the road,[4] while HSE says the distance and protection must reflect speed, vehicle type, and flying debris.[7]

### Recommended safety-layer widths

Use these as separate procedural objects rather than combining them into one setback:

- Kerb: **0.3–0.5 m**.
- Paved shoulder or verge: **0.5–2 m**.
- Run-off: **5–30 m typical**, but allow **30–100 m** on very fast approaches and corners.
- Tyre or energy-absorbing barrier: **1–3 m deep**.
- Track barrier and service strip: **1–3 m**.
- Catch/debris fence: **2–5 m high**; use **4–6 m** in high-debris zones as a game estimate.
- Public exclusion strip behind the fence: **3–10 m**.
- Stand front platform and guardrail zone: **2–4 m**.

Do not interpret these as substitute FIA homologation values.

## 3. Where stands should be placed

### Good locations

- **Start/finish straight:** high-capacity grandstands opposite the pits, grid, podium, and finish line.
- **Outside of slow or medium-speed corners:** useful for viewing overtakes, corner entry, and exits, provided the stand is outside the approved safety envelope.
- **Hairpin exits:** good viewing because spectators can see braking, rotation, and acceleration.
- **Braking zones:** place stands outside the run-off and behind the barrier, preferably offset from the vehicle trajectory.
- **High points and natural banks:** preferred for temporary or general-admission viewing because elevation improves sightlines without putting people close to the track.
- **Rally junctions and slow corners:** spectator zones can work when positioned well away from the outside of the bend and away from cut-throughs, exits, jumps, and escape roads.

### Locations to prohibit

- Inside of fast corners where a vehicle can cross the track or debris can be thrown.
- Outside of rally bends, especially at high speed.
- Run-off areas, escape roads, gravel traps, and the continuation of a straight.
- Directly in line with a braking-zone exit or a drag-strip shutdown path.
- At the outside of a corner where cars may run wide.
- At jump landing zones, road crossings, junction exits, and likely corner-cutting areas.
- Between the primary vehicle barrier and catch fence.
- Low temporary stands immediately behind a tyre wall without independent debris protection.

FIA rally guidance explicitly states that the outside of a bend is prohibited for spectators, marshals, and media.[4] Rally safety guidance also identifies outside-of-corner areas, jump landings, escape roads, and run-offs as “no-go” areas.[9]

A practical placement score for a generator can be:

```text
stand_allowed =
    outside_fast_corner
    AND outside_runoff
    AND behind_barrier
    AND behind_catch_fence
    AND not_in_vehicle_trajectory
    AND not_in_debris_corridor
```

## 4. Grandstand dimensions

### Published or guidance-based values

The Green Guide material gives the following commonly used dimensional limits:

- Seat width: **500 mm minimum** for seated areas.[6]
- Row depth/tread: **280 mm minimum**, **400 mm maximum** in the cited Green Guide material.[8]
- Riser height: **75 mm minimum**, **180 mm maximum** in the cited material.[8]
- If a riser exceeds **180 mm**, a crush barrier should be provided at the top of the riser.[8]
- Preferred C-value range: approximately **90–120 mm**.[1][10]
- A C-value below **90 mm** is generally not acceptable for new stands except in exceptional circumstances.[6]

### Procedural grandstand defaults

Use the following defaults for a game generator:

| Parameter | Suggested value |
|---|---:|
| Seat width | 0.50–0.55 m |
| Row depth, seated | 0.76–0.85 m |
| Clear legroom within row depth | 0.30–0.40 m |
| Riser height | 0.12–0.18 m |
| Main aisle width | 1.2–1.8 m |
| Secondary aisle width | 0.9–1.2 m |
| Seats between aisles | 12–24 |
| Front guardrail height | 1.1–1.2 m |
| Typical stand length module | 30–120 m |
| Typical number of rows | 8–30 |
| Large permanent stand | 20–45 rows |
| Typical tier angle | 18–30° |
| Steep upper tier | 30–35°, only with appropriate barriers and access design |

The row-depth and riser values above are design estimates within or near the cited Green Guide ranges; the tier angle is a **procedural estimate**, not a universal published requirement.

### Sightline calculation

Use the standard C-value relationship:

\[
C=\frac{D(N+R)-R}{D+T}
\]

where:

- \(C\) = sightline clearance,
- \(D\) = horizontal distance from the spectator’s eye to the point of focus,
- \(N\) = riser height,
- \(R\) = vertical height from the point of focus,
- \(T\) = row depth.[1][2][6]

For a generator:

- Target \(C=0.09\text{–}0.12\ \mathrm{m}\).
- Reject or flag seating below \(C=0.09\ \mathrm{m}\).
- Calculate C for every seated row.
- For standing areas, calculating every second tread is an accepted approach in the cited guidance.[1][2][8]
- Aim the point of focus at the nearest important track feature, normally the racing line, apex, braking marker, finish line, or incident zone.

### Capacity per metre of stand length

Typical seated capacity:

- At **0.50 m per seat**, theoretical capacity is **2 seats/m**.
- With aisles, structural columns, stairs, disabled spaces, and circulation, use **1.4–1.8 seats/m** for a realistic stand.
- A 50 m straight grandstand with 20 rows therefore yields roughly **1,400–1,800 seats** before special deductions.

These are **estimates**, not a universal capacity standard.

## 5. Crowd density

### Seated stands

Published guidance cited in the search results states that a seated area built to minimum Green Guide dimensions can accommodate approximately **31 seated spectators per 10 m²**, equivalent to **3.1 people/m²**.[3] In practice, use lower values for comfortable circulation:

- Normal seated occupancy: **1.5–2.5 people/m²** of gross public floor area.
- Dense but plausible seated occupancy: **2.5–3.1 people/m²**.
- Do not apply the gross-area figure directly to rows; seats are better generated as discrete modules.

The same guidance gives typical lateral occupation of about **460 mm per seated spectator** and **550 mm per standing spectator**.[3]

### Standing terraces and safe-standing areas

The cited guidance identifies a maximum of approximately **47 people per 10 m²**, or **4.7 people/m²**, for a standing area fully equipped with crush barriers.[3]

Use:

- Comfortable standing bank: **2.0–3.0 people/m²**.
- Dense standing area: **3.0–4.0 people/m²**.
- Maximum procedural crowding: **4.7 people/m²**, only with crush barriers, controlled entry, and suitable exits.

### General-admission and grass banks

Suggested game values:

- Comfortable grass-bank viewing: **1.0–2.0 people/m²**.
- Busy general admission: **2.0–3.0 people/m²**.
- Dense festival-style bank: **3.0–4.0 people/m²**, only on stable, accessible terrain.
- Keep steeper banks less dense and add horizontal paths or terraces.

These are **estimates**. A grass bank should be modelled as a terrain-and-access problem, not as a seat grid.

### Camping spectator areas

Use substantially lower effective densities because tents, vehicles, fire lanes, toilets, and service access consume space:

- Tent-only camping: **0.02–0.05 people/m²** averaged across the site.
- Dense tent camping: **0.05–0.10 people/m²**.
- Vehicle-and-tent camping: **0.01–0.04 people/m²**.
- Keep camping outside the track’s debris and evacuation envelope and separate it from crowd ingress routes.

These are **planning estimates**, not motorsport-specific published limits.

## 6. Marshals, barriers, catch fencing, and advertising

A procedural cross-section should distinguish the following objects:

1. **Track edge and kerb**
   - Kerb directly at the racing surface.
   - No spectators or advertising immediately beyond it.

2. **Run-off**
   - Gravel, asphalt, grass, or a combination.
   - Preserve the full run-off geometry through corners and braking zones.
   - Never replace run-off with a stand merely because the stand is behind a barrier.

3. **Primary vehicle restraint**
   - Armco, concrete wall, TecPro, tyre wall, or another approved system.
   - Place it at the approved track-side boundary, not automatically at the track edge.

4. **Tyre walls**
   - Put them where the circuit safety design calls for energy absorption, commonly at the outside of corners, corner exits, or behind barriers.
   - Typical game depth: **1–3 m**.
   - Do not use a tyre wall alone as a spectator-security barrier.

5. **Marshals**
   - Marshal posts belong trackside but outside the vehicle path, normally behind the primary barrier or in protected recessed posts.
   - Typical game post footprint: **2–4 m wide** and **2–3 m deep**.
   - Place posts at braking zones, corners, exits, and intervals of roughly **100–250 m** on permanent circuits; this spacing is an estimate and should vary with visibility and circuit complexity.
   - Provide protected access to the track, not an exposed path through the spectator zone.

6. **Catch/debris fence**
   - Put it behind the primary barrier and before the public.
   - Typical game height: **2–5 m**, increased to **4–6 m** where debris risk is high.
   - FIA documentation distinguishes the spectator fence as a second line of protection.[5]
   - HSE guidance recommends debris fencing or catch netting where wheels or other debris could enter spectator or marshal areas.[7]

7. **Advertising boards**
   - Place them behind the primary barrier and outside the run-off.
   - Typical game height: **0.8–1.2 m** for low boards and **2–3 m** for larger panels.
   - Keep them out of sightlines, marshal access routes, emergency gates, and debris paths.
   - Do not use an advertising board as a substitute for a safety barrier or catch fence.

8. **Grandstand**
   - Front row behind the public-side safety envelope.
   - Add a **2–4 m** front circulation or guardrail zone.
   - Raise the first row where possible; elevation is preferable to moving the stand closer to the track.

## Recommended generator schema

Represent each spectator installation with fields like:

```text
stand_type:
  permanent_grandstand
  temporary_grandstand
  grass_bank
  standing_terrace
  rally_zone
  camping_area

track_relation:
  straight
  braking_zone
  corner_entry
  apex
  corner_exit
  hairpin_exit
  start_finish

orientation:
  focus_point
  facing_vector
  slope_away_from_track

safety_layers:
  kerb_width
  runoff_width
  primary_barrier
  tyre_wall_depth
  marshal_strip
  catch_fence_height
  exclusion_strip
  advertising_board

seating:
  front_setback
  row_count
  row_depth
  riser_height
  seat_width
  aisle_spacing
  target_c_value
  capacity

validation:
  outside_fast_corner
  outside_rally_no_go_zone
  outside_runoff
  behind_primary_barrier
  behind_catch_fence
  clear_of_debris_corridor
  clear_of_straight_line_runoff
```

The strongest hard rules are: **never place spectators in run-off or escape areas; never place them on the outside of a fast rally bend; keep stands behind both the vehicle restraint and spectator/debris fence; and validate sightlines using a C-value target of 90–120 mm.**

[1] Supplementary Guidance 01: Safe Standing in Seated Areas (https://sgsa.org.uk/wp-content/uploads/2024/01/SG01-Safe-standing-in-seated-areas-July-2022.pdf)
[2] Guide to Safety at Sports Grounds (https://www.westminster.gov.uk/media/document/guide-to-safety-at-sports-grounds)
[3] Standing in seated areas of football grounds (https://sgsa.org.uk/wp-content/uploads/2024/02/Standing-in-seated-areas.pdf)
[4] FIA RALLY SAFETY GUIDELINES (https://www.fia.com/sites/default/files/1rally_safety_guidelines_2021_en_v6_web.pdf)
[5] [PDF] federation internationale de l'automobile - FIA (https://api.fia.com/sites/default/files/list_of_requirements_for_the_circuit_drawing_2024.pdf)
[6] [PDF] Accessible Stadia - Sports Grounds Safety Authority (https://sgsa.org.uk/wp-content/uploads/2023/12/Accessible-Stadia.pdf)
[7] Managing health and safety at motorsport events: A guide for motorsport event organisers   HSG112 (https://www.hse.gov.uk/pubnS/priced/hsg112.pdf)
[8] www.scribd.com · document · 402159202Green Guide PDF | PDF | Safety | Stairs - Scribd (https://www.scribd.com/document/402159202/green-guide-pdf)
[9] The planning and organisation of a rally ... (https://www.autourheilu.fi/site/assets/files/49408/fia_safety_bulletin_25.pdf)
[10] Green Guide 6th Edition (SM) | PDF | Safety | Stairs (https://www.scribd.com/document/655928223/Green-Guide-6th-Edition-Sm)
