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
- `play/union` (`~/worktrees/land`), not yet gated: ae0007683 (a derby driver that cannot get rolling lifts off, REPLAY 250),
  seven picks of `lane-hub-creep4` and 50cefd7eb (REPLAY 251: the planted hubs' pins and seat ride), this plan, and the merges
  of PerfPath, SmallCuts, CopStoops and GuestEdge.
- **Red on the union, owed before the gate.** The hub-creep picks moved every pinned crash digest (`whole-digest.test.ts`, four
  rows; `car-smooth.test.ts`, seven) and nobody re-pinned them: they are re-derived once, after ContactRows and DeformSeat are
  in. And they broke `vehicle/barrier.test.ts` "when a monster hits the slab at 48 km/h, then none of its hubs ends inside the
  slab" (green on `main`; hubFL ends at (-0.34, 0.59, -1.18) on the union). DeformSeat's probe: `holdHubVelocity`
  (`deform-solve.ts`) is the one rule whose removal alone puts the hub outside; the planted hub rides 13 cm into the slab while
  the frame still pitches at 2 rad/s; gating the seat ride and the frame tilt on the frame's spin at or under 0.3 rad/s made the
  row green with `compactor`, `crush-keep` and `slice-budget` green too, but it is knife-edge. This gets its own lane
  (MonsterSlab) once ContactRows and DeformSeat are merged; if the creep rows and this row cannot both hold, the seven
  hub-creep commits come out.
- Reviews are kept in `~/crash-wt/landing/reviews/<Lane>-review.json`. A lane's commits written after its review get a reviewer
  too, before the gate.
- Speed measurements owed (the worker, a quiet hour): PerfPath, CageWasm, LooseBatch (a browser derby with many torn parts).

|Lane|Goal|State|
|---|---|---|
|PerfPath|`projectPath` skips samples that cannot hold the nearest; `guardContact` reads a per-car cache; both bit-equal|merged (2c13f5d08); worktree removed; speed to be measured|
|SmallCuts|the crease blur's row pass bounded to the dent (texel-equal); far clumps of plants and rocks beyond a race course (drawn only, desktop at full share)|merged (5d4613ed0); worktree removed. Stated cost, desktop at full share only: at most 30,000 far triangles a course, no shadow, one draw a far kind (dam-spine start: calls 206 to 209, triangles 250k to 280k), about 58 ms more placement at load. Its last commit (one course-wide mesh a far kind) is with a reviewer|
|CopStoops|foot cops, and the suspects the law draws, stand and are thrown at the stoop's height (section 4, item 1)|merged (0a993ad89); worktree removed; its last commit is with a reviewer|
|GuestEdge|section 4, items 2, 5, 6|merged (ff5366b49). The doorway-sprint refusal did not reproduce over the real room path (the host's place for a sprinter leads him), so nothing changed there but a pin row; a hook fire at a person the host cannot stand a body for is a miss; a guest's hook onto a foot cop has its end-to-end row. Its last commit is with a reviewer|
|LooseBatch|torn car parts in one draw batch, only where the browser has `WEBGL_multi_draw`|reviewed twice, ready (c930818e5); NOT merged: waits for the browser measurement, dropped if no gain|
|CageWasm|the cage raster and plan field in the Rust kernel, bit-equal to the JS|reviewed, bit-equal by construction (69a0f7d3d); NOT merged: waits for the speed measurement (`bench.mjs strip-crash`, base against head), dropped if not faster. The skin stack (section 5) waits on it|
|ContactRows|contact fixes with their rows: a rigid exchange carries a wreck as its whole body; a leaning wreck's row reads no false yaw; `bandGrazes`; the Stack's true drop; the belly's ridge|reviewed: two of the old history's own corrections were missing (1c9ff3ffb, 4ec0e6601: `moveAsOneBody` keeps roll and pitch); the lane is porting them with five smaller items. Merges BEFORE DeformSeat (its `rideCage` needs 4ec0e6601)|
|DeformSeat|the frame's tilt and the hub riding the cage|reviewed; its four items are done (5db54b3b9: a guest and a held reset keep a crushed hub's place with no wire change; `findOver` allocates nothing; `car-smooth` re-pinned on its branch). Merges after ContactRows; digests re-derived then|
|CarsSeePlayers|traffic stops for a player on foot, standing or lying; a lying walker is not launched again by each car (section 4, item 4)|reviewed; its three items done (a car held in view is no longer towed in view); a confirm review is out (a fleet row failed once on a slow box: cause wanted)|
|BarRoom|section 4, item 3 (the owner's report)|reviewed: merge; two row tightenings with the lane. Measured on the real map: no seat within 0.6 m of a spot; a busy Kelly's has nobody behind the bar and no pair under 0.45 m for a second; fixed: 5 of 30 clerk walks cut through a counter, and a customer with a few ticks left popped in at her lane. NET 73|
|ShutPlaces|nobody but staff on shift is inside a place whose sign reads shut (a wreck, or its hours)|reported (2d8158c1d: 68 stuck residents over 24 seeds, 0 after); in review. NET 73|
|KerbClaims|a resident's get-in clip is never drawn while her car stands at a fallback space; a patrol car leased onto an occupied space (measure first)|worktree ready; not started (memory)|

## 4. Open world and host/guest: what is open

To dispatch, each as its own lane with a reviewer:

1. **A foot cop on a stoop is drawn at street height.** `Stoops` lifts the crowd's walkers (`liftFeet`,
   `world/openworld/openworld-stoops.ts`) and nothing lifts the law's poses. Old commit 9189b952d had `Stoops.liftAll(poses)`.
2. **A guest who sprints out of a doorway and fires within about 0.3 s is refused that shot.** `engine-openworld-acts.ts`
   `shootBy` tests the wall from the host's present torso for him; test it from his last record's own position.
3. **Kelly's Tap: people stacked at the bar's end and behind it.** The standing-room work landed; whether the owner's trace
   (`~/crash-wt/owner-traces/bar-stacking`) still shows it has not been replayed on `main`. Replay it, then fix what shows.
4. **A player shot down and left lying ended 37.6 m from where he fell** (one browser run). Cause not read.
5. **A guest's reticle can light a civilian the host then refuses** (its body pool is full); and no row drives a guest's hook
   onto a foot cop end to end.
6. **A hook fire whose eye is behind the actor is not tested against walls** (`engine-openworld-acts.ts`, `ahead > 0`).

To verify before any lane (a scout with a closer read; many were closed by lanes that landed after the list was written):
the parking claims that displace the brain's pick (`openworld-traffic.ts` `spotFor`/`claimFor`); seed 7's decision that stays at
a shut place; police car 14 throwing its driver at 15 to 23 m/s in seed aa3a76 (`vehicle/ejection.ts`); a shot at
a dummy's first-use cost (`pickDoll`, 587 KB); headless engine tests that still boot phone-class (one file opts into
`device: "desktop"`); Needle's worker path in a production build, never run in a browser.

