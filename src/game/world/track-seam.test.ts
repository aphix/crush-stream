import { describe, expect, it } from "vitest";
import { Track, blankPoint } from "./track.ts";
import { square } from "./track.test-util.ts";
import { OFF_MENU, TRACKS } from "./tracks/index.ts";

/** Sample spacing (m) and reach (m) either side of the start/finish line. */
const DS = 0.25;
const REACH = 10;
/**
 * The most (m) the road's height may bend across one sample pair at the line (second difference of the baked ground at 0.25 m):
 * 2 mm is a 0.46° change of grade in 25 cm. The smoothest course's own bend there is under 1 mm; a bank that peaks at the line
 * (four-count's node 0 at 8° over neighbours at 0) bent the edges 64 mm, the buckle the owner saw.
 */
const BEND = 0.002;

const worstBend = (t: Track, side: number): { bend: number; s: number } => {
  const ground = t.ground();
  const pt = blankPoint();
  const hs: number[] = [];
  for (let s = -REACH; s <= REACH + 1e-9; s += DS) {
    t.pointAt(((s % t.length) + t.length) % t.length, pt);
    const lat = side * pt.half;
    hs.push(ground.heightAt(pt.x + pt.tz * lat, pt.z - pt.tx * lat));
  }
  let worst = { bend: 0, s: 0 };
  for (let i = 1; i < hs.length - 1; i++) {
    const bend = Math.abs(hs[i + 1]! - 2 * hs[i]! + hs[i - 1]!);
    if (bend > worst.bend) worst = { bend, s: -REACH + i * DS };
  }
  return worst;
};

for (const json of [...TRACKS, ...OFF_MENU]) {
  const t = new Track(json);
  describe(`given the ${t.id} course`, () => {
    it("when the ground is read across the start/finish line along the centre and both edges, then its height has no step or kink there", () => {
      for (const side of [-1, 0, 1]) {
        const { bend, s } = worstBend(t, side);
        expect(bend, `${t.id}: the road bends ${(bend * 1000).toFixed(1)} mm at s = ${s.toFixed(2)} m on lateral ${side} × half`).toBeLessThanOrEqual(BEND);
      }
    });
  });
}

describe("given a loop whose start node is banked over unbanked neighbours", () => {
  it("when the course is built, then it refuses the buckle at the start line", () => {
    const json = square();
    json.nodes![0]!.bank = 8;
    expect(() => new Track(json)).toThrow(/start line/);
  });
});
