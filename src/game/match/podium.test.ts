import { describe, expect, it } from "vitest";
import { BLOCK_DEPTH, BLOCK_GAP, BLOCK_WIDTH, PODIUM_BLOCKS, podiumPlaces } from "./podium.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

describe("given the podium's three blocks", () => {
  const byPlace = (place: number) => PODIUM_BLOCKS.find((b) => b.place === place)!;

  it("when the places are laid out, then there is one block per place, first to third", () => {
    expect(firstMismatch(PODIUM_BLOCKS.map((b) => b.place), [1, 2, 3])).toBeUndefined();
  });

  it("when the heights are compared, then the winner's block is the highest, the second's lower and the third's lowest", () => {
    expect(byPlace(1).top, `first ${byPlace(1).top} m over second ${byPlace(2).top} m`).toBeGreaterThan(byPlace(2).top);
    expect(byPlace(2).top, `second ${byPlace(2).top} m over third ${byPlace(3).top} m`).toBeGreaterThan(byPlace(3).top);
    expect(byPlace(3).top, "the third's block stands above the platform").toBeGreaterThan(0);
  });

  it("when the blocks are placed along the stand, then the winner is in the middle, the second on the viewer's left and the third on the right", () => {
    expect(byPlace(1).x, "first in the middle").toBe(0);
    expect(byPlace(2).x, `second at x ${byPlace(2).x} is left of the middle`).toBeLessThan(byPlace(1).x);
    expect(byPlace(3).x, `third at x ${byPlace(3).x} is right of the middle`).toBeGreaterThan(byPlace(1).x);
    expect(byPlace(2).x, "the stand is symmetric").toBe(-byPlace(3).x);
  });

  it("when neighbouring blocks are measured, then they stand side by side with the gap between them and none overlap", () => {
    expect(byPlace(1).x - byPlace(2).x, "first to second").toBe(BLOCK_WIDTH + BLOCK_GAP);
    expect(byPlace(3).x - byPlace(1).x, "third to first").toBe(BLOCK_WIDTH + BLOCK_GAP);
    expect(BLOCK_DEPTH, `a block ${BLOCK_DEPTH} m deep holds a 4.5 m car`).toBeGreaterThan(4.5);
  });

  it("when each car's nose is read, then the winner faces the viewer and the other two turn in toward the winner", () => {
    expect(byPlace(1).yaw, "first faces the viewer").toBe(0);
    expect(byPlace(2).yaw, "second (on the left) turns toward +x").toBeGreaterThan(0);
    expect(byPlace(3).yaw, "third (on the right) turns toward -x").toBeLessThan(0);
  });
});

describe("given a classification", () => {
  const rows = [
    { id: 4, name: "Vera", place: 9 },
    { id: 0, name: "You", place: 9 },
    { id: 7, name: "Ozzy", place: 9 },
    { id: 2, name: "Pia", place: 9 },
  ];

  it("when the podium is read off four rows, then the first three are on it, each with the name the standings show and the place its position gives", () => {
    const podium = podiumPlaces(rows);
    const expected = [
      { id: 4, name: "Vera", place: 1 },
      { id: 0, name: "You", place: 2 },
      { id: 7, name: "Ozzy", place: 3 },
    ];
    expect(podium, "podium length").toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(podium[i]?.id, `podium ${i} id`).toBe(expected[i]!.id);
      expect(podium[i]?.name, `podium ${i} name`).toBe(expected[i]!.name);
      expect(podium[i]?.place, `podium ${i} place`).toBe(expected[i]!.place);
    }
  });

  it("when the field is two cars, then the podium holds two", () => {
    expect(podiumPlaces(rows.slice(0, 2)).length).toBe(2);
  });

  it("when the field is empty, then the podium is empty", () => {
    expect(podiumPlaces([])).toHaveLength(0);
  });
});
