# Sharing people between host and guests, and a guest's hits: what others do and publish

Asked 2026-11-22 for the open world's netplay work (shared bodies; guests acting on foot). Seven Perplexity answers
are in `perplexity/2026-11-22-*.md` (listed at the end). Each claim used below was checked in its source; the status
is VERIFIED (with the quote), NOT VERIFIED, or SOURCE UNREACHABLE.

## 1. Verified findings

### 1.1 Update rates a shipped open-world multiplayer project uses (Multi Theft Auto: San Andreas)

VERIFIED in the project's wiki, `https://wiki.multitheftauto.com/wiki/Server_mtaserver.conf` (defaults of the server
config):

| Setting | Default | The wiki's words |
|---|---|---|
| `player_sync_interval` | 100 ms | "the time in milliseconds between player sync packets" |
| `lightweight_sync_interval` | 1500 ms | "between lightweight (player) sync packets" |
| `ped_sync_interval` | 500 ms | "between ped sync packets when the ped is near the player" |
| `ped_far_sync_interval` | 2000 ms | "when the ped is far away from the player" |
| `unoccupied_vehicle_sync_interval` | 400 ms | "between unoccupied vehicle sync packets" |
| `keysync_mouse_sync_interval` | 100 ms | "minimum time in milliseconds between key sync packets due to mouse movement" |
| `ped_syncer_distance` | 100 | "the distance limit for remote synced peds" |
| `vehicle_contact_sync_radius` | 30 | "the radius in which any contact with a vehicle will turn the player into its syncer" |
| `bullet_sync` | 1 (on) | "can improve the reliability of shots when using certain weapons. However, it uses more bandwidth." |
| `vehext_percent` / `vehext_ping_limit` | 0 / 150 ms | extrapolation of remote vehicles, "should be considered experimental" |

So that project sends players at 10 Hz, nearby pedestrians at 2 Hz and far ones at 0.5 Hz, and hands a pedestrian or
an empty vehicle to a nearby player's machine (a "syncer") within a distance limit. The Perplexity answer gave 400 ms
for pedestrians and 1000 ms for empty vehicles: both wrong against the wiki.

### 1.2 Halo: Reach (GDC 2011, "I Shot You First", David Aldridge), from two written summaries of the talk

VERIFIED in `https://networkedgraphics.org/2011/05/13/halo-reach/`: "250kbits/s Minimum total upstream for the host
of a solid 16 player game", "675kbits/s Maximum total upstream bandwidth use from a single peer", "45kbits/s Maximum
bandwidth sent to one client from a host", "1kbit/s Host upstream required to replicate one biped to one client at
combat", "10hz Minimum packet rate for solid gameplay", and "ragdolls were synchronised in previous games, but only
initial state in Halo: Reach."

