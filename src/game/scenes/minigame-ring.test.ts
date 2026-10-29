import { describe, expect, it } from "vitest";
import {
  RING_BOARD_BOUNDS,
  RING_BOARD_START_X,
  RING_CUPS,
  RING_CUP_PROFILE,
  RING_MESH_STEP,
  RING_POCKETS,
  RING_RAIL_PROFILE,
  ringBoardMesh,
  ringBoardPlaneHeight,
  ringHeightAt,
  ringScore,
  type RingZone,
} from "./minigame-ring.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

const ALL_ZONES: readonly RingZone[] = [...RING_CUPS, ...RING_POCKETS];
/** The narrowest window (m across) a 100 pocket's scoring circle may offer: wide enough that a precise line and speed can land him in one. */
const POCKET_AIM_WINDOW = 1.2;
const GRAVITY = 9.80665;

/** The lying dummy and his torso box (present/ragdoll-body.ts PARTS; scenes may not import present). */
const DUMMY_LYING_WIDTH = 0.58;
const DUMMY_LYING_LENGTH = 2.0;
const DUMMY_TORSO_WIDTH = 0.36;
const DUMMY_TORSO_LENGTH = 0.54;

/** The throw the board is designed for: 15-22 m/s up 35 degrees from the lip. */
const DESIGN_THROW_PITCH = (35 * Math.PI) / 180;
const DESIGN_THROW_SPEED_MIN = 15;
const DESIGN_THROW_SPEED_MAX = 22;

const EDGE_NUDGE = 1e-6;
const DIRECTIONS_AROUND_A_ZONE = [0, Math.PI / 3, Math.PI / 2, Math.PI, (4 * Math.PI) / 3] as const;
const FLOAT32_EPSILON = 2 ** -23;

/** Radial cross-section slope bounds: the steepest wall in the board (rise over its footprint). */
const STEEPEST_WALL_SLOPE = Math.max(
  RING_CUP_PROFILE.wallHeight / RING_CUP_PROFILE.wallFootWidth,
  RING_RAIL_PROFILE.height / RING_RAIL_PROFILE.slopeWidth,
);
const PLANE_SLOPE = ringBoardPlaneHeight(RING_BOARD_START_X + 1) - ringBoardPlaneHeight(RING_BOARD_START_X);
const STEEPEST_SURFACE_SLOPE = STEEPEST_WALL_SLOPE + PLANE_SLOPE;

function floorRadius(zone: RingZone, scale = 1): number {
  return (zone.radius - RING_CUP_PROFILE.wallFootWidth) * scale;
}

function halfDiagonal(width: number, length: number): number {
  return Math.sqrt(width * width + length * length) / 2;
}

/** A rectangle of width x length lies inside the flat floor circle at any heading iff its half diagonal fits the floor radius. */
function floorHoldsRectangle(zone: RingZone, width: number, length: number, scale = 1): boolean {
  return floorRadius(zone, scale) >= halfDiagonal(width, length);
}

function cupNamed(score: number): RingZone {
  const cup = RING_CUPS.find((candidate) => candidate.score === score);
  must(cup, `cup ${score} exists`);
  return cup;
}

