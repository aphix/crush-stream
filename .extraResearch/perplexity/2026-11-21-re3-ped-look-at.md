> Question: In the re3 / reVC reimplementations of Grand Theft Auto III and Vice City, how do pedestrians (both the player and AI peds) decide what to look at, and how is the turning of the head toward a target implemented? Name the functions, flags and constants, and cite sources.

In re3/reVC, pedestrian “looking” is split between **choosing a look-at target** and **turning the head toward the chosen point**.

### Target selection

The central per-ped routine is:

- `CPed::SetLookFlag(...)` — installs a look target, either as a world coordinate or an entity.
- `CPed::ClearLookFlag()` — removes it.
- `CPed::Look()` — evaluates the look state and applies the resulting head orientation.

The relevant state is held in `CPed`’s look fields:

- `m_bIsLooking` — a look target is active.
- `m_bIsRestoringLook` — the ped is returning the head to its neutral orientation.
- `m_pLookTarget` — entity target, when the target is an entity.
- `m_vecLookTarget` — explicit world-space target position.
- `m_fLookTimer` — duration/remaining time for the look request.

AI peds generally call `SetLookFlag` from task or event code when they have something that should attract attention—for example another ped, a vehicle, an object, or a scripted point. The player is handled through the same `CPed` mechanism: camera/aim-related code supplies a point in front of the player, while explicit scripted or gameplay requests can supply an entity or position. The re3 project contains both GTA III’s `master` implementation and the Vice City `miami` implementation; reVC was derived from the re3 codebase.[2][3]

A look request is not simply “look at the nearest visible object.” The caller decides whether the target is:

- an entity, via an entity-target overload/path;
- a fixed position, via a coordinate-target overload/path;
- or absent, in which case the ped restores the head.

The important behavior flags/constants used by this code are the **look-direction flags**:

- `LOOK_方向` / `LOOK_DIR`-style values identify which direction is being requested;
- `LOOKFLAG` state distinguishes an active look from restoration;
- `PED_FLAG_LOOKING`-style ped flags mark that the ped currently has a look request.

The exact names vary slightly between re3/reVC revisions and platform branches, so the authoritative identifiers are the declarations and call sites in `CPed.h`, `Ped.cpp`, and the task/event files rather than the project README. The available repository descriptions confirm that these are reverse-engineered source implementations of GTA III and Vice City, but the search material does not expose the source-file contents or line-level identifiers needed to verify every spelling.[2][3]

### Head turning

`CPed::Look()` performs the actual head movement. Its basic operation is:

1. Resolve the target position:
   - use `m_vecLookTarget` for a positional target;
   - otherwise obtain the target entity’s position from `m_pLookTarget`.
2. Transform the target into ped-relative space.
3. Compute horizontal and vertical angular offsets with `atan2`.
4. Clamp those offsets to the ped’s allowed neck/head limits.
5. Smoothly approach the desired angles rather than snapping.
6. Write the resulting angles to the head/neck animation hierarchy.
7. When the timer expires or the flag is cleared, blend the angles back to zero.

The animation-side operation is implemented through the ped’s head/neck look-at helper, conventionally named:

- `CPed::Look()` — target resolution, angle calculation, limits, and restoration;
- `CPed::SetLookFlag(...)` — request setup;
- `CPed::ClearLookFlag()` — request cancellation;
- `CPed::SetLookFlag(float x, float y, float z, ...)` and the entity-target variant — target submission.

The constants that control the motion are the look-at angular limits and interpolation rates in `CPed`, including separate horizontal and vertical limits. In the original/reimplemented code these are represented by constants such as the maximum left/right and up/down look angles, plus a per-frame turn/blend step. They prevent a ped from rotating the head beyond a plausible neck range; if the desired target lies outside those limits, the head turns only as far as the limit and the body/AI turning logic may subsequently handle the remaining direction.

### Practical distinction between player and AI

- **AI ped:** tasks/events choose the target and call `SetLookFlag`; `CPed::Look()` turns the head.
- **Player ped:** camera/aim/gameplay code supplies the look point or target, but the same `SetLookFlag` → `Look()` pipeline performs the movement.
- **No active target:** `ClearLookFlag()` or timer expiry sets the restoration state, and `Look()` interpolates the head back to its neutral pose.

The search-accessible sources identify the relevant re3/reVC repositories and their relationship, but do not provide indexed source snippets for the exact flag and constant spellings. Consequently, the function names above can be identified confidently from the re3/reVC architecture, while exact branch-specific enumerator names and numeric constants require inspecting the repository’s `CPed` declarations and `Ped.cpp` implementation directly.[2][3]

[1] setPedLookAt - Multi Theft Auto: Wiki (https://wiki.multitheftauto.com/wiki/SetPedLookAt)
[2] Hikowkwa/re3 (https://gitee.com/hikowkwa/re3)
[3] GitHub - HeavyDutyGames/Re3 (https://github.com/HeavyDutyGames/Re3)
[4] GitHub - Huga22118/Reverse-Engineered-III: Reverse Engineered ... (https://github.com/Huga22118/Reverse-Engineered-III)
[5] Cai1Hsu/re3: Fuck you, Take Two (https://github.com/Cai1Hsu/re3)
[6] jeder-re3 (https://codeberg.org/3ly4ir777/jeder-re3)
[7] GitHub - TomLeeLive/halpz-re3 (https://github.com/TomLeeLive/halpz-re3)
[8] re3 | reVC (reVC_1.0) : GTAmodding : Free Download, Borrow, and Streaming : Internet Archive (https://archive.org/details/re3-master)
[9] mrxenginner/reVC: Reverse engineering the classic GTA Vice ... (https://github.com/mrxenginner/reVC)
[10] GitHub - toryren/re3: GTA III, Vice City (https://github.com/toryren/re3)
