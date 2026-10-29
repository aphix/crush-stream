import { describe, expect, it } from "vitest";
import { holdResetLabel, missedCheckpointText } from "./reset-prompt.ts";

describe("given a checkpoint was missed, which the player cannot see", () => {
  it("when the control in use is the keyboard, a pad or the touch pad, then the banner says to hold that control to go back, not just that one was missed", () => {
    expect(holdResetLabel("keyboard")).toBe("hold R");
    expect(missedCheckpointText({ canHold: true }, "keyboard")).toBe("Missed checkpoint: hold R to go back");
    expect(missedCheckpointText({ canHold: true }, "pad")).toBe("Missed checkpoint: hold D-pad ↓ to go back");
    expect(missedCheckpointText({ canHold: true }, "touch")).toBe("Missed checkpoint: hold Respawn to go back");
  });

  it("when a hold would not act (spectating, a menu, Survival) or no control is on screen, then the banner only says a checkpoint was missed", () => {
    expect(missedCheckpointText({ canHold: false }, "keyboard")).toBe("Missed checkpoint");
    expect(missedCheckpointText({}, "keyboard")).toBe("Missed checkpoint");
    expect(missedCheckpointText(null, "keyboard")).toBe("Missed checkpoint");
    expect(missedCheckpointText({ canHold: true }, null)).toBe("Missed checkpoint");
  });
});
