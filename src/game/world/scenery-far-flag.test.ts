import { describe, expect, it, vi } from "vitest";
import { PREFABS } from "./catalog.ts";
import { PREFAB, SCENERY_ARM, TRACK_ID } from "./constants.ts";
import { placeCourse, type Placed } from "./placements.ts";
import { addedDrawGroups, drawGroupOf, thinScenery } from "./scenery.ts";
import { CLUSTER_LOOK, CLUSTERS } from "./scenery-biome.ts";
import type * as FieldModule from "./scenery-field.ts";
import { buildFarField } from "./scenery-field.ts";
import { COURSE_JSON, REACH, REACH_SLACK, dress, dressUncached, nearOpening } from "./scenery.test-util.ts";
import { parseTrack } from "./track-schema.ts";
import { Track } from "./track.ts";
import { TRACKS } from "./tracks/index.ts";
import { openWorldCourse } from "./openworld/openworld-course.ts";
import { layOutLots } from "./openworld/openworld-lots.ts";
import { assertSameDigest } from "../vehicle/test-support.ts";
import { hypot2 } from "../kernel/physics-core.js";

vi.mock("./scenery-field.ts", async (original) => {
  const actual = await original<typeof FieldModule>();
  return { ...actual, buildFarField: vi.fn(actual.buildFarField) };
});

const json = (id: string): unknown => COURSE_JSON.find((j) => parseTrack(j).id === id)!;

describe("given a course dressed with and without the far clusters", () => {
  /** Dresses `course` anew with the far flag `far` and counts the coarse road grids built and the far members laid. */
  function dressed(course: unknown, far: boolean): { grids: number; members: number } {
    const grids = vi.mocked(buildFarField);
    grids.mockClear();
    const d = dressUncached(course, {}, far);
    return { grids: grids.mock.calls.length, members: d.drawn.filter((p) => p.far).length };
  }

  it("when a park course is dressed with the far flag off, then no far road grid is built and no member laid; with it on, one grid is built and members stand", () => {
    expect(dressed(json(TRACK_ID.rally), false), "flag off").toMatchObject({ grids: 0, members: 0 });
    const on = dressed(json(TRACK_ID.rally), true);
    expect(on.grids, "flag on: grids built").toBe(1);
    expect(on.members, "flag on: members laid").toBeGreaterThan(100);
  });

  it("when a city, the Mall, Havana and the open world are dressed with the far flag on, then none of the far work is done: no far road grid is built and no member laid", () => {
    const courses = [json(TRACK_ID.city), json(TRACK_ID.nationalMall), json("havana")];
    for (const course of courses) expect(dressed(course, true), parseTrack(course).id).toMatchObject({ grids: 0, members: 0 });
    const grids = vi.mocked(buildFarField);
    grids.mockClear();
    const openWorld = new Track(openWorldCourse(layOutLots()));
    expect(placeCourse(openWorld, SCENERY_ARM.on, true).drawn.filter((p) => p.far).length, "the open world's members").toBe(0);
    expect(grids.mock.calls.length, "the open world's grids").toBe(0);
  });

  it("when every course is dressed with the far flag on and off, then the solid list and every drawn prop but the far members are the same", () => {
    for (const j of COURSE_JSON) {
      const off = dress(j);
      const on = dress(j, {}, true);
      assertSameDigest(off.solid, on.solid, `${off.track.id} solid`);
      assertSameDigest(off.drawn, on.drawn.filter((p) => !p.far), `${off.track.id} drawn but the far members`);
    }
  });
});

describe("given the far clusters' cost on every course", () => {
  it("when the far clusters are laid on every course, then their drawn triangles are at most the budget of 30,000 and no member lies in the solid list", () => {
    const FAR_TRIANGLES_MAX = 30000;
    for (const j of COURSE_JSON) {
      const d = dress(j, {}, true);
      const triangles = d.drawn.reduce((sum, p) => sum + (p.far ? CLUSTER_LOOK[p.prefab]!.triangles : 0), 0);
      expect(triangles, `${d.track.id}: drawn triangles of the far members`).toBeLessThanOrEqual(FAR_TRIANGLES_MAX);
      expect(d.solid.filter((p) => p.far).length, `${d.track.id}: far members in the solid list`).toBe(0);
    }
  });

  it("when the draw groups of the generated props are counted with the far clusters laid, then each course still adds few draws (the far meshes are groups of their own)", () => {
    // The bar of `scenery.test.ts`'s own draws row, now with the far kinds (one group a far kind and 512 m cell) counted in.
    const DRAWS_MAX = 70;
    for (const j of TRACKS) {
      const d = dress(j, {}, true);
      const added = addedDrawGroups(d.authored, d.solid, d.drawn);
      expect(added, `${d.track.id} adds ${added} prefab-cell groups with the far clusters`).toBeLessThanOrEqual(DRAWS_MAX);
    }
  });
});

/** `list` in groups, any two members within `link` m of each other (through a chain of such pairs) in one. */
function linked(list: readonly Placed[], link: number): Placed[][] {
  const root = list.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) if (hypot2(list[a]!.x - list[b]!.x, list[a]!.z - list[b]!.z) < link) root[find(a)] = find(b);
  }
  const groups = new Map<number, Placed[]>();
  for (const [i, p] of list.entries()) groups.set(find(i), [...(groups.get(find(i)) ?? []), p]);
  return [...groups.values()];
}