VERIFIED in `https://www.wolfire.com/blog/2011/03/GDC-Session-Summary-Halo-networking/`: "The priority of each object
determines how often its state information is sent to the client ... if a ragdoll is rolling down a hill behind him,
he doesn't care about that much at all, so it will update much less", and the talk's lesson "Change gameplay to
require less networking (e.g. don't network ragdolls)".

### 1.3 Glenn Fiedler, Gaffer On Games

VERIFIED in `https://gafferongames.com/post/state_synchronization/`: "I recommend against trying to apply some
smoothing between the state update and the current state at the simulation level ... the simulation extrapolates from
the state update so you want to make sure it extrapolates from a valid physics state"; the drawn error is smoothed
separately: "having 0.95 for small position errors (25cms or less) while having a tighter blend factor of 0.85 for
larger distances (1m error or above) gives a good result"; objects are sent by priority ("priority for the player
cube as 1000000 ... interacting (red cubes) ... 100 while at rest objects have priority of 1"); an object that has
just come to rest is resent until acknowledged.

VERIFIED in `https://gafferongames.com/post/networked_physics_2004/`: "if the two positions are significantly
different (>2m apart) just snap to the corrected position, otherwise if the distance ... is more than 10cms, move 10%
of the distance between the current position and the correct position. Otherwise do nothing", and "perform this
smoothing for immediate quantities such as position and orientation, while directly snapping derivative quantities
such as velocity".

## 2. Claims not verified (do not repeat as fact)

- Source engine lag compensation details (`sv_maxunlag`, rewind windows of 200 to 350 ms, a 250 ms cutoff in
  Battlefield 4 and Overwatch): SOURCE UNREACHABLE (Valve's wiki answers with a bot challenge) and the other pages
  cited are secondary.
- "Halo: Reach saved 10 to 12 % of total bandwidth by not networking ragdolls": NOT VERIFIED (only in a secondary
  summary; the two summaries read above do not give the figure).
- A testbed's "agreement fell from 92.6 % to 52.9 % without lag compensation": NOT VERIFIED (one repository's own
  claim, not read).
- "Multi Theft Auto decides a remote player's hits on the shooter's client": NOT VERIFIED (not found in the wiki text
  read; the source file was not read).
- The answers on cooperative games' hit authority cite frameworks and small projects, not shipped games: leads only.

## 3. How this repo's design compares

| Question | What the sources do | This repo (plan in flight) |
|---|---|---|
| Who simulates a pedestrian | MTA: a nearby player's machine, within 100 units | every machine computes the same crowd from the host's log; the host is the authority for anyone in physical trouble |
| How often a person's state is sent | MTA: players 10 Hz, near pedestrians 2 Hz, far 0.5 Hz. Halo: Reach: 10 Hz the least for solid play, by priority | one frame at 15 Hz for every shared person, standing cops included |
| Ragdolls | Halo: Reach: the initial state only, then each machine's own simulation; ragdolls made irrelevant to gameplay | the torso's place and velocity at 15 Hz while the body matters (hooked, dragged, lying), joints local |
| Bringing a local simulation into line | Fiedler: start from the authority's state; smooth only what is drawn (0.95 under 25 cm, 0.85 over 1 m); older rule: snap over 2 m, move 10 % over 10 cm | steer or drag the local body toward the record's place with its velocity fed forward; move every part at once past 3 m |

## 4. What follows for this repo

1. **The frame's rate is on the generous side.** 15 Hz for everybody is above the 10 Hz that both sources use for
   players and well above the 2 Hz MTA uses for pedestrians. A walking cop or a kneeling medic (a pose record) can
   be sent less often than a dragged body without a visible difference, since the receiver moves the row by its
   velocity. Candidate saving, to measure after the shared-bodies work lands: pose records every third frame (5 Hz).
2. **The 3 m "move everything at once" threshold** is in the range the sources use (2 m). No change.
3. **A guest's shots at moving targets.** The host carries out a guest's shot against the host's present world, while
   the guest aimed at a picture `INTERP_DELAY` (0.1 s) plus the link's delay old. The miss that causes is the target's
   speed times that age: a walking civilian (1.4 m/s) at 0.15 s is 0.2 m, inside a body's width; a car at 20 m/s is
   3 m. Shipped competitive games rewind targets to the shooter's time; the sources read here do not give a verified
   number for it. To decide after the guest lanes merge, from a measured row: a guest's pistol shot at a walking
   civilian and at a car crossing at 20 m/s, hit or miss on the host.
4. **Priority.** Both Halo: Reach and Fiedler send what matters to a receiver more often than what does not. The
   frame here is one table for every guest; per-guest priority is not built and is not needed at 35 records at most.

## 5. Raw answers

`perplexity/2026-11-22-remote-player-shots-on-an-authority.md`,
`perplexity/2026-11-22-sharing-physically-simulated-characters.md`,
`perplexity/2026-11-22-open-source-city-multiplayer-sync.md`,
`perplexity/2026-11-22-mta-sync-rates-and-authority.md`,
`perplexity/2026-11-22-coop-host-hit-authority.md`,
`perplexity/2026-11-22-halo-reach-ragdoll-networking.md`,
`perplexity/2026-11-22-fiedler-networked-physics-numbers.md`.
