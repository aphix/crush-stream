import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import {
  BOARD_STEP,
  BOX_CELL_PITCH,
  BOX_COUNT,
  BOX_NET_CLEARANCE,
  BOX_PILE_HALF_WIDTH,
  BOX_PILE_LEAD,
  BOX_PILE_TRAIL,
  BOX_SIZE_MAX,
  BOX_SIZE_MIN,
  FIELD_HALF_WIDTH,
  FRAME_HEADROOM_FACTOR,
  HighJumpPeak,
  MAJOR_BOARD_EVERY_METRES,
  SIGN_EVERY_METRES,
  SCORE_BAND_HALF_DEPTH,
  POSTS_DISTANCE,
  POST_HALF_SPAN,
  POST_THICKNESS,
  highJumpLayout,
  type BoxPlacement,
  type HighJumpMeasured,
  type TorsoSample,
} from "./minigame-high-jump.ts";

const GRAVITY = 9.80665;
const FRAME_SECONDS = 1 / FRAME_HZ;
const LIP_Y = 2.5;
const MILLIMETRE = 0.001;
const BOX_OVERLAP_TOLERANCE = 1e-9;
/** The arcs' horizontal speed (m/s): a best run's 3-4 m/s past the posts. */
const ARC_SPEED = 3;

/** A synthetic best case: the numbers the real measurement would fill in. */
const SYNTHETIC_MEASURED: HighJumpMeasured = { bestHeight: 31.3, landingDistance: 28 };

function torso(x: number, y: number, z = 0): TorsoSample {
  return { x, y, z, still: 0 };
}

/**
 * A ballistic torso whose apex (height `apexY`) falls at frame `apexFrame` (a half-integer lies between two frames, where a sample is
 * furthest from the apex), sampled once per 60 Hz frame as the ragdoll's `latest()` is: no interpolation between frames. It flies along
 * the throw at `ARC_SPEED` and is at `apexX` at its apex.
 */
function arcFrames(apexY: number, apexFrame: number, apexX: number, frameCount: number): TorsoSample[] {
  return Array.from({ length: frameCount }, (_, frame) => {
    const seconds = (frame - apexFrame) * FRAME_SECONDS;
    return torso(apexX + ARC_SPEED * seconds, apexY - (GRAVITY * seconds * seconds) / 2);
  });
}

/** The highest the frames get above the lip inside the band, worked out here without the class: the filter and the maximum. */
function bandMaximum(frames: readonly TorsoSample[]): number {
  return Math.max(0, ...frames.filter((frame) => Math.abs(frame.x - POSTS_DISTANCE) <= SCORE_BAND_HALF_DEPTH).map((frame) => frame.y - LIP_Y));
}

function peakOf(frames: readonly TorsoSample[]): HighJumpPeak {
  const peak = new HighJumpPeak();
  for (const frame of frames) peak.step(frame, POSTS_DISTANCE, LIP_Y);
  return peak;
}

