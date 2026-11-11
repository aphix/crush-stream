import { describe, expect, it } from "vitest";
import { OW_DRAW_CELL } from "./openworld/openworld-constants.ts";
import { openWorldCourse } from "./openworld/openworld-course.ts";
import { layOutLots } from "./openworld/openworld-lots.ts";
import { parseTrack } from "./track-schema.ts";
import { TRACKS } from "./tracks/index.ts";

describe("given the draw cell a course may name", () => {
  // mutation: sed -i 's/drawCell: z.number().min(16).max(512).optional(),/drawCell: z.number().min(16).max(512).default(96),/' src/game/world/track-schema.ts
  it("when a race track names none, then it parses with none, and the open world names its own", () => {
    const races = TRACKS.map((json) => parseTrack(json)).filter((track) => track.id !== "openworld");
    expect(races.length, "race tracks").toBeGreaterThan(0);
    for (const track of races) expect(track.environment.drawCell, `${track.id}'s draw cell`).toBeUndefined();
    expect(parseTrack(openWorldCourse(layOutLots())).environment.drawCell, "the open world's draw cell").toBe(OW_DRAW_CELL);
  });

  // mutation: sed -i 's/drawCell: z.number().min(16).max(512).optional(),/drawCell: z.number().optional(),/' src/game/world/track-schema.ts
  it("when a course names a cell outside 16 to 512 m, then it is refused", () => {
    const course = openWorldCourse(layOutLots());
    const named = (drawCell: number) => () => parseTrack({ ...course, environment: { ...course.environment, drawCell } });
    expect(named(8)).toThrow();
    expect(named(1024)).toThrow();
    expect(named(96)).not.toThrow();
  });
});
