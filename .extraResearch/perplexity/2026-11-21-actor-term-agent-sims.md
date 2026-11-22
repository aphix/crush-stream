> Question: What does the term 'actor' mean in agent-based simulation of societies and in game AI for non-player characters, and which systems, papers or engines use it for their simulated individuals or their decision-making units? Cite sources.

In both fields, **actor** denotes an entity that can perceive or receive information, maintain state, make decisions, and produce actions—but the emphasis differs:

- In **agent-based social simulation**, an actor is usually a simulated individual or collective decision-maker whose behavior is modeled explicitly. It may have goals, beliefs, norms, personality, relationships, and rules for responding to its environment. In actor-model implementations, the term can instead mean a concurrent computational unit that receives messages, makes local decisions, sends messages, or creates other actors.[2]
- In **game AI**, an actor commonly means either an autonomous **virtual character/NPC** that plays a role in the game world, or—more technically—an engine object that can be placed, transformed, spawned, destroyed, and extended with behavior components. The word therefore does not always mean “decision-maker.”[3][7]

## Uses in social and agent-based simulation

- **Concordia**: a generative agent-based modeling library models individual human-like actors, alongside a separate environment model called the “Game Master.” The actors are the individual decision-makers in the simulation.[1]
- **Actor-model simulation architectures**: work incorporating the actor model into SCIVE treats simulation modules as actors. Each actor runs locally, receives messages, responds to them, and makes decisions without requiring complete knowledge of other modules.[2]
- **Ultima Ratio Regum**: Mark Johnson describes the game’s procedurally generated population as “AI actors.” Their cultural, religious, political, and social values influence decisions and behavior, including greetings, conflicts, and reactions to outsiders.[9]
- **Virtual-actor research**: “virtual actor” is used for autonomous artificial characters whose behavior is specified at a higher level than ordinary scripts, potentially incorporating skills, psychological profiles, and changing rules.[5] Related work distinguishes increasingly autonomous actors—from guided characters to perceptive, emotional, decision-making entities.[6]

## Uses in game AI and NPC systems

- **Virtual actors as NPCs**: van Lent and Gratch distinguish virtual actors from virtual participants. A virtual actor plays a dramatic or functional role for the audience and may reason about entertainment, pacing, or story effects, whereas a virtual participant behaves more like a simulated player or teammate.[3]
- **Actor-based NPC decision units**: in this usage, the actor is the character-level unit that interprets perceptions, internal state, goals, and social context, then selects an action. Research on social NPCs uses personality and psychological variables to update internal states, appraisals, affinities, and decisions.[7]
- **Unreal Engine**: in Unreal Engine 4, an **Actor** is a world object that can be placed in a level and transformed, spawned, or destroyed. Components attached to the Actor provide functionality and behavior. A character or NPC may therefore be an Actor, but so can many non-character objects.[7]
- **Event-driven game systems**: some game-AI terminology uses Actor for the object that initiates an interaction or stimulus, while the object that detects and responds is called the Reactor. Here, “actor” describes an event role rather than a persistent individual.[4]
- **EVE Online and actor-oriented programming**: actor-model concepts have also been associated with languages and systems used in game programming; the cited simulation-architecture paper specifically mentions Stackless Python and EVE Online, while noting that Unreal Engine 3 games used “actors” as virtual-world objects.[2]

## Core distinction

| Context | What “actor” usually means | Main concern |
|---|---|---|
| Social ABM | Simulated person, group, institution, or decision-maker | Social behavior, adaptation, interaction, and emergence |
| Actor-model simulation | Message-passing computational unit | Concurrency, local state, and asynchronous communication |
| NPC/game-AI research | Autonomous virtual character playing a role | Perception, action selection, believability, and narrative function |
| Unreal Engine | Spawnable world object with components | World representation, lifecycle, transformation, and behavior |
| Event-driven game AI | Stimulus-producing object | Causation and interaction flow |

Thus, **actor is an overloaded term**: in social simulation it most often names the modeled individual; in NPC research it names the autonomous character or role-playing unit; and in engines such as Unreal it is a general world-object abstraction that may or may not itself contain the AI decision process.[1][2][3][7]

[1] Multi-Actor Generative Artificial Intelligence as a Game Engine - arXiv (https://arxiv.org/html/2507.08892v1)
[2] Incorparating the Actor Model into SCIVE on an Abstract ... (https://downloads.hci.informatik.uni-wuerzburg.de/incorporating-actor-model-SEARIS08.pdf)
[3] Virtual Humans as Participants vs. Virtual Humans as Actors (https://qrg.northwestern.edu/Resources/aigames.org/papers2002/MVanLent02.pdf)
[4] loading_version-E (https://journals.sfu.ca/loading/index.php/loading/article/download/73/72/367)
[5] Briefing Virtual Actors: a First Report (https://www.doc.gold.ac.uk/aisb50/AISB50-S02/AISB50-S2-Busetta-paper.pdf)
[6] Towards Intelligent Actors (https://www.academia.edu/127414364/Towards_Intelligent_Actors)
[7] Emergent social NPC interactions in the Social (https://arxiv.org/pdf/2207.13398)
[8] [PDF] BDI agents in social simulations: a survey - HAL (https://hal.science/hal-01484960/document)
[9] Group Modelling for Responsive Environments (https://www.cs.kent.ac.uk/events/2015/AISB2015/proceedings/aiAndGames/AI-games-15_submission_01--MarkJohnson-modelling.pdf)
[10] Findings from a human roles terminology survey: consensus or chaos? (https://pmc.ncbi.nlm.nih.gov/articles/PMC8936650/pdf/bmjstel-2018-000378.pdf)