describe("given a torso flying a ballistic arc over the posts, sampled once per 60 Hz frame", () => {
  const apexY = 60;
  const analyticApexHeight = apexY - LIP_Y;
  /** The apex falls half way between two frames, at the posts' plane. */
  const overThePosts = arcFrames(apexY, 100.5, POSTS_DISTANCE, 200);

  it("when the apex falls half way between two frames inside the band, then the highest point is the analytic apex to under a millimetre", () => {
    const peak = peakOf(overThePosts);
    expect(Math.abs(peak.height - analyticApexHeight), `peak ${peak.height} vs analytic ${analyticApexHeight}`).toBeLessThan(MILLIMETRE);
  });

  it("when he has fallen back well below the apex, then the score is still the apex, not where he is now", () => {
    expect(overThePosts.at(-1)!.y - LIP_Y, "the last frame is far below the apex").toBeLessThan(analyticApexHeight - 10);
    expect(peakOf(overThePosts).height).toBeGreaterThan(analyticApexHeight - MILLIMETRE);
  });

  it("when the frames are read in order, then the running value never drops and each answer is the highest so far", () => {
    const peak = new HighJumpPeak();
    let previous = 0;
    for (const [index, frame] of overThePosts.entries()) {
      const answer = peak.step(frame, POSTS_DISTANCE, LIP_Y);
      expect(answer, `frame ${index}: ${answer} after ${previous}`).toBeGreaterThanOrEqual(previous);
      expect(peak.height, "the getter reads the same").toBe(answer);
      previous = answer;
    }
  });

  it("when he peaks well before the band and drops, then he scores only the height he had inside the band", () => {
    const early = arcFrames(apexY, 300.5, POSTS_DISTANCE - 9, 500);
    const score = peakOf(early).height;
    expect(score, "the highest frame inside the band").toBe(bandMaximum(early));
    expect(score, "he is still above the lip when he enters the band").toBeGreaterThan(0);
    expect(score, `scored ${score}: far under the apex ${analyticApexHeight} he reached before the band`).toBeLessThan(analyticApexHeight - 10);
  });

  it("when he peaks well past the band, then he scores the height he had as he left it, not the apex beyond", () => {
    const late = arcFrames(apexY, 300.5, POSTS_DISTANCE + 9, 500);
    const score = peakOf(late).height;
    expect(score, "the highest frame inside the band").toBe(bandMaximum(late));
    expect(score, "he was above the lip as he climbed through the band").toBeGreaterThan(0);
    expect(score, `scored ${score}: far under the apex ${analyticApexHeight} he reached beyond the band`).toBeLessThan(analyticApexHeight - 10);
  });
});

describe("given a dummy that taps a post and falls back", () => {
  /** Up the lane to a tap 0.3 m short of the posts' plane at 100 m up, then straight back down and away from the posts. */
  const climbFrames = 90;
  const tapped: TorsoSample[] = [
    ...Array.from({ length: climbFrames }, (_, frame) => torso(POSTS_DISTANCE - 5 + (4.7 * frame) / climbFrames, LIP_Y + 100 * Math.sin((Math.PI / 2) * (frame / climbFrames)))),
    ...Array.from({ length: 200 }, (_, frame) => torso(POSTS_DISTANCE - 0.3 - 0.04 * frame, LIP_Y + 100 - (GRAVITY * (frame * FRAME_SECONDS) ** 2) / 2)),
  ];

  it("when he is thrown back out of the band, then he scores the height he reached at the post, not 0", () => {
    const peak = peakOf(tapped);
    expect(peak.height, "the highest frame inside the band").toBe(bandMaximum(tapped));
    expect(peak.height, `scored ${peak.height}: the tap's height`).toBeGreaterThan(95);
    expect(Math.min(...tapped.map((frame) => Math.abs(frame.x - POSTS_DISTANCE))), "he never reached the plane: nothing crossed it").toBeGreaterThan(0.25);
  });
});

describe("given the score band's width", () => {
  it("when it is read, then it is a meter or two either side of the bars, as the owner asked", () => {
    expect(SCORE_BAND_HALF_DEPTH >= 1 && SCORE_BAND_HALF_DEPTH <= 2, `${SCORE_BAND_HALF_DEPTH} m`).toBeTruthy();
  });
});

