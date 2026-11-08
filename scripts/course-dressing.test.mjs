import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PREFABS } from "../src/game/world/catalog.ts";
import { boxClear } from "../src/game/world/placements.ts";
import { Track } from "../src/game/world/track.ts";
import { baseOf, dress } from "./course-dressing.mjs";
import breakerYardDressing from "../src/game/world/tracks/breaker-yard.dressing.mjs";
import fourCountDressing from "../src/game/world/tracks/four-count.dressing.mjs";

const COURSE = "breaker-yard";
const AUTHORED_PROPS = 17;
const MARGIN = 6;
/** A point on the main road's centreline. */
const ROAD_POINT = [100, 0];

/** A scratch copy of the course JSON, so a run never touches the real file. */
function scratchDir() {
  const dir = mkdtempSync(join(tmpdir(), "course-dressing-"));
  cpSync(new URL(`../src/game/world/tracks/${COURSE}.json`, import.meta.url), join(dir, `${COURSE}.json`));
  return `${dir}/`;
}

const yardProgram = (/** @type {import("./course-dressing.mjs").Dressing} */ d) => {
  d.fill([480, -110, 540, -60], ["crate", "barrier-block"], { near: 8, minProp: 1.5, count: 10 });
};

describe("given a course with hand-placed props and a dressing program", () => {
  const dir = scratchDir();
  const original = readFileSync(`${dir}${COURSE}.json`, "utf8");

  it("when it is dressed twice, then the second run changes nothing and the authored props stay at their indices", () => {
    const first = dress(COURSE, { props: AUTHORED_PROPS }, yardProgram, dir);
    writeFileSync(first.file, first.text);
    const second = dress(COURSE, { props: AUTHORED_PROPS }, yardProgram, dir);
    const before = JSON.parse(original).props;
    const after = JSON.parse(first.text).props;
    expect(second.changed, "second run changed the file").toBe(false);
    expect(after.length, "props after the run").toBeGreaterThan(AUTHORED_PROPS);
    expect(first.text.startsWith(original.slice(0, original.indexOf('"props"'))), "text before the props array").toBe(true);
    for (let i = 0; i < AUTHORED_PROPS; i++) {
      expect(JSON.stringify(after[i]), `authored prop ${i}`).toBe(JSON.stringify(before[i]));
    }
  });
});

describe("given a prop placed on the road", () => {
  const dir = scratchDir();

  it(`when the course is dressed, then the prop stands at least ${MARGIN} m clear of every road`, () => {
    const { text } = dress(COURSE, { props: AUTHORED_PROPS }, (d) => d.keepOutRoads(MARGIN).prop("crate", ROAD_POINT[0], ROAD_POINT[1]), dir);
    const props = JSON.parse(text).props;
    const placed = props[AUTHORED_PROPS];
    const half = PREFABS.crate.size[0] / 2;
    const clearance = Math.min(...new Track(JSON.parse(text)).paths().map((path) => boxClear(path, placed.x, placed.z, placed.yaw ?? 0, half, half)));
    expect(props.length, "props after the run").toBe(AUTHORED_PROPS + 1);
    expect(clearance, "clearance from the nearest road").toBeGreaterThanOrEqual(MARGIN);
  });
});

describe("given a crowded row of crates one metre apart on open ground", () => {
  const dir = scratchDir();
  const ROW_COUNT = 8;

  it("when the course is dressed, then every crate is placed and no two footprints overlap", () => {
    const { text } = dress(COURSE, { props: AUTHORED_PROPS }, (d) => d.row("crate", [500, -80], [507, -80], { every: 1 }), dir);
    const placed = JSON.parse(text).props.slice(AUTHORED_PROPS);
    let nearest = Infinity;
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.z - b.z));
    }
    expect(placed.length, "crates placed").toBe(ROW_COUNT);
    expect(nearest, "distance between the two nearest crates").toBeGreaterThanOrEqual(2 * PREFABS.crate.foot);
  });
});

describe("given the committed breaker-yard dressing program", () => {
  it("when it is run against the committed course JSON, then the JSON is already its output", () => {
    const base = baseOf(readFileSync(new URL(`../src/game/world/tracks/${COURSE}.dressing.mjs`, import.meta.url), "utf8"));
    const result = dress(COURSE, base, breakerYardDressing);
    expect(base.props, "authored props the sidecar names").toBe(AUTHORED_PROPS);
    expect(result.appended.props, "props the program appends").toBeGreaterThan(0);
    expect(result.changed, "course JSON differs from the program's output").toBe(false);
  });
});

describe("given the committed four-count dressing program", () => {
  // mutation: sed -i 's/"x": 346, "z": 112/"x": 347, "z": 112/' src/game/world/tracks/four-count.json
  it("when it is run against the committed course JSON, then the JSON is already its output and the four hand props lead", () => {
    const base = baseOf(readFileSync(new URL("../src/game/world/tracks/four-count.dressing.mjs", import.meta.url), "utf8"));
    const result = dress("four-count", base, fourCountDressing);
    expect(base.props, "authored props the sidecar names").toBe(4);
    expect(result.appended.props, "props the program appends").toBeGreaterThan(400);
    expect(result.changed, "course JSON differs from the program's output").toBe(false);
  });
});
