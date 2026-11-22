import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { EVENT_KIND, TICKS_PER_GAME_DAY } from "./civilian-constants.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { posesDigest, newCrowd } from "./civilian-crowd.test-util.ts";
import { runTicks, stateDigest, tickOfHour } from "./civilian-run.test-util.ts";
import { createCityState } from "./society.ts";

function fnv(text: string): string {
  let hash = 2166136261;
  for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 16777619) >>> 0;
  return hash.toString(16);
}

it("probe: society and crowd digests over seeded days", () => {
  const lines: string[] = [];
  for (const seed of [4321, 2024, 9]) {
    const map = buildFixtureMap(4);
    const state = createCityState(seed, map, 200);
    const at = (day: number, hour: number): number => tickOfHour(state, day, hour);
    const v = state.cast.length + 7;
    const events = new Map<number, number[]>([
      [at(0, 9), [EVENT_KIND.knock, state.cast.length + 3, at(0, 9) / 2]],
      [at(0, 11), [EVENT_KIND.crime, v, at(0, 11) / 2]],
      [at(0, 15), [EVENT_KIND.wreck, placeNamed(map, PLACE_NAMES.bodega), at(0, 15) / 2]],
      [at(0, 18), [EVENT_KIND.danger, 5, at(0, 18) / 2]],
      [at(0, 19), [EVENT_KIND.ambulance, state.cast.length + 3, at(0, 19) / 2]],
      [at(1, 10), [EVENT_KIND.fight, v + 1, at(1, 10) / 2, EVENT_KIND.alongside, v + 2, at(1, 10) / 2]],
      [at(1, 13), [EVENT_KIND.bust, v, at(1, 13) / 2]],
    ]);
    const legs = runTicks(state, 2 * TICKS_PER_GAME_DAY, events);
    lines.push(`society seed ${seed}: state ${stateDigest(state)} legs ${fnv(legs)} count ${legs.length}`);
  }
  const crowd = newCrowd(buildFixtureMap(), 120, 31);
  const poses: string[] = [];
  for (let step = 0; step < 4 * 3600; step++) {
    crowd.step(step / 4, [], true);
    if (step % 240 === 0) poses.push(posesDigest(crowd.poses));
  }
  lines.push(`crowd poses ${fnv(poses.join(","))} state ${stateDigest(crowd.state)}`);
  writeFileSync(process.env.SPINE_PROBE_OUT ?? ".tmp/spine-probe.txt", `${lines.join("\n")}\n`);
}, 600_000);
