import type { HudProps } from "@/components/hud";

/** What the tether's hint line says, by the cables out, whether a first end is held, and which device plays. */
function hintText(count: number, pending: boolean, pad: boolean): string {
  if (pending) return pad ? "RT: tie it to this  ·  D-pad ←: let go" : "Click: tie it to this  ·  Del: let go";
  if (count === 0) return pad ? "RT: hook the first thing" : "Click: hook the first thing";
  return pad ? "RT: next cable  ·  D-pad → (hold): reel  ·  D-pad ←: cut" : "Click: next cable  ·  Hold ]: reel  ·  Del: cut";
}

/** The hint's gap under the reticle, as a share of the view's height. */
const HINT_BELOW_RETICLE = 0.06;

/** The tether's keys under the reticle while it is on offer, a desktop's or a pad's; a touch screen has its buttons (`TetherTouch`). */
export function TetherHint({ state }: Pick<HudProps, "state">) {
  const tether = state.tether;
  if (tether === null) return null;
  return (
    <p role="note" data-tether-hint style={{ top: `${(tether.sight + HINT_BELOW_RETICLE) * 100}%` }} className="pointer-events-none absolute inset-x-0 z-10 text-center text-xs text-fg/70 [text-shadow:0_1px_3px_rgb(0_0_0/0.7)]">
      {hintText(tether.count, tether.pending, state.pad !== null)}
    </p>
  );
}
