# Landing pass: the plan in flight (opened 2026-11-24)

Main (the orchestrating agent) keeps this file current and is the one who finishes it. It replaces the untracked `play-handoff/`
log for every new task; that folder is frozen history (lane handoffs, reviews and the netplay plans of work that is on `main`).
Paths: `~/worktrees/<Lane>` is a lane's git worktree (branch `play/<Lane>`), `~/worktrees/land` is Main's own (branch `play/union`),
`~/crash-wt/` is scratch outside the repository.

## 1. The order

1. The owner's standing ask: third-person camera, controls and performance; the Open World scene more awesome, its people less
   doll-like; never worse for performance (very high frame rates in a phone browser is the spirit).
2. Host and guest parity in an open-world room: every walker, body and car the same on host and guests; a guest can do everything
   the host can. Landed (`main` 5989b47a0, NET 72); what is left of it is in section 4.
3. The current order: complete, merge, gate and land what is unlanded. Priority is the open-world work and the host/guest work;
   an old branch's commit comes in only when it is a real fix or improvement. A port to the WASM kernel is done when it is
   faster and bit-equal; if it measures worse it is dropped.

## 2. Binding rules

**Lanes.** A lane is a `task` agent with one goal, in its own worktree `~/worktrees/<Lane>` on `play/<Lane>`, cut from
`play/union`. It may spawn `scout` (read-only) and `sonic` (mechanical edits it dictates, in its worktree) helpers, at most two
live. No scope is added after dispatch. It commits as `Aphix <aphix@users.noreply.github.com>`, staging by name; never push,
stash, `reset --hard`, clean, rebase, squash, `rm` with a glob or `pkill`.

**Tests.** Only Main runs repo-wide tests, over the union. A lane runs one capped test process at a time, only the files it
touched or wrote, each once per change: `CAP=1100M ~/crash-wt/capped ~/crash-wt/gate-slot npx vitest run --project app <files>
--maxWorkers=1 < /dev/null`. Never `test:app`, `test:all`, a long-run file, a sweep, a bench or a cost matrix in a lane. Static
checks one at a time: `npm run typecheck`, `npm run lint`, `node scripts/check-boundaries.mjs --ratchet`,
`node scripts/check-links.mjs`. A new behaviour gets a row seen red once without the change; no `// mutation: sed` comment is
written and none a port brings in is kept; no bound is loosened and no test deleted. On a red: read the test whole, its setup,
the source under test, state the behaviour it protects, then decide.

**Code.** `docs/CODING_STANDARDS.md` and `docs/ARCHITECTURE.md` bind. Per-frame, per-step and per-message code allocates nothing
and is named in `HOT` (`scripts/check-boundaries.mjs`); simulation folders use the kernel's `det*` maths; `physics-core.js` and
`shape-match-core.js` are not edited. A simulation change bumps `REPLAY_VERSION` with a history entry (next: 252); a wire change
bumps `NET_VERSION` once with both pins (next: 73). A change to a simulation law (energy split, crush curve, hit ledger) goes to
the owner as a proposal first.

**Review.** Every lane's branch gets a `reviewer` agent before its merge: `skill://ponytail-review` followed exactly, plus the
lane's goal judged end to end (the player gets it in the running game, not a mechanism with a test). Must-fix items go back to
the lane. The reviewer reads only; it runs nothing.

**Landing a lane (Main).** Review clean → `git -C ~/worktrees/land merge --no-ff play/<Lane>` → static checks → the lane's test
files once → `REPLAY_VERSION` / `NET_VERSION` entry where owed → remove the lane's worktree, branch scratch, logs and worker run
dirs at once (not in one sweep at the end).

**A cost cut.** Main measures it once after the merge (same session, alternating runs). Not faster, or not bit-equal where it
claims to be: reverted.

**The gate (Main only), then the landing.** Mail humm-tauri; `~/crash-wt/union-gate.sh <detached tree> <log dir> 1 8` (app
shards) and `9 14` (long AI suite) on the worker; the GL files (`scripts/headless-canvas.test.mjs`,
`scripts/detail-spec-aa.test.mjs`) locally with `DISPLAY=:0`; `npm run test:parity`; `npm run build:node`;
`~/crash-wt/secret-scan.sh main..HEAD`. Accepted reds: `race-start` (rally, razor-shelf) and `race-contact` (breaker-yard,
aggression 0), red since 671efc2cf. Then `git -C <main checkout> merge --ff-only play/union` and `bash scripts/wsl-push.sh`; the
owner pushes to GitHub.

