import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hypot2 } from "../kernel/physics-core.js";
import { LANDING_HEIGHT, MINIGAME_MODE, STATION_HALF_WIDTH } from "../scenes/minigame-constants.ts";
import { climbFootX, floorHeightAt, stationFrontX } from "../scenes/minigame-profile.ts";
import { FIELD_HALF_WIDTH, POST_HALF_SPAN, POST_THICKNESS, SLAT_THICKNESS, type HighJumpLayout } from "../scenes/minigame-high-jump.ts";
import { CANVAS_WHITE, canvasTexture } from "./lab-art.ts";
import { signAtlas, signFace } from "./range-art.ts";

const HIGH_JUMP = MINIGAME_MODE.highJump;

/**
 * Half the width (m) of the run-up's lane the barrels and the stop block flank. Must match the strip the station's surface helper
 * paints (`makeStationSurface`); until that lands this is the one place the art knows it.
 */
const LANE_HALF_WIDTH = 4;

const TIMBER_COLOR = "#8a6a43";
const TIMBER_STREAK_DARK = "rgba(52,34,16,0.35)";
const TIMBER_STREAK_LIGHT = "rgba(190,150,98,0.3)";
const STEEL_COLOR = 0x4a5058;
const BRASS_COLOR = 0xc9a23a;
const BARREL_RUST_COLOR = 0x8a4a22;
const BARREL_BAND_COLOR = 0xd8a820;
const CHEVRON_COLOR = 0xe8c21c;
const STOP_RED_COLOR = 0xb8302a;
const STOP_WHITE_COLOR = 0xe8e4da;
const DASH_COLOR = 0xfff6c8;

/**
 * The net's timbers grow with its height so a 78 m net does not read as a grid on needles: a net of `height` m is built this many times
 * thicker per metre of height (never under 1). The net's poles, cables and mesh scale by the ratio; the frame's posts and slats never do.
 */
const NET_THICKNESS_PER_METRE = 0.02;

/** How many times thicker than the base sizes a net of `height` m is built. */
function thicknessScale(height: number): number {
  return Math.max(1, height * NET_THICKNESS_PER_METRE);
}

/**
 * The timbers' wood grain (net frame, kicker, fascia): a streaked tile that repeats once per `TIMBER_TILE_METRES` along every face (each
 * box's uvs are written in metres), so a long timber carries grain at the size of a pole, not one texture stretched over its length.
 */
const TIMBER_TEXTURE_PX = 128;
const TIMBER_STREAK_COUNT = 40;
const TIMBER_STREAK_STRIDE = 37;
const TIMBER_TILE_METRES = 2;

function paintTimber(context: CanvasRenderingContext2D): void {
  context.fillStyle = TIMBER_COLOR;
  context.fillRect(0, 0, TIMBER_TEXTURE_PX, TIMBER_TEXTURE_PX);
  for (let streak = 0; streak < TIMBER_STREAK_COUNT; streak++) {
    context.fillStyle = streak % 2 === 0 ? TIMBER_STREAK_DARK : TIMBER_STREAK_LIGHT;
    context.fillRect((streak * TIMBER_STREAK_STRIDE) % TIMBER_TEXTURE_PX, 0, 1 + (streak % 3), TIMBER_TEXTURE_PX);
  }
}

/** The posts: near-black, a little glossy. A post's cap is a slab a little wider than the post, above its top. */
const POST_COLOR = 0x111111;
const POST_ROUGHNESS = 0.6;
const POST_CAP_HEIGHT = 0.25;
const POST_CAP_OVERHANG = 1.3;

/** The brass plate on each post at a slat without a height plate: depth along the throw, share of the post's width, height (m). */
const PLATE = { depth: 0.04, widthShare: 0.8, height: 0.3 } as const;
/** A height plate (m): half the range's 2.6 x 1.3 m distance sign, so a lip-side chase camera about 20 m off reads its number; lifted off the post's face against z-fighting. */
const HEIGHT_PLATE = { width: 1.3, height: 0.65, lift: 0.02 } as const;
/** The slats' paint: the major ones (every 50 m) the signs' yellow, the rest plain timber. */
const SLAT_COLOR = { major: 0xe3b93f, minor: 0xb08a58 } as const;
/** `BoxGeometry` builds six 4-vertex faces. */
const BOX_VERTICES_PER_FACE = 4;
const BOX_FACE_COUNT = 6;

