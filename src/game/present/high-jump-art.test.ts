import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { element, stubBrowser } from "../engine/engine-headless.test-util.ts";
import { LANDING_HEIGHT, STATION_HALF_WIDTH } from "../scenes/minigame-constants.ts";
import { FIELD_HALF_WIDTH, highJumpLayout, POST_HALF_SPAN, POST_THICKNESS, SIGN_EVERY_METRES, SIGN_HEIGHT, SLAT_THICKNESS } from "../scenes/minigame-high-jump.ts";
import { climbFootX, floorHeightAt, stationFrontX } from "../scenes/minigame-profile.ts";
import { makeHighJumpArt, NET_HALF_WIDTH } from "./high-jump-art.ts";

/** Most draw calls the High jump's whole art may cost: posts, boards, trim, net, with room for the composer's own. */
const HIGH_JUMP_DRAW_BUDGET = 12;
const LIP_Y = 7;
/**
 * Made-up measurements (m), the layout's own functions turn them into posts, boards, signs, net and boxes: a short frame,
 * the owner's best run (about 155 m) and a frame taller than any run (230 m).
 */
const CASES = [
  { name: "an 18 m best height", measured: { bestHeight: 18, landingDistance: 22 } },
  { name: "a 155 m best height", measured: { bestHeight: 155, landingDistance: 30 } },
  { name: "a 230 m best height", measured: { bestHeight: 230, landingDistance: 34 } },
] as const;
/** Geometry is built from f32 buffers: a position of up to a few hundred metres is good to about 30 micrometres. */
const POSITION_TOLERANCE = 1e-4;
const VERTICES_PER_BOX = new THREE.BoxGeometry().getAttribute("position").count;
/** `BoxGeometry`'s second face is -x: the one the approaching car sees. */
const FRONT_FACE_FIRST_VERTEX = VERTICES_PER_BOX / 6;

/**
 * What a viewer needs to see each part: a net line under 10 cm is under 2 px at 40 m (60 degrees over 720 px is 6.4 cm per px there);
 * a dash under 20 cm is lost against the strip.
 */
const MIN_NET_LINE_METRES = 0.1;
const MIN_DASH_THICKNESS = 0.2;
/** A black post's brightest colour channel (0 to 1). */
const MAX_BLACK_CHANNEL = 0.1;
/** The brief's numbers: net poles every 15 m at most, cables every 20 m, kicker ribs every 3 m; poles under 40 cm thick vanish at 40 m; boards over 60 cm deep swallow a camera. */
const NET_POLE_SPACING_METRES = 15;
const NET_CABLE_SPACING_METRES = 20;
const KICKER_RIB_PITCH_METRES = 3;
const MIN_NET_POLE_THICKNESS = 0.4;
const MAX_BOARD_DEPTH = 0.6;
/** Two poles' bottoms closer than this (m) belong to one pole. */
const SEPARATE_POLES_METRES = 2;
/** A beam laid on a chord of the floor's arc (every 0.5 m of run in the art) sags under it by at most the chord's sagitta: at the lip's 60 degrees on a 20 m radius, 0.5 m long, 1.6 cm; allow double. */
const MAX_BEAM_SAG = 0.03;
/** A fascia thicker than this (m) would show as a slab. */
const MAX_FASCIA_THICKNESS = 0.5;

type RecordedFill = { x: number; y: number; width: number; height: number };
const recordedCanvases: { width: number; height: number; fills: RecordedFill[]; texts: string[] }[] = [];

/** A document whose canvases remember every `fillRect` and `fillText` (other 2d calls are inert), so the weave's painted line width and the signs' labels can be read back. */
function recordCanvases(): void {
  Object.assign(document, {
    createElement: () => {
      const fills: RecordedFill[] = [];
      const texts: string[] = [];
      const context: object = new Proxy(
        {
          fillRect: (x: number, y: number, width: number, height: number) => fills.push({ x, y, width, height }),
          fillText: (text: string) => texts.push(text),
        } as Record<string | symbol, unknown>,
        { get: (target, key) => target[key] ?? (() => context), set: () => true },
      );
      const canvas = Object.assign(element(), { getContext: () => context, fills, texts });
      recordedCanvases.push(canvas);
      return canvas;
    },
  });
}