describe("given torso samples at the band's edges and beside it", () => {
  const EDGE_NUDGE = 1e-6;
  const edgeCases = [
    { it: "when he is exactly at the band's front edge, then the sample counts", x: POSTS_DISTANCE - SCORE_BAND_HALF_DEPTH, counts: true },
    { it: "when he is exactly at the band's back edge, then the sample counts", x: POSTS_DISTANCE + SCORE_BAND_HALF_DEPTH, counts: true },
    { it: "when he is just in front of the band, then the sample does not count", x: POSTS_DISTANCE - SCORE_BAND_HALF_DEPTH - EDGE_NUDGE, counts: false },
    { it: "when he is just behind the band, then the sample does not count", x: POSTS_DISTANCE + SCORE_BAND_HALF_DEPTH + EDGE_NUDGE, counts: false },
    { it: "when he is at the posts' plane, then the sample counts", x: POSTS_DISTANCE, counts: true },
  ] as const;
  for (const testCase of edgeCases) {
    it(testCase.it, () => {
      expect(new HighJumpPeak().step(torso(testCase.x, LIP_Y + 12), POSTS_DISTANCE, LIP_Y)).toBe(testCase.counts ? 12 : 0);
    });
  }

  it("when he is in the band anywhere across the lane or between, beside or past the posts, then the height counts", () => {
    for (const z of [0, POST_HALF_SPAN, FIELD_HALF_WIDTH + 40, -FIELD_HALF_WIDTH - 40]) {
      expect(new HighJumpPeak().step(torso(POSTS_DISTANCE + 1, LIP_Y + 12, z), POSTS_DISTANCE, LIP_Y), `at z ${z}`).toBe(12);
    }
  });

  it("when he stays below the lip inside the band, then the score is 0, not negative", () => {
    const peak = new HighJumpPeak();
    expect(peak.step(torso(POSTS_DISTANCE, LIP_Y - 3), POSTS_DISTANCE, LIP_Y), "below the lip").toBe(0);
    expect(peak.height, "the getter").toBe(0);
  });

  it("when he never comes inside the band, then the score is 0 whatever his height", () => {
    const peak = new HighJumpPeak();
    for (const x of [2, POSTS_DISTANCE - 5, POSTS_DISTANCE + 20]) peak.step(torso(x, LIP_Y + 50), POSTS_DISTANCE, LIP_Y);
    expect(peak.height).toBe(0);
  });

  it("when the peak is reset, then it starts from nothing again", () => {
    const peak = new HighJumpPeak();
    peak.step(torso(POSTS_DISTANCE, LIP_Y + 20), POSTS_DISTANCE, LIP_Y);
    peak.reset();
    expect(peak.height, "cleared").toBe(0);
    expect(peak.step(torso(POSTS_DISTANCE, LIP_Y + 4), POSTS_DISTANCE, LIP_Y), "the next throw's own highest").toBe(4);
  });
});

const LAYOUT_CASES = [
  { name: "a record-sized best case", measured: { bestHeight: 230, landingDistance: 300 }, expectedFrameTop: 300, expectedBoardCount: 60, expectedMajorHeights: [0, 50, 100, 150, 200, 250], expectedNetHeight: 115 },
  { name: "a best case of 156.4 m, landing 32.2 m", measured: { bestHeight: 156.4, landingDistance: 32.2 }, expectedFrameTop: 205, expectedBoardCount: 41, expectedMajorHeights: [0, 50, 100, 150, 200], expectedNetHeight: 78.2 },
  { name: "the sizing measurement's best run (169.1 m, landing 32.2 m)", measured: { bestHeight: 169.1, landingDistance: 32.2 }, expectedFrameTop: 220, expectedBoardCount: 44, expectedMajorHeights: [0, 50, 100, 150, 200], expectedNetHeight: 84.55 },
  { name: "a best case a little over it", measured: { bestHeight: 157, landingDistance: 240 }, expectedFrameTop: 205, expectedBoardCount: 41, expectedMajorHeights: [0, 50, 100, 150, 200], expectedNetHeight: 78.5 },
  { name: "a best case whose headroom lands exactly on a board", measured: { bestHeight: 100, landingDistance: 160 }, expectedFrameTop: 130, expectedBoardCount: 26, expectedMajorHeights: [0, 50, 100], expectedNetHeight: 50 },
  { name: "a best case whose headroom just passes a big board", measured: { bestHeight: 38.5, landingDistance: 25 }, expectedFrameTop: 55, expectedBoardCount: 11, expectedMajorHeights: [0, 50], expectedNetHeight: 30 },
  { name: "a best case whose headroom just reaches a big board", measured: { bestHeight: 38.4, landingDistance: 25 }, expectedFrameTop: 50, expectedBoardCount: 10, expectedMajorHeights: [0], expectedNetHeight: 30 },
  { name: "a mid-sized best case", measured: { bestHeight: 20, landingDistance: 30 }, expectedFrameTop: 30, expectedBoardCount: 6, expectedMajorHeights: [0], expectedNetHeight: 30 },
  { name: "a tiny best case (the headroom factor alone would give under one board)", measured: { bestHeight: 3, landingDistance: 15 }, expectedFrameTop: 10, expectedBoardCount: 2, expectedMajorHeights: [0], expectedNetHeight: 30 },
  { name: "a landing beyond the net", measured: { bestHeight: 12, landingDistance: 90 }, expectedFrameTop: 20, expectedBoardCount: 4, expectedMajorHeights: [0], expectedNetHeight: 30 },
] as const;

