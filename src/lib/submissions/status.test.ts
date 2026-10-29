import { afterEach, describe, expect, it } from "vitest";
import { dismissStatus, getStatus, sendSubmission, subscribeStatus, type Status } from "./status.ts";
import type { submit } from "./client.ts";

const CONTEXT = { scene: "race", settings: { seed: 1 } };

/** The statuses a submission goes through, in order. */
async function statusesOf(run: () => Promise<unknown>): Promise<(Status | null)[]> {
  const seen: (Status | null)[] = [];
  const stop = subscribeStatus(() => seen.push(getStatus()));
  await run();
  stop();
  return seen;
}

/** The receipt id of a sent status, the message of a failed one, nothing for sending. */
function detailOf(status: Status | null): string | undefined {
  if (status === null || status.phase === "sending") return undefined;
  return status.phase === "sent" ? status.id : status.message;
}

function expectStatus(got: Status | null, phase: Status["phase"], kind: Status["kind"], detail: string | undefined, what: string): void {
  expect(got?.phase, `${what}: phase`).toBe(phase);
  expect(got?.kind, `${what}: kind`).toBe(kind);
  expect(detailOf(got), `${what}: id or message`).toBe(detail);
}

afterEach(dismissStatus);

describe("given a player who presses Submit, [!] or finishes a bench in the loop", () => {
  it("when the server accepts it, then the player sees it sending and then its receipt id, which stays until dismissed", async () => {
    const post: typeof submit = async () => ({ id: "K7QM-2XWD" });
    const seen = await statusesOf(() => sendSubmission("flag", async () => ({ context: CONTEXT, payload: { clip: "x" } }), post));
    expect(seen, "statuses seen").toHaveLength(2);
    expectStatus(seen[0] ?? null, "sending", "flag", undefined, "first status");
    expectStatus(seen[1] ?? null, "sent", "flag", "K7QM-2XWD", "second status");
    expectStatus(getStatus(), "sent", "flag", "K7QM-2XWD", "status kept");
    dismissStatus();
    expect(getStatus()).toBe(null);
  });

  it("when the server refuses it, then the player sees why it was not sent", async () => {
    const post: typeof submit = async () => ({ error: "too many submissions just now, try again in a minute" });
    await sendSubmission("bench", async () => ({ context: CONTEXT, payload: {} }), post);
    expectStatus(getStatus(), "failed", "bench", "too many submissions just now, try again in a minute", "status after a refusal");
  });

  it("when there is nothing to send (the clip is gone), then nothing is posted and the player sees why", async () => {
    let posts = 0;
    const post: typeof submit = async () => (posts++, { id: "K7QM-2XWD" });
    const result = await sendSubmission("flag", async () => "that clip is no longer on screen", post);
    expect(posts).toBe(0);
    expect("error" in result ? result.error : undefined, "result error").toBe("that clip is no longer on screen");
    expectStatus(getStatus(), "failed", "flag", "that clip is no longer on screen", "status");
  });

  it("when a newer submission finishes after an older one, then the newest outcome is the one shown", async () => {
    await sendSubmission("capture", async () => ({ context: CONTEXT, payload: {} }), async () => ({ id: "AAAA-AAAA" }));
    await sendSubmission("flag", async () => ({ context: CONTEXT, payload: {} }), async () => ({ id: "BBBB-BBBB" }));
    expectStatus(getStatus(), "sent", "flag", "BBBB-BBBB", "newest status");
  });
});
