import { Magnet, Scissors } from "lucide-react";
import type { HudProps } from "@/components/hud";
import { PadButton } from "@/components/touch-pedals";
import { PAD_BUTTON } from "@/game/vehicle/gamepad";

const BUTTON = "size-12";

/**
 * The hook's cables on a touch screen (the touch Fire button fires the hook): while a cable is out or a first end is held, Reel (hold, D-pad right) and Cut (tap, D-pad left).
 * A column down the right edge, clear of the road zone; each writes the pad, so the pad bindings run it.
 */
export function TetherTouch({ state, engine }: Pick<HudProps, "state" | "engine">) {
  const tether = state.tether;
  if (tether === null || (tether.count === 0 && !tether.pending)) return null;
  return (
    <div role="group" aria-label="Tether" className="pointer-events-none absolute right-3 top-1/3 flex flex-col gap-2">
      <PadButton engine={engine} button={PAD_BUTTON.right} name="tether-reel" label="Reel the cable in (hold)" caption="Reel" showCaption className={BUTTON}>
        <Magnet />
      </PadButton>
      <PadButton engine={engine} button={PAD_BUTTON.left} name="tether-cut" label="Cut the cables (tap)" caption="Cut" showCaption className={BUTTON}>
        <Scissors />
      </PadButton>
    </div>
  );
}