describe("given the ring board's cups and pockets", () => {
  for (const zone of ALL_ZONES) {
    const label = `${zone.score} at z ${zone.centreZ.toFixed(2)}`;
    it(`when scoring the centre of the ${label} zone, then it scores ${zone.score}`, () => {
      expect(ringScore(zone.centreX, zone.centreZ), "score at the zone centre").toBe(zone.score);
    });
    it(`when scoring just inside the ${label} zone's edge in several directions, then it scores ${zone.score}`, () => {
      for (const direction of DIRECTIONS_AROUND_A_ZONE) {
        const reach = zone.radius - EDGE_NUDGE;
        const score = ringScore(zone.centreX + reach * Math.cos(direction), zone.centreZ + reach * Math.sin(direction));
        expect(score, `score just inside at heading ${direction.toFixed(2)}`).toBe(zone.score);
      }
    });
    it(`when scoring just outside the ${label} zone's edge in several directions, then it scores 0`, () => {
      for (const direction of DIRECTIONS_AROUND_A_ZONE) {
        const reach = zone.radius + EDGE_NUDGE;
        const score = ringScore(zone.centreX + reach * Math.cos(direction), zone.centreZ + reach * Math.sin(direction));
        expect(score, `score just outside at heading ${direction.toFixed(2)}`).toBe(0);
      }
    });
  }

  const offCupPoints = [
    { it: "when scoring the board's front apron, then it scores 0", localX: RING_BOARD_START_X + 1, localZ: 0 },
    { it: "when scoring the bare board beside the cups, then it scores 0", localX: RING_CUPS[2]!.centreX, localZ: RING_BOARD_BOUNDS.maxZ - 0.5 },
    { it: "when scoring a point behind the lip but short of the board, then it scores 0", localX: 0, localZ: 0 },
    { it: "when scoring a point past the board's back edge, then it scores 0", localX: RING_BOARD_BOUNDS.maxX + 1, localZ: 0 },
    { it: "when scoring a point left of the board, then it scores 0", localX: RING_CUPS[0]!.centreX, localZ: RING_BOARD_BOUNDS.minZ - 1 },
    { it: "when scoring a point right of the board, then it scores 0", localX: RING_CUPS[0]!.centreX, localZ: RING_BOARD_BOUNDS.maxZ + 1 },
    { it: "when scoring the strip of rim between two touching cups, then it scores 0", localX: (RING_CUPS[0]!.centreX + RING_CUPS[1]!.centreX) / 2 + (RING_CUPS[0]!.radius - RING_CUPS[1]!.radius) / 2, localZ: 0 },
  ];
  for (const point of offCupPoints) {
    it(point.it, () => {
      expect(ringScore(point.localX, point.localZ), "score off every cup").toBe(0);
    });
  }

  it("when the two 100 pockets are compared, then they score 100 and are mirror images across the lane centre", () => {
    expect(RING_POCKETS.length, "pocket count").toBe(2);
    const [left, right] = RING_POCKETS;
    expect(left!.score, "left pocket score").toBe(100);
    expect(right!.score, "right pocket score").toBe(100);
    expect(left!.centreX, "pockets at the same x").toBe(right!.centreX);
    expect(left!.centreZ, "pockets on opposite sides of the centre").toBe(-right!.centreZ);
    expect(left!.centreZ, "pockets are off the centreline").not.toBe(0);
    expect(left!.radius, "pocket radius").toBe(right!.radius);
    expect(left!.floorHeight, "pocket floor height").toBe(right!.floorHeight);
    expect(left!.rimHeight, "pocket rim height").toBe(right!.rimHeight);
    expect(ringScore(left!.centreX, left!.centreZ), "score at the left pocket").toBe(100);
    expect(ringScore(right!.centreX, right!.centreZ), "score at the right pocket").toBe(100);
  });
});

