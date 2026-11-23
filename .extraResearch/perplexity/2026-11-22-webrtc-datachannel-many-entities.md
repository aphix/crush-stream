> Question: Browser games that use WebRTC data channels in a peer-to-peer or host-and-guests arrangement to share the state of many moving entities: what message sizes, send rates and total bitrates have developers published as working well, including on phones, and what limits or failure modes of unreliable data channels did they measure? Cite sources.

Published, game-specific measurements are surprisingly scarce. The strongest public evidence supports designing around **small, frequent snapshots**, rather than a single universal “good” bitrate.

## Practical envelope

- **Message size:** Keep each unreliable state update below about **1,200 bytes** when possible, to remain under a conservative Internet path-MTU budget and avoid IP/SCTP fragmentation.[5]
- **Upper engineering limit:** If messages can be larger, keep them below **16 KiB** unless application-level chunking is used. RFC 8831 recommends this limit when SCTP message interleaving is unavailable because one large message can monopolize the association.[1][8]
- **Large-message behavior:** Browser implementations may accept roughly **64–256 KiB or more**, but the negotiated limit varies; messages exceeding it can fail, and large messages can block unrelated traffic through head-of-line effects.[6][7]
- **Send rate:** The available sources do not publish a credible, measured “N entities at X Hz” result for a browser game, including a phone. A useful starting point is **20–60 snapshots/s**, with each snapshot containing only changed or relevant entities—not a full world dump every tick. The cited material describes the replacement semantics of updates arriving every **16–50 ms**, corresponding to roughly **20–60 Hz**, but presents that as an example rather than a benchmark.[6]
- **Bitrate calculation:**  
  \[
  \text{bitrate} \approx \text{payload bytes per update} \times 8 \times \text{updates per second}
  \]
  For example, a 1,200-byte snapshot at 20 Hz is about **192 kbit/s** before protocol overhead; at 60 Hz it is about **576 kbit/s**. A 500-byte snapshot at 20 Hz is about **80 kbit/s**.

## What developers and specifications actually measured or recommended

The clearest quantitative limit is not a game benchmark but the WebRTC specification: without message interleaving, a sender should limit messages to **16 KiB** because a large user message can monopolize the SCTP association.[1] The same specification explicitly uses a real-time game carrying position and object state over unreliable channels as a motivating use case.[1]

Practical WebRTC guidance places the interoperable range lower:

- Under **16 KiB** is generally treated as stable across mainstream browsers.
- Above **16 KiB**, cross-browser failures and stuttering become more likely.
- Above roughly **64 KiB**, messages may become impractical or cause serious blocking.[2]
- Application-level chunking is recommended for larger snapshots; one published implementation uses **16 KiB** as its common chunk size.[6]

For many moving entities, the more important optimization is **interest management**: send only entities relevant to a client’s view, team, room, or area rather than broadcasting the entire simulation state.[5]

## Unreliable-channel failure modes

An unreliable unordered channel with `maxRetransmits: 0` does not retransmit a lost packet; the update is simply gone.[6] That is appropriate for positions and other state that becomes obsolete when the next tick arrives, but not for events such as match results, inventory changes, or “game over.”[6]

Measured or documented failure modes include:

- **Packet loss:** A state update disappears permanently, so receivers must use sequence numbers and accept the next snapshot as correction.[5][6]
- **Reordering:** Unordered delivery means an older update can arrive after a newer one; sequence or tick numbers are required.[5]
- **Fragmentation-related loss or failure:** Oversized unreliable messages may not be safely fragmented in all implementations; one documented game networking design drops oversized unreliable messages rather than fragmenting them.[4]
- **Head-of-line blocking:** Even on a data-channel connection, large SCTP messages can delay other channels when message interleaving is unavailable.[1][7]
- **Congestion and buffering:** Sending faster than the path can transmit causes the data-channel send buffer to grow; without backpressure, latency increases and updates become stale. The practical response is to drop superseded snapshots rather than queue every one.
- **Mobile variability:** The available published sources confirm mobile-browser support in general but do not provide a reproducible phone-specific entity-count, packet-rate, or bitrate benchmark. Cellular loss, radio handoffs, NAT changes, CPU throttling, and battery-saving behavior should therefore be tested on the target devices rather than inferred from desktop results.

A defensible initial design for a host-and-guests game is therefore: **unordered, zero-retransmit state channel; sequence-numbered snapshots; roughly 20–30 Hz initially; snapshots preferably under 1,200 bytes and certainly under 16 KiB; drop stale queued snapshots; and use a reliable channel for infrequent critical events.** The public evidence supports those limits, but not a universal maximum number of moving entities.

[1] WebRTC Data Channels (https://www.rfc-editor.org/rfc/rfc8831.html?ref=blog.aioz.network)
[2] File Transfer, Game Sync & Message Size Limits - WebRTC.link (https://webrtc.link/en/articles/rtcdatachannel-usage-and-message-size-limits/)
[3] WebRTC Data Channel Settings for Reliable Multiplayer – This Calculator (https://this-calculator.com/webrtc-data-channel-settings-for-reliable-multiplayer-gameplay.php)
[4] NetherNet – Minecraft Wiki (https://minecraft.wiki/w/NetherNet)
[5] Multiplayer Game Architecture :: Irurueta Docs (https://www.irurueta.com/web/webrtc-websockets/multiplayer-game-architecture.html)
[6] WebRTC Data Channel Reliability & Flow Control (https://webrtc.smnandre.dev/messaging/reliability)
[7] lh0x00.dev › p › webrtc-datachannelWebRTC DataChannels: P2P SCTP, ICE, and Production Realities (https://lh0x00.dev/p/webrtc-datachannel)
[8] WebRTC Data Channels (https://datatracker.ietf.org/doc/html/draft-ietf-rtcweb-data-channel-07)
[9] WebRTC vs WebSocket: Which to Use for Real-Time Features? (https://www.videosdk.live/blog/webrtc-vs-websocket)
[10] I built a browser multiplayer game without a server (https://peterchrjoergensen.dk/projects/browser-multiplayer/)
