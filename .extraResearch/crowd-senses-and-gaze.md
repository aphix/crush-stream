# Crowd senses, gaze and minds

Research for the 2026-11-22 play pass: the owner wants open-world people to sense things and turn their heads to look
at them ("not look so weird and doll-like"), and asked whether a tiny on-device model (Needle) could pick their thoughts
singly or collectively, behind a clear spine of the brain's launch pattern, without costing frame time. Status per claim:
VERIFIED (read in the primary source), LEAD (an answer said it; not checked), ENGINEERING (our value, tuned by feel).

## How GTA's peds look at things (reVC source, branch `miami`) VERIFIED

- A look is a request with a timer: `CPed::SetLookFlag(entity | direction, keepTryingToLook)` and
  `SetLookTimer(ms)` (`src/peds/Ped.cpp` 1007-1038, 5441). `MoveHeadToLook()` turns the head every frame
  (1061-1138); a ped target is looked at at its middle (`PED_MID`).
- When a look ends (`ClearLookFlag`, 1040-1058) no new look is accepted for 4000 ms (NPC) or 2000 ms (player).
- Limits and rates (`src/peds/PedIK.cpp` 10-12, per frame at 30 fps): head yaw +-90 deg at 15 deg/frame, pitch +-45 deg
  at 8 deg/frame; restoring the head 10 and 5 deg/frame; the torso joins when the head can't reach (+-50 deg yaw,
  +-45 deg pitch, 8 and 5 deg/frame) unless the look is head-only. Head pitch is scaled by `cos(headYaw)`
  (`LookInDirection`, 115-153).
- Triggers are few and cheap. `LookForInterestingNodes` (7822) runs every 8 frames offset by the ped's seed
  (`(frame + seed % 256) & 7`) and looks at an "attractor" point within 8 m for 1000 ms, then chats for 2000 ms.
  `LookForSexyPeds` looks at a visible ped within 10 m for 4000 ms (else waits 10 s); `LookForSexyCars` at the most
  expensive car within 10 m (10 s between tries). A car bumping a ped makes it look at the car for 500-1300 ms
  (2125-2217). The player looks at a ped whose blood he steps in, for 500 ms (1764).

## Gaze in research

- Andrist, Pejsa, Mutlu, Gleicher 2012, "A Head-Eye Coordination Model for Animating Gaze Shifts of Virtual
  Characters" (graphics.cs.wisc.edu/Papers/2012/APMG12a) VERIFIED: per gaze shift a head latency relative to the eyes
  (factors vote for head-first: high saliency, low predictability, auditory target, large amplitude, forced intent);
  eyes and head follow ease-in/ease-out velocity profiles whose peak grows linearly with amplitude; an oculomotor range
  limits the eyes; a per-character head alignment 0-100 % ("head-mover" turns the head until aligned, "non-head-mover"
  stops it once the eyes arrive); the vestibulo-ocular reflex keeps the eyes on target while the head finishes. Rated
  significantly more realistic than the head-propensity model it was compared with.
- Eyes lead the head by about 67 +- 22 ms; shifts under about 20 deg are mostly eye; near 30 deg the head takes about a
  third; torso joins for large shifts (LEAD: J Neurophysiol eye-head study; Kleiner et al. 2019, ACM TOCHI VR study).
- At road crossings pedestrians glance at an approaching vehicle a median of 1-2 times, up to 5 (LEAD: Pipkorn et al.
  2024).
- Crowd gaze papers named but not opened (LEAD): "A Group-Based Approach for Gaze Behavior of Virtual Crowds"
  (saliency, group membership, personality, velocity), "Gaze Behaviors for Virtual Crowd Characters" (saliency,
  saccades, head animation), PedVR (VRST 2016; gaze at the user gated by distance, approach speed and visibility).

## Crowds in shipped games

