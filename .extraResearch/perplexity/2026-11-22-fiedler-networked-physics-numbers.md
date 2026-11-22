> Question: What do Glenn Fiedler's 'Networked Physics' articles on Gaffer On Games publish about sharing the state of physically simulated objects between machines: what is sent per object, at what rates and bandwidth, and how the receiving machine corrects its own simulation (thresholds, smoothing)? Quote the figures and cite each article.

Glenn Fiedler describes several approaches across the **Networked Physics** series. The figures differ by approach:

## 1. State synchronization: send physics state, then extrapolate

For each synchronized object, the server sends a physics-state update containing the object’s **position, orientation, linear velocity, and angular velocity**. The client applies the received state and uses its own simulation to extrapolate between updates rather than interpolating between snapshots.[3]

The target bandwidth in the series is typically **256 kbit/s** for the connection; packets are filled with as many object updates as fit under that budget.[3] Fiedler’s earlier snapshot-interpolation comparison used **18 Mbit/s**, illustrating the much higher cost of sending frequent complete snapshots.[3]

The receiver should **not smooth the incoming state at the simulation level**:

> “I recommend against trying to apply some smoothing between the state update and the current state at the simulation level.”[3]

Instead, it starts simulation from the authoritative received physics state, because smoothing would create an invalid, artificial state from which to extrapolate.[3] The visual result is already good without smoothing, but Fiedler gives a separate smoothing scheme for reducing positional error: use a blend factor of **0.95 for errors of 25 cm or less**, transitioning to **0.85 for errors of 1 m or more**, with linear blending between those distances.[3]

## 2. Older client/server article: broadcast after every physics update

In **“Networked Physics (2004)”**, the server broadcasts the physics state after every physics update caused by a client input RPC, together with the current input received in that RPC.[1] The article’s correction rule is:

- If the server and client positions differ by **more than 2 m**, snap immediately to the corrected position.
- If the difference is **more than 10 cm but no more than 2 m**, move the client **10% of the remaining distance** toward the server position.
- If the difference is **10 cm or less**, do nothing.[1]

Fiedler characterizes the 10%-per-update correction as an **exponentially smoothed moving average**: it removes visible discontinuities but leaves the client temporarily behind the authoritative position.[1] He recommends smoothing immediate quantities such as **position and orientation**, while directly snapping derivative quantities such as **velocity and angular velocity**.[1]

For prediction-based correction, the client compares its predicted physics state with the server’s state; when the difference exceeds a chosen threshold, it rewinds to the corrected state and time, then replays stored inputs to reconstruct the present state.[1]

## 3. Snapshot interpolation: send snapshots at a chosen rate

The snapshot-interpolation article describes sending complete world snapshots rather than relying on the receiver’s simulation. Its rule of thumb is to buffer enough delay to survive two consecutive lost packets; at **10 snapshots per second**, the recommended interpolation delay is **300 ms**.[8] Increasing the send rate to **30 snapshots per second** can provide comparable packet-loss protection with about **150 ms** of delay.[8]

This approach is bandwidth-intensive: Fiedler contrasts it with state synchronization by noting that the snapshot-interpolation demonstration used **18 Mbit/s**, whereas the state-synchronization target is around **256 kbit/s**.[3]

## 4. Virtual-reality optimization: reduce each object’s update size

For at-rest cubes, the VR article sends a single bit instead of repeatedly transmitting zero linear and angular velocities:

> “Instead of repeatedly sending (0,0,0) for linear velocity and (0,0,0) for angular velocity for at rest cubes, I send just one bit.”[4]

It also quantizes position to a resolution of **1/1000th of a centimeter**—that is, **0.001 cm**—within a known minimum/maximum range.[4] Rather than sending every object in every packet, it sends only the highest-priority subset that fits within a configured maximum packet size.[4]

In short, the receiving machine either **replaces its simulation state and extrapolates** from it (state synchronization), **renders between buffered snapshots** (snapshot interpolation), or **rewinds and replays inputs** (client prediction). The explicit correction thresholds are the 2004 article’s **2 m snap threshold**, **10 cm dead zone**, and **10% correction step**; the later state-synchronization article instead emphasizes starting from a valid authoritative state and avoiding simulation-level smoothing.[1][3]

[1] Networked Physics (2004) (https://gafferongames.com/post/networked_physics_2004/)
[2] Networked Physics (https://gafferongames.com/categories/networked-physics/)
[3] State Synchronization - Gaffer On Games (https://www.gafferongames.com/post/state_synchronization/)
[4] Networked Physics in Virtual Reality | Gaffer On Games (https://www.gafferongames.com/post/networked_physics_in_virtual_reality/)
[5] Introduction to Networked Physics - Gaffer On Games (https://www.gafferongames.com/post/introduction_to_networked_physics/)
[6] Physics (https://gafferongames.com/tags/physics/)
[7] Networking (https://gafferongames.com/tags/networking/)
[8] Snapshot Interpolation (https://gafferongames.com/post/snapshot_interpolation/)
[9] Snapshot Compression (https://www.gafferongames.com/post/snapshot_compression/)
[10] Game Physics (https://gafferongames.com/categories/game-physics/)