describe("given the far clusters of a park course and a dirt course", () => {
  const LINK = 12;
  /** A far member keeps at least this far (m) past the verge reach of an open edge: more than a prop's pad and footprint, so a car's reach is never crowded by one. */
  const PAST_REACH = 10;
  const far = (id: string): Placed[] => dress(json(id), {}, true).drawn.filter((p) => p.far);
  const scale = (p: Placed): number => Math.max(p.sx, p.sz);

  it.each([TRACK_ID.rally, TRACK_ID.damSpine])("when %s's far members are linked within 12 m, then most stand in clumps of three or more", (id) => {
    const members = far(id);
    expect(members.length, "the course has far members").toBeGreaterThan(100);
    const clumped = linked(members, LINK).filter((g) => g.length >= 3).reduce((n, g) => n + g.length, 0);
    expect(clumped / members.length, `${clumped} of ${members.length} members in clumps of three or more`).toBeGreaterThan(0.65);
  });

  it.each([TRACK_ID.rally, TRACK_ID.damSpine])("when %s's clumps are measured, then most hold a member at least 1.7 times the size of their smallest", (id) => {
    const groups = linked(far(id), LINK).filter((g) => g.length >= 4);
    expect(groups.length, "clumps of four or more").toBeGreaterThan(10);
    const mixed = groups.filter((g) => Math.max(...g.map(scale)) >= 1.7 * Math.min(...g.map(scale))).length;
    expect(mixed / groups.length, `${mixed} of ${groups.length} clumps`).toBeGreaterThan(0.6);
  });

  it("when the drawn list is thinned to the Low and Minimal shares, or for a phone at the full share, then no far member is left, and the top tier on a desktop keeps every one", () => {
    const d = dress(json(TRACK_ID.damSpine), {}, true);
    const all = d.drawn.filter((p) => p.far).length;
    expect(all, "the course has far members").toBeGreaterThan(100);
    for (const keep of [0.6, 0.3]) expect(thinScenery(d.drawn, keep).filter((p) => p.far).length, `share ${keep}`).toBe(0);
    expect(thinScenery(d.drawn, 1, false).filter((p) => p.far).length, "a phone at the full share").toBe(0);
    expect(thinScenery(d.drawn, 1).filter((p) => p.far).length).toBe(all);
  });

  it("when every far member of every course is measured, then no open road edge lies within the verge reach and the clearance beyond it, and none is a solid prop", () => {
    const bad: string[] = [];
    for (const j of COURSE_JSON) {
      const d = dress(j, {}, true);
      for (const p of d.drawn) if (p.far && nearOpening(d.track, p.x, p.z, REACH + PAST_REACH - REACH_SLACK)) bad.push(`${d.track.id} far ${p.prefab} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      for (const p of d.solid) if (p.far) bad.push(`${d.track.id} solid far ${p.prefab}`);
    }
    expect(bad).toEqual([]);
  });

  it.each([TRACK_ID.damSpine, TRACK_ID.razorShelf])("when %s's far rocks are read back, then each stands sunk at least 8 % of its height into the ground, leans, and is not the same size on every axis", (id) => {
    const d = dress(json(id), {}, true);
    const rocks = d.drawn.filter((p) => p.far && p.prefab === PREFAB.rock);
    expect(rocks.length, "far rocks").toBeGreaterThan(20);
    for (const p of rocks) {
      const sunk = d.track.ground().heightAt(p.x, p.z) - p.y;
      expect(sunk, `rock at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) sunk ${sunk.toFixed(2)} m`).toBeGreaterThanOrEqual(0.08 * PREFABS[PREFAB.rock].size[1] * p.sy - 1e-6);
    }
    expect(rocks.filter((p) => (p.lean ?? 0) > 0.02).length / rocks.length, "most lean").toBeGreaterThan(0.7);
    expect(rocks.filter((p) => Math.abs(p.sx - p.sy) > 0.05 * p.sy).length / rocks.length, "most are not cubes in scale").toBeGreaterThan(0.7);
  });

  it("when the biomes' cluster kinds are listed, then every one has a look (size, lean, sink)", () => {
    for (const [biome, spec] of Object.entries(CLUSTERS)) for (const [kind] of spec.kinds) expect(CLUSTER_LOOK[kind], `${biome} ${kind}`).toBeDefined();
  });

  it("when every far member of every course is read back, then they fall in at most one draw group a far kind, and a group is a kind the biome tables list", () => {
    const kinds = new Set(Object.values(CLUSTERS).flatMap((spec) => spec.kinds.map(([kind]) => `${kind}:far`)));
    const bad: string[] = [];
    for (const j of COURSE_JSON) {
      const d = dress(j, {}, true);
      for (const p of d.drawn) if (p.far && !kinds.has(drawGroupOf(p))) bad.push(`${d.track.id} ${drawGroupOf(p)}`);
    }
    expect(bad).toEqual([]);
  });
});