describe("given the layout read off the skee-ball picture", () => {
  /** Radius over the 10 cup's, from each cup's width in the picture (50 px wide for the 10): 48, 42, 40, 34 px, read by eye to within 6 px, so +-0.12 with the picture's perspective. */
  const pictureRadiusRatios = [
    { it: "when the 20 cup is measured against the 10, then it is about 0.96 as wide", score: 20, ratioToTen: 0.96 },
    { it: "when the 30 cup is measured against the 10, then it is about 0.84 as wide", score: 30, ratioToTen: 0.84 },
    { it: "when the 40 cup is measured against the 10, then it is about 0.80 as wide", score: 40, ratioToTen: 0.8 },
    { it: "when the 50 cup is measured against the 10, then it is about 0.68 as wide", score: 50, ratioToTen: 0.68 },
  ];
  const PICTURE_RATIO_TOLERANCE = 0.12;
  for (const testCase of pictureRadiusRatios) {
    it(testCase.it, () => {
      const ratio = cupNamed(testCase.score).radius / cupNamed(10).radius;
      expect(Math.abs(ratio - testCase.ratioToTen), `radius ratio ${ratio.toFixed(3)} vs ${testCase.ratioToTen}`).toBeLessThanOrEqual(PICTURE_RATIO_TOLERANCE);
    });
  }

  it("when the 100 pocket is measured against the 50 cup, then it is about 0.9 as wide (the picture: 30 px against 34) and the smallest zone", () => {
    const ratio = RING_POCKETS[0]!.radius / cupNamed(50).radius;
    expect(Math.abs(ratio - 0.9), `pocket to 50 radius ratio ${ratio.toFixed(3)}`).toBeLessThanOrEqual(0.12);
    for (const cup of RING_CUPS) expect(RING_POCKETS[0]!.radius, `pocket smaller than the ${cup.score} cup`).toBeLessThan(cup.radius);
  });

  it("when the 10 cup is measured against the lane width, then it is about 0.30 of it (54 px of 178 px) within 0.1", () => {
    const laneWidth = RING_BOARD_BOUNDS.maxZ - RING_BOARD_BOUNDS.minZ;
    const ratio = (2 * cupNamed(10).radius) / laneWidth;
    expect(Math.abs(ratio - 0.3), `10 cup width over lane width ${ratio.toFixed(3)}`).toBeLessThanOrEqual(0.1);
  });

  it("when the cups are listed by score, then size falls, height rises and each lies farther back, all on the centreline", () => {
    const scores = RING_CUPS.map((cup) => cup.score);
    expect(firstMismatch(scores, [10, 20, 30, 40, 50]), "score order").toBeUndefined();
    for (let index = 1; index < RING_CUPS.length; index++) {
      const lower = RING_CUPS[index - 1]!;
      const higher = RING_CUPS[index]!;
      expect(higher.radius, `${higher.score} cup narrower than the ${lower.score}`).toBeLessThan(lower.radius);
      expect(higher.floorHeight, `${higher.score} floor above the ${lower.score}`).toBeGreaterThan(lower.floorHeight);
      expect(higher.rimHeight, `${higher.score} rim above the ${lower.score}`).toBeGreaterThan(lower.rimHeight);
      expect(higher.centreX, `${higher.score} farther back than the ${lower.score}`).toBeGreaterThan(lower.centreX);
    }
    for (const cup of RING_CUPS) expect(cup.centreZ, `${cup.score} cup on the centreline`).toBe(0);
  });

  it("when the 100 pockets are placed, then they are the highest zones, behind the 50 cup, in the two back corners beside the cup column", () => {
    const fifty = cupNamed(50);
    const cupReach = RING_CUP_PROFILE.rimTopWidth + RING_CUP_PROFILE.skirtWidth;
    for (const pocket of RING_POCKETS) {
      expect(pocket.floorHeight, "pocket floor above the 50's").toBeGreaterThan(fifty.floorHeight);
      expect(pocket.rimHeight, "pocket rim above the 50's").toBeGreaterThan(fifty.rimHeight);
      expect(pocket.centreX, "pocket behind the 50").toBeGreaterThan(fifty.centreX);
      expect(Math.abs(pocket.centreZ), "pocket outside the widest cup's width").toBeGreaterThan(cupNamed(10).radius);
      const reach = pocket.radius + cupReach;
      expect(Math.abs(pocket.centreZ) + reach, "pocket skirt inside the side rim line").toBeLessThanOrEqual(RING_BOARD_BOUNDS.maxZ);
      expect(pocket.centreX + reach, "pocket skirt inside the back edge").toBeLessThanOrEqual(RING_BOARD_BOUNDS.maxX);
      expect(RING_BOARD_BOUNDS.maxX - (pocket.centreX + reach), "pocket is in the back corner, not the middle").toBeLessThan(2 * reach);
    }
  });

  it("when every pair of zones is compared, then their rims never overlap", () => {
    for (let first = 0; first < ALL_ZONES.length; first++) {
      for (let second = first + 1; second < ALL_ZONES.length; second++) {
        const a = ALL_ZONES[first]!;
        const b = ALL_ZONES[second]!;
        const distance = Math.hypot(a.centreX - b.centreX, a.centreZ - b.centreZ);
        const rimsTouchAt = a.radius + b.radius + 2 * RING_CUP_PROFILE.rimTopWidth;
        expect(distance, `${a.score} and ${b.score} rims ${distance.toFixed(3)} apart, need ${rimsTouchAt.toFixed(3)}`).toBeGreaterThanOrEqual(rimsTouchAt - 1e-9);
      }
    }
  });
});

