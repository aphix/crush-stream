import { after, afterEach, before, describe, it } from "node:test";
import { ALONG, COMPASS, report, roadSite, type Site } from "./ground-judge.test-util.ts";
import { drive } from "./ground-probe.test-util.ts";
import { useStiffSprings } from "./stiff-springs.test-util.ts";
import { setGround } from "../world/ground.ts";
import { blankPoint, pointOn, Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { TRACKS } from "../world/tracks/index.ts";

/**
 * ground-fit.test.ts's drop matrix on the courses' roads (the stunt course's CRUSH crest and banks, the rally hairpin), in its own file so
 * it runs beside the ramps' (the judge: ground-judge.test-util.ts).
 */

const SEDAN = ["sedan"] as const;
const SEDAN_MONSTER = ["sedan", "monster"] as const;
const course = (id: string): Track => new Track(TRACKS.find((j) => parseTrack(j).id === id)!);
const stunt = course("stunt");
const rally = course("rally");
const _pt = blankPoint();

/** The CRUSH billboard crest (apex s ≈ 899) and the descent behind it (-21.5° at s 908); the kicker also every metre. */
function crestSites(): Site[] {
  const wide = [890, 896, 899, 902, 905, 908, 911, 915, 920];
  const sites: Site[] = [];
  for (const s of [...wide, 906, 907, 909, 910].sort((a, b) => a - b)) {
    for (const lat of wide.includes(s) ? [0, 3, -3] : [0]) {
      sites.push(roadSite(stunt, `stunt crest s=${s} lat=${lat}`, s, lat, COMPASS, ALONG, lat === 0 ? SEDAN_MONSTER : SEDAN));
    }
  }
  return sites;
}

/** The owner's stopped car, braked where it stopped, s 899-905 (899, 902 and 905 are in the crest group), every heading. */
function stoppedSites(): Site[] {
  const sites: Site[] = [];
  for (const s of [900, 901, 903, 904]) {
    sites.push(roadSite(stunt, `stunt stopped drop s=${s}`, s, 0, COMPASS, ALONG, SEDAN_MONSTER));
  }
  return sites;
}

/** The bank run: stunt bowl (steepest bank at node 6, then its run-out), nodes 14-15 (-8..-12°), the rally hairpin. */
function bankSites(): Site[] {
  const spots: [Track, string, number][] = [
    [stunt, "stunt bowl n5", stunt.nodeS[5]!],
    [stunt, "stunt bowl n6", stunt.nodeS[6]!],
    [stunt, "stunt bowl n7", stunt.nodeS[7]!],
    [stunt, "stunt bowl run-out", (stunt.nodeS[8]! + stunt.nodeS[9]!) / 2],
    [stunt, "stunt n14", stunt.nodeS[14]!],
    [stunt, "stunt n15", stunt.nodeS[15]!],
    [stunt, "stunt n15 run-out", (stunt.nodeS[15]! + stunt.nodeS[16]!) / 2],
    ...[7, 8, 9, 10].map((n): [Track, string, number] => [rally, `rally hairpin n${n}`, rally.nodeS[n]!]),
  ];
  return spots.flatMap(([track, name, s]) => {
    const half = pointOn(track.path, s, _pt).half;
    // Across the width, then a shoulder point either side (the crease where the bank's plane meets the runoff).
    return [-(half - 1), -2, 0, 2, half - 1, half + 1, -(half + 1)].map((lat) => roadSite(track, `${name} lat=${lat.toFixed(1)}`, s, lat, COMPASS, ALONG, SEDAN));
  });
}

describe("given a braked car placed at every heading across a matrix of ground sites, on springs so stiff and short that no sag excuses a gap", () => {
  let restoreSprings = (): void => {};
  before(() => {
    restoreSprings = useStiffSprings();
  });
  after(() => restoreSprings());
  afterEach(() => setGround(null));

  it("when the car brakes on the stunt course's CRUSH crest and descent, then it sits on the ground at every heading", (t) => report(t, crestSites()));

  it("when the car has stopped on the stunt course's CRUSH crest, then it sits on the ground at every heading", (t) => {
    const rolled: Site[] = [];
    for (const v of [6, 10, 14]) {
      for (const stop of [899, 902, 905, 908]) {
        rolled.push({
          name: `stunt roll-stop brake@${stop}`,
          kind: "plain",
          classes: SEDAN_MONSTER,
          runs: (cls) => {
            const out = drive(stunt, cls, stop - 5, stop + 120, () => v, { lead: 35, brakeFrom: stop });
            const last = out[out.length - 1];
            if (!last) throw new Error(`v=${v} brake@${stop}: never reached the braking point`);
            // Heading column: the speed in and how far it rolled; slide: how far it crept in its last two held seconds.
            const creep = Math.abs(last.s - out[Math.max(0, out.length - 121)]!.s);
            return [[`v=${v}/${(last.s - stop).toFixed(0)}m`, { ...last, slide: creep }]];
          },
        });
      }
    }
    report(t, [...stoppedSites(), ...rolled]);
  });

  it("when the car sits on banked turns (stunt bowl, stunt nodes 14-15, rally hairpin) across the road's width and its shoulders, then it sits on the ground at every heading", (t) => report(t, bankSites()));
});