/** The lip's dashed height line: dash and gap lengths along the throw, and the line's thickness (m): thick enough to read against the red strip and the dark ground. */
const DASH = { length: 1.5, gap: 1, thickness: 0.25 } as const;

/** The net: it reaches this far (m) either side beyond the capture band; each end pole stands this far above the net. */
const NET_SIDE_MARGIN = 3;
/** Half the net's width (m): the drawn net and the ground's net prism share it. */
export const NET_HALF_WIDTH = FIELD_HALF_WIDTH + NET_SIDE_MARGIN;
/** The net's poles and top cable are stout (a 78 m net on 0.3 m sticks reads as a grid hanging in the void) and scale with its height. */
const NET_POLE_THICKNESS = 0.5;
const NET_POLE_EXTRA_HEIGHT = 1;
const NET_CABLE_THICKNESS = 0.25;
/** A pole stands at both ends and at least every this many metres between; a back row stands this far behind each, tied by a stay at the net's top. */
const NET_POLE_SPACING = 15;
const NET_BACK_ROW_SETBACK = 4;
/** A steel cable crosses the net at every multiple of this many metres of height, below the top one. */
const NET_CABLE_SPACING = 20;

/**
 * The kicker's cosmetic supports on each flank of the station's band (whose side walls are the dark slate): ribs every `pitch` m
 * (about; the run is split evenly) from the climb's foot to the lip, each `outset` wide outside the wall and `depth` along the run,
 * a beam `beam` thick laid on the floor's edge in steps of `beamStep` m of run (a chord of the arc each, so it hugs the floor even at the lip's
 * 60 degrees), ribs shorter than `minHeight` skipped.
 */
const KICKER_RIB = { pitch: 3, depth: 0.3, outset: 0.4, beam: 0.5, beamStep: 0.5, minHeight: 0.3 } as const;
/** The fascia over the lip's back face: its thickness and how far it stands off the face (m), against z-fighting. */
const LIP_FASCIA = { thickness: 0.2, lift: 0.02 } as const;

/**
 * One mesh of the weave (m) and its line width (px of the cell's `NET_TEXTURE_PX`): a line is `NET_MESH_SIZE * NET_LINE_PX / NET_TEXTURE_PX`
 * = 10 cm, about 2 px at 40 m. The texture takes no mipmaps: a mip of a thin line averages under the alpha cut and the far net would
 * vanish, where an unfiltered sample keeps the lines (they shimmer, as a net does).
 */
const NET_MESH_SIZE = 0.8;
const NET_TEXTURE_PX = 64;
const NET_LINE_PX = 8;
const NET_ALPHA_CUTOFF = 0.5;
const NET_COLOR = 0xffffff;

/** Run-up dressing: barrels flank the kicker's foot, chevron strips lie before it, a striped stop block sits at the lip. */
const BARREL = { radius: 0.45, height: 1.1, bandRadiusExtra: 0.02, bandHeight: 0.3, sides: 14, mouthSetback: 1 } as const;
const CHEVRON = { count: 3, pitch: 3, firstSetback: 4, armLength: 3.2, armWidth: 0.55, halfAngle: (35 * Math.PI) / 180, lift: 0.03 } as const;
const STOP_BLOCK = { depth: 0.3, height: 0.5, stripes: 8 } as const;

