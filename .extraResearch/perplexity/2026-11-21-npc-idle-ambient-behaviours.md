> Question: What idle and ambient behaviours make non-player pedestrians in open-world games look alive when they are standing, waiting or walking (fidgets, weight shifts, looking around, glancing at the player, phone use, leaning, small groups), and how do published sources (talks, papers, write-ups) describe scheduling or selecting them so many characters don't move in sync? Cite sources with concrete parameters where available.

Non-player pedestrians look alive when their behavior combines **small, interruptible actions**, **subtle body motion**, and **social or environmental responses**, rather than repeating a single “idle” animation.

## Useful ambient behaviors

- **Micro-fidgets while standing:** weight shifts, relaxed sway, foot repositioning, posture correction, shoulder rolls, head turns, brief stretches, adjusting clothing, scratching, yawning, coughing, or checking a watch.
- **Attention shifts:** look toward traffic, storefronts, sounds, nearby pedestrians, landmarks, or the player; briefly make eye contact, then look away. Directed look-at animation and inverse kinematics can make even a stationary character appear aware of nearby actors.[10]
- **Personal activities:** phone checking, texting, drinking, smoking, eating, reading, taking photographs, or inspecting an object. These work best as short actions that return to a neutral standing state.
- **Waiting behavior:** alternate between standing, glancing toward the expected arrival point, checking a phone, looking at a watch, changing stance, and taking a few steps before returning.
- **Leaning and support:** lean against walls, railings, poles, vehicles, or counters; shift between supported and unsupported poses.
- **Walking variation:** vary stride length, speed, path curvature, head orientation, arm swing, pauses, avoidance behavior, and destination urgency.
- **Small-group behavior:** two or three pedestrians can converse, face one another, gesture, laugh, glance at passers-by, or split up. Published crowd work describes pedestrians milling around, crossing streets, and occasionally stopping to talk.[5]
- **Contextual “idle wander”:** when no higher-priority task is active, a character can stand idle or walk to a nearby point. This is described as a fallback that keeps an NPC active until its main sequence resumes.[3]
- **Role-specific actions:** shoppers browse, visitors inspect stalls, workers handle equipment, and resting characters select among several idle behaviors rather than using the same animation.[3]

Ambient-behavior systems commonly model the simplest case as a **“poser”**: an NPC performs a simple animation with default initial values and a specified duration.[1] More elaborate systems combine such atomic actions into generative patterns, allowing non-repetitive behavior and interactions between NPCs.[1]

## Scheduling and selection patterns

### 1. Use weighted, context-filtered action selection

Treat each ambient action as a candidate with requirements and a weight:

\[
P(a_i \mid c)=\frac{w_i(c)}{\sum_j w_j(c)}
\]

where \(c\) includes the NPC’s role, location, stance, nearby objects, weather, time of day, current attention target, and recent actions.

A practical candidate record might contain:

- Animation or action: `phone_check`, `look_traffic`, `weight_shift`
- Preconditions: standing, phone available, no conversation, not fleeing
- Duration range: for example, 1.5–4 seconds
- Cooldown: for example, 10–30 seconds
- Weight: contextual likelihood
- Interruptibility: whether walking, combat, dialogue, or navigation can cancel it
- Required target: phone, bench, partner, wall, or nearby point

Constraint-based systems have been proposed for selecting NPCs that are suitable for runtime situations, which is useful for choosing conversation partners, available seats, or participants in coordinated ambient actions.[7]

### 2. Select from behavior patterns, not isolated random clips

A pattern can specify an initial pose, an action, a duration, and possible follow-up actions. For example:

1. Neutral standing  
2. Look toward street  
3. Shift weight  
4. Check phone  
5. Resume neutral pose  

Generative behavior-pattern work specifically targets ambient behavior that is realistic, entertaining, and non-repetitive, including interactions between NPCs.[1]

### 3. Add per-NPC cooldowns and memory

Avoid immediately repeating the same action:

```text
if candidate.cooldown > 0: reject
if candidate == previous_action: reduce weight
if candidate.category == previous_category: reduce weight
```

Store a small history such as the last three actions, the last look target, and the time since the last social interaction. This prevents sequences such as `phone → phone → phone` even when each choice is technically random.

### 4. Randomize start times and durations

The most important anti-synchronization rule is to give every NPC independent timing:

\[
t_{\text{next}}=t_{\text{now}}+U(t_{\min},t_{\max})
\]

where \(U\) is a uniform random value, preferably with a per-character seed.

Use variation in:

