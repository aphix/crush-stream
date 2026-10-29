import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { BODY_VERTICES, bodyIndex } from "./dummy-bodies.ts";
import { restFits } from "./dummy-fit.ts";
import { armOf, casualWear, fitted, hangAttribute, hangOffsets, legOf, torsoOf, type Take } from "./dummy-garments.ts";
import { loft, type Lofted } from "./dummy-loft.ts";
import { BONES_ATTRIBUTE, BUILD, ROLE, type Fit, type Ring, type Shell } from "./dummy-rig.ts";
import { dummyGeometry } from "./dummy-skin.ts";
import { PRINT_CELL } from "./dummy-texture.ts";

const man = restFits().man;
const INDEX = bodyIndex();
const bones = dummyGeometry().getAttribute(BONES_ATTRIBUTE);
const hang = hangOffsets(man);
/** The casual man's body as his clothes hang over it (the shader's `hang` at full scale). */
const hung: Fit = { ...man, rest: man.rest.map((v, i) => v + hang[i]!) };
/** A hung leg or tee may widen this much (m) below its narrowest height above it: where it comes to rest on the hips (the bare waist-to-hip regrowth is 14 mm). */
const REGROWTH = 0.005;
/** The laces print's middle sits this close (m) to the instep's front-most corners: down the front, not a side's width off it. */
const LACES_OFF_MIDDLE = 0.005;
/** The toe cap print's middle sits this close (m) to the middle of the toe's front half (the toe turns out 19 mm). */
const TOE_OFF_MIDDLE = 0.01;

/** The (x, z) corners of `shell`'s ring `ring`, at loft's side angles (k + 1/2) 2π / sides. */
function corners(shell: Shell, ring: Ring): [number, number][] {
  const [, halfWidth, halfDepth, middleZ, , , radii, across = 0] = ring;
  return Array.from({ length: shell.sides }, (_, k) => {
    const angle = ((k + 0.5) * 2 * Math.PI) / shell.sides;
    const scale = radii?.[k] ?? 1;
    return [shell.x + across + scale * halfWidth * Math.cos(angle), middleZ + scale * halfDepth * Math.sin(angle)];
  });
}

/** Whether (x, z) lies inside the polygon `polygon` (even-odd crossings of a ray along +x). */
function inside(polygon: readonly [number, number][], x: number, z: number): boolean {
  let crossings = 0;
  for (let k = 0; k < polygon.length; k++) {
    const [[x0, z0], [x1, z1]] = [polygon[k]!, polygon[(k + 1) % polygon.length]!];
    if (z0 > z === z1 > z) continue;
    if (x < x0 + ((z - z0) * (x1 - x0)) / (z1 - z0)) crossings++;
  }
  return crossings % 2 === 1;
}

/** Where the body triangles of `fit` whose corners are all `taken` cross height `y`: both ends and the middle of each crossing. */
function crossings(fit: Fit, taken: Take, y: number): [number, number][] {
  const points: [number, number][] = [];
  for (let t = 0; t < INDEX.length; t += 3) {
    const triangle = [INDEX[t]!, INDEX[t + 1]!, INDEX[t + 2]!];
    if (!triangle.every(taken)) continue;
    const ends: [number, number][] = [];
    for (let e = 0; e < 3; e++) {
      const [a, b] = [triangle[e]!, triangle[(e + 1) % 3]!];
      const [ya, yb] = [fit.rest[a * 3 + 1]!, fit.rest[b * 3 + 1]!];
      if (ya < y === yb < y) continue;
      const f = (y - ya) / (yb - ya);
      ends.push([fit.rest[a * 3]! + f * (fit.rest[b * 3]! - fit.rest[a * 3]!), fit.rest[a * 3 + 2]! + f * (fit.rest[b * 3 + 2]! - fit.rest[a * 3 + 2]!)]);
    }
    if (ends.length < 2) continue;
    points.push(ends[0]!, ends[1]!, [(ends[0]![0] + ends[1]![0]) / 2, (ends[0]![1] + ends[1]![1]) / 2]);
  }
  return points;
}

/** Whether body vertex `i` rides only `shell`'s bones: its bone, and a shoe's shin too. */
const ridesOn = (i: number, shell: Shell): boolean => [bones.getX(i), bones.getY(i)].every((b) => b === shell.bone || b === shell.shin);