/** `geometry` with every vertex coloured `hex` (the trim's material reads vertex colours, so one draw carries every colour). */
function painted(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const vertexCount = geometry.getAttribute("position").count;
  const colors = new Float32Array(vertexCount * 3);
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) colors.set([color.r, color.g, color.b], vertexIndex * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** A box of `sizeX` x `sizeY` x `sizeZ` centred at (x, y, z). */
function boxAt(sizeX: number, sizeY: number, sizeZ: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(sizeX, sizeY, sizeZ).translate(x, y, z);
}

/** A timber box whose uvs count metres of `TIMBER_TILE_METRES` tiles along each face, so the grain keeps its size at any length. */
function timberBox(sizeX: number, sizeY: number, sizeZ: number, x: number, y: number, z: number, rotationZ = 0): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  const faceSizes = [
    [sizeZ, sizeY],
    [sizeZ, sizeY],
    [sizeX, sizeZ],
    [sizeX, sizeZ],
    [sizeX, sizeY],
    [sizeX, sizeY],
  ] as const;
  const uv = geometry.getAttribute("uv");
  for (let face = 0; face < BOX_FACE_COUNT; face++) {
    const [width, height] = faceSizes[face]!;
    for (let corner = 0; corner < BOX_VERTICES_PER_FACE; corner++) {
      const vertexIndex = face * BOX_VERTICES_PER_FACE + corner;
      uv.setXY(vertexIndex, (uv.getX(vertexIndex) * width) / TIMBER_TILE_METRES, (uv.getY(vertexIndex) * height) / TIMBER_TILE_METRES);
    }
  }
  return geometry.rotateZ(rotationZ).translate(x, y, z);
}

function mergedMesh(name: string, parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error(`could not merge the High jump's ${name}`);
  for (const part of parts) part.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `high-jump:${name}`;
  return mesh;
}

/** Where the net stands: its half width (m), its top's height above the pad, and how much thicker than the base sizes its timbers are. */
function netExtent(layout: HighJumpLayout) {
  const top = LANDING_HEIGHT + layout.netHeight;
  return { halfWidth: NET_HALF_WIDTH, top, scale: thicknessScale(layout.netHeight) };
}

/** The two posts and their caps, black and `POST_THICKNESS` square from the pad to the frame's top. */
function postGeometry(layout: HighJumpLayout, lipY: number): THREE.BufferGeometry[] {
  const shaftTop = lipY + layout.frameTop;
  const shaftHeight = shaftTop - LANDING_HEIGHT;
  const capSide = POST_THICKNESS * POST_CAP_OVERHANG;
  return [-1, 1].flatMap((side) => [
    boxAt(POST_THICKNESS, shaftHeight, POST_THICKNESS, layout.postsX, LANDING_HEIGHT + shaftHeight / 2, side * POST_HALF_SPAN),
    boxAt(capSide, POST_CAP_HEIGHT, capSide, layout.postsX, shaftTop + POST_CAP_HEIGHT / 2, side * POST_HALF_SPAN),
  ]);
}


/**
 * The net's frame: a tall pole at both ends and at every `NET_POLE_SPACING` m or less between them (the same z for every one), each
 * with a pole standing `NET_BACK_ROW_SETBACK` m behind it and a stay beam tying their tops: a driving range's net stands on a frame, it does not float.
 */
function netFrameGeometry(layout: HighJumpLayout): THREE.BufferGeometry[] {
  const net = netExtent(layout);
  const poleThickness = NET_POLE_THICKNESS * net.scale;
  const poleHeight = net.top + NET_POLE_EXTRA_HEIGHT * net.scale - LANDING_HEIGHT;
  const stayThickness = NET_CABLE_THICKNESS * net.scale;
  const intervalCount = Math.ceil((2 * net.halfWidth) / NET_POLE_SPACING);
  return Array.from({ length: intervalCount + 1 }, (_, poleIndex) => -net.halfWidth + (poleIndex * 2 * net.halfWidth) / intervalCount).flatMap((poleZ) => [
    timberBox(poleThickness, poleHeight, poleThickness, layout.netX, LANDING_HEIGHT + poleHeight / 2, poleZ),
    timberBox(poleThickness, poleHeight, poleThickness, layout.netX + NET_BACK_ROW_SETBACK, LANDING_HEIGHT + poleHeight / 2, poleZ),
    timberBox(NET_BACK_ROW_SETBACK, stayThickness, stayThickness, layout.netX + NET_BACK_ROW_SETBACK / 2, net.top, poleZ),
  ]);
}

