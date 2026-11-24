import { describe, expect, it, vi } from "vitest";
import { SCENERY_ARM, TRACK_ID } from "./constants.ts";
import { placeCourse } from "./placements.ts";
import type * as FieldModule from "./scenery-field.ts";
import { buildFarField } from "./scenery-field.ts";
import { COURSE_JSON, dress, dressUncached } from "./scenery.test-util.ts";
import { parseTrack } from "./track-schema.ts";
import { Track } from "./track.ts";
import { openWorldCourse } from "./openworld/openworld-course.ts";
import { layOutLots } from "./openworld/openworld-lots.ts";
import { assertSameDigest } from "../vehicle/test-support.ts";

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