**The shared box** (with humm-tauri, over `mbox`): our budget 7 GB, theirs 11 GB; under 6 GB available or over 2 GB swap start
nothing and mail them; under 4 GB park our lanes first; the worker takes three of our jobs, 18 GB at most, two when they run a
full suite; mail when our agent count changes by two or more. Nothing is ever run on `ompvps` or `lux`.

## 3. State

- `main` = Windows mount = GitHub = 5989b47a0 (NET 72, REPLAY 249).
- `play/union` (`~/worktrees/land`, 70 commits past `main`, NET 73, REPLAY 253), not yet gated. Merged, each reviewed (its
  later commits too), static checks clean and its own test files green on the union: PerfPath, SmallCuts, CopStoops,
  GuestEdge, BarRoom, ContactRows, DeformSeat, ShutPlaces, CarsSeePlayers; their worktrees are removed. Under them: ae0007683
  (a derby driver that cannot get rolling lifts off, REPLAY 250) and the seven picks of `lane-hub-creep4` (REPLAY 251).
- **Red on the union, owed before the gate** (lane HubRules has both):
  - `vehicle/barrier.test.ts` "when a monster hits the slab at 48 km/h, then none of its hubs ends inside the slab" (green on
    `main`; red since the hub-creep picks; hubFL ends at (0.06, 0.14, -1.19)). DeformSeat's probe: `holdHubVelocity`
    (`deform-solve.ts`) off alone puts the hub outside; the planted hub rides 13 cm into the slab while the frame still
    pitches at 2 rad/s; gating the seat ride and the frame tilt on the frame's spin made the row green but knife-edge.
  - `scenes/stack-column.test.ts` "when the Police column settles, then each roof's crush is the same within its bar (9 mm)"
    reads 10.97 mm since DeformSeat joined ContactRows (green on each branch alone).
  - If the creep rows, the monster row and the column row cannot all hold, the lane reports the smallest set of hub commits
    to take out and Main decides.
  - After it: the crash digests (`whole-digest.test.ts` four rows, `car-smooth.test.ts` seven) are re-derived ONCE with the
    reason per change (hub creep, the seven contact rules, the tilt and the hub ride, HubRules' fix), and REPLAY 254.
- Reviews are kept in `~/crash-wt/landing/reviews/<Lane>-review.json`. A lane's commits written after its review get a reviewer
  too, before the gate.
- Speed measurements owed (the worker, a quiet hour, humm-tauri's yes still awaited): PerfPath, CageWasm, LooseBatch (a
  browser derby with many torn parts).
- The box: our session is the `omp` process whose working directory is this repository (`readlink /proc/<pid>/cwd`); it was
  5.1 GB at 19:00Z. (Main read humm-tauri's process as ours for most of the day and reported 7 to 8 GB: wrong.)

|Lane|Goal|State|
|---|---|---|
|HubRules|the two reds above, at the rule that is wrong in principle, with margin shown; or the conflict report|working|
|KerbClaims|a resident's clip drawn where her car stands (it was never drawn while her car stood at a fallback space); a patrol car's start space (measure: leased onto an occupied space, or a cruiser at urgent pace hitting traffic)|working|
|Sweep|five review leftovers: a guest's throw of a cop it never heard a record for; the far kinds row per course; whether a rigid exchange adds energy to a leaning, rolling wreck (a row, or a todo with the joules); two doc lines; the twin row hearing its danger and ambulance events|working|
|LooseBatch|torn car parts in one draw batch, only where the browser has `WEBGL_multi_draw`|reviewed twice, ready (c930818e5); NOT merged: waits for the browser measurement, dropped if no gain|
|CageWasm|the cage raster and plan field in the Rust kernel, bit-equal to the JS|reviewed, bit-equal by construction (69a0f7d3d); NOT merged: waits for the speed measurement (`bench.mjs strip-crash`, base against head), dropped if not faster. The skin stack (section 5) waits on it|

Stated costs of what is merged, for the owner: the far clumps (SmallCuts), on a desktop at the full scenery share only: at most
30,000 triangles a course, no shadow, one draw a far kind on every race frame (dam-spine start: 206 to 209 draw calls, 250k to
280k triangles), about 58 ms more placement at a course's load.

## 4. Open world and host/guest: what is open

What was open when this plan was written, and what became of each:

1. A foot cop on a stoop drawn at street height: fixed (CopStoops, merged).
2. A guest's shot out of a doorway refused: did not reproduce over the real room path, straight or at 30 and 45 degrees
   (the host's place for a sprinter is extrapolated and leads him); pinned by rows (GuestEdge).
3. Kelly's Tap: measured on the real map: nobody behind the bar but staff, no pair under 0.45 m for a second, no seat within
   0.6 m of a spot. Fixed what was left: clerks walking through the counter, a late customer popping in at her lane (BarRoom,
   merged).
4. A player shot down ended 37.6 m away: no traffic car braked for a player on foot and each one launched the lying host again
   (CarsSeePlayers, in its last review round).
5. A guest's hook at a person the host has no body for tied the wall behind her: now a miss; a guest's hook onto a foot cop
   has its end-to-end row (GuestEdge, merged).
6. A hook fire whose eye is behind the actor: nothing is gained by a modified client (no cable end at the actor; range and
   walls run from the eye); argued in `docs/MULTIPLAYER.md`, no change.
7. Someone staying inside a shut or wrecked place: ShutPlaces (in its last review round).

Still open, each a lane of its own when memory allows:

- **KerbClaims** (worktree ready): a resident's get-in clip is never drawn while her car stands at a fallback space
  (`openworld-traffic.ts` `claimFor`, `carForClip`); a patrol car's start space is picked with no check that it is free
  (`traffic-patrol-ports.ts` `startSpot`: the likely cause of police car 14 throwing its driver; measure first).
- **A stacked car's belly 10 to 15 cm into the roof under it** (found by ContactRows at -0.6 m along a sedan's roof): the roof
  surface the sim reads (`CarSurfaces.sync`, `cage.fields.top` as last published) stands under the cage's top there. A lane
  prints, along that line, each sample's place in the patch box, the height the surface reads and `cage.fields.top`.
- **Small leftovers from the reviews** (one sweep lane before the gate): a guest that never heard a record for a cop throws
  him at the map's origin if he goes down within 2 s of the join (`crime-scene.ts` `throwFromNearest`: a per-cop heard bit);
  the far kinds row should check each course's own biome table (`scenery-far-flag.test.ts`); a row that a rigid exchange on
  a leaning, rolling wreck adds no kinetic energy (`move-as-one-body.test.ts`: today's row has no exchange);
  `docs/UNIFIED_CONTACT.md` line 559 (the pitched over-read reads 0.500 m since `bandGrazes`); the office meeting-room chairs
  that no aisle reaches (nothing walks to them today); a medic is never named by a guest's hook; medics are not seen by
  traffic.
- **Not looked at:** a shot at a dummy's first-use cost (`pickDoll` builds 0.6 MB of tables on a mesh's first shot; no row
  bounds a warm shot); 21 of 22 open-world engine test files boot phone-class (60 residents, 1 cruiser, 3 bodies), so arrest
  rides with the cops' own cars are exercised by one file only; Needle's worker path in a production build, never run in a
  browser.

For the owner (decisions, not defects): a passenger is not thrown in a crash and takes the wheel only by his throttle; lit room
walls near saturation; `JERK` 175 against the old plan's 250; the speed-dependent side-blow bar; the far clumps' cost on a
desktop (section 3); a customer holding a far seat with a few ticks left before closing still hurries in at more than a run.

## 5. Old branches: what is real and not on `main`

Triage of 843 refs that are not ancestors of `main` (2,500 non-merge commits, about 2,080 on `main` by subject or content); data
in `~/crash-wt/triage/` (`verdict-*.json|txt`, `show/<sha>.txt`). Before a port, check the commit's premise still holds
(`git merge-base --is-ancestor <sha>^ main`; `git log -S'<line>' main` for code `main` had and removed).

- **Fixes to port, with their rows:** ed1e8b655 (`standOnTop` has no top friction, `prop-contact.ts`); e3df9c357 (a lying
  wreck's turn rule and level weighting; the squeeze-seat part is on `main`). 6e78dd888 (`clusterRule` cuts to 4 hard,
  `deform-rig.ts`) and d498838af belong to the skin stack's lane.
- **For the owner's ruling, not ported (they change how the game plays):** c851270b7 (`DRIVE.gripBleed`: full lock at speed
  sheds speed: a handling change, and the owner calls the cars nailed); 8b916af11 (Survival's hunters PIT a player up to
  30 m/s in place of 20: its own commit records `survival.test`'s schedule row going red on seed 1).
- **Cost cuts to port (bit-equal or dropped):** fb1624283 (`sampleGround` called twice, `deform-solve.ts`); d498838af
  (`setNearView` re-skins any crashed car, `car.ts`).
- **Rows to add for behaviour `main` already has:** f3f14ec91 (a second Rapier load shares the first); 2a25ed4bc (the high jump
  fails loudly); f23f6436c (the top car drives off the owner's stack); 6011d0b79 (kept crumple settings); 36c351e68 (near and
  far tyre uv samples); 7352a9a46 (a sleeping part stays asleep); 4a2cac08b (rest overlap, epicenter thaw); 7687209a9 (sedan
  against truck head-on speed-change ratio); 912f2ab09 and 8046ada20 (class-mass-scaled lid pop and tail pair); 4e3f80389 (the
  piston's far half).
- **The skin stack** (ten commits of 10-30/31: fd5d0ae8c, 8939ab1f7, 73dd1661a, 1681f8cb5, fdcd9af75, c945e7924, 1fc490df0,
  6497a092d, 3560a129f, eb0fca73d): after CageWasm; `npm run build:kernel`, `test:parity` green, digests re-derived.
- **Unfinished on its branch:** 37ed37403 (a thrown driver eased from his seated pose into the ragdoll; its skin row is red:
  the drawn dummy crosses the car's skin in 12 of 20 frames); 087a6eb89 (a class-balance bench, a measuring tool).
- **Waiting for the owner's ruling (simulation laws):** fb1e68a99 and cee15a306 (one crush impulse law); 415b7fd49 and
  9e0711faf (shape-match balanced goals); 4d3cbff17 (strided wreck points); 1bc2980b5 and 8abb29c17 (cage decimation, parked).
  And a finding of this pass (lane Sweep, `move-as-one-body.test.ts`, a `todoRow` with the numbers): **a rigid exchange can
  add kinetic energy to a tumbling wreck.** A sedan pitched 45 or 75 degrees nose up and rolling at 3 rad/s, struck rigidly
  by a fixed face at 0.3 to 0.5 m/s, gains 1.7 to 36 J (2223 to 2247 J; 3562 to 3598 J): the exchange changes the yaw rate
  about the vertical axis while roll and pitch are kept, and for a tilted body those are coupled through its inertia. Upright
  and side-lying wrecks never gain. About 1 % in a rare pose; the cure is the exchange solving the body's full spin, a law
  change.
- **Not ported, by record:** 22bc56801 (position lift) and 336a48d44 (contact guard speed cap), rejected; `ow/detmath` (kernel
  trig in people's posing: 17,870 B a frame against 0); `play/Shadow` and `play/ShadowAB` (worse on the phone and in the derby);
  6aa88e0c6 (needs balanced goals `main` lacks).

## 6. Sequence

1. Done: the nine merges of section 3, `NET_VERSION` 73 (both pins), `REPLAY_VERSION` 252 and 253.
2. HubRules (the two reds), reviewed, merged; then ONE re-derivation of the crash digests (`whole-digest.test.ts`,
   `car-smooth.test.ts`) with the reason per change, and REPLAY 254. Sweep (reviewed: merge) and KerbClaims as they report.
3. On the worker, when humm-tauri says yes: the three speed measurements (section 3); the hunt for the fleet file's red seed
   (`engine-onfoot-fleet.test.ts` boots with a random scene seed, as every `OnFootRig.boot()` file does: the likely cause of
   its one red run; then pin the seed in the test util and reset the pacer in `beforeEach`).
4. CageWasm and LooseBatch merge only if faster; the skin stack after CageWasm.
5. The gate over the union, the landing, the Windows mount.
6. Ask the owner: the simulation-law ports, the energy finding and the two gameplay ports (section 5); the three race reds;
   the far clumps' cost (section 3).