describe("given a lying dummy and the cups' size", () => {
  for (const cup of RING_CUPS) {
    it(`when a ${DUMMY_LYING_WIDTH} x ${DUMMY_LYING_LENGTH} m lying dummy is set on the ${cup.score} cup's floor, then he fits at any heading`, () => {
      expect(floorHoldsRectangle(cup, DUMMY_LYING_WIDTH, DUMMY_LYING_LENGTH), `${cup.score} cup floor radius ${floorRadius(cup).toFixed(3)} holds him`).toBeTruthy();
    });
  }

  it("when the cups shrink by a quarter, then the 50 cup no longer holds him (the check can fail)", () => {
    const SHRINK = 0.75;
    expect(floorHoldsRectangle(cupNamed(50), DUMMY_LYING_WIDTH, DUMMY_LYING_LENGTH), "full size holds him").toBeTruthy();
    expect(!floorHoldsRectangle(cupNamed(50), DUMMY_LYING_WIDTH, DUMMY_LYING_LENGTH, SHRINK), "three quarters size cannot").toBe(true);
  });

  it("when a pocket is measured, then its scoring circle is at least the aim window wide and its floor holds his torso", () => {
    for (const pocket of RING_POCKETS) {
      expect(2 * pocket.radius, `pocket window ${(2 * pocket.radius).toFixed(3)} m`).toBeGreaterThanOrEqual(POCKET_AIM_WINDOW);
      expect(floorHoldsRectangle(pocket, DUMMY_TORSO_WIDTH, DUMMY_TORSO_LENGTH), "pocket floor holds a torso").toBeTruthy();
    }
  });
});

describe("given the board is the surface a thrown dummy lands on", () => {
  it("when a flight leaves the lip at the design pitch, then the speed that arrives on each cup's floor rises with its score and stays in the design speed range", () => {
    /** Flat flight from the lip (y = 0): y = x tan(p) - g x^2 / (2 v^2 cos^2(p)), solved for the speed v that is at `floor` over `distance`. */
    function speedToReach(distance: number, floorHeight: number): number {
      const climbed = distance * Math.tan(DESIGN_THROW_PITCH) - floorHeight;
      expect(climbed, "the flight must clear the floor height at that distance").toBeGreaterThan(0);
      return Math.sqrt((GRAVITY * distance * distance) / (2 * Math.cos(DESIGN_THROW_PITCH) ** 2 * climbed));
    }
    let previousSpeed = 0;
    for (const zone of [...RING_CUPS, RING_POCKETS[0]!]) {
      const speed = speedToReach(zone.centreX, zone.floorHeight);
      expect(speed, `${zone.score} needs more speed (${speed.toFixed(2)}) than the one before (${previousSpeed.toFixed(2)})`).toBeGreaterThan(previousSpeed);
      expect(speed >= DESIGN_THROW_SPEED_MIN && speed <= DESIGN_THROW_SPEED_MAX, `${zone.score} needs ${speed.toFixed(2)} m/s`).toBeTruthy();
      previousSpeed = speed;
    }
  });
});

