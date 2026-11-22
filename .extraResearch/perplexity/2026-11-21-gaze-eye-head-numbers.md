> Question: For animating where a virtual human looks, what do measurements of real human gaze shifts report about how the eyes, head and torso share a gaze shift (how much of the turn each takes, their speeds, latencies, the order they move in), how long people hold a fixation, and how often people glance at passers-by or moving vehicles in public spaces? Give the reported numbers with the studies they come from, and cite primary sources (neuroscience and animation papers).

For animation, the strongest quantitative evidence supports an **eyes-first, head-following, torso-lagging** model, with the exact split depending mainly on target eccentricity, posture, and task.

## Eye, head, and torso contributions

- **Small horizontal shifts:** Eye movements dominate. Shifts below roughly \(20^\circ\) are usually made almost entirely with the eyes; head involvement increases as amplitude grows.[4]
- **Around \(30^\circ\):** The head contributes approximately **one-third of the gaze displacement**; larger shifts produce progressively greater head contributions.[4]
- **Torso contribution:** The VR study by **Kleiner et al. (2019)** measured eye, head, and torso coordination across target distances and directions. It found substantial individual variability in head-movement tendency and showed that torso motion becomes more relevant for larger or more eccentric shifts, motivating gaze zones with different eye–head–body contributions.[1]
- **Order and latency:** In conventional eye–head gaze shifts, the eyes generally begin first. In control trials, the eyes preceded the head by **\(67 \pm 22\) ms**, using a \(20^\circ/\mathrm{s}\) onset threshold for both movements.[5]
- **Variation in ordering:** Head-first behavior also occurs, especially when targets are highly eccentric, salient, auditory, predictable, or when the observer’s vigilance and posture favor early orienting. The animation model of **Lee et al. (2012)** treats head latency as a variable rather than a fixed constant and uses approximately **\(-100\) ms to \(+100\) ms** as a practical range relative to eye onset: negative values mean head-first, positive values eye-first.[9]
- **Coordination:** Eye and head onsets are usually closely synchronized rather than separated by a long delay.[5]
- **Head speed:** Head movement is not a single fixed-speed rotation. It accelerates and decelerates with the gaze shift, and head acceleration and contribution increase when the initial head position is more eccentric relative to the torso center line.[5] The cited studies emphasize individual variability rather than one universal head-speed value.
- **Eye speed:** The relevant eye movement is typically a saccade: fast, ballistic, and completed before or near the beginning of the compensatory head movement. The supplied primary sources do not report a single representative angular-speed number that should be used universally.

## Fixation duration

The sources retrieved here do not provide one directly comparable “ordinary fixation duration” value for natural gaze shifts. They do show that fixation timing is strongly task- and scene-dependent:

- In a pedestrian–vehicle study, participants’ gaze patterns changed with vehicle distance: at greater distances they looked toward the road or surrounding environment, then shifted toward the vehicle windshield as it approached.[8]
- A naturalistic pedestrian study reported that vehicles **25–90 m away** were viewed infrequently but for relatively long durations.[3]
- In a controlled traffic-scene experiment, viewing periods ranged from **100 to 4,000 ms**, but those were experimentally imposed scene durations, not a direct estimate of natural fixation duration.[7]

Thus, for an animation system, a single fixed fixation time would be poorly supported. A better model uses shorter, more transient fixations for active scanning and longer holds when evaluating a distant or behaviorally important object.

## Glances at passers-by and moving vehicles

The strongest numerical result in the retrieved public-space literature concerns vehicle–pedestrian encounters:

- **Pipkorn et al. (2024)** recorded bidirectional gazing during road crossings. The number of glances toward the vehicle or pedestrian ranged from:
  - **Protected crossings:** 1–4 glances; median **1**, SD **0.66**
  - **Designated crossings:** 1–5 glances; median **1**, SD **0.86**
  - **Undesignated crossings:** 1–5 glances; median **2**, SD **1.11**[2]

These are encounter-level counts, not a percentage of all public-space passers-by or vehicles. The retrieved sources do not establish a general population rate such as “people glance at 30% of passers-by.”

For animation, the defensible implementation is therefore:

- Use predominantly **eye-led shifts** for small targets.
- Add head rotation increasingly beyond about **\(20^\circ\)**, with roughly **one-third head contribution at \(30^\circ\)** as an initial reference.
- Start the head around **67 ms after the eyes** by default, while allowing approximately **\(-100\) to \(+100\) ms** variation.
- Add torso rotation mainly for larger, more eccentric, or sustained reorientations.
- Model vehicle encounters with roughly **one or two glances per crossing interaction**, with occasional repeated glances up to four or five.[2]
- Make distant vehicles less frequently but longer inspected, and shift gaze toward the windshield as the vehicle approaches.[3][8]

The most directly useful primary sources are the VR coordination study by **Kleiner et al. (2019)**, the neurophysiology work reporting the **67-ms eye–head lead**, and the animation model by **Lee et al. (2012)**.[1][5][9]

[1] Eye, Head and Torso Coordination During Gaze Shifts in Virtual Reality | ACM Transactions on Computer-Human Interaction (http://dl.acm.org/doi/10.1145/3361218)
[2] Naturalistic Analysis of Bidirectional Gazing During Vehicle-Pedestrian Encounters at Road Crossings - Linda Pipkorn, Thomas Zach Noonan, Joshua Domeyer, Bruce Mehler, Bryan Reimer, Pnina Gershon, 2024 (https://journals.sagepub.com/doi/full/10.1177/10711813241276467)
[3] Pedestrian gaze pattern before crossing road in a naturalistic ... (https://link.springer.com/article/10.1186/s12544-023-00605-1)
[4] The Eye-Head Mover Spectrum: Modelling Individual and Population Head Movement Tendencies in Virtual Reality (https://www.arxiv.org/pdf/2602.06164)
[5] Human eye-head gaze shifts preserve their accuracy and spatiotemporal trajectory profiles despite long-duration torque perturbations that assist or oppose head motion | Journal of Neurophysiology | American Physiological Society (https://journals.physiology.org/doi/full/10.1152/jn.01092.2011)
[6] Gaze-cued shifts of attention and microsaccades are sustained for whole bodies but are transient for body parts (https://link.springer.com/content/pdf/10.3758/s13423-022-02087-z.pdf)
[7] Visual Attention of Pedestrians in Traffic Scenes: A ... (https://link.springer.com/chapter/10.1007/978-3-030-80012-3_18)
[8] Gaze Patterns in Pedestrian Interaction with Vehicles | Proceedings of the 11th International Conference on Automotive User Interfaces and Interactive Vehicular Applications (http://dl.acm.org/doi/10.1145/3342197.3344523)
[9] [PDF] A Head-Eye Coordination Model for Animating Gaze Shifts of Virtual ... (https://graphics.cs.wisc.edu/Papers/2012/APMG12a/APMG12a.pdf)
[10] Head and body cues guide eye movements and facilitate target ... (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10259675/)
