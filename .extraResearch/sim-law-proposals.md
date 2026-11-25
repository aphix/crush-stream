# Simulation-law changes found on old branches: proposals for the owner (2026-11-25)

Three changes to laws of the simulation sit on old branches and never reached `main`. Each was a committed fix with its own
measurements, each changes every crash a little, and the standing rule is that a law change goes to the owner first. Nothing here
is ported. The numbers below are the old commits' own (read from their messages, measured on their bases in October), not
re-measured on today's `main`; a port's first step is to re-measure them.

A fourth item is a finding of the landing pass itself, with no fix written.

## 1. A wall's or striker's crush impulse is the energy of the slice's travel

- **Commits:** fb1e68a99 (2026-10-31); cee15a306 is its earlier draft.
- **What is wrong today:** `strikeCar` (`contact/external-contact.ts`) caps a crush by force times the slice's time. That impulse
  acts after the slice's travel, so the stop lands up to a slice's travel past the stroke, and the result depends on the slice
  length (the physics step).
- **The change:** the crush cap becomes the crush force times the travel the slice already moved, taken off the closing's
  kinetic energy at the car's mass (`crushImpulse`). Car-against-car keeps force times slice (under the energy law a 200 km/h
  head-on packed at 0.883 of its stroke against 0.9 +/- 0.015).
- **Measured then (sedan, 56 km/h square wall):** the nose's crush at 1/240, 1/320 and 1/640 s slices went from 451/440/430 mm to
  428/423/422 mm (the spread across slice lengths from 21 mm to 6 mm). Calibration: nose 0.439 to 0.420 m, pulse 67.8 to 63.4 ms,
  22.14 to 23.67 g.
- **What a player would see:** wall and striker hits crush about 2 cm less at the nose and stop about 4 ms sooner; the same crash
  looks the same at any frame rate. Every wall-hit digest and the crush calibration move.
- **Risk:** the crush calibration (`docs/CRUSH_CALIBRATION.md`'s targets) was tuned on today's law; the port must show the
  targets still hold or re-tune `crushForce`.
- **Recommendation:** port. It removes a step-length dependence, which is a correctness defect, and its effect is small and
  measured.

## 2. Shape-match goals that carry no net force and no net turn

- **Commits:** 415b7fd49 and 9e0711faf (2026-10-31), a pair: the second repairs a side effect of the first. 6aa88e0c6 depends on
  them.
- **What is wrong today:** a cluster's goals (`kernel/shape-match-core.js`) can carry a net force and a net turn, so a resting
  wreck's mass cloud can roll on its own. Measured then on the owner's fleet seed 753fbe: a wagon's cloud rolled 8.2 degrees over
  its wheels in 0.2 s after its crush had stopped, its right door mass rising 120 mm, with nothing pushing.
- **The change:** the rotation is taken from `Apq` (not from `A`), the blend is `M = (1 - beta) R + beta A` with `A` the plain
  least-squares fit, each mass's weight is shared over the clusters it belongs to, and a thin cluster's linear share gives back
  what the regularised fit lacks at rest (so a rest shape is its own goal).
- **Measured then:** the correction's net roll 10.4 to 0.0 degrees; a car resting level after a 64 km/h 40 % offset wall hit keeps
  its cloud within 1 degree of roll at 2 s (5.33 before, 0.46 after); a held reset's laid dent no longer drifts (4.7 mm by the
  second hold before).
- **What a player would see:** wrecks that settle and stay settled; no slow roll of a crushed body over its wheels. Every crash
  digest moves.
- **Two things to know:** it edits `kernel/shape-match-core.js`, a file the standing rules say is never edited, so it needs the
  owner's word on that as well; and the landing pass added rules that also act on a settling wreck (the frame's tilt, the planted
  hubs' pins and ride, the at-rest gates), written against today's goals. They would have to be re-measured on the balanced
  goals: some may become unnecessary.
- **Recommendation:** port, as its own stage with a full gate, before any further work on settling wrecks. It fixes at the source
  what several later rules work around.

## 3. A wreck outside its crush window reads every second cage point

- **Commit:** 4d3cbff17 (2026-10-13). 1bc2980b5 and 8abb29c17 (cage decimation) are parked drafts in the same direction.
- **What it is:** a cost cut, not a correctness fix: `loadPoints` loads about 218 cage vertices plus the belly for each wreck each
  slice; outside its crush window a wreck would load every second one.
- **Measured then:** its own test list passed; no timing is recorded in the commit.
- **What a player would see:** nothing, if it is right; a wreck resting on fewer points can sit or slide a little differently, so
  replays change.
- **Recommendation:** do not port as it is. It changes results for a gain nobody measured. If a profile shows `loadPoints` near
  the top in a pile-up, measure first, then decide.

## 4. A rigid hit can add kinetic energy to a tumbling wreck (found 2026-11-24, no fix written)

- **Where:** `contact/external-contact.ts` (`exchange`, `moveAsOneBody`); the row is a todo in
  `contact/move-as-one-body.test.ts`.
- **What happens:** a rigid exchange changes a wreck's yaw rate about the vertical axis and keeps its roll and pitch. For a body
  pitched 45 or 75 degrees nose-up and rolling at 3 rad/s those are coupled through its inertia: a sedan struck by a fixed face at
  0.3 to 0.5 m/s gained 1.7 to 36 J (2223 to 2247 J; 3562 to 3598 J). Upright and side-lying wrecks never gain.
- **Size:** about 1 % of the wreck's energy, in a rare pose.
- **A fix would be:** the exchange solving the body's full spin (three axes) in place of yaw alone: a law change touching every
  rigid contact of a wreck.
- **Recommendation:** leave as a recorded todo unless a clip shows a tumbling wreck visibly speeding up.

## What each port needs

A lane of its own with a reviewer; the commit's rows ported and seen red on `main` first; the old numbers re-measured on today's
tree; a `REPLAY_VERSION` entry; one re-derivation of the crash digests (`contact/whole-digest.test.ts`,
`vehicle/car-smooth.test.ts`); the full gate. Proposals 1 and 2 move the same digests: if both are taken, 2 goes first and 1 is
measured on top of it.
