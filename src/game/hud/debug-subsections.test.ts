import { describe, expect, it } from "vitest";
import { EPICENTER_KNOBS } from "../deform/epicenter.ts";
import { CHASE_KNOBS } from "../present/drive-cam.ts";
import { SUBSECTION_OPEN, SUBSECTION_STORAGE_KEY, subsectionOf } from "./debug-subsections.ts";
import { KNOBS } from "./knobs.ts";

/** What a section's open state reads as before the user has ever opened it (`useStoredString`'s own default here). */
const NOTHING_STORED = "";

describe("given the Debug views' knob sub-sections", () => {
  it("when every epicenter knob is placed, then each sits in the Epicenter tuning sub-section and no camera knob does", () => {
    for (const k of EPICENTER_KNOBS) expect(subsectionOf(k), k.id).toBe("epicenter");
    for (const k of CHASE_KNOBS) expect(subsectionOf(k), k.id).toBe("camera");
    const inside = KNOBS.filter((k) => subsectionOf(k) === "epicenter").map((k) => k.id);
    expect(inside.join(" "), "exactly the epicenter's, in panel order").toBe(EPICENTER_KNOBS.map((k) => k.id).join(" "));
    expect(inside.length, "more than the activation switch: its tuning sliders").toBeGreaterThan(1);
  });

  it("when nothing is stored, then neither sub-section reads as open, each remembers under its own key, and the stored open value opens it", () => {
    expect(NOTHING_STORED, "closed by default").not.toBe(SUBSECTION_OPEN);
    expect(SUBSECTION_STORAGE_KEY.camera, "one key each: opening one does not open the other").not.toBe(SUBSECTION_STORAGE_KEY.epicenter);
  });
});