/** How far (0..1) a body vertex's foot share may stand from its shoe's at its height: the shoe's rings are a few centimetres apart across the 8 cm ankle band. */
const SHARE_SLACK = 0.15;

/** Each ring of `shell` as lofted: its height and its vertices' bones (first, second, the second's share). */
function ringBones(shell: Shell): { y: number; first: number; second: number; share: number }[] {
  const mesh: Lofted = { position: [], bones: [], roleKind: [], print: [], index: [], coarse: [] };
  loft(shell, mesh);
  return shell.rings.map((ring, r) => {
    const v = r * shell.sides * 3;
    return { y: ring[0], first: mesh.bones[v]!, second: mesh.bones[v + 1]!, share: mesh.bones[v + 2]! };
  });
}

/** The foot share of bone pair (first, second, share) toward `bone`: 1 riding it alone, 0 riding the other alone. */
const shareOf = (first: number, second: number, share: number, bone: number): number => (first === bone && second === bone ? 1 : second === bone ? share : first === bone ? 1 - share : 0);

/** Whether body vertex `i`, at height `y`, rides what `shell` rides there: its bones, and the share the shell's two rings around `y` give between them. */
function ridesWith(i: number, y: number, shell: Shell, rings: ReturnType<typeof ringBones>): boolean {
  const [first, second] = [bones.getX(i), bones.getY(i)];
  const allowed = new Set(rings.flatMap((ring) => [ring.first, ring.second]));
  if (!allowed.has(first) || !allowed.has(second)) return false;
  const below = rings.findIndex((ring) => ring.y <= y);
  const [a, b] = [rings[Math.max(0, below - 1)]!, rings[Math.max(0, below)]!];
  const t = a.y === b.y ? 0 : (a.y - y) / (a.y - b.y);
  const expected = shareOf(a.first, a.second, a.share, shell.bone) * (1 - t) + shareOf(b.first, b.second, b.share, shell.bone) * t;
  return Math.abs(shareOf(first, second, bones.getZ(i), shell.bone) - expected) <= SHARE_SLACK;
}

const TAKES = { torso: () => torsoOf(man), rightArm: () => armOf(man, 1), leftLeg: () => legOf(man, -1), rightLeg: () => legOf(man, 1) } as const;

describe("given a garment ring fitted flush to the man's body", () => {
  const testCases = [
    { it: "when it is fitted round the foot at the toe's height, then every point of the foot's section lies inside it", body: "rightLeg", y: 0.03 },
    { it: "when it is fitted round the ankle, then every point of the ankle's section lies inside it", body: "leftLeg", y: 0.15 },
    { it: "when it is fitted round the hand below the wrist, then every point of the hand's section (thumb and all) lies inside it", body: "rightArm", y: 0.75 },
    { it: "when it is fitted round the waist, then every point of the waist's section lies inside it", body: "torso", y: 0.955 },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const taken = TAKES[testCase.body]();
      const shell = fitted(man, taken, [{ y: testCase.y, out: 0, role: 0 }], { bone: 0, kinds: BUILD.MAN, sides: 16 });
      const polygon = corners(shell, shell.rings[0]!);
      const points = crossings(man, taken, testCase.y);
      const outside = points.filter(([x, z]) => !inside(polygon, x, z));
      assert.ok(points.length > 30, `${points.length} section points`);
      assert.equal(outside.length, 0, `${outside.length} section points poke out, the first at ${outside[0]?.map((v) => v.toFixed(4)).join(", ")}`);
    });
  }
});