function meshNamed(group: THREE.Group, name: string): THREE.Mesh {
  const mesh = group.getObjectByName(`high-jump:${name}`);
  assert.ok(mesh instanceof THREE.Mesh, `the art has a "${name}" mesh`);
  return mesh;
}

function vertices(mesh: THREE.Mesh): THREE.Vector3[] {
  const position = mesh.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, vertexIndex) => new THREE.Vector3().fromBufferAttribute(position, vertexIndex));
}

const boundsOf = (points: THREE.Vector3[]): THREE.Box3 => new THREE.Box3().setFromPoints(points);

/** The poles whose bottoms are `bottoms`: bottoms group by z (poles are metres apart), each a centre z and a width in x. */
function poleSpans(bottoms: THREE.Vector3[]): { centre: number; width: number }[] {
  const sorted = [...bottoms].sort((left, right) => left.z - right.z);
  const groups = sorted.reduce<THREE.Vector3[][]>((poles, point) => {
    const pole = poles.at(-1);
    if (pole && point.z - pole.at(-1)!.z < SEPARATE_POLES_METRES) pole.push(point);
    else poles.push([point]);
    return poles;
  }, []);
  return groups.map((pole) => {
    const box = boundsOf(pole);
    return { centre: (box.min.z + box.max.z) / 2, width: box.max.x - box.min.x };
  });
}

function drawCalls(group: THREE.Group): number {
  let calls = 0;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) calls += Array.isArray(object.material) ? object.material.length : 1;
  });
  return calls;
}