- Initial idle phase
- Delay before the next decision
- Animation duration
- Blend-in and blend-out time
- Number of loop repetitions
- Look direction
- Follow-up action
- Walking speed

A crowd should not evaluate all characters on the same frame. One industry-oriented write-up describes low-cost ambient decisions—such as whether to check a phone—as being evaluated roughly **once per second**, with updates staggered across the crowd rather than performed for everyone simultaneously.[6] The precise interval is implementation-dependent, but the principle is valuable: use event-driven or low-frequency decision ticks, distribute them over time, and keep rendering/animation updates separate from behavior decisions.

### 5. Use phase offsets for looping motion

For periodic idle motion, assign each NPC a phase:

\[
x_i(t)=A\sin(\omega t+\phi_i)
\]

with independently chosen \(\phi_i\). This prevents identical sway, breathing, or weight-shift cycles from lining up. Also vary amplitude \(A\), frequency \(\omega\), and the time spent in each pose.

### 6. Schedule groups hierarchically

For a conversation:

1. Select a suitable initiator.
2. Find a nearby compatible partner.
3. Reserve both actors.
4. Give each a slightly different arrival time.
5. Assign independent gesture, gaze, and listening schedules.
6. End the interaction after a randomized duration.
7. Release the actors back to ordinary ambient behavior.

Crowd research and game-oriented work emphasize relationships between characters rather than treating pedestrians as independent agents.[8] Systems also use environmental queries—such as finding benches within a specified radius—to select relevant nearby opportunities.[3]

### 7. Separate behavior LOD from animation LOD

Not every pedestrian needs full decision-making. A level-of-detail system can:

- Simulate nearby characters with frequent decisions, look-at behavior, gestures, and conversations.
- Update mid-distance pedestrians less often.
- Use simple locomotion and occasional idle animation for distant pedestrians.
- Skip expensive speech or facial animation at low detail.

One described system uses LOD thresholds for conversations: high-detail characters receive speech and lip synchronization, while lower-detail characters can skip the utterance and wait about **two seconds**, because small talk can be interrupted and resumed without visible inconsistency.[4]

## A compact scheduling model

A robust ambient controller could operate like this:

```text
every decision_tick for a staggered subset of NPCs:
    if higher_priority_behavior_active:
        continue

    candidates = actions_valid_for(
        role,
        location,
        nearby_objects,
        nearby_people,
        time_of_day,
        weather
    )

    remove_actions_on_cooldown(candidates)
    reduce_weight_for_recent_actions(candidates)
    reduce_weight_for_recent_categories(candidates)

    action = weighted_random_choice(candidates)

    start(action, duration=random_range(action.min, action.max))
    set_cooldown(action, random_range(action.cooldown_min,
                                      action.cooldown_max))
```

The resulting behavior should combine **contextual eligibility**, **weighted choice**, **cooldowns**, **randomized durations**, **per-NPC phase offsets**, **staggered decision updates**, and **interruptible patterns**. Randomness alone is insufficient: without context, memory, and timing variation, characters may still select the same action at the same time or perform implausible activities.

[1] Microsoft Word - IEEEIntelligentSystems-45.doc (https://webdocs.cs.ualberta.ca/~duane/publications/pdf/2006ieeeis.pdf)
[2] An AI System for Large Open Virtual World (https://ojs.aaai.org/index.php/AIIDE/article/view/12705)
[3] A Memory-Driven Action Selection Framework for Scalable ... (https://www.csd.uwo.ca/~ebuitron/downloads/ProjectReport.pdf)
[4] Level of Detail AI for Virtual Characters in Games and ... (https://d-nb.info/1250173124/34)
[5] Believable and Reactive Crowds in Next Generation Games  (https://ojs.aaai.org/index.php/AIIDE/article/download/18767/18543/22452)
[6] GTA 6 NPC Technology: How Open-World Crowds Are Actually Simulated (https://dev.to/saeedjt/gta-6-npc-technology-how-open-world-crowds-are-actually-simulated-43j8)
[7] Spice It Up! Enriching Open World NPC Simulation Using Constraint Satisfaction (https://cdn.aaai.org/ojs/12715/12715-52-16232-1-2-20201228.pdf)
[8] Microsoft Word - DiGRA_conf_05AUG.docx (https://dl.digra.org/index.php/dl/article/download/589/589)
[9] Virtual Humans Animation in Informed Urban Environments | Proceedings of the Computer Animation (http://dl.acm.org/doi/abs/10.5555/872743.872906)
[10] Ambient Interactions (https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter35_Ambient_Interactions_Improving_Believability_by_Leveraging_Rule-Based_AI.pdf)