function pileEndX(measured: HighJumpMeasured): number {
  return Math.min(measured.landingDistance + BOX_PILE_TRAIL, POSTS_DISTANCE + 30 - BOX_NET_CLEARANCE);
}

function boundingRadius(box: BoxPlacement): number {
  return Math.sqrt(box.width * box.width + box.depth * box.depth) / 2;
}

for (const layoutCase of LAYOUT_CASES) {
  describe(`given ${layoutCase.name} (best height ${layoutCase.measured.bestHeight} m, landing ${layoutCase.measured.landingDistance} m)`, () => {
    const measured = layoutCase.measured;
    const layout = highJumpLayout(measured, LIP_Y);

    it("when the layout is made, then the posts stand 11 m past the lip whatever was measured, and the net 30 m behind them", () => {
      expect(POSTS_DISTANCE, "the posts' distance").toBe(11);
      expect(layout.postsX, "postsX").toBe(POSTS_DISTANCE);
      expect(layout.netX, "netX is the posts plus 30 m").toBe(POSTS_DISTANCE + 30);
    });

    it("when the layout is made, then the frame top is the best height times the headroom, rounded up to a board", () => {
      expect(layout.frameTop, "frame top").toBe(layoutCase.expectedFrameTop);
      expect(layout.frameTop, "headroom factor kept").toBeGreaterThanOrEqual(measured.bestHeight * FRAME_HEADROOM_FACTOR);
      expect(layout.frameTop % BOARD_STEP, `frame top ${layout.frameTop} stands on a board height`).toBe(0);
      expect(layout.frameTop, "at least one board above the best height").toBeGreaterThanOrEqual(measured.bestHeight + BOARD_STEP);
    });

    it("when the layout is made, then a board stands every 5 m from the lip up to under the frame top", () => {
      expect(layout.boards.length, "board count").toBe(layoutCase.expectedBoardCount);
      expect(layout.boards[0].heightAboveLip, "the first board is the lip line").toBe(0);
      for (let index = 0; index < layout.boards.length; index++) {
        const board = layout.boards[index];
        expect(board.y, `board ${index} height above the pad`).toBe(LIP_Y + board.heightAboveLip);
        const nextHeight = layout.boards.at(index + 1)?.heightAboveLip ?? layout.frameTop;
        expect(nextHeight - board.heightAboveLip, `board ${index} is ${BOARD_STEP} m under the next board or the frame top`).toBe(BOARD_STEP);
      }
    });

    it("when the layout is made, then the big boards stand every 50 m from the lip and no other board is big", () => {
      const bigHeights = layout.boards.filter((board) => board.major).map((board) => board.heightAboveLip);
      expect(bigHeights.length, "big board count").toBe(layoutCase.expectedMajorHeights.length);
      for (let index = 0; index < bigHeights.length; index++) {
        expect(bigHeights[index], `big board ${index} height`).toBe(layoutCase.expectedMajorHeights[index]);
        expect(bigHeights[index] % MAJOR_BOARD_EVERY_METRES, `big board ${index} is a multiple of ${MAJOR_BOARD_EVERY_METRES} m`).toBe(0);
      }
      expect(layout.boards.length, "small boards exist between them").toBeGreaterThan(bigHeights.length);
    });

    it("when the layout is made, then a height mark stands at every 10 m from the lip, at its slat's height", () => {
      const expectedHeights = layout.boards.filter((board) => board.heightAboveLip % SIGN_EVERY_METRES === 0).map((board) => board.heightAboveLip);
      expect(JSON.stringify(layout.signs.map((sign) => sign.heightAboveLip)), "the marks' heights").toBe(JSON.stringify(expectedHeights));
      expect(layout.signs.length, "one per SIGN_EVERY_METRES below the frame top").toBe(Math.ceil(layout.frameTop / SIGN_EVERY_METRES));
      expect(layout.signs[0]!.heightAboveLip, "the lip line has the first").toBe(0);
      for (const sign of layout.signs) expect(sign.y, `the ${sign.heightAboveLip} m mark`).toBe(LIP_Y + sign.heightAboveLip);
    });

    it("when the layout is made, then the net is as tall as the larger of its minimum and half the best height", () => {
      expect(layout.netHeight, "net height").toBe(layoutCase.expectedNetHeight);
    });

    it("when the layout is made, then 48 boxes come back with sizes in range", () => {
      expect(layout.boxes.length, "box count").toBe(BOX_COUNT);
      for (const box of layout.boxes) {
        for (const side of [box.width, box.height, box.depth]) {
          expect(side >= BOX_SIZE_MIN && side <= BOX_SIZE_MAX, `side ${side} within ${BOX_SIZE_MIN}-${BOX_SIZE_MAX}`).toBeTruthy();
        }
      }
      const distinctWidths = new Set(layout.boxes.map((box) => box.width));
      expect(distinctWidths.size, `box widths vary (${distinctWidths.size} distinct)`).toBeGreaterThan(BOX_COUNT / 2);
    });

    it("when the boxes are laid out, then no box stands over a post (a post is a ragdoll collider: a box laid on it would be shoved out of the world)", () => {
      for (const [boxIndex, box] of layout.boxes.entries()) {
        for (const side of [-1, 1]) {
          const nearestX = Math.min(Math.max(box.x, layout.postsX - POST_THICKNESS / 2), layout.postsX + POST_THICKNESS / 2);
          const nearestZ = Math.min(Math.max(box.z, side * POST_HALF_SPAN - POST_THICKNESS / 2), side * POST_HALF_SPAN + POST_THICKNESS / 2);
          expect(Math.hypot(box.x - nearestX, box.z - nearestZ), `box ${boxIndex} reaches the ${side} post`).toBeGreaterThanOrEqual(boundingRadius(box) - 1e-9);
        }
      }
    });

    it("when the boxes are laid out, then none overlaps another (stacked ones only touch), within one nanometre", () => {
      let stackedPairs = 0;
      for (let first = 0; first < layout.boxes.length; first++) {
        for (let second = first + 1; second < layout.boxes.length; second++) {
          const lower = layout.boxes[first];
          const upper = layout.boxes[second];
          const centreDistance = Math.hypot(lower.x - upper.x, lower.z - upper.z);
          if (centreDistance >= boundingRadius(lower) + boundingRadius(upper)) continue;
          const verticalOverlap =
            Math.min(lower.y + lower.height / 2, upper.y + upper.height / 2) - Math.max(lower.y - lower.height / 2, upper.y - upper.height / 2);
          expect(verticalOverlap, `boxes ${first} and ${second} overlap by ${verticalOverlap}`).toBeLessThanOrEqual(BOX_OVERLAP_TOLERANCE);
          stackedPairs++;
        }
      }
      expect(stackedPairs, "some boxes are stacked, so the pair check had something to test").toBeGreaterThan(0);
    });

    it("when the boxes are laid out, then they rest on or above the pad, the bottom ones on it", () => {
      let boxesOnPad = 0;
      for (const box of layout.boxes) {
        const bottom = box.y - box.height / 2;
        expect(bottom, `bottom ${bottom} is above the pad`).toBeGreaterThanOrEqual(-BOX_OVERLAP_TOLERANCE);
        if (Math.abs(bottom) <= BOX_OVERLAP_TOLERANCE) boxesOnPad++;
      }
      expect(boxesOnPad, "some boxes stand on the pad").toBeGreaterThan(0);
    });

    it("when the boxes are laid out, then all lie within the pile footprint and short of the net", () => {
      const startX = POSTS_DISTANCE - BOX_PILE_LEAD;
      const endX = pileEndX(measured);
      for (const box of layout.boxes) {
        const radius = boundingRadius(box);
        expect(box.x - radius, `box at ${box.x} starts at or after ${startX}`).toBeGreaterThanOrEqual(startX - BOX_OVERLAP_TOLERANCE);
        expect(box.x + radius, `box at ${box.x} ends at or before ${endX}`).toBeLessThanOrEqual(endX + BOX_OVERLAP_TOLERANCE);
        expect(box.x + radius, `box at ${box.x} stops short of the net`).toBeLessThanOrEqual(layout.netX - BOX_NET_CLEARANCE + BOX_OVERLAP_TOLERANCE);
        expect(Math.abs(box.z) + radius, `box at z ${box.z} within the pile's width`).toBeLessThanOrEqual(BOX_PILE_HALF_WIDTH + BOX_OVERLAP_TOLERANCE);
      }
    });

    it("when the layout is made twice, then every box is the same", () => {
      const again = highJumpLayout(measured, LIP_Y);
      expect(again.boxes.length, "box count").toBe(layout.boxes.length);
      for (let index = 0; index < layout.boxes.length; index++) {
        const box = layout.boxes[index];
        const copy = again.boxes[index];
        expect(copy.x, `box ${index} x`).toBe(box.x);
        expect(copy.y, `box ${index} y`).toBe(box.y);
        expect(copy.z, `box ${index} z`).toBe(box.z);
        expect(copy.yaw, `box ${index} yaw`).toBe(box.yaw);
        expect(copy.width, `box ${index} width`).toBe(box.width);
        expect(copy.height, `box ${index} height`).toBe(box.height);
        expect(copy.depth, `box ${index} depth`).toBe(box.depth);
      }
    });
  });
}

