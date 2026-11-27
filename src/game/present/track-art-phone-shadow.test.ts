import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PREFAB } from "../world/constants.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-constants.ts";
import { placeCourse } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { OFF_MENU } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { TrackArt } from "./track-art.ts";

/** Whether the open world's art, built for a phone or not, casts a sun shadow from each prop kind in `kinds`, and from the trees. */
function casts(phone: boolean, kinds: readonly string[]): { furniture: string[]; trees: boolean } {
  stubBrowser();
  const track = new Track(OFF_MENU.find((json) => parseTrack(json).id === OPENWORLD_ID)!);
  const course = placeCourse(track);
  const art = new TrackArt(track, course.placed, new WorldStage(new THREE.Scene()), course.drawn, false, phone);
  const furniture = new Set<string>();
  let trees = false;
  art.group.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh) || !o.castShadow) return;
    if (o.name === `prop:${PREFAB.tree}`) trees = true;
    for (const kind of kinds) if (o.name === `prop:${kind}`) furniture.add(kind);
  });
  art.dispose();
  return { furniture: [...furniture].sort(), trees };
}

const FURNITURE = [PREFAB.hydrant, PREFAB.bollard, PREFAB.litterBin, PREFAB.bench, PREFAB.bikeRack, PREFAB.newsBox, PREFAB.parkingMeter, PREFAB.cellarDoor];
/** Large enough for its shade to show: it still casts on a phone. */
const SHADE = [PREFAB.cafeSet, PREFAB.dumpster];

describe("given the open world's course drawn for a phone and for a desktop", () => {
  // mutation: sed -i 's/ \&\& !(this.phone \&\& PHONE_NO_SHADOW.has(id)));/);/' src/game/present/track-art.ts
  it("when the art is built, then the desktop's street furniture casts shadows and the phone's casts none, while the trees cast on both", () => {
    const desktop = casts(false, FURNITURE);
    const phone = casts(true, FURNITURE);
    expect(casts(true, SHADE).furniture.join(","), "the cafe set and the dumpster still cast on a phone").toBe("cafe-set,dumpster");
    expect(desktop.furniture.length, "control: the desktop's furniture casts").toBeGreaterThan(5);
    expect(phone.furniture, "the phone's furniture").toEqual([]);
    expect(desktop.trees && phone.trees, "trees cast on both").toBe(true);
  });
});
