import type { HudProps } from "@/components/hud";

/** What the tether's hint line says, by what is awaited and which device plays: the mouse first, then the keys; a pad shows its D-pad. */
function hintText(pending: boolean, free: boolean, pad: boolean): string {
  if (pad) return pending && free ? "Hook the second object: D-pad ↑  ·  Cut: D-pad ←" : "Hook: D-pad ↑  ·  Reel: D-pad → (hold)  ·  Cut: D-pad ←";
  if (pending && free) return "Hook the second object: right-click or '  ·  Cut: middle-click or Del";
  return "Hook: right-click or '  ·  Reel: hold right-click or ]  ·  Cut: middle-click or Del";
}

/** The hint's gap under the reticle, as a share of the view's height. */
const HINT_BELOW_RETICLE = 0.06;

/** The tether's keys under the reticle while it is on offer, a desktop's or a pad's; a touch screen has its buttons (`TetherTouch`). */
export function TetherHint({ state }: Pick<HudProps, "state">) {
  const tether = state.tether;
  if (tether === null) return null;
  return (
    <p role="note" data-tether-hint style={{ top: `${(tether.sight + HINT_BELOW_RETICLE) * 100}%` }} className="pointer-events-none absolute inset-x-0 z-10 text-center text-xs text-fg/70 [text-shadow:0_1px_3px_rgb(0_0_0/0.7)]">
      {hintText(tether.pending, tether.free, state.pad !== null)}
    </p>
  );
}