describe("given a landing so near the posts that the piles cannot hold one cell", () => {
  it("when the layout is made, then it refuses to lay out the boxes", () => {
    const measured = { bestHeight: 12, landingDistance: POSTS_DISTANCE - BOX_PILE_LEAD - BOX_PILE_TRAIL + BOX_CELL_PITCH / 2 };
    expect(() => highJumpLayout(measured, LIP_Y)).toThrow(RangeError);
  });
});

describe("given the layout's boards for a different lip height", () => {
  it("when the lip is raised, then the boards' heights above the lip stay and their heights above the pad follow", () => {
    const low = highJumpLayout(SYNTHETIC_MEASURED, 0);
    const high = highJumpLayout(SYNTHETIC_MEASURED, 4);
    expect(high.boards.length, "board count").toBe(low.boards.length);
    for (let index = 0; index < low.boards.length; index++) {
      expect(high.boards[index].heightAboveLip, `board ${index} above the lip`).toBe(low.boards[index].heightAboveLip);
      expect(high.boards[index].y, `board ${index} above the pad`).toBe(low.boards[index].y + 4);
    }
  });
});

/** The lying dummy's length (present/ragdoll-body.ts PARTS; scenes may not import present). */
const DUMMY_LYING_LENGTH = 2.0;
const SIZING_MEASURED: HighJumpMeasured = { bestHeight: 156.4, landingDistance: 32.2 };
const LAYERS_AT_SIZING_LANDING = 3;

