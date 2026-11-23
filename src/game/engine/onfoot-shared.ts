import { detCos, detSin } from "../kernel/physics-core.js";
import { BODY_POSTURE, type BodyMotion } from "../net/body-codec.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import type { OnFootFlow } from "../present/onfoot-flow.ts";
import { WALKER_SLOT } from "../present/ragdoll-pool.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import { followAnchor } from "./body-follow.ts";
import type { BodyHost } from "./openworld-bodies.ts";

/** A car that has just run him down does not do it again for this long (s): the launch carries him through its footprint. */
export const STRIKE_COOLDOWN = 0.6;

const _torso = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

/** The walker on foot is knocked limp where he stands, launched at (vx, vy, vz) m/s, as a car's strike does it: false while he is not on foot or was struck within `STRIKE_COOLDOWN`. `strike` is scratch. */
export function knockOwnWalker(ragdolls: RagdollSystem, flow: OnFootFlow, strike: FigureStrike, vx: number, vy: number, vz: number): boolean {
  const walker = ragdolls.walkers[WALKER_SLOT]!;
  if (flow.phase !== "onFoot" || walker.sinceStruck < STRIKE_COOLDOWN || !ragdolls.dollMotion(WALKER_SLOT, _torso)) return false;
  strike.guard = -1;
  strike.car = -1;
  strike.x = _torso.x;
  strike.y = _torso.y;
  strike.z = _torso.z;
  strike.faceX = detSin(walker.facing);
  strike.faceZ = detCos(walker.facing);
  strike.vx = vx;
  strike.vy = vy;
  strike.vz = vz;
  strike.wx = 0;
  strike.wy = 0;
  strike.wz = 0;
  strike.loose = false;
  ragdolls.knockWalker(strike);
  return true;
}

/** The host's body for him has him roped: on foot, a walker who stands is knocked (launched as `t` moves) and one who lies follows `t` (`followAnchor`). */
export function dragOwnWalker(host: BodyHost, flow: OnFootFlow, t: BodyMotion, strike: FigureStrike, ragdolls: RagdollSystem): void {
  if (flow.phase !== "onFoot") return;
  t.posture = BODY_POSTURE.down;
  if (ragdolls.walkers[WALKER_SLOT]!.state === "stand") knockOwnWalker(ragdolls, flow, strike, t.vx, t.vy, t.vz);
  else followAnchor(host, WALKER_SLOT, t, 0);
}