- Hitman (2016), Tommy Thompson, "The AI of Hitman (2016)", Game Developer, 2019 VERIFIED: every AI keeps a knowledge
  base from sensors (local, line of sight, interruptible) and shared services; crowd characters run three states
  (standing idle, walking, pending walk); events emit "behaviour zones", a pulse "within a certain radius and angle
  relative to the source of the event"; responses are looking at a point of interest, avoiding the source, alert, scared
  or prone ("if fireworks are going off then all characters within a certain radius ... face the point of interest to
  watch them explode"); between overlapping zones the response that moves mood most wins, and they never calm down
  once set off; panic flows over a grid route crowds to exits. Up to 1,200 agents per crowd with 500 visible
  (Absolution), over 1,000 crowd NPCs per level (2016), over 2,000 (Hitman 2); behaviour-tree AIs far from the player
  update less often.
- Assassin's Creed Unity, GDC 2015, Cournoyer, "Massive Crowd on Assassin's Creed Unity: AI Recycling": the talk exists
  (Game Developer's video page, VERIFIED); "40 full AIs, 120 high-resolution models, 10,000 crowd NPCs" is LEAD.

## Sentient World Simulation VERIFIED

Concept paper "Sentient World Simulation (SWS): A Continuously Running Model of the Real World", v2.0, 2006-08-22
(Tony Cerri, JFCOM J9; Alok Chaturvedi, Purdue):
- Its core is SEAS, an agent-based environment. Building blocks: "individuals, organizations, institutions,
  information, and geographies", built up into communities, societies, nations.
- Agents have "DNA and memory" (designed in SIDE); behaviours "can be mathematical models based on variables that the
  agents sense from the environment or can be described procedurally using a workflow engine ... states, transitions,
  and messages" (JIME); new agents are tried in a controlled "Bullpen".
- "Society of Models": "Coarse-grained models use a small sample of the population and localized fine-grained models
  use a full sample of the population in an area. The same individual who experiences events from a fine-grained model
  can be influenced by a coarse-grained model." SEAS-NRT (crowding, rioting, escalation of emotional arousal) runs on
  the same entities as SEAS-VIS (macro), "enabling the individuals to sense and react to local events in real time".
- The paper says agents; "actor" does not appear. "Actor" elsewhere is overloaded (LEAD,
  `perplexity/2026-11-21-actor-term-agent-sims.md`): a modelled individual in social simulation (Concordia), a
  message-passing unit in the actor model, a role-playing virtual character in NPC research, any world object in Unreal.

## Language models as NPC minds

- GARP, Molino et al., arXiv 2611.11064 VERIFIED: a 3B model run locally "requires ~13 seconds per generation on a
  consumer GPU, and each agent needs over 100 calls per simulated day" (about 130 chat calls per agent per day, Table I);
  planning at day boundaries, action selection spread through the day.
- Affordable Generative Agents, Yu et al. (Tencent), TMLR 2024, arXiv 2402.02053 VERIFIED (abstract): repetitive
  agent-environment LLM calls replaced by learned policies; social relationships modelled to cut inter-agent calls.
- Generative Agents (25 agents), OpenCity (10,000 agents, ~70 % fewer requests), Project Sid, Agora: LEAD
  (`perplexity/2026-11-21-llm-npcs-at-scale.md`). The common pattern: deterministic policies for movement, perception
  and routine; the model only for player-facing or consequential moments; event-driven calls; caching.

## Needle

- needle-rs WASM README (raw.githubusercontent.com/Geekgineer/needle-rs/main/crates/needle-wasm/README.md) VERIFIED:
  one module runs Needle 3 (`NeedleV3Wasm`, `needle3.cact` 35.3 MB, weights Apache-2.0, KV cache 8.8 MB at 512
  positions, reasons in `<think>` first, no tool retrieval) and Needle 2 (`NeedleV2Wasm`, `needle2.cact` 13.7 MB,
  weights MIT, about 23 MB of linear memory, `retrieve_tools`, schema-constrained `generate`). `confidence_for` scores a
  completion (Needle 3: a correct call 0.93, a wrong one 0.26; a bare query 0.80, meaningless); `run_json` returns `[]`
  to abstain. Single-threaded; linear memory never shrinks. The package is MIT.
- humm-tauri's integration (its own records, read in that repo): one typed action registry is the only capability
  surface, serialised id-sorted to one tools JSON, bound to the engine once and rebound only when the JSON changes;
  every returned call is re-validated against the registry; calls under 0.85 confidence are never auto-run. Needle 2
  base 22/30 top-1 on a 25-tool set; 0.3-6 s a call on desktop, up to about 49 s on a loaded phone.
- Phone-browser numbers for small models are thin (LEAD, `perplexity/2026-11-21-small-model-mobile-browser.md`: one blog
  measured SmolLM2 360M at 62.9 tok/s on WebGPU against 1.6 tok/s on WASM).

## What this repo does with it (ENGINEERING)

- Gaze is local presentation on the main thread, reacting the frame a thing is seen (the brain reacts 6+ s late by
  design). GTA's shape: polled every ~8 frames per person with an offset, look holds of 0.5-4 s and a 4 s refusal after
  a look; head +-90/+-45 deg with the torso helping past it; eased head velocity, a short head latency and a per-person
  head-mover trait (Andrist); Hitman-style pulses (radius and facing angle) for crashes, knocks, shots and sirens, with a
  staggered, neuroticism-scaled latency and some who never react.
- The spine: one declarative registry of what a resident does and reacts to (the SWS "workflow of states, transitions
  and messages", humm-tauri's registry), from which the brain's parallel arrays are derived and the model's tools JSON
  exported.
- Minds: Needle in a Worker as an asynchronous advisor over a small closed tool set, used only for player-facing moments
  (the person the player looks at) and event groups; a deterministic picker answers whenever the model is off, loading,
  slow or unsure (the AGA/GARP pattern). Never in the frame loop, never on the wire.

## Ambient behaviour

- Game AI Pro 3, chapter 35, "Ambient Interactions: Improving Believability by Leveraging Rule-Based AI" VERIFIED
  (gameaipro.com PDF): the environment is marked up with "smart locations" that run small rule scripts over a shared
  tuple space (a seat predicate plus a reservation predicate, so a seat is taken the moment the action is committed);
  for a sitting group, a rule designates one random talker, the others' look-at IK targets a random sitting partner, and
  when the talk action ends the talker is cleared and a new one picked; NPCs nearby may join a running script late.
- The idle-behaviour answer (`perplexity/2026-11-21-npc-idle-ambient-behaviours.md`, LEAD): weighted, context-filtered
  choice of short interruptible actions (weight shifts, look at traffic or shop windows, phone, leaning) with per-person
  cooldowns, randomised durations, per-person phase offsets for looping motion, and decisions staggered across the
  crowd (about once a second per person) so nobody moves in sync.

## Sources

- reVC source: github.com/Cai1Hsu/re3 (branch `miami`): `src/peds/Ped.cpp`, `src/peds/PedIK.cpp`.
- Andrist et al. 2012: https://graphics.cs.wisc.edu/Papers/2012/APMG12a/APMG12a.pdf
- Hitman: https://www.gamedeveloper.com/design/the-ai-of-hitman-2016-
- AC Unity talk page: https://www.gamedeveloper.com/programming/video-behind-the-massive-crowds-of-i-assassin-s-creed-unity-i-
- SWS concept paper: https://www.rivista.ai/wp-content/uploads/2025/03/sws.pdf
- GARP: https://arxiv.org/pdf/2611.11064 ; AGA: https://arxiv.org/pdf/2402.02053
- needle-rs: https://github.com/Geekgineer/needle-rs
- Raw answers: `perplexity/2026-11-21-*.md` (table in README.md).
