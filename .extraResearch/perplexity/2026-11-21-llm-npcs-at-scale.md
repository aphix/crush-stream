> Question: What research and shipped projects use language models to drive the decisions or inner thoughts of many non-player characters in a simulated town or city, and how do they keep the cost and latency bounded as the number of characters grows? What was measured (calls per character, latency, believability ratings)? Cite papers (arXiv etc.) and project write-ups.

The clearest lineage is **Generative Agents** (25 NPCs in a Sims-like town), followed by larger-scale systems such as **Project Sid**, **OpenCity**, and newer cost-focused implementations such as **Affordable Generative Agents**. The main scaling pattern is consistent: reserve LLM calls for socially or behaviorally important events, use memory retrieval and summaries instead of full history, parallelize independent agents, cache repeated results, and replace routine actions with learned or scripted policies.

## Main research systems

| Project | Scale and purpose | How cost/latency is bounded | Reported measurements |
|---|---|---|---|
| **Generative Agents: Interactive Simulacra of Human Behavior** | A virtual town containing **25 agents** with memory, reflection, planning, and natural-language interaction.[1] | Agents do not reason continuously at every frame. They maintain a memory stream, retrieve only relevant memories, periodically synthesize reflections, and use plans to organize future behavior. This reduces the need to send the entire history to the model each time. | The paper reports an evaluation of individual and emergent believability, with ablations showing that observation, planning, and reflection each materially improve behavior.[1][2] The cited results describe believability qualitatively and through human evaluation, but the available project excerpts do not provide a simple “calls per character” or end-to-end latency figure. |
| **Project Sid: Many-agent simulations toward AI civilization** | Multi-agent worlds in which many characters interact with one another and human players.[3] | Its PIANO architecture separates and aggregates outputs across agents and modalities. The paper explicitly notes that combining speech, gaze, facial expression, and body-part actions into one call does not scale, so orchestration and parallel output generation are used instead.[3] | The available excerpt emphasizes the real-time coherence and latency problem but does not expose a single calls-per-character or believability number.[3] |
| **OpenCity: A Scalable Platform to Simulate Urban Activities** | LLM-driven urban simulation evaluated across six global cities, scaling to **10,000 agents**.[4] | OpenCity uses prompt distillation, request reduction, and scheduling that becomes more efficient as the population grows. The system also reduces token usage and avoids treating every low-level activity as a fresh full LLM decision.[4] | It reports a **70% reduction in LLM requests**, **50% reduction in token use**, and roughly **600–635× acceleration**. A 10,000-agent daily simulation runs in about **one hour on commodity hardware**; average simulation time per agent falls from **36.25 seconds with one agent to 0.06 seconds with 10,000 agents**.[4] |
| **Affordable Generative Agents (AGA)** | A framework explicitly aimed at making believable agents cheaper and more responsive.[5] | AGA replaces repetitive agent–environment LLM decisions with learned policies while retaining LLM reasoning for interactions where language-level judgment matters. This is the most direct answer to the “every NPC, every action” scaling problem.[5] | The search excerpt describes the cost-saving architecture but does not expose a single calls-per-character or human believability score. Its motivation is specifically that ordinary LLM-agent designs remain expensive and latent at larger scale.[5] |
| **MobileCity** | Large-scale urban activity simulation with experiments involving **4,000 agents**.[6] | It targets efficient urban simulation and reduces dependence on slow, multi-turn LLM dialogue. The paper positions efficiency and behavioral realism jointly rather than using an LLM for every low-level action.[6] | The available result reports higher human-like urban dynamics and better simulation efficiency than baselines, but not a directly stated per-character call count or latency value.[6] |

## Shipped or public implementations

**Agora** is a public simulated town with **15 AI residents** using memory, reflection, planning, and collective behavior. Its write-up reports approximately **2,492 LLM calls per simulated day**, or about **166 calls per character per day** on average.[7]

Its cost controls include:

- On-disk response caching, including complete reuse on identical reruns.
- Batched importance scoring for memories.
- Heuristics for routine perceptions, reserving model calls for consequential events.
- A replaceable small/local model backend.
- Event-driven rather than continuously scheduled conversations.[7]

The project reports a **95.9% consistency score** in an interview-based believability evaluation and a **2.2% contradiction rate**.[7] Those figures should be treated as project-specific evaluation results rather than directly comparable to the human-rating protocol in the original Generative Agents paper.

## A useful lower-bound example: GARP

**GARP: Real-Time Generative Agents on Local Hardware in a Game Engine** is valuable because it publishes an unusually explicit call budget. With its tested setup, each agent requires roughly **130 chat-model calls and 80 embedding calls per simulated day**, so \(N\) agents require approximately \(130N\) chat calls and \(80N\) embedding calls per day.[8]

