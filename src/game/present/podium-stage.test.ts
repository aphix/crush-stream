import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BLOCK_WIDTH, PODIUM_BLOCKS, type PodiumPlace } from "../match/podium.ts";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PodiumStage } from "./podium-stage.ts";
import { bannerLayout, BANNER_FRAME_PX, cupBox, decalLayout, EDGE_MARGIN_PX } from "./podium-layout.ts";

stubBrowser();

/** The `document` `stubBrowser` installs; the rows swap its `createElement` for a canvas that records what is drawn on it. */
const doc = (globalThis as unknown as { document: { createElement: unknown } }).document;

/** What one canvas was drawn with: its size, every string filled on it, and every point its paths and rectangles touch (control points included). */
type Drawn = { w: number; h: number; texts: string[]; points: { x: number; y: number }[] };

const PLACES: PodiumPlace[] = [
  { id: 0, name: "Ayla", place: 1 },
  { id: 1, name: "Bo", place: 2 },
  { id: 2, name: "Cy", place: 3 },
];

/** Margin kept between a decal and the edge of its block's face (m), top and bottom, and sideways. */
const FACE_MARGIN_M = 0.1;
const FACE_SIDE_MARGIN_M = 0.2;
/** The clear space between a decal's cup and the numeral beside it (px). */
const NUMERAL_GAP_PX = 14;

describe("given the podium's stage drawn on recording canvases", () => {
  const canvases: Drawn[] = [];
  const realCreate = doc.createElement;
  let stage: PodiumStage;

  beforeEach(() => {
    canvases.length = 0;
    doc.createElement = () => {
      const drawn: Drawn = { w: 0, h: 0, texts: [], points: [] };
      const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx };
      const at = (...xy: number[]): void => {
        for (let i = 0; i + 1 < xy.length; i += 2) drawn.points.push({ x: xy[i]!, y: xy[i + 1]! });
      };
      const calls: Record<string, (...a: number[]) => unknown> = {
        moveTo: (x, y) => at(x!, y!),
        lineTo: (x, y) => at(x!, y!),
        bezierCurveTo: (...a) => at(...a),
        fillRect: (x, y, w, h) => at(x!, y!, x! + w!, y! + h!),
        createLinearGradient: () => ({ addColorStop() {} }),
      };
      const ctx: object = new Proxy(
        {},
        {
          get: (_t, k) => {
            if (k === "fillText") return (text: string) => void drawn.texts.push(text);
            return calls[String(k)] ?? (() => undefined);
          },
          set: () => true,
        },
      );
      Object.defineProperty(drawn, "w", { get: () => canvas.width });
      Object.defineProperty(drawn, "h", { get: () => canvas.height });
      canvases.push(drawn);
      return canvas;
    };
    stage = new PodiumStage();
    stage.setNames(PLACES, "Brickyard Oval");
  });
  afterEach(() => {
    stage.dispose();
    doc.createElement = realCreate;
  });

  it("when everything the stage wrote is read, then the word podium is nowhere, and the banner names the course", () => {
    const all = canvases.flatMap((c) => c.texts);
    assert.ok(all.length > 0, "the control: text was drawn");
    assert.ok(!all.some((t) => /podium/i.test(t)), "no podium text");
    assert.ok(all.includes("BRICKYARD OVAL"), "the course on the banner");
    for (const name of ["Ayla", "Bo", "Cy"]) assert.ok(all.includes(name), `the plate of ${name}`);
  });

  it("when a campaign's stage is lettered, then the banner says championship and still not podium", () => {
    stage.setNames(PLACES, "Championship");
    const all = canvases.flatMap((c) => c.texts);
    assert.ok(all.includes("CHAMPIONSHIP"));
    assert.ok(!all.some((t) => /podium/i.test(t)));
  });

  it("when every point a decal's cups touch is read, then it lies inside the decal's canvas", () => {
    const decals = canvases.filter((c) => c.w === 512 && c.h === 256);
    assert.equal(decals.length, 3, "one decal canvas per block");
    for (const decal of decals) {
      assert.ok(decal.points.length > 0, "the control: the cups were drawn");
      for (const p of decal.points) assert.ok(p.x >= 0 && p.x <= decal.w && p.y >= 0 && p.y <= decal.h, `a point at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) is off the ${decal.w} × ${decal.h} decal`);
    }
  });

  it("when the decal's cups are placed by their boxes, then each is inside the canvas by the edge margin and clear of the numeral between them", () => {
    const { cupSize, cupY, leftX, rightX, numeralHalfWidth } = decalLayout();
    const left = cupBox(leftX, cupY, cupSize);
    const right = cupBox(rightX, cupY, cupSize);
    assert.ok(left.left >= EDGE_MARGIN_PX, `the left cup starts ${left.left} px in`);
    assert.ok(right.right <= 512 - EDGE_MARGIN_PX, `the right cup ends ${512 - right.right} px short of the edge`);
    assert.ok(left.top >= EDGE_MARGIN_PX && left.bottom <= 256 - EDGE_MARGIN_PX, "inside top and bottom");
    assert.ok(256 - numeralHalfWidth - left.right >= NUMERAL_GAP_PX, `the left cup is ${256 - numeralHalfWidth - left.right} px from the numeral`);
    assert.ok(right.left - (256 + numeralHalfWidth) >= NUMERAL_GAP_PX, `the right cup is ${right.left - 256 - numeralHalfWidth} px from the numeral`);
  });

  it("when the banner's cups are placed, then each is inside the gold frame by the edge margin", () => {
    const { cupSize, cupY, leftX, rightX } = bannerLayout();
    assert.ok(cupBox(leftX, cupY, cupSize).left >= BANNER_FRAME_PX + EDGE_MARGIN_PX - 1e-9);
    assert.ok(cupBox(rightX, cupY, cupSize).right <= 1536 - BANNER_FRAME_PX - EDGE_MARGIN_PX + 1e-9);
  });

  it("when each decal's world box is read at its block's size, then it is inside the block's front face with a margin all round", () => {
    stage.group.updateMatrixWorld(true);
    const decals = stage["decals"];
    assert.equal(decals.length, 3);
    for (const [k, block] of PODIUM_BLOCKS.entries()) {
      const box = new THREE.Box3().setFromObject(decals[k]!);
      assert.ok(box.min.x >= block.x - BLOCK_WIDTH / 2 + FACE_SIDE_MARGIN_M, `place ${block.place}: left edge ${box.min.x} against the face's ${block.x - BLOCK_WIDTH / 2}`);
      assert.ok(box.max.x <= block.x + BLOCK_WIDTH / 2 - FACE_SIDE_MARGIN_M, `place ${block.place}: right edge ${box.max.x}`);
      assert.ok(box.min.y >= FACE_MARGIN_M, `place ${block.place}: bottom edge ${box.min.y}`);
      assert.ok(box.max.y <= block.top - FACE_MARGIN_M, `place ${block.place}: top edge ${box.max.y} against the block's ${block.top}`);
    }
  });
});
