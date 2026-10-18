import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EPICENTER_KNOBS } from "../deform/epicenter.ts";
import { CHASE_KNOBS } from "../present/drive-cam.ts";
import { SUBSECTION_OPEN, SUBSECTION_STORAGE_KEY, subsectionOf } from "./debug-subsections.ts";
import { KNOBS } from "./knobs.ts";

/** What a section's open state reads as before the user has ever opened it (`useStoredString`'s own default here). */
const NOTHING_STORED = "";

describe("given the Debug views' knob sub-sections", () => {
  it("when every epicenter knob is placed, then each sits in the Epicenter tuning sub-section and no camera knob does", () => {
    for (const k of EPICENTER_KNOBS) assert.equal(subsectionOf(k), "epicenter", k.id);
    for (const k of CHASE_KNOBS) assert.equal(subsectionOf(k), "camera", k.id);
    const inside = KNOBS.filter((k) => subsectionOf(k) === "epicenter").map((k) => k.id);
    assert.equal(inside.join(" "), EPICENTER_KNOBS.map((k) => k.id).join(" "), "exactly the epicenter's, in panel order");
    assert.ok(inside.length > 1, "more than the activation switch: its tuning sliders");
  });

  it("when nothing is stored, then neither sub-section reads as open, each remembers under its own key, and the stored open value opens it", () => {
    assert.notEqual(NOTHING_STORED, SUBSECTION_OPEN, "closed by default");
    assert.notEqual(SUBSECTION_STORAGE_KEY.camera, SUBSECTION_STORAGE_KEY.epicenter, "one key each: opening one does not open the other");
  });
});
