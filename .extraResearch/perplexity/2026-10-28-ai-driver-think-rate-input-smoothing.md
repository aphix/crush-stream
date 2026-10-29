> Question: How do AI opponent drivers in arcade and open-world racing games (Need for Speed series, Burnout, GTA V/IV, Forza Horizon/Motorsport Drivatars, GRID, Gran Turismo, Mario Kart, Ridge Racer, rFactor/Assetto Corsa AI) decide and apply their controls? Specifically: (1) how often the AI 'thinks' (re-plans or re-decides targets) versus how often it applies controls each physics frame, with any published numbers (Hz, ms); (2) how they smooth throttle, brake, steering and nitrous so they look human: rate limits, ramp times, low-pass filters, PID controllers, hysteresis and minimum on/off durations; (3) how brake lights and nitrous are kept from flickering on and off every frame; (4) how this interacts with deterministic replays or recorded inputs. Cite developer talks (GDC, AI Game Programming Wisdom, Game AI Pro chapters), papers, modding docs or interviews, and say where a number is not published.

There is no public, cross-industry specification for these systems. The broad pattern is usually:

1. **A high-level driver decides a target**—racing line, target speed, overtaking action, recovery route, or boost use.
2. **A low-level controller converts that target into continuous inputs** every vehicle/physics update.
3. **Animation and effects use hysteresis and timers**, rather than directly mirroring instantaneous control values.

The exact frequencies, filter constants, PID gains, and minimum durations are generally unpublished for Need for Speed, Burnout, GTA, Forza, GRID, Gran Turismo, Mario Kart, Ridge Racer, rFactor, and Assetto Corsa.

## 1. Decision frequency versus control frequency

A useful distinction is:

- **Planning/decision loop:** chooses *what the driver is trying to do*.
- **Tracking/control loop:** computes steering, throttle, and brake values.
- **Physics loop:** integrates the vehicle every simulation step.

In a conventional implementation, the tracking loop runs at every physics tick, while tactical decisions run less often or only when events occur. For example, the AI might continuously track a racing-line point but reconsider overtaking, avoidance, or recovery only when it reaches a checkpoint, detects a blocked path, or enters a new corner.

For the named commercial games, published sources do not provide reliable values such as “planning at 10 Hz and controls at 60 Hz.” Claims about exact rates found in forums or reverse-engineering discussions should not be treated as official documentation.

### Game-specific public information

- **Forza Motorsport:** Turn 10 describes an AI-controller layer that follows a racing line and uses vehicle-physics information to determine suitable speed and steering. The published description does not state its planning frequency, physics tick rate, neural-network inference rate, or smoothing constants.[1][2]
- **Forza Drivatars:** Earlier Drivatar systems model a player's speed, turn angle, consistency, and driving style over track segments. That is a learned or recorded behavior model, not a published per-frame control specification.[3]
- **Need for Speed, Burnout, GTA IV/V, GRID, Gran Turismo, Mario Kart, and Ridge Racer:** public developer material generally explains behavior, rubber-banding, racing lines, or opponent design, but does not disclose complete control-loop timing or controller gains.
- **rFactor and Assetto Corsa:** modding and configuration material exposes vehicle physics, AI lines, difficulty, aggression, and sometimes path or planner parameters, but not a universal documented schedule for all AI control decisions.

Consequently, any precise number for these games should be labeled **unpublished unless obtained from source code, instrumentation, or a developer statement**.

## 2. How controls are usually smoothed

The most common architecture is not necessarily a textbook PID controller. It is often a combination of:

- Target-speed selection.
- Look-ahead steering toward a future racing-line point.
- Separate acceleration and braking decisions.
- Input slew-rate limits.
- Dead zones and hysteresis.
- Recovery overrides.
- Difficulty-dependent error, delay, or aggressiveness.

A generic input update might look like:

\[
u_{t+\Delta t}
=
\operatorname{clamp}
\left(
u_t + \operatorname{clamp}(u^\ast-u_t,-r_{\downarrow}\Delta t,r_{\uparrow}\Delta t),
0,1
\right)
\]

where \(u^\ast\) is the desired input and \(r_{\uparrow},r_{\downarrow}\) are rise and fall rates.

