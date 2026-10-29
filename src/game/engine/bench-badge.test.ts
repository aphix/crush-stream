import { describe, it } from "vitest";
import assert from "node:assert/strict";
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
    assert.equal(element.textContent, "epicenter off");
    const quiet = element.style.cssText;
    on = true;
    badge.sync();
    assert.equal(element.textContent, "EPICENTER ON");
    assert.notEqual(element.style.cssText, quiet, "the on look differs from the off look");
    on = false;
    badge.sync();
    assert.equal(element.textContent, "epicenter off");
    assert.equal(element.style.cssText, quiet);
  });

  it("when it is synced a thousand times with the knob unchanged, then the page is written once, not a thousand times", () => {
    const element = line();
    const badge = new ArmBadge(element, () => true);
    for (let i = 0; i < 1000; i++) badge.sync();
    assert.equal(element.writes, 1);
  });
});
