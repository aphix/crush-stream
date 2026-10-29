import { describe, expect, it } from "vitest";
import { MAT, MATERIALS } from "../kernel/material-ids.ts";
import { PREFABS, PREFAB_IDS, SURFACES, SURFACE_IDS, type SurfaceId } from "./catalog.ts";
import { ROLLS } from "./surfaces.ts";
import { placeProps, propColliders } from "./placements.ts";
import { Track } from "./track.ts";
import { parseTrack } from "./track-schema.ts";
import { OFF_MENU, TRACKS } from "./tracks/index.ts";

const family = (id: number): number => MATERIALS[id]![1];

/** Each surface's shading family as the ribbon (`texClass`) and the terrain cell (`surfaceClass`) drew it before ids: cobble was soil as a road and stone as a cell. */
const FAMILIES: Record<SurfaceId, { ribbon: number; cell: number }> = {
  asphalt: { ribbon: MAT.ASPHALT, cell: MAT.ASPHALT },
  concrete: { ribbon: MAT.CONCRETE, cell: MAT.CONCRETE },
  cobble: { ribbon: MAT.SOIL, cell: MAT.STONE },
  dirt: { ribbon: MAT.SOIL, cell: MAT.SOIL },
  gravel: { ribbon: MAT.SOIL, cell: MAT.SOIL },
  grass: { ribbon: MAT.SOIL, cell: MAT.SOIL },
  sand: { ribbon: MAT.SOIL, cell: MAT.SOIL },
};

/** The sim's grip and rolling resistance per surface, in `SURFACE_IDS` order: what saved clips were recorded on. */
const SIM_GRIP = [1, 1, 0.85, 0.72, 0.62, 0.5, 0.45];
const SIM_ROLL = [0.015, 0.015, 0.03, 0.05, 0.06, 0.35, 0.4];

describe("given each surface's material ids", () => {
  for (const id of SURFACE_IDS) {
    it(`when ${id}'s ribbon, terrain and patch ids are shaded, then they use the family it drew with before ids`, () => {
      const s = SURFACES[id];
      expect(family(s.ribbon)).toBe(FAMILIES[id].ribbon);
      expect(family(s.terrain)).toBe(FAMILIES[id].cell);
      expect(family(s.patch)).toBe(FAMILIES[id].cell);
    });
  }

  it("when the three id sets are compared, then every surface has its own ids, none a legacy family row", () => {
    const ids = SURFACE_IDS.flatMap((id) => [SURFACES[id].ribbon, SURFACES[id].terrain, SURFACES[id].patch]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((m) => m >= MAT.INTERIOR + 1)).toBeTruthy();
  });
});

describe("given the sim's surface table", () => {
  it("when grips and rolling resistances are read in surface order, then they are the recorded literals", () => {
    for (const [i, id] of SURFACE_IDS.entries()) {
      expect(SURFACES[id].grip, `${id} grip`).toBe(SIM_GRIP[i]);
      expect(SURFACES[id].roll, `${id} roll`).toBe(SIM_ROLL[i]);
      expect(ROLLS[i], `${id} ROLLS`).toBe(SIM_ROLL[i]);
    }
  });
});

describe("given the prefab catalogue", () => {
  it("when each prefab's material is read, then it is a registered fine id", () => {
    for (const id of PREFAB_IDS) {
      const m = PREFABS[id].material;
      expect(Number.isInteger(m) && m > MAT.INTERIOR && m < MATERIALS.length, `${id} material ${m}`).toBeTruthy();
    }
  });

  it("when every prefab's material is zeroed, then every course's prop colliders are unchanged", () => {
    const tracks = [...TRACKS, ...OFF_MENU].map((json) => ({ id: parseTrack(json).id, placed: placeProps(new Track(json)) }));
    const before = tracks.map((t) => JSON.stringify(propColliders(t.placed)));
    const kept = PREFAB_IDS.map((id) => PREFABS[id].material);
    try {
      for (const id of PREFAB_IDS) PREFABS[id].material = 0;
      for (const [i, t] of tracks.entries()) expect(JSON.stringify(propColliders(t.placed)), `${t.id} colliders read a prefab material`).toBe(before[i]);
    } finally {
      for (const [i, id] of PREFAB_IDS.entries()) PREFABS[id].material = kept[i]!;
    }
  });
});