For the owner (decisions, not defects): a passenger is not thrown in a crash and takes the wheel only by his throttle; lit room
walls near saturation; `JERK` 175 against the old plan's 250; the speed-dependent side-blow bar.

## 5. Old branches: what is real and not on `main`

Triage of 843 refs that are not ancestors of `main` (2,500 non-merge commits, about 2,080 on `main` by subject or content); data
in `~/crash-wt/triage/` (`verdict-*.json|txt`, `show/<sha>.txt`). Before a port, check the commit's premise still holds
(`git merge-base --is-ancestor <sha>^ main`; `git log -S'<line>' main` for code `main` had and removed).

- **Fixes to port, with their rows:** c851270b7 (`DRIVE.gripBleed`: overdrive costs speed); ed1e8b655 (`standOnTop` has no top
  friction, `prop-contact.ts`); 8b916af11 (the PIT ceiling, `cop-brain.ts`); 6e78dd888 (`clusterRule` cuts to 4 hard,
  `deform-rig.ts`); e3df9c357 (a lying wreck's turn rule and level weighting; the squeeze-seat part is on `main`).
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
- **Not ported, by record:** 22bc56801 (position lift) and 336a48d44 (contact guard speed cap), rejected; `ow/detmath` (kernel
  trig in people's posing: 17,870 B a frame against 0); `play/Shadow` and `play/ShadowAB` (worse on the phone and in the derby);
  6aa88e0c6 (needs balanced goals `main` lacks).

## 6. Sequence

1. Review and merge each port lane as it reports (section 2); measure each cost cut once.
2. Dispatch the open-world lanes of section 4 as memory allows, then the fix lanes of section 5.
3. The skin stack after CageWasm.
4. The gate over the union, the landing, the Windows mount.
5. Ask the owner: the simulation-law ports; the three race reds.