/** The kicker's cosmetic support: timber ribs on both flanks at every floor-profile step, from the climb's foot to the lip, tied by a beam along each flank's edge. */
function kickerSupportGeometry(): THREE.BufferGeometry[] {
  const footX = climbFootX(HIGH_JUMP);
  const ribCount = Math.max(1, Math.round(-footX / KICKER_RIB.pitch));
  const ribXs = Array.from({ length: ribCount + 1 }, (_, ribIndex) => footX + (ribIndex * -footX) / ribCount);
  const flankZ = (side: number) => side * (STATION_HALF_WIDTH + KICKER_RIB.outset / 2);
  const ribs = [-1, 1].flatMap((side) =>
    ribXs.flatMap((ribX) => {
      const floorY = floorHeightAt(HIGH_JUMP, ribX, 0);
      const low = Math.min(floorY, LANDING_HEIGHT);
      const high = Math.max(floorY, LANDING_HEIGHT);
      return high - low < KICKER_RIB.minHeight ? [] : [timberBox(KICKER_RIB.depth, high - low, KICKER_RIB.outset, ribX, (low + high) / 2, flankZ(side))];
    }),
  );
  const beamCount = Math.ceil(-footX / KICKER_RIB.beamStep);
  const beamXs = Array.from({ length: beamCount + 1 }, (_, beamIndex) => footX + (beamIndex * -footX) / beamCount);
  const beams = [-1, 1].flatMap((side) =>
    beamXs.slice(1).map((beamX, index) => {
      const fromX = beamXs[index]!;
      const fromY = floorHeightAt(HIGH_JUMP, fromX, 0);
      const toY = floorHeightAt(HIGH_JUMP, beamX, 0);
      return timberBox(hypot2(beamX - fromX, toY - fromY) + KICKER_RIB.depth, KICKER_RIB.beam, KICKER_RIB.outset, (fromX + beamX) / 2, (fromY + toY) / 2, flankZ(side), Math.atan2(toY - fromY, beamX - fromX));
    }),
  );
  return [...ribs, ...beams];
}

/** A timber plate laid over the back face behind the lip, from the lip down to the landing, across the whole band: the kicker's front fascia. */
function lipFasciaGeometry(): THREE.BufferGeometry {
  const frontX = stationFrontX(HIGH_JUMP);
  const lipFloorY = floorHeightAt(HIGH_JUMP, 0, 0);
  const dropY = LANDING_HEIGHT - lipFloorY;
  const length = hypot2(frontX, dropY);
  const outwardX = -dropY / length;
  const outwardY = frontX / length;
  const offset = LIP_FASCIA.thickness / 2 + LIP_FASCIA.lift;
  return timberBox(length, LIP_FASCIA.thickness, 2 * STATION_HALF_WIDTH, frontX / 2 + outwardX * offset, (lipFloorY + LANDING_HEIGHT) / 2 + outwardY * offset, 0, Math.atan2(dropY, frontX));
}

function timberMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: canvasTexture(TIMBER_TEXTURE_PX, TIMBER_TEXTURE_PX, paintTimber), roughness: 0.9 });
}

/** One slat between the posts per layout board, in board order: the major ones bright, the rest timber. */
function slatGeometry(layout: HighJumpLayout): THREE.BufferGeometry[] {
  const span = 2 * POST_HALF_SPAN - POST_THICKNESS;
  return layout.boards.map((board) => painted(boxAt(SLAT_THICKNESS, SLAT_THICKNESS, span, layout.postsX, board.y, 0), board.major ? SLAT_COLOR.major : SLAT_COLOR.minor));
}