describe("given the sizing measurement's landing, where the piles are narrow", () => {
  const boxes = highJumpLayout(SIZING_MEASURED, LIP_Y).boxes;

  it("when the boxes are laid out, then every box has an edge about as long as the lying dummy, so he lands among boxes", () => {
    for (const box of boxes) {
      expect(Math.max(box.width, box.height, box.depth), `box ${box.width} x ${box.height} x ${box.depth} is dummy-sized`).toBeGreaterThanOrEqual(DUMMY_LYING_LENGTH * 0.8);
    }
  });

  it("when the boxes are laid out, then 48 of them fit in stacks no higher than three boxes, on cells the largest box cannot spill out of", () => {
    const stackTops = new Map<string, number>();
    for (const box of boxes) {
      const stackKey = `${Math.round(box.x / BOX_CELL_PITCH)}:${Math.round(box.z / BOX_CELL_PITCH)}`;
      stackTops.set(stackKey, Math.max(stackTops.get(stackKey) ?? 0, box.y + box.height / 2));
    }
    expect(boxes.length, "box count").toBe(BOX_COUNT);
    expect(Math.max(...stackTops.values()), `tallest stack ${Math.max(...stackTops.values())} m`).toBeLessThanOrEqual(LAYERS_AT_SIZING_LANDING * BOX_SIZE_MAX);
  });
});
