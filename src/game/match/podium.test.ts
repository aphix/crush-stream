import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BLOCK_DEPTH, BLOCK_GAP, BLOCK_WIDTH, PODIUM_BLOCKS, podiumPlaces } from "./podium.ts";

describe("given the podium's three blocks", () => {
  const byPlace = (place: number) => PODIUM_BLOCKS.find((b) => b.place === place)!;

  it("when the places are laid out, then there is one block per place, first to third", () => {
    assert.deepEqual(
      PODIUM_BLOCKS.map((b) => b.place),
      [1, 2, 3],
    );
  });

  it("when the heights are compared, then the winner's block is the highest, the second's lower and the third's lowest", () => {
    assert.ok(byPlace(1).top > byPlace(2).top, `first ${byPlace(1).top} m over second ${byPlace(2).top} m`);
    assert.ok(byPlace(2).top > byPlace(3).top, `second ${byPlace(2).top} m over third ${byPlace(3).top} m`);
    assert.ok(byPlace(3).top > 0, "the third's block stands above the platform");
  });

  it("when the blocks are placed along the stand, then the winner is in the middle, the second on the viewer's left and the third on the right", () => {
    assert.equal(byPlace(1).x, 0, "first in the middle");
    assert.ok(byPlace(2).x < byPlace(1).x, `second at x ${byPlace(2).x} is left of the middle`);
    assert.ok(byPlace(3).x > byPlace(1).x, `third at x ${byPlace(3).x} is right of the middle`);
    assert.equal(byPlace(2).x, -byPlace(3).x, "the stand is symmetric");
  });

  it("when neighbouring blocks are measured, then they stand side by side with the gap between them and none overlap", () => {
    assert.equal(byPlace(1).x - byPlace(2).x, BLOCK_WIDTH + BLOCK_GAP, "first to second");
    assert.equal(byPlace(3).x - byPlace(1).x, BLOCK_WIDTH + BLOCK_GAP, "third to first");
    assert.ok(BLOCK_DEPTH > 4.5, `a block ${BLOCK_DEPTH} m deep holds a 4.5 m car`);
  });

  it("when each car's nose is read, then the winner faces the viewer and the other two turn in toward the winner", () => {
    assert.equal(byPlace(1).yaw, 0, "first faces the viewer");
    assert.ok(byPlace(2).yaw > 0, "second (on the left) turns toward +x");
    assert.ok(byPlace(3).yaw < 0, "third (on the right) turns toward -x");
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
    assert.deepEqual(podiumPlaces(rows), [
      { id: 4, name: "Vera", place: 1 },
      { id: 0, name: "You", place: 2 },
      { id: 7, name: "Ozzy", place: 3 },
    ]);
  });

  it("when the field is two cars, then the podium holds two", () => {
    assert.equal(podiumPlaces(rows.slice(0, 2)).length, 2);
  });

  it("when the field is empty, then the podium is empty", () => {
    assert.deepEqual(podiumPlaces([]), []);
  });
});