describe("given the casual man's clothes (belt, tee hem, sleeve hems, cuffs, jeans hems, sneakers) on his body as they hang over it", () => {
  const shells = casualWear(BUILD.MAN, man);

  it("when every ring between a garment's lips (its first and last rings tuck under the skin) is checked at its height, then the body under it (its triangles on the ring's bone) lies inside it", () => {
    let [checked, poked] = [0, ""];
    for (const shell of shells) {
      for (const ring of shell.rings.slice(1, -1)) {
        const polygon = corners(shell, ring);
        const under = crossings(hung, (i) => ridesOn(i, shell), ring[0]);
        const near = under.filter(([x]) => shell.x === 0 || Math.sign(x) === Math.sign(shell.x));
        for (const [x, z] of near) {
          checked++;
          if (!inside(polygon, x, z) && poked === "") poked = `(${x.toFixed(3)}, ${ring[0]}, ${z.toFixed(3)}) outside a ring on bone ${shell.bone}`;
        }
      }
    }
    assert.ok(checked > 500, `${checked} body points checked`);
    assert.equal(poked, "", `the body pokes through: ${poked}`);
  });

  it("when the body inside each garment is read, then it rides what that garment rides at its height (its bone alone, or a shoe's own shin-to-foot share over the ankle), so no pose can pull it through", () => {
    let [checked, loose] = [0, ""];
    for (const shell of shells) {
      const rings = ringBones(shell);
      const ys = shell.rings.map((ring) => ring[0]);
      const [low, high] = [Math.min(...ys), Math.max(...ys)];
      for (let i = 0; i < BODY_VERTICES; i++) {
        const [x, y, z] = [hung.rest[i * 3]!, hung.rest[i * 3 + 1]!, hung.rest[i * 3 + 2]!];
        if (y < low || y > high) continue;
        const nearest = shell.rings.reduce((best, ring) => (Math.abs(ring[0] - y) < Math.abs(best[0] - y) ? ring : best));
        if (!inside(corners(shell, nearest), x, z)) continue;
        checked++;
        if (!ridesWith(i, y, shell, rings) && loose === "") loose = `vertex ${i} at (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) rides ${bones.getX(i)}/${bones.getY(i)} at ${bones.getZ(i).toFixed(2)}, its garment bone ${shell.bone}${shell.shin === undefined ? "" : ` from shin ${shell.shin}`}`;
      }
    }
    assert.ok(checked > 200, `${checked} body vertices inside garments`);
    assert.equal(loose, "", `a garment over a joint: ${loose}`);
  });
});

describe("given the casual man's tee and jeans hanging off his body", () => {
  const testCases = [
    { it: "when his right jeans leg is read from the thigh down to the hem, then it never widens again below the knee (no calf under the denim)", body: "rightLeg", centre: [0.09, 0], from: 0.7, to: 0.26 },
    { it: "when his tee is read from under the arms down to its hem, then it does not narrow into his waist and widen again over his hips", body: "torso", centre: [0, -0.02], from: 1.18, to: 1.0 },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const taken = TAKES[testCase.body]();
      const [cx, cz] = testCase.centre;
      const reach = (fit: Fit, y: number) => crossings(fit, taken, y).reduce((widest, [x, z]) => Math.max(widest, Math.hypot(x - cx, z - cz)), 0);
      let [narrowest, regrowth, worst] = [Infinity, 0, ""];
      for (let y = testCase.from; y >= testCase.to; y -= 0.01) {
        const width = reach(hung, y);
        narrowest = Math.min(narrowest, width);
        if (width - narrowest > regrowth) [regrowth, worst] = [width - narrowest, `${(width - narrowest).toFixed(4)} m wider at y ${y.toFixed(2)} than above it`];
      }
      assert.ok(narrowest > 0.03 && narrowest < Infinity, `the section was read: narrowest reach ${narrowest.toFixed(3)} m`);
      assert.ok(regrowth <= REGROWTH, `it widens again: ${worst}`);
    });
  }
});

/** A straight jeans leg keeps at least this share of its thigh's width down to just above its hem (the reference's straight-leg jeans). */
const STRAIGHT_SHARE = 0.8;
/** A long sleeve narrows to this share of its upper arm's width just above the cuff: the reference's long sleeve and uniform sleeve narrow to 0.63 in the picture. */
const SLEEVE_TAPER = [0.6, 0.8] as const;