describe("given the board's height function", () => {
  it("when it is sampled at the board's front edge on the centreline, then it is at pad height", () => {
    expect(ringHeightAt(RING_BOARD_BOUNDS.minX, 0), "height where the hump ends").toBe(0);
  });

  it("when it is sampled off the board, then it is the pad", () => {
    expect(ringHeightAt(0, 0), "short of the board").toBe(0);
    expect(ringHeightAt(RING_BOARD_BOUNDS.maxX + 1, 0), "past the back").toBe(0);
    expect(ringHeightAt(RING_CUPS[0]!.centreX, RING_BOARD_BOUNDS.maxZ + 1), "beside the board").toBe(0);
  });

  it("when it is sampled along the bare apron beside the cups, then it rises toward the back at the board's slope", () => {
    const apronZ = (cupNamed(10).radius + RING_BOARD_BOUNDS.maxZ) / 2;
    const samples = [RING_CUPS[0]!.centreX, RING_CUPS[1]!.centreX, RING_CUPS[2]!.centreX];
    let previous = ringHeightAt(RING_BOARD_BOUNDS.minX + 1, apronZ);
    for (const localX of samples) {
      const height = ringHeightAt(localX, apronZ);
      expect(height, `apron rises by ${localX.toFixed(1)} m`).toBeGreaterThan(previous);
      expect(height, `apron height at ${localX.toFixed(1)} equals the board plane`).toBe(ringBoardPlaneHeight(localX));
      previous = height;
    }
  });

  for (const zone of ALL_ZONES) {
    it(`when it is sampled inside the ${zone.score} zone at z ${zone.centreZ.toFixed(2)}, then the floor is flat at its height, its crest is at the rim height and it meets the board past its skirt`, () => {
      expect(ringHeightAt(zone.centreX, zone.centreZ), "floor at the centre").toBe(zone.floorHeight);
      expect(ringHeightAt(zone.centreX, zone.centreZ + floorRadius(zone) * 0.9), "floor off the centre").toBe(zone.floorHeight);
      const crest = zone.radius + RING_CUP_PROFILE.rimTopWidth / 2;
      expect(ringHeightAt(zone.centreX, zone.centreZ + crest), "rim crest").toBe(zone.rimHeight);
      expect(zone.floorHeight, "floor is raised over the board under the cup").toBeGreaterThanOrEqual(ringBoardPlaneHeight(zone.centreX + zone.radius));
      const pastSkirt = zone.radius + RING_CUP_PROFILE.rimTopWidth + RING_CUP_PROFILE.skirtWidth + 0.01;
      const isCup = zone.centreZ === 0;
      const probeX = isCup ? zone.centreX : zone.centreX - pastSkirt;
      const probeZ = isCup ? pastSkirt : zone.centreZ;
      expect(ringHeightAt(probeX, probeZ), "board past the skirt").toBe(ringBoardPlaneHeight(probeX));
    });
  }

  it("when it is sampled across the side rim, then it rises to the rim height at the board's edge and falls back to the board inside its slope, mirrored left and right", () => {
    const localX = RING_CUPS[2]!.centreX;
    const board = ringBoardPlaneHeight(localX);
    for (const side of [-1, 1]) {
      expect(ringHeightAt(localX, side * (RING_BOARD_BOUNDS.maxZ - RING_RAIL_PROFILE.topWidth / 2)), "rim top").toBe(board + RING_RAIL_PROFILE.height);
      const insideSlope = RING_BOARD_BOUNDS.maxZ - RING_RAIL_PROFILE.topWidth - RING_RAIL_PROFILE.slopeWidth - 0.01;
      expect(ringHeightAt(localX, side * insideSlope), "board inside the rim").toBe(board);
    }
  });

  it("when it is sampled around the back and into a back corner, then the rim keeps its height all the way round", () => {
    const board = ringBoardPlaneHeight(RING_BOARD_BOUNDS.maxX - RING_RAIL_PROFILE.topWidth / 2);
    expect(ringHeightAt(RING_BOARD_BOUNDS.maxX - RING_RAIL_PROFILE.topWidth / 2, 0), "back wall").toBe(board + RING_RAIL_PROFILE.height);
    const pocket = RING_POCKETS[1]!;
    const cornerRadius = RING_BOARD_BOUNDS.maxX - pocket.centreX;
    const alongCornerArc = (cornerRadius - RING_RAIL_PROFILE.topWidth / 2) / Math.SQRT2;
    const cornerX = pocket.centreX + alongCornerArc;
    expect(ringHeightAt(cornerX, pocket.centreZ + alongCornerArc), "back-right corner arc").toBe(ringBoardPlaneHeight(cornerX) + RING_RAIL_PROFILE.height);
  });

  it("when it is sampled at mirrored points across the lane centre, then the heights are equal", () => {
    for (let localX = RING_BOARD_BOUNDS.minX; localX <= RING_BOARD_BOUNDS.maxX; localX += 0.37) {
      for (let localZ = 0.11; localZ <= RING_BOARD_BOUNDS.maxZ; localZ += 0.29) {
        expect(ringHeightAt(localX, localZ), `height at ${localX.toFixed(2)}, ${localZ.toFixed(2)}`).toBe(ringHeightAt(localX, -localZ));
      }
    }
  });

  it("when it is walked across the whole board in 5 cm steps, then no step rises or falls faster than the steepest wall allows (no cliffs)", () => {
    const spacing = 0.05;
    const largestAllowedStep = STEEPEST_SURFACE_SLOPE * spacing;
    let largestStep = 0;
    for (let localZ = RING_BOARD_BOUNDS.minZ; localZ <= RING_BOARD_BOUNDS.maxZ; localZ += spacing) {
      let previous = ringHeightAt(RING_BOARD_BOUNDS.minX, localZ);
      for (let localX = RING_BOARD_BOUNDS.minX + spacing; localX <= RING_BOARD_BOUNDS.maxX; localX += spacing) {
        const height = ringHeightAt(localX, localZ);
        largestStep = Math.max(largestStep, Math.abs(height - previous));
        previous = height;
      }
    }
    expect(largestStep, `largest step ${largestStep.toFixed(4)} m over ${spacing} m, allowed ${largestAllowedStep.toFixed(4)}`).toBeLessThanOrEqual(largestAllowedStep);
    expect(largestStep, `the walk reached a wall (${largestStep.toFixed(4)} m): the bound is not vacuous`).toBeGreaterThan(largestAllowedStep / 4);
  });
});

