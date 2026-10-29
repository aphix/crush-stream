import { describe, expect, it } from "vitest";
import { ArmBadge } from "./bench-badge.ts";

/** A line of the card that counts how often the page is written to. */
function line(): { textContent: string | null; style: { cssText: string }; writes: number } {
  let text: string | null = "";
  return {
    writes: 0,
    style: { cssText: "" },
    get textContent(): string | null {
      return text;
    },
    set textContent(value: string | null) {
      text = value;
      this.writes++;
    },
  };
}

describe("given the bench card's arm label, reading a knob that the loop turns on and off", () => {
  it("when the knob is off, then the label says epicenter off in the quiet look, and when it is turned on, EPICENTER ON in the amber one, and back", () => {
    let on = false;
    const element = line();
    const badge = new ArmBadge(element, () => on);
    badge.sync();
    expect(element.textContent).toBe("epicenter off");
    const quiet = element.style.cssText;
    on = true;
    badge.sync();
    expect(element.textContent).toBe("EPICENTER ON");
    expect(element.style.cssText, "the on look differs from the off look").not.toBe(quiet);
    on = false;
    badge.sync();
    expect(element.textContent).toBe("epicenter off");
    expect(element.style.cssText).toBe(quiet);
  });

  it("when it is synced a thousand times with the knob unchanged, then the page is written once, not a thousand times", () => {
    const element = line();
    const badge = new ArmBadge(element, () => true);
    for (let i = 0; i < 1000; i++) badge.sync();
    expect(element.writes).toBe(1);
  });
});
