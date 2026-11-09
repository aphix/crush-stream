import { describe, expect, it } from "vitest";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { fixtureLots } from "../world/openworld/openworld-lots.test-util.ts";
import { sections } from "../world/track-sections.ts";
import { Track } from "../world/track.ts";
import { buildGroundLayers } from "./track-ground.ts";
import { RoadIndex, type Mesher } from "./track-mesh.ts";

const course = openWorldCourse(fixtureLots(LAYOUT.wallReach));

/** The ground layers of the open world's course (tight 10 m corners on its loop) with its race paint on or off. */
function layersOf(raceMarks: boolean) {
  const track = new Track({ ...course, road: { ...course.road, raceMarks } });
  const paths = track.paths();
  return buildGroundLayers(track, track.ground(), new RoadIndex(paths), paths, paths.map((path) => sections(path, 0)));
}

/** How many different colours a mesh's vertices wear. */
function coloursOf(mesher: Mesher): number {
  const seen = new Set<string>();
  for (let vertex = 0; vertex < mesher.col.length; vertex += 3) seen.add(`${mesher.col[vertex]},${mesher.col[vertex + 1]},${mesher.col[vertex + 2]}`);
  return seen.size;
}

describe("given a street course with tight corners on its loop", () => {
  const withMarks = layersOf(true);
  const withoutMarks = layersOf(false);

  // mutation: sed -i 's/  if (raceMarks) addKerbs(/  addKerbs(/' src/game/present/track-ground.ts
  it("when its race marks are on, then the loop has kerb stripes on its corners, and when off, then it has none", () => {
    expect(withMarks.some((layer) => layer.kind === "kerb"), "kerb layer with race marks").toBe(true);
    expect(withoutMarks.some((layer) => layer.kind === "kerb"), "kerb layer without race marks").toBe(false);
  });

  // mutation: sed -i 's/const main = pi === 0 \&\& raceMarks;/const main = pi === 0;/' src/game/present/track-ground.ts
  it("when its race marks are on, then the markings carry a chequered band as well as the white lines, and when off, the white lines alone", () => {
    const markings = (layers: typeof withMarks): Mesher => layers.find((layer) => layer.kind === "marking")!.m;
    expect(coloursOf(markings(withMarks)), "colours with race marks (white lines and the black squares)").toBe(2);
    expect(coloursOf(markings(withoutMarks)), "colours without race marks (white lines)").toBe(1);
    expect(markings(withoutMarks).empty, "the lane lines stay").toBe(false);
  });
});