describe("given the casual man's jeans falling straight and his long sleeves narrowing to the cuff", () => {
  const testCases = [
    { it: "when his right jeans leg is read at the thigh and just above the hem, then it is nearly as wide at the shin as at the thigh", body: "rightLeg", top: 0.68, bottom: 0.2, share: [STRAIGHT_SHARE, Infinity] },
    { it: "when his right sleeve is read at the upper arm and just above the cuff, then it narrows toward the cuff as the reference's do, neither straight nor clinging", body: "rightArm", top: 1.15, bottom: 0.9, share: SLEEVE_TAPER },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const taken = TAKES[testCase.body]();
      const width = (y: number) => {
        const xs = crossings(hung, taken, y).map(([x]) => x);
        return Math.max(...xs) - Math.min(...xs);
      };
      const [top, bottom] = [width(testCase.top), width(testCase.bottom)];
      assert.ok(top > 0.05, `the top was read: ${top.toFixed(3)} m`);
      const [least, most] = testCase.share;
      assert.ok(bottom >= least * top && bottom <= most * top, `${bottom.toFixed(3)} m across above the hem against ${top.toFixed(3)} m at the top`);
    });
  }
});

describe("given the shader's hang, one attribute for the man's and the portly man's push", () => {
  it("when each body vertex is read, then its xy is the man's own push and its zw the portly man's own, and the two builds differ", () => {
    const { portly } = restFits();
    const packed = hangAttribute(man, portly, BODY_VERTICES + 1);
    const portlyHang = hangOffsets(portly);
    let [differs, wrong] = [0, ""];
    for (let i = 0; i < BODY_VERTICES; i++) {
      const own = [hang[i * 3]!, hang[i * 3 + 2]!, portlyHang[i * 3]!, portlyHang[i * 3 + 2]!];
      if (own.some((v, k) => Math.abs(packed[i * 4 + k]! - v) > 1e-7) && wrong === "") wrong = `vertex ${i} packs ${Array.from(packed.subarray(i * 4, i * 4 + 4)).join(", ")}`;
      if (Math.abs(own[0]! - own[2]!) + Math.abs(own[1]! - own[3]!) > 0.002) differs++;
    }
    assert.equal(wrong, "", `a body vertex packs another push: ${wrong}`);
    assert.ok(differs > 100, `only ${differs} body vertices push differently on the two builds`);
    assert.ok(packed.subarray(BODY_VERTICES * 4).every((v) => v === 0), "the wear does not hang");
  });
});

describe("given the casual man's sneakers", () => {
  const shells = casualWear(BUILD.MAN, man);
  const sneakers = shells.filter((shell) => shell.print?.cell === PRINT_CELL.LACES);
  const caps = shells.filter((shell) => shell.print?.cell === PRINT_CELL.TOE_CAP);

  it("when each sneaker is read, then its upper is all canvas, its laces a print down the middle of the instep and its toe cap a print over the toe that leaves the sides at the ball canvas", () => {
    assert.equal(sneakers.length, 2, "a sneaker on each foot");
    assert.equal(caps.length, 2, "a toe cap on each foot");
    for (const [s, shell] of sneakers.entries()) {
      const soleTop = Math.max(...shell.rings.filter((ring) => ring[4] === ROLE.SOLE).map((ring) => ring[0]));
      assert.ok(shell.rings.every((ring) => ring[0] <= soleTop || ring[4] === ROLE.SHOE), "no white ring above the sole");
      const laces = shell.print!;
      const instep = shell.rings.filter((ring) => Math.abs(ring[0] - laces.centre[1]) <= laces.size[1] / 2).map((ring) => corners(shell, ring).reduce((front, corner) => (corner[1] > front[1] ? corner : front))[0]);
      const middle = instep.reduce((sum, x) => sum + x, 0) / instep.length;
      assert.ok(Math.abs(laces.centre[0] - middle) < LACES_OFF_MIDDLE, `the laces' middle is ${(laces.centre[0] - middle).toFixed(4)} m off the instep's (${instep.length} rings)`);
      const cap = caps[s]!.print!;
      const ring = shell.rings.find((step) => step[0] < cap.centre[1] + cap.size[1] / 2 && step[4] === ROLE.SHOE)!;
      const front = corners(shell, ring).filter(([, z]) => z > ring[3]).map(([x]) => x);
      const [left, right] = [Math.min(...front), Math.max(...front)];
      assert.ok(Math.abs(cap.centre[0] - (left + right) / 2) < TOE_OFF_MIDDLE, `the cap's middle is ${(cap.centre[0] - (left + right) / 2).toFixed(4)} m off the toe's`);
      assert.ok(cap.size[0] < right - left, `the cap (${cap.size[0]} m) is narrower than the toe's front half (${(right - left).toFixed(3)} m), so the sides stay canvas`);
    }
  });
});
