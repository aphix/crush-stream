import { MAX_CARS } from "../scenes/fleet.ts";
import { humanSlot } from "../match/survival.ts";
import type { PropCollider } from "../world/placements.ts";
import { Track } from "../world/track.ts";
import { HAVANA } from "../world/tracks/havana.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { HunterBrain, huntUnits } from "./hunter.ts";
import type { HunterWorld } from "./cop-brain.ts";
import { hypot2 } from "../kernel/physics-core.js";

export const track = new Track(HAVANA);
export const spec = track.survival!;
export const FAR = 4000;
export const BEAT = 0.25;

type RigOpts = {
  humans?: number;
  at?: (k: number) => { x: number; z: number };
  hidden?: (x: number, z: number) => boolean;
  colliders?: PropCollider[];
  seed?: number;
  /** Each cop drives a beat after every update, as in the game. */
  think?: boolean;
};

/**
 * The pack on a stub world for `humans` humans: cars 0 … humans − 1 are the player cars, on the start slots (`humanSlot`) or where `at` puts them; the units
 * follow, `huntUnits` of them. A spot is hidden from the camera unless `hidden` says otherwise (default: every spot), so a drop-in is only ever refused by the
 * pack's own rules; `down` holds the units that are knocked out (a park puts a unit back in one piece).
 */
export function rig({ humans = 1, at = (k) => humanSlot(spec.start, k), hidden, colliders = [], seed = 5, think = false }: RigOpts = {}) {
  const count = huntUnits(humans, MAX_CARS - humans);
  const cars: AiCar[] = Array.from({ length: humans + count }, (_, i) => {
    const slot = i < humans ? at(i) : { x: FAR, z: FAR };
    return { ...blankAiCar(i), x: slot.x, z: slot.z, yaw: spec.start.yaw };
  });
  const hunt = new Uint8Array(MAX_CARS);
  hunt.fill(1, 0, humans);
  const down = new Set<number>();
  const drops: { t: number; id: number; x: number; z: number; yaw: number; room: number }[] = [];
  const stored: { t: number; id: number }[] = [];
  const asked: { x: number; z: number; hidden: boolean }[] = [];
  // The run's clock starts at the green: the countdown before it (negative time) holds the formation.
  let now = -4.5;
  const world: HunterWorld = {
    park: (id, x, _y, z, yaw) => {
      // The room it found: the nearest other car on the road at that moment.
      const room = Math.min(...cars.filter((c) => c.id !== id && c.x !== FAR).map((c) => Math.hypot(c.x - x, c.z - z)));
      Object.assign(cars[id]!, { x, z, yaw, vx: 0, vz: 0 });
      down.delete(id);
      drops.push({ t: now, id, x, z, yaw, room });
    },
    store: (id) => {
      Object.assign(cars[id]!, { x: FAR, z: FAR });
      stored.push({ t: now, id });
    },
    hidden: (x, z) => {
      const h = hidden ? hidden(x, z) : true;
      asked.push({ x, z, hidden: h });
      return h;
    },
    down: (id) => down.has(id),
    speed: (id) => hypot2(cars[id]!.vx, cars[id]!.vz),
    sirens: () => {},
  };
  const brain = new HunterBrain(track, colliders, humans, humans, count, seed);
  brain.launch(world);
  const run = (until: number, each?: (t: number) => void): void => {
    for (; now < until - 1e-9; now += BEAT) {
      brain.update(now, BEAT, cars, hunt, 0, world);
      if (think) for (let i = humans; i < cars.length; i++) if (cars[i]!.x !== FAR) brain.think(cars[i]!, cars, BEAT);
      each?.(now);
    }
  };
  run(0);
  return { brain, cars, hunt, down, drops, stored, asked, run, count, now: () => now };
}
