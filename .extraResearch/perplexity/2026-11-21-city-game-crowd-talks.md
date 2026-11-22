> Question: Which conference talks, papers or developer write-ups describe the ambient pedestrian and crowd systems of specific shipped city games, for example Assassin's Creed Unity, Hitman (2016), Watch Dogs, Grand Theft Auto IV/V, Red Dead Redemption 2 or Cyberpunk 2077? For each, what does the source say the pedestrians perceive, how they react, how their look/attention is handled, how many are active, and what it cost? Cite the talk titles and links.

The strongest public sources are for **Assassin’s Creed Unity** and **Hitman (2016)**. The search results do not substantiate equivalent technical write-ups for Watch Dogs, Grand Theft Auto IV/V, Red Dead Redemption 2, or Cyberpunk 2077, so those games should not be presented as documented here.

## Assassin’s Creed Unity

### “Massive Crowd on Assassin’s Creed Unity: AI Recycling” — François Cournoyer, GDC 2015

[Talk page](https://www.gdcvault.com/play/1022411/massive-crowd-on-assassin-s) · [Recorded presentation](https://archive.org/details/GDC2015Cournoyer)

- **What pedestrians perceive:** The public abstract describes a “simplistic AI brain” rather than a detailed sensory model. It does not specify sight cones, hearing, memory, or individual threat evaluation.[1][3]
- **How they react:** The system supports “persistent, interactive NPCs,” but the abstract does not enumerate reactions. The related Unity crowd-event material identifies examples such as fistfights and pickpocketing as events for the player to encounter or intervene in.[3][5]
- **Look and attention:** NPCs are recycled through level of detail: low-resolution crowd representations are swapped for high-resolution NPCs without the player noticing. The talk describes pooling and AI LOD, not a detailed gaze or attention model.[1][3]
- **How many are active:** The stated limits are **40 fully simulated AIs**, **120 high-resolution models**, and up to **10,000 crowd NPCs visible/on screen** through the scalable system.[1][3]
- **Cost:** The available abstract gives limits rather than a millisecond or frame-time budget. Its central performance solution is to keep only 40 “real” AIs and 120 high-resolution characters while representing the rest more cheaply.[1][3]

### “Postmortem: Developing Systemic Crowd Events on Assassin’s Creed Unity”

[Talk page](https://www.gdcvault.com/play/1022211/Postmortem-Developing-Systemic-Crowd-Events)

- **What pedestrians perceive:** The public description says the system created **non-player-centric systemic events**, but does not publish a precise perception model.[5]
- **How they react:** It was designed to generate spontaneous opportunities such as **fistfights to stop** and **pickpockets to catch**, integrating systemic events with the existing crowd systems.[4][5]
- **Look and attention:** No public result here specifies gaze, visual attention, or appearance-selection rules.
- **How many are active:** The result describes “crowds of hundreds of NPCs,” while the companion AI-recycling talk supplies the more specific 40/120/10,000 scalability figures.[4][1]
- **Cost:** The public description discusses development and integration challenges but does not give a CPU, memory, or frame-time figure.[5]

## Hitman (2016)

### “The AI of Hitman (2016)” — Game Developer

[Write-up](https://www.gamedeveloper.com/design/the-ai-of-hitman-2016-)

- **What pedestrians perceive:** Crowd reactions are driven by **behaviour zones**. A zone emits a pulse within a specified radius and angle from an event source, and crowd agents that interact with it respond accordingly.[9]
- **How they react:** Individual crowd characters use a small finite-state-machine-like system with three principal states: **standing idle**, **walking**, and **pending walk** when congestion prevents movement. Characters may walk, stop, and acknowledge things in the environment; behaviour-zone pulses alter responses to events.[9]
- **Look and attention:** The write-up distinguishes between individual characters, who can move and acknowledge events, and designer-controlled groups. It does not provide a detailed rendering, facial-attention, or gaze-cost breakdown.[9]
- **How many are active:** The framework could support up to **1,200 agents in one crowd**, with up to **500 visible simultaneously**. For Hitman (2016), the article describes a system enabling **more than 1,000 crowd NPCs active in a level**.[9]
- **Cost:** No explicit per-frame cost is reported in the available text. The principal cost-control technique is behavioral simplification: a small state machine, congestion handling through “pending walk,” and event responses mediated by radius-and-angle behaviour zones.[9]

## Games for which no adequate source appeared in the retrieved material

No qualifying conference talk, paper, or developer write-up was identified in the available results for:

- **Watch Dogs**
- **Grand Theft Auto IV**
- **Grand Theft Auto V**
- **Red Dead Redemption 2**
- **Cyberpunk 2077**

In particular, anecdotal descriptions of pedestrians reacting to vehicles are not substitutes for technical documentation, and the retrieved Cyberpunk/GTA discussion was user commentary rather than a developer source.[8]

The clearest quantitative comparison supported by the sources is therefore:

| Game | Crowd scale | Explicit perception/reaction model | Appearance/attention detail | Published cost figure |
|---|---:|---|---|---|
| Assassin’s Creed Unity | 40 full AIs, 120 high-resolution models, up to 10,000 crowd NPCs on screen[1][3] | Simplified AI plus systemic events; public abstract lacks detailed senses[3][5] | AI/visual LOD and pooling; no detailed gaze model[1][3] | No millisecond figure in the retrieved abstract |
| Hitman (2016) | Over 1,000 active; framework up to 1,200, with 500 visible[9] | Behavior-zone pulses, radius/angle filtering, idle/walk/pending-walk states[9] | Individuals can acknowledge events; groups are more designer-controlled[9] | No millisecond figure in the retrieved write-up |

[1] GDC Vault - Massive Crowd on Assassin's Creed Unity: AI Recycling (https://www.gdcvault.com/play/1022411/massive-crowd-on-assassin-s)
[2] Video: Behind the massive crowds of Assassin's Creed Unity (https://www.gamedeveloper.com/programming/video-behind-the-massive-crowds-of-i-assassin-s-creed-unity-i-)
[3] Francois Cournoyer - "Massive Crowd on Assassin's Creed Unity: AI ... (https://archive.org/details/GDC2015Cournoyer)
[4] Learn about Assassin's Creed Unity's dynamic crowds at GDC 2015 (https://www.gamedeveloper.com/programming/learn-about-i-assassin-s-creed-unity-i-s-dynamic-crowds-at-gdc-2015)
[5] Postmortem: Developing Systemic Crowd Events on ... - GDC Vault (https://www.gdcvault.com/play/1022211/Postmortem-Developing-Systemic-Crowd-Events)
[6] Get coding advice from Insomniac, Riot and Ubisoft at GDC 2015 (https://www.gamedeveloper.com/programming/get-coding-advice-from-insomniac-riot-and-ubisoft-at-gdc-2015)
[7] Full text of "GDC 2015: Charles Lefebvre - "Networking Gameplay and AI in Assassin's Creed Unity"" (https://archive.org/stream/GDC2015Lefebvre/GDC2015-Lefebvre_djvu.txt)
[8] Please, PLEASE CDPR, before you finish support fully make it so these dumbass pedestrians don't dodge INTO my goddamn car! (https://www.reddit.com/r/cyberpunkgame/comments/18h9hig/please_please_cdpr_before_you_finish_support/)
[9] The AI of Hitman (2016) (https://www.gamedeveloper.com/design/the-ai-of-hitman-2016-)
[10] Learn about Assassin's Creed Unity's dynamic crowds at GDC 2015 | News | Game Developers Conference (GDC) (https://gdconf.com/news/learn_about_assassins_creed_un)
