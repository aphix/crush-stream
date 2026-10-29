import { describe, expect, it } from "vitest";
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
    expect(navTarget(SETUP, CARD0, "right")).toBe(CARD1);
    expect(navTarget(SETUP, CARD1, "left")).toBe(CARD0);
    expect(navTarget(SETUP, CARD2, "down")).toBe(STEPPER);
    expect(navTarget(SETUP, STEPPER, "down")).toBe(START);
    expect(navTarget(SETUP, START, "right")).toBe(BACK);
    expect(navTarget(SETUP, BACK, "up")).toBe(STEPPER);
  });

  it("when several items lie that way, then the highlight moves to the one most in line (straight below but far beats diagonal and near)", () => {
    expect(navTarget(SETUP, STEPPER, "up")).toBe(CARD1);
    // Straight below but far beats diagonal and near.
    const rects = [rect(0, 0, 100, 40), rect(0, 150, 100, 40), rect(200, 60, 100, 40)];
    expect(navTarget(rects, 0, "down")).toBe(1);
  });

  it("when a neighbour is not wholly past the source's leading edge, then it is not considered: a taller neighbour in the same row is not below, and right never drops to the wide row below", () => {
    expect(navTarget(SETUP, START, "down"), "a taller neighbour in the same row is not below").toBe(START);
    expect(navTarget(SETUP, BACK, "down")).toBe(BACK);
    expect(navTarget(SETUP, CARD0, "right"), "right never drops to the wide row below").toBe(CARD1);
    const wide = [rect(0, 0, 340, 44), rect(0, 60, 160, 44), rect(180, 60, 160, 44)];
    expect(navTarget(wide, 0, "right"), "the next row is not right of a full-width item").toBe(0);
    expect(navTarget(wide, 0, "down")).toBe(1);
  });

  it("when there is no item in the pressed direction, then the highlight stays put at an edge instead of wrapping", () => {
    expect(navTarget(SETUP, CARD2, "right")).toBe(CARD2);
    expect(navTarget(SETUP, CARD0, "left")).toBe(CARD0);
    expect(navTarget(SETUP, CARD1, "up")).toBe(CARD1);
    expect(navTarget([rect(0, 0, 10, 10)], 0, "down")).toBe(0);
  });
});

describe("given a focused menu item that unmounted (a saved replay's Delete button, a stepper's bound)", () => {
  it("when the point it held is looked up, then the item now under it wins, else the nearest one, and no items gives -1", () => {
    // A list of rows 40 tall; the row at y 40-80 was deleted, so the row that was below it now sits at 40-80.
    const rows = [rect(0, 0, 300, 40), rect(0, 40, 300, 40), rect(0, 80, 300, 40)];
    expect(nearestNav(rows, 150, 60), "the row that slid into the deleted one's place").toBe(1);
    expect(nearestNav(rows, 150, 200), "past the last row: the last row, not the first").toBe(2);
    expect(nearestNav(rows, 150, -50)).toBe(0);
    expect(nearestNav(rows, 150, 40), "an edge shared by two rows goes to the lower index").toBe(0);
    expect(nearestNav([], 0, 0)).toBe(-1);
  });
});

describe("given a stick pushed to a position", () => {
  it("when it is pushed past the threshold along its dominant axis, then that direction is chosen, and a small equal push on both axes gives none", () => {
    expect(stickDir(0.6, 0.2)).toBe("right");
    expect(stickDir(-0.6, 0.2)).toBe("left");
    expect(stickDir(0.1, -0.7)).toBe("up");
    expect(stickDir(0.1, 0.7)).toBe("down");
    expect(stickDir(0.2, 0.2)).toBe(null);
  });
});

describe("given a direction held on a menu (auto-repeat of the highlight move)", () => {
  it("when it is held, then it fires on press, again after the repeat delay, then at the repeat rate, restarts after release, and fires at once for a new direction", () => {
    const r = new NavRepeat();
    expect(r.step(null, 0)).toBe(false);
    expect(r.step("down", 10)).toBe(true);
    expect(r.step("down", 10 + NAV_REPEAT_DELAY - 1)).toBe(false);
    expect(r.step("down", 10 + NAV_REPEAT_DELAY)).toBe(true);
    expect(r.step("down", 10 + NAV_REPEAT_DELAY + NAV_REPEAT_RATE - 1)).toBe(false);
    expect(r.step("down", 10 + NAV_REPEAT_DELAY + NAV_REPEAT_RATE)).toBe(true);
    expect(r.step(null, 600)).toBe(false);
    expect(r.step("down", 610)).toBe(true);
    expect(r.step("left", 620), "a new direction fires at once").toBe(true);
    expect(r.step("left", 700)).toBe(false);
  });
});

describe("given a focused text field in a sheet menu (the race setup's name)", () => {
  it("when Backspace, space or a caret arrow is pressed, then the field keeps it, and the menu's own keys (Esc, Enter, Tab, up, down) are not kept", () => {
    for (const key of ["Backspace", " ", "ArrowLeft", "ArrowRight"]) expect(textKeepsKey(key), key).toBe(true);
    for (const key of ["Escape", "Enter", "Tab", "ArrowUp", "ArrowDown", "a"]) expect(textKeepsKey(key), key).toBe(false);
  });
});