describe("given the High jump's art built from a layout", () => {
  before(() => {
    stubBrowser();
    recordCanvases();
  });

  for (const { name, measured } of CASES) {
    const layout = highJumpLayout(measured, LIP_Y);

    it(`when it is built for ${name}, then each post stands at postsX and one side of the lane, from the pad up to the frame's top (lip + frameTop), ${POST_THICKNESS} m square whatever the height`, () => {
      const posts = vertices(meshNamed(makeHighJumpArt(layout, LIP_Y), "posts"));
      for (const side of [-1, 1]) {
        const shaft = boundsOf(
          posts.filter((point) => Math.abs(point.x - layout.postsX) <= POST_THICKNESS / 2 + POSITION_TOLERANCE && Math.sign(point.z) === side && Math.abs(point.z) < 2 * POST_HALF_SPAN),
        );
        assert.ok(Math.abs((shaft.min.x + shaft.max.x) / 2 - layout.postsX) < POSITION_TOLERANCE, `post x centre ${(shaft.min.x + shaft.max.x) / 2}`);
        assert.ok(Math.abs((shaft.min.z + shaft.max.z) / 2 - side * POST_HALF_SPAN) < POSITION_TOLERANCE, `post z centre ${(shaft.min.z + shaft.max.z) / 2}`);
        assert.ok(Math.abs(shaft.min.y - LANDING_HEIGHT) < POSITION_TOLERANCE, `post foot ${shaft.min.y}`);
        assert.ok(Math.abs(shaft.max.y - (LIP_Y + layout.frameTop)) < POSITION_TOLERANCE, `post top ${shaft.max.y}, frame top ${LIP_Y + layout.frameTop}`);
        assert.ok(Math.abs(shaft.max.x - shaft.min.x - POST_THICKNESS) < POSITION_TOLERANCE, `post thickness ${shaft.max.x - shaft.min.x}`);
        assert.ok(Math.abs(shaft.max.z - shaft.min.z - POST_THICKNESS) < POSITION_TOLERANCE, `post depth ${shaft.max.z - shaft.min.z}`);
      }
    });


    it(`when it is built for ${name}, then the posts are black`, () => {
      const material = meshNamed(makeHighJumpArt(layout, LIP_Y), "posts").material as THREE.MeshStandardMaterial;
      assert.ok(Math.max(material.color.r, material.color.g, material.color.b) <= MAX_BLACK_CHANNEL, `post colour ${material.color.getHexString()}`);
      assert.equal(material.map, null, "no wood grain on a black post");
    });

    it(`when it is built for ${name}, then each layout board has a slat centred between the posts at its y, and a sign stands on every layout sign's slat, between the posts and never reaching below it`, () => {
      const boards = meshNamed(makeHighJumpArt(layout, LIP_Y), "boards");
      const points = vertices(boards);
      assert.equal(points.length, (layout.boards.length + layout.signs.length) * VERTICES_PER_BOX, "one slat per board, then one sign per layout sign");
      const uv = boards.geometry.getAttribute("uv");
      const boxAt = (boxIndex: number) => boundsOf(points.slice(boxIndex * VERTICES_PER_BOX, (boxIndex + 1) * VERTICES_PER_BOX));
      const frontCell = (boxIndex: number) => `${uv.getX(boxIndex * VERTICES_PER_BOX + FRONT_FACE_FIRST_VERTEX).toFixed(4)},${uv.getY(boxIndex * VERTICES_PER_BOX + FRONT_FACE_FIRST_VERTEX).toFixed(4)}`;
      for (let boardIndex = 0; boardIndex < layout.boards.length; boardIndex++) {
        const board = layout.boards[boardIndex]!;
        const bar = boxAt(boardIndex);
        assert.ok(Math.abs((bar.min.y + bar.max.y) / 2 - board.y) < POSITION_TOLERANCE, `slat ${boardIndex} centre y ${(bar.min.y + bar.max.y) / 2}, expected ${board.y}`);
        assert.ok(Math.abs((bar.min.x + bar.max.x) / 2 - layout.postsX) < POSITION_TOLERANCE, `slat ${boardIndex} sits at the posts' x`);
        assert.ok(Math.abs(bar.min.z + bar.max.z) < POSITION_TOLERANCE, `slat ${boardIndex} is centred on the lane`);
        assert.ok(bar.max.z - bar.min.z <= 2 * POST_HALF_SPAN - POST_THICKNESS + POSITION_TOLERANCE, `slat ${boardIndex} fits between the posts`);
        assert.ok(bar.max.x - bar.min.x < POST_THICKNESS && bar.max.y - bar.min.y < POST_THICKNESS, `slat ${boardIndex} is ${bar.max.x - bar.min.x} deep and ${bar.max.y - bar.min.y} tall, thinner than a ${POST_THICKNESS} m post`);
        assert.ok(Math.abs(bar.max.x - bar.min.x - SLAT_THICKNESS) < POSITION_TOLERANCE && Math.abs(bar.max.y - bar.min.y - SLAT_THICKNESS) < POSITION_TOLERANCE, `slat ${boardIndex} is ${SLAT_THICKNESS} m square`);
      }
      const signCells = new Set<string>();
      for (const [signIndex, layoutSign] of layout.signs.entries()) {
        const sign = boxAt(layout.boards.length + signIndex);
        const slatTop = LIP_Y + layoutSign.heightAboveLip + SLAT_THICKNESS / 2;
        assert.ok(sign.min.y >= slatTop - POSITION_TOLERANCE, `the ${layoutSign.heightAboveLip} m sign reaches down to ${sign.min.y}, below its slat's top ${slatTop}`);
        assert.ok(Math.abs((sign.min.y + sign.max.y) / 2 - layoutSign.y) < POSITION_TOLERANCE && Math.abs(sign.max.y - sign.min.y - SIGN_HEIGHT) < POSITION_TOLERANCE, `the ${layoutSign.heightAboveLip} m sign is ${sign.max.y - sign.min.y} tall at ${(sign.min.y + sign.max.y) / 2}`);
        assert.ok(Math.abs((sign.min.x + sign.max.x) / 2 - layout.postsX) < POSITION_TOLERANCE && Math.abs(sign.min.z + sign.max.z) < POSITION_TOLERANCE, `sign ${signIndex} is between the posts`);
        assert.ok(sign.max.x - sign.min.x <= MAX_BOARD_DEPTH, `sign ${signIndex} is ${sign.max.x - sign.min.x} m deep: a camera inside a deep sign loses the view`);
        signCells.add(frontCell(layout.boards.length + signIndex));
      }
      assert.equal(signCells.size, layout.signs.length, "every sign's front face reads a different atlas cell");
      const barCells = new Set(layout.boards.map((board, boardIndex) => `${board.major}:${frontCell(boardIndex)}`));
      assert.equal(barCells.size, layout.boards.some((board) => board.major) && layout.boards.some((board) => !board.major) ? 2 : 1, "major slats share one cell, minor slats another");
      assert.ok(![...signCells].some((cell) => barCells.has(`true:${cell}`) || barCells.has(`false:${cell}`)), "a sign's label is not a slat's cell");
    });

    it(`when it is built for ${name}, then a sign carries its height: "LIP = 0" at the lip then "10 m", "20 m" ... every ${SIGN_EVERY_METRES} m up the frame`, () => {
      makeHighJumpArt(layout, LIP_Y);
      const labelled = recordedCanvases.filter((canvas) => canvas.texts.length > 0).at(-1)!;
      assert.equal(
        JSON.stringify(labelled.texts),
        JSON.stringify(layout.signs.map((sign) => (sign.heightAboveLip === 0 ? "LIP = 0" : `${sign.heightAboveLip} m`))),
        "the atlas's labels, one per sign in sign order",
      );
      assert.ok(layout.signs.every((sign) => sign.heightAboveLip % SIGN_EVERY_METRES === 0), "signs only at multiples of SIGN_EVERY_METRES");
    });

    it(`when it is built for ${name}, then a slat's brass plates are bigger at the major boards than the minor ones`, () => {
      const trim = vertices(meshNamed(makeHighJumpArt(layout, LIP_Y), "trim"));
      /** The room (m) in front of a post's front face that holds a plate's depth but not the lip line's last dash. */
      const PLATE_WINDOW = 0.5;
      /** A plate is a box on the +z post: a box's vertices, which sorted by height make one board's plate each (plates of neighbouring boards do not overlap in height). */
      const plateHeights = trim
        .filter((point) => point.x > layout.postsX - POST_THICKNESS / 2 - PLATE_WINDOW && point.x < layout.postsX - POST_THICKNESS / 2 + POSITION_TOLERANCE && point.z > 0)
        .map((point) => point.y)
        .sort((lower, higher) => lower - higher)
        .reduce<number[][]>((plates, y, vertexIndex) => {
          if (vertexIndex % VERTICES_PER_BOX === 0) plates.push([]);
          plates.at(-1)!.push(y);
          return plates;
        }, [])
        .map((plate) => plate.at(-1)! - plate[0]!);
      assert.equal(plateHeights.length, layout.boards.length, "one plate per board on the post");
      const majorPlates = layout.boards.flatMap((board, boardIndex) => (board.major ? [plateHeights[boardIndex]!] : []));
      const minorPlates = layout.boards.flatMap((board, boardIndex) => (board.major ? [] : [plateHeights[boardIndex]!]));
      assert.ok(Math.min(...majorPlates) > 2 * Math.max(...minorPlates), `major plates ${majorPlates}, minor plates ${minorPlates}`);
    });

    it(`when it is built for ${name}, then the net is netHeight tall at netX, a light alpha-tested single-pass weave with lines wide enough to read, between two end poles that reach its top`, () => {
      const art = makeHighJumpArt(layout, LIP_Y);
      const net = meshNamed(art, "net");
      const box = boundsOf(vertices(net));
      assert.ok(Math.abs(box.min.x - layout.netX) < POSITION_TOLERANCE && Math.abs(box.max.x - layout.netX) < POSITION_TOLERANCE, `net x ${box.min.x}..${box.max.x}, expected ${layout.netX}`);
      assert.ok(box.max.z >= FIELD_HALF_WIDTH && box.min.z <= -FIELD_HALF_WIDTH, "the net spans the landing field");
      assert.ok(Math.abs(box.max.z - NET_HALF_WIDTH) < POSITION_TOLERANCE && Math.abs(box.min.z + NET_HALF_WIDTH) < POSITION_TOLERANCE, `net z ${box.min.z}..${box.max.z}, NET_HALF_WIDTH ${NET_HALF_WIDTH}`);
      assert.ok(Math.abs(box.min.y - LANDING_HEIGHT) < POSITION_TOLERANCE, "the net hangs from the pad up");
      assert.ok(Math.abs(box.max.y - (LANDING_HEIGHT + layout.netHeight)) < POSITION_TOLERANCE, `net top ${box.max.y}, netHeight ${layout.netHeight}`);
      const material = net.material as THREE.MeshStandardMaterial;
      assert.ok(material.transparent && material.alphaTest > 0 && material.side === THREE.DoubleSide && material.forceSinglePass, "alpha weave, one pass");
      const weave = material.map!;
      assert.ok(weave, "the weave texture");
      assert.equal(weave.generateMipmaps, false, "no mipmaps: a mipped thin line falls under the alpha cut and the far net vanishes");
      assert.equal(weave.minFilter, THREE.LinearFilter);
      assert.ok(material.color.r >= 0.9 && material.color.g >= 0.9 && material.color.b >= 0.9, "a light net, readable against the dark");
      const weaveCanvas = recordedCanvases.filter((canvas) => canvas.width === canvas.height && canvas.fills.length === 2).at(-1)!;
      const linePixels = Math.min(...weaveCanvas.fills.map((fill) => Math.min(fill.width, fill.height)));
      const meshMetres = box.getSize(new THREE.Vector3()).y / weave.repeat.y;
      assert.ok((meshMetres * linePixels) / weaveCanvas.width >= MIN_NET_LINE_METRES - POSITION_TOLERANCE, `net line ${(meshMetres * linePixels) / weaveCanvas.width} m`);
      const poles = boundsOf(vertices(meshNamed(art, "net-frame")).filter((point) => Math.abs(point.x - layout.netX) < 1));
      assert.ok(Math.abs((poles.min.x + poles.max.x) / 2 - layout.netX) < POSITION_TOLERANCE, `net poles at x ${(poles.min.x + poles.max.x) / 2}`);
      assert.ok(poles.max.z > box.max.z - POSITION_TOLERANCE && poles.min.z < box.min.z + POSITION_TOLERANCE, "the poles stand at the net's ends");
      assert.ok(poles.max.y >= box.max.y, `the poles reach ${poles.max.y}, the net's top ${box.max.y}`);
    });

    it(`when it is built for ${name}, then the net stands on a frame: stout poles at both ends and between at most ${NET_POLE_SPACING_METRES} m apart, each with a back pole and a stay at the top, and steel cables across it every ${NET_CABLE_SPACING_METRES} m of height`, () => {
      const art = makeHighJumpArt(layout, LIP_Y);
      const frame = vertices(meshNamed(art, "net-frame"));
      const bottoms = frame.filter((point) => Math.abs(point.y - LANDING_HEIGHT) < POSITION_TOLERANCE);
      const frontRow = poleSpans(bottoms.filter((point) => point.x < layout.netX + 1));
      const backRow = poleSpans(bottoms.filter((point) => point.x >= layout.netX + 1));
      assert.ok(frontRow.length >= 3, `${frontRow.length} poles along a net ${2 * NET_HALF_WIDTH} m wide`);
      assert.ok(Math.abs(frontRow[0]!.centre + NET_HALF_WIDTH) < POSITION_TOLERANCE && Math.abs(frontRow.at(-1)!.centre - NET_HALF_WIDTH) < POSITION_TOLERANCE, "a pole at each end of the net");
      for (let poleIndex = 1; poleIndex < frontRow.length; poleIndex++) {
        assert.ok(frontRow[poleIndex]!.centre - frontRow[poleIndex - 1]!.centre <= NET_POLE_SPACING_METRES + POSITION_TOLERANCE, `poles ${poleIndex - 1} and ${poleIndex} are too far apart`);
      }
      assert.equal(backRow.length, frontRow.length, "a back pole behind every pole");
      for (let poleIndex = 0; poleIndex < frontRow.length; poleIndex++) {
        assert.equal(backRow[poleIndex]!.centre.toFixed(3), frontRow[poleIndex]!.centre.toFixed(3), `back pole ${poleIndex} stands behind its front pole`);
      }
      assert.ok(Math.min(...frontRow.map((pole) => pole.width)) >= MIN_NET_POLE_THICKNESS, `net poles ${frontRow.map((pole) => pole.width)} m thick`);
      const frontTops = frame.filter((point) => Math.abs(point.x - layout.netX) < 1 && point.y > LANDING_HEIGHT + 1);
      assert.ok(boundsOf(frontTops).max.y >= LANDING_HEIGHT + layout.netHeight, "the poles reach the net's top");
      assert.ok(frame.some((point) => point.x >= layout.netX + 3 && Math.abs(point.y - (LANDING_HEIGHT + layout.netHeight)) < 0.5), "a stay joins the tops of front and back poles");
      const trim = vertices(meshNamed(art, "trim"));
      const netCableHeights = Array.from({ length: Math.ceil(layout.netHeight / NET_CABLE_SPACING_METRES) - 1 }, (_, cableIndex) => LANDING_HEIGHT + (cableIndex + 1) * NET_CABLE_SPACING_METRES);
      for (const cableY of netCableHeights) {
        const cable = trim.filter((point) => Math.abs(point.x - layout.netX) < 1 && Math.abs(point.y - cableY) < 1);
        assert.ok(cable.length > 0 && boundsOf(cable).max.z >= NET_HALF_WIDTH - POSITION_TOLERANCE && boundsOf(cable).min.z <= -NET_HALF_WIDTH + POSITION_TOLERANCE, `a cable across the net at ${cableY} m`);
      }
    });

    it(`when it is built for ${name}, then timber ribs stand outside both flank walls about every ${KICKER_RIB_PITCH_METRES} m from the climb's foot to the lip, each from the floor's height to the pad's level, tied by beams along the floor's edge`, () => {
      const kicker = vertices(meshNamed(makeHighJumpArt(layout, LIP_Y), "kicker"));
      const boxes = Array.from({ length: kicker.length / VERTICES_PER_BOX }, (_, boxIndex) => kicker.slice(boxIndex * VERTICES_PER_BOX, (boxIndex + 1) * VERTICES_PER_BOX));
      const isUpright = (box: THREE.Vector3[]) => new Set(box.map((point) => point.x.toFixed(4))).size === 2;
      const foot = climbFootX("highJump");
      for (const side of [-1, 1]) {
        const flank = boxes.filter((box) => Math.sign(boundsOf(box).min.z + boundsOf(box).max.z) === side);
        const ribs = flank.filter(isUpright).map(boundsOf).sort((left, right) => left.min.x - right.min.x);
        const beams = flank.filter((box) => !isUpright(box)).map(boundsOf);
        assert.ok(ribs.length >= 4, `${ribs.length} ribs on side ${side}`);
        const ribCentres = ribs.map((rib) => (rib.min.x + rib.max.x) / 2);
        assert.ok(Math.abs(ribCentres[0]! - foot) < POSITION_TOLERANCE && Math.abs(ribCentres.at(-1)!) < POSITION_TOLERANCE, `ribs run from ${ribCentres[0]} to ${ribCentres.at(-1)}, the climb is ${foot}..0`);
        for (let ribIndex = 1; ribIndex < ribs.length; ribIndex++) {
          assert.ok(ribCentres[ribIndex]! - ribCentres[ribIndex - 1]! <= 2 * KICKER_RIB_PITCH_METRES + 1, `ribs ${ribIndex - 1} and ${ribIndex} are ${ribCentres[ribIndex]! - ribCentres[ribIndex - 1]!} m apart`);
        }
        for (const rib of ribs) {
          const floorY = floorHeightAt("highJump", (rib.min.x + rib.max.x) / 2, 0);
          assert.ok(Math.abs(rib.min.y - Math.min(floorY, LANDING_HEIGHT)) < POSITION_TOLERANCE && Math.abs(rib.max.y - Math.max(floorY, LANDING_HEIGHT)) < POSITION_TOLERANCE, `rib at ${rib.min.x} spans ${rib.min.y}..${rib.max.y}, floor ${floorY}`);
          assert.ok(rib.min.z * side >= STATION_HALF_WIDTH - POSITION_TOLERANCE || rib.max.z * side >= STATION_HALF_WIDTH - POSITION_TOLERANCE, "outside the flank wall");
          assert.ok(Math.min(Math.abs(rib.min.z), Math.abs(rib.max.z)) >= STATION_HALF_WIDTH - POSITION_TOLERANCE, `rib z ${rib.min.z}..${rib.max.z} reaches inside the wall at ${STATION_HALF_WIDTH}`);
        }
        assert.ok(beams.length >= 4, `${beams.length} beams on side ${side}`);
        for (const beam of beams) {
          const centreX = (beam.min.x + beam.max.x) / 2;
          assert.ok(Math.abs((beam.min.y + beam.max.y) / 2 - floorHeightAt("highJump", centreX, 0)) < MAX_BEAM_SAG, `a beam at x ${centreX} lies ${(beam.min.y + beam.max.y) / 2 - floorHeightAt("highJump", centreX, 0)} m off the floor's edge`);
        }
      }
    });

    it(`when it is built for ${name}, then a fascia plate covers the back face from the lip down to the landing across the whole band, standing off the surface`, () => {
      const fascia = vertices(meshNamed(makeHighJumpArt(layout, LIP_Y), "fascia"));
      const box = boundsOf(fascia);
      const frontX = stationFrontX("highJump");
      assert.ok(Math.abs(box.max.z - STATION_HALF_WIDTH) < POSITION_TOLERANCE && Math.abs(box.min.z + STATION_HALF_WIDTH) < POSITION_TOLERANCE, `fascia z ${box.min.z}..${box.max.z}`);
      assert.ok(box.min.x > -MAX_FASCIA_THICKNESS && box.min.x < MAX_FASCIA_THICKNESS, `fascia starts at x ${box.min.x}, the lip is 0`);
      assert.ok(Math.abs(box.max.x - frontX) < MAX_FASCIA_THICKNESS, `fascia ends at x ${box.max.x}, the face ends at ${frontX}`);
      assert.ok(box.max.y >= floorHeightAt("highJump", 0, 0) - POSITION_TOLERANCE, "up to the lip");
      assert.ok(box.min.y <= LANDING_HEIGHT + MAX_FASCIA_THICKNESS, "down to the landing");
      for (const point of fascia) {
        const surfaceY = floorHeightAt("highJump", Math.min(Math.max(point.x, 0), frontX), 0);
        assert.ok(point.y >= surfaceY - POSITION_TOLERANCE, `a fascia vertex at (${point.x}, ${point.y}) is under the surface (${surfaceY})`);
      }
    });

    it(`when it is built for ${name}, then it costs no more draws than the budget`, () => {
      const calls = drawCalls(makeHighJumpArt(layout, LIP_Y));
      assert.ok(calls <= HIGH_JUMP_DRAW_BUDGET, `${calls} draws, budget ${HIGH_JUMP_DRAW_BUDGET}`);
    });

    it(`when it is built for ${name}, then there is no pane between the posts: no back-board mesh and nothing translucent but the net`, () => {
      const art = makeHighJumpArt(layout, LIP_Y);
      assert.equal(art.getObjectByName("high-jump:backboard"), undefined, "the forcefield-looking back-board is gone");
      const translucent: string[] = [];
      art.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material.transparent) translucent.push(object.name);
      });
      assert.deepEqual(translucent, ["high-jump:net"]);
    });


    it(`when it is built for ${name}, then a thick dashed line at the lip's height runs from the lip toward the posts, a stop block stands at the lip, and barrels flank the kicker's foot`, () => {
      const trim = vertices(meshNamed(makeHighJumpArt(layout, LIP_Y), "trim"));
      const lipLine = trim.filter((point) => Math.abs(point.y - LIP_Y) <= MIN_DASH_THICKNESS && Math.abs(Math.abs(point.z) - POST_HALF_SPAN) <= MIN_DASH_THICKNESS && point.x >= 0 && point.x < layout.postsX - POST_THICKNESS);
      const firstDash = boundsOf(lipLine.filter((point) => point.x < POSITION_TOLERANCE + 1));
      assert.ok(firstDash.max.y - firstDash.min.y >= MIN_DASH_THICKNESS && firstDash.max.z - firstDash.min.z >= MIN_DASH_THICKNESS, `dash cross-section ${firstDash.getSize(new THREE.Vector3()).toArray()}`);
      assert.ok(Math.abs(firstDash.min.x) < POSITION_TOLERANCE, "the line starts at the lip");
      const reach = boundsOf(lipLine);
      assert.ok(reach.max.x <= layout.postsX && reach.max.x > layout.postsX / 2, `dashes run to x ${reach.max.x}`);
      assert.ok(trim.some((point) => Math.abs(point.x) <= 0.2 && point.y > LIP_Y + 0.3), "a stop block rises at the lip");
      const foot = climbFootX("highJump");
      const floorY = floorHeightAt("highJump", foot, 0);
      for (const side of [-1, 1]) {
        assert.ok(
          trim.some((point) => Math.abs(point.x - foot) <= 2 && Math.sign(point.z) === side && point.y > floorY + 0.8 && point.y < floorY + 1.5),
          `a barrel on side ${side}`,
        );
      }
    });
  }
});