### Steering

Typical methods include:

- Aim at a look-ahead point on the racing line.
- Convert lateral or heading error into a steering target.
- Limit steering-wheel or steering-input rate.
- Reduce look-ahead or increase correction strength when the car is off line.
- Add noise, delayed corrections, or imperfect cornering at lower difficulty.

This can resemble a proportional controller or a “pure pursuit” controller, but commercial games often add bespoke speed-dependent and surface-dependent corrections. Public Forza descriptions confirm that the controller uses racing-line information and vehicle physics, but do not publish a steering PID, look-ahead distance, or rate limit.[1][3]

### Throttle and brake

Common logic is:

- Compute a target speed for the upcoming line segment.
- Apply throttle when current speed is below target speed.
- Apply braking when speed exceeds the target or the car must slow for a corner.
- Blend throttle and brake rather than switching instantly.
- Reduce throttle under excessive slip, yaw error, or poor traction.
- Add a hysteresis band so small speed errors do not cause rapid alternation.

A simple hysteresis rule could be:

\[
\text{brake on if }v>v_{\text{target}}+\epsilon_{\text{on}}
\]

\[
\text{brake off if }v<v_{\text{target}}-\epsilon_{\text{off}}
\]

with separate thresholds preventing chatter.

Some games may use PID-like speed control, but there is no published evidence that all the named games use one, nor are their gains publicly documented. Forza’s newer controller is described as supporting continuous throttle, brake, and steering behavior rather than merely binary inputs.[2]

### Human-like imperfection

“Human-like” behavior is often produced less by sophisticated control theory than by deliberately introducing:

- Reaction delay.
- Target-speed error.
- Variable braking points.
- Imperfect line tracking.
- Delayed throttle pickup.
- Occasional overshoot.
- Driver-specific aggression and consistency.
- Limited knowledge of traffic or opponents.
- Difficulty-dependent assistance or performance scaling.

Forza’s current public description explicitly says that its AI can make mistakes such as braking late, running wide, or leaving the track, rather than following only scripted perfect behavior.[1]

No public source in the available material gives validated values such as a 150-ms reaction delay, a 300-ms throttle ramp, or a particular low-pass cutoff for the named games.

## 3. Brake lights and nitrous

Brake lights should normally not be driven directly from the raw brake input every frame. A robust implementation separates **control state** from **visual state**.

For example:

```text
if brake_input > 0.08:
    brake_on_timer = max(brake_on_timer, 0.10 s)

if brake_on_timer > 0:
    brake_lights = ON
    brake_on_timer -= dt
else if brake_input < 0.03:
    brake_lights = OFF
```

This combines:

- An activation threshold.
- A lower deactivation threshold.
- A minimum-on timer.
- Optional filtering of the input signal.

The same pattern can be used for nitrous:

```text
if boost_request and boost_available and speed > minimum_speed:
    nitrous_on = true
    nitrous_lockout = 0.25 s

if nitrous_on and (
    boost_released
    or boost_empty
    or nitrous_lockout_expired
):
    nitrous_on = false
```

Nitrous commonly has additional gameplay rules:

- A minimum activation duration.
- A cooldown or resource constraint.
- Activation only in suitable gears or speed ranges.
- A tactical decision made at a lower frequency than the visual flame effect.
- A separate “requested,” “accepted,” and “currently firing” state.

The exact minimum on/off times for Need for Speed, Burnout, GTA, Mario Kart, or other named games are not published in the available developer material. If a game appears not to flicker, hysteresis, state machines, animation hold times, or resource constraints are plausible explanations, but the exact implementation cannot be asserted without source code or instrumentation.

## 4. Deterministic replays and recorded inputs

There are two major replay designs.

### Input replay

The replay stores sampled control inputs—steering, throttle, brake, gear, boost, and sometimes assists—and re-simulates the vehicle.

Advantages:

- Small storage size.
- Camera and rendering can be changed later.
- The same AI/player controller can be replayed.

Requirements:

- Deterministic physics.
- Identical fixed timestep.
- Identical random-number seeds.
- Identical collision ordering and floating-point behavior.
- Stable AI decisions.