describe("given the board sampled into a triangle mesh", () => {
  const mesh = ringBoardMesh(RING_MESH_STEP);
  const vertexCount = mesh.vertices.length / 3;
  const MESH_HEIGHT_TOLERANCE = STEEPEST_SURFACE_SLOPE * RING_BOARD_BOUNDS.maxX * FLOAT32_EPSILON;

  it("when a vertex is compared with the height function, then its height is the function's at the vertex's own x and z, and the mesh reaches the pocket rims", () => {
    let largestError = 0;
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const localX = mesh.vertices[vertex * 3]!;
      const height = mesh.vertices[vertex * 3 + 1]!;
      const localZ = mesh.vertices[vertex * 3 + 2]!;
      largestError = Math.max(largestError, Math.abs(height - ringHeightAt(localX, localZ)));
    }
    expect(largestError, `largest vertex height error ${largestError} (tolerance ${MESH_HEIGHT_TOLERANCE})`).toBeLessThanOrEqual(MESH_HEIGHT_TOLERANCE);
    let highest = 0;
    for (let vertex = 0; vertex < vertexCount; vertex++) highest = Math.max(highest, mesh.vertices[vertex * 3 + 1]!);
    expect(highest, `mesh reaches the pocket rims (${highest} m vs ${RING_POCKETS[0]!.rimHeight})`).toBeGreaterThanOrEqual(RING_POCKETS[0]!.rimHeight - MESH_HEIGHT_TOLERANCE);
  });

  it("when the triangles are laid out in plan, then they tile the board exactly and no edge is longer than the step allows", () => {
    let plannedArea = 0;
    let longestEdge = 0;
    for (let corner = 0; corner < mesh.indices.length; corner += 3) {
      const base = [mesh.indices[corner]! * 3, mesh.indices[corner + 1]! * 3, mesh.indices[corner + 2]! * 3] as const;
      const [ax, az] = [mesh.vertices[base[0]]!, mesh.vertices[base[0] + 2]!];
      const [bx, bz] = [mesh.vertices[base[1]]!, mesh.vertices[base[1] + 2]!];
      const [cx, cz] = [mesh.vertices[base[2]]!, mesh.vertices[base[2] + 2]!];
      plannedArea += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      longestEdge = Math.max(longestEdge, Math.hypot(bx - ax, bz - az), Math.hypot(cx - bx, cz - bz), Math.hypot(ax - cx, az - cz));
    }
    const boardArea = (RING_BOARD_BOUNDS.maxX - RING_BOARD_BOUNDS.minX) * (RING_BOARD_BOUNDS.maxZ - RING_BOARD_BOUNDS.minZ);
    expect(Math.abs(plannedArea - boardArea), `triangle area ${plannedArea.toFixed(3)} m2 vs board ${boardArea.toFixed(3)} m2`).toBeLessThanOrEqual(boardArea * 1e-5);
    expect(longestEdge, `longest edge ${longestEdge.toFixed(4)} m (diagonal of a ${RING_MESH_STEP} m cell)`).toBeLessThanOrEqual(RING_MESH_STEP * Math.SQRT2 * (1 + 1e-5));
  });

  it("when the mesh is sampled at a coarse step, then its vertices still span the board's bounds with no gap above that step", () => {
    const coarseStep = 1.5;
    const coarse = ringBoardMesh(coarseStep);
    const xs = new Set<number>();
    const zs = new Set<number>();
    for (let vertex = 0; vertex < coarse.vertices.length; vertex += 3) {
      xs.add(coarse.vertices[vertex]!);
      zs.add(coarse.vertices[vertex + 2]!);
    }
    const sortedXs = [...xs].sort((first, second) => first - second);
    const sortedZs = [...zs].sort((first, second) => first - second);
    expect(sortedXs[0], "first column at the front edge").toBe(Math.fround(RING_BOARD_BOUNDS.minX));
    expect(sortedXs.at(-1), "last column at the back edge").toBe(Math.fround(RING_BOARD_BOUNDS.maxX));
    expect(sortedZs[0], "first row at the left edge").toBe(Math.fround(RING_BOARD_BOUNDS.minZ));
    expect(sortedZs.at(-1), "last row at the right edge").toBe(Math.fround(RING_BOARD_BOUNDS.maxZ));
    for (const axis of [sortedXs, sortedZs]) {
      for (let index = 1; index < axis.length; index++) {
        expect(axis[index]! - axis[index - 1]!, `gap ${(axis[index]! - axis[index - 1]!).toFixed(4)} m`).toBeLessThanOrEqual(coarseStep + 1e-5);
      }
    }
  });

  it("when every triangle corner of the mesh is checked, then it is a vertex that exists, and the mesh has over 1000 vertices", () => {
    for (let corner = 0; corner < mesh.indices.length; corner++) expect(mesh.indices[corner]!, `index ${corner}`).toBeLessThan(vertexCount);
    expect(vertexCount, `${vertexCount} vertices`).toBeGreaterThan(1000);
  });
});
