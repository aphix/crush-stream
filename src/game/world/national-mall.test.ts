import { describe, expect, it } from "vitest";
import { LINCOLN, PREFABS } from "./catalog.ts";
import { CAPITOL_POOL } from "./landmarks.ts";
import { placeProps } from "./placements.ts";
import { blankProjection, CELL, Track } from "./track.ts";
import { TRACKS } from "./tracks/index.ts";
import { RaceSession } from "../match/session.ts";
import { centreline, field, polyline, runTo } from "../match/session-drive.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

/** 1.7 miles: the published length of the 2026 Freedom 250 street circuit the course follows. */
const CIRCUIT_M = 2736;
/** The published frontstretch: 0.4 miles of Pennsylvania Avenue. */
const FRONTSTRETCH_M = 644;
/** The fewest metres of open street one stamped run covers on this course: a straight run is stamped once, where stamping every metre's sample would be 1 m a run. */
const MIN_STREET_RUN_M = 10;
/** The most times the bake measures a ground cell against a street's segment, averaged over the course's cells (a straight run is measured once, not once per metre of it). */
const MAX_MEASURES_PER_CELL = 8;
/** A polygon's bounds cover at most its extent in cells plus this many: the floor and the ceiling of its edges each add up to a cell, and the edge's own cell counts. */
const BOX_EDGE_CELLS = 3;
/** The Mall's lawn between Madison Drive (north) and Jefferson Drive (south), 7th Street to 3rd Street (z south). */
const LAWN = { minX: -572, maxX: 0, minZ: -345, maxZ: -160 };

function boxCells(poly: readonly (readonly [number, number])[]): number {
  const xs = poly.map(([x]) => x);
  const zs = poly.map(([, z]) => z);
  return ((Math.max(...xs) - Math.min(...xs)) / CELL + BOX_EDGE_CELLS) * ((Math.max(...zs) - Math.min(...zs)) / CELL + BOX_EDGE_CELLS);
}

