> Question: What published research exists on how virtual characters in crowds decide where to look and how they move their head and eyes, so that they appear alive rather than doll-like? What did the studies measure about how viewers perceive it, and what models or parameters do they report? Cite papers (arXiv, SIGGRAPH, Motion in Games, IVA, etc.).

Published work falls into three connected areas: **where a character attends**, **how gaze shifts are animated**, and **whether observers judge the result as socially aware, plausible, or alive**. The most directly relevant crowd papers are the group-based gaze model and PedVR; the most detailed eye–head synthesis and perception work is largely in virtual-agent and avatar studies.

## Crowd gaze and attention models

- **“A Group-Based Approach for Gaze Behavior of Virtual Crowds”** models each character’s interest points using visual saliency, group perception, social norms, personality, gaze copying, and agent velocity. The paper treats crowds as socially organized groups rather than independent agents and reports that the resulting gaze behavior was judged plausible across scenarios.[3]
- **“Gaze Behaviors for Virtual Crowd Characters”** describes a crowd-engine extension in which agents attend to environmental objects, other characters, and the user. Its model combines saliency maps, attention mechanisms, saccadic behavior, and head-gaze animation, with user-controllable parameters for composing different behaviors.[1]
- **PedVR: Simulating Gaze-Based Interactions between a Real User and Virtual Crowds** couples multi-agent navigation with 3-D human-motion synthesis. An agent gazes at the user when distance, approach speed, visibility, and a gaze-condition variable satisfy thresholds. The reported rule includes a maximum gaze distance \(D_1\), an approach-speed envelope \(D_2\), and visibility \(v_{ui}\). The authors argue that gaze and gesture increase believability and perceived social awareness in immersive crowds.[6]

These studies generally do not model “aliveness” as a single perceptual variable. Instead, they use **plausibility, believability, social awareness, presence, and realism** as related outcomes.

## Eye–head coordination and gaze-shift animation

- **Real-Time Conversational Gaze Synthesis for Avatars**, Canales, Jain, and Jörg, ACM SIGGRAPH Conference on Motion, Interaction and Games 2023, uses captured two-person conversations. An RNN predicts eye rotation from speech features and the head motions of the speaker and listener.[2][4] The model therefore links gaze target selection to conversational timing and head movement rather than generating independent random eye motion.
- The same study explicitly evaluates how viewers perceive different eye-motion types. Its central perceptual question is whether synthesized eye movements make avatars appear believable in conversation, rather than merely technically smooth.[4]
- The crowd-gaze literature summarized in **Gaze Behaviors for Virtual Crowd Characters** draws on physiological eye, eyelid, and head movement, including saccades and coordinated eye–head shifts. A recurring design principle is that realistic gaze requires more than rotating eyeballs: the eye movement, head turn, timing, target selection, and environmental context must agree.[1]
- **AnimeGaze** formalizes gaze synthesis geometrically: once a fixation direction and target distance are specified, the required eyeball rotation is determined. Its contribution is mutual gaze with people in the physical environment, using sensed user gaze and dynamic target selection.[5]

A useful implementation decomposition from this literature is:

1. **Target selection:** saliency, task relevance, social relevance, group membership, personality, and user visibility.
2. **Fixation scheduling:** dwell time, interruptions, gaze copying, mutual-gaze episodes, and gaze aversion.
3. **Eye movement:** saccade direction, amplitude, velocity, fixation jitter, and smooth pursuit.
4. **Eye–head coordination:** eye-leading or head-leading timing, maximum eye eccentricity, head contribution, and return-to-neutral behavior.
5. **Contextual coupling:** speech, approach speed, obstacle avoidance, interpersonal distance, and visibility.

## What viewers perceive

The reported perceptual measures include:

- **Gaze plausibility:** whether the crowd appears to look at reasonable targets and whether its behavior fits the scene.[1][3]
- **Believability and social awareness:** especially in immersive crowd interaction, where gaze and gesture are treated as cues that an agent notices and responds to the user.[6]
- **Conversational naturalness and avatar believability:** in the SIGGRAPH/MIG work, observers compare synthesized eye-motion conditions in conversational avatars.[4]
- **Perceptual responsiveness to gaze:** avatar research shows that observers orient attention in response to avatar eye gaze, producing a gaze-cueing effect comparable in form to responses elicited by human gaze.[10]
- **Mutual-gaze regulation:** newer work measures eye tracking and reports changes in users’ eye movements, including more mutual-gaze episodes and gaze aversion when the avatar adapts to the user.[2]

The strongest general conclusion is that viewers do not judge liveliness from eye kinematics alone. They respond to **contingency**: the character should look at something meaningful, maintain fixation for a plausible interval, coordinate eyes with head and body, and change gaze when the social or navigational situation changes. A perfectly smooth but context-free eye animation can still look doll-like.

## Parameters and models worth extracting

For a practical crowd implementation, the papers collectively report or motivate parameters such as:

| Component | Parameters or rules reported |
|---|---|
| Target choice | Saliency, interest points, group structure, social norms, personality, velocity, user visibility [1][3] |
| User-directed gaze | Maximum distance \(D_1\), approach-speed envelope \(D_2\), visibility \(v_{ui}\), and a Boolean gaze condition [6] |
| Eye synthesis | Eye rotation toward a fixation vector; target distance determines the required gaze geometry [5] |
| Conversational gaze | RNN input from speech features plus speaker/listener head motion; output is eye rotation or gaze direction [4] |
| Mutual gaze | Finite states such as random gaze, mutual gaze, and gaze break, with transitions triggered by detected user gaze and elapsed time [2] |
| Perceptual outcomes | Plausibility, believability, social awareness, presence, naturalness, gaze cueing, and eye-tracking behavior [1][2][4][6][10] |

For **crowds**, the group-based and saliency-based models are the closest matches to “where should each person look?” For **doll-like avoidance**, the conversational synthesis work and the eye–head modeling literature are more useful because they address timing and coordination. For validation, measure not only realism ratings but also **looking-time distributions, mutual-gaze frequency, gaze-cueing effects, detection of target changes, and perceived social awareness**.

[1] Gaze Behaviors for Virtual Crowd Characters (https://www.academia.edu/55839248/Gaze_Behaviors_for_Virtual_Crowd_Characters)
[2] Investigating Mutual Gaze in Real-Time LLM-Driven Avatar ... (https://dl.acm.org/doi/10.1145/3806019)
[3] A group‐based approach for gaze behavior of virtual crowds ... (https://scispace.com/pdf/a-group-based-approach-for-gaze-behavior-of-virtual-crowds-4cv5fbgmt0.pdf)
[4] Real-Time Conversational Gaze Synthesis for Avatars (https://dl.acm.org/doi/fullHtml/10.1145/3623264.3624446)
[5] AnimeGaze: Real-Time Mutual Gaze Synthesis for Anime-Style Avatars in Physical Environments via Behind-Display Camera (https://ar5iv.labs.arxiv.org/html/2503.06324)
[6] PedVR: Simulating Gaze-Based Interactions between a Real User and Virtual Crowds (https://arishapiro.com/VRST_2016.pdf)
[7] Effect of Avatar Head Movement on (http://arxiv.org/pdf/2504.20844)
[8] Eye, Robot: Learning Expressive Gaze Dynamics via a VLM-Guided Transformer-VAE (https://arxiv.org/html/2610.19635)
[9] Knowing Where to Look: A Planning-based Architecture to Automate the Gaze Behavior of Social Robots* (https://ar5iv.arxiv.org/html/2210.02866)
[10] High-fidelity avatars for behavior and cognition research in ... (https://link.springer.com/article/10.3758/s13428-026-03139-1)
