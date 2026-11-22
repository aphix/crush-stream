/** The Needle model the Minds run: Needle 2 through needle-rs (MIT), weights from Cactus Compute's Hugging Face repo (MIT), fetched only when the setting is on. */
export const NEEDLE_WEIGHTS = {
  url: "https://huggingface.co/Cactus-Compute/needle2/resolve/main/needle2.cact",
  sha256: "b43aabfcaf1a6db6acf488076eab71d823c08697c7af4521fc1d174b60ede5ba",
  /** Measured: the file's size on download (2026-11-21). */
  bytes: 13_737_807,
} as const;

/** The Cache Storage bucket the weights are kept in after their first verified download. */
export const WEIGHTS_CACHE = "crush-needle-weights-v1";

/** Tokens a reply may take: Needle 2 thinks a line, then calls; 48 cut the call off, 80 held a think line and the first call in the probe (OPEN_WORLD.md "Minds"). */
export const MAX_NEW_TOKENS = 80;

/** What the main thread asks of the Needle worker. Tools travel with each ask: Needle 2 has no tool prefix to bind, and a moment's tools are narrowed to what is there. */
export type ToNeedle = { kind: "load"; url: string; sha256: string } | { kind: "ask"; id: number; query: string; tools: string };

/** What the Needle worker answers: loaded (and how long it took, whether the weights came from the cache), failed, or a completion with its time. */
export type FromNeedle = { kind: "ready"; loadMs: number; cached: boolean } | { kind: "failed"; message: string } | { kind: "answer"; id: number; text: string; ms: number };
