import type * as THREE from "three";
import { GRAVITY } from "../kernel/constants.ts";
import { JET_FADE_S, type FountainSystem } from "./fountain-system.ts";

/**
 * A fountain's sparks as their spawn data and its clock give them (the vertex shader flies the same formula): a ring slot's spark is in
 * flight from its birth for its flight time, and nothing on the CPU moves it.
 */

/** Seconds each ring slot's spark still has to fly, 0 for a slot not in flight. */
export function sparkLives(sys: FountainSystem): number[] {
  const now = sys["clock"].value;
  return Array.from({ length: sys["n"] }, (_, k) => {
    const age = now - sys["spawnSpan"][k * 2]!;
    const flight = sys["spawnSpan"][k * 2 + 1]!;
    return age >= 0 && age < flight ? flight - age : 0;
  });
}

/** Where slot `k`'s spark is now, into `out`. */
export function sparkAt(sys: FountainSystem, k: number, out: THREE.Vector3): THREE.Vector3 {
  const age = sys["clock"].value - sys["spawnSpan"][k * 2]!;
  out.set(sys["spawnPos"][k * 3]! + sys["spawnVel"][k * 3]! * age, sys["spawnPos"][k * 3 + 1]! + sys["spawnVel"][k * 3 + 1]! * age - (GRAVITY / 2) * age * age, sys["spawnPos"][k * 3 + 2]! + sys["spawnVel"][k * 3 + 2]! * age);
  return out;
}

/** Channel `c` (0 r, 1 g, 2 b) of slot `k`'s spark as it is drawn: its colour times its fade over its last `JET_FADE_S`. */
export function sparkTint(sys: FountainSystem, k: number, c: number): number {
  return sys["spawnHue"][k * 3 + c]! * Math.min(1, sparkLives(sys)[k]! / JET_FADE_S);
}