The reported local-generation latency is about **13 seconds per generation for a 3B model on a consumer GPU**. Ten agents performing 130 calls each would take roughly **4.7 wall-clock hours if executed sequentially**, excluding embeddings.[8] GARP therefore uses:

- Asynchronous execution across agents.
- Scheduling of planning at day boundaries.
- Distributed action selection.
- Event-driven conversations, averaging roughly three conversation events per day.
- A separation between model calls that can overlap and calls that must occur at interaction time.[8]

GARP did **not** report human believability ratings; its evaluation used log-based checks of whether intended behavior occurred.[8] That distinction matters: behavioral correctness and human-perceived believability are not the same metric.

## What the measurements show

### Calls per character

The most explicit figures in the available sources are:

- **GARP:** approximately **130 chat calls + 80 embedding calls per character per simulated day**.[8]
- **Agora:** approximately **2,492 total LLM calls per day across 15 agents**, or about **166 calls per character per day** if evenly distributed.[7]
- **OpenCity:** reports aggregate reductions—**70% fewer LLM requests** and **50% fewer tokens**—rather than a fixed per-agent daily call count.[4]

These numbers are not directly comparable because “call” may mean a chat completion, an embedding request, a batched request, or a request after caching and heuristic filtering.

### Latency

- GARP reports roughly **13 seconds per local 3B generation**, making naive sequential execution untenable.[8]
- OpenCity reports an average simulation-time reduction from **36.25 seconds per agent to 0.06 seconds per agent** as the population rises from 1 to 10,000, largely through scheduling and prompt distillation.[4]
- Project Sid identifies minimal response latency as a central engineering constraint, especially when one character must produce several simultaneous outputs.[3]
- AGA explicitly targets latency by eliminating repetitive environment decisions from the LLM loop.[5]

The apparent improvement with more agents in OpenCity is not because individual LLM inference becomes intrinsically faster. It reflects amortized scheduling, batching, and a simulation metric measured over the whole population.

### Believability and realism

- Generative Agents reports human evaluation of believable individual and emergent social behavior and shows through ablations that memory observation, planning, and reflection contribute to believability.[1][2]
- Agora reports **95.9% consistency** in interview self-reports and a **2.2% contradiction rate**.[7]
- OpenCity reports that its LLM agents preserve strong behavioral faithfulness and compare favorably with rule-based urban agents, but its principal metrics are urban-dynamics fidelity and simulation efficiency rather than a single NPC believability rating.[4]
- GARP explicitly reports **no human-rater believability study**.[8]

## Overall design pattern

Across these systems, scalable NPC simulation is not achieved by giving every character an unrestricted, synchronous “inner monologue” every frame. It is achieved by dividing behavior into tiers:

1. **Cheap deterministic or learned policies** handle movement, routine schedules, perception filtering, and repetitive environment interactions.
2. **Memory retrieval and summaries** provide only the context relevant to the current decision.
3. **LLM calls** are reserved for planning, reflection, dialogue, unusual events, and socially consequential decisions.
4. **Event-driven scheduling** avoids calling the model when nothing important changed.
5. **Parallelism, batching, and caching** reduce wall-clock latency and repeated inference.
6. **Small or local models** handle high-volume tasks, while larger models are reserved for scarce high-value decisions.

The strongest quantitative evidence for population scaling comes from OpenCity’s 10,000-agent result; the strongest explicit per-character call accounting comes from GARP; and the clearest human-believability lineage comes from Generative Agents and its public descendants.[1][4][7][8]

[1] GARP: Real-Time Generative Agents on Local Hardware in a Game Engine (https://arxiv.org/html/2611.11064)
[2] Affordable Generative Agents (https://arxiv.org/html/2402.02053)
[3] Generative Agents: Interactive Simulacra of Human Behavior (https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763)
[4] OpenCity: A Scalable Platform to Simulate Urban Activities ... (https://arxiv.org/html/2410.21286v1)
[5] MobileCity: An Efficient Framework for Large-Scale Urban ... (https://aclanthology.org/2026.eacl-industry.21.pdf)
[6] Generative Agents: 25 AI Characters Living in a Simulated Town (https://www.zhongzhuzhou.org/blog/2026-03-09-2026-03-09-GenerativeAgents-technical-review-en/)
[7] GitHub - shaswatk45/Agora: A society of generative agents — 15 AI townspeople with memory, reflection & planning, and collective behavior that emerges unscripted (https://github.com/shaswatk45/Agora)
[8] Project Sid: Many-agent simulations toward AI civilization (https://arxiv.org/html/2411.00114v1)
[9] GenWorld: Empirically Grounded Urban Simulation ... (https://arxiv.org/html/2606.27650v1)
[10] Generative Agents: Interactive Simulacra of Human Behavior | Proceedings of the 36th ... (https://dl.acm.org/doi/10.1145/3586183.3606763)
