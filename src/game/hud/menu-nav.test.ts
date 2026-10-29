import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { NAV_REPEAT_DELAY, NAV_REPEAT_RATE, NavRepeat, navTarget, nearestNav, stickDir, textKeepsKey, type NavRect } from "./menu-nav.ts";

const rect = (left: number, top: number, width: number, height: number): NavRect => ({ left, top, width, height });

// Setup-menu shape: three course cards, a full-width stepper, then two buttons whose heights differ.
const CARD0 = 0;
const CARD1 = 1;
const CARD2 = 2;
const STEPPER = 3;
const START = 4;
const BACK = 5;
const SETUP = [
  rect(0, 0, 100, 100),
  rect(120, 0, 100, 100),
  rect(240, 0, 100, 100),
  rect(0, 120, 340, 44),
  rect(0, 180, 160, 48),
  rect(180, 182, 160, 44),
];

describe("given the setup menu's items (three course cards, a full-width stepper, then two buttons of different heights) and a direction pressed on a gamepad or keyboard", () => {
  it("when a direction is pressed, then the highlight moves to the neighbour in that direction", () => {
    assert.equal(navTarget(SETUP, CARD0, "right"), CARD1);
    assert.equal(navTarget(SETUP, CARD1, "left"), CARD0);
    assert.equal(navTarget(SETUP, CARD2, "down"), STEPPER);
    assert.equal(navTarget(SETUP, STEPPER, "down"), START);
    assert.equal(navTarget(SETUP, START, "right"), BACK);
    assert.equal(navTarget(SETUP, BACK, "up"), STEPPER);
  });

  it("when several items lie that way, then the highlight moves to the one most in line (straight below but far beats diagonal and near)", () => {
    assert.equal(navTarget(SETUP, STEPPER, "up"), CARD1);
    // Straight below but far beats diagonal and near.
    const rects = [rect(0, 0, 100, 40), rect(0, 150, 100, 40), rect(200, 60, 100, 40)];
    assert.equal(navTarget(rects, 0, "down"), 1);
  });

  it("when a neighbour is not wholly past the source's leading edge, then it is not considered: a taller neighbour in the same row is not below, and right never drops to the wide row below", () => {
    assert.equal(navTarget(SETUP, START, "down"), START, "a taller neighbour in the same row is not below");
    assert.equal(navTarget(SETUP, BACK, "down"), BACK);
    assert.equal(navTarget(SETUP, CARD0, "right"), CARD1, "right never drops to the wide row below");
    const wide = [rect(0, 0, 340, 44), rect(0, 60, 160, 44), rect(180, 60, 160, 44)];
    assert.equal(navTarget(wide, 0, "right"), 0, "the next row is not right of a full-width item");
    assert.equal(navTarget(wide, 0, "down"), 1);
  });

  it("when there is no item in the pressed direction, then the highlight stays put at an edge instead of wrapping", () => {
    assert.equal(navTarget(SETUP, CARD2, "right"), CARD2);
    assert.equal(navTarget(SETUP, CARD0, "left"), CARD0);
    assert.equal(navTarget(SETUP, CARD1, "up"), CARD1);
    assert.equal(navTarget([rect(0, 0, 10, 10)], 0, "down"), 0);
  });
});

describe("given a focused menu item that unmounted (a saved replay's Delete button, a stepper's bound)", () => {
  it("when the point it held is looked up, then the item now under it wins, else the nearest one, and no items gives -1", () => {
    // A list of rows 40 tall; the row at y 40-80 was deleted, so the row that was below it now sits at 40-80.
    const rows = [rect(0, 0, 300, 40), rect(0, 40, 300, 40), rect(0, 80, 300, 40)];
    assert.equal(nearestNav(rows, 150, 60), 1, "the row that slid into the deleted one's place");
    assert.equal(nearestNav(rows, 150, 200), 2, "past the last row: the last row, not the first");
    assert.equal(nearestNav(rows, 150, -50), 0);
    assert.equal(nearestNav(rows, 150, 40), 0, "an edge shared by two rows goes to the lower index");
    assert.equal(nearestNav([], 0, 0), -1);
  });
});

describe("given a stick pushed to a position", () => {
  it("when it is pushed past the threshold along its dominant axis, then that direction is chosen, and a small equal push on both axes gives none", () => {
    assert.equal(stickDir(0.6, 0.2), "right");
    assert.equal(stickDir(-0.6, 0.2), "left");
    assert.equal(stickDir(0.1, -0.7), "up");
    assert.equal(stickDir(0.1, 0.7), "down");
    assert.equal(stickDir(0.2, 0.2), null);
  });
});

describe("given a direction held on a menu (auto-repeat of the highlight move)", () => {
  it("when it is held, then it fires on press, again after the repeat delay, then at the repeat rate, restarts after release, and fires at once for a new direction", () => {
    const r = new NavRepeat();
    assert.equal(r.step(null, 0), false);
    assert.equal(r.step("down", 10), true);
    assert.equal(r.step("down", 10 + NAV_REPEAT_DELAY - 1), false);
    assert.equal(r.step("down", 10 + NAV_REPEAT_DELAY), true);
    assert.equal(r.step("down", 10 + NAV_REPEAT_DELAY + NAV_REPEAT_RATE - 1), false);
    assert.equal(r.step("down", 10 + NAV_REPEAT_DELAY + NAV_REPEAT_RATE), true);
    assert.equal(r.step(null, 600), false);
    assert.equal(r.step("down", 610), true);
    assert.equal(r.step("left", 620), true, "a new direction fires at once");
    assert.equal(r.step("left", 700), false);
  });
});

describe("given a focused text field in a sheet menu (the race setup's name)", () => {
  it("when Backspace, space or a caret arrow is pressed, then the field keeps it, and the menu's own keys (Esc, Enter, Tab, up, down) are not kept", () => {
    for (const key of ["Backspace", " ", "ArrowLeft", "ArrowRight"]) assert.equal(textKeepsKey(key), true, key);
    for (const key of ["Escape", "Enter", "Tab", "ArrowUp", "ArrowDown", "a"]) assert.equal(textKeepsKey(key), false, key);
  });
});