describe("given the National Mall street circuit (x east, z south, origin 3rd St and Independence Ave)", () => {
  const json = TRACKS.find((j) => new Track(j).id === "national-mall");
  expect(json, "the race menu lists the national-mall course").toBeTruthy();
  const track = new Track(json);
  const ground = track.ground();
  const baked = ground.bakeCounts;
  const placed = placeProps(track);
  const far = track.json.environment.far;
  const pr = blankProjection();
  const sampleAt = (x: number, z: number): number => {
    track.project(x, z, -1, pr);
    return pr.k;
  };

  it("when its lap is measured, then it is within 3 % of the real circuit's 1.7 miles", () => {
    expect(Math.abs(track.length - CIRCUIT_M) / CIRCUIT_M, `lap ${track.length.toFixed(0)} m`).toBeLessThan(0.03);
  });

  it("when its straights are measured, then the longest is the Pennsylvania Avenue frontstretch, at least 0.4 miles and wider than the side streets", () => {
    const p = track.path;
    const ds = track.length / p.count;
    let best = { run: 0, end: 0 };
    let run = 0;
    for (let k = 0; k < p.count * 2; k++) {
      run = Math.abs(p.curv[k % p.count]!) < 1e-3 ? run + ds : 0;
      if (run > best.run) best = { run, end: k % p.count };
    }
    const mid = (best.end - Math.round(best.run / ds / 2) + p.count) % p.count;
    expect(best.run, `longest straight ${best.run.toFixed(0)} m`).toBeGreaterThanOrEqual(FRONTSTRETCH_M);
    expect(p.tx[mid]! < -0.9 && p.tz[mid]! < 0, "it runs west-north-west, toward the Washington Monument").toBeTruthy();
    expect(p.half[mid]!, "Pennsylvania Avenue is wider than 7th Street").toBeGreaterThan(p.half[sampleAt(-572, -400)]!);
  });

  it("when the road down Independence Avenue into turn six is ridden, then it rises and falls over at least four bumps of 0.25-0.35 m, and is level before them", () => {
    const heights: number[] = [];
    for (let x = -260; x <= -60; x += 2) heights.push(ground.heightAt(x, 0));
    const humps = heights.filter((h, i) => i > 0 && i < heights.length - 1 && h > heights[i - 1]! && h >= heights[i + 1]!);
    expect(humps.length, `${humps.length} bumps`).toBeGreaterThanOrEqual(4);
    for (const h of humps) expect(h >= 0.25 && h <= 0.35, `a bump ${h.toFixed(2)} m high`).toBeTruthy();
    expect(Math.abs(ground.heightAt(-420, 0)), "level before the bumps").toBeLessThan(0.01);
  });

  it("when 3rd Street is driven north, then it runs under a roof from just past turn six and is open sky at the start line", () => {
    expect(track.path.tunnel[sampleAt(0, -80)], "the underpass").toBe(1);
    expect(track.path.tunnel[sampleAt(0, -290)], "the line").toBe(0);
  });

  it("when the open streets beside the Mall's lawn are looked at, then 7th and 3rd Streets have no walls from Madison Drive to Jefferson Drive, only a line of light cones, and there is no shortcut across", () => {
    const p = track.path;
    for (const [x, z] of [[-572, -300], [-572, -200], [0, -300], [0, -200]] as const) {
      const k = sampleAt(x, z);
      expect(p.wallL[k] === 0 && p.wallR[k] === 0, `no wall at (${x}, ${z})`).toBeTruthy();
    }
    expect(p.wallL[sampleAt(-572, -100)] === 1 && p.wallL[sampleAt(0, -80)] === 1, "walled again past Jefferson Drive (and in the underpass)").toBeTruthy();
    expect(track.shortcuts.length, "the lawn is no shortcut").toBe(0);
    const cones = placed.filter((q) => q.prefab === "cone" && q.z > LAWN.minZ && q.z < LAWN.maxZ);
    for (const x of [LAWN.minX, LAWN.maxX]) {
      const beside = cones.filter((q) => Math.abs(q.x - x) < 10);
      expect(beside.length, `${beside.length} cones along the street at x ${x}`).toBeGreaterThanOrEqual(2 * 30);
    }
    const stray = placed.filter((q) => q.prefab === "cone" && !(q.z > LAWN.minZ - 10 && q.z < LAWN.maxZ + 5));
    expect(stray.length, `${stray.length} cones away from the open streets, the first at (${stray[0]?.x.toFixed(0)}, ${stray[0]?.z.toFixed(0)})`).toBe(0);
    expect(PREFABS.cone.body).toBe("knock");
    expect(PREFABS.cone.mass, "a cone barely slows a car that hits it").toBeLessThanOrEqual(5);
  });

  it("when a car leaves 7th Street after checkpoint 4 and crosses the lawn to 3rd Street and the line, then it earns no lap and is told it missed a checkpoint; driving the streets round earns the lap", () => {
    const L = track.length;
    const cut = [...centreline(track, L - 6, L + track.gates[4]!.s + 5), { x: -520, z: -250 }, { x: -60, z: -250 }, { x: 0, z: -260 }, { x: 0, z: -330 }];
    const across = new RaceSession(track, field(1), { laps: 1, noReset: false });
    const ev = runTo(across, [polyline(cut, 40)], 120);
    expect(ev.filter((e) => e.type === "lap").length, "no lap across the grass").toBe(0);
    expect(across.cars[0]!.missed, "the HUD is told a checkpoint was skipped").toBe(true);
    const round = new RaceSession(track, field(1), { laps: 1, noReset: false });
    const done = runTo(round, [polyline(centreline(track, L - 6, 2 * L + 10), 40)], 200);
    expect(done.filter((e) => e.type === "lap").length, "the lap by the streets counts").toBe(1);
  });

  it("when the landmarks are placed, then the Capitol stands on Capitol Hill east of 3rd Street and the Washington Monument down the Mall within the camera's reach of the frontstretch", () => {
    const capitol = placed.find((p) => p.prefab === "capitol");
    const obelisk = placed.find((p) => p.prefab === "obelisk");
    must(capitol && obelisk, "both landmarks are placed");
    expect(capitol.x > 0 && capitol.y >= 10, `the Capitol at x ${capitol.x}, y ${capitol.y}`).toBeTruthy();
    expect(obelisk.x, "the monument is west of 9th Street, past the circuit").toBeLessThan(-754);
    expect(PREFABS.obelisk.size[1], "the monument is its real 169 m").toBe(169);
    for (const [name, x, z] of [["turn one", 0, -577], ["turn two", -754, -710]] as const) {
      expect(Math.hypot(obelisk.x - x, obelisk.z - z), `drawn from ${name}`).toBeLessThan(far);
    }
  });

  it("when the Mall between Madison and Jefferson Drives is walked, then it is open lawn, and every building, museum and grandstand stands on paved ground off it", () => {
    for (let x = LAWN.minX + 20; x < LAWN.maxX - 20; x += 25) {
      for (let z = LAWN.minZ + 5; z < LAWN.maxZ - 5; z += 25) {
        if (Math.abs(z + 205) > 8) expect(ground.surfaceAt(x, z), `the lawn at (${x}, ${z})`).toBe("grass");
      }
    }
    for (const p of placed.filter((q) => ["building", "grandstand", "marble"].includes(q.prefab))) {
      const [w, , d] = PREFABS[p.prefab].size;
      const hx = (w * p.sx) / 2 - 1;
      const hz = (d * p.sz) / 2 - 1;
      for (const [u, v] of [[0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]] as const) {
        const x = p.x + u * Math.cos(p.yaw) + v * Math.sin(p.yaw);
        const z = p.z - u * Math.sin(p.yaw) + v * Math.cos(p.yaw);
        expect(ground.surfaceAt(x, z), `a ${p.prefab} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) stands on grass at (${x.toFixed(0)}, ${z.toFixed(0)})`).not.toBe("grass");
      }
    }
  });

  it("when the White House is placed, then it stands as on the map: north of the Ellipse and the Monument, its North Portico toward Lafayette Square, the Treasury east and the Executive Office Building west, inside the camera's reach of turn two", () => {
    const wh = placed.find((p) => p.prefab === "white-house");
    const obelisk = placed.find((p) => p.prefab === "obelisk")!;
    must(wh, "the White House is placed");
    expect(Math.abs(wh.yaw), "unturned: its north front (-z) faces north").toBeLessThan(1e-9);
    expect(wh.z < obelisk.z - 500 && Math.abs(wh.x - obelisk.x) < 150, "north of the Monument, a little west").toBeTruthy();
    const ellipse = track.routes.find((r) => r.id === "ellipse-road");
    must(ellipse, "the Ellipse's road");
    const ez = Array.from(ellipse.path.z.slice(0, ellipse.path.count));
    const middle = (Math.min(...ez) + Math.max(...ez)) / 2;
    expect(wh.z < middle && middle < obelisk.z, "the Ellipse between the White House and the Monument").toBeTruthy();
    const flank = placed.filter((p) => p.prefab === "marble" && Math.abs(p.z - wh.z) < 60 && Math.abs(p.x - wh.x) < 200);
    expect(flank.some((p) => p.x > wh.x + 100) && flank.some((p) => p.x < wh.x - 100), "the Treasury east, the Executive Office Building west").toBeTruthy();
    expect(Math.hypot(wh.x + 754, wh.z + 710), "drawn from turn two").toBeLessThan(far);
  });

  it("when the race starts, then the mushroom cloud is a secret (the Konami code brings it out), and it rises down the frontstretch toward the White House: right of the avenue's line, within 10° of it, so the straight's buildings never hide it", () => {
    const wh = placed.find((p) => p.prefab === "white-house")!;
    const sky = track.json.environment.backdrop;
    expect(sky?.kind).toBe("mushroom-cloud");
    expect(sky?.secret, "not there until the code").toBe(true);
    const deg = (dx: number, dz: number): number => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    const avenue = deg(-754, -710 + 577);
    const house = deg(wh.x + 377, wh.z + 643.5);
    expect(house, "the White House stands right of the avenue's line").toBeGreaterThan(avenue);
    expect(sky!.bearing > avenue && sky!.bearing < Math.min(house, avenue + 10), `the cloud at ${sky!.bearing}°, the avenue ${avenue.toFixed(1)}°, the White House ${house.toFixed(1)}°`).toBeTruthy();
  });

  it("when the Mall is looked down from the Monument, then west lie the WWII Memorial's basin, the long Reflecting Pool and the Lincoln Memorial facing east down it, and east the Capitol Reflecting Pool below the Hill, all within the camera's reach of the frontstretch", () => {
    const obelisk = placed.find((p) => p.prefab === "obelisk")!;
    const basin = placed.find((p) => p.prefab === "basin");
    const lincoln = placed.find((p) => p.prefab === "lincoln");
    const pools = placed.filter((p) => p.prefab === "reflecting-pool").sort((a, b) => a.x - b.x);
    const capitol = placed.find((p) => p.prefab === "capitol")!;
    const capitolPool = placed.find((p) => p.prefab === "capitol-pool");
    must(basin && lincoln && pools.length === 2 && capitolPool, "the basin, the memorial, the Reflecting Pool and the lake, and the Capitol's pool");
    const reflecting = pools.find((p) => p.x < basin.x && Math.abs(p.z - obelisk.z) < 30)!;
    // In order down the axis: Lincoln, the Reflecting Pool, the basin, the Monument ... the Capitol's pool, the Capitol.
    expect(lincoln.x < reflecting.x && reflecting.x < basin.x && basin.x < obelisk.x, "west of the Monument in order").toBeTruthy();
    expect(capitolPool.x > 0 && capitolPool.x < capitol.x, "the Capitol's pool between 3rd Street and the Capitol").toBeTruthy();
    for (const p of [basin, lincoln, reflecting]) expect(Math.abs(p.z - obelisk.z), "on the Mall's axis by the Monument (it stands a little off it, as it does)").toBeLessThan(30);
    const long = (PREFABS["reflecting-pool"].size[0] * reflecting.sx) / (PREFABS["reflecting-pool"].size[2] * reflecting.sz);
    expect(long, `the Reflecting Pool is long and narrow (${long.toFixed(1)} : 1)`).toBeGreaterThan(5);
    // Its front (+z at yaw 0) turned to face east (+x), down the pool.
    expect(Math.sin(lincoln.yaw), "the Lincoln Memorial faces east").toBeGreaterThan(0.99);
    for (const p of [lincoln, capitolPool]) expect(Math.hypot(p.x - 0, p.z + 577), `${p.prefab} drawn from turn one`).toBeLessThan(far);
  });

  it("when the city round the circuit is walked, then no ground within 150 m of the course, off its streets, lies more than 40 m from a building, tree or monument: only the lawns (the Mall, the Ellipse, the parks) stay open", () => {
    const solid = placed.filter((q) => q.prefab !== "cone");
    const reach = solid.map((q) => (Math.max(PREFABS[q.prefab].size[0] * q.sx, PREFABS[q.prefab].size[2] * q.sz)) / 2);
    const p = track.path;
    const empty: string[] = [];
    for (let x = Math.ceil(track.bounds.minX / 10) * 10; x < track.bounds.maxX; x += 10) {
      for (let z = Math.ceil(track.bounds.minZ / 10) * 10; z < track.bounds.maxZ; z += 10) {
        let course = Infinity;
        for (let k = 0; k < p.count; k++) course = Math.min(course, Math.hypot(p.x[k]! - x, p.z[k]! - z));
        const surface = ground.surfaceAt(x, z);
        if (course < 15 || course > 150 || surface === "grass" || surface === "asphalt") continue;
        let near = Infinity;
        for (let i = 0; i < solid.length; i++) near = Math.min(near, Math.hypot(solid[i]!.x - x, solid[i]!.z - z) - reach[i]!);
        if (near > 40) empty.push(`(${x}, ${z}) ${near.toFixed(0)} m`);
      }
    }
    expect(empty.length, `${empty.length} empty lots: ${empty.slice(0, 8).join(", ")}`).toBe(0);
  });

  it("when the House side south of Independence Avenue is placed, then South Capitol Street runs on the Capitol's axis, Rayburn (the largest) stands west of it, Longworth and then Cannon east of it", () => {
    const capitol = placed.find((p) => p.prefab === "capitol")!;
    const southCapitol = track.routes.find((r) => r.id === "south-capitol-street");
    must(southCapitol, "South Capitol Street");
    expect(Math.abs(southCapitol.path.x[0]! - capitol.x), `South Capitol St at x ${southCapitol.path.x[0]}, the Capitol at ${capitol.x}`).toBeLessThan(1);
    const offices = placed.filter((p) => p.prefab === "marble" && p.z > 8 && p.x > 0).sort((a, b) => a.x - b.x);
    expect(offices.length, "Rayburn, Longworth, Cannon").toBe(3);
    const [rayburn, longworth, cannon] = offices as [typeof capitol, typeof capitol, typeof capitol];
    expect(rayburn.x < capitol.x && longworth.x > capitol.x && cannon.x > longworth.x, "west to east about the axis").toBeTruthy();
    expect(rayburn.sx > longworth.sx && rayburn.sx > cannon.sx, "Rayburn is the largest").toBeTruthy();
  });

  it("when the Lincoln Memorial is looked at, then it stands on its terrace with the grand stair down its front to the Reflecting Pool, inside its circle road, and the seated Lincoln faces out through the open east front", () => {
    const lincoln = placed.find((p) => p.prefab === "lincoln")!;
    const stair = LINCOLN.stair;
    expect(stair.length, `${stair.length} steps`).toBeGreaterThanOrEqual(15);
    expect(stair.at(-1)!.y1, "the stair climbs to the terrace's top").toBe(LINCOLN.terrace.y1);
    for (const [k, b] of stair.entries()) if (k > 0) expect(b.y1 > stair[k - 1]!.y1 && b.hz < stair[k - 1]!.hz, "each step higher and shallower").toBeTruthy();
    // The stair's foot, the front's farthest reach (local +z), turned to the world by the memorial's yaw.
    const reach = stair[0]!.z! + stair[0]!.hz;
    const foot = { x: lincoln.x + Math.sin(lincoln.yaw) * reach, z: lincoln.z + Math.cos(lincoln.yaw) * reach };
    const pool = placed.filter((p) => p.prefab === "reflecting-pool").sort((a, b) => Math.hypot(a.x - lincoln.x, a.z - lincoln.z) - Math.hypot(b.x - lincoln.x, b.z - lincoln.z))[0]!;
    expect(Math.hypot(foot.x - pool.x, foot.z - pool.z), "the stair runs down toward the pool").toBeLessThan(Math.hypot(lincoln.x - pool.x, lincoln.z - pool.z) - reach + 1);
    const circle = track.routes.find((r) => r.id === "lincoln-memorial-circle")!;
    const inner = Math.min(...Array.from(circle.path.x.slice(0, circle.path.count), (x, k) => Math.hypot(x - lincoln.x, circle.path.z[k]! - lincoln.z))) - circle.path.half[0]!;
    expect(PREFABS.lincoln.foot, `the memorial (${PREFABS.lincoln.foot.toFixed(0)} m) inside its circle road (${inner.toFixed(0)} m)`).toBeLessThan(inner);
    const { cella, statue } = LINCOLN;
    expect(cella.door, "the door is wider than the statue's pedestal").toBeGreaterThan(statue.pedestal.hx * 2);
    expect(Math.abs(statue.pedestal.z) + statue.pedestal.hz, "the statue inside the chamber").toBeLessThan(cella.hz - cella.wall);
  });

  it(`when its ground is baked, then each open street's straight run is stamped once: at most one stamp per ${MIN_STREET_RUN_M} m of street, never one per metre's sample`, () => {
    const streets = [...track.paths()].filter((p) => p !== track.path);
    const openStreets = streets.filter((p) => !p.closed);
    // The main loop and each closed street are stamped a segment at a time.
    const stampedPerSample = [track.path, ...streets.filter((p) => p.closed)].reduce((n, p) => n + p.count, 0);
    const openStreetRuns = baked.runsStamped - stampedPerSample;
    const openStreetMetres = openStreets.reduce((m, p) => m + p.length, 0);
    expect(openStreetRuns, `${openStreetRuns} runs stamped over ${openStreets.length} open streets, one each at least`).toBeGreaterThanOrEqual(openStreets.length);
    expect(openStreetRuns * MIN_STREET_RUN_M, `${openStreetRuns} runs stamped over ${openStreetMetres.toFixed(0)} m of open street`).toBeLessThanOrEqual(openStreetMetres);
  });

  it(`when its ground (some 4 M one-metre cells under 50 streets) is baked, then each cell is measured against a street segment at most ${MAX_MEASURES_PER_CELL} times on average, not once for every metre of street reaching it`, () => {
    const streetMetres = [...track.paths()].reduce((m, p) => m + p.length, 0);
    const groundCells = ground.nx * ground.nz;
    expect(baked.cellsMeasured, `${baked.cellsMeasured} cells measured over ${streetMetres.toFixed(0)} m of street, a cell at least per metre`).toBeGreaterThan(streetMetres);
    expect(baked.cellsMeasured, `${baked.cellsMeasured} cells measured over ${groundCells} ground cells`).toBeLessThanOrEqual(MAX_MEASURES_PER_CELL * groundCells);
  });

  it("when its ground is baked, then each paint polygon is tried only over the cells its bounds cover, not over the whole ground", () => {
    const paint = track.json.environment.paint;
    const boxes = paint.reduce((n, p) => n + boxCells(p.poly), 0);
    expect(baked.paintCellsVisited, `${baked.paintCellsVisited} cells visited by ${paint.length} polygons, one each at least`).toBeGreaterThanOrEqual(paint.length);
    expect(baked.paintCellsVisited, `${baked.paintCellsVisited} cells visited over ${boxes.toFixed(0)} cells of polygon bounds`).toBeLessThanOrEqual(boxes);
  });

  it("when its ground is registered with the surface store, then the field is one grid patch whose cells are each bounded once, beside one patch per bridge deck", () => {
    const decks = track.path.deck.slice(0, track.path.count).reduce((n, d) => n + d, 0);
    const gridCells = (ground.nx - 1) * (ground.nz - 1);
    expect(baked.patches, `${baked.patches} patches registered for ${decks} deck segments`).toBe(1 + decks);
    expect(baked.cellsBounded, `${baked.cellsBounded} cells bounded over ${gridCells} grid cells`).toBe(gridCells);
  });

  it("when the Washington Monument's grounds are walked (owner, 2026-10-14: like the map of them), then it stands on a knoll in a paved circle ringed by 50 flags, gravel walks loop round it and cross the lawn, and the lawn round them is open", () => {
    const obelisk = placed.find((p) => p.prefab === "obelisk")!;
    const flags = placed.filter((p) => p.prefab === "flagpole");
    expect(flags.length, "the 50 flags").toBe(50);
    for (const f of flags) expect(Math.abs(Math.hypot(f.x - obelisk.x, f.z - obelisk.z) - 23), "in a ring round its foot").toBeLessThan(1);
    expect(ground.heightAt(obelisk.x, obelisk.z) - ground.heightAt(-812, obelisk.z), "on a knoll over the lawn at 15th Street's edge").toBeGreaterThan(3);
    expect(ground.surfaceAt(obelisk.x + 15, obelisk.z), "the paved circle").toBe("cobble");
    // Along a north-south line through the western circle's middle: the oval walk and the circle at each end, lawn between.
    const line: string[] = [];
    for (let z = obelisk.z - 120; z <= obelisk.z + 120; z += 1) line.push(ground.surfaceAt(obelisk.x - 45, z));
    const crossings = line.filter((s, i) => s === "gravel" && line[i - 1] !== "gravel").length;
    expect(crossings, `${crossings} walks crossed north to south`).toBeGreaterThanOrEqual(4);
    expect(line.filter((s) => s === "grass").length, "mostly lawn").toBeGreaterThan(line.length * 0.6);
  });

  it("when the course is listed for the race menu, then it is called Washington DC", () => {
    expect(track.json.name).toBe("Washington DC");
  });

  it("when Madison and Jefferson Drives are followed east down the Mall, then each runs on to 3rd Street's edge, where the course's barrier closes it", () => {
    const ends = (prefix: string) => track.routes.filter((r) => r.id.startsWith(prefix)).map((r) => Math.max(...Array.from(r.path.x.slice(0, r.path.count))));
    for (const drive of ["madison-drive", "jefferson-drive"]) {
      const east = Math.max(...ends(drive));
      expect(east > -10 && east < 0, `${drive} reaches x ${east.toFixed(1)} (3rd Street's centre at 0, its runoff to 7.5)`).toBeTruthy();
    }
  });

  it("when Union Square is looked at, then the Capitol Reflecting Pool is a wedge wider at its west end, the Grant Memorial stands at its east end facing down the Mall, and the Peace and Garfield Monuments stand in circles on 1st Street at its north and south corners", () => {
    const pool = placed.find((p) => p.prefab === "capitol-pool")!;
    const capitol = placed.find((p) => p.prefab === "capitol")!;
    expect(CAPITOL_POOL.westHalf, "a wedge narrowing toward the Capitol").toBeGreaterThan(CAPITOL_POOL.eastHalf * 1.4);
    expect(pool.x > 0 && pool.x < capitol.x && Math.abs(pool.yaw) < 1e-9, "between 3rd Street and the Capitol, its wide end west").toBeTruthy();
    const grant = placed.find((p) => p.prefab === "grant-memorial")!;
    expect(grant.x > pool.x + CAPITOL_POOL.halfLength && grant.x < capitol.x && Math.abs(grant.z - pool.z) < 1, "at the pool's east end, on its axis").toBeTruthy();
    expect(Math.sin(grant.yaw), "facing west, down the Mall").toBeLessThan(-0.99);
    const first = track.routes.find((r) => r.id === "1st-street")!;
    for (const [circle, statue, north] of [["peace-circle", "peace-monument", true], ["garfield-circle", "garfield-monument", false]] as const) {
      const ring = track.routes.find((r) => r.id === circle)!;
      const xs = Array.from(ring.path.x.slice(0, ring.path.count));
      const zs = Array.from(ring.path.z.slice(0, ring.path.count));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const m = placed.find((p) => p.prefab === statue)!;
      expect(ring.path.closed && Math.hypot(m.x - cx, m.z - cz) < 1, `${statue} in the middle of ${circle}`).toBeTruthy();
      expect(Math.abs(cx - first.path.x[0]!), `${circle} on 1st Street`).toBeLessThan(1);
      expect(north ? cz < pool.z - CAPITOL_POOL.westHalf : cz > pool.z + CAPITOL_POOL.eastHalf, `${circle} at the plaza's ${north ? "north" : "south"} corner`).toBeTruthy();
    }
  });

  it("when the National Archives block is placed, then it stands inside the corner that turns two, three and four make", () => {
    const blocks = placed.filter((p) => p.prefab === "marble");
    expect(blocks.some((b) => b.x > -754 && b.x < -572 && b.z > -710 && b.z < -522), "a block between 9th and 7th Streets, Pennsylvania and Constitution Avenues").toBeTruthy();
  });
});