/** A numbered plate on each post at every height mark, the same number on both, facing the run-up: inner edge flush with the post's inner face, so the opening stays clear. */
function heightPlatesMesh(layout: HighJumpLayout): THREE.Mesh {
  const labels = layout.signs.map((sign) => String(sign.heightAboveLip));
  const x = layout.postsX - POST_THICKNESS / 2 - HEIGHT_PLATE.lift;
  const outboard = POST_HALF_SPAN - POST_THICKNESS / 2 + HEIGHT_PLATE.width / 2;
  const faces = layout.signs.flatMap((sign, index) =>
    [-1, 1].map((side) => signFace(HEIGHT_PLATE.width, HEIGHT_PLATE.height, x, sign.y + SLAT_THICKNESS / 2 + HEIGHT_PLATE.height / 2, side * outboard, index, labels.length)),
  );
  const mesh = mergedMesh("height-plates", faces, new THREE.MeshStandardMaterial({ map: signAtlas(labels), roughness: 0.8, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  return mesh;
}

/** The net's top and spaced steel cables, and a brass plate on each post at every slat without a height plate. */
function frameTrim(layout: HighJumpLayout): THREE.BufferGeometry[] {
  const net = netExtent(layout);
  const cable = NET_CABLE_THICKNESS * net.scale;
  const plateX = layout.postsX - POST_THICKNESS / 2 - PLATE.depth / 2;
  const cables = [
    boxAt(cable, cable, 2 * net.halfWidth, layout.netX, net.top, 0),
    ...Array.from({ length: Math.ceil(layout.netHeight / NET_CABLE_SPACING) - 1 }, (_, cableIndex) =>
      boxAt(cable, cable, 2 * net.halfWidth, layout.netX, LANDING_HEIGHT + (cableIndex + 1) * NET_CABLE_SPACING, 0),
    ),
  ].map((part) => painted(part, STEEL_COLOR));
  const marked = new Set(layout.signs.map((sign) => sign.heightAboveLip));
  const plates = layout.boards
    .filter((board) => !marked.has(board.heightAboveLip))
    .flatMap((board) => [-1, 1].map((side) => painted(boxAt(PLATE.depth, PLATE.height, POST_THICKNESS * PLATE.widthShare, plateX, board.y, side * POST_HALF_SPAN), BRASS_COLOR)));
  return [...cables, ...plates];
}


/** The dashed 'LIP = 0' line: from the lip toward the posts at the lip's height, one over each post's lane. */
function lipLine(layout: HighJumpLayout, lipY: number): THREE.BufferGeometry[] {
  const dashCount = Math.floor(layout.postsX / (DASH.length + DASH.gap));
  return [-1, 1].flatMap((side) =>
    Array.from({ length: dashCount }, (_, dashIndex) =>
      painted(boxAt(DASH.length, DASH.thickness, DASH.thickness, dashIndex * (DASH.length + DASH.gap) + DASH.length / 2, lipY, side * POST_HALF_SPAN), DASH_COLOR),
    ),
  );
}

/** Two rusty barrels with a yellow band, one each side of the lane at the kicker's mouth. */
function barrels(): THREE.BufferGeometry[] {
  const x = climbFootX(HIGH_JUMP) - BARREL.mouthSetback;
  const floorY = floorHeightAt(HIGH_JUMP, x, 0);
  const z = LANE_HALF_WIDTH + BARREL.radius * 2;
  return [-1, 1].flatMap((side) => [
    painted(new THREE.CylinderGeometry(BARREL.radius, BARREL.radius, BARREL.height, BARREL.sides).translate(x, floorY + BARREL.height / 2, side * z), BARREL_RUST_COLOR),
    painted(
      new THREE.CylinderGeometry(BARREL.radius + BARREL.bandRadiusExtra, BARREL.radius + BARREL.bandRadiusExtra, BARREL.bandHeight, BARREL.sides).translate(
        x,
        floorY + BARREL.height / 2,
        side * z,
      ),
      BARREL_BAND_COLOR,
    ),
  ]);
}

/** Yellow chevrons (two flat arms meeting at a tip that points down the run) before the kicker's foot. */
function chevrons(): THREE.BufferGeometry[] {
  const halfLengthAlong = (CHEVRON.armLength / 2) * Math.cos(CHEVRON.halfAngle);
  const halfLengthAcross = (CHEVRON.armLength / 2) * Math.sin(CHEVRON.halfAngle);
  return Array.from({ length: CHEVRON.count }, (_, chevronIndex) => {
    const tipX = climbFootX(HIGH_JUMP) - CHEVRON.firstSetback - chevronIndex * CHEVRON.pitch;
    const floorY = floorHeightAt(HIGH_JUMP, tipX, 0) + CHEVRON.lift;
    return [-1, 1].map((side) =>
      painted(
        new THREE.PlaneGeometry(CHEVRON.armLength, CHEVRON.armWidth)
          .rotateX(-Math.PI / 2)
          .rotateY(side * CHEVRON.halfAngle)
          .translate(tipX - halfLengthAlong, floorY, side * halfLengthAcross),
        CHEVRON_COLOR,
      ),
    );
  }).flat();
}

/** The art-only stop block: red and white stripes across the lane at the lip (no physics). */
function stopBlock(lipY: number): THREE.BufferGeometry[] {
  const stripeWidth = (2 * LANE_HALF_WIDTH) / STOP_BLOCK.stripes;
  return Array.from({ length: STOP_BLOCK.stripes }, (_, stripeIndex) =>
    painted(
      boxAt(STOP_BLOCK.depth, STOP_BLOCK.height, stripeWidth, 0, lipY + STOP_BLOCK.height / 2, -LANE_HALF_WIDTH + (stripeIndex + 0.5) * stripeWidth),
      stripeIndex % 2 === 0 ? STOP_RED_COLOR : STOP_WHITE_COLOR,
    ),
  );
}

/** A driving-range net: a tall alpha-tested weave plane at `layout.netX`, `layout.netHeight` m tall, drawn in one pass. */
function netMesh(layout: HighJumpLayout): THREE.Mesh {
  const { halfWidth, top, scale } = netExtent(layout);
  const width = 2 * halfWidth;
  const height = top - LANDING_HEIGHT;
  const weave = canvasTexture(NET_TEXTURE_PX, NET_TEXTURE_PX, (context) => {
    context.clearRect(0, 0, NET_TEXTURE_PX, NET_TEXTURE_PX);
    context.fillStyle = CANVAS_WHITE;
    context.fillRect(0, 0, NET_TEXTURE_PX, NET_LINE_PX);
    context.fillRect(0, 0, NET_LINE_PX, NET_TEXTURE_PX);
  });
  weave.generateMipmaps = false;
  weave.minFilter = THREE.LinearFilter;
  weave.repeat.set(width / (NET_MESH_SIZE * scale), height / (NET_MESH_SIZE * scale));
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height).rotateY(-Math.PI / 2).translate(layout.netX, LANDING_HEIGHT + height / 2, 0),
    new THREE.MeshStandardMaterial({
      map: weave,
      color: NET_COLOR,
      roughness: 1,
      transparent: true,
      alphaTest: NET_ALPHA_CUTOFF,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }),
  );
  mesh.name = "high-jump:net";
  return mesh;
}

/**
 * The High jump's static art in station-local coordinates (+x the throw, x = 0 the lip, z = 0 the lane's middle, y from the pad): two
 * black 0.25 m posts with a slat per `layout.boards` entry, a numbered plate on each post at every `layout.signs` mark (the range's
 * signs), a dashed lip-height line, the net at `layout.netX`, and the run-up's barrels, chevrons and stop block. Eight draws.
 */
export function makeHighJumpArt(layout: HighJumpLayout, lipY: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "high-jump";
  const woodMaterial = timberMaterial();
  const posts = mergedMesh("posts", postGeometry(layout, lipY), new THREE.MeshStandardMaterial({ color: POST_COLOR, roughness: POST_ROUGHNESS }));
  posts.castShadow = true;
  const netFrame = mergedMesh("net-frame", netFrameGeometry(layout), woodMaterial);
  netFrame.castShadow = true;
  const kicker = mergedMesh("kicker", kickerSupportGeometry(), woodMaterial);
  kicker.castShadow = true;
  const fascia = mergedMesh("fascia", [lipFasciaGeometry()], woodMaterial);
  fascia.castShadow = true;
  const trim = mergedMesh(
    "trim",
    [...frameTrim(layout), ...lipLine(layout, lipY), ...barrels(), ...chevrons(), ...stopBlock(lipY)],
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 }),
  );
  trim.castShadow = true;
  const boards = mergedMesh("boards", slatGeometry(layout), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  boards.castShadow = true;
  group.add(posts, netFrame, kicker, fascia, boards, heightPlatesMesh(layout), trim, netMesh(layout));
  return group;
}