If the original AI thinks at a different cadence from physics, the replay must preserve that cadence or store the resulting control samples at the correct timestamps. Recomputing decisions during playback can diverge if the simulation has even tiny numerical differences.

### State/keyframe replay

The system stores periodic vehicle states—position, velocity, orientation, damage, and sometimes AI state—and interpolates or corrects between them.

Advantages:

- More robust across nondeterministic physics.
- Better for networked or heavily scripted games.

Disadvantages:

- Larger data.
- Less faithful if interpolation replaces true simulation.
- More complicated correction and collision handling.

### Recorded trajectory or ghost replay

Some games record a path, telemetry, or a ghost rather than reproducing every physical input. Such a replay may show a car following a recorded line without running the original opponent AI at all.

Forza’s public material describes Drivatar behavior as derived from recorded player behavior and track-segment driving characteristics, while the available discussion does not specify the exact replay serialization or simulation cadence.[3] A community report describes the general idea of replaying stored inputs, but it is not authoritative documentation.[4]

A deterministic replay does **not** require the AI to “think” every physics frame. It requires the replay system to reproduce the same sequence of controller outputs—or to restore enough state that differences do not matter. A common design is therefore:

```text
fixed physics tick:
    if planner_due or event_triggered:
        update tactical goal

    update steering/throttle/brake controller
    update visual-state timers
    integrate physics
```

The planner can run at a lower rate, while the controller and physics remain fixed-rate. For replay, either the planner’s decisions are deterministic and recomputed identically, or its outputs and state transitions are recorded.

## What can be stated confidently

- Continuous vehicle control is normally applied at the physics or fixed-simulation rate.
- Tactical decisions are commonly event-driven or lower-frequency, but exact frequencies are rarely disclosed.
- Smooth behavior usually combines target tracking, slew limits, hysteresis, blending, and deliberate imperfections.
- Brake lights and nitrous should use visual/gameplay state machines rather than raw per-frame thresholds.
- Replays either store inputs, store states/keyframes, or replay a ghost trajectory.
- Exact Hz values, ramp times, filter coefficients, PID gains, and minimum durations for the listed commercial games are **not publicly established in the cited material**.

The strongest published evidence available here is Forza’s description of a physics-aware AI controller following racing-line targets, its move toward continuous control values, and its deliberate modeling of realistic mistakes; those sources do not disclose the low-level timing or smoothing constants.[1][2][3]

[1] Forza Motorsport's New AI and Physics Make Every Race Competitive (https://forza.net/news/forza-motorsport-drivatars-tire-physics)
[2] How Forza Rebuilt Their Drivatar AI System (https://www.aiandgames.com/p/how-forza-rebuilt-their-drivatar)
[3] GitHub - Manthan-13521/GestureKart-AI-Racing: 🏎️ AI Gesture Controlled Racing Game using MediaPipe (https://github.com/Manthan-13521/GestureKart-AI-Racing)
[4] You can not tell me the A.I. doesn't ch**t after seeing this... (https://www.reddit.com/r/forza/comments/rr2mlq/you_can_not_tell_me_the_ai_doesnt_cht_after/)
[5] How Forza's Drivatar Actually Works - Game Developer (https://www.gamedeveloper.com/design/how-forza-s-drivatar-actually-works)
[6] Forza - Wikipedia (https://en.wikipedia.org/wiki/Forza)
[7] ai-f1-racing-game/README.md at main · hirosichen/ai ... - GitHub (https://github.com/hirosichen/ai-f1-racing-game/blob/main/README.md)
[8] drivers/src/vehicle.rs at 81fa6317626980dc2269dd916f5c6529110561e4 · realaaravdas/drivers (https://github.com/realaaravdas/drivers/blob/81fa6317/src/vehicle.rs)
[9] Game Settings Required for AI Driving - MOZA Support (https://support.mozaracing.com/en/support/solutions/articles/70000686033-game-settings-required-for-ai-driving)
[10] RACE YOUR WAY - EA SPORTS™ F1® 25 DEEP DIVE (https://www.ea.com/games/f1/f1-25/news/f1-25-advancements-deep-dive)
